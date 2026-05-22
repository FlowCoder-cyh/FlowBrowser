import { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain } from 'electron'
import { join } from 'node:path'
// Sprint 015 M2-5/M2-6 — legacy page-translation / render-restore imports 제거. services dead export 는 M2-8 cleanup 위임 (PRD §19.5.1).
import {
  initServices,
  rebuildAllProviders,
  reconcileWorkspacePartitions,
  WebContentsRegistry,
  executeTranslateRequest,
  scanWebContentsFields,
  loadTabState,
  saveTabState,
  getShortcutBindings,
  getActiveWorkspaceId,
  getWorkspacePartitionName,
  setWorkspaceSwitchHook,
  setActiveWebContentsGetter,
  setWorkspaceDeleteHook,
  tryIndexPage,
  getParagraphsExtractScript,
  getHighlightStore,
  getNoteServiceForHighlight,
  broadcastMemoryInvalidatedExternal
} from './services'
// Sprint 017 M1 T06 — selection 캡처 (page context inject) + did-finish-load 복원 trigger.
import { runHighlightRestore } from './highlightRestore'
// Sprint 017 M2 T10 (KI-020) — SPA `did-navigate-in-page` 자동 인덱싱 debounce scheduler.
import {
  createSpaNavScheduler,
  urlPathAndSearch,
  isHashOnlyNavigation
} from './spaNavIndexingScheduler'
import {
  buildSerializeScript,
  type SerializeResult
} from '../perception/highlightInjectionScript'
import { handleHighlightCreate } from './highlightHandlers'
import { buildTabWebPreferences } from './tabViewWebPreferences'
import { inputMatchesAccelerator } from './ShortcutMatcher'
import { TabManager, TAB_COLOR_PALETTE, type TabColor, type TabSession } from './TabManager'
import { ThumbnailStore, type ThumbnailEntry } from './ThumbnailStore'
import { ThumbnailDiskStore, defaultThumbnailsPath } from './ThumbnailDiskStore'
import { ClosedTabHistory } from './ClosedTabHistory'

let mainWindow: BrowserWindow | null = null
const tabManager = new TabManager()
const tabViews = new Map<string, WebContentsView>()
// Sprint 017 M2 T10 — SPA did-navigate-in-page 자동 인덱싱 debounce scheduler (KI-020).
// module-level (tab 별 timer 정리 책임 명확, codex 019e4f40 Q3 권고 정합).
const spaNavScheduler = createSpaNavScheduler()
// codex 019e4f51 BLOCKING #2 hotfix — hash-only navigation skip 비교용 직전 path 캐시.
// did-finish-load + SPA hook 양쪽에서 갱신. destroyTabView 에서 delete.
const lastSpaPathForTab = new Map<string, string>()
// Sprint 012 M1 — 탭 미리보기 (hover thumbnail) 메모리 LRU
const thumbnailStore = new ThumbnailStore(50)
const THUMBNAIL_RESIZE_WIDTH = 300
// Sprint 013 M2 — 디스크 영속 (debounced 500ms write-through)
let thumbnailDiskStore: ThumbnailDiskStore | null = null
let thumbnailSaveTimer: NodeJS.Timeout | null = null
const THUMBNAIL_SAVE_DEBOUNCE_MS = 500
// Sprint 013 M1 — 닫은 탭 히스토리 (Ctrl+Shift+T)
const closedTabHistory = new ClosedTabHistory(20)
// Sprint 008 M1 — 활성 탭 view 캐시. setActiveTabView/close에서 자동 갱신.
// 기존 단일 browserView 변수 호환 유지 (대부분의 IPC handler는 활성 탭 사용).
let browserView: WebContentsView | null = null

const URL_BAR_HEIGHT = 60
const TAB_BAR_HEIGHT = 36
const HEADER_HEIGHT = URL_BAR_HEIGHT + TAB_BAR_HEIGHT
// Sprint 015 M6 T28 — WorkspaceSidebar 좌측 240px 점유. WebContentsView 가 사이드바 위에 덮이지 않도록 x 오프셋.
const SIDEBAR_WIDTH = 240

function getActiveTabView(): WebContentsView | null {
  const id = tabManager.getActiveId()
  if (!id) return null
  return tabViews.get(id) ?? null
}

/**
 * Sprint 016 M0 T05 (KI-010) — `did-finish-load` 시점 자동 페이지 인덱싱.
 *
 * 흐름:
 *   1. tabManager.getById(tabId) — workspaceId / 활성 탭 여부 확인
 *   2. WebContents.getURL() — about:blank / 빈 url skip
 *   3. scanWebContentsFields — `<input type="password">` 감지 hint
 *   4. ParagraphExtractor executeJavaScript — 본문 추출
 *   5. tryIndexPage — IndexingGate 평가 후 통과 시 recordVisit + 임베딩 큐
 *
 * 실패 시 graceful no-op (executeJavaScript / scan / index 모두 try/catch). 사용자 UX 영향 없음 —
 * 다음 navigate 시점에 재시도.
 *
 * IndexingService 미초기화 (인프라 bootstrap 실패) 시 `tryIndexPage` 자체가 null 반환 — early exit.
 */
async function runPageIndexing(tabId: string, view: WebContentsView): Promise<void> {
  const wc = view.webContents
  if (wc.isDestroyed()) return
  const url = wc.getURL()
  if (!url) return
  // codex T05 NB-5 — http/https allowlist 선필터 (IndexingGate 가 결국 차단하나 본문 추출 비용 절약).
  // file: / blob: / javascript: / data: / chrome-error: / about: 등 인덱싱 대상 외 scheme 일괄 skip.
  if (!url.startsWith('http://') && !url.startsWith('https://')) return
  const tab = tabManager.snapshotAll().tabs.find((t) => t.id === tabId)
  const workspaceId = tab?.workspace_id ?? null
  const isActiveTab = tabManager.getActiveId() === tabId
  try {
    const fieldScan = await scanWebContentsFields(wc.id)
    // Sprint 017 M2 T10 — URL consistency guard (codex 019e4f40 MEDIUM).
    //   async scan 후 full navigation 시작되면 새 URL 을 stale DOM 으로 인덱싱하는 race 차단.
    if (wc.isDestroyed() || wc.getURL() !== url) return
    let content = ''
    try {
      const paragraphs = (await wc.executeJavaScript(getParagraphsExtractScript())) as Array<{
        text: string
      }>
      content = paragraphs.map((p) => p.text).join('\n\n')
    } catch {
      // 본문 추출 실패 시 빈 본문 — IndexingService 가 'empty_content' 로 임베딩 skip.
      content = ''
    }
    // paragraph extract 직후 한 번 더 URL guard — extract 가 가장 긴 async 단계.
    if (wc.isDestroyed() || wc.getURL() !== url) return
    const title = wc.getTitle()
    await tryIndexPage({
      url,
      title,
      content,
      hasPasswordField: fieldScan.hasPasswordField,
      workspaceId: workspaceId ?? undefined,
      isActiveTab
    })
  } catch {
    // graceful — 다음 did-finish-load 시점에 재시도.
  }
}

