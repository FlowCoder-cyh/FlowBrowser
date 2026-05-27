/**
 * Sprint 015 M5-3a — SearchService.
 *
 * PRD §9 검색 파이프라인 — Page + Note 결합 retrieval + 시간 필터 + 정렬 공식.
 *
 * 책임:
 *   1. VectorIndex.searchPages / searchNotes — top-K KNN (sqlite-vec MATCH, workspace_id partition)
 *   2. Page / Visit / Note metadata fetch (IndexedPageStoreSqlite + NoteStore)
 *   3. 시간 필터 — Page 는 매칭되는 Visit 존재 검증, Note 는 anchor visit 또는 created_at 기준
 *   4. 정렬 공식: score = α × cosine_sim + β × exp(-daysAgo / eFoldingDays)
 *      (PRD §9.4 — α=0.85 / β=0.15 / eFoldingDays=180 디폴트)
 *
 * pure logic — IPC wiring 없음. M5-3b 가 search:query / search:get-content IPC wiring 책임.
 *
 * 의존 주입:
 *   - VectorIndex (M3-2) — sqlite-vec KNN
 *   - IndexedPageStoreSqlite (M3-3) — Page + Visit metadata
 *   - NoteStore (M3-4) — Note metadata
 *
 * 가정:
 *   - vec_pages / vec_notes 가 `distance_metric=cosine` 으로 정의됨 (PRD §9.4 정정 — L2 사용 시 score scale 깨짐)
 *   - queryEmbedding 은 1024 차원 (EMBEDDING_DIMENSIONS) — 위반 시 VectorIndex 가 throw
 *   - workspace_id partition 은 VectorIndex 가 강제 (다른 워크스페이스 누설 차단)
 *
 * Pagination 호출자 책임:
 *   - 1차 호출: topK=20 → 호출자가 slice(0, 10) 표시
 *   - 더 보기: topK=50 → 호출자가 slice(20, 50) 표시 (PRD §9.8 — 최대 50)
 */

import { EMBEDDING_DIMENSIONS } from '../storage/VectorIndex'
import type { EmbeddingInput, VectorIndex } from '../storage/VectorIndex'
import type { IndexedPageStoreSqlite } from '../storage/IndexedPageStoreSqlite'
import type { NoteRow, NoteStore } from '../storage/NoteStore'
import type { Page, Visit } from '../storage/IndexedPageStore'

/** PRD §9.4 정렬 공식 파라미터 디폴트. */
const DEFAULT_ALPHA = 0.85
const DEFAULT_BETA = 0.15
const DEFAULT_E_FOLDING_DAYS = 180
const MS_PER_DAY = 86_400_000
/** PRD §9.7 — Phase 1 디폴트 top-k. */
export const DEFAULT_TOP_K = 20

export type SearchHitType = 'page' | 'note'

/** TimeRangeParser (M5-2) 결과 호환 — null/undefined 둘 다 "시간 필터 없음" 신호. */
export interface SearchTimeRange {
  /** 시작 timestamp (ms epoch). null = 무제한. */
  from?: number | null
  /** 종료 timestamp (ms epoch). null = 무제한. */
  to?: number | null
}

export interface SearchOptions {
  /** 현재 활성 워크스페이스 UUID. VectorIndex partition key. */
  workspaceId: string
  /** 질의 임베딩 (1024 차원). EmbeddingClient.embedText() 결과. */
  queryEmbedding: EmbeddingInput
  /** Phase 1 디폴트 20 (PRD §9.7). 호출자 Pagination 단계에 따라 20 / 50 주입. */
  topK?: number
  /** TimeRangeParser 결과. null / undefined = 시간 필터 미적용. */
  timeRange?: SearchTimeRange | null
  /** deterministic 테스트용 — daysAgo 기준 시각. 미주입 시 Date.now(). */
  now?: number
  /**
   * Sprint 018 M2 T17b — 워크스페이스 embedding_model 차원 (vec0 테이블 선택 기준).
   * 호출자(searchHandlers)가 워크스페이스 embedding_model 로 해소해 전달 (Schema v06 spec §5.2 — query path 소유).
   * SearchService 자체는 branching owner 아님 (VectorIndex 로 passthrough).
   *
   * 미주입 시 디폴트 1024 — **직접 호출 테스트 편의용 fallback** (프로덕션 searchHandlers 는 항상 명시 전달).
   * silent corruption 아님: VectorIndex.searchPages 가 queryEmbedding length ≠ dim 시 throw (codex 019e6898 NOTABLE).
   */
  dimensions?: number
}

