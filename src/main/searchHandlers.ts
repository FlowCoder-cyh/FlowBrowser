/**
 * Sprint 015 M5-3b — search IPC handler pure logic.
 *
 * `services.ts` 의 `search:query` / `search:get-content` IPC handler 를 pure 함수로 추출.
 * 단위 테스트 가능 — Electron `ipcMain` 의존 없음.
 *
 * 책임:
 *   1. handleSearchQuery — TimeRangeParser → EmbeddingClient.embedText → SearchService.search → paginate → SearchResultPayload 매핑
 *   2. handleSearchGetContent — IndexedPageStoreSqlite.getPage(pageId) → { content, title, url }
 *
 * 의존 주입 — 호출자 (services.ts) 가 모든 의존을 lazy resolver 로 주입.
 * provider 미초기화 / search 인프라 미초기화 케이스에서 graceful error 반환.
 */

import type { ProviderAdapter } from '../ai/ProviderAdapter'
import { EmbeddingClient } from '../ai/embedding/EmbeddingClient'
// Sprint 018 M2 T17b — 워크스페이스 embedding_model → 검색 query 임베딩 모델/차원 해소 (Schema v06 spec §5.2 query path 소유).
import { resolveEmbeddingModel } from '../storage/embeddingModel'
import { parseTimeRange } from './TimeRangeParser'
import {
  SearchService,
  paginate,
  type SearchHit,
  DEFAULT_TOP_K
} from './SearchService'
import type { IndexedPageStoreSqlite } from '../storage/IndexedPageStoreSqlite'
import { buildExcerpt, type ExcerptMatch } from './excerpt'

export interface SearchResultPayload {
  pageId: string
  type: 'page' | 'note'
  title: string
  url: string
  visitedAt: number
  dwellMs: number
  excerpt: string
  /**
   * Sprint 015 M5-4 — excerpt 내 query 토큰 매칭 위치 (start inclusive / end exclusive).
   * renderer 가 `<mark>` 로 highlight (PRD §9.5.2 매칭 발췌 알고리즘 정합).
   * 매칭 0 건 (시간 표현만 입력 등) 시 빈 배열.
   */
  matchPositions: ExcerptMatch[]
  score: number
}

export type SearchQueryStatus = 'ok' | 'empty' | 'error'

export interface SearchQueryResponse {
  results: SearchResultPayload[]
  status: SearchQueryStatus
  error?: string
  /** 적용된 시간 필터 (TimeRangeParser 매칭 시점). null = 시간 표현 없음. */
  timeRange?: { from: number; to: number } | null
  /** 매칭된 원본 시간 표현 ("지난주" 등). UI 표시 용. */
  matchedTimeExpression?: string | null
}

export interface SearchQueryArgs {
  query: string
  topN?: number
}

/** search:query 의존 주입. 호출 시점마다 새로 풀어옴 (provider 변경 / DB 미초기화 대응). */
export interface SearchQueryDeps {
  /** default workspace UUID. M6 워크스페이스 사이드바 도입 전까지는 항상 default. */
  getActiveWorkspaceId(): string | null
  /** OpenAI provider (BYOK 디폴트 — G-003 강화) — query embedding 호출용. 미초기화 시 null. */
  getEmbeddingProvider(): ProviderAdapter | null
  /** SearchService — 인프라 (FlowbrowserDatabase / VectorIndex / ...) 미초기화 시 null. */
  getSearchService(): SearchService | null
  /**
   * Sprint 018 M2 T17b — 워크스페이스 embedding_model full id (`'<provider>:<model>:<dim>'`).
   * query path 가 dimension 을 해소해 vec0 테이블을 선택 (Schema v06 spec §5.2). 미주입/null 시 디폴트(1024) 사용.
   * (T17c 에서 provider 선택까지 확장 — 현재는 dimension 해소만, provider 는 getEmbeddingProvider 고정.)
   */
  getWorkspaceEmbeddingModel?(workspaceId: string): string | null
  /** deterministic 테스트용 — 시간 가중치 기준 시각. 미주입 시 Date.now(). */
  now?: () => number
}

/** PRD §9.5.1 매칭 발췌 — M5-4 책임. 본 PR 은 단순 truncate. */
const EXCERPT_LENGTH = 200
/** PRD §9.7 디폴트 표시 개수. SearchBar (M5-1) 가 `topN: 10` 으로 호출. */
const DEFAULT_PAGE_SIZE = 10

