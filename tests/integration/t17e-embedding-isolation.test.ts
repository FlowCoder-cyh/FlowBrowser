/**
 * Sprint 018 M2 T17e — 임베딩 provider/dimension 격리 E2E 통합 테스트.
 *
 * write-path wiring(#262)으로 T17 라인이 닫혔다. 본 테스트가 그 end-to-end 가치를 증명:
 * v06 schema(vec_pages_1024 / vec_pages_768)에서 워크스페이스별 embedding_model 격리가
 * write path(인덱싱 적재) + query path(검색) 양쪽에서 성립하는지 검증.
 *
 * 두 워크스페이스:
 *   - ws1 = default (openai:text-embedding-3-small:1024)
 *   - ws2 = create  (ollama:nomic-embed-text:768)
 *
 * 검증 (codex 019e6ea0 협의 scope):
 *   1. write path — recordVisit → enqueue → processNextEmbeddingJob(buildEmbeddingClientForModel) →
 *      ws1 page = vec_pages_1024 에만 / ws2 = vec_pages_768 에만 (searchPages per-dim — countPages 는 합산이라 부적합)
 *   2. query path — handleSearchQuery(프로덕션 경로, provider 선택 포함) → 각 워크스페이스 page hit
 *   3. provider 선택 격리 — ws1 = openai(1024, text-embedding-3-small) / ws2 = local(768, nomic-embed-text) spy
 *   4. 워크스페이스 격리 — ws1 검색에 ws2 page 안 섞임 (vec0 workspace_id 필터)
 *   5. dimension 안전 — provider 가 잘못된 dim 반환 시 'failed'(provider_unavailable 아님) + queue failed=1 + vector 0 (silent corruption 차단)
 *
 * 외부 provider 는 fake (네트워크 없음, req.dimensions 존중) — 실측 정확도는 별도 시나리오/실 provider 책임.
 * scope: page only (vec_notes 분리는 VectorIndex unit 커버 — codex 권고).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { openInMemoryV06 } from '../helpers/v06Schema'
import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { EmbeddingQueue } from '../../src/storage/EmbeddingQueue'
import { NoteStore } from '../../src/storage/NoteStore'
import { VectorIndex } from '../../src/storage/VectorIndex'
import { SearchService } from '../../src/main/SearchService'
import { handleSearchQuery } from '../../src/main/searchHandlers'
import {
  processNextEmbeddingJob,
  buildEmbeddingClientForModel,
  type ProcessJobResult
} from '../../src/ai/embedding/EmbeddingClient'
import type { CredentialProviderType } from '../../src/storage'
import type { ProviderAdapter, ProviderInfo, EmbedRequest, EmbedResponse } from '../../src/ai'

/** 결정적 fixed 벡터 — query 와 page 임베딩이 동일 → exact match hit (격리 검증이 목적, 정확도 아님). */
function fixedVector(dim: number): number[] {
  const out = new Array<number>(dim)
  for (let i = 0; i < dim; i++) out[i] = Math.sin(1 + i * 0.01)
  return out
}

interface SpyProvider extends ProviderAdapter {
  embedReqs: EmbedRequest[]
}

/**
 * fake embed provider — req.dimensions 길이의 fixed 벡터 반환 + 모든 embed req 기록(spy).
 * returnDim 미지정 시 req.dimensions 존중(정상). 지정 시 그 차원 강제(dimension mismatch 유발용).
 */
function makeEmbedProvider(opts: {
  providerType: CredentialProviderType
  returnDim?: number
}): SpyProvider {
  const info: ProviderInfo = {
    providerType: opts.providerType,
    displayName: `Fake-${opts.providerType}`,
    supportedRequestTypes: ['selection'],
    defaultModel: 'm',
    availableModels: ['m'],
    supportsChat: false,
    supportsEmbed: true
  }
  const embedReqs: EmbedRequest[] = []
  return {
    info,
    embedReqs,
    async validate() {
      return { ok: true }
    },
    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      embedReqs.push(req)
      const dim = opts.returnDim ?? req.dimensions ?? 1024
      return {
        vectors: req.texts.map(() => fixedVector(dim)),
        modelUsed: req.modelHint ?? 'm',
        inputTokens: req.texts.reduce((s, t) => s + t.length, 0),
        estimatedCostUsd: 0,
        durationMs: 1
      }
    }
  }
}