export interface SearchHit {
  type: SearchHitType
  /** type='page' 시 자신 page_id, type='note' 시 노트 anchor page_id (글로사리 마이그레이션 노트는 null). */
  pageId: string | null
  /** type='note' 시 자신 note_id. type='page' 시 null. */
  noteId: string | null
  /** Page 매칭 Visit id (Note 는 anchor visit_id, 글로사리 마이그레이션 노트는 null). */
  visitId: string | null
  workspaceId: string
  /** cosine_sim = 1 - distance. */
  cosineSim: number
  /** vec0 raw distance — 디버그 / 회귀 진단용. */
  distance: number
  /** Visit.visited_at 또는 Note.created_at (anchor visit 부재 시 fallback). null 가능. */
  visitedAt: number | null
  /** (now - visitedAt) / MS_PER_DAY. visitedAt null 시 null. */
  daysAgo: number | null
  /** exp(-daysAgo / eFoldingDays). visitedAt null 시 0 (시간 가중 0 처리). */
  timeFactor: number
  /** α × cosineSim + β × timeFactor. */
  score: number
  /** 매칭 Visit.dwell_ms. visit 부재 시 0. */
  dwellMs: number
  title: string
  url: string
  /** Page.content 전체 또는 Note 본문 (selected_text + body 결합). 매칭 발췌는 M5-4 책임. */
  contentSnippet: string
}

export interface SearchServiceOptions {
  vectorIndex: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  /** 정렬 공식 가중치 / 시간 상수 override (테스트 / 튜닝). 미주입 시 PRD §9.4 디폴트. */
  alpha?: number
  beta?: number
  eFoldingDays?: number
}

export class SearchService {
  private readonly vec: VectorIndex
  private readonly pageStore: IndexedPageStoreSqlite
  private readonly noteStore: NoteStore
  private readonly alpha: number
  private readonly beta: number
  private readonly eFoldingDays: number

  constructor(opts: SearchServiceOptions) {
    this.vec = opts.vectorIndex
    this.pageStore = opts.pageStore
    this.noteStore = opts.noteStore
    this.alpha = opts.alpha ?? DEFAULT_ALPHA
    this.beta = opts.beta ?? DEFAULT_BETA
    this.eFoldingDays = opts.eFoldingDays ?? DEFAULT_E_FOLDING_DAYS
    if (!(this.eFoldingDays > 0)) {
      throw new Error(
        `SearchService: eFoldingDays must be > 0 (got ${this.eFoldingDays})`
      )
    }
  }

  /**
   * 단일 검색 호출. Page + Note 결합 retrieval → 시간 필터 → 정렬 (score 내림차순).
   *
   * 시간 필터:
   *   - timeRange null/undefined → 미적용 (모든 retrieval 결과 통과)
   *   - timeRange.from null → from 무제한 (오래된 결과 통과)
   *   - timeRange.to null → to 무제한 (미래 결과 통과)
   *   - Page: 매칭 Visit (visited_at ∈ [from, to]) 가 1건 이상 있어야 결과 포함. 최신 매칭 Visit 사용.
   *   - Note: anchor Visit 의 visited_at (visit_id null 시 created_at) 기준 매칭.
   */
  search(opts: SearchOptions): SearchHit[] {
    const topK = opts.topK ?? DEFAULT_TOP_K
    if (!Number.isInteger(topK) || topK < 1) {
      throw new Error(`SearchService.search: topK must be positive integer (got ${topK})`)
    }
    const now = opts.now ?? Date.now()
    const range = opts.timeRange ?? null
    // Sprint 018 M2 T17b — dimension passthrough (호출자 해소). 미주입 시 디폴트 1024.
    const dimensions = opts.dimensions ?? EMBEDDING_DIMENSIONS

    const pageResults = this.vec.searchPages(opts.workspaceId, opts.queryEmbedding, topK, dimensions)
    const noteResults = this.vec.searchNotes(opts.workspaceId, opts.queryEmbedding, topK, dimensions)

    const hits: SearchHit[] = []

    for (const r of pageResults) {
      const page = this.pageStore.getPage(r.id)
      if (!page) continue
      const visits = this.pageStore.listVisits(page.id)
      const matched = this.pickMatchingVisit(visits, range)
      if (range && !matched) continue
      hits.push(this.buildPageHit(page, matched, r.distance, now))
    }

    for (const r of noteResults) {
      const note = this.noteStore.findById(r.id)
      if (!note) continue
      const visit = note.visit_id !== null ? this.pageStore.getVisit(note.visit_id) : null
      const anchorPage = note.page_id !== null ? this.pageStore.getPage(note.page_id) : null
      const timeRef = visit?.visited_at ?? note.created_at
      if (range && !inRange(timeRef, range)) continue
      hits.push(this.buildNoteHit(note, visit, anchorPage, r.distance, now))
    }

    hits.sort((a, b) => b.score - a.score)
    return hits
  }

  /**
   * 시간 필터에 적합한 가장 최근 visit.
   * range 미주입 시 가장 최근 visit. range 주입 시 매칭 visit 중 최신 — 없으면 null.
   */
  private pickMatchingVisit(visits: Visit[], range: SearchTimeRange | null): Visit | null {
    let best: Visit | null = null
    for (const v of visits) {
      if (range && !inRange(v.visited_at, range)) continue
      if (!best || v.visited_at > best.visited_at) best = v
    }
    return best
  }

