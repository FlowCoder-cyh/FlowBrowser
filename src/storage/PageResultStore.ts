/**
 * Sprint 006 M3 — PageResultStore.
 * 페이지 단위 번역 결과 영속 + 재방문 복원.
 *
 * 키 = sha256(정규화된 URL + targetLanguage + providerType + glossaryVersion)
 * 값 = { url, instructions[], nodesSignature, timestamps }
 *
 * TTL 30일, 디스크 한도 500MB (초과 시 LRU 절반 trim).
 * 정규화: 쿼리/프래그먼트 제외 (오직 origin + pathname).
 *
 * Sprint 015 M2-2 — IndexedPageStore 어댑터 모드 추가.
 *   - 생성자 `opts.indexedPageStoreBackend` 미주입: 기존 v0.3 JSON 동작 100% 보존
 *   - 생성자 `opts.indexedPageStoreBackend` 주입: store() 시 IndexedPageStore 에 Page + Visit side-write
 *     (instructions / nodesSignature / selectorPreset 은 v0.3 JSON 그대로 — TranslationRenderer 가 M5 폐기)
 *     workspace_id 미주입 시 `DEFAULT_WORKSPACE_ID` ('default') 사용 — M3 마이그레이션 시 "📥 기본" UUID 로 일괄 갱신
 *   - 본 어댑터는 M5 종료 시 PageResultStore 자체와 함께 제거 (PRD §19.5.4)
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { IndexedPageStore, DEFAULT_WORKSPACE_ID } from './IndexedPageStore'

export interface PageResultInstruction {
  id: string
  translatedText: string
}

export interface PageResultEntry {
  id: string
  key: string
  url: string
  targetLanguage: string
  providerType: string
  glossaryVersion: string
  nodesSignature: string
  selectorPreset: 'paragraph' | 'page'
  instructions: PageResultInstruction[]
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  expiresAt: number
}

export interface PageResultLookupKey {
  url: string
  targetLanguage: string
  providerType: string
  glossaryVersion?: string
}

export interface PageResultStoreOptions {
  ttlMs?: number
  maxBytes?: number
  /**
   * Sprint 015 M2-2 — 주입 시 store() 호출이 IndexedPageStore 에 Page + Visit side-write.
   * lookup / clearAll 등 v0.3 인터페이스는 변경 X (instructions 는 v0.3 JSON 그대로).
   */
  indexedPageStoreBackend?: IndexedPageStore
  /**
   * IndexedPageStore side-write 시 사용할 workspace_id. 미주입 시 `DEFAULT_WORKSPACE_ID` ('default').
   * M3 마이그레이션 시점에 "📥 기본" 워크스페이스 UUID 로 일괄 갱신.
   */
  defaultWorkspaceId?: string
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024

/**
 * URL을 origin + pathname만 남기는 정규화. 쿼리/프래그먼트는 제외.
 * 파싱 실패 시 원본 trim 반환.
 */
export function normalizePageUrl(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    return raw.trim()
  }
}

// Sprint 015 M2-8 — retired page-node signature helper 제거. page-result persist helper 폐기로 호출자 0.