interface Fx {
  fb: FlowbrowserDatabase
  ws1Id: string
  ws2Id: string
  pageStore: IndexedPageStoreSqlite
  queue: EmbeddingQueue
  noteStore: NoteStore
  vectorIndex: VectorIndex
  searchService: SearchService
  openai: SpyProvider
  ollama: SpyProvider
  getProvider: (credType: CredentialProviderType) => ProviderAdapter | null
}

function setup(opts: { openaiReturnDim?: number } = {}): Fx {
  const fb = openInMemoryV06()
  const ws1 = fb.ensureDefaultWorkspace() // openai:text-embedding-3-small:1024 (DEFAULT)
  const ws2 = fb.createWorkspace({
    name: 'Local',
    icon: '🦙',
    embedding_model: 'ollama:nomic-embed-text:768'
  })
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws1.id })
  const queue = new EmbeddingQueue(fb)
  const noteStore = new NoteStore(fb)
  const vectorIndex = new VectorIndex(fb)
  const searchService = new SearchService({ vectorIndex, pageStore, noteStore })
  const openai = makeEmbedProvider({ providerType: 'openai', returnDim: opts.openaiReturnDim })
  const ollama = makeEmbedProvider({ providerType: 'local' })
  const getProvider = (credType: CredentialProviderType): ProviderAdapter | null =>
    credType === 'openai' ? openai : credType === 'local' ? ollama : null
  return { fb, ws1Id: ws1.id, ws2Id: ws2.id, pageStore, queue, noteStore, vectorIndex, searchService, openai, ollama, getProvider }
}

/** write path 프로덕션 deps — resolveEmbeddingClient = 워크스페이스 모델 → buildEmbeddingClientForModel. */
function jobDeps(fx: Fx) {
  return {
    resolveEmbeddingClient: (workspaceId: string) =>
      buildEmbeddingClientForModel(
        fx.fb.findWorkspaceById(workspaceId)?.embedding_model ?? null,
        fx.getProvider
      ),
    queue: fx.queue,
    vectorIndex: fx.vectorIndex,
    pageStore: fx.pageStore,
    noteStore: fx.noteStore
  }
}

/**
 * 큐를 idle 까지 drain (worker scheduler 없이 processNextEmbeddingJob 반복 — codex Q1).
 * maxIterations 가드 — regression 이 provider_unavailable 등을 반복 반환하면 runner timeout 까지 hang 하지 않고
 * 수집된 status 와 함께 즉시 throw (codex 019e6ea0 NEEDS_CHANGES).
 */
async function drainUntilIdle(fx: Fx, maxIterations = 20): Promise<ProcessJobResult[]> {
  const deps = jobDeps(fx)
  const results: ProcessJobResult[] = []
  for (let i = 0; i < maxIterations; i++) {
    const r = await processNextEmbeddingJob(deps)
    results.push(r)
    if (r.status === 'idle') return results
  }
  throw new Error(
    `drainUntilIdle: ${maxIterations}회 내 idle 미도달 — statuses: [${results.map((r) => r.status).join(', ')}]`
  )
}

/** query path 프로덕션 호출 — handleSearchQuery(provider 선택 + dim 해소 포함). */
async function searchIn(fx: Fx, workspaceId: string, query: string) {
  return handleSearchQuery(
    { query, topN: 10 },
    {
      getActiveWorkspaceId: () => workspaceId,
      getEmbeddingProvider: (credType) => fx.getProvider(credType),
      getSearchService: () => fx.searchService,
      getWorkspaceEmbeddingModel: (wsId) => fx.fb.findWorkspaceById(wsId)?.embedding_model ?? null
    }
  )
}

