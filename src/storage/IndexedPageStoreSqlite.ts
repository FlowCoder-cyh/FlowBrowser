/**
 * Sprint 015 M3-3 — IndexedPageStoreSqlite (SQLite backend).
 *
 * IndexedPageStore JSON 영속 → SQLite "흡수" 단계.
 * 동일 public API + FlowbrowserDatabase pages/visits 테이블 활용.
 *
 * 책임:
 *   - Page entity (PRD §04.3.2) + Visit entity (§04.3.3) CRUD on flowbrowser.db
 *   - recordVisit: 단일 TX 원자 메서드 (PRD §05.4.1 정합)
 *     {Page (C 또는 U visited_count++) + Visit (C)} better-sqlite3 transaction wrapper
 *   - content_hash dedupe (재방문 시 본문 변경 감지)
 *   - workspace_id partition (real Workspace.id UUID, JSON 'default' 문자열 매핑)
 *
 * 호출 패턴:
 *   const fb = FlowbrowserDatabase.bootstrap({ path })
 *   const defaultWs = fb.ensureDefaultWorkspace()
 *   const store = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
 *   await store.load()  // no-op (FlowbrowserDatabase 가 schema 준비)
 *   const { page, visit, action } = await store.recordVisit({ url, title, content })
 *
 * IndexedPageStore (JSON) 와의 차이:
 *   - 모든 영속은 SQLite. JSON 파일 미사용.
 *   - sync 동작 (better-sqlite3) 이지만 Promise<X> 로 API 파리티 유지 (M2-2 어댑터 / 호출자 호환).
 *   - workspace_id 'default' string 입력 시 defaultWorkspaceId (real UUID) 로 자동 매핑.
 *   - maxBytes LRU trim 미적용 (SQLite 가 자체적으로 처리 — 필요 시 VACUUM/PRAGMA 별도).
 *
 * 후속 PR 의존:
 *   - M3-6 migrations/v03_to_v04 — JSON IndexedPageStore → 본 모듈로 데이터 이전
 *   - M4 IndexingService — did-finish-load → 본 모듈 recordVisit
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'
import type {
  Page,
  Visit,
  UpsertPageInput,
  UpsertAction,
  UpsertPageResult,
  CreateVisitInput,
  RecordVisitInput,
  RecordVisitResult,
  IndexedPageStats
} from './IndexedPageStore'
import { DEFAULT_WORKSPACE_ID, normalizeIndexedUrl, contentHashOf } from './IndexedPageStore'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

interface PageRow {
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

interface VisitRow {
  id: string
  page_id: string
  workspace_id: string
  visited_at: number
  dwell_ms: number
}

export interface IndexedPageStoreSqliteOptions {
  /** "📥 기본" 워크스페이스 UUID — JSON mode 'default' 문자열 매핑 대상 */
  defaultWorkspaceId: string
}

export class IndexedPageStoreSqlite {
  private readonly db: BetterSqliteNamespace.Database
  private readonly defaultWorkspaceId: string

  private readonly stmtFindPageByUrl: Stmt<PageRow>
  private readonly stmtFindPageById: Stmt<PageRow>
  private readonly stmtInsertPage: Stmt
  private readonly stmtUpdatePageVisited: Stmt // 본문 변경 없음 (visited_count++ 만)
  private readonly stmtUpdatePageChanged: Stmt // 본문 변경 (content/hash/title/lang/visited_count/updated_at)
  private readonly stmtInsertVisit: Stmt
  private readonly stmtListVisitsByPage: Stmt<VisitRow>
  private readonly stmtCountPagesAll: Stmt<{ c: number }>
  private readonly stmtCountPagesByWs: Stmt<{ c: number }>
  private readonly stmtCountVisitsAll: Stmt<{ c: number }>
  private readonly stmtCountVisitsByWs: Stmt<{ c: number }>
  private readonly stmtStatsPages: Stmt<{ workspace_id: string; n: number }>
  private readonly stmtStatsVisits: Stmt<{ workspace_id: string; n: number }>
  private readonly stmtDeletePagesByWs: Stmt
  private readonly stmtDeleteAllPages: Stmt
  private readonly stmtUpdateVisitDwell: Stmt // M4-3 — DwellTracker.stop() → Visit.dwell_ms UPDATE
  private readonly stmtFindVisitById: Stmt<VisitRow>
  private readonly stmtMaxVisitedAtByWs: Stmt<{ t: number | null }> // M6 T29 — 마지막 인덱싱 시간
  private readonly recordVisitTxn: (input: NormalizedRecordVisit) => RecordVisitResult

