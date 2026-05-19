/**
 * Sprint 016 M0 T06 — perf baseline 실측 (vitest test 모드).
 *
 * vitest 2.1.x bench mode 가 sqlite-vec + beforeAll 시드 조합에서 samples 0 측정 한계.
 * 본 test 는 performance.now() manual measurement 로 8종 매트릭스 baseline 박음.
 * 임계 위반 시 expect 가 fail → KI status `open` 유지 + 후속 hotfix.
 *
 * 임계 (PRD §15.4 + §11.3.2 + §11.8):
 *   - KI-011 MemoryStats < 20ms (1K + 10K pages)
 *   - KI-012 IndexingService.indexPage < 500ms (1KB body, 신규 URL)
 *   - KI-014 WorkspaceService.setActive < 1초 (10 ws × 10 tabs)
 *   - KI-015 estimateMonthlyCostUsd < $3 / 월 (1만 페이지)
 *   - KI-016 SQLite 파일 크기 < 200MB / 1만 페이지 + 임베딩
 *   - KI-013 SearchService.search < 200ms top-10 (1000 pages + 임베딩) — 별도 it 분기 (시드 무거움)
 *
 * 측정 패턴:
 *   warmup N회 + 본 측정 M회 → mean ms/call.
 *   expect(mean).toBeLessThan(threshold) — 임계 미달 시 KI status open 강제.
 */

import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../src/storage/NoteStore'
import { AiChatHistoryStore } from '../../src/storage/AiChatHistoryStore'
import { MemoryService } from '../../src/main/MemoryService'
import { IndexingGate } from '../../src/privacy/IndexingGate'
import { EmbeddingQueue } from '../../src/storage/EmbeddingQueue'
import { IndexingService } from '../../src/main/IndexingService'
import { UserSettingStore } from '../../src/storage/UserSettingStore'
import { WorkspaceService } from '../../src/main/WorkspaceService'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../src/storage/VectorIndex'
import { SearchService } from '../../src/main/SearchService'
import { estimateMonthlyCostUsd } from '../perf/embeddingCostHelpers'

function randomVec(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
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

async function measureAsync<T>(fn: () => Promise<T>, iterations: number, warmup = 5): Promise<{ mean: number; min: number; max: number; iterations: number }> {
  for (let i = 0; i < warmup; i++) await fn()
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const s = performance.now()
    await fn()
    samples.push(performance.now() - s)
  }
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    iterations: samples.length
  }
}

function measureSync<T>(fn: () => T, iterations: number, warmup = 5): { mean: number; min: number; max: number; iterations: number } {
  for (let i = 0; i < warmup; i++) fn()
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const s = performance.now()
    fn()
    samples.push(performance.now() - s)
  }
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    iterations: samples.length
  }
}

