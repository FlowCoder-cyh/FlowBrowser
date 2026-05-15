import { useEffect, useState } from 'react'

interface TabSessionPayload {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
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
        {snapshot.tabs.map((t, idx) => (
          <div
            key={t.id}
            className={`tab-item ${snapshot.activeId === t.id ? 'active' : ''} ${
              draggingId === t.id ? 'dragging' : ''
            } ${dropTargetIdx === idx && draggingId && draggingId !== t.id ? 'drop-target' : ''}`}
            onClick={() => void handleSwitch(t.id)}
            onContextMenu={(e) => handleContextMenu(e, t.id)}
            title={t.url}
            draggable
            onDragStart={(e) => handleDragStart(e, t.id)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => void handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
          >
            <span className="tab-label">{formatTabLabel(t)}</span>
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
          </div>
        ))}
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
