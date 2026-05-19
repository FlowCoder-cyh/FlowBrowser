/**
 * Sprint 016 M0 T06 — perf bench (KI-013 검색 < 200ms top-10).
 *
 * PRD §15.4 #2 / §9.7 — VectorIndex.searchPages/Notes top-K KNN + metadata fetch + 시간 가중 정렬 평균 200ms 임계.
 *
 * 측정: 1000 페이지 시드 + 임베딩 → SearchService.search({topK: 20}) bench × 100회 평균.
 *
 * 임계: 평균 hz × 200ms = 5/s 이상 (1회당 < 200ms).
 * 미달 시: 후속 hotfix 또는 KI-013 status `open` 유지 (Sprint 016 contract §6 매트릭스 #2).
 *
 * 비고: 본문 캐시 fetch 는 임계 대상 외 (PRD §9.7 "top-10 표시까지, 본문 캐시 fetch 제외").
 */

import { bench, describe, beforeAll, afterAll } from 'vitest'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../src/storage/VectorIndex'
import { NoteStore } from '../../src/storage/NoteStore'
import { SearchService } from '../../src/main/SearchService'

interface Fx {
  fb: FlowbrowserDatabase
  service: SearchService
  wsId: string
  queryVec: Float32Array
}

function randomNormalizedVec(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
  // deterministic pseudo-random per seed
  let s = seed
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    s = (s * 9301 + 49297) % 233280
    v[i] = (s / 233280) * 2 - 1
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

async function setup(pagesCount: number): Promise<Fx> {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const vec = new VectorIndex(fb)
  const service = new SearchService({ vectorIndex: vec, pageStore, noteStore })

  const base = Date.now() - pagesCount * 60_000
  for (let i = 0; i < pagesCount; i++) {
    const { page } = await pageStore.recordVisit({
      workspace_id: ws.id,
      url: `https://example.com/p${i}`,
      title: `Page ${i}`,
      content: `body ${i}`,
      visited_at: base + i * 60_000
    })
    vec.upsertPageEmbedding(page.id, ws.id, randomNormalizedVec(i + 1))
  }
  return { fb, service, wsId: ws.id, queryVec: randomNormalizedVec(99_999) }
}

describe('KI-013 검색 < 200ms top-10 (1000 pages)', () => {
  let fx: Fx
  beforeAll(async () => {
    fx = await setup(1_000)
  }, 120_000)
  afterAll(() => {
    fx.fb.close()
  })

  bench('SearchService.search — topK=20 / 1000 pages', () => {
    fx.service.search({
      workspaceId: fx.wsId,
      queryEmbedding: fx.queryVec,
      topK: 20
    })
  })
})
