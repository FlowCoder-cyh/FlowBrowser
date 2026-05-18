/**
 * Sprint 015 M5-4 — 검색 결과 시간 시그널 표시 규칙.
 *
 * PRD §9.5.3 정합:
 *   days_ago 표시:
 *     < 1일: "{시간}시간 전" 또는 "방금"
 *     1~7일: "{N}일 전"
 *     7~30일: "{N}주 전"
 *     30~365일: "{N}개월 전"
 *     ≥ 365일: "{N}년 전"
 *
 *   dwell_ms 범위:
 *     < 60_000 (1분 미만): "짧게 본 거"
 *     60_000 ~ 3_600_000 (1~60분): "{분}분 머묾"
 *     ≥ 3_600_000 (1시간 이상): "{시간}시간 머묾"
 *
 *   결합: "{daysAgo}, {dwell}" — 예 "5일 전, 12분 머묾".
 *
 * pure 함수 — Date.now() 호출 없음, `now` 인자로 deterministic 테스트.
 */

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_WEEK = 7 * MS_PER_DAY
const MS_PER_MONTH = 30 * MS_PER_DAY
const MS_PER_YEAR = 365 * MS_PER_DAY

const DWELL_MINUTE_THRESHOLD = 60_000
const DWELL_HOUR_THRESHOLD = 3_600_000

/**
 * 방문 시점 → 상대 시간 표현.
 * `visitedAt` 이 미래거나 1시간 미만이면 "방금".
 */
export function formatDaysAgo(visitedAt: number, now: number): string {
  const diff = now - visitedAt
  if (diff < MS_PER_HOUR) return '방금'
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}시간 전`
  if (diff < MS_PER_WEEK) return `${Math.floor(diff / MS_PER_DAY)}일 전`
  if (diff < MS_PER_MONTH) return `${Math.floor(diff / MS_PER_WEEK)}주 전`
  if (diff < MS_PER_YEAR) return `${Math.floor(diff / MS_PER_MONTH)}개월 전`
  return `${Math.floor(diff / MS_PER_YEAR)}년 전`
}

/**
 * 머문 시간 표현. 1분 미만은 "짧게 본 거".
 */
export function formatDwell(dwellMs: number): string {
  if (dwellMs < DWELL_MINUTE_THRESHOLD) return '짧게 본 거'
  if (dwellMs < DWELL_HOUR_THRESHOLD) {
    return `${Math.floor(dwellMs / DWELL_MINUTE_THRESHOLD)}분 머묾`
  }
  return `${Math.floor(dwellMs / DWELL_HOUR_THRESHOLD)}시간 머묾`
}

/**
 * 시간 시그널 결합 — "{daysAgo}, {dwell}".
 * `visitedAt = 0` 또는 null fallback 시 "방문 시점 모름" (글로사리 마이그레이션 노트).
 */
export function formatTimeSignal(visitedAt: number | null, dwellMs: number, now: number): string {
  if (visitedAt === null || visitedAt === 0) return '방문 시점 모름'
  return `${formatDaysAgo(visitedAt, now)}, ${formatDwell(dwellMs)}`
}
