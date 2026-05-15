import { useEffect, useState } from 'react'

type Mode = 'translation' | 'explanation'

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; sourceText: string; anchor: { x: number; y: number }; mode: Mode }
  | {
      kind: 'result'
      sourceText: string
      anchor: { x: number; y: number }
      mode: Mode
      translatedText: string
      modelUsed: string
      inputTokens: number
      outputTokens: number
      estimatedCostUsd: number
      durationMs: number
      fromCache: boolean
    }
  | {
      kind: 'blocked'
      sourceText: string
      anchor: { x: number; y: number }
      mode: Mode
      reason: string
    }
  | {
      kind: 'error'
      sourceText: string
      anchor: { x: number; y: number }
      mode: Mode
      reason: string
    }

const TITLE_BY_MODE: Record<Mode, string> = {
  translation: '번역',
  explanation: '쉽게 설명'
}

const LOADING_BY_MODE: Record<Mode, string> = {
  translation: '번역 중…',
  explanation: '설명 작성 중…'
}

export default function TranslationPopup(): JSX.Element | null {
  const [state, setState] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    const offShow = window.popupApi.onShow((payload) => {
      setState({
        kind: 'loading',
        sourceText: payload.sourceText,
        anchor: { x: payload.anchorX, y: payload.anchorY },
        mode: payload.mode ?? 'translation'
      })
    })
    const offResult = window.popupApi.onResult((payload) => {
      setState((prev) => {
        if (prev.kind !== 'loading') return prev
        const mode: Mode = payload.mode ?? prev.mode
        if (payload.ok && payload.output) {
          return {
            kind: 'result',
            sourceText: prev.sourceText,
            anchor: prev.anchor,
            mode,
            translatedText: payload.output.translatedText,
            modelUsed: payload.output.modelUsed,
            inputTokens: payload.output.inputTokens,
            outputTokens: payload.output.outputTokens,
            estimatedCostUsd: payload.output.estimatedCostUsd,
            durationMs: payload.output.durationMs,
            fromCache: !!payload.fromCache
          }
        }
        if (payload.decision === 'blocked') {
          return {
            kind: 'blocked',
            sourceText: prev.sourceText,
            anchor: prev.anchor,
            mode,
            reason: payload.reason ?? '차단되었습니다.'
          }
        }
        return {
          kind: 'error',
          sourceText: prev.sourceText,
          anchor: prev.anchor,
          mode,
          reason: payload.reason ?? '알 수 없는 오류'
        }
      })
    })
    return () => {
      offShow()
      offResult()
    }
  }, [])

  useEffect(() => {
    if (state.kind === 'idle') return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setState({ kind: 'idle' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.kind])

  if (state.kind === 'idle') return null

  const popupStyle: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(state.anchor.x, window.innerWidth - 360),
    top: state.anchor.y + 8,
    maxWidth: 360
  }

  return (
    <div className="translation-popup" style={popupStyle}>
      <div className="popup-header">
        <span className="popup-title">{TITLE_BY_MODE[state.mode]}</span>
        <button
          type="button"
          className="popup-close"
          onClick={() => setState({ kind: 'idle' })}
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <div className="popup-source">{state.sourceText}</div>
      <div className="popup-divider" />
      {state.kind === 'loading' && (
        <div className="popup-loading">{LOADING_BY_MODE[state.mode]}</div>
      )}
      {state.kind === 'result' && (
        <>
          <div className="popup-translated">{state.translatedText}</div>
          <div className="popup-meta">
            {state.fromCache ? (
              <span className="popup-cache-badge">✓ 캐시</span>
            ) : null}
            {state.modelUsed} · {state.inputTokens}+{state.outputTokens} tok · $
            {state.estimatedCostUsd.toFixed(6)} · {state.durationMs}ms
          </div>
        </>
      )}
      {state.kind === 'blocked' && <div className="popup-blocked">차단: {state.reason}</div>}
      {state.kind === 'error' && <div className="popup-error">오류: {state.reason}</div>}
    </div>
  )
}
