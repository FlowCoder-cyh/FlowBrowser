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
  getCurrentUrl: (): Promise<string> => ipcRenderer.invoke('get-current-url'),
  getViewId: (): Promise<number | null> => ipcRenderer.invoke('browser:get-view-id')
}

interface ConsentState {
  globalConsented: boolean
  globalConsentedAt: number | null
  policyVersion: number
}

const consentApi = {
  get: (): Promise<ConsentState> => ipcRenderer.invoke('consent:get'),
  give: (): Promise<ConsentState> => ipcRenderer.invoke('consent:give'),
  revoke: (): Promise<void> => ipcRenderer.invoke('consent:revoke')
}

interface CredentialRecord {
  id: string
  providerType: string
  displayName: string
  authType: 'oauth' | 'api_key' | 'local'
  status: 'active' | 'expired' | 'invalid' | 'disabled'
  lastValidatedAt: number | null
  createdAt: number
  updatedAt: number
}

const credentialApi = {
  list: (): Promise<CredentialRecord[]> => ipcRenderer.invoke('credential:list'),
  save: (args: {
    providerType: string
    displayName: string
    secret: string
    authType: 'oauth' | 'api_key' | 'local'
  }): Promise<CredentialRecord> => ipcRenderer.invoke('credential:save', args),
  remove: (providerType: string): Promise<boolean> =>
    ipcRenderer.invoke('credential:delete', providerType),
  validate: (providerType: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('credential:validate', providerType)
}

const privacyApi = {
  scanPage: (
    webContentsId: number
  ): Promise<{ hasPasswordField: boolean; hasCardField: boolean } | null> =>
    ipcRenderer.invoke('privacy:scan-page', webContentsId),
  approve: (domain: string): Promise<{ token: string }> =>
    ipcRenderer.invoke('privacy:approve', domain),
  addRule: (rule: { pattern: string; type: 'blacklist' | 'whitelist' }): Promise<void> =>
    ipcRenderer.invoke('privacy:add-rule', rule),
  removeRule: (args: { pattern: string; type: 'blacklist' | 'whitelist' }): Promise<void> =>
    ipcRenderer.invoke('privacy:remove-rule', args),
  getRules: (): Promise<{ userRules: Array<{ pattern: string; type: string }> }> =>
    ipcRenderer.invoke('privacy:get-rules'),
  blockedStats: (): Promise<{
    byDomain: Record<string, number>
    byReason: Record<string, number>
    total: number
  }> => ipcRenderer.invoke('privacy:blocked-stats')
}

const usageApi = {
  summary: (sinceMs?: number) => ipcRenderer.invoke('usage:summary', sinceMs),
  list: (sinceMs?: number) => ipcRenderer.invoke('usage:list', sinceMs),
  clearAll: (): Promise<void> => ipcRenderer.invoke('usage:clear-all'),
  purgeOlderThan: (beforeMs: number): Promise<number> =>
    ipcRenderer.invoke('usage:purge-older-than', beforeMs)
}

interface TranslateRequest {
  providerType: string
  input: {
    sourceText: string
    sourceLanguage: string
    targetLanguage: string
    requestType: 'selection' | 'paragraph' | 'page' | 'subtitle' | 'tts_script'
    modelHint?: string
    context?: { url?: string; title?: string; surroundingText?: string }
  }
  context: {
    url: string
    hasPasswordField?: boolean
    hasCardField?: boolean
    manualApprovalToken?: string
  }
}

const translateApi = {
  request: (args: TranslateRequest) => ipcRenderer.invoke('translate:request', args)
}

interface PopupShowPayload {
  sourceText: string
  url: string
  anchorX: number
  anchorY: number
  status: 'loading'
}

interface PopupResultPayload {
  ok: boolean
  decision: string
  reason?: string
  output?: {
    translatedText: string
    modelUsed: string
    inputTokens: number
    outputTokens: number
    estimatedCostUsd: number
    durationMs: number
  }
}

const popupApi = {
  onShow: (handler: (payload: PopupShowPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: PopupShowPayload): void => handler(payload)
    ipcRenderer.on('translation:popup-show', listener)
    return () => ipcRenderer.removeListener('translation:popup-show', listener)
  },
  onResult: (handler: (payload: PopupResultPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: PopupResultPayload): void => handler(payload)
    ipcRenderer.on('translation:popup-result', listener)
    return () => ipcRenderer.removeListener('translation:popup-result', listener)
  }
}

contextBridge.exposeInMainWorld('browserApi', browserApi)
contextBridge.exposeInMainWorld('consentApi', consentApi)
contextBridge.exposeInMainWorld('credentialApi', credentialApi)
contextBridge.exposeInMainWorld('privacyApi', privacyApi)
contextBridge.exposeInMainWorld('usageApi', usageApi)
contextBridge.exposeInMainWorld('translateApi', translateApi)
contextBridge.exposeInMainWorld('popupApi', popupApi)

export type BrowserApi = typeof browserApi
export type ConsentApi = typeof consentApi
export type CredentialApi = typeof credentialApi
export type PrivacyApi = typeof privacyApi
export type UsageApi = typeof usageApi
export type TranslateApi = typeof translateApi
export type PopupApi = typeof popupApi
