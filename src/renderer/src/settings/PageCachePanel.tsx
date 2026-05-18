// Sprint 015 M3-7 PARTIAL — v0.4 방향 전환에 따라 "페이지 번역 결과" → "페이지 본문 캐시" 의미로 일반화.
// M5-8 시점에 본 패널은 신규 인덱싱 통계 (MemoryStatsPanel) 로 흡수 폐기 예정.
// 현재는 기존 pageResultApi 사용 (어댑터 모드 보존) — copy 만 갱신.

import { useEffect, useState } from 'react'

export default function PageCachePanel(): JSX.Element {
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const s = await window.pageResultApi.stats()
    setCount(s.count)
  }

  async function handleClear(): Promise<void> {
    if (!window.confirm('저장된 페이지 본문 캐시를 모두 삭제합니다. 진행할까요?')) return
    setBusy(true)
    setMessage(null)
    try {
      await window.pageResultApi.clear()
      setMessage('페이지 본문 캐시를 모두 삭제했습니다.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section page-cache-panel">
      <h2 className="settings-title">페이지 본문 캐시</h2>
      <p className="settings-muted">
        방문한 페이지의 본문을 저장해 재방문 / 인덱싱 / 검색 시 재사용합니다 (TTL 30일, 최대 500MB).
      </p>
      <div className="pc-stats">
        <span className="pc-count">{count ?? '…'}</span>
        <span className="pc-count-label">개 저장됨</span>
      </div>
      <div className="pc-actions">
        <button
          type="button"
          className="settings-btn-danger"
          onClick={() => void handleClear()}
          disabled={busy || count === 0}
        >
          모두 삭제
        </button>
      </div>
      {message && <div className="pc-message">{message}</div>}
    </section>
  )
}
