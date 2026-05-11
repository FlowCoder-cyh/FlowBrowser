import { useCallback, useEffect, useState } from 'react'

type RangeKey = '1d' | '7d' | '30d' | 'all'

interface Summary {
  total: number
  successCount: number
  failedCount: number
  totalCostUsd: number
  byProvider: Record<string, { count: number; costUsd: number }>
  byFeature: Record<string, { count: number; costUsd: number }>
}

interface BlockedStats {
  byDomain: Record<string, number>
  byReason: Record<string, number>
  total: number
}

const RANGES: Array<{ key: RangeKey; label: string; ms: number | undefined }> = [
  { key: '1d', label: '최근 24시간', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '최근 7일', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '최근 30일', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: '전체', ms: undefined }
]

export default function UsagePanel(): JSX.Element {
  const [range, setRange] = useState<RangeKey>('7d')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [blocked, setBlocked] = useState<BlockedStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = RANGES.find((x) => x.key === range)
      const sinceMs = r?.ms ? Date.now() - r.ms : undefined
      const [s, b] = await Promise.all([
        window.usageApi.summary(sinceMs),
        window.privacyApi.blockedStats()
      ])
      setSummary(s as Summary)
      setBlocked(b as BlockedStats)
    } finally {
      setBusy(false)
    }
  }, [range])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleClearAll(): Promise<void> {
    if (busy) return
    const confirmed = window.confirm(
      '모든 사용량 로그를 삭제합니다. 외부 전송 감사 로그도 함께 사라집니다. 계속할까요?'
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await window.usageApi.clearAll()
      setMessage('사용량 로그를 전부 삭제했습니다.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <h2>사용량 / 감사 로그</h2>
      <p className="settings-muted">
        외부 Provider 전송 토큰 / 비용 / 차단 통계. PRD §10.3 사용자 감사 가능.
      </p>

      <div className="usage-toolbar">
        <div className="usage-range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`usage-range-btn ${range === r.key ? 'active' : ''}`}
              onClick={() => setRange(r.key)}
              disabled={busy}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="settings-btn"
          onClick={() => void refresh()}
          disabled={busy}
        >
          새로고침
        </button>
        <button
          type="button"
          className="settings-btn-link"
          onClick={() => void handleClearAll()}
          disabled={busy}
        >
          전체 삭제
        </button>
      </div>

      {message && <div className="settings-message info">{message}</div>}

      {summary && (
        <>
          <h3 className="settings-subhead">전송 통계 ({range})</h3>
          <ul className="usage-stat-list">
            <li>
              <span className="usage-label">총 요청</span>
              <span className="usage-value">{summary.total}</span>
            </li>
            <li>
              <span className="usage-label">성공 / 실패</span>
              <span className="usage-value">
                {summary.successCount} / {summary.failedCount}
              </span>
            </li>
            <li>
              <span className="usage-label">예상 비용 (USD)</span>
              <span className="usage-value">${summary.totalCostUsd.toFixed(6)}</span>
            </li>
          </ul>

          <h3 className="settings-subhead">Provider별</h3>
          {Object.keys(summary.byProvider).length === 0 ? (
            <p className="settings-muted">없음</p>
          ) : (
            <ul className="usage-stat-list">
              {Object.entries(summary.byProvider).map(([provider, v]) => (
                <li key={provider}>
                  <span className="usage-label">{provider}</span>
                  <span className="usage-value">
                    {v.count}회 · ${v.costUsd.toFixed(6)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="settings-subhead">Feature별</h3>
          {Object.keys(summary.byFeature).length === 0 ? (
            <p className="settings-muted">없음</p>
          ) : (
            <ul className="usage-stat-list">
              {Object.entries(summary.byFeature).map(([feat, v]) => (
                <li key={feat}>
                  <span className="usage-label">{feat}</span>
                  <span className="usage-value">
                    {v.count}회 · ${v.costUsd.toFixed(6)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {blocked && (
        <>
          <h3 className="settings-subhead">Privacy Filter 차단 통계</h3>
          <ul className="usage-stat-list">
            <li>
              <span className="usage-label">총 차단</span>
              <span className="usage-value">{blocked.total}</span>
            </li>
            {Object.entries(blocked.byReason).map(([reason, n]) => (
              <li key={reason}>
                <span className="usage-label">사유: {reason}</span>
                <span className="usage-value">{n}회</span>
              </li>
            ))}
          </ul>
          {Object.keys(blocked.byDomain).length > 0 && (
            <>
              <h3 className="settings-subhead">차단 도메인 상위 5</h3>
              <ul className="usage-stat-list">
                {Object.entries(blocked.byDomain)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([domain, n]) => (
                    <li key={domain}>
                      <span className="usage-label">{domain}</span>
                      <span className="usage-value">{n}회</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
