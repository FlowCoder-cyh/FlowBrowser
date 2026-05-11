import { useEffect, useState } from 'react'

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; sourceText: string; anchor: { x: number; y: number } }
  | {
      kind: 'result'
      sourceText: string
      anchor: { x: number; y: number }
      translatedText: string
      modelUsed: string
      inputTokens: number
      outputTokens: number
      estimatedCostUsd: number
      durationMs: number
    }
  | {
      kind: 'blocked'
      sourceText: string
      anchor: { x: number; y: number }
      reason: string
    }
  | {
      kind: 'error'
      sourceText: string
      anchor: { x: number; y: number }
      reason: string
    }

export default function TranslationPopup(): JSX.Element | null {
  const [state, setState] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    const offShow = window.popupApi.onShow((payload) => {
      setState({
        kind: 'loading',
        sourceText: payload.sourceText,
        anchor: { x: payload.anchorX, y: payload.anchorY }
      })
    })
    const offResult = window.popupApi.onResult((payload) => {
      setState((prev) => {
        if (prev.kind !== 'loading') return prev
        if (payload.ok && payload.output) {
          return {
            kind: 'result',
            sourceText: prev.sourceText,
            anchor: prev.anchor,
            translatedText: payload.output.translatedText,
            modelUsed: payload.output.modelUsed,
            inputTokens: payload.output.inputTokens,
            outputTokens: payload.output.outputTokens,
            estimatedCostUsd: payload.output.estimatedCostUsd,
            durationMs: payload.output.durationMs
          }
        }
        if (payload.decision === 'blocked') {
          return {
            kind: 'blocked',
            sourceText: prev.sourceText,
            anchor: prev.anchor,
            reason: payload.reason ?? '차단되었습니다.'
          }
        }
        return {
          kind: 'error',
          sourceText: prev.sourceText,
          anchor: prev.anchor,
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
        <span className="popup-title">번역</span>
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
      {state.kind === 'loading' && <div className="popup-loading">번역 중…</div>}
      {state.kind === 'result' && (
        <>
          <div className="popup-translated">{state.translatedText}</div>
          <div className="popup-meta">
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
