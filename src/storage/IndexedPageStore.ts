/**
 * Sprint 015 M2-2 — IndexedPageStore (base).
 * PRD §04 §4.3.2 Page + §4.3.3 Visit + §05.4.1 라이프사이클.
 *
 * Phase 1 base 책임:
 *   - Page entity (id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
 *   - Visit entity (id, page_id, workspace_id, visited_at, dwell_ms)
 *   - upsertPage: 재방문 시 content_hash 비교 → unchanged / updated_changed / created 분기
 *   - createVisit: 매 방문 INSERT, Page.visited_count denormalized 갱신
 *
 * Phase 1 M3 확장 예정:
 *   - sqlite-vec virtual table (vec_pages) → embedding 통합
 *   - Note / AiChatHistory / Tag store 분리 모듈
 *   - SQLite 영속 (schema/v04.sql) — 본 base 의 JSON 영속을 흡수
 *   - migrations/v03_to_v04: PageResultStore JSON → IndexedPageStore 자동 이전
 *
 * M2-2 어댑터 호환:
 *   - feature flag `flowbrowser.v04.enabled` false (디폴트) 시 PageResultStore 가 본 모듈 미사용
 *   - flag true 시 PageResultStore.store() 가 본 모듈에 Page + Visit side-write (instructions 는 v0.3 JSON 그대로)
 *
 * LRU 정책 (M2-2 base):
 *   - maxBytes 임계 초과 시 lastVisitedAt 기준 LRU trim. Page + Visit 동반 제거 (cascade)
 *   - kind 별 격리 X (M3 SQLite 도입 시 재평가)
 *
 * 디폴트 workspace_id:
 *   - v0.3 호환 호출자가 workspace_id 미주입 시 `'default'` 사용
 *   - M3 마이그레이션 시 `'default'` → "📥 기본" 워크스페이스 UUID 로 일괄 갱신
 */

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export const DEFAULT_WORKSPACE_ID = 'default'

export interface Page {
  id: string
  workspace_id: string
  url: string
  title: string
  content: string
  content_hash: string | null
  lang: string | null
  visited_count: number
  created_at: number
  updated_at: number
}

export interface Visit {
  id: string
  page_id: string
  workspace_id: string
  visited_at: number
  dwell_ms: number
}

export interface UpsertPageInput {
  workspace_id?: string
  url: string
  title?: string
  content?: string
  lang?: string | null
}

export type UpsertAction = 'created' | 'updated_changed' | 'unchanged'

export interface UpsertPageResult {
  page: Page
  action: UpsertAction
}

export interface CreateVisitInput {
  page_id: string
  workspace_id?: string
  dwell_ms?: number
  visited_at?: number
}

/**
 * M2-2 codex 핫픽스 — PRD §05.4.1 단일 TX `{Page (U/C) + Visit (C)}` 정합 원자 메서드 입력.
 * recordVisit() 가 upsertPage + createVisit 를 한 호출에서 묶어 처리.
 */
export interface RecordVisitInput {
  workspace_id?: string
  url: string
  title?: string
  content?: string
  lang?: string | null
  dwell_ms?: number
  visited_at?: number
}

export interface RecordVisitResult {
  page: Page
  visit: Visit
  action: UpsertAction
}

export interface IndexedPageStoreOptions {
  maxBytes?: number
}

export interface IndexedPageStats {
  pages: number
  visits: number
  perWorkspace: Record<string, { pages: number; visits: number }>
}

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * URL 정규화 — origin + pathname. 파싱 실패 시 trim 반환.
 * PageResultStore.normalizePageUrl 와 동일 알고리즘 (M5 어댑터 제거 시 한쪽으로 통합).
 */
export function normalizeIndexedUrl(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    return raw.trim()
  }
}

/**
 * 본문 sha256 hex (32 char prefix). 빈 본문이면 null.
 */
export function contentHashOf(content: string): string | null {
  if (!content) return null
  return createHash('sha256').update(content).digest('hex').slice(0, 32)
}

interface PersistFile {
  pages: Page[]
  visits: Visit[]
}

export class IndexedPageStore {
  private pages = new Map<string, Page>() // page.id → Page
  private pageIndexByUrl = new Map<string, string>() // `${workspace_id}|${url}` → page.id
  private visits = new Map<string, Visit>() // visit.id → Visit
  private visitsByPage = new Map<string, Set<string>>() // page.id → Set<visit.id>
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false
  private maxBytes: number

