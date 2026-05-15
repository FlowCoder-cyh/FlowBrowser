/**
 * Sprint 004 M2 / S004-T03 — system / user prompt 분기 검증.
 * requestType 7종 매트릭스를 단위 테스트로 회귀 보장.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  buildUserPrompt
} from '../../../src/ai/providers/OpenAIApiKeyProvider'
import type { TranslationInput } from '../../../src/ai/types'

function makeInput(over: Partial<TranslationInput>): TranslationInput {
  return {
    sourceText: 'hello world',
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    requestType: 'selection',
    ...over
  }
}

describe('buildSystemPrompt — requestType 분기', () => {
  it('selection / paragraph / page는 기본 번역 프롬프트', () => {
    for (const rt of ['selection', 'paragraph', 'page'] as const) {
      const p = buildSystemPrompt(makeInput({ requestType: rt }))
      expect(p).toMatch(/professional translator/i)
      expect(p).toMatch(/from en to ko/i)
      // 다른 모드 특화 문장 미포함
      expect(p).not.toMatch(/subtitle/i)
      expect(p).not.toMatch(/TTS/i)
      expect(p).not.toMatch(/tutor/i)
      expect(p).not.toMatch(/summarizer/i)
    }
  })

  it('subtitle 모드: 짧고 readable 문장 지시 포함', () => {
    const p = buildSystemPrompt(makeInput({ requestType: 'subtitle' }))
    expect(p).toMatch(/short/i)
    expect(p).toMatch(/subtitle/i)
  })

  it('tts_script 모드: TTS narration 지시 포함', () => {
    const p = buildSystemPrompt(makeInput({ requestType: 'tts_script' }))
    expect(p).toMatch(/easy-to-speak/i)
    expect(p).toMatch(/TTS narration/i)
  })

  it('explanation 모드: tutor + unpack jargon 지시', () => {
    const p = buildSystemPrompt(makeInput({ requestType: 'explanation' }))
    expect(p).toMatch(/tutor/i)
    expect(p).toMatch(/unpack jargon/i)
    expect(p).toMatch(/Do not translate verbatim/i)
  })

  it('summary 모드: summarizer + 3 to 5 short sentences 지시', () => {
    const p = buildSystemPrompt(makeInput({ requestType: 'summary' }))
    expect(p).toMatch(/summarizer/i)
    expect(p).toMatch(/3 to 5/i)
  })

  it('타겟 언어가 system prompt에 항상 포함됨', () => {
    for (const rt of [
      'selection',
      'paragraph',
      'page',
      'subtitle',
      'tts_script',
      'explanation',
      'summary'
    ] as const) {
      const p = buildSystemPrompt(makeInput({ requestType: rt, targetLanguage: 'ja' }))
      expect(p).toMatch(/ja/)
    }
  })
})

describe('buildUserPrompt — requestType 분기', () => {
  it('번역 계열은 Translate the following 사용', () => {
    for (const rt of ['selection', 'paragraph', 'page', 'subtitle', 'tts_script'] as const) {
      const p = buildUserPrompt(makeInput({ requestType: rt }))
      expect(p).toMatch(/^.*Translate the following en text to ko:/s)
      expect(p).toContain('hello world')
    }
  })

  it('explanation는 Explain the following 사용', () => {
    const p = buildUserPrompt(makeInput({ requestType: 'explanation' }))
    expect(p).toMatch(/Explain the following en text in ko:/)
    expect(p).toContain('hello world')
    expect(p).not.toMatch(/Translate the following/)
  })

  it('summary는 Summarize the following 사용', () => {
    const p = buildUserPrompt(makeInput({ requestType: 'summary' }))
    expect(p).toMatch(/Summarize the following en text in ko:/)
    expect(p).toContain('hello world')
  })

  it('context.url 제공 시 Context 블록 포함', () => {
    const p = buildUserPrompt(
      makeInput({ requestType: 'selection', context: { url: 'https://example.com' } })
    )
    expect(p).toMatch(/^Context:\nURL: https:\/\/example\.com\n\nTranslate/s)
  })

  it('context 없으면 Context 블록 없음', () => {
    const p = buildUserPrompt(makeInput({ requestType: 'selection' }))
    expect(p).not.toMatch(/^Context:/)
  })
})
