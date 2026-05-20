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

type TabColorPayload = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | null

interface TabSessionPayload {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
  color: TabColorPayload
  pinned: boolean
  /** Sprint 016 M0 T03c — 워크스페이스 격리 메타. T03a TabSession schema 정합 (null = backfill 전). */
  workspace_id: string | null
}

interface TabListSnapshot {
  tabs: TabSessionPayload[]
  activeId: string | null
}

const tabApi = {
  list: (): Promise<TabListSnapshot> => ipcRenderer.invoke('tab:list'),
  open: (url?: string): Promise<TabSessionPayload> => ipcRenderer.invoke('tab:open', url),
  close: (id: string): Promise<boolean> => ipcRenderer.invoke('tab:close', id),
  switch: (id: string): Promise<boolean> => ipcRenderer.invoke('tab:switch', id),
  active: (): Promise<TabSessionPayload | null> => ipcRenderer.invoke('tab:active'),
  reorder: (id: string, newIndex: number): Promise<boolean> =>
    ipcRenderer.invoke('tab:reorder', id, newIndex),
  closeOthers: (keepId: string): Promise<boolean> => ipcRenderer.invoke('tab:close-others', keepId),
  closeRight: (fromId: string): Promise<boolean> => ipcRenderer.invoke('tab:close-right', fromId),
  duplicate: (id: string): Promise<TabSessionPayload | null> =>
    ipcRenderer.invoke('tab:duplicate', id),
  showContextMenu: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('tab:show-context-menu', { tabId }),
  setColor: (id: string, color: TabColorPayload): Promise<boolean> =>
    ipcRenderer.invoke('tab:set-color', id, color),
  setPinned: (id: string, pinned: boolean): Promise<boolean> =>
    ipcRenderer.invoke('tab:set-pinned', id, pinned),
  getThumbnail: (
    id: string
  ): Promise<{ dataUrl: string; capturedAt: number; width: number; height: number } | null> =>
    ipcRenderer.invoke('tab:get-thumbnail', id),
  reopen: (): Promise<TabSessionPayload | null> => ipcRenderer.invoke('tab:reopen'),
  reopenSize: (): Promise<number> => ipcRenderer.invoke('tab:reopen-size'),
  onListUpdate: (handler: (snapshot: TabListSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, snap: TabListSnapshot): void => handler(snap)
    ipcRenderer.on('tab:list-update', listener)
    return () => ipcRenderer.removeListener('tab:list-update', listener)
  }
}

