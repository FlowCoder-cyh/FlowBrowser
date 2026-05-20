/**
 * Sprint 015 M5-5 — ChatService 단위 테스트.
 *
 * cover:
 *   - BYOK 검증 (KI-003) — 디폴트 ['openai'] / Codex 차단 / 사용자 명시 동의 시 허용
 *   - provider.chat 미지원 → graceful error
 *   - 빈 userMessage / 빈 workspaceId → graceful error
 *   - provider.chat throw → 'error' role 메시지 영속 + ChatResult.errorCode='provider_error'
 *   - 성공 path — user + assistant 메시지 양쪽 영속, response 정합
 *   - PromptComposer 통합 — levelPreference 분기 / retrievedPages 결합 → provider.chat 의 messages 검증
 *   - retrieved_items 영속 — user / assistant 양쪽
 *   - listHistory — workspace 별 chronological 조회
 *   - allowedProviders override — Codex 명시 동의 시 통과
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'
import { ChatService } from '../../../src/main/ChatService'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type {
  ChatRequest,
  ChatResponse,
  ProviderInfo,
  ProviderType
} from '../../../src/ai/types'

interface MockProviderOpts {
  type?: ProviderType
  supportsChat?: boolean
  chatReply?: string
  chatThrows?: Error
  captureRequest?: { request: ChatRequest | null }
}

function makeMockProvider(opts: MockProviderOpts = {}): ProviderAdapter {
  const type = opts.type ?? 'openai'
  const supportsChat = opts.supportsChat ?? true
  const provider: ProviderAdapter = {
    info: {
      providerType: type,
      displayName: `mock-${type}`,
      supportedRequestTypes: ['selection'],
      defaultModel: 'mock-default',
      availableModels: ['mock-default'],
      supportsChat
    } as ProviderInfo,
    async validate() {
      return { ok: true }
    }
  }
  if (supportsChat) {
    provider.chat = async (req: ChatRequest): Promise<ChatResponse> => {
      if (opts.captureRequest) opts.captureRequest.request = req
      if (opts.chatThrows) throw opts.chatThrows
      return {
        text: opts.chatReply ?? 'mock-assistant-reply',
        modelUsed: req.modelHint ?? 'mock-default',
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostUsd: 0.001,
        durationMs: 100
      }
    }
  }
  return provider
}

interface Fx {
  fb: FlowbrowserDatabase
  history: AiChatHistoryStore
  workspaceId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const history = new AiChatHistoryStore(fb)
  return { fb, history, workspaceId: ws.id }
}

describe('ChatService — graceful error', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('빈 userMessage → errorCode=invalid_input, 영속 0', async () => {
    const provider = makeMockProvider()
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toBe('invalid_input')
    expect(fx.history.countByWorkspace(fx.workspaceId)).toBe(0)
  })

  it('빈 workspaceId → errorCode=invalid_input', async () => {
    const provider = makeMockProvider()
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({ workspaceId: '', userMessage: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toBe('invalid_input')
  })

  it('Codex provider — 디폴트 BYOK 강제로 errorCode=byok_required', async () => {
    const codex = makeMockProvider({ type: 'codex' })
    const service = new ChatService({ provider: codex, historyStore: fx.history })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errorCode).toBe('byok_required')
      expect(r.error).toMatch(/ChatGPT 한도/)
    }
    // 영속 0 (BYOK 검증 단계 전)
    expect(fx.history.countByWorkspace(fx.workspaceId)).toBe(0)
  })

  it('allowedProviders 에 codex 명시 동의 시 통과', async () => {
    const codex = makeMockProvider({ type: 'codex', chatReply: 'codex-reply' })
    const service = new ChatService({
      provider: codex,
      historyStore: fx.history,
      allowedProviders: ['openai', 'codex']
    })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'hi' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.assistantMessage).toBe('codex-reply')
  })

  it('provider.chat 미지원 → errorCode=chat_unsupported', async () => {
    const provider = makeMockProvider({ supportsChat: false })
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorCode).toBe('chat_unsupported')
  })

  it('provider.chat throw 빈 message ("") → fallback placeholder 영속 (codex PR #157 NEEDS_CHANGES 회귀)', async () => {
    // err.message === '' 또는 String(err) === '' 시 AiChatHistoryStore.create 가 throw — fallback 보장.
    const provider = makeMockProvider({ chatThrows: new Error('') })
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errorCode).toBe('provider_error')
      expect(r.error).toBe('Provider chat failed')
    }
    const history = fx.history.listByWorkspace(fx.workspaceId)
    expect(history).toHaveLength(2)
    expect(history[1].role).toBe('error')
    expect(history[1].content).toBe('Provider chat failed')
  })

  it('provider.chat throw → user 메시지 + error 메시지 영속, errorCode=provider_error', async () => {
    const provider = makeMockProvider({ chatThrows: new Error('rate limit') })
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'hi' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errorCode).toBe('provider_error')
      expect(r.error).toBe('rate limit')
      expect(r.userChatId).toBeDefined()
      expect(r.assistantChatId).toBeDefined()
    }
    // 영속 2 (user + error)
    const history = fx.history.listByWorkspace(fx.workspaceId)
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(history[1].role).toBe('error')
    expect(history[1].status).toBe('failed')
    expect(history[1].content).toBe('rate limit')
  })
})

describe('ChatService — 성공 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('user + assistant 양쪽 영속, response 정합', async () => {
    const provider = makeMockProvider({ chatReply: 'AI 응답입니다.' })
    const service = new ChatService({ provider, historyStore: fx.history })
    const r = await service.chat({
      workspaceId: fx.workspaceId,
      userMessage: '안녕'
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.assistantMessage).toBe('AI 응답입니다.')
      expect(r.response.inputTokens).toBe(10)
      expect(r.response.outputTokens).toBe(20)
      expect(r.userChatId).toBeDefined()
      expect(r.assistantChatId).toBeDefined()
    }
    const history = fx.history.listByWorkspace(fx.workspaceId)
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toBe('안녕')
    expect(history[1].role).toBe('assistant')
    expect(history[1].content).toBe('AI 응답입니다.')
  })

  it('PromptComposer 통합 — system prompt 가 messages 에 박힘', async () => {
    const captured: { request: ChatRequest | null } = { request: null }
    const provider = makeMockProvider({ captureRequest: captured })
    const service = new ChatService({ provider, historyStore: fx.history })
    await service.chat({
      workspaceId: fx.workspaceId,
      userMessage: 'hello',
      prompt: {
        levelPreference: 'novice',
        retrievedPages: [
          { title: 'A', url: 'https://a', content: 'A body' }
        ]
      }
    })
    expect(captured.request).not.toBeNull()
    expect(captured.request!.messages).toHaveLength(2)
    expect(captured.request!.messages[0].role).toBe('system')
    expect(captured.request!.messages[1].role).toBe('user')
    expect(captured.request!.messages[1].content).toBe('hello')
    // system prompt 에 levelPreference + retrieved page 박힘
    const systemContent = captured.request!.messages[0].content
    expect(systemContent).toContain('초보자')
    expect(systemContent).toContain('A body')
    expect(systemContent).toContain('https://a')
  })

  it('retrieved_items 영속 — user / assistant 양쪽', async () => {
    const provider = makeMockProvider()
    const service = new ChatService({ provider, historyStore: fx.history })
    const items = [
      { type: 'page' as const, id: 'page-1', page_id: 'page-1' },
      { type: 'note' as const, id: 'note-1' }
    ]
    await service.chat({
      workspaceId: fx.workspaceId,
      userMessage: 'q',
      retrievedItems: items
    })
    const history = fx.history.listByWorkspace(fx.workspaceId)
    expect(history[0].retrieved_items).toEqual(items)
    expect(history[1].retrieved_items).toEqual(items)
  })

  it('modelHint / temperature 전달', async () => {
    const captured: { request: ChatRequest | null } = { request: null }
    const provider = makeMockProvider({ captureRequest: captured })
    const service = new ChatService({ provider, historyStore: fx.history })
    await service.chat({
      workspaceId: fx.workspaceId,
      userMessage: 'q',
      modelHint: 'gpt-4o-mini',
      temperature: 0.3,
      maxOutputTokens: 500
    })
    expect(captured.request!.modelHint).toBe('gpt-4o-mini')
    expect(captured.request!.temperature).toBe(0.3)
    expect(captured.request!.maxOutputTokens).toBe(500)
  })

  it('pageId / visitId anchor 영속', async () => {
    // FK 정합 위해 page + visit row 미리 생성
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

    const provider = makeMockProvider()
    const service = new ChatService({ provider, historyStore: fx.history })
    await service.chat({
      workspaceId: fx.workspaceId,
      userMessage: 'q',
      pageId: page.id,
      visitId: visit.id
    })
    const history = fx.history.listByWorkspace(fx.workspaceId)
    expect(history[0].page_id).toBe(page.id)
    expect(history[0].visit_id).toBe(visit.id)
    expect(history[1].page_id).toBe(page.id)
    expect(history[1].visit_id).toBe(visit.id)
  })
})

describe('ChatService — listHistory', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('workspace 별 chronological 조회', async () => {
    const provider = makeMockProvider({ chatReply: 'reply' })
    const service = new ChatService({ provider, historyStore: fx.history })
    await service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    await service.chat({ workspaceId: fx.workspaceId, userMessage: 'q2' })
    const list = service.listHistory(fx.workspaceId)
    // q1-user / q1-assistant / q2-user / q2-assistant
    expect(list).toHaveLength(4)
    expect(list[0].content).toBe('q1')
    expect(list[2].content).toBe('q2')
  })
})

/**
 * Sprint 016 M0 T02-followup (KI-006) — workspace chat abort (race-safe generation 패턴).
 *
 * codex BLOCKING #1 흡수 — boolean Set 1회 suppress 의 race condition 해소:
 *   - abortStreaming(ws) → generation +1
 *   - chat 시작 시 startGen 캡처, 종료 직전 currentGen 비교
 *   - startGen < currentGen → assistant INSERT 차단 + errorCode='aborted'
 *   - abort 이후 새 chat 정상 (오탐 차단)
 */
