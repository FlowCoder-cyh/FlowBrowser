/**
 * Sprint 016 M0 T06 — perf bench (KI-011 MemoryStats < 20ms).
 *
 * PRD §11.3.2 / §11.8 — 워크스페이스 사이드바 MemoryStats 표시 SELECT 5종 합 평균 20ms 임계.
 *
 * 측정:
 *   - 1K 페이지 시드 → MemoryService.getStats(ws) bench
 *   - 10K 페이지 시드 → MemoryService.getStats(ws) bench (denormalized 통계 확장 검증)
 *
 * 임계: 평균 hz × 20ms = 50/s 이상 (1회당 < 20ms).
 * 미달 시: 후속 hotfix 또는 KI-011 status `open` 유지 (Sprint 016 contract §6 매트릭스 #7).
 */

import { bench, describe, beforeAll, afterAll } from 'vitest'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../src/storage/NoteStore'
import { AiChatHistoryStore } from '../../src/storage/AiChatHistoryStore'
import { MemoryService } from '../../src/main/MemoryService'

interface Fx {
  fb: FlowbrowserDatabase
  svc: MemoryService
  wsId: string
}

async function setup(pagesCount: number): Promise<Fx> {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const chatStore = new AiChatHistoryStore(fb)
  const svc = new MemoryService({ pageStore, noteStore, chatStore })
  const base = Date.now()
  for (let i = 0; i < pagesCount; i++) {
    await pageStore.recordVisit({
      workspace_id: ws.id,
      url: `https://example.com/p${i}`,
      title: `Page ${i}`,
      content: `body ${i}`,
      visited_at: base + i * 1000
    })
  }
  return { fb, svc, wsId: ws.id }
}

describe('KI-011 MemoryStats < 20ms (1K pages)', () => {
  let fx: Fx
  beforeAll(async () => {
    fx = await setup(1_000)
  }, 60_000)
  afterAll(() => {
    fx.fb.close()
  })

  bench(
    'MemoryService.getStats — 1K pages',
    () => {
      fx.svc.getStats(fx.wsId)
    },
    { time: 3000, warmupIterations: 5, warmupTime: 500 }
  )
})

describe('KI-011 MemoryStats < 20ms (10K pages)', () => {
  let fx: Fx
  beforeAll(async () => {
    fx = await setup(10_000)
  }, 120_000)
  afterAll(() => {
    fx.fb.close()
  })

  bench(
    'MemoryService.getStats — 10K pages',
    () => {
      fx.svc.getStats(fx.wsId)
    },
    { time: 3000, warmupIterations: 5, warmupTime: 500 }
  )
})
