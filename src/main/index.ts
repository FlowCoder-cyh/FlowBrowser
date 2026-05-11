import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { join } from 'node:path'
import { initServices, rebuildAllProviders, WebContentsRegistry } from './services'

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

  mainWindow.contentView.addChildView(browserView)
  updateBrowserViewBounds()

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
    browserView = null
  })
}

function updateBrowserViewBounds(): void {
  if (!mainWindow || !browserView) return
  const bounds = mainWindow.getContentBounds()
  browserView.setBounds({
    x: 0,
    y: URL_BAR_HEIGHT,
    width: bounds.width,
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