  constructor(fb: FlowbrowserDatabase, opts: IndexedPageStoreSqliteOptions) {
    if (!opts.defaultWorkspaceId) {
      throw new Error('IndexedPageStoreSqlite: defaultWorkspaceId required')
    }
    this.db = fb.getDb()
    this.defaultWorkspaceId = opts.defaultWorkspaceId
    this.stmtFindPageByUrl = this.db.prepare(
      `SELECT id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at
       FROM pages WHERE workspace_id = ? AND url = ?`
    )
    this.stmtFindPageById = this.db.prepare(
      `SELECT id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at
       FROM pages WHERE id = ?`
    )
    this.stmtInsertPage = this.db.prepare(
      `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.stmtUpdatePageVisited = this.db.prepare(
      `UPDATE pages SET visited_count = visited_count + 1 WHERE id = ?`
    )
    this.stmtUpdatePageChanged = this.db.prepare(
      `UPDATE pages SET title = ?, content = ?, content_hash = ?, lang = ?,
              visited_count = visited_count + 1, updated_at = ? WHERE id = ?`
    )
    this.stmtInsertVisit = this.db.prepare(
      `INSERT INTO visits(id, page_id, workspace_id, visited_at, dwell_ms)
       VALUES (?, ?, ?, ?, ?)`
    )
    this.stmtListVisitsByPage = this.db.prepare(
      `SELECT id, page_id, workspace_id, visited_at, dwell_ms FROM visits
       WHERE page_id = ? ORDER BY visited_at ASC`
    )
    this.stmtCountPagesAll = this.db.prepare('SELECT COUNT(*) AS c FROM pages')
    this.stmtCountPagesByWs = this.db.prepare(
      'SELECT COUNT(*) AS c FROM pages WHERE workspace_id = ?'
    )
    this.stmtCountVisitsAll = this.db.prepare('SELECT COUNT(*) AS c FROM visits')
    this.stmtCountVisitsByWs = this.db.prepare(
      'SELECT COUNT(*) AS c FROM visits WHERE workspace_id = ?'
    )
    this.stmtStatsPages = this.db.prepare(
      'SELECT workspace_id, COUNT(*) AS n FROM pages GROUP BY workspace_id'
    )
    this.stmtStatsVisits = this.db.prepare(
      'SELECT workspace_id, COUNT(*) AS n FROM visits GROUP BY workspace_id'
    )
    this.stmtDeletePagesByWs = this.db.prepare('DELETE FROM pages WHERE workspace_id = ?')
    this.stmtDeleteAllPages = this.db.prepare('DELETE FROM pages')
    this.stmtUpdateVisitDwell = this.db.prepare(
      'UPDATE visits SET dwell_ms = ? WHERE id = ?'
    )
    this.stmtFindVisitById = this.db.prepare(
      'SELECT id, page_id, workspace_id, visited_at, dwell_ms FROM visits WHERE id = ?'
    )
    this.stmtMaxVisitedAtByWs = this.db.prepare(
      'SELECT MAX(visited_at) AS t FROM visits WHERE workspace_id = ?'
    )
    // 단일 TX — PRD §05.4.1 정합. upsertPage + createVisit 원자 처리.
    this.recordVisitTxn = this.db.transaction(
      (input: NormalizedRecordVisit): RecordVisitResult => {
        const upsert = this.upsertPageInternal(input)
        const visit = this.createVisitInternal({
          page_id: upsert.page.id,
          workspace_id: upsert.page.workspace_id,
          dwell_ms: input.dwell_ms,
          visited_at: input.visited_at
        })
        return { page: upsert.page, visit, action: upsert.action }
      }
    )
  }

  /** FlowbrowserDatabase 가 schema 준비를 책임지므로 본 호출은 no-op. */
  async load(): Promise<void> {
    // intentionally empty — IndexedPageStore (JSON) API 파리티
  }

  async upsertPage(input: UpsertPageInput): Promise<UpsertPageResult> {
    return this.upsertPageInternal(this.normalizeUpsert(input))
  }

  async recordVisit(input: RecordVisitInput): Promise<RecordVisitResult> {
    return this.recordVisitTxn(this.normalizeRecord(input))
  }

  async createVisit(input: CreateVisitInput): Promise<Visit> {
    const page = this.stmtFindPageById.get(input.page_id)
    if (!page) {
      throw new Error(
        `IndexedPageStoreSqlite.createVisit: page not found id=${input.page_id}`
      )
    }
    const workspace_id = this.mapWorkspace(input.workspace_id ?? page.workspace_id)
    if (workspace_id !== page.workspace_id) {
      throw new Error(
        `IndexedPageStoreSqlite.createVisit: workspace mismatch (page=${page.workspace_id} vs visit=${workspace_id})`
      )
    }
    return this.createVisitInternal({
      page_id: page.id,
      workspace_id,
      dwell_ms: input.dwell_ms,
      visited_at: input.visited_at
    })
  }

  lookupPage(workspace_id: string, url: string): Page | null {
    const wsId = this.mapWorkspace(workspace_id)
    const normalized = normalizeIndexedUrl(url)
    const row = this.stmtFindPageByUrl.get(wsId, normalized)
    return row ? rowToPage(row) : null
  }

  getPage(id: string): Page | null {
    const row = this.stmtFindPageById.get(id)
    return row ? rowToPage(row) : null
  }

  listVisits(page_id: string): Visit[] {
    return this.stmtListVisitsByPage.all(page_id).map(rowToVisit)
  }

  /**
   * Sprint 015 M4-3 — DwellTracker.stop() 결과를 Visit.dwell_ms 에 영속.
   * 음수 허용 X (clamp to 0). visit 미존재 시 false 반환 (호출자가 stale visit 케이스 판단).
   */
  updateVisitDwell(visitId: string, dwellMs: number): boolean {
    const clamped = Math.max(0, Math.floor(dwellMs))
    const result = this.stmtUpdateVisitDwell.run(clamped, visitId)
    return result.changes > 0
  }

  getVisit(visitId: string): Visit | null {
    const row = this.stmtFindVisitById.get(visitId)
    return row ? rowToVisit(row) : null
  }

  /**
   * Sprint 015 M6 T29 — 워크스페이스 내 visit 가장 최근 timestamp (epoch ms).
   * visits 0건이면 null (MemoryStatsPanel 이 "—" 표시).
   */
  lastVisitedAt(workspace_id: string): number | null {
    const wsId = this.mapWorkspace(workspace_id)
    const row = this.stmtMaxVisitedAtByWs.get(wsId)
    return row?.t ?? null
  }

  countPages(workspace_id?: string): number {
    if (workspace_id === undefined) return this.stmtCountPagesAll.get()!.c
    return this.stmtCountPagesByWs.get(this.mapWorkspace(workspace_id))!.c
  }

  countVisits(workspace_id?: string): number {
    if (workspace_id === undefined) return this.stmtCountVisitsAll.get()!.c
    return this.stmtCountVisitsByWs.get(this.mapWorkspace(workspace_id))!.c
  }

  stats(): IndexedPageStats {
    const perWorkspace: Record<string, { pages: number; visits: number }> = {}
    for (const r of this.stmtStatsPages.all()) {
      const slot = (perWorkspace[r.workspace_id] ??= { pages: 0, visits: 0 })
      slot.pages = r.n
    }
    for (const r of this.stmtStatsVisits.all()) {
      const slot = (perWorkspace[r.workspace_id] ??= { pages: 0, visits: 0 })
      slot.visits = r.n
    }
    const pages = this.stmtCountPagesAll.get()!.c
    const visits = this.stmtCountVisitsAll.get()!.c
    return { pages, visits, perWorkspace }
  }

  async deleteByWorkspace(workspace_id: string): Promise<{ pages: number; visits: number }> {
    const wsId = this.mapWorkspace(workspace_id)
    // visits CASCADE 동반 — 단일 TX 로 묶음
    const txn = this.db.transaction((): { pages: number; visits: number } => {
      const beforeVisits = this.stmtCountVisitsByWs.get(wsId)!.c
      const result = this.stmtDeletePagesByWs.run(wsId)
      const afterVisits = this.stmtCountVisitsByWs.get(wsId)!.c
      return { pages: result.changes, visits: beforeVisits - afterVisits }
    })
    return txn()
  }

  async clearAll(): Promise<void> {
    this.stmtDeleteAllPages.run()
  }

  /** sync 동작이라 no-op. JSON mode flush() API 파리티. */
  async flush(): Promise<void> {
    // intentionally empty
  }

  /**
   * `DEFAULT_WORKSPACE_ID` ('default') 문자열을 실 UUID 로 매핑.
   * 그 외 입력은 그대로 통과 (호출자가 real UUID 주입한 경우).
   */
  private mapWorkspace(id: string | undefined): string {
    if (!id || id === DEFAULT_WORKSPACE_ID) return this.defaultWorkspaceId
    return id
  }

  private normalizeUpsert(input: UpsertPageInput): NormalizedUpsert {
    const url = normalizeIndexedUrl(input.url)
    if (!url) {
      throw new Error('IndexedPageStoreSqlite.upsertPage: url required')
    }
    return {
      workspace_id: this.mapWorkspace(input.workspace_id),
      url,
      title: input.title ?? '',
      content: input.content ?? '',
      lang: input.lang ?? null
    }
  }

  private normalizeRecord(input: RecordVisitInput): NormalizedRecordVisit {
    return {
      ...this.normalizeUpsert(input),
      dwell_ms: input.dwell_ms,
      visited_at: input.visited_at
    }
  }

  /** 본 메서드는 TX 외부 / 내부 모두에서 호출 가능. */
  private upsertPageInternal(input: NormalizedUpsert): UpsertPageResult {
    const existing = this.stmtFindPageByUrl.get(input.workspace_id, input.url)
    const hash = contentHashOf(input.content)
    const now = Date.now()
    if (existing) {
      const sameContent = existing.content_hash === hash
      const action: UpsertAction = sameContent ? 'unchanged' : 'updated_changed'
      if (sameContent) {
        this.stmtUpdatePageVisited.run(existing.id)
      } else {
        this.stmtUpdatePageChanged.run(
          input.title,
          input.content,
          hash,
          input.lang,
          now,
          existing.id
        )
      }
      const next = this.stmtFindPageById.get(existing.id)!
      return { page: rowToPage(next), action }
    }
    const id = randomUUID()
    this.stmtInsertPage.run(
      id,
      input.workspace_id,
      input.url,
      input.title,
      input.content,
      hash,
      input.lang,
      1,
      now,
      now
    )
    const row = this.stmtFindPageById.get(id)!
    return { page: rowToPage(row), action: 'created' }
  }

  private createVisitInternal(input: {
    page_id: string
    workspace_id: string
    dwell_ms?: number
    visited_at?: number
  }): Visit {
    const visit: Visit = {
      id: randomUUID(),
      page_id: input.page_id,
      workspace_id: input.workspace_id,
      visited_at: input.visited_at ?? Date.now(),
      dwell_ms: input.dwell_ms ?? 0
    }
    this.stmtInsertVisit.run(
      visit.id,
      visit.page_id,
      visit.workspace_id,
      visit.visited_at,
      visit.dwell_ms
    )
    return visit
  }
}

interface NormalizedUpsert {
  workspace_id: string
  url: string
  title: string
  content: string
  lang: string | null
}

interface NormalizedRecordVisit extends NormalizedUpsert {
  dwell_ms?: number
  visited_at?: number
}

function rowToPage(r: PageRow): Page {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    url: r.url,
    title: r.title,
    content: r.content,
    content_hash: r.content_hash,
    lang: r.lang,
    visited_count: r.visited_count,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

function rowToVisit(r: VisitRow): Visit {
  return {
    id: r.id,
    page_id: r.page_id,
    workspace_id: r.workspace_id,
    visited_at: r.visited_at,
    dwell_ms: r.dwell_ms
  }
}
