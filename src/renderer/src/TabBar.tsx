import { useEffect, useRef, useState } from 'react'
import { formatTabLabel, type WorkspaceLabelContext } from './translation/tabLabel'

const HOVER_DELAY_MS = 600
const PREVIEW_WIDTH = 320
const PREVIEW_MARGIN = 8

interface ThumbnailPayload {
  dataUrl: string
  capturedAt: number
  width: number
  height: number
}

interface PreviewState {
  tabId: string
  anchorLeft: number
  thumbnail: ThumbnailPayload | null
  loading: boolean
}

type TabColorPayload =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'gray'
  | null

interface TabSessionPayload {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
  color: TabColorPayload
  pinned: boolean
  /** Sprint 016 M0 T03c — 워크스페이스 격리 메타. T03a TabSession schema 정합. */
  workspace_id: string | null
}

const COLOR_HEX: Record<NonNullable<TabColorPayload>, string> = {
  red: '#e74c3c',
  orange: '#e67e22',
  yellow: '#f1c40f',
  green: '#2ecc71',
  blue: '#4a9eff',
  purple: '#9b59b6',
  gray: '#95a5a6'
}

interface TabListSnapshot {
  tabs: TabSessionPayload[]
  activeId: string | null
}

export default function TabBar(): JSX.Element {
  const [snapshot, setSnapshot] = useState<TabListSnapshot>({ tabs: [], activeId: null })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)
  // Sprint 012 M2 — hover 미리보기
  const [preview, setPreview] = useState<PreviewState | null>(null)
  // Sprint 016 M0 T03c (KI-007) — 활성 워크스페이스 컨텍스트 — formatTabLabel 아이콘 prefix 주입.
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceLabelContext | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const draggingRef = useRef<string | null>(null)
  draggingRef.current = draggingId

  useEffect(() => {
    void refresh()
    void refreshWorkspaceContext()
    const off = window.tabApi.onListUpdate(setSnapshot)
    // Sprint 016 M0 T03c — workspace:switched broadcast 구독 시 활성 ws 컨텍스트 재로드.
    const offWs =
      typeof window.workspaceApi?.onSwitched === 'function'
        ? window.workspaceApi.onSwitched(() => {
            void refreshWorkspaceContext()
          })
        : () => {}
    return () => {
      off()
      offWs()
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  async function refreshWorkspaceContext(): Promise<void> {
    try {
      const current = await window.workspaceApi?.getCurrent?.()
      if (current) {
        setWorkspaceContext({ id: current.id, icon: current.icon })
      } else {
        setWorkspaceContext(null)
      }
    } catch {
      setWorkspaceContext(null)
    }
  }

  async function refresh(): Promise<void> {
    const snap = await window.tabApi.list()
    setSnapshot(snap)
  }

  async function handleOpen(): Promise<void> {
    await window.tabApi.open('about:blank')
  }

  async function handleSwitch(id: string): Promise<void> {
    await window.tabApi.switch(id)
  }

  async function handleClose(e: React.MouseEvent, id: string): Promise<void> {
    e.stopPropagation()
    await window.tabApi.close(id)
  }

  function handleDragStart(e: React.DragEvent, id: string): void {
    setDraggingId(id)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      try {
        e.dataTransfer.setData('text/plain', id)
      } catch {
        // ignore — 일부 Electron 환경에서 dataTransfer 제한
      }
    }
  }

  function handleDragOver(e: React.DragEvent, idx: number): void {
    if (!draggingId) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (dropTargetIdx !== idx) setDropTargetIdx(idx)
  }

  function handleDragLeave(): void {
    setDropTargetIdx(null)
  }

  async function handleDrop(e: React.DragEvent, idx: number): Promise<void> {
    e.preventDefault()
    const id = draggingId
    setDraggingId(null)
    setDropTargetIdx(null)
    if (!id) return
    await window.tabApi.reorder(id, idx)
  }

  function handleDragEnd(): void {
    setDraggingId(null)
    setDropTargetIdx(null)
  }

  function handleContextMenu(e: React.MouseEvent, id: string): void {
    e.preventDefault()
    void window.tabApi.showContextMenu(id)
  }

  function clearHoverTimer(): void {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>, id: string): void {
    // 드래그 중이면 미리보기 표시 안 함
    if (draggingRef.current !== null) return
    clearHoverTimer()
    const target = e.currentTarget
    const rawLeft = target.getBoundingClientRect().left
    // Sprint 013 M3 — viewport 우측 경계 보정
    // anchorLeft + PREVIEW_WIDTH + PREVIEW_MARGIN > innerWidth이면 우측 경계 맞춰 이동
    const innerWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
    const maxLeft = Math.max(PREVIEW_MARGIN, innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN)
    const anchorLeft = Math.max(PREVIEW_MARGIN, Math.min(rawLeft, maxLeft))
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      if (draggingRef.current !== null) return
      // 미리보기 영역 표시 (placeholder 먼저)
      setPreview({ tabId: id, anchorLeft, thumbnail: null, loading: true })
      void window.tabApi
        .getThumbnail(id)
        .then((thumb) => {
          // 다른 탭으로 이동했거나 leave 됐으면 ignore
          setPreview((curr) =>
            curr && curr.tabId === id ? { ...curr, thumbnail: thumb, loading: false } : curr
          )
        })
        .catch(() => {
          setPreview((curr) =>
            curr && curr.tabId === id ? { ...curr, thumbnail: null, loading: false } : curr
          )
        })
    }, HOVER_DELAY_MS)
  }

  function handleMouseLeave(): void {
    clearHoverTimer()
    setPreview(null)
  }

  return (
    <div className="tab-bar">
      <div className="tab-bar-list">
        {snapshot.tabs.map((t, idx) => {
          const isActive = snapshot.activeId === t.id
          const colorHex = t.color ? COLOR_HEX[t.color] : null
          // 활성 + color → color, 활성 + no color → 파란 강조, 비활성 + color → color, 비활성 + no color → transparent
          const borderTopColor = colorHex ?? (isActive ? '#4a9eff' : 'transparent')
          return (
          <div
            key={t.id}
            className={`tab-item ${isActive ? 'active' : ''} ${
              draggingId === t.id ? 'dragging' : ''
            } ${dropTargetIdx === idx && draggingId && draggingId !== t.id ? 'drop-target' : ''} ${
              t.pinned ? 'pinned' : ''
            }`}
            onClick={() => void handleSwitch(t.id)}
            onContextMenu={(e) => handleContextMenu(e, t.id)}
            onMouseEnter={(e) => handleMouseEnter(e, t.id)}
            onMouseLeave={handleMouseLeave}
            title={t.pinned ? `📌 ${t.url}` : t.url}
            draggable
            style={{ borderTopColor }}
            onDragStart={(e) => handleDragStart(e, t.id)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => void handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
          >
            {t.pinned && <span className="tab-pin-icon" aria-label="고정됨">📌</span>}
            <span className="tab-label">{formatTabLabel(t, workspaceContext)}</span>
            {!t.pinned && (
              <button
                type="button"
                className="tab-close"
                draggable={false}
                onClick={(e) => void handleClose(e, t.id)}
                onDragStart={(e) => e.preventDefault()}
                aria-label="탭 닫기"
                title="탭 닫기"
              >
                ×
              </button>
            )}
          </div>
          )
        })}
      </div>
      {preview && (
        <div
          className="tab-preview"
          style={{ left: preview.anchorLeft }}
          role="tooltip"
          onMouseEnter={(e) => e.stopPropagation()}
        >
          {preview.thumbnail ? (
            <>
              <img
                src={preview.thumbnail.dataUrl}
                alt="탭 미리보기"
                className="tab-preview-img"
              />
              <div className="tab-preview-meta">
                {(() => {
                  const t = snapshot.tabs.find((x) => x.id === preview.tabId)
                  if (!t) return null
                  return (
                    <>
                      <div className="tab-preview-title">{formatTabLabel(t, workspaceContext)}</div>
                      <div className="tab-preview-url">{t.url}</div>
                    </>
                  )
                })()}
              </div>
            </>
          ) : (
            <div className="tab-preview-empty">
              {preview.loading ? '미리보기 로드 중…' : '미리보기 없음'}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="tab-new"
        onClick={() => void handleOpen()}
        aria-label="새 탭"
        title="새 탭"
      >
        +
      </button>
    </div>
  )
}