function syncBrowserViewRef(): void {
  browserView = getActiveTabView()
}

// Sprint 015 M2-5 — legacy page-translation abort flags removed.

// Sprint 009 M3 — 탭 상태 영속 (debounced 200ms)
let saveTimer: NodeJS.Timeout | null = null

function scheduleTabStateSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // Sprint 016 M0 T03c (KI-007) — 영속은 모든 워크스페이스 탭 전체 (필터 무시).
    // 그렇지 않으면 ws 전환 후 다른 ws 의 탭이 saveTabState 시점에 날아감.
    const snap = tabManager.snapshotAll()
    void saveTabState({
      tabs: snap.tabs,
      activeId: snap.activeId
    }).catch(() => {
      // 저장 실패는 로그만 (UX 영향 없음)
    })
    saveTimer = null
  }, 200)
}

async function initializeTabs(): Promise<void> {
  // Sprint 016 M0 T03c (KI-007) — initServices 후 호출되므로 활성 워크스페이스 id 사용 가능.
  const activeWsId = getActiveWorkspaceId()
  try {
    const persisted = await loadTabState()
    if (persisted.tabs.length > 0) {
      tabManager.restore({ tabs: persisted.tabs, activeId: persisted.activeId })
      // V1 마이그레이션 직후 workspace_id null 인 탭들을 active ws 로 backfill.
      if (activeWsId) tabManager.backfillUnassignedWorkspaceId(activeWsId)
      // Sprint 016 M3 T15 — backfill 완료 후 tabManager 의 갱신된 workspace_id 기준으로 view 생성.
      // codex 협의: stale persisted.tabs 원본이 아닌 snapshotAll() 의 현재 metadata 사용.
      const restored = tabManager.snapshotAll().tabs
      for (const t of restored) {
        createTabView(t.id, t.url, t.workspace_id ?? activeWsId)
      }
      // 활성 ws 필터 적용 (시각 격리).
      if (activeWsId) tabManager.setActiveWorkspaceFilter(activeWsId)
      const active = tabManager.getActiveId()
      if (active) setActiveTabView(active)
      return
    }
  } catch {
    // ignore - fallthrough
  }
  // 복원 실패 또는 빈 상태 → 첫 탭 신규 생성 (활성 ws 메타 박힘).
  const firstTab = tabManager.open('about:blank', { workspaceId: activeWsId })
  createTabView(firstTab.id, firstTab.url, activeWsId)
  if (activeWsId) tabManager.setActiveWorkspaceFilter(activeWsId)
  setActiveTabView(firstTab.id)
}

interface NavigateResult {
  ok: boolean
  url?: string
  error?: string
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'FlowBrowser AI',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Sprint 015 M5-1 — main window 자체에도 단축키 캡처 (renderer 포커스 시 동작).
  // WebContentsView 내부 캡처는 createTabView 에서 별도 등록.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow) return
    const bindings = getShortcutBindings()
    for (const binding of bindings) {
      if (inputMatchesAccelerator(input, binding.accelerator, process.platform)) {
        event.preventDefault()
        mainWindow.webContents.send('shortcut:invoke', binding.id)
        return
      }
    }
  })

  // TabManager 변동 broadcast (TabBar / UrlBar 구독) — initializeTabs 이전에 등록해야
  // 복원 emit이 push 경로로도 도달함 (renderer가 mount 직후 받음).
  tabManager.subscribe((snapshot) => {
    if (!mainWindow) return
    mainWindow.webContents.send('tab:list-update', snapshot)
    scheduleTabStateSave()
  })

  // Sprint 016 M0 T03c (KI-007) — 워크스페이스 전환 직후 후속 wiring 등록.
  // workspaceHandlers.handleWorkspaceSwitch 성공 시 services.ts 가 본 hook 호출 → TabManager
  // 필터 + active BrowserView refresh + workspace:switched broadcast.
  setWorkspaceSwitchHook((workspaceId) => {
    tabManager.setActiveWorkspaceFilter(workspaceId)
    // setActiveWorkspaceFilter 가 emit 1회 → subscribe 콜백이 tab:list-update broadcast.
    // activeId 가 갱신됐다면 setActiveTabView refresh.
    const active = tabManager.getActiveId()
    if (active) setActiveTabView(active)
    // renderer 측에 워크스페이스 전환 신호 (TabBar / WorkspaceSidebar 가 활성 ws state 갱신).
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:switched', { workspaceId })
    }
  })

  // Sprint 017 M1 T08 — `highlight:remove` / `highlight:scroll-to` IPC 가 호출하는 active WebContents getter.
  //   tabManager 가 main/index.ts 안에 있어 services.ts 에서 직접 접근 불가 → hook 패턴 (workspaceSwitchHook 와 동일).
  //   getActiveTabView 의 WebContents 노출. 미존재 시 null → services.ts IPC handler graceful no-op.
  setActiveWebContentsGetter(() => {
    const view = getActiveTabView()
    return view?.webContents ?? null
  })

  // Sprint 016 M3 T16 (G-015, codex BLOCKING #1) — 워크스페이스 삭제 직후 live 탭/view cleanup.
  // workspaceHandlers.handleWorkspaceDelete 가 svc.delete() 성공 후 partition cleanup 직전에 호출.
  //
  // 순서:
  //   1. 삭제된 ws id 에 속한 모든 탭 close + destroyTabView (살아있는 WebContents 가 partition.clearStorageData
  //      직후 storage 재생성하는 위험 차단)
  //   2. setActiveWorkspaceFilter(newActiveId) — 탭 필터 + activeId 갱신
  //   3. 활성 탭이 없으면 새 빈 탭 자동 생성 (newActiveId 메타 + partition 박음)
  //   4. workspace:switched broadcast — renderer 측 WorkspaceSidebar / TabBar 갱신
  setWorkspaceDeleteHook((deletedWsId, newActiveId) => {
    // 1. 삭제된 ws 의 모든 탭 destroy (필터 무시 — snapshotAll)
    const deletedTabs = tabManager
      .snapshotAll()
      .tabs.filter((t) => t.workspace_id === deletedWsId)
    for (const t of deletedTabs) {
      tabManager.close(t.id)
      destroyTabView(t.id)
    }
    // 2. active filter 갱신 (newActiveId) — TabManager 가 stash/restore 처리
    tabManager.setActiveWorkspaceFilter(newActiveId)
    // 3. 새 ws 에 탭이 없으면 새 빈 탭 자동 생성 (partition 박힘)
    let active = tabManager.getActiveId()
    if (!active) {
      const fresh = tabManager.open('about:blank', { workspaceId: newActiveId })
      createTabView(fresh.id, fresh.url, newActiveId)
      active = fresh.id
    }
    setActiveTabView(active)
    // 4. broadcast workspace:switched — renderer 갱신
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:switched', { workspaceId: newActiveId })
    }
  })

  // Sprint 009 M3 — TabStateStore에서 복원 시도, 없으면 첫 탭 자동 생성.
  await initializeTabs()

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('close', () => {
    // Sprint 009 M3 — 종료 시 탭 상태 강제 flush (debounce 누락 방지)
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    // Sprint 016 M0 T03c (KI-007) — 모든 ws 탭 영속 (필터 무시).
    const snap = tabManager.snapshotAll()
    void saveTabState({ tabs: snap.tabs, activeId: snap.activeId }).catch(() => {
      // ignore — 종료 중 IO 오류
    })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    // 탭 view 정리
    for (const view of tabViews.values()) {
      try {
        view.webContents.close()
      } catch {
        // ignore
      }
    }
    tabViews.clear()
    browserView = null
    // Sprint 013 M2 — 종료 시 디스크 강제 flush (재시작 후 복원)
    flushThumbnailSave()
    // Sprint 012 M1 — 메모리만 정리 (디스크는 유지 → 재시작 후 복원)
    thumbnailStore.clear()
  })
}

