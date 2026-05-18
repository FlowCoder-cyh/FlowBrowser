/**
 * Sprint 015 M5-2 — TimeRangeParser 단위 테스트.
 * PRD §9.2.4 회귀 — 5종 표현 각 1~2 케이스 + 다중 표현 + 모호 표현 + 절대 날짜 경계.
 */
import { describe, it, expect } from 'vitest'
import { parseTimeRange } from '../../../src/main/TimeRangeParser'

// fixed now: 2026-05-19 12:00:00 (로컬 시간)
const NOW = new Date(2026, 4, 19, 12, 0, 0).getTime()
const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

describe('parseTimeRange — 상대 recent (PRD §9.2.1 표 행 1)', () => {
  it('"어제" → {now-1d, now}', () => {
    const r = parseTimeRange('어제 본 페이지', { now: NOW })
    expect(r.range).not.toBeNull()
    expect(r.range?.from).toBe(NOW - DAY_MS)
    expect(r.range?.to).toBe(NOW)
    expect(r.matched).toBe('어제')
    expect(r.remainingQuery).toBe('본 페이지')
  })

  it('"오늘" → {now-1d, now}', () => {
    const r = parseTimeRange('오늘 본 거', { now: NOW })
    expect(r.range?.from).toBe(NOW - DAY_MS)
    expect(r.range?.to).toBe(NOW)
  })

  it('"그저께" → {now-2d, now}', () => {
    const r = parseTimeRange('그저께 IL-2', { now: NOW })
    expect(r.range?.from).toBe(NOW - 2 * DAY_MS)
    expect(r.range?.to).toBe(NOW)
    expect(r.remainingQuery).toBe('IL-2')
  })

  it('"지난주" → {now-7d, now}', () => {
    const r = parseTimeRange('지난주 컨퍼런스', { now: NOW })
    expect(r.range?.from).toBe(NOW - 7 * DAY_MS)
    expect(r.range?.to).toBe(NOW)
  })

  it('"지난 주" 공백 허용', () => {
    const r = parseTimeRange('지난 주 페이지', { now: NOW })
    expect(r.range?.from).toBe(NOW - 7 * DAY_MS)
  })

  it('"지난달" → {now-30d, now}', () => {
    const r = parseTimeRange('지난달 본 글', { now: NOW })
    expect(r.range?.from).toBe(NOW - 30 * DAY_MS)
  })

  it('"작년" → {now-365d, now}', () => {
    const r = parseTimeRange('작년 본 자료', { now: NOW })
    expect(r.range?.from).toBe(NOW - YEAR_MS)
  })
})

describe('parseTimeRange — 상대 fix window (PRD §9.2.1 표 행 3)', () => {
  it('"3개월 전" → {now-90d, now-60d}', () => {
    const r = parseTimeRange('3개월 전 글', { now: NOW })
    expect(r.range?.from).toBe(NOW - 3 * MONTH_MS)
    expect(r.range?.to).toBe(NOW - 2 * MONTH_MS)
    expect(r.matched).toBe('3개월 전')
  })

  it('"2년 전" → {now-2*365d, now-365d}', () => {
    const r = parseTimeRange('2년 전 메모', { now: NOW })
    expect(r.range?.from).toBe(NOW - 2 * YEAR_MS)
    expect(r.range?.to).toBe(NOW - YEAR_MS)
  })

  it('큰 N 도 동작 (12개월 전)', () => {
    const r = parseTimeRange('12개월 전', { now: NOW })
    expect(r.range?.from).toBe(NOW - 12 * MONTH_MS)
    expect(r.range?.to).toBe(NOW - 11 * MONTH_MS)
  })

  it('비현실적 큰 N (300개월) → null', () => {
    const r = parseTimeRange('300개월 전', { now: NOW })
    expect(r.range).toBeNull()
  })
})

describe('parseTimeRange — 상대 older approx (PRD §9.2.1 표 행 2)', () => {
  it('"6개월 전쯤" → {now-180d-30d, now-180d+30d}', () => {
    const r = parseTimeRange('6개월 전쯤 마이크로서비스', { now: NOW })
    const target = NOW - 6 * MONTH_MS
    expect(r.range?.from).toBe(target - MONTH_MS)
    expect(r.range?.to).toBe(target + MONTH_MS)
    expect(r.matched).toBe('6개월 전쯤')
    expect(r.remainingQuery).toBe('마이크로서비스')
  })

  it('"1년 전쯤" → margin 1년', () => {
    const r = parseTimeRange('1년 전쯤 글', { now: NOW })
    const target = NOW - YEAR_MS
    expect(r.range?.from).toBe(target - YEAR_MS)
    expect(r.range?.to).toBe(target + YEAR_MS)
  })

  it('"전쯤" 이 "전" 보다 우선 매칭', () => {
    const r = parseTimeRange('3개월 전쯤', { now: NOW })
    expect(r.matched).toBe('3개월 전쯤')
    // approx range (-30d margin) 확인 — fix window 라면 to == NOW - 2*MONTH_MS
    const target = NOW - 3 * MONTH_MS
    expect(r.range?.from).toBe(target - MONTH_MS)
    expect(r.range?.to).toBe(target + MONTH_MS)
  })
})

