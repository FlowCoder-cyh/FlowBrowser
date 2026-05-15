/**
 * Sprint 014 M3 — OnboardingTour.
 *
 * 첫 실행 (Consent 동의 후) + Provider 미설정 + onboardingShown=false 일 때 표시.
 * - "Codex Login으로 시작" / "OpenAI API Key로 시작" 두 카드
 * - 추천 URL 3개 (영문 위키 / Hacker News / arXiv)
 * - "다시 보지 않기" → UserSetting.onboardingShown=true
 */
import { useEffect, useState } from 'react'

interface Props {
  onOpenSettings: () => void
  onDismiss: () => void
  onNavigate: (url: string) => void
}

interface RecommendedUrl {
  url: string
  label: string
  description: string
}

const RECOMMENDED_URLS: RecommendedUrl[] = [
  {
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    label: '위키피디아: Artificial Intelligence',
    description: '백과사전 문단 번역 시연용'
  },
  {
    url: 'https://news.ycombinator.com/news',
    label: 'Hacker News',
    description: '뉴스 / 토론 페이지 번역 시연용'
  },
  {
    url: 'https://arxiv.org/abs/1706.03762',
    label: 'arXiv: Attention Is All You Need',
    description: '학술 논문 페이지 전체 번역 / 요약 시연용'
  }
]

export default function OnboardingTour({
  onOpenSettings,
  onDismiss,
  onNavigate
}: Props): JSX.Element {
  const [neverShow, setNeverShow] = useState(false)
  const [hasProvider, setHasProvider] = useState(false)

  useEffect(() => {
    void checkProvider()
  }, [])

  async function checkProvider(): Promise<void> {
    const list = await window.credentialApi.list()
    setHasProvider(list.some((c) => c.status === 'active'))
  }

  async function handleDismiss(): Promise<void> {
    if (neverShow) {
      await window.userSettingApi.update({ onboardingShown: true })
    }
    onDismiss()
  }

  function handleNavigate(url: string): void {
    onNavigate(url)
    void handleDismiss()
  }

  return (
    <div className="onboarding-tour">
      <div className="onboarding-card">
        <h1 className="onboarding-title">FlowBrowser AI 시작하기</h1>
        <p className="onboarding-subtitle">
          영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저
        </p>

        {!hasProvider && (
          <section className="onboarding-section">
            <h2 className="onboarding-section-title">1. Provider 등록</h2>
            <p className="onboarding-muted">
              번역/요약 기능을 사용하려면 AI Provider 등록이 필요합니다. 두 가지 방식 중 선택하세요.
            </p>
            <div className="onboarding-provider-grid">
              <div className="onboarding-provider-card recommended">
                <h3>Codex Login</h3>
                <span className="onboarding-badge">추천 (Experimental)</span>
                <p>
                  ChatGPT 구독 계정으로 로그인. 별도 API Key 비용 없이 사용 가능.
                </p>
                <button
                  type="button"
                  className="onboarding-btn primary"
                  onClick={onOpenSettings}
                >
                  Codex로 로그인
                </button>
              </div>
              <div className="onboarding-provider-card">
                <h3>OpenAI API Key</h3>
                <p>
                  OpenAI 콘솔에서 발급한 API Key. 사용량 별 청구. OS Keychain에 안전 저장.
                </p>
                <button type="button" className="onboarding-btn" onClick={onOpenSettings}>
                  API Key 등록
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="onboarding-section">
          <h2 className="onboarding-section-title">
            {hasProvider ? '시작' : '2.'} 추천 페이지로 체험
          </h2>
          <p className="onboarding-muted">
            아래 URL을 클릭하면 새 탭이 해당 페이지로 이동합니다. 텍스트를 드래그하여 선택 번역,
            우측 패널 열어 페이지 전체 번역 / 요약을 시연해 볼 수 있습니다.
          </p>
          <ul className="onboarding-url-list">
            {RECOMMENDED_URLS.map((r) => (
              <li key={r.url} className="onboarding-url-item">
                <button
                  type="button"
                  className="onboarding-url-button"
                  onClick={() => handleNavigate(r.url)}
                >
                  <span className="onboarding-url-label">{r.label}</span>
                  <span className="onboarding-url-desc">{r.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="onboarding-footer">
          <label className="onboarding-checkbox">
            <input
              type="checkbox"
              checked={neverShow}
              onChange={(e) => setNeverShow(e.target.checked)}
            />
            다시 보지 않기
          </label>
          <button
            type="button"
            className="onboarding-btn"
            onClick={() => void handleDismiss()}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
