/**
 * Sprint 014 M1 — Codex Login Provider.
 *
 * ChatGPT 구독 계정으로 로그인하여 받은 access_token으로 OpenAI chat completions 호출.
 * 401 발생 시 refresh_token으로 1회 재시도. refresh 실패 시 expired throw → 폴백 트리거 (services.ts).
 *
 * Spike 1 조건:
 *  1. Experimental 라벨 → UI 책임 (CodexLoginPanel)
 *  2. 자체 OAuth 등록 안 함 → DeviceCodeFlow의 공개 client_id 사용
 *  3. device-code + PKCE 직접 구현 → DeviceCodeFlow
 *  4. OS Keychain 위임 → CredentialsStore safeStorage
 *  5. 정책 변경 시 폴백 → services.ts rebuildAllProviders + 401 시 expired 마킹
 *
 * G-011 회색지대 허용 정합.
 */

import { ProviderError, type ProviderAdapter } from '../ProviderAdapter'
import type { ProviderInfo, TranslationInput, TranslationOutput } from '../types'
import {
  DeviceCodeFlow,
  type TokenBundle,
  type DeviceCodeFlowOptions
} from '../codex/DeviceCodeFlow'
import { buildSystemPrompt, buildUserPrompt } from './OpenAIApiKeyProvider'

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  model: string
}

const OPENAI_API_BASE = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
const AVAILABLE_MODELS: ReadonlyArray<string> = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo']

export interface CodexTokenAccess {
  /** 현재 토큰 묶음 반환 (만료 시 caller가 refresh 책임 또는 본 클래스가 자동 refresh) */
  get(): TokenBundle
  /** refresh 후 저장 책임 caller에게 위임 */
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
      const res = await this.fetchImpl(`${OPENAI_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${token.accessToken}` }
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'Codex Login 토큰이 유효하지 않거나 만료되었습니다.' }
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

    // 1차 호출
    let token = await this.ensureFreshToken()
    let res = await this.callChat(token.accessToken, model, messages)

    // 401 시 refresh 1회 시도 후 재호출
    if (res.status === 401 || res.status === 403) {
      try {
        const fresh = await this.flow.refreshTokens(token.refreshToken)
        this.tokenAccess.update(fresh)
        token = fresh
        res = await this.callChat(token.accessToken, model, messages)
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
      throw new ProviderError('Codex Login rate limit', 'rate_limit', true)
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

    const data = (await res.json()) as ChatCompletionResponse
    const translated = data.choices[0]?.message?.content?.trim() ?? ''
    if (!translated) {
      throw new ProviderError('Codex Login 응답에 결과가 없습니다.', 'server_error', true)
    }
    const inputTokens = data.usage?.prompt_tokens ?? 0
    const outputTokens = data.usage?.completion_tokens ?? 0
    return {
      translatedText: translated,
      modelUsed: data.model ?? model,
      inputTokens,
      outputTokens,
      // Codex Login은 ChatGPT 구독 한도로 처리 (별도 API 청구 없음 추정 — Phase 1 PoC #1 측정 후 확정)
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * 토큰이 만료 60초 이내면 자동 refresh.
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

  private async callChat(
    accessToken: string,
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): Promise<Response> {
    return this.fetchImpl(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        stream: false
      })
    })
  }

  private resolveModel(hint?: string): string {
    if (hint && AVAILABLE_MODELS.includes(hint)) return hint
    return DEFAULT_MODEL
  }
}
