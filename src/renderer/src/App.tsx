import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import Consent from './onboarding/Consent'
import SettingsPage from './settings/SettingsPage'
import TranslationPopup from './translation/TranslationPopup'
import TranslationPanel from './translation/TranslationPanel'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [panelOpen, setPanelOpenState] = useState(false)

  function setPanelOpen(next: boolean | ((p: boolean) => boolean)): void {
    setPanelOpenState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      void window.browserApi.setPanelOpen(value)
      return value
    })
  }

  useEffect(() => {
    void boot()
  }, [])

  async function boot(): Promise<void> {
    const state = await window.consentApi.get()
    setStage(state.globalConsented ? 'browser' : 'consent')
  }

  if (stage === 'loading') {
    return <div className="loading">FlowBrowser AI</div>
  }

  if (stage === 'consent') {
    return <Consent onAgreed={() => setStage('browser')} />
  }

  if (stage === 'settings') {
    return <SettingsPage onClose={() => setStage('browser')} />
  }

  return (
    <div className="app">
      <UrlBar
        onOpenSettings={() => setStage('settings')}
        onTogglePanel={() => setPanelOpen((x) => !x)}
        panelOpen={panelOpen}
      />
      <TranslationPopup />
      <TranslationPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