function buildKey(args: PageResultLookupKey): string {
  const normalized = normalizePageUrl(args.url)
  const payload = [
    normalized,
    args.targetLanguage,
    args.providerType,
    args.glossaryVersion ?? 'default'
  ].join('|')
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export class PageResultStore {
  private memory = new Map<string, PageResultEntry>()
  private opts: Required<Pick<PageResultStoreOptions, 'ttlMs' | 'maxBytes'>>
  private backend: IndexedPageStore | null
  private defaultWorkspaceId: string
  private sideWriteFailures = 0
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    private filePath: string,
    opts: PageResultStoreOptions = {}
  ) {
    this.opts = {
      ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
      maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES
    }
    this.backend = opts.indexedPageStoreBackend ?? null
    this.defaultWorkspaceId = opts.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID
  }

  /**
   * Sprint 015 M2-2 — IndexedPageStore side-write 어댑터 모드 활성 여부.
   */
  isAdapterMode(): boolean {
    return this.backend !== null
  }

  /**
   * Sprint 015 M2-2 — IndexedPageStore side-write 실패 누적 카운트 (codex 핫픽스 관측 가능성).
   * 어댑터 모드 운영 중 v0.4 데이터 누락 추적용. M5 어댑터 제거 시 본 카운터도 제거.
   */
  sideWriteFailureCount(): number {
    return this.sideWriteFailures
  }

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as PageResultEntry[]
      this.memory.clear()
      for (const entry of parsed) {
        if (!entry?.key) continue
        this.memory.set(entry.key, entry)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.memory.clear()
      } else {
        throw err
      }
    }
    this.purgeExpiredSync()
    this.loaded = true
  }

  async lookup(
    args: PageResultLookupKey & { nodesSignature?: string }
  ): Promise<PageResultEntry | null> {
    this.ensureLoaded()
    const key = buildKey(args)
    const entry = this.memory.get(key)
    if (!entry) return null
    const now = Date.now()
    if (entry.expiresAt < now) {
      this.memory.delete(key)
      await this.scheduleWrite()
      return null
    }
    // 페이지 변경 감지 — 노드 시그니처 불일치면 복원 불가
    if (args.nodesSignature && args.nodesSignature !== entry.nodesSignature) {
      return null
    }
    entry.lastAccessedAt = now
    await this.scheduleWrite()
    return { ...entry, instructions: [...entry.instructions] }
  }

  async store(args: {
    url: string
    targetLanguage: string
    providerType: string
    glossaryVersion?: string
    nodesSignature: string
    selectorPreset: 'paragraph' | 'page'
    instructions: PageResultInstruction[]
    /**
     * Sprint 015 M2-2 — IndexedPageStore side-write 시 사용. 미주입 시 어댑터의 defaultWorkspaceId.
     */
    workspaceId?: string
    /**
     * Sprint 015 M2-2 — IndexedPageStore Page.title side-write. 미주입 시 빈 문자열.
     */
    pageTitle?: string
    /**
     * Sprint 015 M2-2 — IndexedPageStore Page.content side-write. 미주입 시 빈 문자열 (마이그레이션 케이스 정합 §04 §4.3.2).
     */
    pageContent?: string
    /**
     * Sprint 015 M2-2 — IndexedPageStore Page.lang side-write.
     */
    pageLang?: string | null
  }): Promise<PageResultEntry> {
    this.ensureLoaded()
    const key = buildKey(args)
    const now = Date.now()
    const existing = this.memory.get(key)
    const entry: PageResultEntry = existing
      ? {
          ...existing,
          nodesSignature: args.nodesSignature,
          selectorPreset: args.selectorPreset,
          instructions: [...args.instructions],
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + this.opts.ttlMs
        }
      : {
          id: `pr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          key,
          url: normalizePageUrl(args.url),
          targetLanguage: args.targetLanguage,
          providerType: args.providerType,
          glossaryVersion: args.glossaryVersion ?? 'default',
          nodesSignature: args.nodesSignature,
          selectorPreset: args.selectorPreset,
          instructions: [...args.instructions],
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + this.opts.ttlMs
        }
    this.memory.set(key, entry)
    await this.scheduleWrite()
    if (this.backend) {
      await this.sideWriteIndexedPage({
        workspace_id: args.workspaceId ?? this.defaultWorkspaceId,
        url: args.url,
        title: args.pageTitle ?? '',
        content: args.pageContent ?? '',
        lang: args.pageLang ?? null
      })
    }
    return entry
  }

  /**
   * IndexedPageStore Page UPSERT + Visit INSERT side-write.
   * v0.3 호출자가 backend 주입한 경우만 실행. backend 실패 시 PageResultStore.store() 결과는 영향 X (로깅 + 카운터).
   *
   * M2-2 codex 핫픽스: PRD §05.4.1 단일 TX 정합 — IndexedPageStore.recordVisit() (Page UPSERT + Visit INSERT 원자) 사용.
   * 기존 upsertPage + createVisit 분리 호출은 두 작업 중 한쪽만 성공하는 부분 실패 위험.
   */
  private async sideWriteIndexedPage(input: {
    workspace_id: string
    url: string
    title: string
    content: string
    lang: string | null
  }): Promise<void> {
    if (!this.backend) return
    try {
      await this.backend.recordVisit({
        workspace_id: input.workspace_id,
        url: input.url,
        title: input.title,
        content: input.content,
        lang: input.lang
      })
    } catch (err) {
      // M2-2 어댑터 side-write 실패는 v0.3 결과에 영향 X — 콘솔 경고 + 카운터 (codex 핫픽스 관측 가능성)
      this.sideWriteFailures += 1
      console.warn('[PageResultStore] IndexedPageStore side-write failed:', err)
    }
  }

  async clearAll(): Promise<void> {
    this.memory.clear()
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.unlink(this.filePath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    })
    await this.writeQueue
  }

  size(): number {
    return this.memory.size
  }

  stats(): { count: number } {
    return { count: this.memory.size }
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('PageResultStore.load() not called')
    }
  }

  private purgeExpiredSync(): void {
    const now = Date.now()
    for (const [key, entry] of this.memory.entries()) {
      if (entry.expiresAt < now) {
        this.memory.delete(key)
      }
    }
  }

  private async scheduleWrite(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.persistOnce())
    await this.writeQueue
  }

  private async persistOnce(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const all = Array.from(this.memory.values())
    const serialized = JSON.stringify(all, null, 0)
    if (Buffer.byteLength(serialized) > this.opts.maxBytes) {
      all.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const half = all.slice(0, Math.floor(all.length / 2))
      this.memory.clear()
      for (const e of half) this.memory.set(e.key, e)
      await fs.writeFile(this.filePath, JSON.stringify(half, null, 0), 'utf-8')
      return
    }
    await fs.writeFile(this.filePath, serialized, 'utf-8')
  }
}

export function defaultPageResultPath(userDataDir: string): string {
  return join(userDataDir, 'page-results.json')
}