describe('parseTimeRange — 절대 YYYY-MM-DD (PRD §9.2.1 표 행 4)', () => {
  it('"2026-05-01" → 그날 00:00 ~ 24:00 (로컬)', () => {
    const r = parseTimeRange('2026-05-01 의 페이지', { now: NOW })
    expect(r.range?.from).toBe(new Date(2026, 4, 1).getTime())
    expect(r.range?.to).toBe(new Date(2026, 4, 2).getTime())
    expect(r.remainingQuery).toBe('의 페이지')
  })

  it('단일 자리수 월/일 허용 "2026-5-1"', () => {
    const r = parseTimeRange('2026-5-1', { now: NOW })
    expect(r.range?.from).toBe(new Date(2026, 4, 1).getTime())
  })

  it('잘못된 날짜 "2026-02-30" → null (시간 파싱 미일치)', () => {
    const r = parseTimeRange('2026-02-30', { now: NOW })
    expect(r.range).toBeNull()
    expect(r.matched).toBeNull()
  })

  it('연도 범위 외 "1899-05-01" → null', () => {
    const r = parseTimeRange('1899-05-01', { now: NOW })
    expect(r.range).toBeNull()
  })
})

describe('parseTimeRange — 절대 YYYY년 N월 (PRD §9.2.1 표 행 5)', () => {
  it('"2026년 5월" → 5월 1일 ~ 6월 1일', () => {
    const r = parseTimeRange('2026년 5월 본 자료', { now: NOW })
    expect(r.range?.from).toBe(new Date(2026, 4, 1).getTime())
    expect(r.range?.to).toBe(new Date(2026, 5, 1).getTime())
    expect(r.matched).toBe('2026년 5월')
    expect(r.remainingQuery).toBe('본 자료')
  })

  it('공백 없는 "2026년5월" 도 매칭', () => {
    const r = parseTimeRange('2026년5월', { now: NOW })
    expect(r.range?.from).toBe(new Date(2026, 4, 1).getTime())
  })

  it('12월 → 다음 해 1월로 to 넘김', () => {
    const r = parseTimeRange('2025년 12월', { now: NOW })
    expect(r.range?.from).toBe(new Date(2025, 11, 1).getTime())
    expect(r.range?.to).toBe(new Date(2026, 0, 1).getTime())
  })

  it('13월 → null (정규식 매치 후 build 거부)', () => {
    const r = parseTimeRange('2026년 13월', { now: NOW })
    expect(r.range).toBeNull()
  })
})

describe('parseTimeRange — 모호 표현 / 미일치 (PRD §9.2.2 / §9.2.3)', () => {
  it('"최근" → null (정성 표현 모호)', () => {
    const r = parseTimeRange('최근 본 페이지', { now: NOW })
    expect(r.range).toBeNull()
    expect(r.matched).toBeNull()
    expect(r.remainingQuery).toBe('최근 본 페이지')
  })

  it('"오래된" → null', () => {
    const r = parseTimeRange('오래된 글', { now: NOW })
    expect(r.range).toBeNull()
  })

  it('시간 표현 0개 → range null + remainingQuery 그대로', () => {
    const r = parseTimeRange('IL-2 받은 비교', { now: NOW })
    expect(r.range).toBeNull()
    expect(r.remainingQuery).toBe('IL-2 받은 비교')
  })

  it('빈 query → range null + remainingQuery empty', () => {
    const r = parseTimeRange('', { now: NOW })
    expect(r.range).toBeNull()
    expect(r.remainingQuery).toBe('')
  })

  it('whitespace-only → range null + remainingQuery empty', () => {
    const r = parseTimeRange('   \t\n  ', { now: NOW })
    expect(r.range).toBeNull()
    expect(r.remainingQuery).toBe('')
  })
})

describe('parseTimeRange — 다중 표현 (PRD §9.2.3 첫 매치만)', () => {
  it('"지난주랑 어제" → 첫 매치 (지난주) 만', () => {
    const r = parseTimeRange('지난주랑 어제 본 글', { now: NOW })
    expect(r.matched).toBe('지난주')
    expect(r.range?.from).toBe(NOW - 7 * DAY_MS)
    expect(r.remainingQuery).toBe('랑 어제 본 글')
  })

  it('"3개월 전 vs 2개월 전" → 첫 매치 (3개월 전) 만', () => {
    const r = parseTimeRange('3개월 전 vs 2개월 전', { now: NOW })
    expect(r.matched).toBe('3개월 전')
    expect(r.range?.from).toBe(NOW - 3 * MONTH_MS)
  })

  it('절대 + 상대 혼합 → 더 빠른 인덱스 매치', () => {
    // "어제" 가 index 0, "2026-05-01" 가 index 3
    const r = parseTimeRange('어제 또는 2026-05-01', { now: NOW })
    expect(r.matched).toBe('어제')
  })
})

describe('parseTimeRange — remainingQuery 정규화', () => {
  it('매칭 후 공백 정규화', () => {
    const r = parseTimeRange('어제   IL-2   문서', { now: NOW })
    expect(r.remainingQuery).toBe('IL-2 문서')
  })

  it('시간 표현이 query 끝에 있어도 정상 동작', () => {
    const r = parseTimeRange('IL-2 문서 어제', { now: NOW })
    expect(r.matched).toBe('어제')
    expect(r.remainingQuery).toBe('IL-2 문서')
  })

  it('시간 표현이 query 중간에 있어도 정상 동작', () => {
    const r = parseTimeRange('IL-2 어제 문서', { now: NOW })
    expect(r.matched).toBe('어제')
    expect(r.remainingQuery).toBe('IL-2 문서')
  })
})

describe('parseTimeRange — opts.now 미지정', () => {
  it('Date.now() 기본 사용', () => {
    const before = Date.now()
    const r = parseTimeRange('어제')
    const after = Date.now()
    expect(r.range).not.toBeNull()
    // to 는 호출 시점의 Date.now() 와 같아야 함
    expect(r.range!.to).toBeGreaterThanOrEqual(before)
    expect(r.range!.to).toBeLessThanOrEqual(after)
    expect(r.range!.from).toBe(r.range!.to - DAY_MS)
  })
})
