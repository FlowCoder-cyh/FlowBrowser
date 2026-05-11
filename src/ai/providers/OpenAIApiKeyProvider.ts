/**
 * OpenAI API Key Provider.
 * MVP 기본 Provider (PRD v0.3 §15.2).
 *
 * fetch 직접 호출. 의존성 최소화.
 * 모델: gpt-4o-mini (저렴), gpt-4o (고품질) 선택 가능.
 */

import { ProviderError, type ProviderAdapter } from '../ProviderAdapter'
import type { ProviderInfo, TranslationInput, TranslationOutput } from '../types'

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

export class OpenAIApiKeyProvider implements ProviderAdapter {
  readonly info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'OpenAI API Key',
    supportedRequestTypes: ['selection', 'paragraph', 'page', 'subtitle', 'tts_script'],
    defaultModel: DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS
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

  private resolveModel(hint?: string): string {
    if (hint && AVAILABLE_MODELS.includes(hint)) return hint
    return DEFAULT_MODEL
  }

  private buildMessages(input: TranslationInput): ChatMessage[] {
    const systemPrompt = this.systemPromptFor(input)
    const userPrompt = this.userPromptFor(input)
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }

  private systemPromptFor(input: TranslationInput): string {
    const base = `You are a professional translator. Translate from ${input.sourceLanguage} to ${input.targetLanguage}. Output ONLY the translated text without explanations, quotation marks, or commentary.`
    if (input.requestType === 'subtitle') {
      return `${base} Keep each line short and readable as a subtitle.`
    }
    if (input.requestType === 'tts_script') {
      return `${base} Use short, easy-to-speak sentences suitable for TTS narration in ${input.targetLanguage}.`
    }
    return base
  }

  private userPromptFor(input: TranslationInput): string {
    const ctxLines: string[] = []
    if (input.context?.url) ctxLines.push(`URL: ${input.context.url}`)
    if (input.context?.title) ctxLines.push(`Page title: ${input.context.title}`)
    const ctx = ctxLines.length > 0 ? `Context:\n${ctxLines.join('\n')}\n\n` : ''
    return `${ctx}Translate the following ${input.sourceLanguage} text to ${input.targetLanguage}:\n\n${input.sourceText}`
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING_PER_M_TOKENS[model] ?? MODEL_PRICING_PER_M_TOKENS[DEFAULT_MODEL]
    const inputCost = (inputTokens / 1_000_000) * pricing.input
    const outputCost = (outputTokens / 1_000_000) * pricing.output
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
  }
}
