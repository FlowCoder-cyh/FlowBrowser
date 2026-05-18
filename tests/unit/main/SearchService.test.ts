/**
 * Sprint 015 M5-3a — SearchService 단위 테스트.
 *
 * in-memory FlowbrowserDatabase + 실 VectorIndex / IndexedPageStoreSqlite / NoteStore 활용.
 *
 * cover:
 *   - 빈 워크스페이스 → 빈 결과
 *   - Page / Note 단일 retrieval
 *   - Page + Note 결합 정렬 (score 내림차순)
 *   - 정렬 공식 가중치 — 동일 cosineSim 시 최근 페이지 우선 / 동일 시간 시 더 유사한 페이지 우선
 *   - 시간 필터 — range 범위 안/밖 / from null / to null / both null (= range 없음 동일 효과)
 *   - Page 의 여러 Visit 중 매칭 visit 선택
 *   - Page 의 visit 없음 + range 있음 → 제외
 *   - Page 의 visit 없음 + range 없음 → daysAgo null / timeFactor 0
 *   - Note 의 visit_id null (글로사리 마이그레이션) → created_at fallback
 *   - Note 의 anchor page 누락 → fallback url/title
 *   - workspaceId partition — 다른 워크스페이스 결과 미포함
 *   - topK / eFoldingDays 검증
 *   - now 주입 deterministic — e-folding 정확값
 *   - paginate() — pageIndex 0/1/2 슬라이스 + hasMore + maxReached + 검증
 *
 * 결정성 보장: makeVec() 으로 정규화된 sparse vector 생성 → cosine distance 예측 가능.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { NoteStore } from '../../../src/storage/NoteStore'
import {
  SearchService,
  paginate,
  MAX_RESULTS,
  DEFAULT_TOP_K
} from '../../../src/main/SearchService'

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

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  service: SearchService
  wsA: string
  wsB: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsA = fb.ensureDefaultWorkspace().id
  const wsB = fb.createWorkspace({ name: 'Other', icon: '🧪' }).id
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: wsA })
  const noteStore = new NoteStore(fb)
  const service = new SearchService({
    vectorIndex: vec,
    pageStore,
    noteStore
  })
  return { fb, vec, pageStore, noteStore, service, wsA, wsB }
}

describe('SearchService — schema cosine metric 강제 (codex BLOCKING PR #154 정정)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('identical 벡터 distance = 0 → cosineSim = 1', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].distance).toBeCloseTo(0, 5)
    expect(hits[0].cosineSim).toBeCloseTo(1, 5)
  })

  it('orthogonal 벡터 distance ≈ 1 (L2 였다면 ≈ 1.414 — cosine metric 강제 검증)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now
    })
    // [1,0,...] 등록 vs [0,1,...] 질의 → cosine distance = 1.0 (L2 였다면 √2 ≈ 1.414)
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 1: 1 }),
      now
    })
    expect(hits[0].distance).toBeCloseTo(1, 4)
    expect(hits[0].cosineSim).toBeCloseTo(0, 4)
  })

  it('45도 사이각 벡터 distance ≈ 1 - cos(45°) ≈ 0.293 (cosine 정합)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))
    // 질의 = [1,1,0,...] 정규화 = [1/√2, 1/√2, 0, ...]
    // cos(angle) = 1/√2 → cosine distance = 1 - 1/√2 ≈ 0.2929
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1, 1: 1 }),
      now
    })
    expect(hits[0].distance).toBeCloseTo(1 - 1 / Math.sqrt(2), 4)
    expect(hits[0].cosineSim).toBeCloseTo(1 / Math.sqrt(2), 4)
  })
})

describe('SearchService — 빈 워크스페이스', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('Page / Note 모두 없으면 빈 결과', () => {
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 })
    })
    expect(hits).toEqual([])
  })

  it('Note 만 있고 vec_notes 비어 있으면 빈 결과', () => {
    fx.noteStore.create({ workspace_id: fx.wsA, selected_text: 'hi' })
    // vec_notes upsert 안 했으므로 vec.searchNotes 결과 0
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 })
    })
    expect(hits).toEqual([])
  })
})

describe('SearchService — Page retrieval', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('단일 Page hit — score = α × cosineSim + β × timeFactor', async () => {
    const now = 1_000_000_000_000
    const visitedAt = now - 10 * MS_PER_DAY
    const { page, visit } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a.example',
      title: 'A',
      content: 'body',
      visited_at: visitedAt
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.type).toBe('page')
    expect(hit.pageId).toBe(page.id)
    expect(hit.visitId).toBe(visit.id)
    expect(hit.workspaceId).toBe(fx.wsA)
    expect(hit.cosineSim).toBeCloseTo(1, 5)
    expect(hit.distance).toBeCloseTo(0, 5)
    expect(hit.visitedAt).toBe(visitedAt)
    expect(hit.daysAgo).toBeCloseTo(10, 5)
    expect(hit.timeFactor).toBeCloseTo(Math.exp(-10 / 180), 5)
    expect(hit.score).toBeCloseTo(0.85 * 1 + 0.15 * Math.exp(-10 / 180), 5)
    expect(hit.title).toBe('A')
    expect(hit.url).toBe('https://a.example/')
    expect(hit.contentSnippet).toBe('body')
  })

  it('Page 의 여러 Visit 중 가장 최근 visit 의 시간 사용', async () => {
    const now = 1_000_000_000_000
    const old = now - 100 * MS_PER_DAY
    const recent = now - 1 * MS_PER_DAY
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a.example',
      content: 'b',
      visited_at: old
    })
    await fx.pageStore.createVisit({
      page_id: page.id,
      workspace_id: fx.wsA,
      visited_at: recent
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].visitedAt).toBe(recent)
    expect(hits[0].daysAgo).toBeCloseTo(1, 5)
  })

  it('Page 매칭 visit 의 dwell_ms 가 hit.dwellMs 로 전달', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a.example',
      content: 'b',
      visited_at: now - MS_PER_DAY
    })
    // 두 번째 visit 에 dwell 박힘
    const v2 = await fx.pageStore.createVisit({
      page_id: page.id,
      workspace_id: fx.wsA,
      visited_at: now - MS_PER_DAY / 2,
      dwell_ms: 60_000
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].visitId).toBe(v2.id)
    expect(hits[0].dwellMs).toBe(60_000)
  })
})

describe('SearchService — Note retrieval', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('Note hit — anchor page 있는 정상 노트', async () => {
    const now = 1_000_000_000_000
    const { page, visit } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a.example',
      title: 'A title',
      content: 'b',
      visited_at: now - 5 * MS_PER_DAY
    })
    const note = fx.noteStore.create({
      workspace_id: fx.wsA,
      page_id: page.id,
      visit_id: visit.id,
      selected_text: 'snippet',
      body: 'note body',
      created_at: now - 5 * MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.type).toBe('note')
    expect(hit.noteId).toBe(note.id)
    expect(hit.pageId).toBe(page.id)
    expect(hit.visitId).toBe(visit.id)
    expect(hit.title).toBe('A title')
    expect(hit.url).toBe('https://a.example/')
    expect(hit.contentSnippet).toBe('snippet\n\nnote body')
    expect(hit.visitedAt).toBe(visit.visited_at)
    expect(hit.daysAgo).toBeCloseTo(5, 5)
  })

  it('Note visit_id null — created_at fallback (글로사리 마이그레이션)', async () => {
    const now = 1_000_000_000_000
    const createdAt = now - 30 * MS_PER_DAY
    const note = fx.noteStore.create({
      workspace_id: fx.wsA,
      selected_text: 'CAR-T',
      ai_tags: ['glossary'],
      created_by: 'migration',
      created_at: createdAt
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].pageId).toBeNull()
    expect(hits[0].visitId).toBeNull()
    expect(hits[0].visitedAt).toBe(createdAt)
    expect(hits[0].daysAgo).toBeCloseTo(30, 5)
    expect(hits[0].url).toBe('')
    expect(hits[0].title).toBe('CAR-T')
  })

  it('Note body 없음 — selected_text 만 contentSnippet', async () => {
    const note = fx.noteStore.create({
      workspace_id: fx.wsA,
      selected_text: 'only-selected'
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now: Date.now()
    })
    expect(hits[0].contentSnippet).toBe('only-selected')
  })

  it('Note anchor page DELETE 후 — note 살아남고 pageId/visitId=null fallback (schema ON DELETE SET NULL 정합)', async () => {
    const now = 1_000_000_000_000
    const { page, visit } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://gone.example',
      content: 'b',
      visited_at: now - MS_PER_DAY
    })
    const note = fx.noteStore.create({
      workspace_id: fx.wsA,
      page_id: page.id,
      visit_id: visit.id,
      selected_text: 'orphan',
      created_at: now - MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.wsA, makeVec({ 0: 1 }))
    // page 삭제 (visit ON DELETE CASCADE / vec_pages trigger / notes SET NULL / aichat SET NULL)
    fx.fb.getDb().prepare('DELETE FROM pages WHERE id = ?').run(page.id)

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.type).toBe('note')
    expect(hit.noteId).toBe(note.id)
    expect(hit.pageId).toBeNull() // ON DELETE SET NULL
    expect(hit.visitId).toBeNull() // visit ON DELETE CASCADE 후 note.visit_id SET NULL
    expect(hit.url).toBe('') // anchor page fetch 실패 fallback
    expect(hit.title).toBe('orphan') // selected_text 첫 50자 fallback
    expect(hit.visitedAt).toBe(note.created_at) // anchor visit null → created_at fallback
  })
})

describe('SearchService — Page + Note 결합 정렬', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('score 내림차순 정렬 (Page + Note 결합)', async () => {
    const now = 1_000_000_000_000
    const { page: pA } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'a',
      visited_at: now - MS_PER_DAY
    })
    const { page: pB } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://b',
      content: 'b',
      visited_at: now - 100 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(pA.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertPageEmbedding(pB.id, fx.wsA, makeVec({ 0: 1 }))

    const noteRecent = fx.noteStore.create({
      workspace_id: fx.wsA,
      page_id: pA.id,
      selected_text: 'note',
      created_at: now - 2 * MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(noteRecent.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
    }
  })

  it('동일 cosineSim 시 최근 visit 우선 (시간 가중치)', async () => {
    const now = 1_000_000_000_000
    const { page: pOld } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://old',
      content: 'b',
      visited_at: now - 365 * MS_PER_DAY
    })
    const { page: pNew } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://new',
      content: 'b',
      visited_at: now - 1 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(pOld.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertPageEmbedding(pNew.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].pageId).toBe(pNew.id)
    expect(hits[1].pageId).toBe(pOld.id)
  })

  it('동일 시간 시 더 유사한 페이지 우선 (의미 가중치)', async () => {
    const now = 1_000_000_000_000
    const visitedAt = now - 10 * MS_PER_DAY
    const { page: pSim } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://similar',
      content: 'b',
      visited_at: visitedAt
    })
    const { page: pFar } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://far',
      content: 'b',
      visited_at: visitedAt
    })
    fx.vec.upsertPageEmbedding(pSim.id, fx.wsA, makeVec({ 0: 1 }))
    // orthogonal vector → distance ≈ 1, cosineSim ≈ 0
    fx.vec.upsertPageEmbedding(pFar.id, fx.wsA, makeVec({ 1: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].pageId).toBe(pSim.id)
    expect(hits[1].pageId).toBe(pFar.id)
    expect(hits[0].cosineSim).toBeGreaterThan(hits[1].cosineSim)
  })

  it('시나리오 4 회귀 — 6개월 전 정답 페이지 가 의미적으로 유사 시 top-3 안에 포함', async () => {
    const now = 1_000_000_000_000
    // 정답: 6개월 전 페이지 + 유사 embedding
    const correctVisitedAt = now - 180 * MS_PER_DAY
    const { page: correct } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://correct',
      content: 'b',
      visited_at: correctVisitedAt
    })
    fx.vec.upsertPageEmbedding(correct.id, fx.wsA, makeVec({ 0: 1 }))
    // 분산 페이지 5개 — 더 최근이지만 의미 distance 큼
    for (let i = 0; i < 5; i++) {
      const { page } = await fx.pageStore.recordVisit({
        workspace_id: fx.wsA,
        url: `https://noise-${i}`,
        content: 'b',
        visited_at: now - i * MS_PER_DAY
      })
      fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ [5 + i]: 1 }))
    }

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    const top3 = hits.slice(0, 3).map((h) => h.pageId)
    expect(top3).toContain(correct.id)
  })
})

describe('SearchService — 시간 필터', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('range 안 페이지만 포함', async () => {
    const now = 1_000_000_000_000
    const { page: pIn } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://in',
      content: 'b',
      visited_at: now - 5 * MS_PER_DAY
    })
    const { page: pOut } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://out',
      content: 'b',
      visited_at: now - 50 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(pIn.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertPageEmbedding(pOut.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - 7 * MS_PER_DAY, to: now },
      now
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].pageId).toBe(pIn.id)
  })

  it('range.from null — to 까지 무제한 (오래된 페이지도 통과)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://old',
      content: 'b',
      visited_at: now - 1000 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: null, to: now },
      now
    })
    expect(hits).toHaveLength(1)
  })

  it('range.to null — from 부터 무제한 (미래 페이지도 통과)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://future',
      content: 'b',
      visited_at: now + 10 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - MS_PER_DAY, to: null },
      now
    })
    expect(hits).toHaveLength(1)
  })

  it('range from / to 모두 null — 시간 필터 미적용 (모든 결과 통과)', async () => {
    const now = 1_000_000_000_000
    const { page: pOld } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://old',
      content: 'b',
      visited_at: 0
    })
    const { page: pNew } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://new',
      content: 'b',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(pOld.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertPageEmbedding(pNew.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: null, to: null },
      now
    })
    expect(hits.map((h) => h.pageId).sort()).toEqual([pOld.id, pNew.id].sort())
  })

  it('Page 다중 Visit — range 매칭되는 visit 만 사용', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://multi',
      content: 'b',
      visited_at: now - 100 * MS_PER_DAY
    })
    const v2 = await fx.pageStore.createVisit({
      page_id: page.id,
      workspace_id: fx.wsA,
      visited_at: now - 5 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - 7 * MS_PER_DAY, to: now },
      now
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].visitId).toBe(v2.id)
    expect(hits[0].daysAgo).toBeCloseTo(5, 5)
  })

  it('Page 의 모든 visit 가 range 밖 — 결과 제외', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://outside',
      content: 'b',
      visited_at: now - 100 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - 10 * MS_PER_DAY, to: now },
      now
    })
    expect(hits).toEqual([])
  })

  it('Note 시간 필터 — anchor visit 의 visited_at 기준', async () => {
    const now = 1_000_000_000_000
    const { page, visit } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now - 100 * MS_PER_DAY
    })
    const note = fx.noteStore.create({
      workspace_id: fx.wsA,
      page_id: page.id,
      visit_id: visit.id,
      selected_text: 'old',
      created_at: now - 100 * MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(note.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - 10 * MS_PER_DAY, to: now },
      now
    })
    expect(hits).toEqual([])
  })

  it('Note 시간 필터 — visit_id null 시 created_at 기준 (글로사리 마이그레이션)', async () => {
    const now = 1_000_000_000_000
    const recentNote = fx.noteStore.create({
      workspace_id: fx.wsA,
      selected_text: 'recent',
      created_at: now - 2 * MS_PER_DAY
    })
    const oldNote = fx.noteStore.create({
      workspace_id: fx.wsA,
      selected_text: 'ancient',
      created_at: now - 1000 * MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(recentNote.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertNoteEmbedding(oldNote.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      timeRange: { from: now - 7 * MS_PER_DAY, to: now },
      now
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].noteId).toBe(recentNote.id)
  })
})

describe('SearchService — 워크스페이스 partition', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('다른 워크스페이스 의 Page / Note 누설 차단', async () => {
    const now = 1_000_000_000_000
    const { page: pageA } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now - MS_PER_DAY
    })
    const { page: pageB } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsB,
      url: 'https://b',
      content: 'b',
      visited_at: now - MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(pageA.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertPageEmbedding(pageB.id, fx.wsB, makeVec({ 0: 1 }))

    const noteA = fx.noteStore.create({
      workspace_id: fx.wsA,
      page_id: pageA.id,
      selected_text: 'A',
      created_at: now - MS_PER_DAY
    })
    const noteB = fx.noteStore.create({
      workspace_id: fx.wsB,
      page_id: pageB.id,
      selected_text: 'B',
      created_at: now - MS_PER_DAY
    })
    fx.vec.upsertNoteEmbedding(noteA.id, fx.wsA, makeVec({ 0: 1 }))
    fx.vec.upsertNoteEmbedding(noteB.id, fx.wsB, makeVec({ 0: 1 }))

    const hitsA = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hitsA.every((h) => h.workspaceId === fx.wsA)).toBe(true)
    // Page hit + Note hit 둘 다 pageA.id anchor — pageId 컬럼 2건 모두 pageA
    expect(hitsA.map((h) => h.pageId).filter((x) => x !== null)).toEqual([pageA.id, pageA.id])
    expect(hitsA.map((h) => h.noteId).filter((x) => x !== null)).toEqual([noteA.id])
    // 다른 워크스페이스 pageB / noteB 누설 X
    expect(hitsA.some((h) => h.pageId === pageB.id)).toBe(false)
    expect(hitsA.some((h) => h.noteId === noteB.id)).toBe(false)
  })
})

describe('SearchService — 입력 검증', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('topK 0 — throw', () => {
    expect(() =>
      fx.service.search({
        workspaceId: fx.wsA,
        queryEmbedding: makeVec({ 0: 1 }),
        topK: 0
      })
    ).toThrow(/topK/)
  })

  it('topK 음수 — throw', () => {
    expect(() =>
      fx.service.search({
        workspaceId: fx.wsA,
        queryEmbedding: makeVec({ 0: 1 }),
        topK: -1
      })
    ).toThrow(/topK/)
  })

  it('topK 비-정수 — throw', () => {
    expect(() =>
      fx.service.search({
        workspaceId: fx.wsA,
        queryEmbedding: makeVec({ 0: 1 }),
        topK: 1.5
      })
    ).toThrow(/topK/)
  })

  it('eFoldingDays 0 — constructor throw', () => {
    expect(
      () =>
        new SearchService({
          vectorIndex: fx.vec,
          pageStore: fx.pageStore,
          noteStore: fx.noteStore,
          eFoldingDays: 0
        })
    ).toThrow(/eFoldingDays/)
  })

  it('eFoldingDays 음수 — constructor throw', () => {
    expect(
      () =>
        new SearchService({
          vectorIndex: fx.vec,
          pageStore: fx.pageStore,
          noteStore: fx.noteStore,
          eFoldingDays: -1
        })
    ).toThrow(/eFoldingDays/)
  })

  it('topK 미주입 시 DEFAULT_TOP_K (20) 적용 — VectorIndex 호출 검증', async () => {
    // page 25개 등록 → topK=20 (디폴트) 시 20개만 반환
    const now = 1_000_000_000_000
    for (let i = 0; i < 25; i++) {
      const { page } = await fx.pageStore.recordVisit({
        workspace_id: fx.wsA,
        url: `https://p-${i}`,
        content: 'b',
        visited_at: now - i * MS_PER_DAY
      })
      // 모두 동일 embedding → distance 모두 0 → topK 만큼만 잘림
      fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))
    }
    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits.length).toBeLessThanOrEqual(DEFAULT_TOP_K)
    expect(hits.length).toBe(DEFAULT_TOP_K)
  })
})

describe('SearchService — e-folding 수학', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('daysAgo=180 일 때 timeFactor = 1/e (≈ 0.3679)', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now - 180 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].timeFactor).toBeCloseTo(1 / Math.E, 4)
  })

  it('daysAgo=0 일 때 timeFactor = 1', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const hits = fx.service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].timeFactor).toBeCloseTo(1, 5)
  })

  it('eFoldingDays override — timeFactor 계산 반영', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now - 30 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const service30 = new SearchService({
      vectorIndex: fx.vec,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore,
      eFoldingDays: 30 // 30일 e-folding → daysAgo=30 시 1/e
    })
    const hits = service30.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].timeFactor).toBeCloseTo(1 / Math.E, 4)
  })

  it('α / β override — score 계산 반영', async () => {
    const now = 1_000_000_000_000
    const { page } = await fx.pageStore.recordVisit({
      workspace_id: fx.wsA,
      url: 'https://a',
      content: 'b',
      visited_at: now - 180 * MS_PER_DAY
    })
    fx.vec.upsertPageEmbedding(page.id, fx.wsA, makeVec({ 0: 1 }))

    const service = new SearchService({
      vectorIndex: fx.vec,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore,
      alpha: 0.5,
      beta: 0.5
    })
    const hits = service.search({
      workspaceId: fx.wsA,
      queryEmbedding: makeVec({ 0: 1 }),
      now
    })
    expect(hits[0].score).toBeCloseTo(0.5 * 1 + 0.5 * (1 / Math.E), 4)
  })
})

describe('paginate()', () => {
  function dummyHits(n: number): import('../../../src/main/SearchService').SearchHit[] {
    return Array.from({ length: n }, (_, i) => ({
      type: 'page' as const,
      pageId: `p${i}`,
      noteId: null,
      visitId: `v${i}`,
      workspaceId: 'ws',
      cosineSim: 1 - i * 0.001,
      distance: i * 0.001,
      visitedAt: 1_000_000_000_000 - i * MS_PER_DAY,
      daysAgo: i,
      timeFactor: Math.exp(-i / 180),
      score: 0.85 * (1 - i * 0.001) + 0.15 * Math.exp(-i / 180),
      dwellMs: 0,
      title: `t${i}`,
      url: `https://p${i}`,
      contentSnippet: 'x'
    }))
  }

  it('pageIndex=0 → 첫 10개 slice', () => {
    const r = paginate(dummyHits(25), 0)
    expect(r.hits).toHaveLength(10)
    expect(r.hits[0].pageId).toBe('p0')
    expect(r.hits[9].pageId).toBe('p9')
    expect(r.hasMore).toBe(true)
    expect(r.maxReached).toBe(false)
  })

  it('pageIndex=1 → 10..40 slice (30개 추가, PRD §9.8)', () => {
    const r = paginate(dummyHits(50), 1)
    expect(r.hits).toHaveLength(30)
    expect(r.hits[0].pageId).toBe('p10')
    expect(r.hits[29].pageId).toBe('p39')
    expect(r.hasMore).toBe(true)
    expect(r.maxReached).toBe(true)
  })

  it('pageIndex=2 → 40..50 slice', () => {
    const r = paginate(dummyHits(50), 2)
    expect(r.hits).toHaveLength(10)
    expect(r.hits[0].pageId).toBe('p40')
    expect(r.hits[9].pageId).toBe('p49')
    expect(r.hasMore).toBe(false)
    expect(r.maxReached).toBe(true)
  })

  it('hits 적을 때 — hasMore=false, maxReached=false', () => {
    const r = paginate(dummyHits(5), 0)
    expect(r.hits).toHaveLength(5)
    expect(r.hasMore).toBe(false)
    expect(r.maxReached).toBe(false)
  })

  it('hits === pageSize — hasMore=false', () => {
    const r = paginate(dummyHits(10), 0)
    expect(r.hits).toHaveLength(10)
    expect(r.hasMore).toBe(false)
    expect(r.maxReached).toBe(false)
  })

  it('cap MAX_RESULTS (50) 초과 시 maxReached=true', () => {
    const r = paginate(dummyHits(80), 0)
    expect(r.hits).toHaveLength(10)
    expect(r.maxReached).toBe(true)
    expect(r.totalRetrieved).toBe(80)
  })

  it('cap 도달 시 pageIndex=2 가 마지막 슬라이스 (50 도달 후 hasMore=false)', () => {
    const r = paginate(dummyHits(60), 2)
    expect(r.hits).toHaveLength(10)
    expect(r.hits[0].pageId).toBe('p40')
    expect(r.hasMore).toBe(false)
    expect(r.maxReached).toBe(true)
  })

  it('pageIndex 음수 — throw', () => {
    expect(() => paginate(dummyHits(10), -1)).toThrow(/pageIndex/)
  })

  it('pageIndex 비-정수 — throw', () => {
    expect(() => paginate(dummyHits(10), 0.5)).toThrow(/pageIndex/)
  })

  it('pageSize 0 — throw', () => {
    expect(() => paginate(dummyHits(10), 0, 0)).toThrow(/pageSize/)
  })

  it('pageSize 음수 — throw', () => {
    expect(() => paginate(dummyHits(10), 0, -1)).toThrow(/pageSize/)
  })

  it('MAX_RESULTS 상수 = 50 (PRD §9.8 cap 정합)', () => {
    expect(MAX_RESULTS).toBe(50)
  })
})
