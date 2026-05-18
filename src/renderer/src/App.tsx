// Sprint 015 M2-6 — TranslationPanel 완전 제거 (render/restore IPC 폐기 동반). M5 ChatPanel 신규 시 동일 자리 도입.
// Sprint 015 M5-1 — SearchBar 는 UrlBar 내부 flex item 으로 렌더 (PRD §7.4.3 상단 우측 240px).
import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import TabBar from './TabBar'
import Consent from './onboarding/Consent'
import OnboardingTour from './onboarding/OnboardingTour'
import SettingsPage from './settings/SettingsPage'
import TranslationPopup from './translation/TranslationPopup'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sprint 014 M3-2/3 핫픽스 — stage + OnboardingTour 가시성에 따라 WebContentsView 표시 제어
  // WebContentsView는 Electron native layer라 renderer DOM z-index로 가릴 수 없음.
  // browser stage이면서 OnboardingTour가 닫혀 있을 때만 view 노출.
  useEffect(() => {
    if (stage === 'loading') return
    const shouldShow = stage === 'browser' && !showOnboarding
    void window.browserApi.setViewVisible(shouldShow)
  }, [stage, showOnboarding])

  async function boot(): Promise<void> {
    const state = await window.consentApi.get()
    if (!state.globalConsented) {
      setStage('consent')
      return
    }
    setStage('browser')
    await maybeShowOnboarding()
  }

  async function maybeShowOnboarding(): Promise<void> {
    try {
      const setting = await window.userSettingApi.get()
      if ((setting as { onboardingShown?: boolean }).onboardingShown === true) {
        setShowOnboarding(false)
        return
      }
      setShowOnboarding(true)
    } catch {
      // setting 조회 실패는 표시 안 함 (안전)
    }
  }

  async function handleConsentDone(): Promise<void> {
    setStage('browser')
    await maybeShowOnboarding()
  }

  function handleOnboardingDismiss(): void {
    setShowOnboarding(false)
  }

  function handleOnboardingOpenSettings(): void {
    setShowOnboarding(false)
    setStage('settings')
  }

  function handleOnboardingNavigate(url: string): void {
    void window.browserApi.navigate(url)
  }

  if (stage === 'loading') {
    return <div className="loading">FlowBrowser AI</div>
  }

  if (stage === 'consent') {
    return <Consent onAgreed={() => void handleConsentDone()} />
  }

  if (stage === 'settings') {
    return <SettingsPage onClose={() => setStage('browser')} />
  }

  return (
    <div className="app">
      <TabBar />
      <UrlBar onOpenSettings={() => setStage('settings')} />
      <TranslationPopup />
      {/* Sprint 015 M2-6 — TranslationPanel 제거. M5 ChatPanel 도입 시 동일 자리 추가. */}
      {showOnboarding && (
        <OnboardingTour
          onOpenSettings={handleOnboardingOpenSettings}
          onDismiss={handleOnboardingDismiss}
          onNavigate={handleOnboardingNavigate}
        />
      )}
    </div>
  )
}
