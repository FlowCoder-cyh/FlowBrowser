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
import type { ProviderInfo, TranslationInput, TranslationOutput } from '../types'
import {
  DeviceCodeFlow,
  type TokenBundle,
  type DeviceCodeFlowOptions
} from '../codex/DeviceCodeFlow'
import { resolveCodexAuthIdentity } from '../codex/JwtDecoder'
import { buildSystemPrompt, buildUserPrompt } from './OpenAIApiKeyProvider'

const CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const DEFAULT_MODEL = 'gpt-5'
const AVAILABLE_MODELS: ReadonlyArray<string> = ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini']

interface ResponsesApiOutputContent {
  type?: string
  text?: string
}

interface ResponsesApiOutputItem {
  type?: string
  content?: ResponsesApiOutputContent[]
}

interface ResponsesApiResponse {
  id?: string
  model?: string
  output?: ResponsesApiOutputItem[]
  /** 신규 형식 일부 (output_text 직접 노출) */
  output_text?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

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
    availableModels: AVAILABLE_MODELS
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
          input: 'ping',
          stream: false
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
    const messages = [
      { role: 'system' as const, content: buildSystemPrompt(input) },
      { role: 'user' as const, content: buildUserPrompt(input) }
    ]

    let token = await this.ensureFreshToken()
    let identity = resolveCodexAuthIdentity(token.accessToken)
    if (!identity.accountId) {
      throw new ProviderError(
        'Codex Login 토큰에서 ChatGPT account_id를 찾지 못했습니다. 재로그인 필요.',
        'auth_invalid',
        false
      )
    }

    let res = await this.callResponses(token.accessToken, identity.accountId, model, messages)

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
        res = await this.callResponses(token.accessToken, identity.accountId, model, messages)
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

    const data = (await res.json()) as ResponsesApiResponse
    const text = extractOutputText(data)
    if (!text) {
      throw new ProviderError('Codex Login 응답에 결과가 없습니다.', 'server_error', true)
    }
    const inputTokens = data.usage?.input_tokens ?? 0
    const outputTokens = data.usage?.output_tokens ?? 0
    return {
      translatedText: text,
      modelUsed: data.model ?? model,
      inputTokens,
      outputTokens,
      // ChatGPT 구독 한도 내 호출은 별도 비용 청구 없음으로 추정 (Phase 1 PoC #1 측정 후 확정)
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
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
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): Promise<Response> {
    return this.fetchImpl(`${CODEX_RESPONSES_BASE_URL}/responses`, {
      method: 'POST',
      headers: this.buildHeaders(accessToken, accountId),
      body: JSON.stringify({
        model,
        input: messages,
        stream: false
      })
    })
  }

  private resolveModel(hint?: string): string {
    if (hint && AVAILABLE_MODELS.includes(hint)) return hint
    return DEFAULT_MODEL
  }
}

/**
 * Responses API 응답에서 텍스트 추출.
 * 형식 (1): { output_text: "..." } — 신규 단순 형식
 * 형식 (2): { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
 */
function extractOutputText(data: ResponsesApiResponse): string {
  if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
    return data.output_text.trim()
  }
  if (Array.isArray(data.output)) {
    const parts: string[] = []
    for (const item of data.output) {
      if (item.type && item.type !== 'message') continue
      if (!Array.isArray(item.content)) continue
      for (const c of item.content) {
        if (typeof c.text === 'string') parts.push(c.text)
      }
    }
    return parts.join('').trim()
  }
  return ''
}