// Sprint 008 M1 — 탭 IPC 5종
ipcMain.handle('tab:list', () => tabManager.snapshot())

ipcMain.handle('tab:open', (_event, url?: string): TabSession => {
  // Sprint 016 M0 T03c (KI-007) — 신규 탭은 활성 워크스페이스 메타 자동 박힘 (격리 invariant).
  // Sprint 016 M3 T15 (G-015) — wsId 가 createTabView 에 전달되어 `persist:ws-{wsId}` partition 박힘.
  const wsId = getActiveWorkspaceId()
  const session = tabManager.open(url ?? 'about:blank', { workspaceId: wsId })
  createTabView(session.id, session.url, wsId)
  setActiveTabView(session.id)
  return session
})

/**
 * Sprint 013 M1 — 닫는 탭 정보를 히스토리에 push. about:blank 빈 탭은 제외.
 */
function pushClosedTabIfMeaningful(tabId: string): void {
  const session = tabManager.list().find((t) => t.id === tabId)
  if (!session) return
  if (!session.url || session.url === 'about:blank') return
  closedTabHistory.push({
    url: session.url,
    title: session.title,
    color: session.color,
    pinned: session.pinned
  })
}

ipcMain.handle('tab:close', (_event, id: string): boolean => {
  pushClosedTabIfMeaningful(id)
  const removed = tabManager.close(id)
  if (removed) destroyTabView(id)
  // Sprint 008 M3 — 마지막 탭 close 시 새 빈 탭 자동 open (일반 브라우저 UX).
  // Sprint 016 M0 T03c hotfix (codex BLOCKING #4) — 자동 빈 탭에도 active ws 메타 주입.
  let active = tabManager.getActiveId()
  if (!active) {
    const wsId = getActiveWorkspaceId()
    const fresh = tabManager.open('about:blank', { workspaceId: wsId })
    createTabView(fresh.id, fresh.url, wsId)
    active = fresh.id
  }
  setActiveTabView(active)
  return removed
})

ipcMain.handle('tab:switch', (_event, id: string): boolean => {
  // Sprint 015 M2-5 — old page-translation auto-abort branch removed.
  // The user setting is reserved for M4 indexing cancellation semantics.
  const ok = tabManager.switch(id)
  if (ok) setActiveTabView(id)
  return ok
})

ipcMain.handle('tab:active', (): TabSession | null => tabManager.getActive())

// Sprint 010 M1 — 탭 순서 변경.
ipcMain.handle('tab:reorder', (_event, id: string, newIndex: number): boolean => {
  return tabManager.reorder(id, newIndex)
})

// Sprint 010 M2 — 탭 컨텍스트 메뉴 동작.
// Sprint 013 M1 — 닫히는 탭은 ClosedTabHistory에 push (about:blank 제외).
ipcMain.handle('tab:close-others', (_event, keepId: string): boolean => {
  // closeOthers 호출 전 push 대상 결정 (호출 후 list에서 사라지므로)
  const toPush = tabManager.list().filter((t) => t.id !== keepId && !t.pinned)
  const result = tabManager.closeOthers(keepId)
  if (!result.ok) return false
  for (const t of toPush) {
    if (t.url && t.url !== 'about:blank') {
      closedTabHistory.push({ url: t.url, title: t.title, color: t.color, pinned: t.pinned })
    }
  }
  for (const id of result.closed) destroyTabView(id)
  setActiveTabView(keepId)
  return true
})

ipcMain.handle('tab:close-right', (_event, fromId: string): boolean => {
  const list = tabManager.list()
  const fromIdx = list.findIndex((t) => t.id === fromId)
  const toPush =
    fromIdx >= 0 ? list.slice(fromIdx + 1).filter((t) => !t.pinned) : []
  const result = tabManager.closeRight(fromId)
  if (!result.ok) return false
  for (const t of toPush) {
    if (t.url && t.url !== 'about:blank') {
      closedTabHistory.push({ url: t.url, title: t.title, color: t.color, pinned: t.pinned })
    }
  }
  for (const id of result.closed) destroyTabView(id)
  const active = tabManager.getActiveId()
  if (active) setActiveTabView(active)
  return true
})

ipcMain.handle('tab:duplicate', (_event, id: string): TabSession | null => {
  const session = tabManager.duplicate(id)
  if (!session) return null
  // Sprint 016 M3 T15 (G-015) — duplicate 한 탭의 workspace_id 로 partition 박음 (원본 격리 유지).
  createTabView(session.id, session.url, session.workspace_id)
  setActiveTabView(session.id)
  return session
})

// Sprint 011 M2 — 탭 컬러 라벨.
ipcMain.handle('tab:set-color', (_event, id: string, color: TabColor): boolean => {
  return tabManager.setColor(id, color)
})