describe('T17e — 임베딩 provider/dimension 격리 E2E', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('write path — ws1(1024) page = vec_pages_1024 에만, ws2(768) page = vec_pages_768 에만', async () => {
    const { page: p1 } = await fx.pageStore.recordVisit({
      url: 'https://openai.example/doc',
      title: 'OpenAI workspace page',
      content: 'content indexed under the 1024-dim workspace',
      workspace_id: fx.ws1Id
    })
    const { page: p2 } = await fx.pageStore.recordVisit({
      url: 'https://ollama.example/doc',
      title: 'Ollama workspace page',
      content: 'content indexed under the 768-dim workspace',
      workspace_id: fx.ws2Id
    })
    fx.queue.enqueue({ target_type: 'page', target_id: p1.id, workspace_id: fx.ws1Id })
    fx.queue.enqueue({ target_type: 'page', target_id: p2.id, workspace_id: fx.ws2Id })

    const results = await drainUntilIdle(fx)
    // 2건 succeeded + 마지막 idle
    expect(results.filter((r) => r.status === 'succeeded')).toHaveLength(2)
    expect(results[results.length - 1].status).toBe('idle')
    expect(fx.queue.stats()).toMatchObject({ pending: 0, in_progress: 0, succeeded: 2, failed: 0 })

    // cross-dim: searchPages per-dim (countPages 는 dim 합산이라 부적합 — codex 권고)
    const q1024 = fixedVector(1024)
    const q768 = fixedVector(768)
    // ws1 page → 1024 테이블에만 (VectorSearchResult.id = page_id)
    expect(fx.vectorIndex.searchPages(fx.ws1Id, q1024, 5, 1024).map((h) => h.id)).toEqual([p1.id])
    expect(fx.vectorIndex.searchPages(fx.ws1Id, q768, 5, 768)).toHaveLength(0)
    // ws2 page → 768 테이블에만
    expect(fx.vectorIndex.searchPages(fx.ws2Id, q768, 5, 768).map((h) => h.id)).toEqual([p2.id])
    expect(fx.vectorIndex.searchPages(fx.ws2Id, q1024, 5, 1024)).toHaveLength(0)
  })

  it('provider 선택 격리 — ws1 embed = openai(1024/text-embedding-3-small), ws2 = local(768/nomic-embed-text)', async () => {
    const { page: p1 } = await fx.pageStore.recordVisit({
      url: 'https://openai.example/a',
      content: 'a',
      workspace_id: fx.ws1Id
    })
    const { page: p2 } = await fx.pageStore.recordVisit({
      url: 'https://ollama.example/b',
      content: 'b',
      workspace_id: fx.ws2Id
    })
    fx.queue.enqueue({ target_type: 'page', target_id: p1.id, workspace_id: fx.ws1Id })
    fx.queue.enqueue({ target_type: 'page', target_id: p2.id, workspace_id: fx.ws2Id })
    await drainUntilIdle(fx)

    // 각 provider 가 자기 워크스페이스 차원/모델로만 호출됨 (local provider 가 1024 로 호출되면 격리 실패)
    expect(fx.openai.embedReqs.length).toBeGreaterThan(0)
    expect(fx.openai.embedReqs.every((r) => r.dimensions === 1024 && r.modelHint === 'text-embedding-3-small')).toBe(true)
    expect(fx.ollama.embedReqs.length).toBeGreaterThan(0)
    expect(fx.ollama.embedReqs.every((r) => r.dimensions === 768 && r.modelHint === 'nomic-embed-text')).toBe(true)
  })

  it('query path E2E — handleSearchQuery 가 워크스페이스별 provider/dim 으로 자기 page 만 반환', async () => {
    const { page: p1 } = await fx.pageStore.recordVisit({
      url: 'https://openai.example/doc',
      title: 'OpenAI doc',
      content: 'machine learning research notes',
      workspace_id: fx.ws1Id
    })
    const { page: p2 } = await fx.pageStore.recordVisit({
      url: 'https://ollama.example/doc',
      title: 'Ollama doc',
      content: 'local embedding workspace notes',
      workspace_id: fx.ws2Id
    })
    fx.queue.enqueue({ target_type: 'page', target_id: p1.id, workspace_id: fx.ws1Id })
    fx.queue.enqueue({ target_type: 'page', target_id: p2.id, workspace_id: fx.ws2Id })
    await drainUntilIdle(fx)
    // drain 시점 embed req 만 비우고 query path 호출분만 검사
    fx.openai.embedReqs.length = 0
    fx.ollama.embedReqs.length = 0

    const r1 = await searchIn(fx, fx.ws1Id, 'research')
    expect(r1.status).toBe('ok')
    expect(r1.results.map((h) => h.pageId)).toEqual([p1.id])
    expect(r1.results[0].type).toBe('page')
    expect(r1.results[0].url).toBe('https://openai.example/doc')
    expect(r1.results[0].title).toBe('OpenAI doc')
    // ws1 query 는 openai(1024) 만 호출
    expect(fx.openai.embedReqs).toHaveLength(1)
    expect(fx.openai.embedReqs[0]).toMatchObject({ dimensions: 1024, modelHint: 'text-embedding-3-small' })
    expect(fx.ollama.embedReqs).toHaveLength(0)

    const r2 = await searchIn(fx, fx.ws2Id, 'notes')
    expect(r2.status).toBe('ok')
    expect(r2.results.map((h) => h.pageId)).toEqual([p2.id])
    expect(r2.results[0].url).toBe('https://ollama.example/doc')
    // ws2 query 는 local(768) 만 호출 — openai 는 ws1 query 1건에서 증가 없음 (ws2 가 openai 안 건드림)
    expect(fx.ollama.embedReqs).toHaveLength(1)
    expect(fx.ollama.embedReqs[0]).toMatchObject({ dimensions: 768, modelHint: 'nomic-embed-text' })
    expect(fx.openai.embedReqs).toHaveLength(1)
  })

  it('워크스페이스 격리 — ws1 검색 결과에 ws2 page 안 섞임 (양방향)', async () => {
    const { page: p1 } = await fx.pageStore.recordVisit({
      url: 'https://openai.example/x',
      content: 'shared topic alpha',
      workspace_id: fx.ws1Id
    })
    const { page: p2 } = await fx.pageStore.recordVisit({
      url: 'https://ollama.example/y',
      content: 'shared topic alpha',
      workspace_id: fx.ws2Id
    })
    fx.queue.enqueue({ target_type: 'page', target_id: p1.id, workspace_id: fx.ws1Id })
    fx.queue.enqueue({ target_type: 'page', target_id: p2.id, workspace_id: fx.ws2Id })
    await drainUntilIdle(fx)

    const r1 = await searchIn(fx, fx.ws1Id, 'alpha')
    const ids1 = r1.results.map((h) => h.pageId)
    expect(ids1).toContain(p1.id)
    expect(ids1).not.toContain(p2.id)

    const r2 = await searchIn(fx, fx.ws2Id, 'alpha')
    const ids2 = r2.results.map((h) => h.pageId)
    expect(ids2).toContain(p2.id)
    expect(ids2).not.toContain(p1.id)
  })

  it('dimension 안전 — provider 가 잘못된 차원 반환 → failed (provider_unavailable 아님) + vector 0', async () => {
    // openai provider 가 ws1(1024 기대)에 768 벡터 반환 → toFloat32 dimension mismatch throw → markFailed
    const bad = setup({ openaiReturnDim: 768 })
    try {
      const { page } = await bad.pageStore.recordVisit({
        url: 'https://openai.example/bad',
        content: 'mismatch',
        workspace_id: bad.ws1Id
      })
      bad.queue.enqueue({ target_type: 'page', target_id: page.id, workspace_id: bad.ws1Id })

      const r = await processNextEmbeddingJob(jobDeps(bad))
      expect(r.status).toBe('failed') // 데이터/계약 오류 — 영구 실패 (release/provider_unavailable 아님)
      expect(r.error).toMatch(/dimension mismatch/)
      expect(bad.queue.stats()).toMatchObject({ failed: 1 })
      expect(bad.vectorIndex.searchPages(bad.ws1Id, fixedVector(1024), 5, 1024)).toHaveLength(0)
      // markFailed 이므로 재claim 안 됨 (pending 0)
      expect(bad.queue.stats().pending).toBe(0)
    } finally {
      bad.fb.close()
    }
  })
})
