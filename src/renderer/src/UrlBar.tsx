import { useState, useEffect, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  onOpenSettings?: () => void
}

const DEFAULT_URL = 'https://www.google.com'

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export default function UrlBar({ onOpenSettings }: Props = {}): JSX.Element {
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL)
  const [displayUrl, setDisplayUrl] = useState(DEFAULT_URL)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void navigate(DEFAULT_URL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function navigate(target: string): Promise<void> {
    const normalized = normalizeUrl(target)
    setBusy(true)
    try {
      const result = await window.browserApi.navigate(normalized)
      if (result.ok && result.url) {
        setCurrentUrl(result.url)
        setDisplayUrl(result.url)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    await navigate(displayUrl)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setDisplayUrl(currentUrl)
      e.currentTarget.blur()
    }
  }

  async function refreshUrl(): Promise<void> {
    const url = await window.browserApi.getCurrentUrl()
    if (url) {
      setCurrentUrl(url)
      setDisplayUrl(url)
    }
  }

  return (
    <header className="url-bar">
      <button
        type="button"
        className="nav-btn"
        onClick={() => {
          void window.browserApi.goBack().then(() => refreshUrl())
        }}
        title="뒤로"
        aria-label="뒤로"
      >
        ←
      </button>
      <button
        type="button"
        className="nav-btn"
        onClick={() => {
          void window.browserApi.goForward().then(() => refreshUrl())
        }}
        title="앞으로"
        aria-label="앞으로"
      >
        →
      </button>
      <button
        type="button"
        className="nav-btn"
        onClick={() => {
          void window.browserApi.reload().then(() => refreshUrl())
        }}
        title="새로고침"
        aria-label="새로고침"
      >
        ↻
      </button>
      <form className="url-form" onSubmit={(e) => void handleSubmit(e)}>
        <input
          type="text"
          className="url-input"
          value={displayUrl}
          onChange={(e) => setDisplayUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="URL 또는 검색어"
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button type="submit" className="go-btn" disabled={busy}>
          {busy ? '...' : '이동'}
        </button>
      </form>
      {onOpenSettings && (
        <button
          type="button"
          className="nav-btn"
          onClick={onOpenSettings}
          title="설정"
          aria-label="설정"
        >
          ⚙
        </button>
      )}
    </header>
  )
}
