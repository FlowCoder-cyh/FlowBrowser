import { useEffect, useRef, useState } from 'react'

interface NodeRow {
  id: string
  tag: string
  sourceText: string
  translatedText: string | null
  status: 'pending' | 'done' | 'blocked' | 'failed'
  reason?: string
  blockReason?: string
  fromCache: boolean
}

type Mode = 'paragraph' | 'page'

interface Props {
  open: boolean
  onClose: () => void
}

export default function TranslationPanel({ open, onClose }: Props): JSX.Element | null {
  const [rows, setRows] = useState<NodeRow[]>([])
  const [progress, setProgress] = useState<{
    total: number
    completed: number
    blocked: number
    failed: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('paragraph')
  const [error, setError] = useState<string | null>(null)
  const [pageWideMessage, setPageWideMessage] = useState<string | null>(null)
  const [stoppedReason, setStoppedReason] = useState<
    'aborted' | 'page_wide_block' | null
  >(null)
  const rowsRef = useRef<Map<string, NodeRow>>(new Map())

  useEffect(() => {
    const offStart = window.translateApi.onParagraphsStart((p) => {
      const initial: NodeRow[] = p.paragraphs.map((para) => ({
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
      setPageWideMessage(null)
      setStoppedReason(null)
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

    const offPageStart = window.translateApi.onPageStart((p) => {
      const initial: NodeRow[] = p.nodes.map((node) => ({
        id: node.id,
        tag: node.tag,
        sourceText: node.text,
        translatedText: null,
        status: 'pending',
        fromCache: false
      }))
      rowsRef.current = new Map(initial.map((r) => [r.id, r]))
      setRows(initial)
      setProgress({ total: p.total, completed: 0, blocked: 0, failed: 0 })
      setError(null)
      setPageWideMessage(null)
      setStoppedReason(null)
    })

    const offPageProgress = window.translateApi.onPageProgress((p) => {
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
          row.blockReason = p.blockReason
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
      if (p.pageWideBlock && p.reason) {
        setPageWideMessage(p.reason)
      }
    })

    const offPageDone = window.translateApi.onPageDone((p) => {
      setBusy(false)
      setStoppedReason(p.stoppedReason)
    })

    return () => {
      offStart()
      offProgress()
      offDone()
      offPageStart()
      offPageProgress()
      offPageDone()
    }
  }, [])

  async function handleStartParagraph(): Promise<void> {
    setBusy(true)
    setError(null)
    setPageWideMessage(null)
    setStoppedReason(null)
    setMode('paragraph')
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

  async function handleStartPage(): Promise<void> {
    setBusy(true)
    setError(null)
    setPageWideMessage(null)
    setStoppedReason(null)
    setMode('page')
    const result = await window.translateApi.page({
      providerType: 'openai',
      sourceLanguage: 'auto',
      targetLanguage: 'ko'
    })
    if (!result.ok) {
      setError(result.reason ?? '페이지 번역 시작 실패')
      setBusy(false)
    }
  }

  async function handleAbort(): Promise<void> {
    await window.translateApi.abortPage()
  }

  if (!open) return null

  return (
    <aside className="translation-panel">
      <div className="panel-header">
        <h2 className="panel-title">번역 패널</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>

      <div className="panel-toolbar">
        <button
          type="button"
          className="panel-btn primary"
          onClick={() => void handleStartParagraph()}
          disabled={busy}
        >
          {busy && mode === 'paragraph' ? '진행 중…' : '문단 번역'}
        </button>
        <button
          type="button"
          className="panel-btn"
          onClick={() => void handleStartPage()}
          disabled={busy}
        >
          {busy && mode === 'page' ? '진행 중…' : '페이지 전체 번역'}
        </button>
        {busy && mode === 'page' && (
          <button type="button" className="panel-btn danger" onClick={() => void handleAbort()}>
            취소
          </button>
        )}
      </div>

      {error && <div className="panel-error">{error}</div>}

      {pageWideMessage && (
        <div className="panel-pagewide-block">
          페이지 전체 차단: {pageWideMessage}
        </div>
      )}

      {stoppedReason === 'aborted' && !busy && (
        <div className="panel-status-note">사용자가 취소했습니다.</div>
      )}
      {stoppedReason === 'page_wide_block' && !busy && (
        <div className="panel-status-note">민감 페이지 차단으로 진행이 중단됐습니다.</div>
      )}

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
