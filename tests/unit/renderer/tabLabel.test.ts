/**
 * Sprint 013 M3 — formatTabLabel 순수 함수 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import { formatTabLabel } from '../../../src/renderer/src/translation/tabLabel'

describe('formatTabLabel (Sprint 013 M3)', () => {
  it('title 있으면 title 우선', () => {
    expect(formatTabLabel({ url: 'https://example.com', title: 'Example' })).toBe('Example')
  })

  it('빈 url → "새 탭"', () => {
    expect(formatTabLabel({ url: '', title: '' })).toBe('새 탭')
  })

  it('about:blank → "새 탭"', () => {
    expect(formatTabLabel({ url: 'about:blank', title: '' })).toBe('새 탭')
  })

  it('정상 URL → hostname 반환', () => {
    expect(formatTabLabel({ url: 'https://example.com/path', title: '' })).toBe('example.com')
  })

  it('잘못된 URL → 원본 반환', () => {
    expect(formatTabLabel({ url: 'not-a-url', title: '' })).toBe('not-a-url')
  })
})
