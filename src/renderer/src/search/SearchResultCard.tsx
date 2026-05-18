/**
 * Sprint 015 M5-4 — SearchResultCard.
 *
 * PRD §9.5.1 필드 7종:
 *   - 제목 (Page.title 또는 Note.selected_text 첫 50자) — bold
 *   - URL (도메인만 strip) — muted small
 *   - 시간 시그널 — Visit.visited_at + dwell_ms ("5일 전, 12분 머묾")
 *   - 매칭 발췌 — content / selected_text 매칭 영역 (±100자) + <mark> highlight
 *   - 타입 인디케이터 — "📄 페이지" / "📝 노트"
 *
 * PRD §9.5.4 PreviewPane (hover) 는 M5-4 후순위 → 미구현. SearchResultCard 단일 책임만.
 *
 * 본 컴포넌트는 pure 함수 컴포넌트 — 외부 호출 없음, props 기반 렌더.
 * matchPositions 의 <mark> wrap 은 React fragment array 빌드 (XSS 안전, dangerouslySetInnerHTML 미사용).
 */

import type { JSX } from 'react'

import { formatTimeSignal } from './timeSignal'

export interface SearchResultMatch {
  start: number
  end: number
}

export interface SearchResultCardProps {
  pageId: string
  type: 'page' | 'note'
  title: string
  url: string
  visitedAt: number
  dwellMs: number
  excerpt: string
  matchPositions: SearchResultMatch[]
  score: number
  /** 시간 시그널 계산 기준 시각. 호출자가 Date.now() 또는 deterministic 값 주입. */
  now: number
  /** 카드 클릭 시 navigate 호출. */
  onClick: () => void
  /** 키보드 네비 selected 상태. true 시 active 스타일. */
  selected: boolean
}

export function SearchResultCard(props: SearchResultCardProps): JSX.Element {
  const typeLabel = props.type === 'page' ? '📄 페이지' : '📝 노트'
  const domain = extractDomain(props.url)
  const timeSignal = formatTimeSignal(props.visitedAt || null, props.dwellMs, props.now)

  return (
    <button
      type="button"
      className={`search-result-card ${props.selected ? 'is-selected' : ''}`}
      onClick={props.onClick}
    >
      <div className="search-result-card__header">
        <span className="search-result-card__type">{typeLabel}</span>
        <span className="search-result-card__time">{timeSignal}</span>
      </div>
      <div className="search-result-card__title">{props.title || '(제목 없음)'}</div>
      {domain && <div className="search-result-card__url">{domain}</div>}
      {props.excerpt && (
        <div className="search-result-card__excerpt">
          {renderExcerpt(props.excerpt, props.matchPositions)}
        </div>
      )}
    </button>
  )
}

/**
 * excerpt + matchPositions → React fragment array. matched 부분은 `<mark>` wrap.
 * XSS 안전 — dangerouslySetInnerHTML 미사용, React 가 text 그대로 escape.
 */
export function renderExcerpt(
  text: string,
  positions: SearchResultMatch[]
): JSX.Element[] {
  if (positions.length === 0) {
    return [<span key="all">{text}</span>]
  }
  // 정렬은 main 측에서 보장 (excerpt.ts buildExcerpt) — 방어로 한 번 더
  const sorted = [...positions].sort((a, b) => a.start - b.start)
  const out: JSX.Element[] = []
  let cursor = 0
  let keyIdx = 0
  for (const p of sorted) {
    if (p.start < cursor || p.start > text.length) continue
    if (p.start > cursor) {
      out.push(<span key={`t-${keyIdx++}`}>{text.slice(cursor, p.start)}</span>)
    }
    const matchEnd = Math.min(p.end, text.length)
    out.push(<mark key={`m-${keyIdx++}`}>{text.slice(p.start, matchEnd)}</mark>)
    cursor = matchEnd
  }
  if (cursor < text.length) {
    out.push(<span key={`t-${keyIdx++}`}>{text.slice(cursor)}</span>)
  }
  return out
}

/**
 * URL → 도메인만 strip. PRD §9.5.1 "URL (도메인만 strip)".
 * 빈 URL (글로사리 마이그레이션 노트) 시 빈 string.
 */
export function extractDomain(url: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
