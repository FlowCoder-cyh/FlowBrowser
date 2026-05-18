/**
 * OpenAI API Key Provider.
 * MVP 기본 Provider (PRD v0.3 §15.2).
 *
 * fetch 직접 호출. 의존성 최소화.
 * 모델: gpt-4o-mini (저렴), gpt-4o (고품질) 선택 가능.
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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  model: string
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

const MODEL_PRICING_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  // 2024-2025 공개 가격 추정. 정확한 가격은 OpenAI 페이지 참조.
  // 단위: USD per 1M tokens
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 }
}

const DEFAULT_MODEL = 'gpt-4o-mini'
const AVAILABLE_MODELS: ReadonlyArray<string> = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo']

// Sprint 015 M2-7 — Embedding 모델. PRD §08 EmbeddingClient + §15 비용 정합 (2026-05-16 OpenAI 공식 가격).
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small'
const AVAILABLE_EMBED_MODELS: ReadonlyArray<string> = [
  'text-embedding-3-small',
  'text-embedding-3-large'
]
const DEFAULT_EMBED_DIMENSIONS = 1024 // PRD §07 / v04-direction §7 (1536 디폴트에서 dimensions=1024 축소)
const EMBED_PRICING_PER_M_TOKENS: Record<string, number> = {
  // 2026-05-16 OpenAI 공식 (https://platform.openai.com/docs/pricing). 단위: USD per 1M input tokens.
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

export class OpenAIApiKeyProvider implements ProviderAdapter {
  readonly info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'OpenAI API Key',
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
    // Sprint 015 M2-7 — v0.4 ProviderAdapter chat/embed 지원 표기.
    supportsChat: true,
    supportsEmbed: true
  }

  constructor(private readonly secretProvider: () => string) {}

  async validate(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const apiKey = this.secretProvider()
      const res = await fetch(`${OPENAI_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'API Key가 유효하지 않거나 권한이 없습니다.' }
      }
      if (!res.ok) {
        return { ok: false, reason: `검증 실패: HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        reason: `네트워크 오류: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async translate(input: TranslationInput): Promise<TranslationOutput> {
    const startedAt = Date.now()
    const model = this.resolveModel(input.modelHint)
    const messages = this.buildMessages(input)

    let res: Response
    try {
      res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretProvider()}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          stream: false
        })
      })
    } catch (err) {
      throw new ProviderError(
        `OpenAI 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
        'network',
        true
      )
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('OpenAI API Key 인증 실패', 'auth_invalid', false)
    }
    if (res.status === 429) {
      throw new ProviderError('OpenAI rate limit', 'rate_limit', true)
    }
    if (res.status >= 500) {
      throw new ProviderError(`OpenAI 서버 오류: ${res.status}`, 'server_error', true)
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(`OpenAI 요청 실패: ${res.status} ${errBody}`, 'bad_request', false)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const translated = data.choices[0]?.message?.content?.trim() ?? ''
    if (!translated) {
      throw new ProviderError('OpenAI 응답에 번역 결과가 없습니다.', 'server_error', true)
    }

    const inputTokens = data.usage?.prompt_tokens ?? 0
    const outputTokens = data.usage?.completion_tokens ?? 0
    const cost = this.estimateCost(model, inputTokens, outputTokens)

    return {
      translatedText: translated,
      modelUsed: data.model ?? model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: cost,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * Sprint 015 M2-7 — Chat 호출 (multi-turn). PRD §10.1 채팅 파이프라인.
   * translate() 와 동일 endpoint (chat/completions) 사용. messages 직접 전달.
   * temperature 디폴트 0.3 (번역 일관성 우선). maxOutputTokens 미주입 시 model 디폴트.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (request.messages.length === 0) {
      throw new ProviderError('OpenAI chat: messages 가 비어 있습니다.', 'bad_request', false)
    }
    const startedAt = Date.now()
    const model = this.resolveModel(request.modelHint)
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      stream: false
    }
    if (request.maxOutputTokens !== undefined) {
      body.max_tokens = request.maxOutputTokens
    }

    let res: Response
    try {
      res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretProvider()}`
        },
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new ProviderError(
        `OpenAI chat 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
        'network',
        true
      )
    }

    throwForHttpStatus(res, 'OpenAI chat')
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(
        `OpenAI chat 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    const data = (await res.json()) as ChatCompletionResponse
    const text = data.choices[0]?.message?.content?.trim() ?? ''
    if (!text) {
      throw new ProviderError('OpenAI chat 응답에 결과가 없습니다.', 'server_error', true)
    }
    const inputTokens = data.usage?.prompt_tokens ?? 0
    const outputTokens = data.usage?.completion_tokens ?? 0
    const cost = estimateCost(model, inputTokens, outputTokens)
    return {
      text,
      modelUsed: data.model ?? model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: cost,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * Sprint 015 M2-7 — Embedding 호출. PRD §08 EmbeddingClient base.
   * 디폴트 모델 text-embedding-3-small, 디폴트 차원 1024 (PRD §07 정합).
   * BYOK 정책 (G-003) — 자동 인덱싱은 본 메서드 호출.
   */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    if (request.texts.length === 0) {
      throw new ProviderError('OpenAI embed: texts 가 비어 있습니다.', 'bad_request', false)
    }
    const startedAt = Date.now()
    const model = this.resolveEmbedModel(request.modelHint)
    const dimensions = request.dimensions ?? DEFAULT_EMBED_DIMENSIONS
    const body = {
      model,
      input: request.texts,
      dimensions
    }

    let res: Response
    try {
      res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretProvider()}`
        },
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new ProviderError(
        `OpenAI embed 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
        'network',
        true
      )
    }

    throwForHttpStatus(res, 'OpenAI embed')
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(
        `OpenAI embed 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    const data = (await res.json()) as EmbeddingResponse
    if (!Array.isArray(data.data) || data.data.length !== request.texts.length) {
      throw new ProviderError(
        `OpenAI embed 응답 길이 불일치 (expected=${request.texts.length}, got=${data.data?.length ?? 0})`,
        'server_error',
        true
      )
    }
    // 응답이 index 순서대로 정렬되지 않을 수 있으므로 명시 정렬.
    const sorted = [...data.data].sort((a, b) => a.index - b.index)
    const vectors = sorted.map((d) => d.embedding)
    const inputTokens = data.usage?.prompt_tokens ?? 0
    const cost = estimateEmbedCost(model, inputTokens)
    return {
      vectors,
      modelUsed: data.model ?? model,
      inputTokens,
      estimatedCostUsd: cost,
      durationMs: Date.now() - startedAt
    }
  }

  private resolveModel(hint?: string): string {
    if (hint && AVAILABLE_MODELS.includes(hint)) return hint
    return DEFAULT_MODEL
  }

  private resolveEmbedModel(hint?: string): string {
    if (hint && AVAILABLE_EMBED_MODELS.includes(hint)) return hint
    return DEFAULT_EMBED_MODEL
  }

  private buildMessages(input: TranslationInput): ChatMessage[] {
    const systemPrompt = this.systemPromptFor(input)
    const userPrompt = this.userPromptFor(input)
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }

  // Sprint 004 M2 / M3 — system prompt 분기는 buildSystemPrompt에서 노출 (단위 테스트 대상).
  private systemPromptFor(input: TranslationInput): string {
    return buildSystemPrompt(input)
  }

  private userPromptFor(input: TranslationInput): string {
    return buildUserPrompt(input)
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return estimateCost(model, inputTokens, outputTokens)
  }
}

/**
 * Sprint 004 M2/M3 — system prompt 분기. 단위 테스트가 직접 호출한다.
 */
export function buildSystemPrompt(input: TranslationInput): string {
  if (input.requestType === 'explanation') {
    return `You are a tutor who explains difficult sentences clearly. Read the following ${input.sourceLanguage} text and write a short, easy-to-understand explanation in ${input.targetLanguage}. Unpack jargon, define terms, and clarify references. Output ONLY the explanation in ${input.targetLanguage}. Do not translate verbatim. Do not add prefaces or quotation marks.`
  }
  if (input.requestType === 'summary') {
    return `You are a summarizer. Write a concise summary of the following ${input.sourceLanguage} text in ${input.targetLanguage}. Use 3 to 5 short sentences. Capture the main points only. Output ONLY the summary in ${input.targetLanguage}. Do not add prefaces or quotation marks.`
  }
  const base = `You are a professional translator. Translate from ${input.sourceLanguage} to ${input.targetLanguage}. Output ONLY the translated text without explanations, quotation marks, or commentary.`
  if (input.requestType === 'subtitle') {
    return `${base} Keep each line short and readable as a subtitle.`
  }
  if (input.requestType === 'tts_script') {
    return `${base} Use short, easy-to-speak sentences suitable for TTS narration in ${input.targetLanguage}.`
  }
  return base
}

/**
 * Sprint 004 M2/M3 — user prompt 분기. 단위 테스트가 직접 호출한다.
 * Sprint 005 M2 — context.surroundingText에 glossary 블록이 들어오면 prompt에 포함.
 */
export function buildUserPrompt(input: TranslationInput): string {
  const ctxLines: string[] = []
  if (input.context?.url) ctxLines.push(`URL: ${input.context.url}`)
  if (input.context?.title) ctxLines.push(`Page title: ${input.context.title}`)
  if (input.context?.surroundingText) ctxLines.push(input.context.surroundingText)
  const ctx = ctxLines.length > 0 ? `Context:\n${ctxLines.join('\n')}\n\n` : ''
  if (input.requestType === 'explanation') {
    return `${ctx}Explain the following ${input.sourceLanguage} text in ${input.targetLanguage}:\n\n${input.sourceText}`
  }
  if (input.requestType === 'summary') {
    return `${ctx}Summarize the following ${input.sourceLanguage} text in ${input.targetLanguage}:\n\n${input.sourceText}`
  }
  return `${ctx}Translate the following ${input.sourceLanguage} text to ${input.targetLanguage}:\n\n${input.sourceText}`
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_PER_M_TOKENS[model] ?? MODEL_PRICING_PER_M_TOKENS[DEFAULT_MODEL]
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

/**
 * Sprint 015 M2-7 — Embedding 비용 추정. text-embedding-3-small $0.02/M (2026-05-16 공식).
 */
function estimateEmbedCost(model: string, inputTokens: number): number {
  const pricePerM = EMBED_PRICING_PER_M_TOKENS[model] ?? EMBED_PRICING_PER_M_TOKENS[DEFAULT_EMBED_MODEL]
  const cost = (inputTokens / 1_000_000) * pricePerM
  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Sprint 015 M2-7 — HTTP status → ProviderError 매핑 (translate/chat/embed 공통).
 * 401/403 = auth_invalid / 429 = rate_limit / 5xx = server_error.
 * 본 함수는 매핑된 status 가 발견되면 throw, 그 외 status (200 / 4xx) 는 호출자 처리.
 */
function throwForHttpStatus(res: Response, context: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`${context} 인증 실패`, 'auth_invalid', false)
  }
  if (res.status === 429) {
    throw new ProviderError(`${context} rate limit`, 'rate_limit', true)
  }
  if (res.status >= 500) {
    throw new ProviderError(`${context} 서버 오류: ${res.status}`, 'server_error', true)
  }
}
