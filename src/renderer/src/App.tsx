import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import TabBar from './TabBar'
import Consent from './onboarding/Consent'
import OnboardingTour from './onboarding/OnboardingTour'
import SettingsPage from './settings/SettingsPage'
import TranslationPopup from './translation/TranslationPopup'
import TranslationPanel from './translation/TranslationPanel'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [panelOpen, setPanelOpenState] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  function setPanelOpen(next: boolean | ((p: boolean) => boolean)): void {
    setPanelOpenState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      void window.browserApi.setPanelOpen(value)
      return value
    })
  }

  useEffect(() => {
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <UrlBar
        onOpenSettings={() => setStage('settings')}
        onTogglePanel={() => setPanelOpen((x) => !x)}
        panelOpen={panelOpen}
      />
      <TranslationPopup />
      <TranslationPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
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
