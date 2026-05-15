/**
 * Sprint 010 M3 — isCurrentTab 순수 함수 단위 테스트.
 * Sprint 009 M2 G-006 Partial 후속 권고 해소.
 */
import { describe, it, expect } from 'vitest'
import { isCurrentTab } from '../../../src/renderer/src/translation/tabGuard'

describe('isCurrentTab (Sprint 010 M3)', () => {
  it('두 값 일치 → true', () => {
    expect(isCurrentTab('tab_a', 'tab_a')).toBe(true)
  })

  it('두 값 불일치 → false', () => {
    expect(isCurrentTab('tab_a', 'tab_b')).toBe(false)
  })

  it('sourceTabId null → true (레거시 이벤트 호환)', () => {
    expect(isCurrentTab('tab_a', null)).toBe(true)
  })

  it('sourceTabId undefined → true (가드 미적용 이벤트 호환)', () => {
    expect(isCurrentTab('tab_a', undefined)).toBe(true)
  })

  it('activeTabId null + sourceTabId 있음 → true (초기화 직후 보수적)', () => {
    expect(isCurrentTab(null, 'tab_x')).toBe(true)
  })

  it('두 값 모두 null → true', () => {
    expect(isCurrentTab(null, null)).toBe(true)
  })
})
