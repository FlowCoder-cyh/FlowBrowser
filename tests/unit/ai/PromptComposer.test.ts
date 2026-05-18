/**
 * Sprint 015 M5-5 — PromptComposer 단위 테스트.
 *
 * cover:
 *   - 빈 옵션 → 베이스 시스템 프롬프트만
 *   - levelPreference 4종 (novice / intermediate / advanced / null)
 *   - retrievedPages 결합 — title / url / content 박힘 + 출처 인덱스 ([page-N])
 *   - retrievedNotes 결합
 *   - retrieved 본문 maxRetrievalChars truncate (cost guard)
 *   - customSystemPrompt 추가 지시
 *   - 페이지 + 노트 동시 결합
 */

import { describe, it, expect } from 'vitest'

import { composeSystemPrompt } from '../../../src/ai/PromptComposer'

describe('composeSystemPrompt — 빈 옵션', () => {
  it('옵션 미주입 → 베이스 시스템 프롬프트만', () => {
    const r = composeSystemPrompt()
    expect(r).toContain('한국어 AI 어시스턴트')
    expect(r).not.toContain('## 워크스페이스 메모리')
  })

  it('빈 객체 옵션 → 베이스만', () => {
    const r = composeSystemPrompt({})
    expect(r).toContain('한국어 AI 어시스턴트')
    expect(r).not.toContain('## 워크스페이스 메모리')
  })
})

describe('composeSystemPrompt — levelPreference', () => {
  it('novice → 초보자 지시', () => {
    const r = composeSystemPrompt({ levelPreference: 'novice' })
    expect(r).toContain('초보자')
    expect(r).toContain('비유')
  })

  it('intermediate → 중급자 지시', () => {
    const r = composeSystemPrompt({ levelPreference: 'intermediate' })
    expect(r).toContain('중급자')
  })

  it('advanced → 전문가 지시', () => {
    const r = composeSystemPrompt({ levelPreference: 'advanced' })
    expect(r).toContain('전문가')
    expect(r).toContain('trade-off')
  })

  it('null → 수준 분기 없음', () => {
    const r = composeSystemPrompt({ levelPreference: null })
    expect(r).not.toContain('초보자')
    expect(r).not.toContain('중급자')
    expect(r).not.toContain('전문가')
  })
})

describe('composeSystemPrompt — retrieved 결합', () => {
  it('retrievedPages 1개 → title + url + content + 출처 표기', () => {
    const r = composeSystemPrompt({
      retrievedPages: [
        { title: 'CAR-T 치료법', url: 'https://example.com/car-t', content: 'CAR-T 는...' }
      ]
    })
    expect(r).toContain('## 워크스페이스 메모리')
    expect(r).toContain('[page-1]')
    expect(r).toContain('CAR-T 치료법')
    expect(r).toContain('https://example.com/car-t')
    expect(r).toContain('CAR-T 는...')
    expect(r).toContain('출처를 명시')
  })

  it('retrievedNotes 1개 → selected_text + body 결합', () => {
    const r = composeSystemPrompt({
      retrievedNotes: [{ selectedText: '핵심 인용', body: '내 메모' }]
    })
    expect(r).toContain('[note-1]')
    expect(r).toContain('핵심 인용')
    expect(r).toContain('내 메모')
  })

  it('retrievedNotes body 없음 → selected_text 만', () => {
    const r = composeSystemPrompt({
      retrievedNotes: [{ selectedText: '인용만', body: null }]
    })
    expect(r).toContain('인용만')
  })

  it('page + note 동시 결합 — 양쪽 출처 인덱스', () => {
    const r = composeSystemPrompt({
      retrievedPages: [{ title: 'P', url: 'https://p', content: 'page content' }],
      retrievedNotes: [{ selectedText: 'note', body: null }]
    })
    expect(r).toContain('[page-1]')
    expect(r).toContain('[note-1]')
  })

  it('maxRetrievalChars 작은 값 → content truncate', () => {
    const longContent = 'a'.repeat(2000)
    const r = composeSystemPrompt({
      retrievedPages: [{ title: 'X', url: 'https://x', content: longContent }],
      maxRetrievalChars: 100
    })
    // 100 자 이내 content 만 박힘
    expect(r.length).toBeLessThan(1000)
  })

  it('빈 retrievedPages + 빈 retrievedNotes → 메모리 블록 미생성', () => {
    const r = composeSystemPrompt({
      retrievedPages: [],
      retrievedNotes: []
    })
    expect(r).not.toContain('## 워크스페이스 메모리')
    expect(r).not.toContain('[page-')
    expect(r).not.toContain('[note-')
  })
})

describe('composeSystemPrompt — customSystemPrompt', () => {
  it('추가 지시 박힘', () => {
    const r = composeSystemPrompt({
      customSystemPrompt: '답변은 항상 마크다운 표 형식으로.'
    })
    expect(r).toContain('마크다운 표 형식')
  })

  it('빈 customSystemPrompt 무시', () => {
    const r = composeSystemPrompt({ customSystemPrompt: '   ' })
    expect(r).not.toContain('   ')
  })

  it('levelPreference + customSystemPrompt + retrievedPages 모두 결합', () => {
    const r = composeSystemPrompt({
      levelPreference: 'novice',
      customSystemPrompt: '한자는 한자(한글) 병기.',
      retrievedPages: [{ title: 'A', url: 'https://a', content: 'A 본문' }]
    })
    expect(r).toContain('초보자')
    expect(r).toContain('한자')
    expect(r).toContain('[page-1]')
  })
})
