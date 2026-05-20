/**
 * Sprint 015 M5-5 — ChatService.
 *
 * PRD §10.1 채팅 파이프라인 — provider.chat() wrapper + AiChatHistoryStore 영속 + KI-003 BYOK 검증.
 *
 * 책임:
 *   1. BYOK 검증 — provider.info.providerType ∈ allowedProviders (KI-003 HIGH 자연 결합)
 *     - 디폴트 ['openai'] (BYOK 강화). 호출자가 사용자 명시 동의 token 있으면 ['openai', 'codex'] 전달.
 *   2. PromptComposer 활용 system prompt 구성
 *   3. provider.chat({ messages: [system, user] }) 호출
 *   4. AiChatHistoryStore 양 메시지 (user, assistant) INSERT
 *   5. 실패 시 graceful error + AiChatHistoryStore 상태 갱신 ('failed')
 *
 * pure logic — Electron ipcMain 의존 없음. M5-6 ChatPanel IPC handler 가 thin wrapper.
 *
 * KI-003 (HIGH) 정합 — `.flowset/known-issues.md`:
 *   AutoTagger / 검색 자동 호출이 Codex OAuth 주입 시 ChatGPT 한도 묵시 소진 위협.
 *   ChatService 가 BYOK 강제로 wiring 시점 차단 — 사용자가 명시 동의 시에만 Codex 허용.
 */

import type { ProviderAdapter } from '../ai/ProviderAdapter'
import { composeSystemPrompt, type PromptComposeOptions } from '../ai/PromptComposer'
import type { ChatRequest, ChatResponse, ProviderType } from '../ai/types'
import type { AiChatHistoryStore, ChatRow, RetrievedItem } from '../storage/AiChatHistoryStore'

export interface ChatServiceOptions {
  /** AI Provider — chat 호출. provider.chat 미지원 시 ChatService.chat() 가 graceful error. */
  provider: ProviderAdapter
  /** 대화 영속 store. */
  historyStore: AiChatHistoryStore
  /**
   * BYOK 허용 provider 목록 (KI-003). 디폴트 ['openai'].
   *   - 사용자 onboarding 미완료 / Codex 자동 호출 위협 차단.
   *   - 사용자 명시 동의 (settings UI) 시 호출자가 ['openai', 'codex'] 전달.
   *   - 'local' provider 도입 시 (Phase 3) 호출자가 ['local'] 단독 또는 합집합 전달.
   */
  allowedProviders?: ReadonlyArray<ProviderType>
}

export interface ChatInput {
  workspaceId: string
  userMessage: string
  /** anchor — 페이지 컨텍스트 안에서의 대화 (nullable). */
  pageId?: string | null
  /** anchor — 특정 visit (nullable). */
  visitId?: string | null
  /** SearchService.search 결과 retrieved items (M5-6 호출자 책임). */
  retrievedItems?: RetrievedItem[]
  /** PromptComposer 입력 (수준 / retrieved 본문 / customSystemPrompt). */
  prompt?: PromptComposeOptions
  /** provider.chat 의 modelHint / temperature / maxOutputTokens. */
  modelHint?: string
  temperature?: number
  maxOutputTokens?: number
}

export type ChatResult =
  | {
      ok: true
      userChatId: string
      assistantChatId: string
      assistantMessage: string
      response: ChatResponse
    }
  | {
      ok: false
      error: string
      errorCode:
        | 'byok_required'
        | 'chat_unsupported'
        | 'provider_error'
        | 'invalid_input'
        | 'aborted'
      userChatId?: string
      /** provider_error 시 영속된 'error' role 메시지 id. UI 가 timeline 표시에 활용. */
      assistantChatId?: string
    }

const DEFAULT_ALLOWED_PROVIDERS: ReadonlyArray<ProviderType> = ['openai']

