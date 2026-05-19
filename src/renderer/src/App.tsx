// Sprint 015 M2-6 — TranslationPanel 완전 제거 (render/restore IPC 폐기 동반).
// Sprint 015 M5-1 — SearchBar 는 UrlBar 내부 flex item 으로 렌더 (PRD §7.4.3 상단 우측 240px).
// Sprint 015 M5-8 — ChatPanel 신규 mount (TranslationPanel 자리 결합 — panelOpen toggle).
// Sprint 015 M6 T28 — WorkspaceSidebar mount (좌측 240px). 전환 시 ChatPanel + 검색 결과 캐시 무효화 트리거.
import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import TabBar from './TabBar'
import Consent from './onboarding/Consent'
import OnboardingTour from './onboarding/OnboardingTour'
import SettingsPage from './settings/SettingsPage'
import TranslationPopup from './translation/TranslationPopup'
import ChatPanel from './chat/ChatPanel'
import WorkspaceSidebar from './workspace/WorkspaceSidebar'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  // Sprint 015 M6 T28 — 워크스페이스 전환 시 ChatPanel / 검색 결과 캐시 무효화 트리거 (key 재마운트).
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  // 핫픽스 (codex NEEDS_CHANGES #3) — ChatPanel race 방지: 활성 workspace id 명시 전달.
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  async function togglePanel(): Promise<void> {
    const next = !panelOpen
    setPanelOpen(next)
    // main process WebContentsView setBounds 동기화 (panel 자리 확보)
    await window.browserApi.setPanelOpen(next)
  }

  function handleWorkspaceChanged(id: string): void {
    // PRD §11.3.1 broadcast — ChatPanel / NotePanel / SearchBar 결과 무효화.
    // 본 PR 은 ChatPanel 만 새 workspace_id 로 history 재로드 (key 재마운트 + workspaceId prop).
    setActiveWorkspaceId(id)
    setWorkspaceVersion((v) => v + 1)
  }

  /**
   * 핫픽스 (codex BLOCKING #1) — Workspace modal open 시 WebContentsView native layer 가
   * renderer DOM modal 을 가려 클릭 가로채기. browser stage 일 때만 view 가시성 토글.
   */
  function handleWorkspaceModalToggle(open: boolean): void {
    if (stage !== 'browser') return
    void window.browserApi.setViewVisible(!open && !showOnboarding)
  }

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
    <div className="app app--with-sidebar">
      <WorkspaceSidebar
        onActiveChanged={handleWorkspaceChanged}
        onModalToggle={handleWorkspaceModalToggle}
      />
      <div className="app__main">
        <TabBar />
        <UrlBar
          onOpenSettings={() => setStage('settings')}
          panelOpen={panelOpen}
          onTogglePanel={() => void togglePanel()}
        />
        <TranslationPopup />
        {/* Sprint 015 M5-8 — ChatPanel mount (TranslationPanel 자리 결합, panelOpen toggle).
            Sprint 015 M6 T28 — workspaceVersion key 로 워크스페이스 전환 시 history 재로드 강제. */}
        {panelOpen && (
          <div className="side-panel side-panel--chat">
            <ChatPanel
              key={`chat-${workspaceVersion}`}
              workspaceId={activeWorkspaceId}
            />
          </div>
        )}
      </div>
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
