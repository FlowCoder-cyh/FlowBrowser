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
  pageResultLookup
} from './services'
import {
  renderTranslationsScript,
  restoreOriginalsScript,
  type RenderPayload
} from '../perception/TranslationRenderer'
import { nodesSignatureFromTexts } from '../storage/PageResultStore'
import { planChunks, summarizeChunks } from '../ai/SummarizationPlanner'
import { TabManager, type TabSession } from './TabManager'

let mainWindow: BrowserWindow | null = null
const tabManager = new TabManager()
const tabViews = new Map<string, WebContentsView>()
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

interface NavigateResult {
  ok: boolean
  url?: string
  error?: string
}

function createMainWindow(): void {
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

  // Sprint 008 M1 — 첫 탭 자동 생성. 다중 탭 운영 시작.
  const firstTab = tabManager.open('about:blank')
  createTabView(firstTab.id, firstTab.url)
  setActiveTabView(firstTab.id)

  // TabManager 변동 broadcast (TabBar / UrlBar 구독)
  tabManager.subscribe((snapshot) => {
    if (!mainWindow) return
    mainWindow.webContents.send('tab:list-update', snapshot)
  })

  mainWindow.on('resize', updateBrowserViewBounds)
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

ipcMain.handle('tab:close', (_event, id: string): boolean => {
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
  const ok = tabManager.switch(id)
  if (ok) setActiveTabView(id)
  return ok
})

ipcMain.handle('tab:active', (): TabSession | null => tabManager.getActive())

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
function setActiveTabView(tabId: string): void {
  if (!mainWindow) return
  const next = tabViews.get(tabId)
  if (!next) return
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
 */
let paragraphsAborted = false

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
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const paragraphs = await extractWebContentsParagraphs(webContentsId)
    if (paragraphs.length === 0) {
      const reason = '문단을 찾지 못했습니다.'
      mainWindow.webContents.send('translate:paragraphs-error', { reason })
      return { ok: false, total: 0, reason }
    }

    const fieldScan = await scanWebContentsFields(webContentsId)

    mainWindow.webContents.send('translate:paragraphs-start', {
      url,
      total: paragraphs.length,
      paragraphs
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
        pageWideBlock: result.pageWideBlock
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
        failed
      })
    }

    mainWindow.webContents.send('translate:paragraphs-done', {
      total: paragraphs.length,
      completed,
      blocked,
      failed,
      stoppedReason
    })
    return { ok: true, total: paragraphs.length }
  }
)

/**
 * Sprint 003 M2 — 페이지 전체 번역. PRD §9.2 P1.
 * paragraph보다 광범위한 블록 노드 집합. abort 지원.
 */
let pageTranslateAborted = false

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
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const bundle = await extractWebContentsPageNodes(webContentsId)
    if (bundle.nodes.length === 0) {
      const reason = '페이지 노드를 찾지 못했습니다.'
      mainWindow.webContents.send('translate:page-error', { reason })
      return { ok: false, total: 0, reason }
    }

    const fieldScan = await scanWebContentsFields(webContentsId)

    mainWindow.webContents.send('translate:page-start', {
      url,
      total: bundle.nodes.length,
      chunks: bundle.chunks.length,
      nodes: bundle.nodes
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
        pageWideBlock: result.pageWideBlock
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
        failed
      })
    }

    mainWindow.webContents.send('translate:page-done', {
      total: bundle.nodes.length,
      completed,
      blocked,
      failed,
      stoppedReason
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
 * Sprint 004 M3 — 페이지 요약. PRD §9.2 P1.
 * 청크 단위 요약 → N개 합본을 통합 요약.
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
      totalChars: planned.reduce((sum, c) => sum + c.text.length, 0)
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
        }
      )

      mainWindow.webContents.send('translate:summary-done', {
        summary: result.summary,
        chunkSummaries: result.chunkSummaries,
        combined: result.combined,
        combinedPath: result.combinedPath,
        combinedInputChars: result.combinedInputChars,
        combineCharLimit: result.combineCharLimit,
        chunks: planned.length
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
      const reason =
        summaryReason ?? (err instanceof Error ? err.message : String(err))
      mainWindow.webContents.send('translate:summary-error', { reason, blockReason })
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

app.whenReady().then(async () => {
  await initServices()
  rebuildAllProviders()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
