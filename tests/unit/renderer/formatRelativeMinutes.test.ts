/**
 * Sprint 015 M6 T29 — formatRelativeMinutes 단위 테스트.
 *
 * cover:
 *   - 방금 (< 1분)
 *   - N분 전 / N시간 전 / N일 전 / N개월 전 / 1년 이상
 *   - 미래 timestamp (clock skew)
 */

import { describe, it, expect } from 'vitest'
import { formatRelativeMinutes } from '../../../src/renderer/src/memory/formatRelativeMinutes'

const NOW = 1_700_000_000_000 // 2023-11-14 22:13:20 UTC — deterministic
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

describe('formatRelativeMinutes', () => {
  it('returns 방금 when diff < 1m', () => {
    expect(formatRelativeMinutes(NOW - 30_000, NOW)).toBe('방금')
    expect(formatRelativeMinutes(NOW, NOW)).toBe('방금')
  })

  it('returns N분 전 when diff between 1m and 1h', () => {
    expect(formatRelativeMinutes(NOW - MIN, NOW)).toBe('1분 전')
    expect(formatRelativeMinutes(NOW - 30 * MIN, NOW)).toBe('30분 전')
    expect(formatRelativeMinutes(NOW - 59 * MIN, NOW)).toBe('59분 전')
  })

  it('returns N시간 전 when diff between 1h and 1d', () => {
    expect(formatRelativeMinutes(NOW - HOUR, NOW)).toBe('1시간 전')
    expect(formatRelativeMinutes(NOW - 23 * HOUR, NOW)).toBe('23시간 전')
  })

  it('returns N일 전 when diff between 1d and 30d', () => {
    expect(formatRelativeMinutes(NOW - DAY, NOW)).toBe('1일 전')
    expect(formatRelativeMinutes(NOW - 29 * DAY, NOW)).toBe('29일 전')
  })

  it('returns N개월 전 when diff between 30d and 1y', () => {
    expect(formatRelativeMinutes(NOW - MONTH, NOW)).toBe('1개월 전')
    expect(formatRelativeMinutes(NOW - 6 * MONTH, NOW)).toBe('6개월 전')
  })

  it('returns 1년 이상 when diff > 1y', () => {
    expect(formatRelativeMinutes(NOW - YEAR, NOW)).toBe('1년 이상')
    expect(formatRelativeMinutes(NOW - 3 * YEAR, NOW)).toBe('1년 이상')
  })

  it('returns 미래 when target > now (clock skew)', () => {
    expect(formatRelativeMinutes(NOW + 1000, NOW)).toBe('미래')
  })
})
