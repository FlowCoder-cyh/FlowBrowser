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

  // 가장 빠른 매칭 token + 위치 찾기 (case-insensitive, unicode-safe).
  // codex M5-4 PR #156 BLOCKING 정정 — `toLowerCase()` 는 길이 비보존 가능 (예: 'İ' U+0130 →
  // 'i' + combining dot 2 code units). lowerText 인덱스를 원문 인덱스로 사용 시 mapping 깨짐.
  // 안전한 방식: 원문 substring 슬라이스 후 `toLowerCase` 비교 — 인덱스는 항상 원문 기준.
  let firstMatchIdx = -1
  let firstMatchTokenLen = 0
  for (const t of tokens) {
    const idx = findCaseInsensitive(content, t, 0)
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

  // text 내 모든 token 위치 찾기 (unicode-safe — 원문 슬라이스 비교)
  const positions: ExcerptMatch[] = []
  for (const t of tokens) {
    let cursor = 0
    while (cursor < text.length) {
      const idx = findCaseInsensitive(text, t, cursor)
      if (idx === -1) break
      positions.push({ start: idx, end: idx + t.length })
      cursor = idx + t.length
    }
  }

  // 정렬 + 중복 (overlap) + 인접 매칭 병합. `last.end >= p.start` 조건은 overlap 외에 인접 매칭
  // (e.g., "abc" + "def" → "abcdef") 도 병합. codex M5-4 PR #156 NB — 함수 동작 범위 명시.
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
 * Case-insensitive substring 검색 (unicode 동일-case mapping 정합).
 *
 * 원문 `haystack` 의 `from` 위치부터 `needle.toLowerCase()` 와 일치하는 위치 반환.
 * 본 함수의 정확성 보장 범위:
 *   ✓ ASCII / 한국어 / 일본어 등 toLowerCase 길이 보존 케이스 — 정확
 *   ✓ 동일 case 매칭 (`İstanbul` query → `İstanbul` content) — 원문 인덱스 정합 (codex M5-4 BLOCKING 정정)
 *   ✗ 다른 case 매칭 (`istanbul` query → `İstanbul` content 의 cross-case fold) — Phase 2+ unicode
 *     정규화 (Intl.Collator / String.prototype.localeCompare) 옵션 — 본 PR 범위 외. KI 후보 등록.
 *
 * 단점: O(n × m) — 큰 content 에서 다중 토큰 검색 시 느림. 본 앱 use case (페이지 본문 수십 KB,
 * 토큰 5개 미만, 검색 응답 < 200ms PRD §9.7) 에서는 충분히 빠름. 성능 임계 미달 시 Aho-Corasick
 * 같은 다중 패턴 매칭 옵션 (Phase 2+).
 */
function findCaseInsensitive(haystack: string, needle: string, from: number): number {
  if (!needle) return -1
  const needleLower = needle.toLowerCase()
  const needleLen = needle.length
  const maxStart = haystack.length - needleLen
  for (let i = from; i <= maxStart; i++) {
    if (haystack.slice(i, i + needleLen).toLowerCase() === needleLower) {
      return i
    }
  }
  return -1
}

/**
 * query 를 공백 기반으로 토큰화. 빈 토큰 제거.
 * 한국어 형태소 분석은 비용 위협으로 본 PR 단순 공백 split (Phase 2+ 형태소 옵션 — KI 후보).
 */
function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}