// Sprint 011 M3 — 탭 핀(고정).
ipcMain.handle('tab:set-pinned', (_event, id: string, pinned: boolean): boolean => {
  return tabManager.setPinned(id, pinned)
})

// Sprint 012 M1 — 탭 미리보기 조회.
ipcMain.handle('tab:get-thumbnail', (_event, id: string): ThumbnailEntry | null => {
  return thumbnailStore.get(id)
})

// Sprint 013 M1 — 닫은 탭 복원. 비어 있으면 null.
// Sprint 016 M0 T03c hotfix (codex BLOCKING #4) — 복원 탭에도 active ws 메타 주입.
function reopenLastClosedTab(): TabSession | null {
  const entry = closedTabHistory.pop()
  if (!entry) return null
  const wsId = getActiveWorkspaceId()
  const session = tabManager.open(entry.url, { workspaceId: wsId })
  if (entry.color) tabManager.setColor(session.id, entry.color)
  if (entry.pinned) tabManager.setPinned(session.id, true)
  // Sprint 016 M3 T15 (G-015) — 복원 탭에 active ws partition 박힘.
  createTabView(session.id, session.url, wsId)
  setActiveTabView(session.id)
  return tabManager.list().find((t) => t.id === session.id) ?? session
}

ipcMain.handle('tab:reopen', (): TabSession | null => {
  return reopenLastClosedTab()
})

ipcMain.handle('tab:reopen-size', (): number => closedTabHistory.size())

// Sprint 010 M2 — TabBar 우클릭 시 OS 네이티브 컨텍스트 메뉴 popup.
ipcMain.handle(
  'tab:show-context-menu',
  (_event, args: { tabId: string }): void => {
    if (!mainWindow) return
    const { tabId } = args
    const list = tabManager.list()
    const fromIdx = list.findIndex((t) => t.id === tabId)
    if (fromIdx < 0) return
    const total = list.length
    const isRightmost = fromIdx === total - 1
    const onlyOne = total <= 1
    const menu = Menu.buildFromTemplate([
      {
        label: '탭 닫기',
        click: () => {
          void (async (): Promise<void> => {
            const removed = tabManager.close(tabId)
            if (removed) destroyTabView(tabId)
            let active = tabManager.getActiveId()
            if (!active) {
              // Sprint 016 M0 T03c hotfix — 자동 빈 탭에도 active ws 메타.
              // Sprint 016 M3 T15 (G-015) — partition 도 active ws 로 박음.
              const wsId = getActiveWorkspaceId()
              const fresh = tabManager.open('about:blank', { workspaceId: wsId })
              createTabView(fresh.id, fresh.url, wsId)
              active = fresh.id
            }
            setActiveTabView(active)
          })()
        }
      },
      {
        label: '다른 탭 닫기',
        enabled: !onlyOne,
        click: () => {
          const result = tabManager.closeOthers(tabId)
          if (!result.ok) return
          for (const id of result.closed) destroyTabView(id)
          setActiveTabView(tabId)
        }
      },
      {
        label: '오른쪽 탭 모두 닫기',
        enabled: !isRightmost,
        click: () => {
          const result = tabManager.closeRight(tabId)
          if (!result.ok) return
          for (const id of result.closed) destroyTabView(id)
          const active = tabManager.getActiveId()
          if (active) setActiveTabView(active)
        }
      },
      { type: 'separator' },
      {
        label: '탭 복제',
        click: () => {
          const session = tabManager.duplicate(tabId)
          if (!session) return
          // Sprint 016 M3 T15 (G-015) — duplicate 한 탭의 ws 로 partition 박음 (원본 격리 유지).
          createTabView(session.id, session.url, session.workspace_id)
          setActiveTabView(session.id)
        }
      },
      {
        label: tabManager.list().find((t) => t.id === tabId)?.pinned
          ? '핀 해제'
          : '핀 고정',
        click: () => {
          const current = tabManager.list().find((t) => t.id === tabId)?.pinned ?? false
          tabManager.setPinned(tabId, !current)
        }
      },
      { type: 'separator' },
      {
        label: '색상 변경',
        submenu: buildColorSubmenu(tabId)
      }
    ])
    menu.popup({ window: mainWindow })
  }
)

const COLOR_LABELS: Record<NonNullable<TabColor>, string> = {
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  gray: '회색'
}

function buildColorSubmenu(tabId: string): Electron.MenuItemConstructorOptions[] {
  const current = tabManager.list().find((t) => t.id === tabId)?.color ?? null
  return TAB_COLOR_PALETTE.map<Electron.MenuItemConstructorOptions>((color) => ({
    label: color === null ? '없음' : COLOR_LABELS[color],
    type: 'radio',
    checked: current === color,
    click: () => {
      tabManager.setColor(tabId, color)
    }
  }))
}

/**
 * Sprint 008 M1 — 신규 탭의 WebContentsView를 생성하고 listener를 등록.
 * 활성화는 별도 함수에서.
 *
 * Sprint 016 M3 T15 (G-015) — workspaceId 옵션 추가. 지정 시 `persist:ws-{workspaceId}` partition 박음
 * → cookies/localStorage/IndexedDB 격리. WebContents 생성 시점에만 partition 고정 (Electron 정책) —
 * 같은 탭의 workspace 가 바뀌면 destroyTabView → createTabView 재생성 필요 (정상 흐름에서는 일어나지 않음:
 * TabManager 가 workspace_id 격리 invariant 유지).
 */
