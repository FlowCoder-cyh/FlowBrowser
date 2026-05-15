/**
 * Sprint 014 M2 — Codex Login (Experimental) UI.
 *
 * Spike 1 조건 1: Experimental 라벨 + OpenAI 차단 가능성 고지
 * 흐름: 로그인 버튼 → user_code 카드 표시 → 폴링 진행 → 성공/만료/거부 분기
 */
import { useEffect, useRef, useState } from 'react'

type Stage = 'idle' | 'waiting' | 'success' | 'error' | 'denied' | 'expired'

interface UserCodeState {
  userCode: string
  verificationUrl: string
  startedAt: number
}

const POLL_STATUS_INTERVAL_MS = 2000

export default function CodexLoginPanel(): JSX.Element {
  const [stage, setStage] = useState<Stage>('idle')
  const [accountStatus, setAccountStatus] = useState<'active' | 'expired' | 'none'>('none')
  const [userCode, setUserCode] = useState<UserCodeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refreshStatus()
    return () => {
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current)
    }
  }, [])

  async function refreshStatus(): Promise<void> {
    const s = await window.codexApi.status()
    setAccountStatus(s)
  }

  function clearPolling(): void {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  function schedulePollStatus(): void {
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const result = await window.codexApi.pollStatus()
        if (result.status === 'pending') {
          schedulePollStatus()
          return
        }
        if (result.status === 'success') {
          setStage('success')
          setUserCode(null)
          await refreshStatus()
          return
        }
        if (result.status === 'expired') {
          setStage('expired')
          setUserCode(null)
          return
        }
        if (result.status === 'denied') {
          setStage('denied')
          setUserCode(null)
          return
        }
        // error
        setStage('error')
        setError(result.errorReason ?? '알 수 없는 오류')
        setUserCode(null)
      } catch (err) {
        setStage('error')
        setError(err instanceof Error ? err.message : String(err))
      }
    }, POLL_STATUS_INTERVAL_MS)
  }

  async function handleStartLogin(): Promise<void> {
    clearPolling()
    setError(null)
    setStage('waiting')
    try {
      const uc = await window.codexApi.startLogin()
      setUserCode({
        userCode: uc.userCode,
        verificationUrl: uc.verificationUrl,
        startedAt: Date.now()
      })
      schedulePollStatus()
    } catch (err) {
      setStage('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCancel(): Promise<void> {
    clearPolling()
    await window.codexApi.cancelLogin()
    setStage('idle')
    setUserCode(null)
  }

  async function handleLogout(): Promise<void> {
    clearPolling()
    await window.codexApi.logout()
    setStage('idle')
    setUserCode(null)
    await refreshStatus()
  }

  async function handleCopy(): Promise<void> {
    if (!userCode) return
    try {
      await navigator.clipboard.writeText(userCode.userCode)
    } catch {
      // clipboard 권한 없음 — 무시
    }
  }

  return (
    <section className="settings-section codex-login">
      <h2 className="settings-title">
        Codex Login{' '}
        <span className="codex-experimental-badge">Experimental</span>
      </h2>
      <p className="settings-muted">
        ChatGPT 구독 계정으로 로그인하여 번역/요약을 사용할 수 있습니다 (별도 API Key 비용 없음).
      </p>
      <p className="settings-muted codex-experimental-warning">
        ⚠️ OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드입니다. OpenAI가 차단할 가능성이 있으며,
        그 경우 자동으로 OpenAI API Key 모드로 폴백됩니다.
      </p>

      {accountStatus === 'active' && (
        <div className="codex-status active">
          <span>현재 Codex Login 활성</span>
          <button type="button" className="settings-btn-link" onClick={() => void handleLogout()}>
            로그아웃
          </button>
        </div>
      )}

      {accountStatus === 'expired' && (
        <div className="codex-status expired">
          토큰이 만료되었습니다. 다시 로그인해 주세요.
        </div>
      )}

      {stage === 'idle' && accountStatus !== 'active' && (
        <button
          type="button"
          className="settings-btn primary"
          onClick={() => void handleStartLogin()}
        >
          Codex Login 시작
        </button>
      )}

      {stage === 'waiting' && userCode && (
        <div className="codex-usercode-card">
          <p className="codex-step">
            1. 브라우저에서{' '}
            <a href={userCode.verificationUrl} target="_blank" rel="noopener noreferrer">
              {userCode.verificationUrl}
            </a>{' '}
            을 엽니다.
          </p>
          <p className="codex-step">2. 아래 코드를 입력합니다 (15분 내):</p>
          <div className="codex-usercode-display">
            <code className="codex-usercode-text">{userCode.userCode}</code>
            <button type="button" className="settings-btn" onClick={() => void handleCopy()}>
              복사
            </button>
          </div>
          <p className="settings-muted codex-step-note">
            ⚠️ Device code는 피싱 표적이 되기 쉽습니다. 절대 코드를 다른 사람에게 공유하지 마세요.
          </p>
          <p className="codex-step">3. 로그인 완료까지 자동으로 확인합니다…</p>
          <button type="button" className="settings-btn-link" onClick={() => void handleCancel()}>
            취소
          </button>
        </div>
      )}

      {stage === 'success' && (
        <div className="codex-status success">
          ✅ Codex Login 완료. 이제 번역/요약에 사용할 수 있습니다.
        </div>
      )}

      {stage === 'expired' && (
        <div className="codex-status error">
          ⏱️ 15분이 지나 인증이 만료되었습니다.
          <button
            type="button"
            className="settings-btn"
            onClick={() => void handleStartLogin()}
          >
            다시 시도
          </button>
        </div>
      )}

      {stage === 'denied' && (
        <div className="codex-status error">
          🚫 인증이 거부되었습니다.
          <button
            type="button"
            className="settings-btn"
            onClick={() => void handleStartLogin()}
          >
            다시 시도
          </button>
        </div>
      )}

      {stage === 'error' && (
        <div className="codex-status error">
          ❌ 오류: {error ?? '알 수 없음'}
          <button
            type="button"
            className="settings-btn"
            onClick={() => void handleStartLogin()}
          >
            다시 시도
          </button>
        </div>
      )}
    </section>
  )
}
