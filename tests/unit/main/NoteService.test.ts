/**
 * Sprint 015 M5-7 — NoteService 단위 테스트.
 *
 * in-memory FlowbrowserDatabase + NoteStore + EmbeddingQueue.
 *
 * codex M5-7 PR #159 NEEDS_CHANGES 정정 후 — AutoTagger 통합 자체 제거 (KI-005 후속).
 * AutoTagger.tagPage 가 page_tags FK 위반 (note.id 가 pages 외래키 충족 X) 발견 시점 차단.
 *
 * cover:
 *   - createNote — NoteStore.create + EmbeddingQueue.enqueue 정합
 *   - whitespace-only selectedText → throw (NoteService 자체 guard, codex 회귀)
 *   - workspaceId 빈 문자열 → throw
 *   - body / selectedText / initialTags / pageId+visitId anchor / priority
 *   - enableAutoTagging=true 시도 'not_called' 반환 (KI-005 안전 디폴트)
 *   - listNotes / deleteNote
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { TagStore } from '../../../src/storage/TagStore'
import { NoteService } from '../../../src/main/NoteService'
import { AutoTagger } from '../../../src/ai/tagging/AutoTagger'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type { ProviderInfo, ChatRequest, ChatResponse } from '../../../src/ai/types'

interface Fx {
  fb: FlowbrowserDatabase
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
  workspaceId: string
  service: NoteService
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const noteStore = new NoteStore(fb)
  const embeddingQueue = new EmbeddingQueue(fb)
  const service = new NoteService({ noteStore, embeddingQueue })
  return { fb, noteStore, embeddingQueue, workspaceId: ws.id, service }
}

interface StubProvider extends ProviderAdapter {
  chatCalls: ChatRequest[]
}

function makeChatStub(responseText: string, opts?: { supportsChat?: boolean }): StubProvider {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'StubOpenAI',
    supportedRequestTypes: ['selection'],
    defaultModel: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini'],
    supportsChat: opts?.supportsChat ?? true,
    supportsEmbed: false
  }
  const calls: ChatRequest[] = []
  const base = {
    info,
    chatCalls: calls,
    async validate() {
      return { ok: true }
    }
  }
  if (opts?.supportsChat === false) {
    return base as unknown as StubProvider
  }
  return {
    ...base,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request)
      return {
        text: responseText,
        modelUsed: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.0001,
        durationMs: 250
      }
    }
  } as unknown as StubProvider
}

interface FxWithTagger extends Fx {
  tagStore: TagStore
  autoTagger: AutoTagger
  provider: StubProvider
}

function setupWithTagger(responseText: string): FxWithTagger {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const noteStore = new NoteStore(fb)
  const embeddingQueue = new EmbeddingQueue(fb)
  const tagStore = new TagStore(fb)
  const provider = makeChatStub(responseText)
  const autoTagger = new AutoTagger({ provider, tagStore })
  const service = new NoteService({ noteStore, embeddingQueue, autoTagger })
  return {
    fb,
    noteStore,
    embeddingQueue,
    workspaceId: ws.id,
    service,
    tagStore,
    autoTagger,
    provider
  }
}

describe('NoteService — createNote 입력 검증 (codex PR #159 NEEDS_CHANGES 회귀)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText 빈 문자열 → throw', async () => {
    await expect(
      fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: '' })
    ).rejects.toThrow(/selectedText/)
  })

  it('selectedText whitespace-only → throw (NoteStore 통과 차단)', async () => {
    await expect(
      fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: '   ' })
    ).rejects.toThrow(/selectedText/)
  })

  it('workspaceId 빈 문자열 → throw', async () => {
    await expect(
      fx.service.createNote({ workspaceId: '', selectedText: 'x' })
    ).rejects.toThrow(/workspaceId/)
  })
})

describe('NoteService — createNote 정상 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText 만 — note 영속 + 임베딩 큐 등록 + autoTaggingStatus=not_called', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '핵심 인용'
    })
    expect(r.note.selected_text).toBe('핵심 인용')
    expect(r.note.workspace_id).toBe(fx.workspaceId)
    expect(r.note.created_by).toBe('user')
    expect(r.embeddingJobId).toBeDefined()
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('body + selectedText — 본문 결합 임베딩 큐 등록', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      body: '내 메모'
    })
    expect(r.note.body).toBe('내 메모')
    expect(r.embeddingJobId).toBeDefined()
    expect(fx.embeddingQueue.stats().pending).toBe(1)
  })

  it('initialTags 전달 — ai_tags 영속', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'CAR-T',
      initialTags: ['glossary', 'domain:medicine']
    })
    expect(r.note.ai_tags).toEqual(['glossary', 'domain:medicine'])
  })

  it('pageId / visitId anchor — note 영속에 박힘', async () => {
    const { IndexedPageStoreSqlite } = await import(
      '../../../src/storage/IndexedPageStoreSqlite'
    )
    const pageStore = new IndexedPageStoreSqlite(fx.fb, {
      defaultWorkspaceId: fx.workspaceId
    })
    const { page, visit } = await pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://anchor.example',
      content: 'anchor body',
      visited_at: Date.now()
    })

    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      pageId: page.id,
      visitId: visit.id
    })
    expect(r.note.page_id).toBe(page.id)
    expect(r.note.visit_id).toBe(visit.id)
  })

  it('priority 디폴트 10 (활성 탭 우선)', async () => {
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용'
    })
    const claimed = fx.embeddingQueue.claimNext()
    expect(claimed).not.toBeNull()
    expect(claimed!.priority).toBe(10)
    expect(claimed!.target_type).toBe('note')
  })

  it('priority override (백그라운드 1)', async () => {
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      priority: 1
    })
    const claimed = fx.embeddingQueue.claimNext()
    expect(claimed!.priority).toBe(1)
  })
})

describe('NoteService — autoTagger 미주입 시 safety', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('enableAutoTagging=true + autoTagger 미주입 → not_called (safety)', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('enableAutoTagging=false → not_called', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x',
      enableAutoTagging: false
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('enableAutoTagging 미지정 → not_called', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x'
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })
})

describe('NoteService — Sprint 016 M4 T21 AutoTagger.tagNote wiring (KI-005 closed)', () => {
  it('enableAutoTagging=true + autoTagger 주입 → tagged + note_tags 박힘', async () => {
    const fx = setupWithTagger(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'CAR-T' },
          { kind: 'entity', name: 'BioGen' }
        ]
      })
    )
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'CAR-T 저항성 논문',
      body: 'BioGen 임상 결과',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('tagged')
    expect(fx.tagStore.listNoteTags(r.note.id)).toHaveLength(2)
    // KI-005 회귀 — page_tags 미박힘 (FK 위반 회피 검증)
    expect(fx.tagStore.listPageTags(r.note.id)).toHaveLength(0)
    fx.fb.close()
  })

  it('enableAutoTagging=true + autoTagger 주입 + content 결합 — selectedText + body 결합 user message', async () => {
    const fx = setupWithTagger(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용 부분',
      body: '내 메모',
      enableAutoTagging: true
    })
    // provider.chat user message 에 selectedText + body 둘 다 포함
    const userMsg = fx.provider.chatCalls[0].messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('인용 부분')
    expect(userMsg?.content).toContain('내 메모')
    fx.fb.close()
  })

  it('enableAutoTagging=true + body 없음 — selectedText 만 user message', async () => {
    const fx = setupWithTagger(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '단독 인용',
      enableAutoTagging: true
    })
    const userMsg = fx.provider.chatCalls[0].messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('단독 인용')
    fx.fb.close()
  })

  it('enableAutoTagging=false + autoTagger 주입 → tagNote 호출 0 + not_called', async () => {
    const fx = setupWithTagger(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x',
      enableAutoTagging: false
    })
    expect(r.autoTaggingStatus).toBe('not_called')
    expect(fx.provider.chatCalls).toHaveLength(0)
    fx.fb.close()
  })

  it('enableAutoTagging 미지정 + autoTagger 주입 → tagNote 호출 0 + not_called', async () => {
    const fx = setupWithTagger(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x'
    })
    expect(r.autoTaggingStatus).toBe('not_called')
    expect(fx.provider.chatCalls).toHaveLength(0)
    fx.fb.close()
  })

  it('enableAutoTagging=true + provider chat 미지원 → skipped', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const noteStore = new NoteStore(fb)
    const embeddingQueue = new EmbeddingQueue(fb)
    const tagStore = new TagStore(fb)
    const provider = makeChatStub('{}', { supportsChat: false })
    const autoTagger = new AutoTagger({ provider, tagStore })
    const service = new NoteService({ noteStore, embeddingQueue, autoTagger })

    const r = await service.createNote({
      workspaceId: ws.id,
      selectedText: 'x',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('skipped')
    fb.close()
  })

  it('enableAutoTagging=true + JSON parse 실패 → tagged (freeform fallback)', async () => {
    const fx = setupWithTagger('자유 텍스트 응답 (JSON 아님)')
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('tagged')
    const tags = fx.tagStore.listNoteTags(r.note.id)
    expect(tags).toHaveLength(1)
    expect(tags[0].kind).toBe('freeform')
    fx.fb.close()
  })

  it('autoTaggingStatus 가 tagged 일 때도 embeddingJobId 박힘 (큐 등록 + 태깅 동시)', async () => {
    const fx = setupWithTagger(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('tagged')
    expect(r.embeddingJobId).toBeDefined()
    expect(fx.embeddingQueue.stats().pending).toBe(1)
    fx.fb.close()
  })
})

describe('NoteService — list / delete', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('listNotes — workspace 별', async () => {
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'a' })
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'b' })
    const notes = fx.service.listNotes(fx.workspaceId)
    expect(notes).toHaveLength(2)
  })

  it('deleteNote — 존재 시 true', async () => {
    const r = await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'x' })
    expect(fx.service.deleteNote(r.note.id)).toBe(true)
    expect(fx.service.listNotes(fx.workspaceId)).toHaveLength(0)
  })

  it('deleteNote — 미존재 시 false', () => {
    expect(fx.service.deleteNote('nonexistent-uuid')).toBe(false)
  })
})
