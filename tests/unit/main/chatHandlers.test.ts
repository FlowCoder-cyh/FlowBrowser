/**
 * Sprint 015 M5-6 — chatHandlers 단위 테스트.
 *
 * pure logic — Electron ipcMain 의존 없음. in-memory FlowbrowserDatabase + mock ChatService.
 *
 * cover:
 *   - handleChatRequest 의 graceful error 3종 (workspace null / history null / chat service null = BYOK)
 *   - 성공 path — user + assistant 영속 + serialized 매핑
 *   - 실패 path (ChatService 실패 시) — user + error 영속 + errorCode 전달
 *   - handleChatListHistory — workspace 별 조회 / null 인프라 시 빈 결과
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'
import { ChatService } from '../../../src/main/ChatService'
import {
  handleChatRequest,
  handleChatListHistory
} from '../../../src/main/chatHandlers'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type {
  ChatRequest,
  ChatResponse,
  ProviderInfo,
  ProviderType,
  TranslationInput,
  TranslationOutput
} from '../../../src/ai/types'

function makeMockProvider(opts: {
  type?: ProviderType
  chatReply?: string
  chatThrows?: Error
} = {}): ProviderAdapter {
  const type = opts.type ?? 'openai'
  const provider: ProviderAdapter = {
    info: {
      providerType: type,
      displayName: `mock-${type}`,
      supportedRequestTypes: ['selection'],
      defaultModel: 'mock',
      availableModels: ['mock'],
      supportsChat: true
    } as ProviderInfo,
    async validate() {
      return { ok: true }
    },
    async translate(_input: TranslationInput): Promise<TranslationOutput> {
      throw new Error('not implemented')
    }
  }
  provider.chat = async (_req: ChatRequest): Promise<ChatResponse> => {
    if (opts.chatThrows) throw opts.chatThrows
    return {
      text: opts.chatReply ?? 'reply',
      modelUsed: 'mock',
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.001,
      durationMs: 50
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

describe('handleChatRequest — graceful error', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('workspace null + getActiveWorkspaceId null → invalid_input', async () => {
    const r = await handleChatRequest(
      { userMessage: 'hi' },
      {
        getActiveWorkspaceId: () => null,
        getChatService: () => null,
        historyStore: fx.history
      }
    )
    expect(r.status).toBe('error')
    expect(r.errorCode).toBe('invalid_input')
    expect(r.error).toMatch(/워크스페이스/)
  })

  it('historyStore null → invalid_input', async () => {
    const r = await handleChatRequest(
      { userMessage: 'hi' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: () => null,
        historyStore: null
      }
    )
    expect(r.status).toBe('error')
    expect(r.errorCode).toBe('invalid_input')
    expect(r.error).toMatch(/채팅 인프라/)
  })

  it('ChatService null (provider 미등록) → byok_required', async () => {
    const r = await handleChatRequest(
      { userMessage: 'hi' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: () => null,
        historyStore: fx.history
      }
    )
    expect(r.status).toBe('error')
    expect(r.errorCode).toBe('byok_required')
    expect(r.error).toMatch(/OpenAI API Key/)
  })

  it('args.workspaceId 우선 — getActiveWorkspaceId fallback 안 함', async () => {
    const r = await handleChatRequest(
      { userMessage: 'hi', workspaceId: 'explicit-ws' },
      {
        getActiveWorkspaceId: () => null, // null 이지만 args.workspaceId 사용
        getChatService: () => null,
        historyStore: fx.history
      }
    )
    // args.workspaceId 사용 → workspace OK, historyStore OK, chatService null → byok
    expect(r.errorCode).toBe('byok_required')
  })
})

describe('handleChatRequest — 성공 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('성공 시 user + assistant 양 메시지 serialized 반환', async () => {
    const provider = makeMockProvider({ chatReply: '안녕하세요' })
    const r = await handleChatRequest(
      { userMessage: '안녕' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: () => new ChatService({ provider, historyStore: fx.history }),
        historyStore: fx.history
      }
    )
    expect(r.status).toBe('ok')
    expect(r.messages).toHaveLength(2)
    expect(r.messages![0].role).toBe('user')
    expect(r.messages![0].content).toBe('안녕')
    expect(r.messages![1].role).toBe('assistant')
    expect(r.messages![1].content).toBe('안녕하세요')
    // SerializedChatRow snake_case 매핑 검증
    expect(r.messages![0]).toHaveProperty('workspaceId')
    expect(r.messages![0]).toHaveProperty('pageId')
    expect(r.messages![0]).toHaveProperty('createdAt')
  })

  it('ChatService 실패 시 user + error 영속 + errorCode 전달', async () => {
    const provider = makeMockProvider({ chatThrows: new Error('rate limit') })
    const r = await handleChatRequest(
      { userMessage: 'q' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: () => new ChatService({ provider, historyStore: fx.history }),
        historyStore: fx.history
      }
    )
    expect(r.status).toBe('error')
    expect(r.errorCode).toBe('provider_error')
    expect(r.error).toBe('rate limit')
    expect(r.messages).toHaveLength(2)
    expect(r.messages![1].role).toBe('error')
  })

  it('PromptComposer 옵션 (levelPreference) 전달', async () => {
    let capturedSystemPrompt = ''
    const provider = makeMockProvider()
    provider.chat = async (req: ChatRequest): Promise<ChatResponse> => {
      capturedSystemPrompt = req.messages[0].content
      return {
        text: 'r',
        modelUsed: 'm',
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0,
        durationMs: 1
      }
    }
    await handleChatRequest(
      { userMessage: 'q', levelPreference: 'novice' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: () => new ChatService({ provider, historyStore: fx.history }),
        historyStore: fx.history
      }
    )
    expect(capturedSystemPrompt).toContain('초보자')
  })

  it('Codex 명시 동의 — allowedProviders 전달', async () => {
    const provider = makeMockProvider({ type: 'codex', chatReply: 'codex reply' })
    const r = await handleChatRequest(
      { userMessage: 'q', allowedProviders: ['openai', 'codex'] },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getChatService: ({ allowedProviders }) =>
          new ChatService({
            provider,
            historyStore: fx.history,
            allowedProviders: allowedProviders as
              | ReadonlyArray<ProviderType>
              | undefined
          }),
        historyStore: fx.history
      }
    )
    expect(r.status).toBe('ok')
    if (r.messages) expect(r.messages[1].content).toBe('codex reply')
  })
})

describe('handleChatListHistory', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('workspace 별 chronological 조회', () => {
    fx.history.create({
      workspace_id: fx.workspaceId,
      role: 'user',
      content: 'q1',
      created_at: 1
    })
    fx.history.create({
      workspace_id: fx.workspaceId,
      role: 'assistant',
      content: 'a1',
      created_at: 2
    })
    const r = handleChatListHistory(
      {},
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        historyStore: fx.history
      }
    )
    expect(r.messages).toHaveLength(2)
    expect(r.messages[0].content).toBe('q1')
    expect(r.messages[1].content).toBe('a1')
  })

  it('historyStore null → 빈 결과', () => {
    const r = handleChatListHistory(
      {},
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        historyStore: null
      }
    )
    expect(r.messages).toEqual([])
  })

  it('workspace null → 빈 결과', () => {
    const r = handleChatListHistory(
      {},
      {
        getActiveWorkspaceId: () => null,
        historyStore: fx.history
      }
    )
    expect(r.messages).toEqual([])
  })

  it('args.workspaceId 우선', () => {
    fx.history.create({
      workspace_id: fx.workspaceId,
      role: 'user',
      content: 'q1',
      created_at: 1
    })
    const r = handleChatListHistory(
      { workspaceId: fx.workspaceId },
      {
        getActiveWorkspaceId: () => 'other-ws',
        historyStore: fx.history
      }
    )
    expect(r.messages).toHaveLength(1)
  })
})
