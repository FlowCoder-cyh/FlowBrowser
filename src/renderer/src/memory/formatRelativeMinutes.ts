/**
 * Sprint 015 M6 T29 — 상대 시간 포맷 ("N분 전" / "N시간 전" / "N일 전").
 *
 * MemoryStatsPanel lastIndexedAt 표시에 사용. pure 함수 (단위 테스트 친화).
 *
 * 정책:
 *   - target < now-1y → "1년 이상"
 *   - target < now-30d → "N개월 전"
 *   - target < now-1d → "N일 전"
 *   - target < now-1h → "N시간 전"
 *   - target < now-1m → "N분 전"
 *   - else → "방금"
 *   - target > now → "미래" (미래 timestamp 방어, 클럭 skew 케이스)
 */
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function formatRelativeMinutes(target: number, now: number): string {
  if (target > now) return '미래'
  const diff = now - target
  if (diff < MIN) return '방금'
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN)
    return `${m}분 전`
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return `${h}시간 전`
  }
  if (diff < MONTH) {
    const d = Math.floor(diff / DAY)
    return `${d}일 전`
  }
  if (diff < YEAR) {
    const mo = Math.floor(diff / MONTH)
    return `${mo}개월 전`
  }
  return '1년 이상'
}
