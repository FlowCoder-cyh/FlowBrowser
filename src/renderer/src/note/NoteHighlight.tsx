/**
 * Sprint 017 M1 T06 — NoteHighlight panel (renderer).
 *
 * 책임: 활성 워크스페이스 + 현재 페이지 URL 매칭 highlight 들을 list 로 표시 + 개별 remove.
 * 시각 visual highlight 본체는 WebContentsView 페이지 내부 CSS Highlight API 가 처리 —
 * 본 컴포넌트는 노트 패널 측 "어떤 텍스트를 표시했는가" 목록 + 관리 UI.
 *
 * Sprint 017 M1 T06 scope (codex 협의 정합, threadId 019e4b75):
 *   - workspaceId + url 변경 시 highlightApi.listByPage 호출 + 표시
 *   - 개별 remove 버튼 (highlightApi.remove 호출 + 즉시 list 재로드)
 *   - 빈 list 시 "이 페이지에 저장된 하이라이트가 없습니다" placeholder
 *   - 무한 polling 아님 — workspaceId / url 변경 시점 또는 명시 refresh 시점에만 fetch
 *
 * T08 위임:
 *   - 클릭 시 노트 패널 포커스 / 하이라이트 위치 scrollIntoView
 *   - toast fallback (CSS Highlight API 미지원 환경)
 *   - 다중 highlight 동일 페이지 시 z-index 정합
 *   - App.tsx mount 위치 (현재 export 만)
 *
 * 본 컴포넌트는 highlightApi 가 contextBridge 에 노출되어 있어야 동작 (Sprint 017 T06 preload index.ts).
 */

import { useCallback, useEffect, useState } from 'react'

interface HighlightAnchorPayload {
  rootSelector: string
  startPath: number[]
  endPath: number[]
  startOffset: number
  endOffset: number
  selectedText: string
  prefix: string
  suffix: string
  contentHash: string
  contextHash: string
}

interface HighlightRow {
  id: string
  noteId: string
  pageId: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchorPayload
  workspaceId: string
  createdAt: number
}

export interface NoteHighlightProps {
  workspaceId: string | null
  /** 현재 활성 탭의 URL. workspaceId / url 변경 시 list 재로드. */
  url: string | null
  /**
   * 명시 refresh trigger — 신규 highlight 추가 broadcast 등 외부 invalidation source.
   * 본 prop 변경 시 list 재로드.
   */
  refreshKey?: number
}

export default function NoteHighlight({
  workspaceId,
  url,
  refreshKey
}: NoteHighlightProps): JSX.Element {
  const [items, setItems] = useState<HighlightRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!workspaceId || !url) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await window.highlightApi.listByPage({
        workspaceId,
        url
      })
      setItems(response.highlights ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, url])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  async function handleRemove(id: string): Promise<void> {
    try {
      const result = await window.highlightApi.remove(id)
      if (result.ok) {
        setItems((prev) => prev.filter((h) => h.id !== id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!workspaceId || !url) {
    return (
      <div className="note-highlight">
        <p className="note-highlight__placeholder">활성 워크스페이스 또는 페이지가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="note-highlight" data-testid="note-highlight">
      <header className="note-highlight__header">
        <h3 className="note-highlight__title">하이라이트</h3>
        <button
          type="button"
          className="note-highlight__refresh"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="하이라이트 목록 새로고침"
        >
          새로고침
        </button>
      </header>
      {error && (
        <p className="note-highlight__error" role="alert">
          {error}
        </p>
      )}
      {!loading && items.length === 0 && !error && (
        <p className="note-highlight__placeholder">이 페이지에 저장된 하이라이트가 없습니다.</p>
      )}
      <ul className="note-highlight__list">
        {items.map((item) => (
          <li key={item.id} className="note-highlight__item" data-highlight-id={item.id}>
            <p className="note-highlight__text">{item.anchor.selectedText}</p>
            <button
              type="button"
              className="note-highlight__remove"
              onClick={() => void handleRemove(item.id)}
              aria-label={`하이라이트 삭제: ${item.anchor.selectedText.slice(0, 20)}`}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
