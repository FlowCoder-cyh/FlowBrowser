// @vitest-environment happy-dom
/**
 * Sprint 006 M1 / S006-T02 — TranslationRenderer 단위 테스트.
 * happy-dom 환경에서 외부 페이지 함수를 직접 호출해 DOM 변형 검증.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  renderTranslationsBrowser,
  restoreOriginalsBrowser,
  renderTranslationsScript,
  restoreOriginalsScript,
  TRANSLATION_RENDERER_CONFIG
} from '../../../src/perception/TranslationRenderer'

describe('renderTranslationsScript', () => {
  it('returns IIFE string with payload', () => {
    const script = renderTranslationsScript({
      mode: 'replace',
      selectorPreset: 'paragraph',
      instructions: [{ id: 'p0', translatedText: '안녕' }]
    })
    expect(typeof script).toBe('string')
    expect(script.startsWith('(')).toBe(true)
    expect(script).toContain('p0')
    expect(script).toContain('안녕')
  })

  it('restoreOriginalsScript returns callable IIFE', () => {
    const s = restoreOriginalsScript()
    expect(typeof s).toBe('string')
    expect(s.endsWith(')()')).toBe(true)
  })
})

describe('renderTranslationsBrowser — replace 모드', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('paragraph preset에서 p0,p1을 매칭해 textContent 교체', () => {
    document.body.innerHTML = `
      <p>첫번째 영문 문단입니다.</p>
      <p>두번째 영문 문단입니다.</p>
    `
    const result = renderTranslationsBrowser({
      mode: 'replace',
      selectorPreset: 'paragraph',
      instructions: [
        { id: 'p0', translatedText: '첫번째 번역' },
        { id: 'p1', translatedText: '두번째 번역' }
      ]
    })
    expect(result.applied).toBe(2)
    expect(result.missing).toBe(0)
    const ps = document.querySelectorAll('p')
    expect(ps[0].textContent).toBe('첫번째 번역')
    expect(ps[1].textContent).toBe('두번째 번역')
    expect(ps[0].getAttribute('data-fbai-orig')).toContain('첫번째 영문 문단')
  })

  it('page preset에서 n0,n1 prefix로 매칭', () => {
    document.body.innerHTML = `
      <p>본문 문단 텍스트입니다.</p>
      <th>표 헤더 텍스트입니다.</th>
    `
    const result = renderTranslationsBrowser({
      mode: 'replace',
      selectorPreset: 'page',
      instructions: [
        { id: 'n0', translatedText: '문단 번역' },
        { id: 'n1', translatedText: '헤더 번역' }
      ]
    })
    expect(result.applied).toBe(2)
    expect(document.querySelector('p')?.textContent).toBe('문단 번역')
    expect(document.querySelector('th')?.textContent).toBe('헤더 번역')
  })

  it('일치하지 않는 id는 missing 카운트', () => {
    document.body.innerHTML = '<p>유일한 문단 텍스트입니다.</p>'
    const result = renderTranslationsBrowser({
      mode: 'replace',
      selectorPreset: 'paragraph',
      instructions: [
        { id: 'p0', translatedText: '번역됨' },
        { id: 'p9', translatedText: '없는 id' }
      ]
    })
    expect(result.applied).toBe(1)
    expect(result.missing).toBe(1)
  })

  it('짧은/긴 노드 필터로 인덱스가 ParagraphExtractor와 일치', () => {
    document.body.innerHTML = `
      <p>짧음</p>
      <p>두번째 충분히 긴 문단입니다.</p>
      <p>세번째 충분히 긴 문단입니다.</p>
    `
    const result = renderTranslationsBrowser({
      mode: 'replace',
      selectorPreset: 'paragraph',
      instructions: [
        { id: 'p0', translatedText: 'A' },
        { id: 'p1', translatedText: 'B' }
      ]
    })
    expect(result.applied).toBe(2)
    const ps = document.querySelectorAll('p')
    expect(ps[0].textContent).toBe('짧음') // 필터로 제외, 변경 안 됨
    expect(ps[1].textContent).toBe('A')
    expect(ps[2].textContent).toBe('B')
  })
})

describe('renderTranslationsBrowser — overlay 모드', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('각 노드 아래 sibling .fbai-overlay 부착', () => {
    document.body.innerHTML = `
      <p>첫번째 영문 문단입니다.</p>
      <p>두번째 영문 문단입니다.</p>
    `
    const result = renderTranslationsBrowser({
      mode: 'overlay',
      selectorPreset: 'paragraph',
      instructions: [
        { id: 'p0', translatedText: '첫번째 번역' },
        { id: 'p1', translatedText: '두번째 번역' }
      ]
    })
    expect(result.applied).toBe(2)
    const overlays = document.querySelectorAll('.fbai-overlay')
    expect(overlays.length).toBe(2)
    expect(overlays[0].textContent).toBe('첫번째 번역')
    expect(overlays[0].getAttribute('data-fbai-for')).toBe('p0')
    // 원문은 그대로 유지
    const ps = document.querySelectorAll('p')
    expect(ps[0].textContent).toBe('첫번째 영문 문단입니다.')
  })

  it('같은 id로 재호출 시 overlay 텍스트 갱신 (중복 부착 없음)', () => {
    document.body.innerHTML = '<p>첫번째 영문 문단입니다.</p>'
    renderTranslationsBrowser({
      mode: 'overlay',
      selectorPreset: 'paragraph',
      instructions: [{ id: 'p0', translatedText: '버전 A' }]
    })
    renderTranslationsBrowser({
      mode: 'overlay',
      selectorPreset: 'paragraph',
      instructions: [{ id: 'p0', translatedText: '버전 B' }]
    })
    const overlays = document.querySelectorAll('.fbai-overlay')
    expect(overlays.length).toBe(1)
    expect(overlays[0].textContent).toBe('버전 B')
  })
})

describe('restoreOriginalsBrowser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('replace 모드 적용 후 복원 — textContent 원문 복귀 + 백업 속성 제거', () => {
    document.body.innerHTML = '<p>원래 영문 문단입니다.</p>'
    renderTranslationsBrowser({
      mode: 'replace',
      selectorPreset: 'paragraph',
      instructions: [{ id: 'p0', translatedText: '한국어 번역' }]
    })
    const result = restoreOriginalsBrowser()
    expect(result.restored).toBe(1)
    const p = document.querySelector('p')!
    expect(p.textContent).toBe('원래 영문 문단입니다.')
    expect(p.hasAttribute('data-fbai-orig')).toBe(false)
  })

  it('overlay 모드 적용 후 복원 — overlay 박스 제거', () => {
    document.body.innerHTML = '<p>원문 텍스트입니다.</p>'
    renderTranslationsBrowser({
      mode: 'overlay',
      selectorPreset: 'paragraph',
      instructions: [{ id: 'p0', translatedText: '번역' }]
    })
    expect(document.querySelectorAll('.fbai-overlay').length).toBe(1)
    const result = restoreOriginalsBrowser()
    expect(result.overlays).toBe(1)
    expect(document.querySelectorAll('.fbai-overlay').length).toBe(0)
    expect(document.querySelector('p')?.textContent).toBe('원문 텍스트입니다.')
  })

  it('아무것도 적용되지 않은 상태에서 복원 호출 시 0 카운트', () => {
    document.body.innerHTML = '<p>원문 텍스트입니다.</p>'
    const result = restoreOriginalsBrowser()
    expect(result.restored).toBe(0)
    expect(result.overlays).toBe(0)
  })
})

describe('TRANSLATION_RENDERER_CONFIG', () => {
  it('exposes filter constants', () => {
    expect(TRANSLATION_RENDERER_CONFIG.MIN_TEXT_LENGTH).toBe(8)
    expect(TRANSLATION_RENDERER_CONFIG.MAX_TEXT_LENGTH).toBe(5000)
    expect(TRANSLATION_RENDERER_CONFIG.PARAGRAPH_SELECTORS).toContain('blockquote')
    expect(TRANSLATION_RENDERER_CONFIG.PAGE_SELECTORS).toContain('figcaption')
  })
})
