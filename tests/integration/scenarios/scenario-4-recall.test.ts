/**
 * Sprint 015 M6 T30 — 시나리오 4 (우연 재발견) 회귀 테스트.
 *
 * 입력: `.flowset/specs/v04-test-classification.md` §E1 시나리오 4 (3 케이스 S4-C1 ~ S4-C3)
 * Phase 1 종료 evaluator AC-8 핵심. 본 회귀 셋 100% 통과 시 시나리오 4 P1 cover.
 *
 * 통합 모듈:
 *   - TimeRangeParser (자연어 시간 5종 표현)
 *   - VectorIndex + IndexedPageStoreSqlite + SearchService (정렬 공식 검증)
 *   - timeSignal (dwell_ms 시그널 포맷)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { SearchService } from '../../../src/main/SearchService'
import { parseTimeRange } from '../../../src/main/TimeRangeParser'
import { formatTimeSignal } from '../../../src/renderer/src/search/timeSignal'

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

const DAY = 86_400_000

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
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const search = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  return { fb, vec, pageStore, noteStore, search, wsId: ws.id }
}

describe('시나리오 4 — 우연 재발견 회귀 셋', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  /**
   * S4-C1 — 자연어 시간 파싱 5종 표현 통합 검증.
   * 단위 테스트는 TimeRangeParser.test.ts 에 cover. 본 시나리오는 통합 흐름.
   */
  it('S4-C1: 자연어 시간 파싱 5종 표현', () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime()
    // 1. recent — "어제"
    const yesterday = parseTimeRange('어제', { now })
    expect(yesterday.matched).toBe('어제')
    expect(yesterday.range).not.toBeNull()
    expect(yesterday.range!.to).toBeGreaterThan(yesterday.range!.from)

    // 2. recent — "지난주"
    const lastweek = parseTimeRange('지난주', { now })
    expect(lastweek.matched).toBe('지난주')
    expect(lastweek.range).not.toBeNull()

    // 3. fix window — "3개월 전"
    const threeMonthsAgo = parseTimeRange('3개월 전', { now })
    expect(threeMonthsAgo.matched).toBe('3개월 전')
    expect(threeMonthsAgo.range).not.toBeNull()
    expect(threeMonthsAgo.range!.from).toBeLessThan(now - 60 * DAY)

    // 4. approx — "6개월 전쯤"
    const sixMonthsApprox = parseTimeRange('6개월 전쯤', { now })
    expect(sixMonthsApprox.matched).toBe('6개월 전쯤')
    expect(sixMonthsApprox.range).not.toBeNull()

    // 5. 절대 — "2026-05-01"
    const absolute = parseTimeRange('2026-05-01', { now })
    expect(absolute.matched).toBe('2026-05-01')
    expect(absolute.range).not.toBeNull()

    // 5종 표현 모두 통과 — remainingQuery 도 정합
    expect(yesterday.remainingQuery).toBe('')
    expect(threeMonthsAgo.remainingQuery).toBe('')
  })

  /**
   * S4-C2 — 의미 임베딩 + 시간 필터 + 180일 반감기 공식 → top-3 hit rate.
   * 같은 cosine 유사도라도 시간 가까운 페이지가 더 높은 score.
   * 다른 시간 안에 있는 페이지는 시간 필터로 제외.
   */
  it('S4-C2: 의미 + 시간 필터 + 180일 반감기 정렬', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime()
    // 3 페이지: 6개월 전 마이크로서비스 / 1년 전 모놀리스 / 1주 전 기타
    const microRecent = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://eng.example/microservices',
      title: 'Microservices vs Monolith',
      content: 'Microservices architecture trade-offs.',
      visited_at: now - 180 * DAY // 6개월 전
    })
    const monoOlder = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://eng.example/monolith',
      title: 'Monolith first principles',
      content: 'Monolith is simple and fast.',
      visited_at: now - 365 * DAY // 1년 전
    })
    const otherRecent = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://news.example/random',
      title: 'Random news',
      content: 'Unrelated news.',
      visited_at: now - 7 * DAY // 1주 전
    })

    // 임베딩 — micro/mono 가 query 와 가까움 (dim 0 우세)
    fx.vec.upsertPageEmbedding(microRecent.page.id, fx.wsId, makeVec({ 0: 1.0, 1: 0.4 }))
    fx.vec.upsertPageEmbedding(monoOlder.page.id, fx.wsId, makeVec({ 0: 1.0, 1: 0.3 }))
    fx.vec.upsertPageEmbedding(otherRecent.page.id, fx.wsId, makeVec({ 5: 1.0 }))

    const query = makeVec({ 0: 1.0, 1: 0.35 })

    // 시간 필터 없이 검색 — 6개월 전 micro 가 1년 전 mono 보다 score 높음 (시간 가중)
    const hits = fx.search.search({
      workspaceId: fx.wsId,
      queryEmbedding: query,
      topK: 10,
      now
    })
    const microHit = hits.find((h) => h.pageId === microRecent.page.id)!
    const monoHit = hits.find((h) => h.pageId === monoOlder.page.id)!
    expect(microHit.score).toBeGreaterThan(monoHit.score)

    // 180일 반감기 검증 — micro daysAgo ≈ 180 → timeFactor ≈ 1/e ≈ 0.368
    expect(microHit.daysAgo!).toBeCloseTo(180, 0)
    expect(microHit.timeFactor).toBeCloseTo(Math.exp(-1), 2)

    // 시간 필터 "6개월 전쯤" → micro 만 포함, mono 제외 (1년 전 — margin 밖)
    const range = parseTimeRange('6개월 전쯤', { now })
    expect(range.range).not.toBeNull()
    const filtered = fx.search.search({
      workspaceId: fx.wsId,
      queryEmbedding: query,
      topK: 10,
      timeRange: range.range,
      now
    })
    expect(filtered.find((h) => h.pageId === microRecent.page.id)).toBeDefined()
    expect(filtered.find((h) => h.pageId === monoOlder.page.id)).toBeUndefined()
  })

  /**
   * S4-C3 — dwell_ms 시그널 — 검색 결과 카드에 dwell 표시.
   * formatTimeSignal 활용 — "18분 머묾" / "짧게 본 거" 포맷.
   */
  it('S4-C3: dwell_ms 시그널 (긴 머묾 / 짧게 본 거)', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime()
    // 18분 머문 페이지
    const longDwell = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://academic.example/deep',
      title: 'Deep article',
      content: 'long content',
      visited_at: now - 5 * DAY,
      dwell_ms: 18 * 60_000 // 18분
    })
    // 30초 짧게 본 페이지
    const shortDwell = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://news.example/glance',
      title: 'Glance',
      content: 'short',
      visited_at: now - 5 * DAY,
      dwell_ms: 30_000 // 30초
    })

    fx.vec.upsertPageEmbedding(longDwell.page.id, fx.wsId, makeVec({ 0: 1.0 }))
    fx.vec.upsertPageEmbedding(shortDwell.page.id, fx.wsId, makeVec({ 0: 1.0, 1: 0.1 }))

    const hits = fx.search.search({
      workspaceId: fx.wsId,
      queryEmbedding: makeVec({ 0: 1.0 }),
      topK: 10,
      now
    })
    const longHit = hits.find((h) => h.pageId === longDwell.page.id)!
    const shortHit = hits.find((h) => h.pageId === shortDwell.page.id)!

    expect(longHit.dwellMs).toBe(18 * 60_000)
    expect(shortHit.dwellMs).toBe(30_000)

    // formatTimeSignal — visitedAt + dwellMs 결합 ("5일 전, 18분 머묾" / "5일 전, 짧게 본 거")
    const longSignal = formatTimeSignal(longHit.visitedAt!, longHit.dwellMs, now)
    const shortSignal = formatTimeSignal(shortHit.visitedAt!, shortHit.dwellMs, now)
    expect(longSignal).toMatch(/18분/)
    expect(shortSignal).toMatch(/짧게|잠깐|순간|짧/)
  })
})
