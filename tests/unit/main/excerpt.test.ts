/**
 * Sprint 015 M5-4 — buildExcerpt 단위 테스트.
 *
 * cover:
 *   - 빈 content / 빈 query / 토큰 0
 *   - 단일 token 매칭 — ±100자 슬라이스 + matchPositions
 *   - 다중 token 매칭 — 가장 빠른 위치 중심 + 모든 위치 highlight
 *   - 매칭 0 건 fallback (content 처음 fallbackLength 자)
 *   - case-insensitive
 *   - overlap merge (인접 매칭 병합)
 *   - 슬라이스 경계 (content 처음 / 끝 부분)
 *   - 한국어 토큰 (공백 split)
 *   - windowSize override
 *   - fallbackLength override
 */

import { describe, it, expect } from 'vitest'

import { buildExcerpt } from '../../../src/main/excerpt'

describe('buildExcerpt — 입력 검증', () => {
  it('빈 content → 빈 text + 빈 matchPositions', () => {
    const r = buildExcerpt('', 'query')
    expect(r.text).toBe('')
    expect(r.matchPositions).toEqual([])
  })

  it('빈 query → content 처음 fallbackLength 자 (디폴트 200) + matchPositions 빈 배열', () => {
    const content = 'a'.repeat(500)
    const r = buildExcerpt(content, '')
    expect(r.text).toHaveLength(200)
    expect(r.matchPositions).toEqual([])
  })

  it('공백만 query → fallback', () => {
    const r = buildExcerpt('hello world', '   ')
    expect(r.text).toBe('hello world')
    expect(r.matchPositions).toEqual([])
  })
})

describe('buildExcerpt — 단일 token 매칭', () => {
  it('content 중간 매칭 — ±windowSize 슬라이스', () => {
    const before = 'a'.repeat(120)
    const after = 'b'.repeat(120)
    const content = `${before}TARGET${after}`
    const r = buildExcerpt(content, 'TARGET')
    // start = max(0, 120 - 100) = 20 / end = min(content.length, 120 + 6 + 100) = 226
    expect(r.text).toBe(content.slice(20, 226))
    expect(r.text).toHaveLength(206)
    expect(r.matchPositions).toHaveLength(1)
    expect(r.text.slice(r.matchPositions[0].start, r.matchPositions[0].end)).toBe('TARGET')
  })

  it('content 처음 부분 매칭 — start=0', () => {
    const content = 'TARGET' + 'a'.repeat(300)
    const r = buildExcerpt(content, 'TARGET')
    expect(r.text.startsWith('TARGET')).toBe(true)
    expect(r.matchPositions[0].start).toBe(0)
    expect(r.matchPositions[0].end).toBe(6)
  })

  it('content 끝 부분 매칭 — end=content.length', () => {
    const content = 'a'.repeat(300) + 'TARGET'
    const r = buildExcerpt(content, 'TARGET')
    expect(r.text.endsWith('TARGET')).toBe(true)
  })

  it('매칭 0 건 → content 처음 fallbackLength 자', () => {
    const content = 'a'.repeat(500)
    const r = buildExcerpt(content, 'NOT_FOUND')
    expect(r.text).toHaveLength(200)
    expect(r.matchPositions).toEqual([])
  })
})