  constructor(
    private filePath: string,
    opts: IndexedPageStoreOptions = {}
  ) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  }

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<PersistFile>
      this.pages.clear()
      this.pageIndexByUrl.clear()
      this.visits.clear()
      this.visitsByPage.clear()
      if (Array.isArray(parsed.pages)) {
        for (const raw of parsed.pages) {
          const page = this.parsePage(raw)
          if (!page) continue
          this.indexPage(page)
        }
      }
      if (Array.isArray(parsed.visits)) {
        for (const raw of parsed.visits) {
          const visit = this.parseVisit(raw)
          if (!visit) continue
          const page = this.pages.get(visit.page_id)
          if (!page) continue // orphan visit
          // M2-2 codex 핫픽스: Visit.workspace_id 가 참조 Page.workspace_id 와 다르면 drop (워크스페이스 격리 위반)
          if (visit.workspace_id !== page.workspace_id) continue
          this.indexVisit(visit)
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.pages.clear()
        this.pageIndexByUrl.clear()
        this.visits.clear()
        this.visitsByPage.clear()
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  /**
   * UPSERT Page. PRD §05.4.1 라이프사이클:
   *   - lookup by (workspace_id, url)
   *   - 없음 → INSERT (visited_count=1, created/updated_at=now), action='created'
   *   - 있음 + content_hash 같음 → UPDATE visited_count++, action='unchanged' (재방문, 본문 변경 없음)
   *   - 있음 + content_hash 다름 → UPDATE content/content_hash/visited_count++/updated_at, action='updated_changed'
   *
   * visited_count 는 매 호출 +1 (Visit 추가는 별도 createVisit). 즉 본 메서드는 "재방문 카운트 갱신"까지만 — Visit 행은 호출자가 createVisit 로 명시 INSERT.
   */
  async upsertPage(input: UpsertPageInput): Promise<UpsertPageResult> {
    this.ensureLoaded()
    const workspace_id = input.workspace_id ?? DEFAULT_WORKSPACE_ID
    const url = normalizeIndexedUrl(input.url)
    if (!url) throw new Error('IndexedPageStore.upsertPage: url required')
    const title = input.title ?? ''
    const content = input.content ?? ''
    const hash = contentHashOf(content)
    const lang = input.lang ?? null
    const now = Date.now()
    const indexKey = `${workspace_id}|${url}`
    const existingId = this.pageIndexByUrl.get(indexKey)
    if (existingId) {
      const existing = this.pages.get(existingId)
      if (existing) {
        const sameContent = existing.content_hash === hash
        const next: Page = sameContent
          ? {
              ...existing,
              visited_count: existing.visited_count + 1
              // updated_at 은 변경 없음 (본문 변경 없으므로)
            }
          : {
              ...existing,
              title,
              content,
              content_hash: hash,
              lang,
              visited_count: existing.visited_count + 1,
              updated_at: now
            }
        this.pages.set(next.id, next)
        await this.scheduleWrite()
        return { page: next, action: sameContent ? 'unchanged' : 'updated_changed' }
      }
    }
    const page: Page = {
      id: randomUUID(),
      workspace_id,
      url,
      title,
      content,
      content_hash: hash,
      lang,
      visited_count: 1,
      created_at: now,
      updated_at: now
    }
    this.indexPage(page)
    await this.scheduleWrite()
    return { page, action: 'created' }
  }

  /**
   * PRD §05.4.1 단일 TX 정합 원자 메서드 (M2-2 codex 핫픽스).
   *
   *   { Page (C 또는 U visited_count++) + Visit (C) }
   *
   * 호출자는 본 메서드로 페이지 방문을 기록 — upsertPage / createVisit 를 따로 호출할 필요 X.
   * 인덱싱 hook (M4 IndexingService) 의 표준 진입점.
   *
   * 반환 = { page (UPSERT 후 최신), visit (신규 INSERT), action ('created'/'unchanged'/'updated_changed') }.
   */
  async recordVisit(input: RecordVisitInput): Promise<RecordVisitResult> {
    this.ensureLoaded()
    const upsertResult = await this.upsertPage({
      workspace_id: input.workspace_id,
      url: input.url,
      title: input.title,
      content: input.content,
      lang: input.lang
    })
    const visit = await this.createVisit({
      page_id: upsertResult.page.id,
      workspace_id: upsertResult.page.workspace_id,
      dwell_ms: input.dwell_ms,
      visited_at: input.visited_at
    })
    return { page: upsertResult.page, visit, action: upsertResult.action }
  }

  /**
   * Visit INSERT. visited_at 미주입 시 now.
   * Page.workspace_id 와 입력 workspace_id 가 다르면 throw (워크스페이스 격리 위반).
   *
   * **주의 (M2-2 codex 핫픽스)**: PRD §05.4.1 단일 TX 의 일부 — 페이지 방문 기록은 `recordVisit()` 사용 권장.
   * 본 메서드 단독 호출 시 Page.visited_count 가 갱신되지 않음 (low-level CRUD).
   */
  async createVisit(input: CreateVisitInput): Promise<Visit> {
    this.ensureLoaded()
    const page = this.pages.get(input.page_id)
    if (!page) throw new Error(`IndexedPageStore.createVisit: page not found id=${input.page_id}`)
    const workspace_id = input.workspace_id ?? page.workspace_id
    if (workspace_id !== page.workspace_id) {
      throw new Error(
        `IndexedPageStore.createVisit: workspace mismatch (page=${page.workspace_id} vs visit=${workspace_id})`
      )
    }
    const visit: Visit = {
      id: randomUUID(),
      page_id: page.id,
      workspace_id,
      visited_at: input.visited_at ?? Date.now(),
      dwell_ms: input.dwell_ms ?? 0
    }
    this.indexVisit(visit)
    await this.scheduleWrite()
    return { ...visit }
  }

  lookupPage(workspace_id: string, url: string): Page | null {
    this.ensureLoaded()
    const normalized = normalizeIndexedUrl(url)
    const id = this.pageIndexByUrl.get(`${workspace_id}|${normalized}`)
    if (!id) return null
    const page = this.pages.get(id)
    return page ? { ...page } : null
  }

  getPage(id: string): Page | null {
    this.ensureLoaded()
    const page = this.pages.get(id)
    return page ? { ...page } : null
  }

  listVisits(page_id: string): Visit[] {
    this.ensureLoaded()
    const ids = this.visitsByPage.get(page_id)
    if (!ids) return []
    const list: Visit[] = []
    for (const id of ids) {
      const v = this.visits.get(id)
      if (v) list.push({ ...v })
    }
    list.sort((a, b) => a.visited_at - b.visited_at)
    return list
  }

  countPages(workspace_id?: string): number {
    this.ensureLoaded()
    if (workspace_id === undefined) return this.pages.size
    let n = 0
    for (const p of this.pages.values()) if (p.workspace_id === workspace_id) n++
    return n
  }

  countVisits(workspace_id?: string): number {
    this.ensureLoaded()
    if (workspace_id === undefined) return this.visits.size
    let n = 0
    for (const v of this.visits.values()) if (v.workspace_id === workspace_id) n++
    return n
  }

  stats(): IndexedPageStats {
    this.ensureLoaded()
    const perWorkspace: Record<string, { pages: number; visits: number }> = {}
    for (const p of this.pages.values()) {
      const slot = (perWorkspace[p.workspace_id] ??= { pages: 0, visits: 0 })
      slot.pages += 1
    }
    for (const v of this.visits.values()) {
      const slot = (perWorkspace[v.workspace_id] ??= { pages: 0, visits: 0 })
      slot.visits += 1
    }
    return { pages: this.pages.size, visits: this.visits.size, perWorkspace }
  }

  /**
   * 워크스페이스 단위 cascade DELETE. PRD §04 ON DELETE CASCADE 정합.
   * 반환: 제거된 page / visit 카운트.
   */
  async deleteByWorkspace(workspace_id: string): Promise<{ pages: number; visits: number }> {
    this.ensureLoaded()
    let pagesRemoved = 0
    let visitsRemoved = 0
    const pageIdsToRemove: string[] = []
    for (const [id, page] of this.pages.entries()) {
      if (page.workspace_id === workspace_id) pageIdsToRemove.push(id)
    }
    for (const pageId of pageIdsToRemove) {
      const page = this.pages.get(pageId)
      if (!page) continue
      const visitIds = this.visitsByPage.get(pageId)
      if (visitIds) {
        for (const vid of visitIds) {
          if (this.visits.delete(vid)) visitsRemoved += 1
        }
        this.visitsByPage.delete(pageId)
      }
      this.pages.delete(pageId)
      this.pageIndexByUrl.delete(`${page.workspace_id}|${page.url}`)
      pagesRemoved += 1
    }
    if (pagesRemoved > 0 || visitsRemoved > 0) await this.scheduleWrite()
    return { pages: pagesRemoved, visits: visitsRemoved }
  }

  async clearAll(): Promise<void> {
    this.ensureLoaded()
    this.pages.clear()
    this.pageIndexByUrl.clear()
    this.visits.clear()
    this.visitsByPage.clear()
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.unlink(this.filePath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    })
    await this.writeQueue
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('IndexedPageStore.load() not called')
  }

  private indexPage(page: Page): void {
    this.pages.set(page.id, page)
    this.pageIndexByUrl.set(`${page.workspace_id}|${page.url}`, page.id)
  }

  private indexVisit(visit: Visit): void {
    this.visits.set(visit.id, visit)
    let bucket = this.visitsByPage.get(visit.page_id)
    if (!bucket) {
      bucket = new Set()
      this.visitsByPage.set(visit.page_id, bucket)
    }
    bucket.add(visit.id)
  }

  private parsePage(raw: unknown): Page | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (!isString(obj.id) || obj.id.length === 0) return null
    if (!isString(obj.workspace_id) || obj.workspace_id.length === 0) return null
    if (!isString(obj.url) || obj.url.length === 0) return null
    if (!isString(obj.title)) return null
    if (!isString(obj.content)) return null
    if (obj.content_hash !== null && !isString(obj.content_hash)) return null
    if (obj.lang !== null && !isString(obj.lang)) return null
    if (!isFiniteNumber(obj.visited_count) || !Number.isInteger(obj.visited_count)) return null
    // M2-2 codex 핫픽스: epoch-ms 정수만 허용 (1.5 같은 float drop)
    const createdAt = this.parseEpochMs(obj.created_at)
    const updatedAt = this.parseEpochMs(obj.updated_at)
    if (createdAt === null || updatedAt === null) return null
    if (updatedAt < createdAt) return null
    return {
      id: obj.id,
      workspace_id: obj.workspace_id,
      url: obj.url,
      title: obj.title,
      content: obj.content,
      content_hash: obj.content_hash as string | null,
      lang: obj.lang as string | null,
      visited_count: obj.visited_count,
      created_at: createdAt,
      updated_at: updatedAt
    }
  }

  private parseVisit(raw: unknown): Visit | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (!isString(obj.id) || obj.id.length === 0) return null
    if (!isString(obj.page_id) || obj.page_id.length === 0) return null
    if (!isString(obj.workspace_id) || obj.workspace_id.length === 0) return null
    // M2-2 codex 핫픽스: epoch-ms 정수만 허용 (1.5 같은 float drop)
    const visitedAt = this.parseEpochMs(obj.visited_at)
    if (visitedAt === null) return null
    if (!isFiniteNumber(obj.dwell_ms) || !Number.isInteger(obj.dwell_ms)) return null
    return {
      id: obj.id,
      page_id: obj.page_id,
      workspace_id: obj.workspace_id,
      visited_at: visitedAt,
      dwell_ms: obj.dwell_ms
    }
  }

  /**
   * M2-2 codex 핫픽스: epoch-ms 검증 — finite + non-negative + Integer.
   * fractional / NaN / Infinity / negative 모두 reject.
   */
  private parseEpochMs(v: unknown): number | null {
    if (typeof v !== 'number') return null
    if (!Number.isFinite(v) || v < 0) return null
    if (!Number.isInteger(v)) return null
    return v
  }

  private async scheduleWrite(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.persistOnce())
    await this.writeQueue
  }

  private async persistOnce(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload: PersistFile = {
      pages: Array.from(this.pages.values()),
      visits: Array.from(this.visits.values())
    }
    const serialized = JSON.stringify(payload, null, 0)
    if (Buffer.byteLength(serialized) > this.maxBytes) {
      this.trimLruInMemory()
      const trimmed: PersistFile = {
        pages: Array.from(this.pages.values()),
        visits: Array.from(this.visits.values())
      }
      await fs.writeFile(this.filePath, JSON.stringify(trimmed, null, 0), 'utf-8')
      return
    }
    await fs.writeFile(this.filePath, serialized, 'utf-8')
  }

  /**
   * maxBytes 초과 시 Page LRU trim. 기준: 마지막 visit 의 visited_at (없으면 page.updated_at).
   * 절반 제거, cascade 로 Visit 도 동반 제거.
   */
  private trimLruInMemory(): void {
    const pages = Array.from(this.pages.values())
    if (pages.length <= 1) return
    const scored = pages.map((p) => {
      const visitIds = this.visitsByPage.get(p.id)
      let lastVisited = p.updated_at
      if (visitIds) {
        for (const vid of visitIds) {
          const v = this.visits.get(vid)
          if (v && v.visited_at > lastVisited) lastVisited = v.visited_at
        }
      }
      return { page: p, lastVisited }
    })
    scored.sort((a, b) => b.lastVisited - a.lastVisited)
    const keep = scored.slice(0, Math.max(1, Math.floor(scored.length / 2)))
    const keepIds = new Set(keep.map((s) => s.page.id))
    // 제거 대상 page 의 visit 도 cascade
    for (const [id, page] of this.pages.entries()) {
      if (!keepIds.has(id)) {
        const visitIds = this.visitsByPage.get(id)
        if (visitIds) {
          for (const vid of visitIds) this.visits.delete(vid)
          this.visitsByPage.delete(id)
        }
        this.pages.delete(id)
        this.pageIndexByUrl.delete(`${page.workspace_id}|${page.url}`)
      }
    }
  }
}

export function defaultIndexedPagePath(userDataDir: string): string {
  return join(userDataDir, 'indexed-pages.json')
}
