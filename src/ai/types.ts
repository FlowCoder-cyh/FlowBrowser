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
}