describe('ChatService — workspace abort (Sprint 016 M0 T02-followup, KI-006, generation 패턴)', () => {
  let fx: Fx
  let altWsId: string

  beforeEach(() => {
    fx = setup()
    altWsId = fx.fb.createWorkspace({ name: 'Alt', icon: '🧪' }).id
    ChatService.__resetAbortsForTest()
  })

  afterEach(() => {
    fx.fb.close()
    ChatService.__resetAbortsForTest()
  })

  it('abort 이후 새 chat → 정상 처리 (오탐 차단, race-safe)', async () => {
    // abort 호출 시점에 in-flight chat 없음
    ChatService.abortStreaming(fx.workspaceId)
    expect(ChatService.getAbortGeneration(fx.workspaceId)).toBe(1)
    // 새 chat 시작 — startGen = currentGen = 1 → suppress 안 함
    const provider = makeMockProvider({ chatReply: 'reply' })
    const service = new ChatService({ provider, historyStore: fx.history })
    const result = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assistantMessage).toBe('reply')
    const list = service.listHistory(fx.workspaceId)
    // user + assistant 정합
    expect(list).toHaveLength(2)
  })

  it('동시 in-flight 2건 + abort → 둘 다 assistant INSERT 차단 (race-safe, codex BLOCKING #1)', async () => {
    const provider = makeMockProvider({ chatReply: 'reply' })
    const service = new ChatService({ provider, historyStore: fx.history })
    // 2건 chat 시작 (await 안 함)
    const p1 = service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    const p2 = service.chat({ workspaceId: fx.workspaceId, userMessage: 'q2' })
    // 둘 다 시작된 직후 abort 호출
    ChatService.abortStreaming(fx.workspaceId)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (r1.ok || r2.ok) return
    expect(r1.errorCode).toBe('aborted')
    expect(r2.errorCode).toBe('aborted')
    // user 2건 영속, assistant 0건
    const list = service.listHistory(fx.workspaceId)
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.role)).toEqual(['user', 'user'])
  })

  it('abort 다른 ws 영향 0 (ws 격리)', async () => {
    const provider = makeMockProvider({ chatReply: 'reply' })
    const service = new ChatService({ provider, historyStore: fx.history })
    ChatService.abortStreaming(altWsId)
    // default ws chat 정상 처리
    const result = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assistantMessage).toBe('reply')
    expect(ChatService.getAbortGeneration(altWsId)).toBe(1)
    expect(ChatService.getAbortGeneration(fx.workspaceId)).toBe(0)
  })

  it('abortStreaming static — cross-instance 공유 (chat:request new ChatService 회귀)', async () => {
    const provider = makeMockProvider({ chatReply: 'reply' })
    const inst1 = new ChatService({ provider, historyStore: fx.history })
    // inst1 chat 시작
    const p1 = inst1.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    // 다른 인스턴스에서 abort 호출 (services.ts 매 호출 new 회귀)
    ChatService.abortStreaming(fx.workspaceId)
    const result = await p1
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorCode).toBe('aborted')
  })

  it('abort + BYOK 차단 — BYOK 우선 (user 미생성, generation 캡처 미진입)', async () => {
    const provider = makeMockProvider({ type: 'codex' })
    const service = new ChatService({ provider, historyStore: fx.history })
    ChatService.abortStreaming(fx.workspaceId)
    const result = await service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorCode).toBe('byok_required')
    // user 미생성 (BYOK 가 가장 먼저 차단)
    expect(service.listHistory(fx.workspaceId)).toHaveLength(0)
    // generation 은 그대로 유지 (chat path 미진입)
    expect(ChatService.getAbortGeneration(fx.workspaceId)).toBe(1)
  })

  it('abort + provider.chat throw → provider_error 우선 (abort generation 비교 미진입)', async () => {
    const provider = makeMockProvider({ chatThrows: new Error('rate-limit') })
    const service = new ChatService({ provider, historyStore: fx.history })
    // 시작 시 generation 0 캡처. provider throw 후 catch 분기에서 error chat 영속 + return.
    // abort 호출은 throw 후 시점이라 abort 비교 path 미진입.
    const p = service.chat({ workspaceId: fx.workspaceId, userMessage: 'q1' })
    const result = await p
    ChatService.abortStreaming(fx.workspaceId) // 후속 호출 (영향 없음)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorCode).toBe('provider_error')
    // user + error 메시지 둘 다 영속
    const list = service.listHistory(fx.workspaceId)
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.role)).toEqual(['user', 'error'])
  })
})
