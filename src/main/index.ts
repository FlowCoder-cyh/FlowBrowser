import { app, BrowserWindow, Menu, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  initServices,
  rebuildAllProviders,
  WebContentsRegistry,
  executeTranslateRequest,
  scanWebContentsFields,
  extractWebContentsParagraphs,
  extractWebContentsPageNodes,
  persistPageResult,
  pageResultLookup,
  loadTabState,
  saveTabState,
  getUserSetting
} from './services'
import {
  renderTranslationsScript,
  restoreOriginalsScript,
  type RenderPayload
} from '../perception/TranslationRenderer'
import { nodesSignatureFromTexts } from '../storage/PageResultStore'
import {
  planChunks,
  summarizeChunks,
  SummarizationAbortedError
} from '../ai/SummarizationPlanner'
import { TabManager, TAB_COLOR_PALETTE, type TabColor, type TabSession } from './TabManager'
import { ThumbnailStore, type ThumbnailEntry } from './ThumbnailStore'
import { ThumbnailDiskStore, defaultThumbnailsPath } from './ThumbnailDiskStore'
import { ClosedTabHistory } from './ClosedTabHistory'

let mainWindow: BrowserWindow | null = null
const tabManager = new TabManager()
const tabViews = new Map<string, WebContentsView>()
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

function getActiveTabView(): WebContentsView | null {
  const id = tabManager.getActiveId()
  if (!id) return null
  return tabViews.get(id) ?? null
}

function syncBrowserViewRef(): void {
  browserView = getActiveTabView()
}

// Sprint 004 M1 — paragraph abort 플래그 (Sprint 010 M3에서 cancelOnTabSwitch 지원 위해 상단 이동)
let paragraphsAborted = false
// Sprint 003 M2 — page translation abort 플래그 (Sprint 010 M3에서 상단 이동)
let pageTranslateAborted = false
// Sprint 011 M1 — summary abort 플래그
let summarizeAborted = false

// Sprint 009 M3 — 탭 상태 영속 (debounced 200ms)
let saveTimer: NodeJS.Timeout | null = null

function scheduleTabStateSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const snap = tabManager.snapshot()
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
  try {
    const persisted = await loadTabState()
    if (persisted.tabs.length > 0) {
      tabManager.restore({ tabs: persisted.tabs, activeId: persisted.activeId })
      for (const t of persisted.tabs) {
        createTabView(t.id, t.url)
      }
      const active = tabManager.getActiveId()
      if (active) setActiveTabView(active)
      return
    }
  } catch {
    // ignore - fallthrough
  }
  // 복원 실패 또는 빈 상태 → 첫 탭 신규 생성
  const firstTab = tabManager.open('about:blank')
  createTabView(firstTab.id, firstTab.url)
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

  // TabManager 변동 broadcast (TabBar / UrlBar 구독) — initializeTabs 이전에 등록해야
  // 복원 emit이 push 경로로도 도달함 (renderer가 mount 직후 받음).
  tabManager.subscribe((snapshot) => {
    if (!mainWindow) return
    mainWindow.webContents.send('tab:list-update', snapshot)
    scheduleTabStateSave()
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
    const snap = tabManager.snapshot()
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
  const session = tabManager.open(url ?? 'about:blank')
  createTabView(session.id, session.url)
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
  let active = tabManager.getActiveId()
  if (!active) {
    const fresh = tabManager.open('about:blank')
    createTabView(fresh.id, fresh.url)
    active = fresh.id
  }
  setActiveTabView(active)
  return removed
})