describe('buildExcerpt — 다중 token + case-insensitive', () => {
  it('가장 빠른 매칭 위치 중심', () => {
    const content = `${'a'.repeat(50)}FIRST${'b'.repeat(50)}SECOND${'c'.repeat(50)}`
    const r = buildExcerpt(content, 'SECOND FIRST')
    // 더 빠른 'FIRST' (idx 50) 가 중심
    const firstIdx = r.text.indexOf('FIRST')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
  })

  it('text 내 모든 token 위치 highlight', () => {
    const content = 'apple banana apple cherry banana'
    const r = buildExcerpt(content, 'apple banana')
    // 4개 매칭 (apple 2 + banana 2)
    expect(r.matchPositions).toHaveLength(4)
  })

  it('case-insensitive 매칭', () => {
    const content = 'Apple BANANA cherry'
    const r = buildExcerpt(content, 'apple banana')
    expect(r.matchPositions).toHaveLength(2)
    expect(r.text.slice(r.matchPositions[0].start, r.matchPositions[0].end)).toBe('Apple')
    expect(r.text.slice(r.matchPositions[1].start, r.matchPositions[1].end)).toBe('BANANA')
  })

  it('한국어 token (공백 split)', () => {
    const content = '오늘은 화창한 날씨라 산책 가기 좋다'
    const r = buildExcerpt(content, '화창한 날씨')
    expect(r.matchPositions).toHaveLength(2)
  })

  it('한 token 이 다른 token 의 부분문자열일 때 overlap merge', () => {
    const content = 'abcabc'
    const r = buildExcerpt(content, 'abc bc')
    // 'abc' positions: 0, 3 / 'bc' positions: 1, 4 → 정렬 후 [0-3, 1-3, 3-6, 4-6] → 병합 [0-6]
    expect(r.matchPositions).toHaveLength(1)
    expect(r.matchPositions[0]).toEqual({ start: 0, end: 6 })
  })

  it('인접 매칭 (overlap=0) 도 병합', () => {
    const content = 'abcdef'
    const r = buildExcerpt(content, 'abc def')
    // [0-3, 3-6] — last.end (3) === p.start (3) → 병합
    expect(r.matchPositions).toHaveLength(1)
    expect(r.matchPositions[0]).toEqual({ start: 0, end: 6 })
  })

  it('비인접 매칭은 분리 유지', () => {
    const content = 'abc xyz def'
    const r = buildExcerpt(content, 'abc def')
    expect(r.matchPositions).toHaveLength(2)
    expect(r.matchPositions[0]).toEqual({ start: 0, end: 3 })
    expect(r.matchPositions[1]).toEqual({ start: 8, end: 11 })
  })

  it('unicode 길이 비보존 — "İ" (U+0130) 동일 case 원문 인덱스 정확 (codex M5-4 PR #156 BLOCKING 회귀)', () => {
    // 'İ'.toLowerCase() = 'i' + combining dot (2 code units) — lowerText.indexOf 기반 구현은
    // 원문 인덱스 mapping 깨짐. 원문 슬라이스 비교 방식 (findCaseInsensitive) 만 정확.
    // 본 회귀 보호: 동일 case ('İstanbul' query) 의 원문 인덱스 정합 검증.
    //
    // 다른 case 매칭 ("istanbul" query → "İstanbul" content) 은 본 PR 범위 외 — Phase 2+ unicode
    // normalization (Intl.Collator 등) 의존. KI 후보: 다국어 case-fold 정규화.
    const content = 'aaa İstanbul bbb'
    const expectedStart = content.indexOf('İstanbul')
    const r = buildExcerpt(content, 'İstanbul')
    expect(r.matchPositions).toHaveLength(1)
    expect(r.matchPositions[0]).toEqual({ start: expectedStart, end: expectedStart + 8 })
    expect(r.text.slice(r.matchPositions[0].start, r.matchPositions[0].end)).toBe('İstanbul')
  })
})

describe('buildExcerpt — 옵션', () => {
  it('windowSize override — 50 시 매칭 ±50자', () => {
    const before = 'a'.repeat(80)
    const after = 'b'.repeat(80)
    const content = `${before}TARGET${after}`
    const r = buildExcerpt(content, 'TARGET', { windowSize: 50 })
    // start = 80 - 50 = 30 / end = 80 + 6 + 50 = 136
    expect(r.text).toBe(content.slice(30, 136))
  })

  it('fallbackLength override — 매칭 0 시 fallback 길이 변경', () => {
    const content = 'a'.repeat(500)
    const r = buildExcerpt(content, 'NOT_FOUND', { fallbackLength: 50 })
    expect(r.text).toHaveLength(50)
  })

  it('windowSize=0 — 매칭 시 token 길이만 (±0)', () => {
    const content = 'before TARGET after'
    const r = buildExcerpt(content, 'TARGET', { windowSize: 0 })
    expect(r.text).toBe('TARGET')
    expect(r.matchPositions).toEqual([{ start: 0, end: 6 }])
  })

  it('content 길이가 windowSize*2 미만일 때 — 전체 content 반환 (매칭 시)', () => {
    const content = 'short with TARGET inside'
    const r = buildExcerpt(content, 'TARGET')
    expect(r.text).toBe(content)
  })
})
