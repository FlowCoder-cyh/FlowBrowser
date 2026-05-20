/**
 * AI Processing Layer 공통 타입.
 * PRD §12.3 TranslationRequest / §12.8 UsageLog.
 */

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepl' | 'elevenlabs' | 'codex' | 'local'

export type RequestType =
  | 'selection'
  | 'paragraph'
  | 'page'
  | 'subtitle'
  | 'tts_script'
  | 'explanation'
  | 'summary'

export interface TranslationInput {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  requestType: RequestType
  modelHint?: string
  context?: {
    url?: string
    title?: string
    surroundingText?: string
  }
}

export interface TranslationOutput {
  translatedText: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  durationMs: number
}

export interface ProviderInfo {
  providerType: ProviderType
  displayName: string
  supportedRequestTypes: ReadonlyArray<RequestType>
  defaultModel: string
  availableModels: ReadonlyArray<string>
  /**
   * Sprint 015 M2-7 — Provider 가 chat/embed 메서드를 지원하는지 (v0.4 ProviderAdapter 확장).
   * UI 분기 및 fallback 결정에 사용. 미선언 시 false 로 간주.
   */
  supportsChat?: boolean
  supportsEmbed?: boolean
}

/**
 * Sprint 015 M2-7 — Chat 메시지 (multi-turn 지원).
 * PRD §10.1 채팅 파이프라인 + §12.4 ProviderAdapter v0.4 정합.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  /**
   * 모델 hint (provider-specific). 미주입 시 ProviderInfo.defaultModel.
   */
  modelHint?: string
  /**
   * Sampling temperature (0~2). 디폴트는 provider 가 결정.
   */
  temperature?: number
  /**
   * 최대 응답 토큰 (provider 가 지원 시 적용).
   */
  maxOutputTokens?: number
  /**
   * Sprint 016 M0 T04 (KI-004) — 응답 포맷 강제 (API-level).
   *
   * - `'text'` (디폴트): 자유 텍스트
   * - `'json_object'`: JSON 객체 반환 강제. OpenAI Chat Completions `response_format: { type: 'json_object' }` 직결.
   *
   * provider 미지원 시 silent ignore (e.g. Codex Login Responses API 는 본 옵션 미적용 — instructions 로 우회).
   *
   * AutoTagger / 향후 schema parse 호출자가 `'json_object'` 지정 → freeform fallback 의존성 축소.
   */
  responseFormat?: 'text' | 'json_object'
}

export interface ChatResponse {
  text: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  durationMs: number
}

/**
 * Sprint 015 M2-7 — Embedding 요청 / 응답.
 * PRD §08 EmbeddingClient (text-embedding-3-small 1024 차원) 정합.
 *
 * 본 인터페이스는 ProviderAdapter 직접 호출 spec. 실제 EmbeddingClient 는 M3 신규 (백그라운드 큐 + 워크스페이스 partition + 비용 추적).
 */
export interface EmbedRequest {
  texts: string[]
  /**
   * 모델 hint (provider-specific). 미주입 시 OpenAI 의 경우 text-embedding-3-small.
   */
  modelHint?: string
  /**
   * 벡터 차원 (OpenAI 의 경우 1024 디폴트, PRD §08 정합). provider 가 dimension 변경 지원 시 사용.
   */
  dimensions?: number
}

export interface EmbedResponse {
  /**
   * 입력 texts 와 1:1 매핑된 벡터 배열. 각 벡터의 길이는 EmbedRequest.dimensions (혹은 모델 디폴트).
   */
  vectors: number[][]
  modelUsed: string
  /**
   * 임베딩은 input tokens 만 과금 (output 없음).
   */
  inputTokens: number
  estimatedCostUsd: number
  durationMs: number
}
