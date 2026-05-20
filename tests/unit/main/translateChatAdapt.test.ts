/**
 * Sprint 016 M2 T10a (codex NEEDS_CHANGES #1 hotfix) —
 * executeTranslateRequest 의 chat 호출 path 회귀 안전망.
 *
 * services.ts 의 buildTranslationChatRequest + chatResponseToTranslationOutput 두 helper 를
 * 격리 검증 (executeTranslateRequest 의 외부 의존성 우회).
 *
 * 검증:
 *   - selection 번역 흐름이 provider.chat() messages [system, user] + temperature 0.3 정합
 *   - ChatResponse → TranslationOutput 1:1 어댑트
 *   - explanation / summary / paragraph requestType 모두 동일 chat path 작동
 */

import { describe, it, expect } from 'vitest'
import {
  buildTranslationChatRequest,
  chatResponseToTranslationOutput
} from '../../../src/main/services'
import type { TranslationInput } from '../../../src/ai/types'

const baseInput: TranslationInput = {
  sourceText: 'Hello world',
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  requestType: 'selection'
}

describe('buildTranslationChatRequest (T10a helper)', () => {
  it('selection 번역: messages [system, user] + temperature 0.3', () => {
    const req = buildTranslationChatRequest(baseInput)
    expect(req.messages).toHaveLength(2)
    expect(req.messages[0].role).toBe('system')
    expect(req.messages[1].role).toBe('user')
    expect(req.messages[0].content).toMatch(/professional translator/)
    expect(req.messages[0].content).toMatch(/from en to ko/)
    expect(req.messages[1].content).toMatch(/Hello world/)
    expect(req.messages[1].content).toMatch(/Translate the following en text to ko/)
    expect(req.temperature).toBe(0.3)
  })

  it('explanation requestType: system prompt 가 tutor 패턴', () => {
    const req = buildTranslationChatRequest({ ...baseInput, requestType: 'explanation' })
    expect(req.messages[0].content).toMatch(/tutor/)
    expect(req.messages[1].content).toMatch(/Explain the following/)
  })

  it('summary requestType: system prompt 가 summarizer 패턴', () => {
    const req = buildTranslationChatRequest({ ...baseInput, requestType: 'summary' })
    expect(req.messages[0].content).toMatch(/summarizer/)
    expect(req.messages[1].content).toMatch(/Summarize the following/)
  })

  it('subtitle requestType: system prompt 가 subtitle 패턴', () => {
    const req = buildTranslationChatRequest({ ...baseInput, requestType: 'subtitle' })
    expect(req.messages[0].content).toMatch(/short and readable as a subtitle/)
  })

  it('modelHint 전달 (provider 가 선택적으로 활용)', () => {
    const req = buildTranslationChatRequest({ ...baseInput, modelHint: 'gpt-4o' })
    expect(req.modelHint).toBe('gpt-4o')
  })

  it('context.surroundingText (glossary 컨텍스트) 가 user prompt 에 포함', () => {
    const req = buildTranslationChatRequest({
      ...baseInput,
      context: {
        url: 'https://example.com',
        title: '예제',
        surroundingText: '용어: CAR-T = 카티세포치료'
      }
    })
    expect(req.messages[1].content).toMatch(/URL: https:\/\/example\.com/)
    expect(req.messages[1].content).toMatch(/Page title: 예제/)
    expect(req.messages[1].content).toMatch(/카티세포치료/)
  })
})

describe('chatResponseToTranslationOutput (T10a helper)', () => {
  it('ChatResponse 5 필드 1:1 매핑', () => {
    const resp = {
      text: '안녕 세상',
      modelUsed: 'gpt-4o-mini',
      inputTokens: 12,
      outputTokens: 4,
      estimatedCostUsd: 0.000018,
      durationMs: 215
    }
    const out = chatResponseToTranslationOutput(resp)
    expect(out.translatedText).toBe('안녕 세상')
    expect(out.modelUsed).toBe('gpt-4o-mini')
    expect(out.inputTokens).toBe(12)
    expect(out.outputTokens).toBe(4)
    expect(out.estimatedCostUsd).toBe(0.000018)
    expect(out.durationMs).toBe(215)
  })

  it('빈 text 도 그대로 어댑트 (provider 미응답 케이스는 ProviderError 가 catch — 본 helper 는 변환만)', () => {
    const resp = {
      text: '',
      modelUsed: 'gpt-4o-mini',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 50
    }
    const out = chatResponseToTranslationOutput(resp)
    expect(out.translatedText).toBe('')
  })

  it('Codex Login estimatedCostUsd=0 (한도 기반) 도 정상 매핑', () => {
    const resp = {
      text: '코덱스 번역',
      modelUsed: 'gpt-5.5',
      inputTokens: 80,
      outputTokens: 30,
      estimatedCostUsd: 0, // CodexLoginProvider chat() 도 0 반환 (translate() 와 동일)
      durationMs: 800
    }
    const out = chatResponseToTranslationOutput(resp)
    expect(out.estimatedCostUsd).toBe(0)
    expect(out.modelUsed).toBe('gpt-5.5')
  })
})
