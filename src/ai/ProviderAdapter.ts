/**
 * Provider Adapter 인터페이스.
 * PRD §11.2 (v0.3) + §10.1 / §12.4 (v0.4 chat/embed 확장).
 *
 * 모든 AI Provider 구현체는 본 인터페이스를 따른다.
 * Codex Login / OpenAI API Key / Anthropic / Gemini / DeepL / ElevenLabs / Local 등.
 *
 * Sprint 015 M2-7 — v0.4 ProviderAdapter 확장.
 *   - chat() / embed() / chatStream() optional 메서드 추가
 *   - translate() 는 @deprecated 마킹 — M2~M5 호환 어댑터로 유지, M5 종료 시 제거 (PRD §19.5.4)
 *   - chat() 가 도입되면 단발 selection 번역은 chat({messages: [system+user]}) 로 대체 (M5 ChatService)
 *   - embed() 는 M3 EmbeddingClient (백그라운드 큐 + 워크스페이스 partition) 에서 활용
 */

import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderInfo,
  TranslationInput,
  TranslationOutput
} from './types'

export interface ProviderAdapter {
  readonly info: ProviderInfo

  /**
   * 인증 검증 (API Key 유효성 등).
   */
  validate(): Promise<{ ok: boolean; reason?: string }>

  /**
   * 텍스트 번역.
   * 호출 전 Privacy Filter 통과 여부는 TranslationEngine에서 검증.
   *
   * @deprecated Sprint 015 M2-7 — v0.4 ProviderAdapter 는 `chat()` / `embed()` 로 분리.
   *   본 메서드는 M2~M5 어댑터로 유지 (services.ts `executeTranslateRequest` 가 selection 번역에 사용).
   *   M5 ChatService 도입 시 chat 으로 마이그레이션 → M5 종료 시 본 메서드 제거 (PRD §19.5.4).
   */
  translate(input: TranslationInput): Promise<TranslationOutput>

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
