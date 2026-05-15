import { contextBridge, ipcRenderer } from 'electron'

interface NavigateResult {
  ok: boolean
  url?: string
  error?: string
}

interface NavStatePayload {
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

const browserApi = {
  navigate: (url: string): Promise<NavigateResult> => ipcRenderer.invoke('navigate', url),
  goBack: (): Promise<boolean> => ipcRenderer.invoke('go-back'),
  goForward: (): Promise<boolean> => ipcRenderer.invoke('go-forward'),
  reload: (): Promise<boolean> => ipcRenderer.invoke('reload'),
  getCurrentUrl: (): Promise<string> => ipcRenderer.invoke('get-current-url'),
  getViewId: (): Promise<number | null> => ipcRenderer.invoke('browser:get-view-id'),
  setPanelOpen: (open: boolean): Promise<void> => ipcRenderer.invoke('panel:set-open', open),
  navState: (): Promise<NavStatePayload> => ipcRenderer.invoke('browser:nav-state'),
  onNavigated: (handler: (p: NavStatePayload) => void): (() => void) => {
    const listener = (_e: unknown, p: NavStatePayload): void => handler(p)
    ipcRenderer.on('browser:navigated', listener)
    return () => ipcRenderer.removeListener('browser:navigated', listener)
  }
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

interface DomainRule {
  pattern: string
  type: 'blacklist' | 'whitelist'
}

interface DomainPolicyExportPayload {
  policyVersion: number
  userRules: DomainRule[]
}

const privacyApi = {
  scanPage: (
    webContentsId: number
  ): Promise<{ hasPasswordField: boolean; hasCardField: boolean } | null> =>
    ipcRenderer.invoke('privacy:scan-page', webContentsId),
  approve: (domain: string): Promise<{ token: string }> =>
    ipcRenderer.invoke('privacy:approve', domain),
  addRule: (rule: DomainRule): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('privacy:add-rule', rule),
  removeRule: (args: DomainRule): Promise<void> =>
    ipcRenderer.invoke('privacy:remove-rule', args),
  getRules: (): Promise<{ userRules: DomainRule[] }> =>
    ipcRenderer.invoke('privacy:get-rules'),
  setRules: (rules: DomainRule[]): Promise<{ accepted: number; rejected: number }> =>
    ipcRenderer.invoke('privacy:set-rules', rules),
  exportPolicy: (): Promise<DomainPolicyExportPayload> =>
    ipcRenderer.invoke('privacy:export-policy'),
  importPolicy: (
    raw: unknown
  ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> =>
    ipcRenderer.invoke('privacy:import-policy', raw),
  clearPolicy: (): Promise<void> => ipcRenderer.invoke('privacy:clear-policy'),
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

const cacheApi = {
  stats: (): Promise<{ count: number; hitTotal: number }> =>
    ipcRenderer.invoke('cache:stats'),
  clearAll: (): Promise<void> => ipcRenderer.invoke('cache:clear-all'),
  invalidateGlossary: (version: string): Promise<number> =>
    ipcRenderer.invoke('cache:invalidate-glossary', version)
}

interface GlossaryTermPayload {
  id: string
  sourceTerm: string
  targetTerm: string
  description: string
  domain: string
  isActive: boolean
  version: string
  createdAt: number
  updatedAt: number
}

interface GlossaryExportPayload {
  policyVersion: number
  currentVersion: string
  terms: GlossaryTermPayload[]
}

const glossaryApi = {
  list: (): Promise<GlossaryTermPayload[]> => ipcRenderer.invoke('glossary:list'),
  version: (): Promise<string> => ipcRenderer.invoke('glossary:version'),
  add: (args: {
    sourceTerm: string
    targetTerm: string
    description?: string
    domain?: string
    isActive?: boolean
  }): Promise<{ ok: boolean; error?: string; term?: GlossaryTermPayload }> =>
    ipcRenderer.invoke('glossary:add', args),
  update: (args: {
    id: string
    patch: Partial<{
      sourceTerm: string
      targetTerm: string
      description: string
      domain: string
      isActive: boolean
    }>
  }): Promise<{ ok: boolean; term?: GlossaryTermPayload }> =>
    ipcRenderer.invoke('glossary:update', args),
  remove: (id: string): Promise<boolean> => ipcRenderer.invoke('glossary:remove', id),
  clear: (): Promise<void> => ipcRenderer.invoke('glossary:clear'),
  exportTerms: (): Promise<GlossaryExportPayload> => ipcRenderer.invoke('glossary:export'),
  importTerms: (
    raw: unknown
  ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> =>
    ipcRenderer.invoke('glossary:import', raw)
}

interface TranslateRequest {
  providerType: string
  input: {
    sourceText: string
    sourceLanguage: string
    targetLanguage: string
    requestType:
      | 'selection'
      | 'paragraph'
      | 'page'
      | 'subtitle'
      | 'tts_script'
      | 'explanation'
      | 'summary'
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

interface ParagraphsRequest {
  providerType: string
  sourceLanguage: string
  targetLanguage: string
}

interface ParagraphsStartPayload {
  url: string
  total: number
  paragraphs: Array<{ id: string; text: string; tag: string }>
}

interface ParagraphProgressPayload {
  id: string
  completed: number
  blocked: number
  failed: number
  total: number
  translatedText?: string
  fromCache?: boolean
  reason?: string
  decision: string
}

interface ParagraphsDonePayload {
  total: number
  completed: number
  blocked: number
  failed: number
  stoppedReason?: 'aborted' | 'page_wide_block' | null
}

interface ParagraphsAbortedPayload {
  total: number
  completed: number
  blocked: number
  failed: number
}

interface ParagraphsErrorPayload {
  reason: string
}

interface PageAbortedPayload {
  total: number
  completed: number
  blocked: number
  failed: number
}

interface PageErrorPayload {
  reason: string
}

interface PageStartPayload {
  url: string
  total: number
  chunks: number
  nodes: Array<{ id: string; text: string; tag: string }>
}

interface PageProgressPayload {
  id: string
  completed: number
  blocked: number
  failed: number
  total: number
  translatedText?: string
  fromCache?: boolean
  reason?: string
  decision: string
  blockReason?: string
  pageWideBlock?: boolean
}

interface PageDonePayload {
  total: number
  completed: number
  blocked: number
  failed: number
  stoppedReason: 'aborted' | 'page_wide_block' | null
}

const translateApi = {
  request: (args: TranslateRequest) => ipcRenderer.invoke('translate:request', args),
  paragraphs: (args: ParagraphsRequest): Promise<{ ok: boolean; total: number; reason?: string }> =>
    ipcRenderer.invoke('translate:paragraphs', args),
  abortParagraphs: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke('translate:paragraphs-abort'),
  page: (
    args: ParagraphsRequest
  ): Promise<{ ok: boolean; total: number; chunks?: number; reason?: string }> =>
    ipcRenderer.invoke('translate:page', args),
  abortPage: (): Promise<{ ok: true }> => ipcRenderer.invoke('translate:page-abort'),
  onParagraphsStart: (handler: (p: ParagraphsStartPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: ParagraphsStartPayload): void => handler(p)
    ipcRenderer.on('translate:paragraphs-start', listener)
    return () => ipcRenderer.removeListener('translate:paragraphs-start', listener)
  },
  onParagraphProgress: (handler: (p: ParagraphProgressPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: ParagraphProgressPayload): void => handler(p)
    ipcRenderer.on('translate:paragraph-progress', listener)
    return () => ipcRenderer.removeListener('translate:paragraph-progress', listener)
  },
  onParagraphsDone: (handler: (p: ParagraphsDonePayload) => void): (() => void) => {
    const listener = (_e: unknown, p: ParagraphsDonePayload): void => handler(p)
    ipcRenderer.on('translate:paragraphs-done', listener)
    return () => ipcRenderer.removeListener('translate:paragraphs-done', listener)
  },
  onParagraphsAborted: (handler: (p: ParagraphsAbortedPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: ParagraphsAbortedPayload): void => handler(p)
    ipcRenderer.on('translate:paragraphs-aborted', listener)
    return () => ipcRenderer.removeListener('translate:paragraphs-aborted', listener)
  },
  onParagraphsError: (handler: (p: ParagraphsErrorPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: ParagraphsErrorPayload): void => handler(p)
    ipcRenderer.on('translate:paragraphs-error', listener)
    return () => ipcRenderer.removeListener('translate:paragraphs-error', listener)
  },
  onPageStart: (handler: (p: PageStartPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: PageStartPayload): void => handler(p)
    ipcRenderer.on('translate:page-start', listener)
    return () => ipcRenderer.removeListener('translate:page-start', listener)
  },
  onPageProgress: (handler: (p: PageProgressPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: PageProgressPayload): void => handler(p)
    ipcRenderer.on('translate:page-progress', listener)
    return () => ipcRenderer.removeListener('translate:page-progress', listener)
  },
  onPageDone: (handler: (p: PageDonePayload) => void): (() => void) => {
    const listener = (_e: unknown, p: PageDonePayload): void => handler(p)
    ipcRenderer.on('translate:page-done', listener)
    return () => ipcRenderer.removeListener('translate:page-done', listener)
  },
  onPageAborted: (handler: (p: PageAbortedPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: PageAbortedPayload): void => handler(p)
    ipcRenderer.on('translate:page-aborted', listener)
    return () => ipcRenderer.removeListener('translate:page-aborted', listener)
  },
  onPageError: (handler: (p: PageErrorPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: PageErrorPayload): void => handler(p)
    ipcRenderer.on('translate:page-error', listener)
    return () => ipcRenderer.removeListener('translate:page-error', listener)
  },
  summarizePage: (
    args: ParagraphsRequest
  ): Promise<{
    ok: boolean
    summary?: string
    chunkSummaries?: string[]
    combined?: boolean
    combinedPath?: 'single' | 'direct' | 'resplit' | 'truncated'
    chunks?: number
    reason?: string
    blockReason?: string
  }> => ipcRenderer.invoke('translate:summarize-page', args),
  render: (payload: {
    mode: 'replace' | 'overlay'
    selectorPreset: 'paragraph' | 'page'
    instructions: Array<{ id: string; translatedText: string }>
  }): Promise<{ ok: boolean; applied?: number; missing?: number; reason?: string }> =>
    ipcRenderer.invoke('translate:render', payload),
  renderRestore: (): Promise<{
    ok: boolean
    restored?: number
    overlays?: number
    reason?: string
  }> => ipcRenderer.invoke('translate:render-restore'),
  onSummaryStart: (handler: (p: SummaryStartPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: SummaryStartPayload): void => handler(p)
    ipcRenderer.on('translate:summary-start', listener)
    return () => ipcRenderer.removeListener('translate:summary-start', listener)
  },
  onSummaryDone: (handler: (p: SummaryDonePayload) => void): (() => void) => {
    const listener = (_e: unknown, p: SummaryDonePayload): void => handler(p)
    ipcRenderer.on('translate:summary-done', listener)
    return () => ipcRenderer.removeListener('translate:summary-done', listener)
  },
  onSummaryError: (handler: (p: SummaryErrorPayload) => void): (() => void) => {
    const listener = (_e: unknown, p: SummaryErrorPayload): void => handler(p)
    ipcRenderer.on('translate:summary-error', listener)
    return () => ipcRenderer.removeListener('translate:summary-error', listener)
  }
}

type PopupMode = 'translation' | 'explanation' | 'summary'

interface PopupShowPayload {
  sourceText: string
  url: string
  anchorX: number
  anchorY: number
  status: 'loading'
  mode?: PopupMode
}

interface PopupResultPayload {
  ok: boolean
  decision: string
  reason?: string
  fromCache?: boolean
  mode?: PopupMode
  output?: {
    translatedText: string
    modelUsed: string
    inputTokens: number
    outputTokens: number
    estimatedCostUsd: number
    durationMs: number
  }
}

interface SummaryStartPayload {
  url: string
  chunks: number
  totalChars: number
}

interface SummaryDonePayload {
  summary: string
  chunkSummaries: string[]
  combined: boolean
  combinedPath?: 'single' | 'direct' | 'resplit' | 'truncated'
  chunks: number
}

interface SummaryErrorPayload {
  reason: string
  blockReason?: string
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
contextBridge.exposeInMainWorld('cacheApi', cacheApi)
contextBridge.exposeInMainWorld('glossaryApi', glossaryApi)
contextBridge.exposeInMainWorld('translateApi', translateApi)
contextBridge.exposeInMainWorld('popupApi', popupApi)

export type BrowserApi = typeof browserApi
export type ConsentApi = typeof consentApi
export type CredentialApi = typeof credentialApi
export type PrivacyApi = typeof privacyApi
export type UsageApi = typeof usageApi
export type CacheApi = typeof cacheApi
export type GlossaryApi = typeof glossaryApi
export type TranslateApi = typeof translateApi
export type PopupApi = typeof popupApi
