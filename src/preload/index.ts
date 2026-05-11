import { contextBridge, ipcRenderer } from 'electron'

interface NavigateResult {
  ok: boolean
  url?: string
  error?: string
}

const browserApi = {
  navigate: (url: string): Promise<NavigateResult> => ipcRenderer.invoke('navigate', url),
  goBack: (): Promise<boolean> => ipcRenderer.invoke('go-back'),
  goForward: (): Promise<boolean> => ipcRenderer.invoke('go-forward'),
  reload: (): Promise<boolean> => ipcRenderer.invoke('reload'),
  getCurrentUrl: (): Promise<string> => ipcRenderer.invoke('get-current-url')
}

contextBridge.exposeInMainWorld('browserApi', browserApi)

export type BrowserApi = typeof browserApi
