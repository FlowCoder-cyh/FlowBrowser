/**
 * Sprint 015 M5-2 — TimeRangeParser.
 * PRD §9.2 자연어 시간 표현 파싱 — 5종 매핑 (PRD §9.2.1 표 정합).
 *
 * | 표현 | 결과 |
 * |---|---|
 * | 상대 recent (어제 / 지난주 / 지난달 / 오늘 / 그저께) | {from: now - duration, to: now} |
 * | 상대 older approx (N개월 전쯤 / N년 전쯤) | {from: target - margin, to: target + margin} |
 * | 상대 fix window (N개월 전 / N년 전) | {from: now - N*step, to: now - (N-1)*step} |
 * | 절대 YYYY-MM-DD | {from: date, to: date + 1d} (로컬 기준) |
 * | 절대 YYYY년 N월 | {from: month_start, to: next_month_start} (로컬 기준) |
 *
 * 모호 표현 ("최근" / "오래된") → null (§9.2.3).
 * 다중 시간 표현 → 첫 매치만 (§9.2.3).
 * 시간대: 절대 표현은 로컬 시간 기준, 상대 표현은 timezone-agnostic ms timestamp.
 *
 * 본 모듈은 pure 함수 — DB / Provider 호출 없음. `now` 주입으로 테스트 deterministic.
 */

export interface ParsedTimeRange {
  /** 시작 timestamp (ms, inclusive). */
  from: number
  /** 종료 timestamp (ms, exclusive — SQL 검색 시 `visited_at < to` 권장). */
  to: number
}

export interface TimeRangeParseResult {
  /** 시간 범위. 매칭 없으면 null. */
  range: ParsedTimeRange | null
  /** 매칭된 원본 표현 (UI 표시 / debug 용). 미매칭 시 null. */
  matched: string | null
  /** 시간 표현 제거 후 의미 검색용 query (trim 됨). */
  remainingQuery: string
}

export interface ParseOptions {
  /** 테스트용 fixed now timestamp (ms). 미지정 시 `Date.now()`. */
  now?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

interface InternalPattern {
  /** 매칭 정규식. */
  regex: RegExp
  /** match → range 변환. null 반환 시 매칭 실패 (다음 패턴 시도). */
  build: (match: RegExpMatchArray, now: number) => ParsedTimeRange | null
}

/**
 * 우선순위: 가장 구체적 표현 먼저 (절대 → 상대 fix → 상대 approx → 상대 recent).
 * 같은 표현 내에서는 정규식이 가장 긴 / 구체적인 것부터.
 */
const PATTERNS: InternalPattern[] = [
  // 1. 절대 YYYY-MM-DD
  {
    regex: /(\d{4})-(\d{1,2})-(\d{1,2})/,
    build: (m) => {
      const y = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      const d = parseInt(m[3], 10)
      if (!isValidYmd(y, mo, d)) return null
      const from = new Date(y, mo - 1, d).getTime()
      const to = new Date(y, mo - 1, d + 1).getTime()
      return { from, to }
    }
  },
  // 2. 절대 YYYY년 N월
  {
    regex: /(\d{4})년\s*(\d{1,2})월/,
    build: (m) => {
      const y = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      if (mo < 1 || mo > 12) return null
      const from = new Date(y, mo - 1, 1).getTime()
      const to = new Date(y, mo, 1).getTime()
      return { from, to }
    }
  },
  // 3. 상대 fix window — N개월/년 전 (쯤 없음)
  //    "3개월 전" → {now-90d, now-60d}
  //    "2년 전" → {now-2*365d, now-1*365d}
  //    negative lookahead `(?!\s*쯤)` — 공백 허용 ("3개월 전 쯤" 도 approx 로 분류).
  {
    regex: /(\d+)\s*개월\s*전(?!\s*쯤)/,
    build: (m, now) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 240) return null
      return { from: now - n * MONTH_MS, to: now - (n - 1) * MONTH_MS }
    }
  },
  {
    regex: /(\d+)\s*년\s*전(?!\s*쯤)/,
    build: (m, now) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 50) return null
      return { from: now - n * YEAR_MS, to: now - (n - 1) * YEAR_MS }
    }
  },
  // 4. 상대 older approx — N개월/년 전쯤
  //    "6개월 전쯤" → {now-180d-30d, now-180d+30d}
  {
    regex: /(\d+)\s*개월\s*전\s*쯤/,
    build: (m, now) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 240) return null
      const target = now - n * MONTH_MS
      return { from: target - MONTH_MS, to: target + MONTH_MS }
    }
  },
  {
    regex: /(\d+)\s*년\s*전\s*쯤/,
    build: (m, now) => {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 50) return null
      const target = now - n * YEAR_MS
      // 1년 margin
      return { from: target - YEAR_MS, to: target + YEAR_MS }
    }
  },
  // 5. 상대 recent (PRD §9.2.1 표 — {now - duration, now} 슬라이딩 윈도우)
  {
    regex: /오늘/,
    build: (_m, now) => ({ from: now - DAY_MS, to: now })
  },
  {
    regex: /어제/,
    build: (_m, now) => ({ from: now - DAY_MS, to: now })
  },
  {
    regex: /그저께|그제/,
    build: (_m, now) => ({ from: now - 2 * DAY_MS, to: now })
  },
  {
    regex: /지난\s*주|지난주|이번\s*주/,
    build: (_m, now) => ({ from: now - 7 * DAY_MS, to: now })
  },
  {
    regex: /지난\s*달|지난달|이번\s*달/,
    build: (_m, now) => ({ from: now - 30 * DAY_MS, to: now })
  },
  {
    regex: /지난\s*해|작년/,
    build: (_m, now) => ({ from: now - YEAR_MS, to: now })
  }
]

