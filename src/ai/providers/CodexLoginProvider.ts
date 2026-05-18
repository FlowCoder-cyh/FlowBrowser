/**
 * Sprint 014 M1 / M3-6 — Codex Login Provider.
 *
 * ChatGPT 구독 계정으로 로그인하여 받은 access_token으로 ChatGPT Codex 백엔드 호출.
 *
 * M3-6 (사용자 지적 + OpenClaw 사례 반영):
 * - endpoint: api.openai.com → chatgpt.com/backend-api/codex/responses
 * - 헤더: + ChatGPT-Account-Id (JWT 추출) + OAI-Product-Sku: codex
 * - 요청 body: chat/completions → Responses API ({ model, input: messages, stream: false })
 * - 응답 파싱: choices[0].message.content → output[].content[].text
 *
 * 401 발생 시 refresh_token으로 1회 재시도. refresh 실패 시 ProviderError auth_invalid → 폴백.
 *
 * Spike 1 조건 + G-011 회색지대 허용 정합.
 */

import { ProviderError, type ProviderAdapter } from '../ProviderAdapter'
import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderInfo,
  TranslationInput,
  TranslationOutput
} from '../types'
import {
  DeviceCodeFlow,
  type TokenBundle,
  type DeviceCodeFlowOptions
} from '../codex/DeviceCodeFlow'
import { resolveCodexAuthIdentity } from '../codex/JwtDecoder'
import { accumulateResponsesStream } from '../codex/SseStreamParser'
import { buildSystemPrompt, buildUserPrompt } from './OpenAIApiKeyProvider'

const CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex'
// Sprint 014 M3-7 핫픽스: ChatGPT 백엔드가 받는 정확 모델명은 gpt-5.5 / gpt-5.4-mini / gpt-5.2
// (OpenClaw provider-catalog.ts FALLBACK_CODEX_MODELS).
// 사용자 보고 400: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account."
const DEFAULT_MODEL = 'gpt-5.5'
const AVAILABLE_MODELS: ReadonlyArray<string> = ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.2']

export interface CodexTokenAccess {
  get(): TokenBundle
  update(bundle: TokenBundle): void
}

export interface CodexLoginProviderOptions {
  tokenAccess: CodexTokenAccess
  flow?: DeviceCodeFlow
  fetchImpl?: typeof fetch
  deviceCodeOptions?: DeviceCodeFlowOptions
}

export class CodexLoginProvider implements ProviderAdapter {
  readonly info: ProviderInfo = {
    providerType: 'codex',
    displayName: 'Codex Login (Experimental)',
    supportedRequestTypes: [
      'selection',
      'paragraph',
      'page',
      'subtitle',
      'tts_script',
      'explanation',
      'summary'
    ],
    defaultModel: DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS,
    // Sprint 015 M2-7 — v0.4 ProviderAdapter chat 지원 (Responses API). embed 는 ChatGPT 백엔드 미공개.
    supportsChat: true,
    supportsEmbed: false
  }

  private readonly tokenAccess: CodexTokenAccess
  private readonly flow: DeviceCodeFlow
  private readonly fetchImpl: typeof fetch