/**
 * Sprint 016 M0 T02-followup (KI-006) — workspace 단위 chat abort generation (모듈 레벨, cross-instance 공유).
 *
 * `chat:request` IPC 핸들러는 매 호출마다 `new ChatService(...)` 인스턴스화 (services.ts L571) —
 * 인스턴스 멤버로 추적 시 abort 호출 시점에 다른 인스턴스에 도달 못 함. 모듈 레벨 Map 으로
 * cross-instance 공유.
 *
 * codex BLOCKING #1 흡수 (boolean Set 1회 suppress 의 race condition 해소):
 *   - abortStreaming(ws) → generation +1
 *   - chat 시작 시 startGen 캡처
 *   - chat 종료 직전 currentGen 확인 → `startGen < currentGen` 이면 assistant INSERT 차단
 *
 * 효과:
 *   - abort 호출 이전에 시작된 모든 in-flight chat 이 차단 (동시 2건 race-safe)
 *   - abort 호출 이후 새로 시작된 chat 은 정상 처리 (오탐 차단)
 *
 * provider.chat 자체는 cancel 안 함 (provider AbortSignal 통전은 G-013 3단계 후속 PR — ChatRequest.signal optional 추가).
 */
const chatAbortGenerations = new Map<string, number>()

export class ChatService {
  private readonly provider: ProviderAdapter
  private readonly historyStore: AiChatHistoryStore
  private readonly allowedProviders: ReadonlyArray<ProviderType>
  /** monotonic timestamp 보장 — 빠른 연속 INSERT 시 ms 충돌 회피 (SQLite ORDER BY created_at 결정성). */
  private lastTimestamp = 0

  constructor(opts: ChatServiceOptions) {
    this.provider = opts.provider
    this.historyStore = opts.historyStore
    this.allowedProviders = opts.allowedProviders ?? DEFAULT_ALLOWED_PROVIDERS
  }

  /**
   * Sprint 016 M0 T02-followup (KI-006) — workspace chat abort (race-safe generation 패턴).
   *
   * 호출 시점 generation +1 → 그 이전에 시작된 모든 in-flight chat 의 assistant INSERT 차단 +
   * errorCode 'aborted' 반환. 호출 이후 새로 시작된 chat 은 정상 처리 (workspaceHandlers 가
   * `setActive` 직전 호출 → 직후 새 ws 또는 같은 ws 신규 chat 정상).
   *
   * user 메시지는 이미 영속된 상태 유지 (UX 일관성). EmbeddingClient in_progress 보호 (PRD §11.3.3)
   * 는 G-013 3단계 후속 PR — provider.chat 의 AbortSignal 통전과 함께 worker 측 generation 확인.
   *
   * static 메서드 형식 — `chat:request` IPC 가 매번 new ChatService 라 instance 메서드는 의미 없음.
   * Map 모듈 레벨로 cross-instance 공유 (services.ts L571 회귀 분석).
   */
  static abortStreaming(workspaceId: string): void {
    const prev = chatAbortGenerations.get(workspaceId) ?? 0
    chatAbortGenerations.set(workspaceId, prev + 1)
  }

  /** 테스트 / 디버그용 — workspace 현재 abort generation. */
  static getAbortGeneration(workspaceId: string): number {
    return chatAbortGenerations.get(workspaceId) ?? 0
  }

  /** 테스트용 — 모든 abort generation reset (test isolation). */
  static __resetAbortsForTest(): void {
    chatAbortGenerations.clear()
  }

  private nextTimestamp(): number {
    const now = Date.now()
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, now)
    return this.lastTimestamp
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const userMessage = input.userMessage?.trim() ?? ''
    if (userMessage.length === 0) {
      return {
        ok: false,
        error: '사용자 메시지가 비어 있습니다.',
        errorCode: 'invalid_input'
      }
    }
    if (!input.workspaceId) {
      return {
        ok: false,
        error: '워크스페이스가 지정되지 않았습니다.',
        errorCode: 'invalid_input'
      }
    }

    // Sprint 016 M0 T02-followup (KI-006) — chat abort generation 캡처 (race-safe).
    // BYOK / chat_unsupported 차단 이후 + user 메시지 영속 전 시점에 캡처 — 후속 abort 호출과 비교.
    const startAbortGen = chatAbortGenerations.get(input.workspaceId) ?? 0