function createTabView(
  tabId: string,
  url: string,
  workspaceId: string | null = null
): WebContentsView {
  const partition = getWorkspacePartitionName(workspaceId)
  const view = new WebContentsView({
    webPreferences: buildTabWebPreferences({ partition })
  })
  tabViews.set(tabId, view)
  WebContentsRegistry.register(view.webContents)

  // Navigation history broadcast — 활성 탭일 때만 송신
  const broadcastNav = (): void => {
    if (!mainWindow) return
    if (tabManager.getActiveId() !== tabId) return
    const wc = view.webContents
    mainWindow.webContents.send('browser:navigated', {
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    })
    // TabManager url/title 동기화
    tabManager.updateUrl(tabId, wc.getURL())
  }
  // Sprint 015 M2-5 — same-tab navigate no longer cancels removed page-translation flows.
  view.webContents.on('did-navigate', broadcastNav)
  view.webContents.on('did-navigate-in-page', broadcastNav)
  view.webContents.on('did-finish-load', broadcastNav)
  // Sprint 016 M0 T05 (KI-010) — 자동 페이지 인덱싱 hook.
  // IndexingGate 가 차단 도메인 / password 필드 / 사용자 차단 평가 후 통과 시 recordVisit + 임베딩 큐.
  // services.tryIndexPage 가 IndexingService 미초기화 (인프라 bootstrap 실패) 시 graceful null.
  // 활성 탭이면 priority 10, 백그라운드면 1 (PRD §8.1).
  // Sprint 017 M2 T10 (codex 019e4f51 BLOCKING #1 hotfix) — full navigation 시작 시 stale SPA timer cancel.
  //   `did-start-navigation` 이 `did-finish-load` 보다 먼저 fire — provisional navigation 단계에서
  //   이미 timer cancel 박음. URL guard (getURL() === scheduledUrl) 가 same-URL reload (F5) 또는
  //   provisional navigation (URL 아직 안 바뀜) 일 때 무력화되는 race 차단.
  //
  //   isInPlace=true 는 history.pushState/hash 등 same-document — SPA flow 자체이므로 cancel 안 함.
  //   isMainFrame=false 는 iframe nav — 본 SPA hook 의 scope 외, cancel 안 함.
  view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame) return
    if (isInPlace) return
    spaNavScheduler.cancel(tabId)
    // lastSpaPathForTab 도 reset — 새 페이지 로드 시 did-finish-load 에서 다시 박힘.
    lastSpaPathForTab.delete(tabId)
  })

  view.webContents.on('did-finish-load', () => {
    // Sprint 017 M2 T10 — full navigation 이 도착하면 대기 중 SPA debounce timer 는 stale.
    //   `did-finish-load` 가 도착하면 본 timer 는 무효 (해당 path 가 인덱싱/복원 책임).
    //   did-start-navigation 이 이미 cancel 했더라도 동시 발화 race 대비 방어망.
    spaNavScheduler.cancel(tabId)
    // Sprint 017 M2 T10 (codex 019e4f51 BLOCKING #2) — SPA hash-only skip 비교 base 박음.
    const finishUrl = view.webContents.getURL()
    if (finishUrl && (finishUrl.startsWith('http://') || finishUrl.startsWith('https://'))) {
      lastSpaPathForTab.set(tabId, urlPathAndSearch(finishUrl))
    } else {
      lastSpaPathForTab.delete(tabId)
    }
    void runPageIndexing(tabId, view)
    // Sprint 017 M1 T06 — Highlight 복원 trigger (CSS Highlight API 등록).
    //   codex dual review Finding 1 흡수 — `getActiveWorkspaceId()` 대신 본 탭의 `workspace_id` 사용.
    //   백그라운드 탭 로드 / 워크스페이스 전환 중 같은 url 인 cross-workspace highlight 시각 leak 차단.
    //   runPageIndexing 의 patternf 정합 — tabManager.snapshotAll().tabs.find tabId 매칭.
    //   tab 미존재 (close race) 또는 workspace_id null (backfill 전) → silent no-op (graceful).
    const tab = tabManager.snapshotAll().tabs.find((t) => t.id === tabId)
    const tabWorkspaceId = tab?.workspace_id ?? null
    void runHighlightRestore(
      { workspaceId: tabWorkspaceId, webContents: view.webContents },
      { getHighlightStore: () => getHighlightStore() }
    )
  })

  // Sprint 017 M2 T10 (KI-020) — SPA `did-navigate-in-page` 자동 인덱싱 hook.
  //   GitHub issue → PR 전환, Notion 페이지 전환 등 history.pushState 시점.
  //   codex 019e4f40 사전 협의 정합:
  //     - debounce 1000ms (Q1 권고 — Notion 류 다단 pushState + async DOM settle 고려)
  //     - isMainFrame 만 처리 (iframe 광고 등 무시)
  //     - scheduledUrl 캡처 + fire 직전 currentUrl 비교 (race 차단)
  //     - http/https allowlist 선필터 (runPageIndexing 정합)
  //     - records=0 일 때도 highlight registry clear (SPA same-document stale 차단 — BLOCKING)
  view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (!isMainFrame) return
    const wc = view.webContents
    if (wc.isDestroyed()) return
    const scheduledUrl = wc.getURL()
    if (!scheduledUrl) return
    if (!scheduledUrl.startsWith('http://') && !scheduledUrl.startsWith('https://')) return
    // codex 019e4f51 BLOCKING #2 hotfix — hash-only navigation skip.
    //   같은 path+search 의 hash 만 변경 (e.g. `#section`) 은 같은 콘텐츠 → 인덱싱/highlight 무관.
    //   schedule 시 highlight lookup 이 exact URL 매칭으로 records=[] → clearWhenEmpty 가 모든
    //   highlight stale clear 하는 BLOCKING 차단.
    const lastPath = lastSpaPathForTab.get(tabId) ?? null
    if (isHashOnlyNavigation(scheduledUrl, lastPath)) return
    lastSpaPathForTab.set(tabId, urlPathAndSearch(scheduledUrl))
    spaNavScheduler.schedule(tabId, {
      scheduledUrl,
      getCurrentUrl: () => view.webContents.getURL(),
      isDestroyed: () => view.webContents.isDestroyed(),
      runIndex: async () => {
        await runPageIndexing(tabId, view)
        const tab = tabManager.snapshotAll().tabs.find((t) => t.id === tabId)
        const tabWorkspaceId = tab?.workspace_id ?? null
        await runHighlightRestore(
          { workspaceId: tabWorkspaceId, webContents: view.webContents },
          { getHighlightStore: () => getHighlightStore() },
          { clearWhenEmpty: true }
        )
      }
    })
  })
  view.webContents.on('page-title-updated', (_event, title) => {
    tabManager.updateTitle(tabId, title)
  })

  // Sprint 015 M5-1 — 글로벌 단축키 캡처 (PRD §7.4.3).
  // WebContentsView 내부 Cmd/Ctrl+K (디폴트) 입력을 main 이 먼저 가로채 SearchBar 포커스 IPC 전달.
  // 사이트 자체 Cmd+K 핸들러 (Slack/Notion 등) 충돌 시 사용자가 ShortcutSettings 에서 변경.
  view.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow) return
    const bindings = getShortcutBindings()
    for (const binding of bindings) {
      if (inputMatchesAccelerator(input, binding.accelerator, process.platform)) {
        event.preventDefault()
        mainWindow.webContents.send('shortcut:invoke', binding.id)
        return
      }
    }
  })

  view.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow) return
    const selectionText = (params.selectionText ?? '').trim()
    // Sprint 014 M3-7 핫픽스: 선택 텍스트가 없어도 일반 메뉴(뒤로/앞으로/새로고침/링크 복사 등) 표시.
    // 기존엔 selectionText 없으면 return으로 메뉴 자체 미표시 → 사용자 보고 "우클릭 안 됨".
    const template: Electron.MenuItemConstructorOptions[] = []
    if (selectionText) {
      const preview =
        selectionText.length > 30 ? `${selectionText.slice(0, 30)}…` : selectionText
      template.push(
        {
          label: `한국어로 번역: "${preview}"`,
          click: () => {
            void handleContextMenuTranslate(selectionText, params.x, params.y)
          }
        },
        {
          label: `쉽게 설명: "${preview}"`,
          click: () => {
            void handleContextMenuExplain(selectionText, params.x, params.y)
          }
        },
        {
          label: `이 부분 요약: "${preview}"`,
          click: () => {
            void handleContextMenuSummarize(selectionText, params.x, params.y)
          }
        },
        // Sprint 017 M1 T06 — 노트 + Highlight 저장. selection 을 page 컨텍스트에서 직렬화 후
        // HighlightStore.add + NoteService.createNote composite + 즉시 visual 복원.
        //   codex Finding 1 흡수 — tabId 명시 전달 (탭 workspace_id 기반 격리, active ws 회피).
        {
          label: `노트로 저장 + 하이라이트: "${preview}"`,
          click: () => {
            void handleContextMenuHighlight(view, selectionText, tabId)
          }
        },
        { type: 'separator' },
        {
          label: '선택 복사',
          accelerator: 'CommandOrControl+C',
          click: () => view.webContents.copy()
        },
        { type: 'separator' }
      )
    }
    // 링크 우클릭 시 링크 관련 항목
    if (params.linkURL) {
      template.push(
        {
          label: '링크 주소 복사',
          click: () => clipboard.writeText(params.linkURL)
        },
        { type: 'separator' }
      )
    }
    const wc = view.webContents
    template.push(
      {
        label: '뒤로',
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: '앞으로',
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward()
      },
      {
        label: '새로고침',
        accelerator: 'CommandOrControl+R',
        click: () => wc.reload()
      }
    )
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: mainWindow })
  })

  if (url && url !== 'about:blank') {
    void view.webContents.loadURL(url).catch(() => {
      // 로드 실패는 무시 (사용자가 URL Bar에서 재입력 가능)
    })
  }

  return view
}