  private buildPageHit(
    page: Page,
    visit: Visit | null,
    distance: number,
    now: number
  ): SearchHit {
    const cosineSim = 1 - distance
    const visitedAt = visit?.visited_at ?? null
    const daysAgo = visitedAt !== null ? (now - visitedAt) / MS_PER_DAY : null
    const timeFactor = daysAgo !== null ? Math.exp(-daysAgo / this.eFoldingDays) : 0
    const score = this.alpha * cosineSim + this.beta * timeFactor
    return {
      type: 'page',
      pageId: page.id,
      noteId: null,
      visitId: visit?.id ?? null,
      workspaceId: page.workspace_id,
      cosineSim,
      distance,
      visitedAt,
      daysAgo,
      timeFactor,
      score,
      dwellMs: visit?.dwell_ms ?? 0,
      title: page.title,
      url: page.url,
      contentSnippet: page.content
    }
  }

  private buildNoteHit(
    note: NoteRow,
    visit: Visit | null,
    anchorPage: Page | null,
    distance: number,
    now: number
  ): SearchHit {
    const cosineSim = 1 - distance
    const visitedAt = visit?.visited_at ?? note.created_at
    const daysAgo = (now - visitedAt) / MS_PER_DAY
    const timeFactor = Math.exp(-daysAgo / this.eFoldingDays)
    const score = this.alpha * cosineSim + this.beta * timeFactor
    return {
      type: 'note',
      pageId: note.page_id,
      noteId: note.id,
      visitId: note.visit_id,
      workspaceId: note.workspace_id,
      cosineSim,
      distance,
      visitedAt,
      daysAgo,
      timeFactor,
      score,
      dwellMs: visit?.dwell_ms ?? 0,
      title: anchorPage?.title || note.selected_text.slice(0, 50),
      url: anchorPage?.url ?? '',
      contentSnippet: note.body
        ? `${note.selected_text}\n\n${note.body}`
        : note.selected_text
    }
  }
}

function inRange(ts: number, range: SearchTimeRange): boolean {
  if (range.from != null && ts < range.from) return false
  if (range.to != null && ts > range.to) return false
  return true
}

/**
 * Pagination 도우미 — PRD §9.8 정합.
 *
 * - page=0: 0..pageSize 표시 (디폴트 0..10)
 * - page=1: pageSize..(pageSize*4) (디폴트 10..40 → 30개 추가) — "더 보기" 1차
 * - page=2: (pageSize*4)..(pageSize*5) (디폴트 40..50) — 최대 50 도달
 * - cap 50 초과 시 maxReached=true 반환 (UX: "결과가 너무 많습니다. 시간 범위 추가")
 *
 * 호출자 책임: searchService.search({ topK: maxReached ? 50 : 20 }) — 또는 page 변동 시 topK 재계산.
 */
export const MAX_RESULTS = 50

export interface PagedSearchResult {
  hits: SearchHit[]
  pageIndex: number
  pageSize: number
  /** 다음 페이지 사용 가능 여부 (cap 미도달 + 다음 슬라이스 결과 존재). */
  hasMore: boolean
  /** 표시 가능 cap (50) 도달 — UX 권유 메시지 트리거. */
  maxReached: boolean
  /** 검색 결과 전체 (정렬 후, slice 전). 디버그 / metrics 입력. */
  totalRetrieved: number
}

/**
 * `paginate` — search() 결과를 표시 슬라이스로 변환.
 *
 * @param hits — search() 반환값 (이미 score 내림차순 정렬)
 * @param pageIndex — 0 = 첫 표시 (0..pageSize), 1 = "더 보기" 1차, 2 = 최대 cap 도달
 * @param pageSize — 디폴트 10 (PRD §9.8 "초기 표시 10")
 */
export function paginate(
  hits: SearchHit[],
  pageIndex: number,
  pageSize = 10
): PagedSearchResult {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error(`paginate: pageIndex must be non-negative integer (got ${pageIndex})`)
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`paginate: pageSize must be positive integer (got ${pageSize})`)
  }
  // page 0 → [0, pageSize), page 1 → [pageSize, pageSize*4), page>=2 → [pageSize*4, MAX_RESULTS)
  let start: number
  let end: number
  if (pageIndex === 0) {
    start = 0
    end = Math.min(pageSize, MAX_RESULTS)
  } else if (pageIndex === 1) {
    start = pageSize
    end = Math.min(pageSize * 4, MAX_RESULTS)
  } else {
    start = Math.min(pageSize * 4, MAX_RESULTS)
    end = MAX_RESULTS
  }
  const sliced = hits.slice(start, end)
  const totalAvailable = Math.min(hits.length, MAX_RESULTS)
  const hasMore = totalAvailable > end && end < MAX_RESULTS
  const maxReached = hits.length >= MAX_RESULTS
  return {
    hits: sliced,
    pageIndex,
    pageSize,
    hasMore,
    maxReached,
    totalRetrieved: hits.length
  }
}