    // KI-003 BYOK 검증
    const providerType = this.provider.info.providerType
    if (!this.allowedProviders.includes(providerType)) {
      return {
        ok: false,
        error: `Provider '${providerType}' 는 자동 ChatGPT 한도 소진 위협으로 차단되었습니다. 설정에서 명시 동의하거나 OpenAI API Key 로 변경해 주세요.`,
        errorCode: 'byok_required'
      }
    }

    if (!this.provider.chat) {
      return {
        ok: false,
        error: `Provider '${providerType}' 는 chat 메서드를 지원하지 않습니다.`,
        errorCode: 'chat_unsupported'
      }
    }

    // 사용자 메시지 영속 (provider 호출 전 — 실패 시도 user 입력 보존)
    // monotonic created_at — 빠른 연속 INSERT 시 동일 ms timestamp 로 SQLite ORDER BY 비결정 회피.
    const userChat: ChatRow = this.historyStore.create({
      workspace_id: input.workspaceId,
      page_id: input.pageId ?? null,
      visit_id: input.visitId ?? null,
      role: 'user',
      content: userMessage,
      retrieved_items: input.retrievedItems ?? null,
      status: 'ok',
      created_at: this.nextTimestamp()
    })

    // system prompt + chat 호출
    const systemPrompt = composeSystemPrompt(input.prompt ?? {})
    const request: ChatRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      modelHint: input.modelHint,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens
    }

    let response: ChatResponse
    try {
      response = await this.provider.chat(request)
    } catch (err) {
      const rawErrorMsg = err instanceof Error ? err.message : String(err)
      // codex M5-5 PR #157 NEEDS_CHANGES 정정 — 빈 errorMsg ('') 시 AiChatHistoryStore.create 가
      // `content required` throw → uncaught 예외 유출. fallback placeholder 보장.
      const errorMsg = rawErrorMsg.trim() || 'Provider chat failed'
      // 실패 메시지 영속 (role='error' — schema CHECK 정합). monotonic timestamp 보장.
      const errorChat = this.historyStore.create({
        workspace_id: input.workspaceId,
        page_id: input.pageId ?? null,
        visit_id: input.visitId ?? null,
        role: 'error',
        content: errorMsg,
        status: 'failed',
        created_at: this.nextTimestamp()
      })
      return {
        ok: false,
        error: errorMsg,
        errorCode: 'provider_error',
        userChatId: userChat.id,
        assistantChatId: errorChat.id
      }
    }

    // Sprint 016 M0 T02-followup (KI-006) — abort generation 비교 (race-safe).
    // provider.chat 자체는 이미 완료된 상태 — 응답 텍스트는 discard. user 메시지는 영속 유지.
    // startAbortGen < currentAbortGen 이면 본 chat 시작 이후 abort 호출 발생 → suppress.
    const currentAbortGen = chatAbortGenerations.get(input.workspaceId) ?? 0
    if (startAbortGen < currentAbortGen) {
      return {
        ok: false,
        error: '워크스페이스 전환으로 인해 채팅 응답이 취소되었습니다.',
        errorCode: 'aborted',
        userChatId: userChat.id
      }
    }

    // assistant 응답 영속. user 메시지 보다 created_at + 1 보장 (sequential).
    const assistantChat = this.historyStore.create({
      workspace_id: input.workspaceId,
      page_id: input.pageId ?? null,
      visit_id: input.visitId ?? null,
      role: 'assistant',
      content: response.text,
      retrieved_items: input.retrievedItems ?? null,
      status: 'ok',
      created_at: this.nextTimestamp()
    })

    return {
      ok: true,
      userChatId: userChat.id,
      assistantChatId: assistantChat.id,
      assistantMessage: response.text,
      response
    }
  }

  /** Sprint 015 M5-6 ChatPanel listByWorkspace 호출용 (편의 메서드). */
  listHistory(workspaceId: string): ChatRow[] {
    return this.historyStore.listByWorkspace(workspaceId)
  }
}