ipcMain.handle('tab:switch', (_event, id: string): boolean => {
  // Sprint 010 M3 — cancelOnTabSwitch=true이면 진행 중 paragraphs/page 작업 자동 abort.
  // 실제 탭 전환이 일어나는 경우에만 abort (같은 탭으로 switch는 noop).
  const prevId = tabManager.getActiveId()
  if (prevId !== null && prevId !== id) {
    try {
      const setting = getUserSetting()
      if (setting.cancelOnTabSwitch) {
        paragraphsAborted = true
        pageTranslateAborted = true
        summarizeAborted = true
      }
    } catch {
      // UserSettingStore가 아직 로드 안 됐을 수도 — 무시
    }
  }
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
  createTabView(session.id, session.url)
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
function reopenLastClosedTab(): TabSession | null {
  const entry = closedTabHistory.pop()
  if (!entry) return null
  const session = tabManager.open(entry.url)
  if (entry.color) tabManager.setColor(session.id, entry.color)
  if (entry.pinned) tabManager.setPinned(session.id, true)
  createTabView(session.id, session.url)
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
              const fresh = tabManager.open('about:blank')
              createTabView(fresh.id, fresh.url)
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
          createTabView(session.id, session.url)
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
 */
function createTabView(tabId: string, url: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
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
  view.webContents.on('did-navigate', broadcastNav)
  view.webContents.on('did-navigate-in-page', broadcastNav)
  view.webContents.on('did-finish-load', broadcastNav)
  view.webContents.on('page-title-updated', (_event, title) => {
    tabManager.updateTitle(tabId, title)
  })

  view.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow) return
    const selectionText = (params.selectionText ?? '').trim()
    if (!selectionText) return
    const preview = selectionText.length > 30 ? `${selectionText.slice(0, 30)}…` : selectionText
    const menu = Menu.buildFromTemplate([
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
      }
    ])
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

ipcMain.handle('panel:set-open', (_event, open: boolean): void => {
  panelOpen = !!open
  updateBrowserViewBounds()
})

function updateBrowserViewBounds(): void {
  if (!mainWindow || !browserView) return
  const bounds = mainWindow.getContentBounds()
  const rightInset = panelOpen ? PANEL_WIDTH : 0
  browserView.setBounds({
    x: 0,
    y: HEADER_HEIGHT,
    width: Math.max(0, bounds.width - rightInset),
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

/**
 * Sprint 006 M1/M2 — 외부 페이지에 번역 결과 렌더링 / 복원.
 */
ipcMain.handle(
  'translate:render',
  async (
    _event,
    payload: RenderPayload
  ): Promise<{ ok: boolean; applied?: number; missing?: number; reason?: string }> => {
    if (!browserView) return { ok: false, reason: 'browser-view-not-ready' }
    try {
      const result = (await browserView.webContents.executeJavaScript(
        renderTranslationsScript(payload)
      )) as { applied: number; missing: number }
      return { ok: true, applied: result.applied, missing: result.missing }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }
)

/**
 * Sprint 006 M3 — 페이지 캐시 복원. 현재 페이지 URL + 노드 추출 + signature 비교 후 render.
 */
ipcMain.handle(
  'pageResult:restore-current',
  async (
    _event,
    args: {
      targetLanguage: string
      providerType: string
      mode: 'replace' | 'overlay'
    }
  ): Promise<{
    ok: boolean
    applied?: number
    missing?: number
    reason?: 'no-hit' | 'signature-mismatch' | 'browser-not-ready' | 'no-nodes' | string
  }> => {
    if (!browserView) return { ok: false, reason: 'browser-not-ready' }
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const bundle = await extractWebContentsPageNodes(webContentsId)
    if (bundle.nodes.length === 0) return { ok: false, reason: 'no-nodes' }
    const signature = nodesSignatureFromTexts(bundle.nodes)
    const entry = await pageResultLookup({
      url,
      targetLanguage: args.targetLanguage,
      providerType: args.providerType,
      nodesSignature: signature
    })
    if (!entry) {
      const entryAny = await pageResultLookup({
        url,
        targetLanguage: args.targetLanguage,
        providerType: args.providerType
      })
      return entryAny
        ? { ok: false, reason: 'signature-mismatch' }
        : { ok: false, reason: 'no-hit' }
    }
    try {
      const result = (await browserView.webContents.executeJavaScript(
        renderTranslationsScript({
          mode: args.mode,
          selectorPreset: entry.selectorPreset,
          instructions: entry.instructions
        })
      )) as { applied: number; missing: number }
      return { ok: true, applied: result.applied, missing: result.missing }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle(
  'translate:render-restore',
  async (): Promise<{ ok: boolean; restored?: number; overlays?: number; reason?: string }> => {
    if (!browserView) return { ok: false, reason: 'browser-view-not-ready' }
    try {
      const result = (await browserView.webContents.executeJavaScript(
        restoreOriginalsScript()
      )) as { restored: number; overlays: number }
      return { ok: true, restored: result.restored, overlays: result.overlays }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }
)

/**
 * Sprint 004 M1 / S004-T02 — paragraph abort 일관성.
 * Sprint 010 M3 — paragraphsAborted 플래그는 파일 상단에서 선언 (cancelOnTabSwitch 분기에서 set).
 */
ipcMain.handle('translate:paragraphs-abort', (): { ok: true } => {
  paragraphsAborted = true
  return { ok: true }
})

ipcMain.handle(
  'translate:paragraphs',
  async (
    _event,
    args: { providerType: string; sourceLanguage: string; targetLanguage: string }
  ): Promise<{ ok: boolean; total: number; reason?: string }> => {
    if (!mainWindow || !browserView) {
      mainWindow?.webContents.send('translate:paragraphs-error', { reason: 'browser-not-ready' })
      return { ok: false, total: 0, reason: 'browser-not-ready' }
    }
    paragraphsAborted = false
    const sourceTabId = tabManager.getActiveId() // Sprint 009 M2 — 진입 시점 활성 탭 캡처
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const paragraphs = await extractWebContentsParagraphs(webContentsId)
    if (paragraphs.length === 0) {
      const reason = '문단을 찾지 못했습니다.'
      mainWindow.webContents.send('translate:paragraphs-error', { reason, sourceTabId })
      return { ok: false, total: 0, reason }
    }

    const fieldScan = await scanWebContentsFields(webContentsId)

    mainWindow.webContents.send('translate:paragraphs-start', {
      url,
      total: paragraphs.length,
      paragraphs,
      sourceTabId
    })

    let completed = 0
    let blocked = 0
    let failed = 0
    let stoppedReason: 'aborted' | 'page_wide_block' | null = null

    for (const p of paragraphs) {
      if (!mainWindow) break
      if (paragraphsAborted) {
        stoppedReason = 'aborted'
        break
      }
      const result = await executeTranslateRequest({
        providerType: args.providerType as 'openai',
        input: {
          sourceText: p.text,
          sourceLanguage: args.sourceLanguage,
          targetLanguage: args.targetLanguage,
          requestType: 'paragraph',
          context: { url }
        },
        context: {
          url,
          hasPasswordField: fieldScan.hasPasswordField,
          hasCardField: fieldScan.hasCardField
        }
      })

      if (result.ok && result.output) {
        completed++
      } else if (result.decision === 'blocked') {
        blocked++
      } else {
        failed++
      }

      mainWindow.webContents.send('translate:paragraph-progress', {
        id: p.id,
        completed,
        blocked,
        failed,
        total: paragraphs.length,
        translatedText: result.output?.translatedText,
        fromCache: result.fromCache,
        reason: result.reason,
        decision: result.decision,
        blockReason: result.blockReason,
        pageWideBlock: result.pageWideBlock,
        sourceTabId
      })

      if (result.decision === 'blocked' && result.pageWideBlock) {
        stoppedReason = 'page_wide_block'
        break
      }
    }

    if (stoppedReason === 'aborted') {
      mainWindow.webContents.send('translate:paragraphs-aborted', {
        total: paragraphs.length,
        completed,
        blocked,
        failed,
        sourceTabId
      })
    }

    mainWindow.webContents.send('translate:paragraphs-done', {
      total: paragraphs.length,
      completed,
      blocked,
      failed,
      stoppedReason,
      sourceTabId
    })
    return { ok: true, total: paragraphs.length }
  }
)

/**
 * Sprint 003 M2 — 페이지 전체 번역. PRD §9.2 P1.
 * paragraph보다 광범위한 블록 노드 집합. abort 지원.
 * Sprint 010 M3 — pageTranslateAborted 플래그는 파일 상단에서 선언 (cancelOnTabSwitch 분기에서 set).
 */
ipcMain.handle('translate:page-abort', (): { ok: true } => {
  pageTranslateAborted = true
  return { ok: true }
})

ipcMain.handle(
  'translate:page',
  async (
    _event,
    args: { providerType: string; sourceLanguage: string; targetLanguage: string }
  ): Promise<{
    ok: boolean
    total: number
    chunks?: number
    reason?: string
  }> => {
    if (!mainWindow || !browserView) {
      mainWindow?.webContents.send('translate:page-error', { reason: 'browser-not-ready' })
      return { ok: false, total: 0, reason: 'browser-not-ready' }
    }
    pageTranslateAborted = false
    const sourceTabId = tabManager.getActiveId()
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const bundle = await extractWebContentsPageNodes(webContentsId)
    if (bundle.nodes.length === 0) {
      const reason = '페이지 노드를 찾지 못했습니다.'
      mainWindow.webContents.send('translate:page-error', { reason, sourceTabId })
      return { ok: false, total: 0, reason }
    }

    const fieldScan = await scanWebContentsFields(webContentsId)

    mainWindow.webContents.send('translate:page-start', {
      url,
      total: bundle.nodes.length,
      chunks: bundle.chunks.length,
      nodes: bundle.nodes,
      sourceTabId
    })

    let completed = 0
    let blocked = 0
    let failed = 0
    let stoppedReason: 'aborted' | 'page_wide_block' | null = null
    const persistInstructions: Array<{ id: string; translatedText: string }> = []

    for (const node of bundle.nodes) {
      if (!mainWindow) break
      if (pageTranslateAborted) {
        stoppedReason = 'aborted'
        break
      }

      const result = await executeTranslateRequest({
        providerType: args.providerType as 'openai',
        input: {
          sourceText: node.text,
          sourceLanguage: args.sourceLanguage,
          targetLanguage: args.targetLanguage,
          requestType: 'page',
          context: { url }
        },
        context: {
          url,
          hasPasswordField: fieldScan.hasPasswordField,
          hasCardField: fieldScan.hasCardField
        }
      })

      if (result.ok && result.output) {
        completed++
        persistInstructions.push({ id: node.id, translatedText: result.output.translatedText })
      } else if (result.decision === 'blocked') {
        blocked++
      } else {
        failed++
      }

      mainWindow.webContents.send('translate:page-progress', {
        id: node.id,
        completed,
        blocked,
        failed,
        total: bundle.nodes.length,
        translatedText: result.output?.translatedText,
        fromCache: result.fromCache,
        reason: result.reason,
        decision: result.decision,
        blockReason: result.blockReason,
        pageWideBlock: result.pageWideBlock,
        sourceTabId
      })

      if (result.decision === 'blocked' && result.pageWideBlock) {
        stoppedReason = 'page_wide_block'
        break
      }
    }

    if (stoppedReason === 'aborted') {
      mainWindow.webContents.send('translate:page-aborted', {
        total: bundle.nodes.length,
        completed,
        blocked,
        failed,
        sourceTabId
      })
    }

    mainWindow.webContents.send('translate:page-done', {
      total: bundle.nodes.length,
      completed,
      blocked,
      failed,
      stoppedReason,
      sourceTabId
    })

    // Sprint 006 M3 — 정상 완료(미차단/미취소)일 때만 페이지 결과 영속.
    if (stoppedReason === null && persistInstructions.length > 0) {
      await persistPageResult({
        url,
        targetLanguage: args.targetLanguage,
        providerType: args.providerType,
        selectorPreset: 'page',
        nodes: bundle.nodes,
        instructions: persistInstructions
      })
    }
    return { ok: true, total: bundle.nodes.length, chunks: bundle.chunks.length }
  }
)

/**
 * Sprint 011 M1 — summary abort. PRD §9.2 abort 일관성.
 */
ipcMain.handle('translate:summarize-abort', (): { ok: true } => {
  summarizeAborted = true
  return { ok: true }
})

/**
 * Sprint 004 M3 — 페이지 요약. PRD §9.2 P1.
 * 청크 단위 요약 → N개 합본을 통합 요약.
 * Sprint 011 M1 — abort 지원 (summarizeAborted 플래그 + abortCheck 콜백).
 */
ipcMain.handle(
  'translate:summarize-page',
  async (
    _event,
    args: { providerType: string; sourceLanguage: string; targetLanguage: string }
  ): Promise<{
    ok: boolean
    summary?: string
    chunkSummaries?: string[]
    combined?: boolean
    combinedPath?: 'single' | 'direct' | 'resplit' | 'truncated'
    combinedInputChars?: number
    combineCharLimit?: number
    chunks?: number
    reason?: string
    blockReason?: string
  }> => {
    if (!mainWindow || !browserView) {
      return { ok: false, reason: 'browser-not-ready' }
    }
    summarizeAborted = false
    const sourceTabId = tabManager.getActiveId()
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const bundle = await extractWebContentsPageNodes(webContentsId)
    if (bundle.nodes.length === 0) {
      return { ok: false, reason: '페이지 노드를 찾지 못했습니다.' }
    }

    const fieldScan = await scanWebContentsFields(webContentsId)
    const planned = planChunks(bundle)
    if (planned.length === 0) {
      return { ok: false, reason: '요약 가능한 청크가 없습니다.' }
    }

    mainWindow.webContents.send('translate:summary-start', {
      url,
      chunks: planned.length,
      totalChars: planned.reduce((sum, c) => sum + c.text.length, 0),
      sourceTabId
    })

    let blockReason: string | undefined
    let summaryReason: string | undefined

    try {
      const result = await summarizeChunks(
        planned.map((p) => p.text),
        async (text: string) => {
          if (!mainWindow) throw new Error('window-closed')
          const r = await executeTranslateRequest({
            providerType: args.providerType as 'openai',
            input: {
              sourceText: text,
              sourceLanguage: args.sourceLanguage,
              targetLanguage: args.targetLanguage,
              requestType: 'summary',
              context: { url }
            },
            context: {
              url,
              hasPasswordField: fieldScan.hasPasswordField,
              hasCardField: fieldScan.hasCardField
            }
          })
          if (r.decision === 'blocked') {
            blockReason = r.blockReason
            throw new Error(r.reason ?? '차단됨')
          }
          if (!r.ok || !r.output) {
            summaryReason = r.reason
            throw new Error(r.reason ?? '요약 실패')
          }
          return r.output.translatedText
        },
        { abortCheck: () => summarizeAborted }
      )

      mainWindow.webContents.send('translate:summary-done', {
        summary: result.summary,
        chunkSummaries: result.chunkSummaries,
        combined: result.combined,
        combinedPath: result.combinedPath,
        combinedInputChars: result.combinedInputChars,
        combineCharLimit: result.combineCharLimit,
        chunks: planned.length,
        sourceTabId
      })
      return {
        ok: true,
        summary: result.summary,
        chunkSummaries: result.chunkSummaries,
        combined: result.combined,
        combinedPath: result.combinedPath,
        combinedInputChars: result.combinedInputChars,
        combineCharLimit: result.combineCharLimit,
        chunks: planned.length
      }
    } catch (err) {
      // Sprint 011 M1 — abort 시 aborted 이벤트 발송 후 done 없이 종료
      if (err instanceof SummarizationAbortedError) {
        mainWindow.webContents.send('translate:summary-aborted', {
          chunks: planned.length,
          sourceTabId
        })
        return { ok: false, reason: 'aborted' }
      }
      const reason =
        summaryReason ?? (err instanceof Error ? err.message : String(err))
      mainWindow.webContents.send('translate:summary-error', { reason, blockReason, sourceTabId })
      return { ok: false, reason, blockReason }
    }
  }
)

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
  mainWindow.webContents.send('translation:popup-show', {
    sourceText: selectionText,
    url,
    anchorX: webViewX,
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
            const session = tabManager.open('about:blank')
            createTabView(session.id, session.url)
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
              const fresh = tabManager.open('about:blank')
              createTabView(fresh.id, fresh.url)
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
