/**
 * Provider Adapter 인터페이스.
 * PRD §11.2.
 *
 * 모든 AI Provider 구현체는 본 인터페이스를 따른다.
 * Codex Login / OpenAI API Key / Anthropic / Gemini / DeepL / ElevenLabs / Local 등.
 */

import type { ProviderInfo, TranslationInput, TranslationOutput } from './types'

export interface ProviderAdapter {
  readonly info: ProviderInfo

  /**
   * 인증 검증 (API Key 유효성 등).
   */
  validate(): Promise<{ ok: boolean; reason?: string }>

  /**
   * 텍스트 번역.
   * 호출 전 Privacy Filter 통과 여부는 TranslationEngine에서 검증.
   */
  translate(input: TranslationInput): Promise<TranslationOutput>

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
