import { useEffect, useRef, useState } from 'react'
import { isCurrentTab as isCurrentTabPure } from './tabGuard'

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

type Mode = 'paragraph' | 'page' | 'summary'
type DisplayMode = 'panel' | 'replace' | 'overlay'

interface SummaryState {
  status: 'idle' | 'loading' | 'done' | 'error'
  summary: string | null
  chunkSummaries: string[]
  combined: boolean
  combinedPath?: 'single' | 'direct' | 'resplit' | 'truncated'
  combinedInputChars?: number
  combineCharLimit?: number
  chunks: number
  reason: string | null
}

const PATH_LABELS: Record<NonNullable<SummaryState['combinedPath']>, string> = {
  single: '단일 청크',
  direct: '직접 통합',
  resplit: '재분할 통합',
  truncated: '재분할 + truncate'
}

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
  const [summary, setSummary] = useState<SummaryState>({
    status: 'idle',
    summary: null,
    chunkSummaries: [],
    combined: false,
    chunks: 0,
    reason: null
  })
  const [chunksExpanded, setChunksExpanded] = useState(false)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('panel')
  // Sprint 014 M3-8 핫픽스 — listener closure의 stale displayMode 회피 (의존성 재실행 미스 안전망)
  const displayModeRef = useRef<DisplayMode>('panel')
  displayModeRef.current = displayMode
  const [defaultLanguage, setDefaultLanguage] = useState('ko')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [defaultProviderId, setDefaultProviderId] = useState('openai')
  // Sprint 009 M2 — 활성 탭 추적 (sourceTabId 가드)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const activeTabIdRef = useRef<string | null>(null)
  activeTabIdRef.current = activeTabId
  const [restoreHint, setRestoreHint] = useState<{ url: string; count: number } | null>(null)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  // 진행 중 누적 instruction (paragraph/page mode일 때 replace/overlay로 자동 렌더)
  const renderQueueRef = useRef<Array<{ id: string; translatedText: string }>>([])
  const rowsRef = useRef<Map<string, NodeRow>>(new Map())

  useEffect(() => {
    // Sprint 009 M2 — 활성 탭 ID 추적
    void window.tabApi.list().then((snap) => setActiveTabId(snap.activeId))
    const offTabUpdate = window.tabApi.onListUpdate((snap) => setActiveTabId(snap.activeId))

    void window.userSettingApi.get().then((s) => {
      setDisplayMode(s.translationMode)
      const ext = s as {
        translationMode: DisplayMode
        defaultLanguage?: string
        sourceLanguage?: string
        defaultProviderId?: string
      }
      if (ext.defaultLanguage) setDefaultLanguage(ext.defaultLanguage)
      if (ext.sourceLanguage) setSourceLanguage(ext.sourceLanguage)
      if (ext.defaultProviderId) setDefaultProviderId(ext.defaultProviderId)
    })
    // Navigation 시 자동 restore + 페이지 캐시 hit 알림 + 자동 번역 (replace/overlay 모드)
    const offNav = window.browserApi.onNavigated((p) => {
      void window.translateApi.renderRestore()
      setRestoreHint(null)
      if (p.url) {
        void window.pageResultApi
          .lookup({
            url: p.url,
            targetLanguage: defaultLanguage,
            providerType: defaultProviderId
          })
          .then((entry) => {
            if (entry) {
              // 캐시 hit → 자동 복원 (별도 호출 불필요)
              setRestoreHint({ url: p.url, count: entry.instructions.length })
              return
            }
            // Sprint 014 M3-12: 캐시 miss + displayMode replace/overlay면 자동 paragraphs 시작.
            // panel 모드는 사용자 명시 액션 대기 (UX 의도).
            // busy 상태는 ref로 직접 검사 (의존성 제외 — eslint-disable로 처리)
            if (displayModeRef.current !== 'panel') {
              void window.translateApi
                .paragraphs({
                  providerType: defaultProviderId,
                  sourceLanguage,
                  targetLanguage: defaultLanguage
                })
                .catch(() => {
                  // 호출 실패는 silent (사용자가 패널에서 수동 재시도 가능)
                })
            }
          })
      }
    })

    // Sprint 009 M2 — sourceTabId 가드 헬퍼 (Sprint 010 M3에서 순수 함수 tabGuard.ts로 추출)
    const isCurrentTab = (p: { sourceTabId?: string | null }): boolean =>
      isCurrentTabPure(activeTabIdRef.current, p.sourceTabId)

    const offStart = window.translateApi.onParagraphsStart((p) => {
      if (!isCurrentTab(p)) return
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
      renderQueueRef.current = []
    })

    const offProgress = window.translateApi.onParagraphProgress((p) => {
      if (!isCurrentTab(p)) return
      const map = rowsRef.current
      const row = map.get(p.id)
      if (row) {
        if (p.translatedText) {
          row.translatedText = p.translatedText
          row.status = 'done'
          row.fromCache = !!p.fromCache
          renderQueueRef.current.push({ id: p.id, translatedText: p.translatedText })
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

    const offDone = window.translateApi.onParagraphsDone((p) => {
      if (!isCurrentTab(p)) return
      setBusy(false)
      if (p.stoppedReason) {
        setStoppedReason(p.stoppedReason)
      }
      // 자동 render (replace / overlay 모드)
      if (displayModeRef.current !== 'panel' && renderQueueRef.current.length > 0) {
        void window.translateApi.render({
          mode: displayModeRef.current,
          selectorPreset: 'paragraph',
          instructions: renderQueueRef.current
        })
      }
    })

    const offParagraphsAborted = window.translateApi.onParagraphsAborted((p) => {
      if (!isCurrentTab(p)) return
      setStoppedReason('aborted')
    })

    const offParagraphsError = window.translateApi.onParagraphsError((p) => {
      if (!isCurrentTab(p)) return
      setError(p.reason)
      setBusy(false)
    })

    const offPageStart = window.translateApi.onPageStart((p) => {
      if (!isCurrentTab(p)) return
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
      renderQueueRef.current = []
    })

    const offPageProgress = window.translateApi.onPageProgress((p) => {
      if (!isCurrentTab(p)) return
      const map = rowsRef.current
      const row = map.get(p.id)
      if (row) {
        if (p.translatedText) {
          row.translatedText = p.translatedText
          row.status = 'done'
          row.fromCache = !!p.fromCache
          renderQueueRef.current.push({ id: p.id, translatedText: p.translatedText })
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
      if (!isCurrentTab(p)) return
      setBusy(false)
      setStoppedReason(p.stoppedReason)
      if (displayModeRef.current !== 'panel' && renderQueueRef.current.length > 0) {
        void window.translateApi.render({
          mode: displayModeRef.current,
          selectorPreset: 'page',
          instructions: renderQueueRef.current
        })
      }
    })

    const offPageAborted = window.translateApi.onPageAborted((p) => {
      if (!isCurrentTab(p)) return
      setStoppedReason('aborted')
    })

    const offPageError = window.translateApi.onPageError((p) => {
      if (!isCurrentTab(p)) return
      setError(p.reason)
      setBusy(false)
    })

    const offSummaryStart = window.translateApi.onSummaryStart((p) => {
      if (!isCurrentTab(p)) return
      setSummary({
        status: 'loading',
        summary: null,
        chunkSummaries: [],
        combined: false,
        chunks: p.chunks,
        reason: null
      })
    })

    const offSummaryDone = window.translateApi.onSummaryDone((p) => {
      if (!isCurrentTab(p)) return
      setSummary({
        status: 'done',
        summary: p.summary,
        chunkSummaries: p.chunkSummaries,
        combined: p.combined,
        combinedPath: p.combinedPath,
        combinedInputChars: p.combinedInputChars,
        combineCharLimit: p.combineCharLimit,
        chunks: p.chunks,
        reason: null
      })
      setBusy(false)
    })

    const offSummaryError = window.translateApi.onSummaryError((p) => {
      if (!isCurrentTab(p)) return
      setSummary((prev) => ({
        ...prev,
        status: 'error',
        reason: p.reason
      }))
      setBusy(false)
    })

    // Sprint 011 M1 — summary aborted listener (cancel 버튼 또는 cancelOnTabSwitch)
    const offSummaryAborted = window.translateApi.onSummaryAborted((p) => {
      if (!isCurrentTab(p)) return
      setSummary((prev) => ({
        ...prev,
        status: 'idle',
        reason: '요약이 취소되었습니다.'
      }))
      setBusy(false)
    })

    return () => {
      offTabUpdate()
      offNav()
      offStart()
      offProgress()
      offDone()
      offParagraphsAborted()
      offParagraphsError()
      offPageStart()
      offPageProgress()
      offPageDone()
      offPageAborted()
      offPageError()
      offSummaryStart()
      offSummaryDone()
      offSummaryError()
      offSummaryAborted()
    }
  }, [displayMode, defaultLanguage, sourceLanguage, defaultProviderId])

  async function handleStartParagraph(): Promise<void> {
    setBusy(true)
    setError(null)
    setPageWideMessage(null)
    setStoppedReason(null)
    setMode('paragraph')
    const result = await window.translateApi.paragraphs({
      providerType: defaultProviderId,
      sourceLanguage,
      targetLanguage: defaultLanguage
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
      providerType: defaultProviderId,
      sourceLanguage,
      targetLanguage: defaultLanguage
    })
    if (!result.ok) {
      setError(result.reason ?? '페이지 번역 시작 실패')
      setBusy(false)
    }
  }

  async function handleAbort(): Promise<void> {
    if (mode === 'page') {
      await window.translateApi.abortPage()
    } else if (mode === 'paragraph') {
      await window.translateApi.abortParagraphs()
    } else if (mode === 'summary') {
      // Sprint 011 M1 — summary abort
      await window.translateApi.abortSummarize()
    }
  }

  async function handleRestoreOriginals(): Promise<void> {
    await window.translateApi.renderRestore()
  }

  async function handleRestoreFromCache(): Promise<void> {
    setRestoreResult('복원 중…')
    const result = await window.pageResultApi.restoreCurrent({
      targetLanguage: defaultLanguage,
      providerType: defaultProviderId,
      mode: displayMode === 'panel' ? 'overlay' : displayMode
    })
    if (result.ok) {
      setRestoreResult(`복원 완료: ${result.applied}건 적용, ${result.missing}건 누락`)
      setRestoreHint(null)
    } else if (result.reason === 'signature-mismatch') {
      setRestoreResult('페이지가 변경되어 복원할 수 없습니다.')
    } else if (result.reason === 'no-hit') {
      setRestoreResult('저장된 번역이 없습니다.')
    } else {
      setRestoreResult(`복원 실패: ${result.reason ?? '알 수 없음'}`)
    }
  }

  async function handleStartSummary(): Promise<void> {
    setBusy(true)
    setError(null)
    setMode('summary')
    setSummary({
      status: 'loading',
      summary: null,
      chunkSummaries: [],
      combined: false,
      chunks: 0,
      reason: null
    })
    const result = await window.translateApi.summarizePage({
      providerType: defaultProviderId,
      sourceLanguage,
      targetLanguage: defaultLanguage
    })
    if (!result.ok) {
      setError(result.reason ?? '페이지 요약 시작 실패')
      setBusy(false)
    }
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
        <button
          type="button"
          className="panel-btn"
          onClick={() => void handleStartSummary()}
          disabled={busy}
        >
          {busy && mode === 'summary' ? '요약 중…' : '페이지 요약'}
        </button>
        {busy && (mode === 'page' || mode === 'paragraph' || mode === 'summary') && (
          <button type="button" className="panel-btn danger" onClick={() => void handleAbort()}>
            취소
          </button>
        )}
        {displayMode !== 'panel' && (
          <button
            type="button"
            className="panel-btn"
            onClick={() => void handleRestoreOriginals()}
            disabled={busy}
            title={`현재 모드: ${displayMode}`}
          >
            원문으로
          </button>
        )}
      </div>

      {restoreHint && (
        <div className="panel-restore-hint">
          이 페이지에 저장된 번역이 있습니다 ({restoreHint.count}개 노드).
          <button
            type="button"
            className="panel-btn"
            onClick={() => void handleRestoreFromCache()}
            disabled={busy}
          >
            복원
          </button>
        </div>
      )}

      {restoreResult && <div className="panel-restore-result">{restoreResult}</div>}

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

      {mode === 'summary' && summary.status !== 'idle' && (
        <div className="panel-summary">
          {summary.status === 'loading' && (
            <div className="panel-summary-loading">
              요약 중… ({summary.chunks}개 청크)
            </div>
          )}
          {summary.status === 'done' && summary.summary && (
            <>
              <div className="panel-summary-text">{summary.summary}</div>
              <div className="panel-summary-meta">
                {summary.chunks}개 청크 ·{' '}
                {summary.combinedPath ? PATH_LABELS[summary.combinedPath] : '단일 요약'}
                {summary.combinedInputChars !== undefined &&
                  summary.combineCharLimit !== undefined && (
                    <span
                      className={
                        summary.combinedPath === 'truncated'
                          ? 'panel-summary-chars warn'
                          : 'panel-summary-chars'
                      }
                    >
                      {' '}
                      · 통합 입력 {summary.combinedInputChars.toLocaleString()}자 / limit{' '}
                      {summary.combineCharLimit.toLocaleString()}자
                    </span>
                  )}
                {summary.chunkSummaries.length > 1 && (
                  <button
                    type="button"
                    className="panel-chunk-toggle"
                    onClick={() => setChunksExpanded((v) => !v)}
                  >
                    {chunksExpanded ? '청크 요약 접기' : '청크 요약 펼치기'}
                  </button>
                )}
              </div>
              {chunksExpanded && summary.chunkSummaries.length > 1 && (
                <ol className="panel-chunk-list">
                  {summary.chunkSummaries.map((cs, i) => (
                    <li key={i} className="panel-chunk-item">
                      <span className="panel-chunk-idx">청크 {i + 1}</span>
                      <p className="panel-chunk-text">{cs}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {summary.status === 'error' && summary.reason && (
            <div className="panel-summary-error">요약 실패: {summary.reason}</div>
          )}
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
