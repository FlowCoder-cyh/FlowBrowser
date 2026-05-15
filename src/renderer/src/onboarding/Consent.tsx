import { useState } from 'react'

interface Props {
  onAgreed: () => void
}

export default function Consent({ onAgreed }: Props): JSX.Element {
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleAgree(): Promise<void> {
    if (!agreed || submitting) return
    setSubmitting(true)
    try {
      await window.consentApi.give()
      onAgreed()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="consent">
      <div className="consent-card">
        <h1 className="consent-title">FlowBrowser AI 첫 실행</h1>
        <p className="consent-subtitle">
          영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저.
        </p>

        <h2 className="consent-section">데이터 처리 안내</h2>
        <ul className="consent-list">
          <li>사용자가 명시 요청한 텍스트만 외부 AI Provider로 전송됩니다.</li>
          <li>
            <strong>다음 페이지는 자동 전송 차단</strong>되며 명시 승인 시에만 1회 전송됩니다:
            <br />
            <span className="consent-muted">
              로그인 폼이 있는 페이지, 결제/카드 입력 페이지, 메일/은행/계정/oauth 관련 도메인.
            </span>
          </li>
          <li>API Key 등 자격증명은 OS Keychain에 위임 저장되며 앱은 평문으로 보관하지 않습니다.</li>
          <li>모든 외부 전송은 로컬 감사 로그에 기록됩니다 (설정에서 확인/삭제 가능).</li>
          <li>본 동의는 언제든 설정에서 철회할 수 있습니다.</li>
        </ul>

        <h2 className="consent-section">Provider 정책</h2>
        <ul className="consent-list">
          <li>
            기본 Provider: OpenAI API Key (BYOK). 사용자가 본인 키를 등록합니다.
          </li>
          <li>
            Codex Login Provider는 향후 추가 예정이며, OpenAI 공식 등록 부재로 Experimental 라벨 표기됩니다.
          </li>
          <li>
            본 앱은 ChatGPT 웹 쿠키, 비공식 토큰 추출, 사용량 우회를 절대 사용하지 않습니다.
          </li>
        </ul>

        <label className="consent-checkbox" htmlFor="consent-agree-input">
          <input
            id="consent-agree-input"
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            onClick={(e) => {
              // Sprint 014 M3-1 핫픽스 — onChange가 일부 Electron 환경에서 미발화되는 케이스 보정
              const next = (e.target as HTMLInputElement).checked
              setAgreed(next)
            }}
          />
          <span
            onClick={() => setAgreed((prev) => !prev)}
            style={{ cursor: 'pointer' }}
          >
            위 안내를 읽고 데이터 처리 / AI 전송에 동의합니다.
          </span>
        </label>

        <button
          type="button"
          className="consent-agree"
          disabled={!agreed || submitting}
          onClick={() => void handleAgree()}
        >
          {submitting ? '저장 중…' : '동의하고 시작'}
        </button>

        <p className="consent-foot">
          동의하지 않으면 AI 기능이 비활성화되며 일반 브라우저로만 사용 가능합니다.
        </p>
      </div>
    </div>
  )
}
