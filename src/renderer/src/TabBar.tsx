import { useEffect, useState } from 'react'

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

function formatTabLabel(t: TabSessionPayload): string {
  if (t.title) return t.title
  if (!t.url || t.url === 'about:blank') return '새 탭'
  try {
    const u = new URL(t.url)
    return u.hostname || t.url
  } catch {
    return t.url
  }
}

export default function TabBar(): JSX.Element {
  const [snapshot, setSnapshot] = useState<TabListSnapshot>({ tabs: [], activeId: null })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)

  useEffect(() => {
    void refresh()
    const off = window.tabApi.onListUpdate(setSnapshot)
    return off
  }, [])

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
            <span className="tab-label">{formatTabLabel(t)}</span>
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