const browserApi = {
  navigate: (url: string): Promise<NavigateResult> => ipcRenderer.invoke('navigate', url),
  goBack: (): Promise<boolean> => ipcRenderer.invoke('go-back'),
  goForward: (): Promise<boolean> => ipcRenderer.invoke('go-forward'),
  reload: (): Promise<boolean> => ipcRenderer.invoke('reload'),
  getCurrentUrl: (): Promise<string> => ipcRenderer.invoke('get-current-url'),
  getViewId: (): Promise<number | null> => ipcRenderer.invoke('browser:get-view-id'),
  setPanelOpen: (open: boolean): Promise<void> => ipcRenderer.invoke('panel:set-open', open),
  setViewVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('app:set-view-visible', visible),
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
  removeRule: (args: DomainRule): Promise<void> => ipcRenderer.invoke('privacy:remove-rule', args),
  getRules: (): Promise<{ userRules: DomainRule[] }> => ipcRenderer.invoke('privacy:get-rules'),
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

// Sprint 016 M2 T11 — cache:* IPC + cacheApi 통째 폐기. renderer 호출자 0 확인 후 제거.
//   selection 번역 캐시는 T10 (executeTranslateRequest → chat 마이그레이션) 시점에 AIResponseCache 직접 책임.

// Sprint 016 M2 T12 — PageResultStore 어댑터 + pageResultApi + PageCachePanel UI 통째 폐기 (KI-002 closed).
//   v0.4 인덱싱 통계는 memoryApi (memory:stats) 가 흡수.

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

interface UserSettingPayload {
  translationMode: 'panel' | 'replace' | 'overlay'
  defaultLanguage?: string
  sourceLanguage?: string
  defaultProviderId?: string
  privacyFilterEnabled?: boolean
  cancelOnTabSwitch?: boolean
  onboardingShown?: boolean
}

const userSettingApi = {
  get: (): Promise<UserSettingPayload> => ipcRenderer.invoke('userSetting:get'),
  update: (patch: Partial<UserSettingPayload>): Promise<UserSettingPayload> =>
    ipcRenderer.invoke('userSetting:update', patch)
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

// Sprint 015 M2-5 — legacy page-translation request/event payload types removed.
//   Details: PRD §19.5.1 M2-5.

const translateApi = {
  request: (args: TranslateRequest) => ipcRenderer.invoke('translate:request', args)
  // Sprint 015 M2-6 — render / renderRestore API 제거 (translate:render / translate:render-restore IPC 폐기).
  // Sprint 015 M2-5 — legacy page-translation APIs and listeners removed.
  // Sprint 015 M2-4 — 페이지 요약 API/listener 제거. 상세: PRD §19.5.1.
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

// Sprint 015 M2-4 — 페이지 요약 Payload 타입 4종 제거. 상세: PRD §19.5.1 M2-4.

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

interface CodexUserCodeResult {
  deviceAuthId: string
  userCode: string
  interval: number
  verificationUrl: string
}

interface CodexPollStatus {
  status: 'idle' | 'pending' | 'success' | 'expired' | 'denied' | 'error'
  errorReason?: string
}

const codexApi = {
  startLogin: (): Promise<CodexUserCodeResult> => ipcRenderer.invoke('codex:start-login'),
  pollStatus: (): Promise<CodexPollStatus> => ipcRenderer.invoke('codex:poll-status'),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke('codex:cancel-login'),
  logout: (): Promise<boolean> => ipcRenderer.invoke('codex:logout'),
  status: (): Promise<'active' | 'expired' | 'none'> => ipcRenderer.invoke('codex:status')
}

// Sprint 015 M5-1 — SearchBar + Shortcut API.
// search:* IPC 는 M5-1 시점에 stub (빈 결과). M5-3 SearchService 도입 시 완성.
type ShortcutBindingId = 'searchBar.focus'

interface ShortcutBindingPayload {
  id: ShortcutBindingId
  accelerator: string
}

interface SearchResultMatch {
  start: number
  end: number
}

interface SearchResultPayload {
  pageId: string
  type: 'page' | 'note'
  title: string
  url: string
  visitedAt: number
  dwellMs: number
  excerpt: string
  /**
   * Sprint 015 M5-4 — excerpt 내 query 토큰 매칭 위치 (start inclusive / end exclusive).
   * renderer SearchResultCard 가 `<mark>` 로 highlight. 매칭 0 건 시 빈 배열.
   */
  matchPositions: SearchResultMatch[]
  score: number
}

interface SearchQueryResponse {
  results: SearchResultPayload[]
  /** 'stub' 는 M5-3b 도입으로 폐기 — renderer 는 'empty' 와 동일 처리 권고 (호환 유지). */
  status: 'ok' | 'empty' | 'error' | 'stub'
  error?: string
  /** TimeRangeParser 매칭 시점 (M5-3b 도입). 시간 표현 부재 시 null. */
  timeRange?: { from: number; to: number } | null
  /** 매칭된 원본 시간 표현 ("지난주" / "2026-05-01" 등). UI 표시 / debug 용. */
  matchedTimeExpression?: string | null
}

const searchApi = {
  query: (args: { query: string; topN?: number }): Promise<SearchQueryResponse> =>
    ipcRenderer.invoke('search:query', args),
  getContent: (args: { pageId: string }): Promise<{ content: string; title: string; url: string } | null> =>
    ipcRenderer.invoke('search:get-content', args)
}

// Sprint 015 M5-6 — chat IPC (ChatService + AiChatHistoryStore).
interface ChatRetrievedItemPayload {
  type: 'page' | 'note'
  id: string
  page_id?: string
  visit_id?: string
}

interface SerializedChatRowPayload {
  id: string
  workspaceId: string
  pageId: string | null
  visitId: string | null
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  retrievedItems: ChatRetrievedItemPayload[] | null
  chatMeta: unknown | null
  status: 'ok' | 'pending' | 'failed' | 'aborted'
  createdAt: number
}

interface ChatRequestArgsPayload {
  workspaceId?: string
  userMessage: string
  pageId?: string | null
  visitId?: string | null
  levelPreference?: 'novice' | 'intermediate' | 'advanced' | null
  customSystemPrompt?: string
  modelHint?: string
  allowedProviders?: ReadonlyArray<'openai' | 'codex' | 'anthropic' | 'gemini' | 'local'>
}

interface ChatRequestResponsePayload {
  status: 'ok' | 'error'
  messages?: SerializedChatRowPayload[]
  error?: string
  errorCode?: 'byok_required' | 'chat_unsupported' | 'provider_error' | 'invalid_input'
}

const chatApi = {
  request: (args: ChatRequestArgsPayload): Promise<ChatRequestResponsePayload> =>
    ipcRenderer.invoke('chat:request', args),
  listHistory: (args: { workspaceId?: string } = {}): Promise<{ messages: SerializedChatRowPayload[] }> =>
    ipcRenderer.invoke('chat:list-history', args)
}

// Sprint 015 M5-7 — note IPC (NoteService).
interface SerializedNoteRowPayload {
  id: string
  workspaceId: string
  pageId: string | null
  visitId: string | null
  selectedText: string
  body: string | null
  aiTags: string[] | null
  createdAt: number
  createdBy: 'user' | 'migration'
}

interface NoteCreateArgsPayload {
  workspaceId?: string
  selectedText: string
  pageId?: string | null
  visitId?: string | null
  body?: string | null
  initialTags?: string[]
  enableAutoTagging?: boolean
}

interface NoteCreateResponsePayload {
  ok: boolean
  note?: SerializedNoteRowPayload
  embeddingJobId?: string
  autoTaggingStatus?: 'tagged' | 'skipped' | 'failed' | 'not_called'
  error?: string
  errorCode?: 'invalid_input' | 'infra_unavailable'
}

const noteApi = {
  create: (args: NoteCreateArgsPayload): Promise<NoteCreateResponsePayload> =>
    ipcRenderer.invoke('note:create', args),
  list: (args: { workspaceId?: string } = {}): Promise<{ notes: SerializedNoteRowPayload[] }> =>
    ipcRenderer.invoke('note:list', args),
  delete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('note:delete', { id })
}

const shortcutApi = {
  getBindings: (): Promise<ShortcutBindingPayload[]> =>
    ipcRenderer.invoke('shortcut:get-bindings'),
  setBinding: (
    id: ShortcutBindingId,
    accelerator: string
  ): Promise<
    | { ok: true; binding: ShortcutBindingPayload }
    | { ok: false; error: string; conflictsWith?: ShortcutBindingId }
  > => ipcRenderer.invoke('shortcut:set-binding', { id, accelerator }),
  onInvoke: (handler: (id: ShortcutBindingId) => void): (() => void) => {
    const listener = (_e: unknown, id: ShortcutBindingId): void => handler(id)
    ipcRenderer.on('shortcut:invoke', listener)
    return () => ipcRenderer.removeListener('shortcut:invoke', listener)
  }
}

// Sprint 015 M6 T28 — workspace IPC (WorkspaceService).
type WorkspaceLevelPreference = 'novice' | 'intermediate' | 'advanced' | null

interface SerializedWorkspacePayload {
  id: string
  name: string
  icon: string
  createdAt: number
  levelPreference: WorkspaceLevelPreference
}

interface WorkspaceListResponsePayload {
  workspaces: SerializedWorkspacePayload[]
  activeId: string | null
}

interface WorkspaceMutationResponsePayload {
  ok: boolean
  workspace?: SerializedWorkspacePayload
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found' | 'no_change'
}

interface WorkspaceSwitchResponsePayload {
  ok: boolean
  active?: SerializedWorkspacePayload
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found'
}

interface WorkspaceDeleteResponsePayload {
  ok: boolean
  replacement?: SerializedWorkspacePayload
  newActiveId?: string
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found'
}

interface WorkspaceSwitchedPayload {
  workspaceId: string
}

const workspaceApi = {
  list: (): Promise<WorkspaceListResponsePayload> => ipcRenderer.invoke('workspace:list'),
  getCurrent: (): Promise<SerializedWorkspacePayload | null> =>
    ipcRenderer.invoke('workspace:get-current'),
  create: (args: {
    name: string
    icon: string
    levelPreference?: WorkspaceLevelPreference
  }): Promise<WorkspaceMutationResponsePayload> => ipcRenderer.invoke('workspace:create', args),
  update: (args: {
    id: string
    patch: { name?: string; icon?: string; levelPreference?: WorkspaceLevelPreference }
  }): Promise<WorkspaceMutationResponsePayload> => ipcRenderer.invoke('workspace:update', args),
  switch: (id: string): Promise<WorkspaceSwitchResponsePayload> =>
    ipcRenderer.invoke('workspace:switch', { id }),
  delete: (id: string): Promise<WorkspaceDeleteResponsePayload> =>
    ipcRenderer.invoke('workspace:delete', { id }),
  /**
   * Sprint 016 M0 T03c (KI-007) — 워크스페이스 전환 broadcast 구독.
   * main 측 workspaceSwitchHook 가 fire — TabBar / WorkspaceSidebar 가 활성 ws state 재로드.
   */
  onSwitched: (handler: (payload: WorkspaceSwitchedPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: WorkspaceSwitchedPayload): void => handler(payload)
    ipcRenderer.on('workspace:switched', listener)
    return () => ipcRenderer.removeListener('workspace:switched', listener)
  }
}

// Sprint 015 M6 T29 — memory IPC (MemoryService).
interface MemoryStatsPayload {
  workspaceId: string
  pagesCount: number
  visitsCount: number
  notesCount: number
  chatMessagesCount: number
  lastIndexedAt: number | null
}

interface MemoryStatsResponsePayload {
  ok: boolean
  stats?: MemoryStatsPayload
  errorCode?: 'infra_unavailable' | 'no_active_workspace'
}

interface MemoryInvalidatedPayload {
  workspaceId: string
}

const memoryApi = {
  stats: (args: { workspaceId?: string } = {}): Promise<MemoryStatsResponsePayload> =>
    ipcRenderer.invoke('memory:stats', args),
  /**
   * T29 hotfix — PRD §07.4.2 broadcast.
   * main → renderer 브로드캐스트 (chat / note INSERT 후 즉시 fire).
   * 호출자 (MemoryStatsPanel) 가 받으면 stats() 즉시 재호출.
   */
  onInvalidated: (handler: (payload: MemoryInvalidatedPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: MemoryInvalidatedPayload): void => handler(payload)
    ipcRenderer.on('memory:stats-invalidated', listener)
    return () => ipcRenderer.removeListener('memory:stats-invalidated', listener)
  }
}

contextBridge.exposeInMainWorld('searchApi', searchApi)
contextBridge.exposeInMainWorld('chatApi', chatApi)
contextBridge.exposeInMainWorld('noteApi', noteApi)
contextBridge.exposeInMainWorld('shortcutApi', shortcutApi)
contextBridge.exposeInMainWorld('workspaceApi', workspaceApi)
contextBridge.exposeInMainWorld('memoryApi', memoryApi)
contextBridge.exposeInMainWorld('codexApi', codexApi)
contextBridge.exposeInMainWorld('browserApi', browserApi)
contextBridge.exposeInMainWorld('tabApi', tabApi)
contextBridge.exposeInMainWorld('consentApi', consentApi)
contextBridge.exposeInMainWorld('credentialApi', credentialApi)
contextBridge.exposeInMainWorld('privacyApi', privacyApi)
contextBridge.exposeInMainWorld('usageApi', usageApi)
contextBridge.exposeInMainWorld('glossaryApi', glossaryApi)
contextBridge.exposeInMainWorld('userSettingApi', userSettingApi)
contextBridge.exposeInMainWorld('translateApi', translateApi)
contextBridge.exposeInMainWorld('popupApi', popupApi)

export type BrowserApi = typeof browserApi
export type CodexApi = typeof codexApi
export type TabApi = typeof tabApi
export type ConsentApi = typeof consentApi
export type CredentialApi = typeof credentialApi
export type PrivacyApi = typeof privacyApi
export type UsageApi = typeof usageApi
export type GlossaryApi = typeof glossaryApi
export type UserSettingApi = typeof userSettingApi
export type TranslateApi = typeof translateApi
export type PopupApi = typeof popupApi
export type SearchApi = typeof searchApi
export type ChatApi = typeof chatApi
export type NoteApi = typeof noteApi
export type ShortcutApi = typeof shortcutApi
export type WorkspaceApi = typeof workspaceApi
export type MemoryApi = typeof memoryApi
