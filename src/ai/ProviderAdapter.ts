/**
 * Provider Adapter 인터페이스.
 * PRD §10.1 chat / §12.4 ProviderAdapter v0.4.
 *
 * 모든 AI Provider 구현체는 본 인터페이스를 따른다.
 * Codex Login / OpenAI API Key / Anthropic / Gemini / DeepL / ElevenLabs / Local 등.
 *
 * Sprint 015 M2-7 — v0.4 chat() / embed() / chatStream() 메서드 분리.
 * Sprint 016 M2 T09 — translate() 단일 메서드 제거 (호출지점 0).
 *   selection 번역은 services.ts `executeTranslateRequest` 가 provider.chat() 호출.
 */

import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderInfo
} from './types'

export interface ProviderAdapter {
  readonly info: ProviderInfo

  /**
   * 인증 검증 (API Key 유효성 등).
   */
  validate(): Promise<{ ok: boolean; reason?: string }>

  /**
   * Sprint 015 M2-7 — Chat 호출 (multi-turn). PRD §10.1 채팅 파이프라인.
   *   - OpenAIApiKeyProvider: chat completions API (gpt-4o-mini 디폴트).
   *   - CodexLoginProvider: Responses API (gpt-5.5 디폴트).
   *   - 미지원 Provider 는 throw ProviderError('unsupported') 또는 undefined 미구현.
   *
   * 호출자 (M5 ChatService) 는 `info.supportsChat` 으로 능력 확인 후 호출.
   */
  chat?(request: ChatRequest): Promise<ChatResponse>

  /**
   * Sprint 015 M2-7 — Embedding 호출. PRD §08 EmbeddingClient base.
   *   - OpenAIApiKeyProvider: text-embedding-3-small (디폴트 1024 차원, PRD §08 정합).
   *   - CodexLoginProvider: throw ProviderError('unsupported') — ChatGPT 백엔드 임베딩 미공개.
   *
   * 호출자 (M3 EmbeddingClient) 는 `info.supportsEmbed` 로 능력 확인 후 호출.
   * BYOK 디폴트 정책 (G-003 강화) — 자동 인덱싱은 OpenAIApiKeyProvider 만 사용.
   */
  embed?(request: EmbedRequest): Promise<EmbedResponse>

  /**
   * Sprint 015 M2-7 — Chat 스트리밍 호출 (선택). M5 ChatService 진행률 표시에 활용.
   *
   * Provider 가 스트리밍 미지원 시 본 메서드 미정의. 호출자는 `chat()` 으로 fallback.
   * 본 메서드 구체 spec (yield 형식 등) 은 M5 ChatService 구현 시 확정.
   */
  chatStream?(request: ChatRequest): AsyncIterable<string>

  /**
   * 자원 해제 (선택).
   */
  dispose?(): Promise<void>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'auth_invalid'
      | 'rate_limit'
      | 'server_error'
      | 'network'
      | 'bad_request'
      | 'unsupported'
      | 'unknown',
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
