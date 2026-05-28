/**
 * Sprint 015 M5-3b — searchHandlers 단위 테스트.
 *
 * pure logic — Electron ipcMain 의존 없음. in-memory FlowbrowserDatabase + mock provider.
 *
 * cover:
 *   - handleSearchQuery 의 graceful error 5종 (empty query / workspace 미초기화 / service 미초기화 / provider 미등록 / provider embed 미지원)
 *   - TimeRangeParser 연결 — 시간 표현 매칭 시 timeRange + matchedTimeExpression 응답
 *   - EmbeddingClient.embedText 호출 후 SearchService.search 정합
 *   - paginate 1차 슬라이스 (pageIndex=0, pageSize=topN)
 *   - SearchResultPayload 매핑 (note 의 noteId 가 pageId 컬럼 노출 / excerpt truncate / visitedAt null 시 0 fallback)
 *   - handleSearchGetContent — page 존재 / 미존재 / pageStore null / 빈 pageId
 *
 * deterministic: now 주입 + 정규화 sparse vector + mock provider (provider.embed 결정성).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyV06Schema } from '../../helpers/v06Schema'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { NoteStore } from '../../../src/storage/NoteStore'
import { SearchService } from '../../../src/main/SearchService'
import { handleSearchQuery, handleSearchGetContent } from '../../../src/main/searchHandlers'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type {
  EmbedRequest,
  EmbedResponse,
  ProviderInfo
} from '../../../src/ai/types'

const MS_PER_DAY = 86_400_000

function makeVec(components: Record<number, number>): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
  for (const [idx, val] of Object.entries(components)) {
    v[Number(idx)] = val
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm
  }
  return v
}

function makeMockProvider(opts: {
  type?: ProviderInfo['providerType']
  supportsEmbed?: boolean
  embedVector?: Float32Array
  embedThrows?: Error
} = {}): ProviderAdapter {
  const type = opts.type ?? 'openai'
  const supportsEmbed = opts.supportsEmbed ?? true
  const provider: ProviderAdapter = {
    info: {
      providerType: type,
      displayName: `mock-${type}`,
      supportedRequestTypes: ['selection', 'explanation', 'summary'],
      defaultModel: 'mock-default',
      availableModels: ['mock-default'],
      supportsChat: true,
      supportsEmbed
    } as ProviderInfo,
    async validate() {
      return { ok: true }
    }
  }
  if (supportsEmbed) {
    provider.embed = async (req: EmbedRequest): Promise<EmbedResponse> => {
      if (opts.embedThrows) throw opts.embedThrows
      const vec = opts.embedVector ?? makeVec({ 0: 1 })
      return {
        vectors: req.texts.map(() => Array.from(vec)),
        modelUsed: req.modelHint ?? 'mock-embed',
        inputTokens: req.texts.join('').length,
        estimatedCostUsd: 0,
        durationMs: 1
      }
    }
  }
  return provider
}

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  service: SearchService
  workspaceId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb)
  const ws = fb.ensureDefaultWorkspace()
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const service = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  return { fb, vec, pageStore, noteStore, service, workspaceId: ws.id }
}

describe('handleSearchQuery — graceful error 매트릭스', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('빈 query → status=empty (workspace / provider 검사 skip)', async () => {
    const r = await handleSearchQuery(
      { query: '   ' },
      {
        getActiveWorkspaceId: () => null,
        getEmbeddingProvider: () => null,
        getSearchService: () => null
      }
    )
    expect(r.status).toBe('empty')
    expect(r.results).toEqual([])
  })

  it('workspace 미초기화 → status=error', async () => {
    const r = await handleSearchQuery(
      { query: 'hello' },
      {
        getActiveWorkspaceId: () => null,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/워크스페이스/)
  })

  it('SearchService 미초기화 → status=error', async () => {
    const r = await handleSearchQuery(
      { query: 'hello' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => null
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/검색 인덱스/)
  })

  it('OpenAI provider 미등록 → status=error (BYOK 가이드)', async () => {
    const r = await handleSearchQuery(
      { query: 'hello' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => null,
        getSearchService: () => fx.service
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/OpenAI API Key/)
  })

  it('provider.embed 미지원 (Codex) → status=error (G-003 강화)', async () => {
    const codex = makeMockProvider({ type: 'codex', supportsEmbed: false })
    const r = await handleSearchQuery(
      { query: 'hello' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => codex,
        getSearchService: () => fx.service
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/임베딩을 지원하지 않습니다/)
  })

  it('embed 호출 자체가 throw → status=error (catch 후 message 전달)', async () => {
    const provider = makeMockProvider({
      embedThrows: new Error('rate limit')
    })
    const r = await handleSearchQuery(
      { query: 'hello' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => provider,
        getSearchService: () => fx.service
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toBe('rate limit')
  })
})

describe('handleSearchQuery — happy path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('Page 1개 retrieval — status=ok, SearchResultPayload 매핑 정확', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://a.example',
      title: 'A',
      content: 'A 의 본문 내용',
      visited_at: now - MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const provider = makeMockProvider()
    const r = await handleSearchQuery(
      { query: 'foo', topN: 10 },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => provider,
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.status).toBe('ok')
    expect(r.results).toHaveLength(1)
    expect(r.results[0]).toMatchObject({
      pageId: page.id,
      type: 'page',
      title: 'A',
      url: 'https://a.example/',
      visitedAt: now - MS_PER_DAY,
      dwellMs: 0,
      excerpt: 'A 의 본문 내용'
    })
    expect(r.results[0].score).toBeGreaterThan(0)
    expect(r.timeRange).toBeNull()
    expect(r.matchedTimeExpression).toBeNull()
  })

  it('Note hit — noteId 가 pageId 컬럼에 노출, anchor page url 표시', async () => {
    const now = 1_000_000_000_000
    const { page, visit } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://anchor.example',
      title: 'Anchor',
      content: 'anchor body',
      visited_at: now - MS_PER_DAY
    })
    const note = fx.noteStore.create({
      workspace_id: fx.workspaceId,
      page_id: page.id,
      visit_id: visit.id,
      selected_text: 'note snippet',
      body: 'note body',
      created_at: now - MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const r = await handleSearchQuery(
      { query: 'foo' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.status).toBe('ok')
    expect(r.results[0]).toMatchObject({
      pageId: note.id, // 식별자 — note 시 noteId 노출
      type: 'note',
      title: 'Anchor',
      url: 'https://anchor.example/'
    })
  })

  it('TimeRangeParser 매칭 — timeRange + matchedTimeExpression 전달', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://recent.example',
      content: 'recent body',
      visited_at: now - 3 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const r = await handleSearchQuery(
      { query: '지난주 본 자료' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.status).toBe('ok')
    expect(r.results).toHaveLength(1)
    expect(r.timeRange).not.toBeNull()
    expect(r.matchedTimeExpression).toBe('지난주')
    expect(r.timeRange!.from).toBe(now - 7 * MS_PER_DAY)
    expect(r.timeRange!.to).toBe(now)
  })

  it('TimeRangeParser 매칭 + range 밖 페이지 제외', async () => {
    const now = 1_000_000_000_000
    const { page: pIn } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://in.example',
      content: 'in',
      visited_at: now - 3 * MS_PER_DAY
    })
    const { page: pOut } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://out.example',
      content: 'out',
      visited_at: now - 30 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(pIn.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)
    fx.vec.upsertPageEmbedding(pOut.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const r = await handleSearchQuery(
      { query: '지난주' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.results).toHaveLength(1)
    expect(r.results[0].pageId).toBe(pIn.id)
  })

  it('topN 디폴트 10 — 25개 페이지 등록 시 첫 10개만 반환 (PRD §9.8 1차 표시)', async () => {
    const now = 1_000_000_000_000
    for (let i = 0; i < 25; i++) {
      const { page } = await fx.pageStore.recordVisit({
        workspace_id: fx.workspaceId,
        url: `https://p-${i}.example`,
        content: `body ${i}`,
        visited_at: now - i * MS_PER_DAY
      })
      fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)
    }
    const r = await handleSearchQuery(
      { query: 'foo' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.results).toHaveLength(10)
  })

  it('topN 매개변수 — 호출자 지정 (5)', async () => {
    const now = 1_000_000_000_000
    for (let i = 0; i < 10; i++) {
      const { page } = await fx.pageStore.recordVisit({
        workspace_id: fx.workspaceId,
        url: `https://p-${i}.example`,
        content: `body ${i}`,
        visited_at: now - i * MS_PER_DAY
      })
      fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)
    }
    const r = await handleSearchQuery(
      { query: 'foo', topN: 5 },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.results).toHaveLength(5)
  })

  it('excerpt 200자 truncate (PRD §9.5.1 매칭 발췌는 M5-4 — 본 PR 은 단순 truncate)', async () => {
    const now = 1_000_000_000_000
    const longContent = 'a'.repeat(500)
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://long.example',
      content: longContent,
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const r = await handleSearchQuery(
      { query: 'foo' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    expect(r.results[0].excerpt).toHaveLength(200)
  })

  it('TimeRangeParser remainingQuery 빈 문자열 시 원본 query 의미 검색 (fallback)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://only-time.example',
      content: 'b',
      visited_at: now - 3 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, makeVec({ 0: 1 }), 1024)

    const r = await handleSearchQuery(
      { query: '지난주' }, // 시간 표현만 입력 → remainingQuery = ''
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        now: () => now
      }
    )
    // remainingQuery '' → 원본 query '지난주' 그대로 의미 검색 (provider mock 이 결정성 vector 반환)
    expect(r.status).toBe('ok')
    expect(r.results).toHaveLength(1)
  })
})

describe('Sprint 018 T17b — query path dimension 분기 (768 워크스페이스)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  /** 768-dim 정규화 벡터 (component 0 = 1). */
  function vec768(): Float32Array {
    const v = new Float32Array(768)
    v[0] = 1
    return v
  }

  it('embedding_model=ollama:768 → query embedding 이 768/nomic-embed-text 로 생성 + vec_pages_768 검색', async () => {
    // 768 워크스페이스 데이터 시드 (vec_pages_768).
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://ko.example',
      content: '한국어 본문',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(page.id, fx.workspaceId, vec768(), 768)

    // provider 가 req 를 캡처 + req.dimensions 만큼의 벡터 반환 (768 존중).
    let captured: EmbedRequest | null = null
    const provider768: ProviderAdapter = {
      info: makeMockProvider().info,
      async validate() {
        return { ok: true }
      },
      embed: async (req: EmbedRequest): Promise<EmbedResponse> => {
        captured = req
        const dim = req.dimensions ?? EMBEDDING_DIMENSIONS
        const v = new Array<number>(dim).fill(0)
        v[0] = 1
        return {
          vectors: req.texts.map(() => v),
          modelUsed: req.modelHint ?? 'mock',
          inputTokens: 1,
          estimatedCostUsd: 0,
          durationMs: 1
        }
      }
    }

    // Sprint 018 M2 T17c — ollama 워크스페이스는 'local' credential provider 가 선택돼야 함.
    let requestedProviderType: string | null = null
    const r = await handleSearchQuery(
      { query: '한국어' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: (providerType) => {
          requestedProviderType = providerType
          return provider768
        },
        getSearchService: () => fx.service,
        getWorkspaceEmbeddingModel: () => 'ollama:nomic-embed-text:768',
        now: () => now
      }
    )
    // T17c — ollama:768 → 'local' 어댑터 선택 (provider 고정 아님).
    expect(requestedProviderType).toBe('local')
    // query embedding 이 768 차원 + nomic-embed-text modelHint 로 요청됨 (분기가 cosmetic 아님).
    expect(captured).not.toBeNull()
    expect(captured!.dimensions).toBe(768)
    expect(captured!.modelHint).toBe('nomic-embed-text')
    // vec_pages_768 검색 결과로 시드 페이지 반환.
    expect(r.status).toBe('ok')
    expect(r.results).toHaveLength(1)
    expect(r.results[0].pageId).toBe(page.id)
  })

  it('embedding_model=openai:1024 → "openai" credential provider 선택', async () => {
    let requestedProviderType: string | null = null
    const r = await handleSearchQuery(
      { query: '질의' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: (providerType) => {
          requestedProviderType = providerType
          return makeMockProvider()
        },
        getSearchService: () => fx.service,
        getWorkspaceEmbeddingModel: () => 'openai:text-embedding-3-small:1024'
      }
    )
    expect(requestedProviderType).toBe('openai')
    expect(r.status).not.toBe('error')
  })

  it('ollama 워크스페이스 + local provider 미등록(null) → 로컬 provider 안내 error', async () => {
    const r = await handleSearchQuery(
      { query: '질의' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        // 'local' 조회 시 null (Ollama 미초기화 시뮬).
        getEmbeddingProvider: () => null,
        getSearchService: () => fx.service,
        getWorkspaceEmbeddingModel: () => 'ollama:nomic-embed-text:768'
      }
    )
    expect(r.status).toBe('error')
    // OpenAI API Key 안내가 아니라 Ollama/local 안내여야 함 (provider-aware 메시지).
    expect(r.error).toContain('로컬')
    expect(r.error).not.toContain('OpenAI API Key')
  })

  it('미지원 embedding_model id → error 응답 (silent fallback 금지)', async () => {
    const r = await handleSearchQuery(
      { query: 'x' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getEmbeddingProvider: () => makeMockProvider(),
        getSearchService: () => fx.service,
        getWorkspaceEmbeddingModel: () => 'openai:text-embedding-3-large:3072'
      }
    )
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/Unsupported embedding model/)
  })
})

describe('handleSearchGetContent', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('page 존재 → { content, title, url } 반환', async () => {
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://a.example',
      title: 'A',
      content: 'A body',
      visited_at: 1_000_000_000_000
    })
    const r = handleSearchGetContent({ pageId: page.id }, { pageStore: fx.pageStore })
    expect(r).toEqual({
      content: 'A body',
      title: 'A',
      url: 'https://a.example/'
    })
  })

  it('page 미존재 → null', () => {
    const r = handleSearchGetContent(
      { pageId: 'nonexistent-uuid' },
      { pageStore: fx.pageStore }
    )
    expect(r).toBeNull()
  })

  it('pageStore null (인프라 미초기화) → null', () => {
    const r = handleSearchGetContent({ pageId: 'any' }, { pageStore: null })
    expect(r).toBeNull()
  })

  it('빈 pageId → null (validation)', () => {
    const r = handleSearchGetContent({ pageId: '' }, { pageStore: fx.pageStore })
    expect(r).toBeNull()
  })
})
