// Sprint 015 M2-6 — TranslationPanel 완전 제거 (render/restore IPC 폐기 동반).
// Sprint 015 M5-1 — SearchBar 는 UrlBar 내부 flex item 으로 렌더 (PRD §7.4.3 상단 우측 240px).
// Sprint 015 M5-8 — ChatPanel 신규 mount (TranslationPanel 자리 결합 — panelOpen toggle).
// Sprint 015 M6 T28 — WorkspaceSidebar mount (좌측 240px). 전환 시 ChatPanel + 검색 결과 캐시 무효화 트리거.
// Sprint 017 M1 T08 — NoteHighlight mount (Chat/Notes 탭 형식, panelOpen 공유) + ToastHost 전역 mount + browser:navigated url state 구독.
import { useEffect, useState } from 'react'
import UrlBar from './UrlBar'
import TabBar from './TabBar'
import Consent from './onboarding/Consent'
import OnboardingTour from './onboarding/OnboardingTour'
import SettingsPage from './settings/SettingsPage'
import TranslationPopup from './translation/TranslationPopup'
import ChatPanel from './chat/ChatPanel'
import WorkspaceSidebar from './workspace/WorkspaceSidebar'
import MemoryStatsPanel from './memory/MemoryStatsPanel'
import NoteHighlight from './note/NoteHighlight'
import ToastHost, { pushToast } from './common/ToastHost'

type Stage = 'loading' | 'consent' | 'browser' | 'settings'
type SidePanelTab = 'chat' | 'notes'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  // Sprint 015 M6 T28 — 워크스페이스 전환 시 ChatPanel / 검색 결과 캐시 무효화 트리거 (key 재마운트).
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  // 핫픽스 (codex NEEDS_CHANGES #3) — ChatPanel race 방지: 활성 workspace id 명시 전달.
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  // Sprint 017 M1 T08 — Chat/Notes 탭 + 활성 페이지 URL state (NoteHighlight listByPage 입력).
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>('chat')
  const [activeUrl, setActiveUrl] = useState<string | null>(null)

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

  // Sprint 017 M1 T08 — browser:navigated 구독해서 활성 페이지 URL 추적. NoteHighlight 의 listByPage 입력.
  //   초기 url 은 boot 단계에서 getCurrentUrl 로 1회 fetch + 그 후 onNavigated 로 갱신.
  useEffect(() => {
    if (stage !== 'browser') return
    void (async () => {
      try {
        const u = await window.browserApi.getCurrentUrl()
        setActiveUrl(u || null)
      } catch {
        setActiveUrl(null)
      }
    })()
    const unsubscribe = window.browserApi.onNavigated((payload) => {
      setActiveUrl(payload.url || null)
    })
    return () => unsubscribe()
  }, [stage])

  // Sprint 017 M1 T08 (codex 019e4ec8 #4, KI-024 graceful) — main 측 highlight:toast broadcast 구독.
  //   handleContextMenuHighlight 의 unsupported_selection / no_selection / serialize_failed 시 사용자 알림.
  useEffect(() => {
    if (stage !== 'browser') return
    const unsubscribe = window.highlightApi.onToast((payload) => {
      pushToast({ kind: payload.kind, message: payload.message })
    })
    return () => unsubscribe()
  }, [stage])

  async function boot(): Promise<void> {
    const state = await window.consentApi.get()
    if (!state.globalConsented) {
      setStage('consent')
      return
    }
    setStage('browser')
    // T29 — 첫 부팅 시 활성 워크스페이스 id 초기화 (MemoryStatsPanel + ChatPanel workspaceId prop 정합)
    try {
      const current = await window.workspaceApi.getCurrent()
      if (current) setActiveWorkspaceId(current.id)
    } catch {
      // 인프라 부재 — null 유지
    }
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
        footer={<MemoryStatsPanel workspaceId={activeWorkspaceId} />}
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
            Sprint 015 M6 T28 — workspaceVersion key 로 워크스페이스 전환 시 history 재로드 강제.
            Sprint 017 M1 T08 — Chat/Notes 탭 토글 추가 (codex 019e4ec8 #1) — panelOpen 공유, 화면 너비 부담 회피. */}
        {panelOpen && (
          <div className="side-panel side-panel--chat">
            <div className="side-panel__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sidePanelTab === 'chat'}
                className={`side-panel__tab${sidePanelTab === 'chat' ? ' side-panel__tab--active' : ''}`}
                onClick={() => setSidePanelTab('chat')}
              >
                채팅
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidePanelTab === 'notes'}
                className={`side-panel__tab${sidePanelTab === 'notes' ? ' side-panel__tab--active' : ''}`}
                onClick={() => setSidePanelTab('notes')}
              >
                하이라이트
              </button>
            </div>
            <div className="side-panel__body">
              {sidePanelTab === 'chat' && (
                <ChatPanel
                  key={`chat-${workspaceVersion}`}
                  workspaceId={activeWorkspaceId}
                />
              )}
              {sidePanelTab === 'notes' && (
                <NoteHighlight
                  key={`notes-${workspaceVersion}`}
                  workspaceId={activeWorkspaceId}
                  url={activeUrl}
                />
              )}
            </div>
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
      {/* Sprint 017 M1 T08 — 전역 ToastHost mount. NoteHighlight 패널 닫혀 있어도 표시. */}
      <ToastHost />
    </div>
  )
}
