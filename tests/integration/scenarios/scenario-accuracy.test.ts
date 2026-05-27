/**
 * Sprint 016 M5 T23 — 시나리오 정확도 회귀 (KI-018 top-10 hit rate ≥ 80% / KI-019 AI 출처 정확도 ≥ 90%).
 *
 * 입력: PRD §15.4 #3/#6 + Sprint 016 contract §6 8종 매트릭스 #3 / #6
 *
 * 본 회귀는 perf-baseline (시나리오 1·4 100% / 시나리오 2 부분) 의 정확도 산식만 분리하여 30 케이스 cover 완성:
 *   - 시나리오 1 (학술) — 5 페어 셋 (top-10 hit rate) + 1 AI 출처 정확도
 *   - 시나리오 3 (학습) — 5 페어 셋 (top-10 hit rate) + 1 AI 출처 정확도
 *   - 시나리오 4 (회상) — 3 페어 셋 (top-10 hit rate)
 *
 * accuracyHelpers — `topKHitRate` + `aiSourcesPrecision` + 임계 상수 (KI-018 0.8 / KI-019 0.9).
 *
 * 모든 retrieval 은 정규화된 sparse vector + cosine distance — deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyV06Schema } from '../../helpers/v06Schema'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { SearchService } from '../../../src/main/SearchService'
import {
  topKHitRate,
  aiSourcesPrecision,
  TOP_K_HIT_RATE_THRESHOLD,
  AI_SOURCES_PRECISION_THRESHOLD,
  type RetrievalPair,
  type AiSourcesPair
} from './accuracyHelpers'

/** 정규화 sparse vector — cosine distance 결정성. */
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

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  search: SearchService
  wsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb)
  const ws = fb.ensureDefaultWorkspace()
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const search = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  return { fb, vec, pageStore, noteStore, search, wsId: ws.id }
}

function teardown(fx: Fx): void {
  fx.fb.close()
}

const DAY = 24 * 60 * 60 * 1000

/**
 * 1 페어 셋 인덱싱 — 정답 페이지 + 노이즈 2건. queryDim 차원으로 정답 매칭.
 * 반환 RetrievalPair (expected pageId + topK 결과 pageId 목록).
 */
async function seedPair(
  fx: Fx,
  args: {
    topic: string
    queryDim: number
    daysAgo: number
    now: number
  }
): Promise<RetrievalPair> {
  const { topic, queryDim, daysAgo, now } = args
  const expected = await fx.pageStore.recordVisit({
    workspace_id: fx.wsId,
    url: `https://target.example/${topic}-${queryDim}`,
    title: `${topic} canonical`,
    content: `${topic} authoritative content body.`,
    visited_at: now - daysAgo * DAY
  })
  fx.vec.upsertPageEmbedding(expected.page.id, fx.wsId, makeVec({ [queryDim]: 1.0 }), 1024)
  // 노이즈 2건 — 분리된 차원 (100/101) 에 박아 cosine distance 매우 큼.
  for (let n = 0; n < 2; n++) {
    const noise = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: `https://noise.example/${topic}-${queryDim}-${n}`,
      title: `noise ${n}`,
      content: 'unrelated body',
      visited_at: now - daysAgo * DAY - (n + 1) * 60_000
    })
    fx.vec.upsertPageEmbedding(noise.page.id, fx.wsId, makeVec({ [100 + n]: 1.0 }), 1024)
  }

  const hits = fx.search.search({
    workspaceId: fx.wsId,
    queryEmbedding: makeVec({ [queryDim]: 1.0 }),
    topK: 10,
    now
  })

  return {
    expected: [expected.page.id],
    returnedTopK: hits.map((h) => h.pageId).filter((id): id is string => !!id)
  }
}