function isValidYmd(y: number, mo: number, d: number): boolean {
  if (y < 1900 || y > 9999) return false
  if (mo < 1 || mo > 12) return false
  if (d < 1 || d > 31) return false
  const date = new Date(y, mo - 1, d)
  return (
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
  )
}

/**
 * 자연어 query 에서 시간 표현을 추출하고 시간 범위로 변환한다.
 *
 * - 매칭 없으면 `{ range: null, matched: null, remainingQuery: query.trim() }`
 * - 다중 시간 표현은 첫 매치만 사용 (PRD §9.2.3) — 가장 빠른 인덱스 매치를 우선.
 * - 매칭된 표현은 remainingQuery 에서 제거되어 의미 임베딩 retrieval 에 사용.
 *
 * @param query 사용자 입력 자연어
 * @param opts.now 테스트용 고정 시점 (기본 `Date.now()`)
 */
export function parseTimeRange(query: string, opts: ParseOptions = {}): TimeRangeParseResult {
  const now = opts.now ?? Date.now()
  const trimmed = (query ?? '').trim()
  if (trimmed.length === 0) {
    return { range: null, matched: null, remainingQuery: '' }
  }

  // 모든 패턴을 시도하고 가장 빠른 (index 가 작은) 매치를 채택.
  // 동일 index 면 우선순위 (PATTERNS 배열 순서) 가 빠른 것 채택.
  let best: { index: number; length: number; matched: string; range: ParsedTimeRange } | null =
    null
  for (const pattern of PATTERNS) {
    const m = trimmed.match(pattern.regex)
    if (!m || m.index === undefined) continue
    const range = pattern.build(m, now)
    if (!range) continue
    if (best === null || m.index < best.index) {
      best = { index: m.index, length: m[0].length, matched: m[0], range }
    }
  }

  if (best === null) {
    return { range: null, matched: null, remainingQuery: trimmed }
  }

  const remainingQuery = (
    trimmed.slice(0, best.index) + trimmed.slice(best.index + best.length)
  )
    .replace(/\s+/g, ' ')
    .trim()

  return {
    range: best.range,
    matched: best.matched,
    remainingQuery
  }
}
