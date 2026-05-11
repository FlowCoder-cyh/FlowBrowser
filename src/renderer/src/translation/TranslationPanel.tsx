import { useEffect, useRef, useState } from 'react'

interface ParagraphRow {
  id: string
  tag: string
  sourceText: string
  translatedText: string | null
  status: 'pending' | 'done' | 'blocked' | 'failed'
  reason?: string
  fromCache: boolean
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function TranslationPanel({ open, onClose }: Props): JSX.Element | null {
  const [rows, setRows] = useState<ParagraphRow[]>([])
  const [progress, setProgress] = useState<{
    total: number
    completed: number
    blocked: number
    failed: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowsRef = useRef<Map<string, ParagraphRow>>(new Map())

  useEffect(() => {
    const offStart = window.translateApi.onParagraphsStart((p) => {
      const initial: ParagraphRow[] = p.paragraphs.map((para) => ({
        id: para.id,
        tag: para.tag,
        sourceText: para.text,
        translatedText: null,
        status: 'pending',
        fromCache: false
      }))
      rowsRef.current = new Map(initial.map((r) => [r.id, r]))
      setRows(initial)
      setProgress({ total: p.total, completed: 0, blocked: 0, failed: 0 })
      setError(null)
    })

    const offProgress = window.translateApi.onParagraphProgress((p) => {
      const map = rowsRef.current
      const row = map.get(p.id)
      if (row) {
        if (p.translatedText) {
          row.translatedText = p.translatedText
          row.status = 'done'
          row.fromCache = !!p.fromCache
        } else if (p.decision === 'blocked') {
          row.status = 'blocked'
          row.reason = p.reason
        } else {
          row.status = 'failed'
          row.reason = p.reason
        }
        rowsRef.current = new Map(map)
        setRows(Array.from(rowsRef.current.values()))
      }
      setProgress({
        total: p.total,
        completed: p.completed,
        blocked: p.blocked,
        failed: p.failed
      })
    })

    const offDone = window.translateApi.onParagraphsDone(() => {
      setBusy(false)
    })

    return () => {
      offStart()
      offProgress()
      offDone()
    }
  }, [])

  async function handleStart(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await window.translateApi.paragraphs({
      providerType: 'openai',
      sourceLanguage: 'auto',
      targetLanguage: 'ko'
    })
    if (!result.ok) {
      setError(result.reason ?? '문단 번역 시작 실패')
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <aside className="translation-panel">
      <div className="panel-header">
        <h2 className="panel-title">페이지 번역</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>

      <div className="panel-toolbar">
        <button
          type="button"
          className="panel-btn primary"
          onClick={() => void handleStart()}
          disabled={busy}
        >
          {busy ? '진행 중…' : '페이지 번역 시작'}
        </button>
      </div>

      {error && <div className="panel-error">{error}</div>}

      {progress && (
        <div className="panel-progress">
          <div className="panel-progress-bar">
            <div
              className="panel-progress-fill"
              style={{
                width: `${progress.total === 0 ? 0 : Math.round(((progress.completed + progress.blocked + progress.failed) / progress.total) * 100)}%`
              }}
            />
          </div>
          <div className="panel-progress-text">
            {progress.completed + progress.blocked + progress.failed} / {progress.total} (완료{' '}
            {progress.completed} · 차단 {progress.blocked} · 실패 {progress.failed})
          </div>
        </div>
      )}

      <ul className="panel-rows">
        {rows.map((row) => (
          <li key={row.id} className={`panel-row status-${row.status}`}>
            <div className="panel-tag">{row.tag}</div>
            <div className="panel-source">{row.sourceText}</div>
            {row.status === 'done' && row.translatedText && (
              <div className="panel-translated">
                {row.fromCache && <span className="panel-cache-badge">✓ 캐시</span>}
                {row.translatedText}
              </div>
            )}
            {row.status === 'pending' && <div className="panel-pending">대기…</div>}
            {row.status === 'blocked' && (
              <div className="panel-blocked">차단: {row.reason ?? '사유 없음'}</div>
            )}
            {row.status === 'failed' && (
              <div className="panel-failed">실패: {row.reason ?? '오류'}</div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
