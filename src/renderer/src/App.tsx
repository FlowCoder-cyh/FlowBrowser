import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import Consent from './onboarding/Consent'
import SettingsPage from './settings/SettingsPage'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')

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
      <UrlBar onOpenSettings={() => setStage('settings')} />
    </div>
  )
}