/**
 * Sprint 008 M1 — 탭 view 정리. 메모리 누수 방지.
 */
function destroyTabView(tabId: string): void {
  const view = tabViews.get(tabId)
  if (!view) return
  tabViews.delete(tabId)
  // Sprint 017 M2 T10 — SPA debounce timer leak 차단 (codex 019e4f40 회귀 매트릭스).
  spaNavScheduler.cancel(tabId)
  // codex 019e4f51 BLOCKING #2 hotfix — hash-only skip 비교 캐시 정리.
  lastSpaPathForTab.delete(tabId)
  // Sprint 012 M1 — 탭 close 시 ThumbnailStore에서도 자동 제거
  // Sprint 013 M2 — 디스크에서도 동기 제거 (debounced save로 반영)
  if (thumbnailStore.remove(tabId)) scheduleThumbnailSave()
  if (mainWindow) {
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {
      // 이미 분리됨
    }
  }
  try {
    view.webContents.close()
  } catch {
    // ignore
  }
}

/**
 * Sprint 008 M1 — 활성 탭의 view만 mainWindow.contentView에 add.
 * 비활성 view는 분리해 화면에서 숨김.
 */
/**
 * Sprint 012 M1 — 지정 tabId의 view 캡처 후 ThumbnailStore 저장.
 * NativeImage → resize → dataURL → ThumbnailStore 저장. 실패는 silent.
 *
 * 핫픽스 (WI-S012M1-1): tabManager.getActiveId() 의존 제거 — caller가 호출 시점의
 * 직전 활성 view tabId를 직접 결정. setActiveTabView 진입 시점에 browserView 변수가
 * 이전 활성 view를 가리키는 점을 활용해 tabId 역조회.
 */
async function captureTabThumbnail(prevTabId: string): Promise<void> {
  const view = tabViews.get(prevTabId)
  if (!view) return
  try {
    const image = await view.webContents.capturePage()
    if (image.isEmpty()) return
    const resized = image.resize({ width: THUMBNAIL_RESIZE_WIDTH })
    const size = resized.getSize()
    const entry: ThumbnailEntry = {
      dataUrl: resized.toDataURL(),
      capturedAt: Date.now(),
      width: size.width,
      height: size.height
    }
    thumbnailStore.set(prevTabId, entry)
    scheduleThumbnailSave()
  } catch {
    // capturePage 실패는 silent — 로그 노이즈 회피
  }
}

/**
 * Sprint 013 M2 — 디스크 영속 debounced 500ms.
 */
function scheduleThumbnailSave(): void {
  if (!thumbnailDiskStore) return
  if (thumbnailSaveTimer) clearTimeout(thumbnailSaveTimer)
  thumbnailSaveTimer = setTimeout(() => {
    thumbnailSaveTimer = null
    if (!thumbnailDiskStore) return
    void thumbnailDiskStore.save(thumbnailStore.entries()).catch(() => {
      // IO 실패 silent
    })
  }, THUMBNAIL_SAVE_DEBOUNCE_MS)
}

async function initializeThumbnailStore(): Promise<void> {
  thumbnailDiskStore = new ThumbnailDiskStore(defaultThumbnailsPath(app.getPath('userData')))
  try {
    const items = await thumbnailDiskStore.load()
    if (items.length > 0) {
      thumbnailStore.bulkLoad(items)
    }
  } catch {
    // load 실패 silent
  }
}

function flushThumbnailSave(): void {
  if (!thumbnailDiskStore) return
  if (thumbnailSaveTimer) {
    clearTimeout(thumbnailSaveTimer)
    thumbnailSaveTimer = null
  }
  void thumbnailDiskStore.save(thumbnailStore.entries()).catch(() => {
    // 종료 중 IO 실패는 silent
  })
}

