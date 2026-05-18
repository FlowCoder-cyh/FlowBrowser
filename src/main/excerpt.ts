/**
 * Sprint 015 M5-4 — buildExcerpt (검색 결과 매칭 발췌).
 *
 * PRD §9.5.2 매칭 발췌 알고리즘 (Phase 1 단순화):
 *   1. content 에서 query 토큰 (공백 split) 중 가장 빠른 매칭 위치 찾기 (case-insensitive)
 *   2. 그 위치 중심으로 ±windowSize (디폴트 100) 자 추출
 *   3. text 내 모든 매칭 토큰 위치 (start, end) array 반환 → renderer 가 <mark> wrap
 *   4. 매칭 0 건이면 content 처음 (windowSize * 2) 자 truncate
 *
 * PRD §9.5.2 의 "sentence splitter + 임베딩 vs query 임베딩 cosine" 은 비용 (페이지당 임베딩) 위협
 * 으로 본 PR 에서는 단순 keyword token 매칭. 임베딩 기반 발췌는 Phase 2+ 또는 별도 최적화 PR.
 *
 * pure 함수 — DB / Provider 호출 없음. searchHandlers 가 호출 후 payload 에 박음.
 */

export interface ExcerptMatch {
  /** text 내 매칭 시작 인덱스 (0-based, inclusive). */
  start: number
  /** text 내 매칭 종료 인덱스 (0-based, exclusive). */
  end: number
}

export interface ExcerptResult {
  /** 발췌 텍스트 (±windowSize 슬라이스). */
  text: string
  /** text 내 모든 매칭 토큰 위치 (정렬 + 중복 병합). renderer 가 <mark> 로 highlight. */
  matchPositions: ExcerptMatch[]
}

export interface BuildExcerptOptions {
  /** 매칭 중심 ± 슬라이스 자 수. 디폴트 100 (PRD §9.5.2 "±100자"). */
  windowSize?: number
  /** 매칭 0 건 fallback 시 content 처음 자 수. 디폴트 windowSize * 2. */
  fallbackLength?: number
}

const DEFAULT_WINDOW_SIZE = 100

export function buildExcerpt(
  content: string,
  query: string,
  options: BuildExcerptOptions = {}
): ExcerptResult {
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE
  const fallbackLength = options.fallbackLength ?? windowSize * 2

  if (!content) {
    return { text: '', matchPositions: [] }
  }

  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return { text: content.slice(0, fallbackLength), matchPositions: [] }
  }

  // 가장 빠른 매칭 token + 위치 찾기 (case-insensitive)
  const lowerContent = content.toLowerCase()
  let firstMatchIdx = -1
  let firstMatchTokenLen = 0
  for (const t of tokens) {
    const lowerT = t.toLowerCase()
    const idx = lowerContent.indexOf(lowerT)
    if (idx === -1) continue
    if (firstMatchIdx === -1 || idx < firstMatchIdx) {
      firstMatchIdx = idx
      firstMatchTokenLen = t.length
    }
  }

  if (firstMatchIdx === -1) {
    return { text: content.slice(0, fallbackLength), matchPositions: [] }
  }

  // ±windowSize 슬라이스
  const sliceStart = Math.max(0, firstMatchIdx - windowSize)
  const sliceEnd = Math.min(
    content.length,
    firstMatchIdx + firstMatchTokenLen + windowSize
  )
  const text = content.slice(sliceStart, sliceEnd)

  // text 내 모든 token 위치 찾기
  const lowerText = text.toLowerCase()
  const positions: ExcerptMatch[] = []
  for (const t of tokens) {
    const lowerT = t.toLowerCase()
    let cursor = 0
    while (cursor < lowerText.length) {
      const idx = lowerText.indexOf(lowerT, cursor)
      if (idx === -1) break
      positions.push({ start: idx, end: idx + t.length })
      cursor = idx + t.length
    }
  }

  // 정렬 + 중복 (overlap) 병합
  positions.sort((a, b) => a.start - b.start)
  const merged: ExcerptMatch[] = []
  for (const p of positions) {
    const last = merged[merged.length - 1]
    if (last && last.end >= p.start) {
      last.end = Math.max(last.end, p.end)
    } else {
      merged.push({ start: p.start, end: p.end })
    }
  }

  return { text, matchPositions: merged }
}

/**
 * query 를 공백 기반으로 토큰화. 빈 토큰 제거.
 * 한국어 형태소 분석은 비용 위협으로 본 PR 단순 공백 split (Phase 2+ 형태소 옵션).
 */
function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}