describe('Sprint 016 M0 T06 — perf baseline 매트릭스', () => {
  it('KI-011 MemoryStats < 20ms (1K pages)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
    const noteStore = new NoteStore(fb)
    const chatStore = new AiChatHistoryStore(fb)
    const svc = new MemoryService({ pageStore, noteStore, chatStore })
    const base = Date.now()
    for (let i = 0; i < 1_000; i++) {
      await pageStore.recordVisit({
        workspace_id: ws.id,
        url: `https://m.example/p${i}`,
        title: `P${i}`,
        content: `b${i}`,
        visited_at: base + i * 1000
      })
    }
    const r = measureSync(() => svc.getStats(ws.id), 100)
    console.log(`  [KI-011 1K] mean=${r.mean.toFixed(3)}ms / min=${r.min.toFixed(3)} / max=${r.max.toFixed(3)} (n=${r.iterations})`)
    expect(r.mean).toBeLessThan(20)
    fb.close()
  }, 60_000)

  it('KI-011 MemoryStats < 20ms (10K pages)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
    const noteStore = new NoteStore(fb)
    const chatStore = new AiChatHistoryStore(fb)
    const svc = new MemoryService({ pageStore, noteStore, chatStore })
    const base = Date.now()
    for (let i = 0; i < 10_000; i++) {
      await pageStore.recordVisit({
        workspace_id: ws.id,
        url: `https://m.example/p${i}`,
        title: `P${i}`,
        content: `b${i}`,
        visited_at: base + i * 1000
      })
    }
    const r = measureSync(() => svc.getStats(ws.id), 50)
    console.log(`  [KI-011 10K] mean=${r.mean.toFixed(3)}ms / min=${r.min.toFixed(3)} / max=${r.max.toFixed(3)} (n=${r.iterations})`)
    expect(r.mean).toBeLessThan(20)
    fb.close()
  }, 120_000)

  it('KI-012 IndexingService.indexPage < 500ms (1KB body, 신규 URL)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
    const embeddingQueue = new EmbeddingQueue(fb)
    const gate = new IndexingGate()
    const service = new IndexingService({ gate, pageStore, embeddingQueue })
    const body = 'lorem ipsum dolor sit amet, '.repeat(40)
    let counter = 0
    const r = await measureAsync(
      () =>
        service.indexPage({
          url: `https://ix.example/p${counter++}`,
          title: `Ix ${counter}`,
          content: body,
          hasPasswordField: false,
          workspaceId: ws.id,
          isActiveTab: true
        }),
      100,
      5
    )
    console.log(`  [KI-012] mean=${r.mean.toFixed(3)}ms / min=${r.min.toFixed(3)} / max=${r.max.toFixed(3)} (n=${r.iterations})`)
    expect(r.mean).toBeLessThan(500)
    fb.close()
  }, 60_000)

  it('KI-013 SearchService.search < 200ms top-10 (1000 pages + 임베딩)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
    const noteStore = new NoteStore(fb)
    const vec = new VectorIndex(fb)
    const svc = new SearchService({ vectorIndex: vec, pageStore, noteStore })
    const base = Date.now() - 1000 * 60_000
    for (let i = 0; i < 1_000; i++) {
      const { page } = await pageStore.recordVisit({
        workspace_id: ws.id,
        url: `https://s.example/p${i}`,
        title: `P${i}`,
        content: `b${i}`,
        visited_at: base + i * 60_000
      })
      vec.upsertPageEmbedding(page.id, ws.id, randomVec(i + 1))
    }
    const queryVec = randomVec(99_999)
    const r = measureSync(
      () => svc.search({ workspaceId: ws.id, queryEmbedding: queryVec, topK: 20 }),
      50
    )
    console.log(`  [KI-013] mean=${r.mean.toFixed(3)}ms / min=${r.min.toFixed(3)} / max=${r.max.toFixed(3)} (n=${r.iterations})`)
    expect(r.mean).toBeLessThan(200)
    fb.close()
  }, 180_000)

  it('KI-014 WorkspaceService.setActive < 1초 (10 ws × 10 tabs)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const defaultWs = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
    const tmpDir = mkdtempSync(join(tmpdir(), 'fb-perf-ws-'))
    const userSettingStore = new UserSettingStore(join(tmpDir, 'user-setting.json'))
    await userSettingStore.load()
    const svc = new WorkspaceService({ db: fb, userSettingStore, defaultWorkspace: defaultWs })
    const wsIds: string[] = [defaultWs.id]
    for (let w = 1; w < 10; w++) {
      const wsRow = await svc.create({ name: `WS ${w}`, icon: '📦' })
      wsIds.push(wsRow.id)
    }
    const base = Date.now()
    for (const wsId of wsIds) {
      for (let t = 0; t < 10; t++) {
        await pageStore.recordVisit({
          workspace_id: wsId,
          url: `https://ws-${wsId}.example/tab${t}`,
          title: `Tab ${t}`,
          content: `b${t}`,
          visited_at: base + t * 1000
        })
      }
    }
    let cycle = 0
    const r = await measureAsync(
      async () => {
        cycle = (cycle + 1) % wsIds.length
        await svc.setActive(wsIds[cycle])
      },
      50,
      5
    )
    console.log(`  [KI-014] mean=${r.mean.toFixed(3)}ms / min=${r.min.toFixed(3)} / max=${r.max.toFixed(3)} (n=${r.iterations})`)
    expect(r.mean).toBeLessThan(1000)
    fb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }, 60_000)

  it('KI-015 estimateMonthlyCostUsd < $3 / 월 (1만 페이지)', () => {
    const cost = estimateMonthlyCostUsd(10_000, 1000)
    console.log(`  [KI-015] cost=$${cost.toFixed(4)} / 월 (1만 페이지 × 1000 tokens)`)
    expect(cost).toBeLessThan(3)
    expect(cost).toBeCloseTo(0.2, 5)
  })

  it('KI-016 SQLite 파일 크기 < 200MB / 1만 페이지 + 임베딩', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'fb-perf-size-'))
    const dbPath = join(tmpDir, 'storage-bench.db')
    const fb = FlowbrowserDatabase.bootstrap({ path: dbPath, enableWal: true })
    const ws = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
    const vec = new VectorIndex(fb)
    const body = 'lorem ipsum dolor sit amet, '.repeat(150) // ~4KB
    const base = Date.now()
    for (let i = 0; i < 10_000; i++) {
      const { page } = await pageStore.recordVisit({
        workspace_id: ws.id,
        url: `https://size.example/p${i}`,
        title: `P${i}`,
        content: body,
        visited_at: base + i * 60_000
      })
      vec.upsertPageEmbedding(page.id, ws.id, randomVec(i + 1))
    }
    fb.close()
    const sizeBytes = statSync(dbPath).size
    const sizeMb = sizeBytes / (1024 * 1024)
    console.log(`  [KI-016] size=${sizeMb.toFixed(2)}MB / 10K pages + 임베딩`)
    expect(sizeMb).toBeLessThan(200)
    rmSync(tmpDir, { recursive: true, force: true })
  }, 300_000)
})
