/**
 * Sprint 015 M5-4 — timeSignal 단위 테스트.
 *
 * PRD §9.5.3 표시 규칙 정합 검증:
 *   - formatDaysAgo: 시간 / 일 / 주 / 개월 / 년 + "방금" 경계
 *   - formatDwell: 짧게 본 거 / 분 머묾 / 시간 머묾 경계
 *   - formatTimeSignal: 결합 + null/0 fallback
 *
 * pure 함수, Date.now() 미사용 — `now` 인자로 deterministic.
 */

import { describe, it, expect } from 'vitest'

import {
  formatDaysAgo,
  formatDwell,
  formatTimeSignal
} from '../../../src/renderer/src/search/timeSignal'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_WEEK = 7 * MS_PER_DAY
const MS_PER_MONTH = 30 * MS_PER_DAY
const MS_PER_YEAR = 365 * MS_PER_DAY

const NOW = 1_700_000_000_000

describe('formatDaysAgo — 경계', () => {
  it('< 1시간 → "방금"', () => {
    expect(formatDaysAgo(NOW - 30 * 60 * 1000, NOW)).toBe('방금')
  })

  it('정확히 1시간 → "1시간 전"', () => {
    expect(formatDaysAgo(NOW - MS_PER_HOUR, NOW)).toBe('1시간 전')
  })

  it('5시간 → "5시간 전"', () => {
    expect(formatDaysAgo(NOW - 5 * MS_PER_HOUR, NOW)).toBe('5시간 전')
  })

  it('정확히 1일 → "1일 전"', () => {
    expect(formatDaysAgo(NOW - MS_PER_DAY, NOW)).toBe('1일 전')
  })

  it('5일 → "5일 전"', () => {
    expect(formatDaysAgo(NOW - 5 * MS_PER_DAY, NOW)).toBe('5일 전')
  })

  it('7일 정확 → "1주 전"', () => {
    expect(formatDaysAgo(NOW - MS_PER_WEEK, NOW)).toBe('1주 전')
  })

  it('20일 → "2주 전"', () => {
    expect(formatDaysAgo(NOW - 20 * MS_PER_DAY, NOW)).toBe('2주 전')
  })

  it('30일 정확 → "1개월 전"', () => {
    expect(formatDaysAgo(NOW - MS_PER_MONTH, NOW)).toBe('1개월 전')
  })

  it('6개월 (180일) → "6개월 전"', () => {
    expect(formatDaysAgo(NOW - 180 * MS_PER_DAY, NOW)).toBe('6개월 전')
  })

  it('365일 정확 → "1년 전"', () => {
    expect(formatDaysAgo(NOW - MS_PER_YEAR, NOW)).toBe('1년 전')
  })

  it('2년 → "2년 전"', () => {
    expect(formatDaysAgo(NOW - 2 * MS_PER_YEAR, NOW)).toBe('2년 전')
  })

  it('미래 visit (now > visitedAt) → "방금"', () => {
    expect(formatDaysAgo(NOW + 10 * MS_PER_DAY, NOW)).toBe('방금')
  })
})

describe('formatDwell — 경계', () => {
  it('0 ms → "짧게 본 거"', () => {
    expect(formatDwell(0)).toBe('짧게 본 거')
  })

  it('30 초 → "짧게 본 거"', () => {
    expect(formatDwell(30 * 1000)).toBe('짧게 본 거')
  })

  it('정확히 1분 (60_000) → "1분 머묾"', () => {
    expect(formatDwell(60_000)).toBe('1분 머묾')
  })

  it('12분 → "12분 머묾"', () => {
    expect(formatDwell(12 * 60_000)).toBe('12분 머묾')
  })

  it('59분 → "59분 머묾"', () => {
    expect(formatDwell(59 * 60_000)).toBe('59분 머묾')
  })

  it('정확히 1시간 (3_600_000) → "1시간 머묾"', () => {
    expect(formatDwell(3_600_000)).toBe('1시간 머묾')
  })

  it('3시간 → "3시간 머묾"', () => {
    expect(formatDwell(3 * 3_600_000)).toBe('3시간 머묾')
  })
})

describe('formatTimeSignal — 결합', () => {
  it('정상 visit — "{daysAgo}, {dwell}"', () => {
    expect(formatTimeSignal(NOW - 5 * MS_PER_DAY, 12 * 60_000, NOW)).toBe('5일 전, 12분 머묾')
  })

  it('visitedAt null → "방문 시점 모름" (글로사리 마이그레이션 노트)', () => {
    expect(formatTimeSignal(null, 0, NOW)).toBe('방문 시점 모름')
  })

  it('visitedAt 0 → "방문 시점 모름"', () => {
    expect(formatTimeSignal(0, 60_000, NOW)).toBe('방문 시점 모름')
  })

  it('dwell 0 + 최근 → "방금, 짧게 본 거"', () => {
    expect(formatTimeSignal(NOW - 10 * 60 * 1000, 0, NOW)).toBe('방금, 짧게 본 거')
  })
})
