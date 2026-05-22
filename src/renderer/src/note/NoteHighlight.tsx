/**
 * Sprint 017 M1 T06 → T08 — NoteHighlight panel (renderer).
 *
 * 책임: 활성 워크스페이스 + 현재 페이지 URL 매칭 highlight 들을 list 로 표시 + 클릭 시 페이지
 * scrollIntoView + 개별 remove (page context 시각 highlight 동반 제거).
 *
 * T06 scope (codex 협의 정합, threadId 019e4b75):
 *   - workspaceId + url 변경 시 highlightApi.listByPage 호출 + 표시
 *   - 빈 list 시 "이 페이지에 저장된 하이라이트가 없습니다" placeholder
 *
 * T08 추가 (codex 협의 019e4ec8):
 *   - 클릭 시 active page scrollIntoView (`highlightApi.scrollTo(id)`)
 *   - 선택 state — list item 시각 강조 (`note-highlight__item--selected`)
 *   - remove 후 visual 즉시 제거 — `highlight:remove` IPC 핸들러가 main 측에서 `runHighlightRemoveVisual` 호출
 *     (NoteHighlight 자체는 store remove + list 갱신만)
 *   - toast — error 시 `pushToast({kind:'error', ...})` (예: scrollTo 실패 / API 미지원)
 *
 * 본 컴포넌트는 highlightApi 가 contextBridge 에 노출되어 있어야 동작.
 */

import { useCallback, useEffect, useState } from 'react'
import { pushToast } from '../common/ToastHost'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  async function handleClick(id: string): Promise<void> {
    // 선택 state 즉시 갱신 (스크롤 결과 무관하게 사용자 피드백).
    setSelectedId(id)
    try {
      const result = await window.highlightApi.scrollTo(id)
      if (!result.ok) {
        pushToast({ kind: 'error', message: '하이라이트 위치로 이동할 수 없습니다.' })
        return
      }
      if (!result.scrolled) {
        // graceful — page reload 직후 또는 navigate 직후 highlight 미등록 상태 가능.
        pushToast({
          kind: 'info',
          message: '페이지가 아직 로드 중입니다. 잠시 후 다시 시도하세요.'
        })
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        message: `이동 실패: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  async function handleRemove(id: string, evt: React.MouseEvent): Promise<void> {
    evt.stopPropagation()
    try {
      const result = await window.highlightApi.remove(id)
      if (result.ok) {
        setItems((prev) => prev.filter((h) => h.id !== id))
        if (selectedId === id) setSelectedId(null)
        pushToast({ kind: 'success', message: '하이라이트를 삭제했습니다.' })
      } else {
        pushToast({ kind: 'error', message: '하이라이트 삭제에 실패했습니다.' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      pushToast({
        kind: 'error',
        message: `삭제 실패: ${err instanceof Error ? err.message : String(err)}`
      })
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
        {items.map((item) => {
          const isSelected = selectedId === item.id
          return (
            <li
              key={item.id}
              className={`note-highlight__item${isSelected ? ' note-highlight__item--selected' : ''}`}
              data-highlight-id={item.id}
            >
              <button
                type="button"
                className="note-highlight__text-button"
                onClick={() => void handleClick(item.id)}
                aria-label={`하이라이트 위치로 이동: ${item.anchor.selectedText.slice(0, 40)}`}
                aria-pressed={isSelected}
              >
                <span className="note-highlight__text">{item.anchor.selectedText}</span>
              </button>
              <button
                type="button"
                className="note-highlight__remove"
                onClick={(evt) => void handleRemove(item.id, evt)}
                aria-label={`하이라이트 삭제: ${item.anchor.selectedText.slice(0, 20)}`}
              >
                삭제
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
