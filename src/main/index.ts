import { app, BrowserWindow, Menu, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  initServices,
  rebuildAllProviders,
  WebContentsRegistry,
  executeTranslateRequest,
  scanWebContentsFields,
  extractWebContentsParagraphs,
  extractWebContentsPageNodes
} from './services'

let mainWindow: BrowserWindow | null = null
let browserView: WebContentsView | null = null

const URL_BAR_HEIGHT = 60

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

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  WebContentsRegistry.register(browserView.webContents)

  browserView.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow || !browserView) return
    const selectionText = (params.selectionText ?? '').trim()
    if (!selectionText) return
    const preview = selectionText.length > 30 ? `${selectionText.slice(0, 30)}…` : selectionText
    const menu = Menu.buildFromTemplate([
      {
        label: `한국어로 번역: "${preview}"`,
        click: () => {
          void handleContextMenuTranslate(selectionText, params.x, params.y)
        }
      }
    ])
    menu.popup({ window: mainWindow })
  })

  mainWindow.contentView.addChildView(browserView)
  updateBrowserViewBounds()

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
    browserView = null
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
    y: URL_BAR_HEIGHT,
    width: Math.max(0, bounds.width - rightInset),
    height: Math.max(0, bounds.height - URL_BAR_HEIGHT)
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
  'translate:paragraphs',
  async (
    _event,
    args: { providerType: string; sourceLanguage: string; targetLanguage: string }
  ): Promise<{ ok: boolean; total: number; reason?: string }> => {
    if (!mainWindow || !browserView) {
      return { ok: false, total: 0, reason: 'browser-not-ready' }
    }
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const paragraphs = await extractWebContentsParagraphs(webContentsId)
    if (paragraphs.length === 0) {
      return { ok: false, total: 0, reason: '문단을 찾지 못했습니다.' }
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

    for (const p of paragraphs) {
      if (!mainWindow) break
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
        // 페이지 전체 차단 — 후속 문단도 동일 결정이므로 즉시 정지.
        break
      }
    }

    mainWindow.webContents.send('translate:paragraphs-done', {
      total: paragraphs.length,
      completed,
      blocked,
      failed
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
      return { ok: false, total: 0, reason: 'browser-not-ready' }
    }
    pageTranslateAborted = false
    const url = browserView.webContents.getURL()
    const webContentsId = browserView.webContents.id
    const bundle = await extractWebContentsPageNodes(webContentsId)
    if (bundle.nodes.length === 0) {
      return { ok: false, total: 0, reason: '페이지 노드를 찾지 못했습니다.' }
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

    mainWindow.webContents.send('translate:page-done', {
      total: bundle.nodes.length,
      completed,
      blocked,
      failed,
      stoppedReason
    })
    return { ok: true, total: bundle.nodes.length, chunks: bundle.chunks.length }
  }
)

async function handleContextMenuTranslate(
  selectionText: string,
  webViewX: number,
  webViewY: number
): Promise<void> {
  if (!mainWindow || !browserView) return
  const url = browserView.webContents.getURL()
  const webContentsId = browserView.webContents.id

  // 미리 popup 표시 (로딩 상태)
  mainWindow.webContents.send('translation:popup-show', {
    sourceText: selectionText,
    url,
    anchorX: webViewX,
    anchorY: webViewY + URL_BAR_HEIGHT,
    status: 'loading'
  })

  const fieldScan = await scanWebContentsFields(webContentsId)

  const result = await executeTranslateRequest({
    providerType: 'openai',
    input: {
      sourceText: selectionText,
      sourceLanguage: 'auto',
      targetLanguage: 'ko',
      requestType: 'selection',
      context: { url }
    },
    context: {
      url,
      hasPasswordField: fieldScan.hasPasswordField,
      hasCardField: fieldScan.hasCardField
    }
  })

  mainWindow.webContents.send('translation:popup-result', result)
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
