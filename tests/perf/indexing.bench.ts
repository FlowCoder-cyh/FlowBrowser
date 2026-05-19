/**
 * Sprint 016 M0 T06 — perf bench (KI-012 인덱싱 < 500ms / 페이지).
 *
 * PRD §15.4 #1 / §8.10 — 페이지 인덱싱 라이프사이클 (IndexingGate + recordVisit + EmbeddingQueue.enqueue) 평균 500ms 임계.
 *
 * 측정: IndexingService.indexPage() 1회 (gate evaluate + TX + queue enqueue) bench.
 *   - 본문 1KB 텍스트
 *   - 신규 URL (Page UPSERT created) 케이스
 *
 * 임계: 평균 hz × 500ms = 2/s 이상 (1회당 < 500ms).
 * 미달 시: 후속 hotfix 또는 KI-012 status `open` 유지 (Sprint 016 contract §6 매트릭스 #1).
 *
 * 비고: 실제 임베딩 호출은 EmbeddingQueue 에 enqueue 만 (비동기 워커가 OpenAI 호출).
 *       본 bench 는 큐 등록까지의 동기 경로만 측정.
 */

import { bench, describe, beforeAll, afterAll } from 'vitest'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { EmbeddingQueue } from '../../src/storage/EmbeddingQueue'
import { IndexingGate } from '../../src/privacy/IndexingGate'
import { IndexingService } from '../../src/main/IndexingService'

interface Fx {
  fb: FlowbrowserDatabase
  service: IndexingService
  wsId: string
  counter: number
  body: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const embeddingQueue = new EmbeddingQueue(fb)
  const gate = new IndexingGate()
  const service = new IndexingService({ gate, pageStore, embeddingQueue })
  // PRD §15.4 #1 측정 가정: 본문 ≈ 1KB (한 페이지 대표값)
  const body = 'lorem ipsum dolor sit amet, '.repeat(40) // ~1.1KB
  return { fb, service, wsId: ws.id, counter: 0, body }
}

describe('KI-012 인덱싱 < 500ms / 페이지', () => {
  let fx: Fx
  beforeAll(() => {
    fx = setup()
  })
  afterAll(() => {
    fx.fb.close()
  })

  bench(
    'IndexingService.indexPage — 신규 URL (gate + TX + enqueue)',
    async () => {
      fx.counter += 1
      await fx.service.indexPage({
        url: `https://bench.example/p${fx.counter}`,
        title: `Bench ${fx.counter}`,
        content: fx.body,
        hasPasswordField: false,
        workspaceId: fx.wsId,
        isActiveTab: true
      })
    }
  )
})