function setActiveTabView(tabId: string): void {
  if (!mainWindow) return
  const next = tabViews.get(tabId)
  if (!next) return
  // Sprint 012 M1 핫픽스 — 진입 시점 browserView 변수가 이전 활성 view를 가리킴
  // (syncBrowserViewRef는 본 함수 마지막에서 호출되어 새 view로 갱신됨).
  // 이전 view의 tabId를 역조회하여 captureTabThumbnail 호출 — caller에서 tabManager
  // 상태가 이미 변경됐을 수 있어 tabManager.getActiveId() 의존 불가.
  if (browserView && browserView !== next) {
    for (const [otherId, view] of tabViews.entries()) {
      if (view === browserView) {
        void captureTabThumbnail(otherId)
        break
      }
    }
  }
  // 기존 활성 view 분리
  for (const [otherId, view] of tabViews.entries()) {
    if (otherId === tabId) continue
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {
      // 이미 분리됨
    }
  }
  // 새 활성 view add (이미 add됐어도 idempotent에 가깝게 동작)
  try {
    mainWindow.contentView.addChildView(next)
  } catch {
    // ignore
  }
  syncBrowserViewRef()
  updateBrowserViewBounds()
  // 활성 view의 navigation 상태 즉시 broadcast (탭 전환 시 UrlBar 업데이트)
  const wc = next.webContents
  mainWindow.webContents.send('browser:navigated', {
    url: wc.getURL(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward()
  })
}

const PANEL_WIDTH = 420
let panelOpen = false
// Sprint 014 M3-2 핫픽스 — Consent/Settings stage일 때 view를 화면 밖으로 숨겨 클릭 차단 회피.
// 시작 시 false: renderer가 boot 후 consent OR browser 결정 시점에 app:set-view-visible 호출.
let viewVisible = false

ipcMain.handle('panel:set-open', (_event, open: boolean): void => {
  panelOpen = !!open
  updateBrowserViewBounds()
})

/**
 * Sprint 014 M3-2 핫픽스 — renderer stage(consent/settings) 동안 WebContentsView 가시성 제어.
 * stage='browser'일 때만 visible=true. 그 외에는 화면 밖(0x0)으로 이동하여 클릭 가로채기 차단.
 */
ipcMain.handle('app:set-view-visible', (_event, visible: boolean): void => {
  viewVisible = !!visible
  updateBrowserViewBounds()
})

function updateBrowserViewBounds(): void {
  if (!mainWindow || !browserView) return
  if (!viewVisible) {
    // 화면 밖으로 이동 — Consent/Settings 카드가 클릭 가능하도록
    browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return
  }
  const bounds = mainWindow.getContentBounds()
  const rightInset = panelOpen ? PANEL_WIDTH : 0
  // Sprint 015 M6 T28 — WorkspaceSidebar 좌측 SIDEBAR_WIDTH 점유. 본 view 는 그 우측부터 시작.
  browserView.setBounds({
    x: SIDEBAR_WIDTH,
    y: HEADER_HEIGHT,
    width: Math.max(0, bounds.width - SIDEBAR_WIDTH - rightInset),
    height: Math.max(0, bounds.height - HEADER_HEIGHT)
  })
}

ipcMain.handle('navigate', async (_event, url: string): Promise<NavigateResult> => {
  if (!browserView) return { ok: false, error: 'browser-view-not-ready' }
  try {
    await browserView.webContents.loadURL(url)
    return { ok: true, url: browserView.webContents.getURL() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('go-back', (): boolean => {
  if (!browserView) return false
  const wc = browserView.webContents
  if (wc.navigationHistory.canGoBack()) {
    wc.navigationHistory.goBack()
    return true
  }
  return false
})

ipcMain.handle('go-forward', (): boolean => {
  if (!browserView) return false
  const wc = browserView.webContents
  if (wc.navigationHistory.canGoForward()) {
    wc.navigationHistory.goForward()
    return true
  }
  return false
})

ipcMain.handle('reload', (): boolean => {
  if (!browserView) return false
  browserView.webContents.reload()
  return true
})

ipcMain.handle('get-current-url', (): string => {
  return browserView?.webContents.getURL() ?? ''
})

ipcMain.handle('browser:get-view-id', (): number | null => {
  return browserView?.webContents.id ?? null
})

ipcMain.handle(
  'browser:nav-state',
  (): { url: string; canGoBack: boolean; canGoForward: boolean } => {
    if (!browserView) return { url: '', canGoBack: false, canGoForward: false }
    const wc = browserView.webContents
    return {
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }
  }
)

// Sprint 015 M2-6 — translate:render / translate:render-restore / pageResult:restore-current IPC handler 3개 + TranslationRenderer 모듈 폐기.
// Sprint 015 M2-5 — legacy page-translation IPC handlers and push events removed.
// Sprint 015 M2-4 — 페이지 요약 use case 폐기. 상세: PRD §19.5.1.

async function handleContextMenuTranslate(
  selectionText: string,
  webViewX: number,
  webViewY: number
): Promise<void> {
  await handleContextMenuAi(selectionText, webViewX, webViewY, 'selection')
}

async function handleContextMenuExplain(
  selectionText: string,
  webViewX: number,
  webViewY: number
): Promise<void> {
  await handleContextMenuAi(selectionText, webViewX, webViewY, 'explanation')
}

async function handleContextMenuSummarize(
  selectionText: string,
  webViewX: number,
  webViewY: number
): Promise<void> {
  await handleContextMenuAi(selectionText, webViewX, webViewY, 'summary')
}

/**
 * Sprint 017 M1 T06 — 노트 + Highlight 저장 (context-menu path).
 *
 * 흐름:
 *   1. page 컨텍스트에서 `buildSerializeScript()` 실행 → selection anchor 직렬화
 *   2. result.ok=false 시 (no_selection / unsupported_selection) silent return
 *   3. handleHighlightCreate composite 호출 — 신규 노트 생성 + HighlightStore.add
 *   4. broadcastMemoryInvalidated — MemoryStatsPanel notesCount 즉시 refresh
 *   5. runHighlightRestore 재호출 — 신규 highlight 즉시 visual 박힘 (페이지 reload 불필요)
 *
 * graceful — page context throw / store null / workspaceId null 모두 silent no-op (T06 scope).
 * toast / 사용자 안내는 T08 위임.
 *
 * codex dual review Finding 1 흡수 — `getActiveWorkspaceId()` 가 아닌 본 탭의 `workspace_id` 사용.
 * 사용자 선택 시점은 보통 active 탭이지만, ws 전환 race / 다중 창 시점 격리 강제.
 */
async function handleContextMenuHighlight(
  view: WebContentsView,
  selectionText: string,
  tabId: string
): Promise<void> {
  const wc = view.webContents
  if (wc.isDestroyed()) return
  const url = wc.getURL()
  if (!url || !url.startsWith('http')) return

  let serialized: SerializeResult
  try {
    serialized = (await wc.executeJavaScript(buildSerializeScript('body'), true)) as SerializeResult
  } catch {
    return
  }
  if (!serialized || !serialized.ok || !serialized.anchor) {
    // Sprint 017 M1 T08 (codex 019e4ec8 #6, KI-024 graceful) — serialize 실패 시 사용자 toast.
    //   특히 'unsupported_selection' (iframe / Shadow DOM cross-boundary) 은 silent 차단으로 인한
    //   "왜 안 되는지" 모름 위험. main → renderer 'highlight:toast' broadcast.
    if (mainWindow && !mainWindow.isDestroyed() && serialized?.errorCode) {
      const messages: Record<string, string> = {
        no_selection: '선택된 텍스트가 없습니다.',
        unsupported_selection:
          '이 영역(iframe / Shadow DOM)의 텍스트는 아직 하이라이트할 수 없습니다.',
        serialize_failed: '하이라이트 위치 계산에 실패했습니다.'
      }
      const message = messages[serialized.errorCode] ?? '하이라이트 저장에 실패했습니다.'
      mainWindow.webContents.send('highlight:toast', {
        kind: 'error',
        message,
        errorCode: serialized.errorCode
      })
    }
    return
  }

  const tab = tabManager.snapshotAll().tabs.find((t) => t.id === tabId)
  const workspaceId = tab?.workspace_id ?? null
  if (!workspaceId) return

  const response = await handleHighlightCreate(
    {
      workspaceId,
      selectedText: selectionText,
      url,
      contentHash: serialized.anchor.contentHash,
      anchor: serialized.anchor
    },
    {
      getActiveWorkspaceId: () => workspaceId,
      getHighlightStore: () => getHighlightStore(),
      getNoteService: () => getNoteServiceForHighlight()
    }
  )

  if (response.ok && response.note) {
    broadcastMemoryInvalidatedExternal(response.note.workspaceId)
  }

  // 즉시 visual 복원 — page reload 불필요.
  await runHighlightRestore(
    { workspaceId, webContents: wc },
    { getHighlightStore: () => getHighlightStore() }
  )
}

async function handleContextMenuAi(
  selectionText: string,
  webViewX: number,
  webViewY: number,
  requestType: 'selection' | 'explanation' | 'summary'
): Promise<void> {
  if (!mainWindow || !browserView) return
  const url = browserView.webContents.getURL()
  const webContentsId = browserView.webContents.id

  const mode =
    requestType === 'explanation'
      ? 'explanation'
      : requestType === 'summary'
        ? 'summary'
        : 'translation'

  // 미리 popup 표시 (로딩 상태)
  // Sprint 015 M6 T28 — WebContentsView 가 SIDEBAR_WIDTH 만큼 우측 시작하므로 popup anchor 도 동일 오프셋 적용.
  mainWindow.webContents.send('translation:popup-show', {
    sourceText: selectionText,
    url,
    anchorX: webViewX + SIDEBAR_WIDTH,
    anchorY: webViewY + HEADER_HEIGHT,
    status: 'loading',
    mode
  })

  const fieldScan = await scanWebContentsFields(webContentsId)

  const result = await executeTranslateRequest({
    providerType: 'openai',
    input: {
      sourceText: selectionText,
      sourceLanguage: 'auto',
      targetLanguage: 'ko',
      requestType,
      context: { url }
    },
    context: {
      url,
      hasPasswordField: fieldScan.hasPasswordField,
      hasCardField: fieldScan.hasCardField
    }
  })

  mainWindow.webContents.send('translation:popup-result', {
    ...result,
    mode
  })
}

/**
 * Sprint 012 M3 — 키보드 단축키 (Application Menu accelerator).
 * Ctrl+T 신규 / Ctrl+W 활성 탭 닫기 / Ctrl+Tab 다음 / Ctrl+Shift+Tab 이전.
 */
function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '탭',
      submenu: [
        {
          label: '새 탭',
          accelerator: 'CommandOrControl+T',
          click: () => {
            // Sprint 016 M0 T03c hotfix — 메뉴 새 탭도 active ws 메타.
            // Sprint 016 M3 T15 (G-015) — partition 도 active ws 로 박음.
            const wsId = getActiveWorkspaceId()
            const session = tabManager.open('about:blank', { workspaceId: wsId })
            createTabView(session.id, session.url, wsId)
            setActiveTabView(session.id)
          }
        },
        {
          label: '탭 닫기',
          accelerator: 'CommandOrControl+W',
          click: () => {
            const activeId = tabManager.getActiveId()
            if (!activeId) return
            // Sprint 013 M1 — 닫는 탭 히스토리 push (about:blank 제외)
            pushClosedTabIfMeaningful(activeId)
            const removed = tabManager.close(activeId)
            if (removed) destroyTabView(activeId)
            let active = tabManager.getActiveId()
            if (!active) {
              // Sprint 016 M0 T03c hotfix — 메뉴 탭 닫기 자동 빈 탭도 active ws 메타.
              // Sprint 016 M3 T15 (G-015) — partition 도 active ws 로 박음.
              const wsId = getActiveWorkspaceId()
              const fresh = tabManager.open('about:blank', { workspaceId: wsId })
              createTabView(fresh.id, fresh.url, wsId)
              active = fresh.id
            }
            setActiveTabView(active)
          }
        },
        {
          label: '닫은 탭 다시 열기',
          accelerator: 'CommandOrControl+Shift+T',
          click: () => {
            reopenLastClosedTab()
          }
        },
        { type: 'separator' },
        {
          label: '다음 탭',
          accelerator: 'CommandOrControl+Tab',
          click: () => {
            const nextId = tabManager.cycleActiveTabId('next')
            if (nextId && nextId !== tabManager.getActiveId()) {
              const ok = tabManager.switch(nextId)
              if (ok) setActiveTabView(nextId)
            }
          }
        },
        {
          label: '이전 탭',
          accelerator: 'CommandOrControl+Shift+Tab',
          click: () => {
            const prevId = tabManager.cycleActiveTabId('prev')
            if (prevId && prevId !== tabManager.getActiveId()) {
              const ok = tabManager.switch(prevId)
              if (ok) setActiveTabView(prevId)
            }
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  await initServices()
  rebuildAllProviders()
  // Sprint 017 M2 T11 (KI-021) — 워크스페이스 partition cleanup reconcile.
  // fire-and-forget — UI 부팅 지연 회피 (codex 019e4f65 Q4 권고). 모든 throw graceful.
  void reconcileWorkspacePartitions().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[main] workspace partition reconcile unexpected failure:', msg)
  })
  // Sprint 013 M2 — 디스크 영속 ThumbnailStore 복원
  await initializeThumbnailStore()
  installApplicationMenu()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