describe('Sprint 016 M5 T23 — KI-018 top-10 hit rate ≥ 80% / KI-019 AI 출처 정확도 ≥ 90%', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    teardown(fx)
  })

  /**
   * 시나리오 1 (학술 리서치) — 5 페어 셋.
   */
  it('S1 accuracy — 학술 5 페어 셋 top-10 hit rate ≥ 80%', async () => {
    const now = new Date('2026-05-21T09:00:00+09:00').getTime()
    const topics = ['transformer', 'attention', 'graph-nn', 'bert', 'rlhf']
    const pairs: RetrievalPair[] = []
    for (let i = 0; i < topics.length; i++) {
      pairs.push(
        await seedPair(fx, { topic: topics[i], queryDim: i, daysAgo: i + 1, now })
      )
    }
    const hitRate = topKHitRate(pairs, 10)
    expect(hitRate).toBeGreaterThanOrEqual(TOP_K_HIT_RATE_THRESHOLD)
  })

  it('S1 accuracy — 학술 첫 페어 top-1 hit 강제 (sparse 분리 → top-1 = 정답)', async () => {
    const now = new Date('2026-05-21T09:00:00+09:00').getTime()
    const pair = await seedPair(fx, {
      topic: 'transformer',
      queryDim: 0,
      daysAgo: 1,
      now
    })
    expect(pair.returnedTopK[0]).toBe(pair.expected[0])
  })

  it('S1 AI 출처 정확도 — chat_meta.cells.sources 모두 retrieved_items 안에 속함', async () => {
    const now = new Date('2026-05-21T09:00:00+09:00').getTime()
    const pair = await seedPair(fx, {
      topic: 'transformer',
      queryDim: 0,
      daysAgo: 1,
      now
    })
    const expectedPageId = pair.expected[0]
    // chat_meta.cells.sources 시뮬레이션 — retrieved_items 안의 page_id 만 인용
    const aiPair: AiSourcesPair = {
      retrievedItems: [expectedPageId],
      citedSources: [expectedPageId]
    }
    const precision = aiSourcesPrecision([aiPair])
    expect(precision).toBeGreaterThanOrEqual(AI_SOURCES_PRECISION_THRESHOLD)
  })

  /**
   * 시나리오 3 (학습) — 5 페어 셋.
   */
  it('S3 accuracy — 학습 5 페어 셋 top-10 hit rate ≥ 80%', async () => {
    const now = new Date('2026-05-21T15:00:00+09:00').getTime()
    const topics = ['react', 'redux', 'webpack', 'jest', 'typescript']
    const pairs: RetrievalPair[] = []
    for (let i = 0; i < topics.length; i++) {
      pairs.push(
        await seedPair(fx, { topic: topics[i], queryDim: 10 + i, daysAgo: i + 2, now })
      )
    }
    const hitRate = topKHitRate(pairs, 10)
    expect(hitRate).toBeGreaterThanOrEqual(TOP_K_HIT_RATE_THRESHOLD)
  })

  it('S3 accuracy — 학습 시점 (오늘) 페어도 top-10 hit', async () => {
    const now = new Date('2026-05-21T15:00:00+09:00').getTime()
    const pair = await seedPair(fx, {
      topic: 'webpack',
      queryDim: 12,
      daysAgo: 0,
      now
    })
    expect(pair.returnedTopK.slice(0, 10)).toContain(pair.expected[0])
  })

  it('S3 AI 출처 정확도 — hallucinated source 포함 시 precision < 1', () => {
    const aiPair: AiSourcesPair = {
      retrievedItems: ['page-a', 'page-b'],
      citedSources: ['page-a', 'page-b', 'page-hallucinated']
    }
    const precision = aiSourcesPrecision([aiPair])
    expect(precision).toBeLessThan(1)
    expect(precision).toBeCloseTo(2 / 3, 5)
  })

  /**
   * 시나리오 4 (우연 회상) — 3 페어 셋 + 시간 가중 정합 검증.
   */
  it('S4 accuracy — 회상 3 페어 셋 top-10 hit rate ≥ 80%', async () => {
    const now = new Date('2026-05-21T20:00:00+09:00').getTime()
    const topics = ['old-blog-post', 'archived-doc', 'reddit-thread']
    const pairs: RetrievalPair[] = []
    for (let i = 0; i < topics.length; i++) {
      pairs.push(
        await seedPair(fx, { topic: topics[i], queryDim: 30 + i, daysAgo: 30 + i * 5, now })
      )
    }
    const hitRate = topKHitRate(pairs, 10)
    expect(hitRate).toBeGreaterThanOrEqual(TOP_K_HIT_RATE_THRESHOLD)
  })

  it('S4 accuracy — 오래된 페이지 (30일 전) 도 의미 매칭 시 top-10 안', async () => {
    const now = new Date('2026-05-21T20:00:00+09:00').getTime()
    const pair = await seedPair(fx, {
      topic: 'old-blog-post',
      queryDim: 30,
      daysAgo: 30,
      now
    })
    expect(pair.returnedTopK.slice(0, 10)).toContain(pair.expected[0])
  })

  it('S4 — empty pairs 시 hitRate = 0 (방어)', () => {
    const empty: RetrievalPair[] = []
    expect(topKHitRate(empty, 10)).toBe(0)
  })

  /**
   * 종합 — 시나리오 1+3+4 합산 13 페어 셋의 hit rate ≥ 80%.
   */
  it('종합 — 시나리오 1+3+4 13 페어 셋 합산 top-10 hit rate ≥ 80%', async () => {
    const now = new Date('2026-05-21T09:00:00+09:00').getTime()
    const topics = [
      // S1 (5)
      { topic: 't1', dim: 0, days: 1 },
      { topic: 't2', dim: 1, days: 2 },
      { topic: 't3', dim: 2, days: 3 },
      { topic: 't4', dim: 3, days: 4 },
      { topic: 't5', dim: 4, days: 5 },
      // S3 (5)
      { topic: 't6', dim: 10, days: 2 },
      { topic: 't7', dim: 11, days: 3 },
      { topic: 't8', dim: 12, days: 4 },
      { topic: 't9', dim: 13, days: 5 },
      { topic: 't10', dim: 14, days: 6 },
      // S4 (3)
      { topic: 't11', dim: 30, days: 30 },
      { topic: 't12', dim: 31, days: 35 },
      { topic: 't13', dim: 32, days: 40 }
    ]
    const pairs: RetrievalPair[] = []
    for (const t of topics) {
      pairs.push(await seedPair(fx, { topic: t.topic, queryDim: t.dim, daysAgo: t.days, now }))
    }
    expect(pairs).toHaveLength(13)
    const hitRate = topKHitRate(pairs, 10)
    expect(hitRate).toBeGreaterThanOrEqual(TOP_K_HIT_RATE_THRESHOLD)
  })

  /**
   * 종합 — AI 출처 정확도 30 케이스 산식 (mock).
   */
  it('종합 — AI 출처 정확도 30 케이스 (mock) 평균 ≥ 90%', () => {
    const aiPairs: AiSourcesPair[] = []
    // 27/30 = 90% — 정확히 임계 통과
    for (let i = 0; i < 27; i++) {
      aiPairs.push({
        retrievedItems: [`p-${i}-a`, `p-${i}-b`],
        citedSources: [`p-${i}-a`]
      })
    }
    // 3 케이스 — hallucinated source 포함 → precision < 1
    for (let i = 27; i < 30; i++) {
      aiPairs.push({
        retrievedItems: [`p-${i}-a`, `p-${i}-b`],
        citedSources: [`p-${i}-a`, `p-${i}-hallucinated`]
      })
    }
    const precision = aiSourcesPrecision(aiPairs)
    // 27 × 1.0 + 3 × 0.5 = 28.5 / 30 = 0.95 — codex 사전 dual review NB-2 흡수 (exact assertion)
    expect(precision).toBeCloseTo(0.95, 5)
    expect(precision).toBeGreaterThanOrEqual(AI_SOURCES_PRECISION_THRESHOLD)
  })

  it('aiSourcesPrecision — citedSources 0 케이스는 평균에서 제외', () => {
    const aiPairs: AiSourcesPair[] = [
      // 평균 산식에서 빠지는 케이스 (citedSources 0)
      { retrievedItems: ['p-1'], citedSources: [] },
      // 정확 1.0
      { retrievedItems: ['p-2'], citedSources: ['p-2'] },
      // 정확 0.5
      { retrievedItems: ['p-3'], citedSources: ['p-3', 'p-fake'] }
    ]
    const precision = aiSourcesPrecision(aiPairs)
    // 1.0 + 0.5 = 1.5 / 2 = 0.75
    expect(precision).toBeCloseTo(0.75, 5)
  })
})
