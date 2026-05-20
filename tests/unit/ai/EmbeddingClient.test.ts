/**
 * Sprint 015 M3-5 — EmbeddingClient + processNextEmbeddingJob 단위 테스트.
 *
 * Fake ProviderAdapter (네트워크 없음) 로 검증:
 *   - embed 미지원 provider → throw
 *   - 정상 batch + 단일 텍스트 편의
 *   - dimensions 검증 (response vector 길이 != 1024 → throw)
 *   - vector count mismatch → throw
 *   - 빈 texts → throw
 *   - embedPage / embedNote 본문 추출
 *
 * processNextEmbeddingJob:
 *   - 빈 큐 → 'idle'
 *   - page 성공 → vectorIndex 업데이트 + markSucceeded
 *   - note 성공 → vectorIndex 업데이트 + markSucceeded
 *   - target 미존재 (orphan) → markFailed
 *   - embed 실패 → markFailed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import {
  EmbeddingClient,
  DEFAULT_EMBEDDING_MODEL,
  processNextEmbeddingJob
} from '../../../src/ai/embedding/EmbeddingClient'
import type {
  ProviderAdapter,
  ProviderInfo,
  EmbedRequest,
  EmbedResponse
} from '../../../src/ai'

function makeVector(seed: number, dims: number = EMBEDDING_DIMENSIONS): number[] {
  const out = new Array<number>(dims)
  for (let i = 0; i < dims; i++) out[i] = Math.sin(seed + i * 0.01)
  return out
}

function fakeProvider(opts: {
  hasEmbed: boolean
  embedImpl?: (req: EmbedRequest) => Promise<EmbedResponse> | EmbedResponse
}): ProviderAdapter {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'Fake',
    supportedRequestTypes: ['selection'],
    defaultModel: 'fake-model',
    availableModels: ['fake-model'],
    supportsChat: true,
    supportsEmbed: opts.hasEmbed
  }
  const base: ProviderAdapter = {
    info,
    async validate() {
      return { ok: true }
    }
  }
  if (opts.hasEmbed) {
    base.embed = opts.embedImpl
      ? async (req) => {
          const r = await opts.embedImpl!(req)
          return r
        }
      : async (req) => ({
          vectors: req.texts.map((_, i) => makeVector(i + 1, req.dimensions ?? EMBEDDING_DIMENSIONS)),
          modelUsed: req.modelHint ?? DEFAULT_EMBEDDING_MODEL,
          inputTokens: req.texts.reduce((s, t) => s + t.length, 0),
          estimatedCostUsd: 0.0001,
          durationMs: 12
        })
  }
  return base
}

interface Fx {
  fb: FlowbrowserDatabase
  vector: VectorIndex
  queue: EmbeddingQueue
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  wsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsId = fb.ensureDefaultWorkspace().id
  return {
    fb,
    vector: new VectorIndex(fb),
    queue: new EmbeddingQueue(fb),
    pageStore: new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: wsId }),
    noteStore: new NoteStore(fb),
    wsId
  }
}

describe('EmbeddingClient', () => {
  it('throws when provider.embed not implemented (Codex OAuth case)', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: false }) })
    await expect(client.embedTexts(['hi'])).rejects.toThrow(/does not support embed/)
  })

  it('embedTexts batch — 차원 검증 + Float32Array 반환', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const result = await client.embedTexts(['a', 'b', 'c'])
    expect(result.vectors).toHaveLength(3)
    for (const v of result.vectors) {
      expect(v).toBeInstanceOf(Float32Array)
      expect(v.length).toBe(EMBEDDING_DIMENSIONS)
    }
    expect(result.modelUsed).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(result.inputTokens).toBeGreaterThan(0)
  })

  it('embedText 단일 텍스트 편의 메서드', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const { vector, modelUsed } = await client.embedText('hello')
    expect(vector.length).toBe(EMBEDDING_DIMENSIONS)
    expect(modelUsed).toBe(DEFAULT_EMBEDDING_MODEL)
  })

  it('빈 texts → throw', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    await expect(client.embedTexts([])).rejects.toThrow(/at least 1 text/)
  })

  it('차원 mismatch (provider 가 잘못된 차원 반환) → throw', async () => {
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (req) => ({
        vectors: req.texts.map(() => new Array(512).fill(0)), // 잘못된 512 차원
        modelUsed: 'm',
        inputTokens: 1,
        estimatedCostUsd: 0,
        durationMs: 1
      })
    })
    const client = new EmbeddingClient({ provider })
    await expect(client.embedTexts(['x'])).rejects.toThrow(/dimension mismatch/)
  })

  it('vector count mismatch → throw', async () => {
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (_req) => ({
        vectors: [makeVector(1)], // 1개만 반환
        modelUsed: 'm',
        inputTokens: 1,
        estimatedCostUsd: 0,
        durationMs: 1
      })
    })
    const client = new EmbeddingClient({ provider })
    await expect(client.embedTexts(['a', 'b', 'c'])).rejects.toThrow(/returned 1 vectors for 3 texts/)
  })

  it('custom dimensions + modelHint 전달', async () => {
    const spy = vi.fn()
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (req) => {
        spy(req)
        return {
          vectors: req.texts.map(() => makeVector(0, req.dimensions ?? EMBEDDING_DIMENSIONS)),
          modelUsed: req.modelHint ?? 'm',
          inputTokens: 1,
          estimatedCostUsd: 0,
          durationMs: 1
        }
      }
    })
    const client = new EmbeddingClient({
      provider,
      modelHint: 'text-embedding-3-large',
      dimensions: EMBEDDING_DIMENSIONS // 명시
    })
    await client.embedText('hi')
    expect(spy).toHaveBeenCalledWith({
      texts: ['hi'],
      modelHint: 'text-embedding-3-large',
      dimensions: EMBEDDING_DIMENSIONS
    })
  })

  it('embedPage content 우선', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const v = await client.embedPage({
      id: 'p1',
      workspace_id: 'ws',
      url: 'https://x.test/a',
      title: 'T',
      content: 'page body content',
      content_hash: null,
      lang: null,
      visited_count: 1,
      created_at: 0,
      updated_at: 0
    })
    expect((v as Float32Array).length).toBe(EMBEDDING_DIMENSIONS)
  })

  it('embedPage 빈 content + 빈 title → throw', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    await expect(
      client.embedPage({
        id: 'p1',
        workspace_id: 'ws',
        url: 'u',
        title: '',
        content: '',
        content_hash: null,
        lang: null,
        visited_count: 1,
        created_at: 0,
        updated_at: 0
      })
    ).rejects.toThrow(/empty content/)
  })

  it('embedPage content 빈 시 title fallback', async () => {
    const spy = vi.fn()
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (req) => {
        spy(req.texts[0])
        return {
          vectors: [makeVector(0)],
          modelUsed: 'm',
          inputTokens: 1,
          estimatedCostUsd: 0,
          durationMs: 1
        }
      }
    })
    const client = new EmbeddingClient({ provider })
    await client.embedPage({
      id: 'p1',
      workspace_id: 'ws',
      url: 'u',
      title: 'Title fallback',
      content: '',
      content_hash: null,
      lang: null,
      visited_count: 1,
      created_at: 0,
      updated_at: 0
    })
    expect(spy).toHaveBeenCalledWith('Title fallback')
  })

  it('embedNote selected_text + body 연결', async () => {
    const spy = vi.fn()
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (req) => {
        spy(req.texts[0])
        return {
          vectors: [makeVector(0)],
          modelUsed: 'm',
          inputTokens: 1,
          estimatedCostUsd: 0,
          durationMs: 1
        }
      }
    })
    const client = new EmbeddingClient({ provider })
    await client.embedNote({
      id: 'n1',
      page_id: null,
      visit_id: null,
      workspace_id: 'ws',
      selected_text: 'sel',
      body: 'extra body',
      ai_tags: null,
      created_at: 0,
      created_by: 'user'
    })
    expect(spy).toHaveBeenCalledWith('sel\n\nextra body')
  })

  it('embedNote 본문 없음 시 selected_text 단독', async () => {
    const spy = vi.fn()
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: (req) => {
        spy(req.texts[0])
        return {
          vectors: [makeVector(0)],
          modelUsed: 'm',
          inputTokens: 1,
          estimatedCostUsd: 0,
          durationMs: 1
        }
      }
    })
    const client = new EmbeddingClient({ provider })
    await client.embedNote({
      id: 'n1',
      page_id: null,
      visit_id: null,
      workspace_id: 'ws',
      selected_text: 'only-sel',
      body: null,
      ai_tags: null,
      created_at: 0,
      created_by: 'user'
    })
    expect(spy).toHaveBeenCalledWith('only-sel')
  })
})

describe('processNextEmbeddingJob', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('빈 큐 → idle', async () => {
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const result = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(result.status).toBe('idle')
  })

  it('page 성공 — VectorIndex upsert + markSucceeded', async () => {
    const { page } = await fx.pageStore.recordVisit({
      url: 'https://x.test/a',
      content: 'body',
      workspace_id: fx.wsId
    })
    fx.queue.enqueue({
      target_type: 'page',
      target_id: page.id,
      workspace_id: fx.wsId
    })
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const result = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(result.status).toBe('succeeded')
    expect(fx.vector.countPages(fx.wsId)).toBe(1)
    expect(fx.queue.stats().succeeded).toBe(1)
  })

  it('note 성공 — VectorIndex upsert + markSucceeded', async () => {
    const note = fx.noteStore.create({
      workspace_id: fx.wsId,
      selected_text: 'sel',
      body: 'body'
    })
    fx.queue.enqueue({
      target_type: 'note',
      target_id: note.id,
      workspace_id: fx.wsId
    })
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const result = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(result.status).toBe('succeeded')
    expect(fx.vector.countNotes(fx.wsId)).toBe(1)
  })

  it('orphan page — target 미존재 → markFailed (orphan)', async () => {
    const fakePageId = randomUUID()
    fx.queue.enqueue({
      target_type: 'page',
      target_id: fakePageId,
      workspace_id: fx.wsId
    })
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const result = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(result.status).toBe('orphan')
    expect(result.error).toMatch(/page not found/)
    expect(fx.queue.stats().failed).toBe(1)
  })

  it('embed 호출 실패 → markFailed', async () => {
    const { page } = await fx.pageStore.recordVisit({
      url: 'https://x.test/a',
      content: 'body',
      workspace_id: fx.wsId
    })
    fx.queue.enqueue({
      target_type: 'page',
      target_id: page.id,
      workspace_id: fx.wsId
    })
    const provider = fakeProvider({
      hasEmbed: true,
      embedImpl: () => {
        throw new Error('OpenAI HTTP 503')
      }
    })
    const client = new EmbeddingClient({ provider })
    const result = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/HTTP 503/)
    expect(fx.queue.stats().failed).toBe(1)
    expect(fx.vector.countPages(fx.wsId)).toBe(0)
  })

  it('priority FIFO 정합 — 두 잡 처리 순서', async () => {
    const a = await fx.pageStore.recordVisit({
      url: 'https://x.test/a',
      content: 'a',
      workspace_id: fx.wsId
    })
    const b = await fx.pageStore.recordVisit({
      url: 'https://x.test/b',
      content: 'b',
      workspace_id: fx.wsId
    })
    const jobA = fx.queue.enqueue({
      target_type: 'page',
      target_id: a.page.id,
      workspace_id: fx.wsId,
      priority: 1
    })
    const jobB = fx.queue.enqueue({
      target_type: 'page',
      target_id: b.page.id,
      workspace_id: fx.wsId,
      priority: 5 // 우선
    })
    const client = new EmbeddingClient({ provider: fakeProvider({ hasEmbed: true }) })
    const r1 = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(r1.job?.id).toBe(jobB.id) // priority 5 우선
    const r2 = await processNextEmbeddingJob({
      client,
      queue: fx.queue,
      vectorIndex: fx.vector,
      pageStore: fx.pageStore,
      noteStore: fx.noteStore
    })
    expect(r2.job?.id).toBe(jobA.id)
    expect(fx.vector.countPages(fx.wsId)).toBe(2)
  })
})
