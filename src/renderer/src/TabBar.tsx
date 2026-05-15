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

  return (
    <div className="tab-bar">
      <div className="tab-bar-list">
        {snapshot.tabs.map((t) => (
          <div
            key={t.id}
            className={`tab-item ${snapshot.activeId === t.id ? 'active' : ''}`}
            onClick={() => void handleSwitch(t.id)}
            title={t.url}
          >
            <span className="tab-label">{formatTabLabel(t)}</span>
            <button
              type="button"
              className="tab-close"
              onClick={(e) => void handleClose(e, t.id)}
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