export async function handleSearchQuery(
  args: SearchQueryArgs,
  deps: SearchQueryDeps
): Promise<SearchQueryResponse> {
  const now = deps.now ? deps.now() : Date.now()
  const rawQuery = (args.query ?? '').trim()
  const topN = args.topN && args.topN > 0 ? Math.floor(args.topN) : DEFAULT_PAGE_SIZE

  if (rawQuery.length === 0) {
    return { results: [], status: 'empty' }
  }

  // 1. TimeRangeParser — 자연어 시간 추출
  const parsed = parseTimeRange(rawQuery, { now })
  const semanticQuery = parsed.remainingQuery.trim() || rawQuery

  // 2. workspace_id — 활성 워크스페이스 (현재 default 만)
  const workspaceId = deps.getActiveWorkspaceId()
  if (!workspaceId) {
    return {
      results: [],
      status: 'error',
      error: '워크스페이스가 초기화되지 않았습니다.'
    }
  }

  // 3. 인프라 가용성
  const service = deps.getSearchService()
  if (!service) {
    return {
      results: [],
      status: 'error',
      error: '검색 인덱스가 아직 준비되지 않았습니다.'
    }
  }

  // 4. embedding provider — BYOK 디폴트 (G-003 강화). Codex OAuth 는 embed 미지원.
  const provider = deps.getEmbeddingProvider()
  if (!provider) {
    return {
      results: [],
      status: 'error',
      error: 'OpenAI API Key 가 등록되지 않았습니다. 설정에서 등록해 주세요.'
    }
  }
  if (!provider.embed) {
    return {
      results: [],
      status: 'error',
      error: `Provider ${provider.info.providerType} 는 임베딩을 지원하지 않습니다. OpenAI API Key 로 변경해 주세요.`
    }
  }

  // 5. 워크스페이스 embedding_model 해소 — query embedding _전_ (Schema v06 spec §5.2, codex 019e6898 BLOCKING).
  //    modelHint/dimensions 를 EmbeddingClient 에 넘겨 올바른 차원으로 query embedding 생성 + 같은 dim 으로 vec0 테이블 선택.
  //    미주입(레거시 deps)/null 시 디폴트(OpenAI 1024). 미지원 모델 id 는 throw → error 응답.
  //    provider 어댑터 매핑(openai vs ollama)은 T17c 위임 — 본 단계는 modelHint/dimensions threading.
  let modelSpec
  try {
    modelSpec = resolveEmbeddingModel(
      deps.getWorkspaceEmbeddingModel ? deps.getWorkspaceEmbeddingModel(workspaceId) : null
    )
  } catch (err) {
    return {
      results: [],
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // 6. query embedding — 워크스페이스 모델/차원으로 생성.
  let queryEmbedding
  try {
    const client = new EmbeddingClient({
      provider,
      modelHint: modelSpec.model,
      dimensions: modelSpec.dimensions
    })
    const result = await client.embedText(semanticQuery)
    queryEmbedding = result.vector
  } catch (err) {
    return {
      results: [],
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // 7. SearchService.search — topK = max(topN, DEFAULT_TOP_K) (PRD §9.7 내부 retrieval 디폴트 20)
  //    워크스페이스 dim 으로 vec0 테이블 선택 (query embedding 과 동일 차원).
  const dimensions = modelSpec.dimensions
  const topK = Math.max(topN, DEFAULT_TOP_K)
  let hits: SearchHit[]
  try {
    hits = service.search({
      workspaceId,
      queryEmbedding,
      topK,
      timeRange: parsed.range,
      now,
      dimensions
    })
  } catch (err) {
    return {
      results: [],
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // 8. paginate — pageIndex=0, pageSize=topN (PRD §9.8 1차 표시)
  const paged = paginate(hits, 0, topN)
  // 9. SearchResultPayload 매핑 — 매칭 발췌는 의미 검색 query (remainingQuery) 기준
  //    시간 표현 ("지난주") 만 입력 시 semanticQuery = rawQuery (fallback) — 매칭 0 건 가능
  const results = paged.hits.map((hit) => hitToPayload(hit, semanticQuery))

  return {
    results,
    status: results.length === 0 ? 'empty' : 'ok',
    timeRange: parsed.range,
    matchedTimeExpression: parsed.matched
  }
}

export interface SearchGetContentArgs {
  pageId: string
}

export interface SearchGetContentDeps {
  pageStore: IndexedPageStoreSqlite | null
}

export function handleSearchGetContent(
  args: SearchGetContentArgs,
  deps: SearchGetContentDeps
): { content: string; title: string; url: string } | null {
  if (!deps.pageStore) return null
  if (!args.pageId) return null
  const page = deps.pageStore.getPage(args.pageId)
  if (!page) return null
  return {
    content: page.content,
    title: page.title,
    url: page.url
  }
}

function hitToPayload(hit: SearchHit, semanticQuery: string): SearchResultPayload {
  // type='note' 시 자신 noteId 를 pageId 컬럼에 노출 (SearchBar 가 navigate 시 url 만 사용 → pageId 는 식별자 역할).
  // type='page' 시 자신 pageId 노출. anchor page 가 없는 글로사리 노트는 url=''.
  const identifier = hit.type === 'page' ? hit.pageId : hit.noteId
  // M5-4 매칭 발췌 — PRD §9.5.2 ±100 자 + matchPositions (renderer 가 <mark> highlight)
  const { text, matchPositions } = buildExcerpt(hit.contentSnippet, semanticQuery, {
    windowSize: EXCERPT_LENGTH / 2
  })
  return {
    pageId: identifier ?? '',
    type: hit.type,
    title: hit.title,
    url: hit.url,
    visitedAt: hit.visitedAt ?? 0,
    dwellMs: hit.dwellMs,
    excerpt: text,
    matchPositions,
    score: hit.score
  }
}