  constructor(options: CodexLoginProviderOptions) {
    this.tokenAccess = options.tokenAccess
    this.flow = options.flow ?? new DeviceCodeFlow(options.deviceCodeOptions)
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async validate(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const token = await this.ensureFreshToken()
      const identity = resolveCodexAuthIdentity(token.accessToken)
      if (!identity.accountId) {
        return { ok: false, reason: 'ChatGPT account_id를 토큰에서 찾지 못했습니다.' }
      }
      // 별도 ping endpoint 대신 가벼운 호출로 검증
      const res = await this.fetchImpl(`${CODEX_RESPONSES_BASE_URL}/responses`, {
        method: 'POST',
        headers: this.buildHeaders(token.accessToken, identity.accountId),
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          instructions: 'Respond with the word ok.',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'ping' }]
            }
          ],
          tools: [],
          tool_choice: 'auto',
          parallel_tool_calls: true,
          store: false,
          stream: true,
          reasoning: { effort: 'low', summary: null },
          include: []
        })
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'Codex Login 토큰이 유효하지 않거나 만료되었습니다.' }
      }
      if (res.status === 429) {
        // 한도 초과는 토큰 자체는 유효
        return { ok: true }
      }
      if (!res.ok) {
        return { ok: false, reason: `검증 실패: HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async translate(input: TranslationInput): Promise<TranslationOutput> {
    const startedAt = Date.now()
    const model = this.resolveModel(input.modelHint)
    // Sprint 014 M3-8 핫픽스: Responses API는 system prompt를 instructions 필드로,
    // user prompt만 input으로 받는다. 기존엔 [system+user]를 input 배열로 보내
    // "Instructions are required" 400 발생.
    const instructions = buildSystemPrompt(input)
    const userContent = buildUserPrompt(input)

    let token = await this.ensureFreshToken()
    let identity = resolveCodexAuthIdentity(token.accessToken)
    if (!identity.accountId) {
      throw new ProviderError(
        'Codex Login 토큰에서 ChatGPT account_id를 찾지 못했습니다. 재로그인 필요.',
        'auth_invalid',
        false
      )
    }

    let res = await this.callResponses(
      token.accessToken,
      identity.accountId,
      model,
      instructions,
      userContent
    )

    // 401/403 시 refresh 1회 시도 후 재호출
    if (res.status === 401 || res.status === 403) {
      try {
        const fresh = await this.flow.refreshTokens(token.refreshToken)
        this.tokenAccess.update(fresh)
        token = fresh
        identity = resolveCodexAuthIdentity(token.accessToken)
        if (!identity.accountId) {
          throw new Error('refresh 후 account_id 추출 실패')
        }
        res = await this.callResponses(
          token.accessToken,
          identity.accountId,
          model,
          instructions,
          userContent
        )
      } catch (err) {
        throw new ProviderError(
          `Codex Login 인증 만료: ${err instanceof Error ? err.message : String(err)}`,
          'auth_invalid',
          false
        )
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('Codex Login 인증 만료 (refresh 후도 실패)', 'auth_invalid', false)
    }
    if (res.status === 429) {
      throw new ProviderError(
        'ChatGPT 구독 사용 한도 도달. 잠시 후 다시 시도하세요.',
        'rate_limit',
        true
      )
    }
    if (res.status >= 500) {
      throw new ProviderError(`Codex Login 서버 오류: ${res.status}`, 'server_error', true)
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(
        `Codex Login 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    // Sprint 014 M3-11: SSE 스트림 파싱 (ChatGPT 백엔드는 stream: true 강제)
    if (!res.body) {
      throw new ProviderError('Codex Login 응답 body가 비어 있습니다.', 'server_error', true)
    }
    const accumulated = await accumulateResponsesStream(res.body)
    if (!accumulated.text) {
      throw new ProviderError('Codex Login 응답에 결과가 없습니다.', 'server_error', true)
    }
    return {
      translatedText: accumulated.text,
      modelUsed: accumulated.model ?? model,
      inputTokens: accumulated.inputTokens ?? 0,
      outputTokens: accumulated.outputTokens ?? 0,
      // ChatGPT 구독 한도 내 호출은 별도 비용 청구 없음으로 추정 (Phase 1 PoC #1 측정 후 확정)
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * Sprint 015 M2-7 — Chat 호출. Codex Responses API (chatgpt.com/backend-api/codex/responses).
   *
   * messages 의 system role 은 instructions 필드로 합쳐 보냄 (Responses API 규약, M3-8 패턴).
   * user/assistant role 은 input 배열로 직렬 전달 (multi-turn).
   * 401 시 refresh_token 으로 1회 재시도 (translate 와 동일 패턴).
   * 비용: ChatGPT 구독 한도 내 0 (한도 초과 시 429 → rate_limit error). G-003 강화 — 자동 호출 X.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (request.messages.length === 0) {
      throw new ProviderError('Codex chat: messages 가 비어 있습니다.', 'bad_request', false)
    }
    const startedAt = Date.now()
    const model = this.resolveModel(request.modelHint)
    const { instructions, inputMessages } = this.splitMessagesForResponsesApi(request.messages)

    let token = await this.ensureFreshToken()
    let identity = resolveCodexAuthIdentity(token.accessToken)
    if (!identity.accountId) {
      throw new ProviderError(
        'Codex Login 토큰에서 ChatGPT account_id를 찾지 못했습니다. 재로그인 필요.',
        'auth_invalid',
        false
      )
    }

    let res = await this.callResponsesRaw(
      token.accessToken,
      identity.accountId,
      model,
      instructions,
      inputMessages
    )

    if (res.status === 401 || res.status === 403) {
      try {
        const fresh = await this.flow.refreshTokens(token.refreshToken)
        this.tokenAccess.update(fresh)
        token = fresh
        identity = resolveCodexAuthIdentity(token.accessToken)
        if (!identity.accountId) {
          throw new Error('refresh 후 account_id 추출 실패')
        }
        res = await this.callResponsesRaw(
          token.accessToken,
          identity.accountId,
          model,
          instructions,
          inputMessages
        )
      } catch (err) {
        throw new ProviderError(
          `Codex Login 인증 만료: ${err instanceof Error ? err.message : String(err)}`,
          'auth_invalid',
          false
        )
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('Codex Login 인증 만료 (refresh 후도 실패)', 'auth_invalid', false)
    }
    if (res.status === 429) {
      throw new ProviderError(
        'ChatGPT 구독 사용 한도 도달. 잠시 후 다시 시도하세요.',
        'rate_limit',
        true
      )
    }
    if (res.status >= 500) {
      throw new ProviderError(`Codex Login 서버 오류: ${res.status}`, 'server_error', true)
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(
        `Codex Login 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    if (!res.body) {
      throw new ProviderError('Codex Login 응답 body가 비어 있습니다.', 'server_error', true)
    }
    const accumulated = await accumulateResponsesStream(res.body)
    if (!accumulated.text) {
      throw new ProviderError('Codex Login 응답에 결과가 없습니다.', 'server_error', true)
    }
    return {
      text: accumulated.text,
      modelUsed: accumulated.model ?? model,
      inputTokens: accumulated.inputTokens ?? 0,
      outputTokens: accumulated.outputTokens ?? 0,
      // ChatGPT 구독 한도 내 호출은 별도 비용 청구 없음 (translate 와 동일 가정).
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * Sprint 015 M2-7 — Embedding 호출 미지원. ChatGPT 백엔드는 임베딩 endpoint 미공개.
   * 자동 인덱싱 (M3 EmbeddingClient) 은 OpenAIApiKeyProvider 만 사용 — BYOK 디폴트 (G-003 강화).
   */
  async embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new ProviderError(
      'Codex Login Provider 는 embedding 을 지원하지 않습니다. OpenAI API Key 를 설정하세요.',
      'unsupported',
      false
    )
  }

  /**
   * Responses API 규약: system role 메시지는 instructions 필드로 합치고 나머지는 input 배열로 전달.
   * 여러 system 메시지가 있으면 줄바꿈으로 join.
   */
  private splitMessagesForResponsesApi(messages: ChatRequest['messages']): {
    instructions: string
    inputMessages: Array<{ role: 'user' | 'assistant'; text: string }>
  } {
    const systems: string[] = []
    const inputMessages: Array<{ role: 'user' | 'assistant'; text: string }> = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        systems.push(msg.content)
      } else {
        inputMessages.push({ role: msg.role, text: msg.content })
      }
    }
    return { instructions: systems.join('\n\n'), inputMessages }
  }

  /**
   * chat() 전용 Responses API 호출 (multi-turn input). translate() 와 별개 — translate 는 단일 user 입력만 처리.
   */
  private async callResponsesRaw(
    accessToken: string,
    accountId: string,
    model: string,
    instructions: string,
    inputMessages: Array<{ role: 'user' | 'assistant'; text: string }>
  ): Promise<Response> {
    return this.fetchImpl(`${CODEX_RESPONSES_BASE_URL}/responses`, {
      method: 'POST',
      headers: this.buildHeaders(accessToken, accountId),
      body: JSON.stringify({
        model,
        instructions,
        input: inputMessages.map((m) => ({
          type: 'message',
          role: m.role,
          content: [
            { type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text }
          ]
        })),
        tools: [],
        tool_choice: 'auto',
        parallel_tool_calls: true,
        store: false,
        stream: true,
        reasoning: { effort: 'low', summary: null },
        include: []
      })
    })
  }

  /**
   * 만료 60초 이내면 자동 refresh.
   */
  private async ensureFreshToken(): Promise<TokenBundle> {
    const token = this.tokenAccess.get()
    if (token.expiresAt - Date.now() > 60_000) return token
    try {
      const fresh = await this.flow.refreshTokens(token.refreshToken)
      this.tokenAccess.update(fresh)
      return fresh
    } catch (err) {
      throw new ProviderError(
        `Codex Login refresh 실패: ${err instanceof Error ? err.message : String(err)}`,
        'auth_invalid',
        false
      )
    }
  }

  private buildHeaders(accessToken: string, accountId: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'ChatGPT-Account-Id': accountId,
      'OAI-Product-Sku': 'codex',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  private async callResponses(
    accessToken: string,
    accountId: string,
    model: string,
    instructions: string,
    userInput: string
  ): Promise<Response> {
    // Sprint 014 M3-10: Hermes(NousResearch/hermes-agent) agent/transports/codex.py 분석.
    // ChatGPT 백엔드 Responses API는 store: false 필수 + tools/tool_choice/parallel_tool_calls
    // 메타 필드도 요구. M3-9는 store 누락으로 "Store must be set to false" 400.
    return this.fetchImpl(`${CODEX_RESPONSES_BASE_URL}/responses`, {
      method: 'POST',
      headers: this.buildHeaders(accessToken, accountId),
      body: JSON.stringify({
        model,
        instructions,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: userInput }]
          }
        ],
        tools: [],
        tool_choice: 'auto',
        parallel_tool_calls: true,
        store: false,
        stream: true,
        // Sprint 014 M3-12: gpt-5.5는 reasoning 모델. effort='low'로 응답 속도 개선
        // (Hermes _effort_clamp = {"minimal": "low"} — low가 최소). 번역 use case는
        // 깊은 추론 불필요.
        reasoning: { effort: 'low', summary: null },
        include: []
      })
    })
  }

  private resolveModel(hint?: string): string {
    if (hint && AVAILABLE_MODELS.includes(hint)) return hint
    return DEFAULT_MODEL
  }
}

