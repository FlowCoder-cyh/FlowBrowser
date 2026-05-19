/**
 * Main 프로세스 서비스 초기화 + IPC 등록.
 * Privacy / Credentials / UsageLog / Provider 통합 진입점.
 */

import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import {
  ConsentGate,
  DomainFilter,
  DomainPolicyStore,
  TransmissionLogger,
  defaultDomainPolicyPath,
  defaultLogFilePath,
  evaluatePrivacy,
  detectSensitiveFieldsScript,
  type ConsentState,
  type DomainFilterRule,
  type DomainFilterState,
  type DomainPolicyExport,
  type PrivacyDecision
} from '../privacy'

import {
  CredentialsStore,
  UsageLog,
  TranslationCache,
  GlossaryStore,
  UserSettingStore,
  PageResultStore,
  TabStateStore,
  ShortcutStore,
  ShortcutConflictError,
  FlowbrowserDatabase,
  VectorIndex,
  IndexedPageStoreSqlite,
  NoteStore,
  AiChatHistoryStore,
  EmbeddingQueue,
  defaultCredentialsPath,
  defaultUsageLogPath,
  defaultTranslationCachePath,
  defaultGlossaryPath,
  defaultUserSettingPath,
  defaultPageResultPath,
  defaultTabStatePath,
  defaultShortcutPath,
  formatGlossaryContext,
  type CredentialRecord,
  type CredentialProviderType,
  type GlossaryTerm,
  type GlossaryExport,
  type UserSettingState,
  type ShortcutBinding,
  type ShortcutBindingId
} from '../storage'
import { SearchService } from './SearchService'
import {
  handleSearchQuery,
  handleSearchGetContent,
  type SearchQueryArgs,
  type SearchQueryResponse
} from './searchHandlers'
import { ChatService } from './ChatService'
import {
  handleChatRequest,
  handleChatListHistory,
  type ChatRequestArgs,
  type ChatRequestResponse,
  type ChatListHistoryArgs,
  type ChatListHistoryResponse
} from './chatHandlers'
import { NoteService } from './NoteService'
import {
  handleNoteCreate,
  handleNoteList,
  handleNoteDelete,
  type NoteCreateArgs,
  type NoteCreateResponse,
  type NoteListArgs,
  type NoteListResponse,
  type NoteDeleteArgs,
  type NoteDeleteResponse
} from './noteHandlers'
import { WorkspaceService } from './WorkspaceService'
import {
  handleWorkspaceList,
  handleWorkspaceGetCurrent,
  handleWorkspaceCreate,
  handleWorkspaceUpdate,
  handleWorkspaceSwitch,
  handleWorkspaceDelete,
  type WorkspaceCreateArgs,
  type WorkspaceUpdateArgs,
  type WorkspaceSwitchArgs,
  type WorkspaceDeleteArgs,
  type WorkspaceMutationResponse,
  type WorkspaceSwitchResponse,
  type WorkspaceDeleteResponse,
  type WorkspaceListResponse,
  type SerializedWorkspace
} from './workspaceHandlers'
import { MemoryService } from './MemoryService'
import {
  handleMemoryStats,
  type MemoryStatsArgs,
  type MemoryStatsResponse
} from './memoryHandlers'

import {
  OpenAIApiKeyProvider,
  CodexLoginProvider,
  DeviceCodeFlow,
  ProviderError,
  type ProviderAdapter,
  type TranslationInput,
  type TranslationOutput,
  type CodexTokenAccess,
  type TokenBundle,
  type UserCodeResult
} from '../ai'
// Sprint 015 M2-8 — retired page-translation extraction imports 제거.
//   M2-5/M2-6 페이지 번역 폐기 후 호출자 0. perception/* 모듈 자체는 M3 IndexingService 가 활용 예정.

interface DiskConsentState {
  globalConsented: boolean
  globalConsentedAt: number | null
  policyVersion: number
}

const POLICY_VERSION = 1

let consentGate!: ConsentGate
let domainFilter!: DomainFilter
let domainPolicyStore!: DomainPolicyStore
let transmissionLogger!: TransmissionLogger
let credentialsStore!: CredentialsStore
let usageLog!: UsageLog
let translationCache!: TranslationCache
let glossaryStore!: GlossaryStore
let userSettingStore!: UserSettingStore
let pageResultStore!: PageResultStore
let tabStateStore!: TabStateStore
let shortcutStore!: ShortcutStore
// Sprint 015 M5-3b — v0.4 SQLite 인프라 wiring (검색 활용).
// FlowbrowserDatabase 가 없으면 search:query / chat:request graceful error 반환.
// Sprint 015 M5-6 — AiChatHistoryStore 추가 (chat 영속).
let flowbrowserDb: FlowbrowserDatabase | null = null
let vectorIndex: VectorIndex | null = null
let indexedPageStore: IndexedPageStoreSqlite | null = null
let noteStore: NoteStore | null = null
let aiChatHistoryStore: AiChatHistoryStore | null = null
let embeddingQueue: EmbeddingQueue | null = null
let searchService: SearchService | null = null
let noteService: NoteService | null = null
let workspaceService: WorkspaceService | null = null
let memoryService: MemoryService | null = null
// Sprint 015 M6 T28 — defaultWorkspaceId 는 fresh install 시 첫 워크스페이스 id (보통 "📥 기본").
//                    activeWorkspaceId 는 사용자 전환 시점에 갱신 — `getActiveWorkspaceId` 로 통합 접근.
let defaultWorkspaceId: string | null = null
const providers: Map<CredentialProviderType, ProviderAdapter> = new Map()

/**
 * Sprint 015 M6 T28 — 활성 워크스페이스 id 통합 getter.
 * WorkspaceService 미초기화 시 fresh install 디폴트 id (또는 null) fallback.
 * Sprint 016 M0 T03c (KI-007) — main/index.ts tab IPC handler 도 호출하기 위해 export.
 */
export function getActiveWorkspaceId(): string | null {
  if (workspaceService) return workspaceService.getActiveId()
  return defaultWorkspaceId
}

/**
 * Sprint 016 M0 T03c (KI-007) — main/index.ts 가 워크스페이스 전환 직후 hook 등록.
 * TabManager.setActiveWorkspaceFilter + 활성 BrowserView refresh 책임.
 * 미등록 시 (테스트 / fresh install) no-op.
 */
let workspaceSwitchHook: ((workspaceId: string) => void) | null = null

export function setWorkspaceSwitchHook(hook: ((workspaceId: string) => void) | null): void {
  workspaceSwitchHook = hook
}

/**
 * Sprint 015 M6 T29 hotfix (codex NEEDS_CHANGES #10) — PRD §07.4.2 broadcast.
 * chat / note / 인덱싱 INSERT 후 renderer 측 MemoryStatsPanel 즉시 refresh 트리거.
 * BrowserWindow.getAllWindows()[0] 미존재 시 (테스트 / headless) no-op.
 */
function broadcastMemoryInvalidated(workspaceId: string | null): void {
  if (!workspaceId) return
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('memory:stats-invalidated', { workspaceId })
    }
  }
}

let consentStatePath!: string
let domainPolicyPath!: string

export async function initServices(): Promise<void> {
  const userDataDir = app.getPath('userData')
  consentStatePath = join(userDataDir, 'consent.json')
  domainPolicyPath = defaultDomainPolicyPath(userDataDir)

  consentGate = new ConsentGate(await loadConsentState(), POLICY_VERSION)
  const loadedDomainState = await DomainPolicyStore.loadFromDisk(domainPolicyPath)
  domainFilter = new DomainFilter(loadedDomainState)
  domainPolicyStore = new DomainPolicyStore(domainPolicyPath, domainFilter)

  transmissionLogger = new TransmissionLogger(defaultLogFilePath(userDataDir))
  await transmissionLogger.loadFromDisk()

  credentialsStore = new CredentialsStore(defaultCredentialsPath(userDataDir))
  await credentialsStore.load()

  usageLog = new UsageLog(defaultUsageLogPath(userDataDir))

  translationCache = new TranslationCache(defaultTranslationCachePath(userDataDir))
  await translationCache.load()

  glossaryStore = new GlossaryStore(defaultGlossaryPath(userDataDir))
  await glossaryStore.load()

  userSettingStore = new UserSettingStore(defaultUserSettingPath(userDataDir))
  await userSettingStore.load()

  pageResultStore = new PageResultStore(defaultPageResultPath(userDataDir))
  await pageResultStore.load()

  tabStateStore = new TabStateStore(defaultTabStatePath(userDataDir))

  shortcutStore = new ShortcutStore(defaultShortcutPath(userDataDir))
  await shortcutStore.load()

  // Sprint 015 M5-3b — v0.4 SQLite 인프라 (FlowbrowserDatabase + VectorIndex + IndexedPageStoreSqlite + NoteStore + SearchService).
  // bootstrap 실패 (sqlite-vec native 로드 실패 등) 시 검색만 graceful disable — 다른 IPC 는 정상 동작.
  // M3 PoC 시점 (specs/m3-spike-decisions.md) windows-x64 검증 완료, macOS 미검증 (KI-001 추적).
  try {
    const dbPath = join(userDataDir, 'flowbrowser.db')
    flowbrowserDb = FlowbrowserDatabase.bootstrap({ path: dbPath })
    const defaultWs = flowbrowserDb.ensureDefaultWorkspace()
    defaultWorkspaceId = defaultWs.id
    vectorIndex = new VectorIndex(flowbrowserDb)
    indexedPageStore = new IndexedPageStoreSqlite(flowbrowserDb, {
      defaultWorkspaceId: defaultWs.id
    })
    noteStore = new NoteStore(flowbrowserDb)
    aiChatHistoryStore = new AiChatHistoryStore(flowbrowserDb)
    embeddingQueue = new EmbeddingQueue(flowbrowserDb)
    searchService = new SearchService({
      vectorIndex,
      pageStore: indexedPageStore,
      noteStore
    })
    noteService = new NoteService({
      noteStore,
      embeddingQueue
      // KI-003 / KI-005 — note 자동 태깅 본 PR 미구현. AutoTagger.tagNote 도입 시 호출자 책임으로 wiring.
    })
    // Sprint 015 M6 T28 — WorkspaceService.
    // UserSetting.activeWorkspaceId 가 null 이면 본 부팅 시 defaultWorkspace id 로 초기화.
    workspaceService = new WorkspaceService({
      db: flowbrowserDb,
      userSettingStore,
      defaultWorkspace: defaultWs
    })
    const persistedActive = (userSettingStore.getState() as { activeWorkspaceId?: string | null })
      .activeWorkspaceId
    if (!persistedActive) {
      await userSettingStore.update({
        activeWorkspaceId: defaultWs.id
      } as never)
    }
    // Sprint 015 M6 T29 — MemoryService.
    memoryService = new MemoryService({
      pageStore: indexedPageStore,
      noteStore,
      chatStore: aiChatHistoryStore
    })
  } catch (err) {
    // 인프라 미준비 — search / chat / note / memory 호출 시 graceful error 반환.
    flowbrowserDb = null
    vectorIndex = null
    indexedPageStore = null
    noteStore = null
    aiChatHistoryStore = null
    embeddingQueue = null
    searchService = null
    noteService = null
    workspaceService = null
    memoryService = null
    defaultWorkspaceId = null
    console.warn(
      '[services] v0.4 SQLite 인프라 bootstrap 실패 — 검색 / 채팅 / 노트 / 워크스페이스 비활성:',
      err instanceof Error ? err.message : String(err)
    )
  }

  registerConsentIpc()
  registerCredentialIpc()
  registerPrivacyIpc()
  registerUsageIpc()
  registerTranslateIpc()
  registerCacheIpc()
  registerGlossaryIpc()
  registerUserSettingIpc()
  registerPageResultIpc()
  registerCodexIpc()
  registerShortcutIpc()
  registerSearchIpc()
  registerChatIpc()
  registerNoteIpc()
  registerWorkspaceIpc()
  registerMemoryIpc()
}

/**
 * Sprint 015 M6 T29 — memory IPC.
 * `memory:stats` — 워크스페이스 통계 (pages / visits / notes / chat messages / lastIndexedAt).
 * 미명시 시 활성 워크스페이스 자동 활용.
 */
function registerMemoryIpc(): void {
  ipcMain.handle(
    'memory:stats',
    (_event, args: MemoryStatsArgs = {}): MemoryStatsResponse => {
      return handleMemoryStats(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getMemoryService: () => memoryService
      })
    }
  )
}

/**
 * Sprint 015 M6 T28 — workspace IPC.
 * `workspace:list` — 전체 워크스페이스 목록 + active id
 * `workspace:get-current` — 활성 워크스페이스
 * `workspace:create` — name + icon (+ levelPreference)
 * `workspace:update` — id + patch
 * `workspace:switch` — id (활성 워크스페이스 변경)
 * `workspace:delete` — id (마지막 1개 삭제 시 자동 "📥 기본" 재생성)
 *
 * 인프라 미초기화 시 graceful empty / error 응답.
 */
function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:list', (): WorkspaceListResponse => {
    return handleWorkspaceList({ getService: () => workspaceService })
  })
  ipcMain.handle(
    'workspace:get-current',
    (): SerializedWorkspace | null => {
      return handleWorkspaceGetCurrent({ getService: () => workspaceService })
    }
  )
  ipcMain.handle(
    'workspace:create',
    async (_event, args: WorkspaceCreateArgs): Promise<WorkspaceMutationResponse> => {
      return handleWorkspaceCreate(args, { getService: () => workspaceService })
    }
  )
  ipcMain.handle(
    'workspace:update',
    async (_event, args: WorkspaceUpdateArgs): Promise<WorkspaceMutationResponse> => {
      return handleWorkspaceUpdate(args, { getService: () => workspaceService })
    }
  )
  ipcMain.handle(
    'workspace:switch',
    async (_event, args: WorkspaceSwitchArgs): Promise<WorkspaceSwitchResponse> => {
      return handleWorkspaceSwitch(args, {
        getService: () => workspaceService,
        // Sprint 016 M0 T03c (KI-007) — main/index.ts 가 등록한 후속 wiring callback (TabManager 필터 + BrowserView refresh).
        onWorkspaceSwitched: (ws) => {
          if (workspaceSwitchHook) workspaceSwitchHook(ws)
        }
      })
    }
  )
  ipcMain.handle(
    'workspace:delete',
    async (_event, args: WorkspaceDeleteArgs): Promise<WorkspaceDeleteResponse> => {
      return handleWorkspaceDelete(args, { getService: () => workspaceService })
    }
  )
}

/** Sprint 015 M5-1 — ShortcutStore 접근 헬퍼 (main/index.ts before-input-event 매칭에 사용). */
export function getShortcutBindings(): ShortcutBinding[] {
  return shortcutStore.getBindings()
}

function registerShortcutIpc(): void {
  ipcMain.handle('shortcut:get-bindings', (): ShortcutBinding[] => shortcutStore.getBindings())
  ipcMain.handle(
    'shortcut:set-binding',
    async (
      _event,
      args: { id: ShortcutBindingId; accelerator: string }
    ): Promise<{ ok: true; binding: ShortcutBinding } | { ok: false; error: string; conflictsWith?: ShortcutBindingId }> => {
      try {
        const binding = await shortcutStore.setBinding(args.id, args.accelerator)
        return { ok: true, binding }
      } catch (err) {
        if (err instanceof ShortcutConflictError) {
          return { ok: false, error: 'conflict', conflictsWith: err.conflictsWith }
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

/**
 * Sprint 015 M5-3b — search IPC 실 구현.
 *
 * `search:query` — TimeRangeParser → EmbeddingClient.embedText → SearchService.search → paginate → SearchResultPayload[]
 * `search:get-content` — IndexedPageStoreSqlite.getPage(pageId)
 *
 * pure logic 은 `searchHandlers.ts` 로 추출 (단위 테스트 가능). 본 handler 는 thin wrapper.
 * 의존은 lazy resolver — provider 변경 / DB 미초기화 시점에 매번 새로 풀어옴.
 */
function registerSearchIpc(): void {
  ipcMain.handle(
    'search:query',
    async (_event, args: SearchQueryArgs): Promise<SearchQueryResponse> => {
      return handleSearchQuery(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getEmbeddingProvider: () => providers.get('openai') ?? null,
        getSearchService: () => searchService
      })
    }
  )
  ipcMain.handle(
    'search:get-content',
    (
      _event,
      args: { pageId: string }
    ): { content: string; title: string; url: string } | null => {
      return handleSearchGetContent(args, { pageStore: indexedPageStore })
    }
  )
}

/**
 * Sprint 015 M5-6 — chat IPC.
 * `chat:request` — workspace 메모리 retrieval + ChatService.chat() + AiChatHistoryStore 영속.
 * `chat:list-history` — AiChatHistoryStore.listByWorkspace.
 *
 * KI-003 BYOK wiring — ChatService 의 디폴트 allowedProviders=['openai'] 강제.
 * 사용자 명시 동의 시 args.allowedProviders override (UI 책임).
 */
function registerChatIpc(): void {
  ipcMain.handle(
    'chat:request',
    async (_event, args: ChatRequestArgs): Promise<ChatRequestResponse> => {
      const response = await handleChatRequest(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getChatService: ({ allowedProviders }) => {
          if (!aiChatHistoryStore) return null
          // codex M5-6 PR #158 NEEDS_CHANGES N-001 정정 — provider 선택을 allowedProviders 기반으로.
          // 기존: providers.get('openai') 하드코딩 → Codex-only 사용자 채팅 전면 불능.
          // 정정: allowedProviders (호출자 명시) 또는 디폴트 ['openai'] 중 등록된 첫 provider 선택.
          const candidates: ReadonlyArray<CredentialProviderType> =
            (allowedProviders as ReadonlyArray<CredentialProviderType>) ?? ['openai']
          let selected: ProviderAdapter | undefined
          for (const t of candidates) {
            const p = providers.get(t)
            if (p) {
              selected = p
              break
            }
          }
          if (!selected) return null
          return new ChatService({
            provider: selected,
            historyStore: aiChatHistoryStore,
            allowedProviders: allowedProviders as
              | ReadonlyArray<'openai' | 'codex' | 'anthropic' | 'gemini' | 'local'>
              | undefined
          })
        },
        historyStore: aiChatHistoryStore
      })
      // T29 hotfix — PRD §07.4.2 AI 채팅 broadcast.
      if (response.status === 'ok') {
        broadcastMemoryInvalidated(args.workspaceId ?? getActiveWorkspaceId())
      }
      return response
    }
  )
  ipcMain.handle(
    'chat:list-history',
    (_event, args: ChatListHistoryArgs): ChatListHistoryResponse => {
      return handleChatListHistory(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        historyStore: aiChatHistoryStore
      })
    }
  )
}

/**
 * Sprint 015 M5-7 — note IPC.
 * `note:create` — NoteService.createNote (NoteStore + EmbeddingQueue + optional AutoTagger)
 * `note:list` — NoteService.listNotes (workspace 별)
 * `note:delete` — NoteService.deleteNote
 *
 * KI-003 BYOK 정합: AutoTagger 자동 호출 차단 — 본 PR 인프라 wiring 미주입 (autoTagger=undefined).
 * 호출자가 명시 동의 후 NoteService 인스턴스에 autoTagger 주입 (Sprint 016+ 또는 사용자 settings UI).
 */
function registerNoteIpc(): void {
  ipcMain.handle(
    'note:create',
    async (_event, args: NoteCreateArgs): Promise<NoteCreateResponse> => {
      const response = await handleNoteCreate(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getNoteService: () => noteService
      })
      // T29 hotfix — PRD §07.4.2 노트 생성 broadcast.
      if (response.ok) {
        broadcastMemoryInvalidated(args.workspaceId ?? getActiveWorkspaceId())
      }
      return response
    }
  )
  ipcMain.handle(
    'note:list',
    (_event, args: NoteListArgs): NoteListResponse => {
      return handleNoteList(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getNoteService: () => noteService
      })
    }
  )
  ipcMain.handle(
    'note:delete',
    (_event, args: NoteDeleteArgs): NoteDeleteResponse => {
      const response = handleNoteDelete(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getNoteService: () => noteService
      })
      // T29 hotfix — 노트 삭제 시에도 broadcast (활성 ws 의 notesCount 변경).
      if (response.ok) {
        broadcastMemoryInvalidated(getActiveWorkspaceId())
      }
      return response
    }
  )
}

function registerPageResultIpc(): void {
  // Sprint 015 M2-8 — retired page-result lookup/store IPC handlers 제거.
  //   M2-5/M2-6 페이지 번역 폐기 후 renderer 호출 0. stats/clear 는 PageCachePanel 유지.
  ipcMain.handle('pageResult:stats', () => pageResultStore.stats())
  ipcMain.handle('pageResult:clear', async (): Promise<void> => pageResultStore.clearAll())
}

// Sprint 015 M2-8 — retired page-result helper exports 제거.
//   M2-5/M2-6 폐기 후 호출자 0. M5 어댑터 제거 시 pageResultStore 인스턴스 자체 폐기.

/**
 * Sprint 009 M3 — TabStateStore 접근 헬퍼.
 */
export async function loadTabState(): Promise<
  import('../storage/TabStateStore').PersistedTabState
> {
  return tabStateStore.load()
}

export async function saveTabState(state: {
  tabs: import('../storage/TabStateStore').PersistedTabSession[]
  activeId: string | null
}): Promise<void> {
  await tabStateStore.save(state)
}

/**
 * Sprint 010 M3 — main/index.ts에서 cancelOnTabSwitch 분기에 사용.
 */
export function getUserSetting(): UserSettingState {
  return userSettingStore.getState()
}

function registerUserSettingIpc(): void {
  ipcMain.handle('userSetting:get', (): UserSettingState => userSettingStore.getState())
  ipcMain.handle(
    'userSetting:update',
    async (_event, patch: Partial<UserSettingState>): Promise<UserSettingState> =>
      userSettingStore.update(patch)
  )
}

function registerCacheIpc(): void {
  ipcMain.handle('cache:stats', () => translationCache.stats())
  ipcMain.handle('cache:clear-all', async (): Promise<void> => {
    await translationCache.clearAll()
  })
  ipcMain.handle(
    'cache:invalidate-glossary',
    async (_event, version: string): Promise<number> =>
      translationCache.invalidateByGlossaryVersion(version)
  )
}

function registerGlossaryIpc(): void {
  ipcMain.handle('glossary:list', (): GlossaryTerm[] => glossaryStore.list())

  ipcMain.handle('glossary:version', (): string => glossaryStore.getVersion())

  ipcMain.handle(
    'glossary:add',
    async (
      _event,
      args: {
        sourceTerm: string
        targetTerm: string
        description?: string
        domain?: string
        isActive?: boolean
      }
    ): Promise<{ ok: boolean; error?: string; term?: GlossaryTerm }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.add(args)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return { ok: result.ok, error: result.error, term: result.term }
    }
  )

  ipcMain.handle(
    'glossary:update',
    async (
      _event,
      args: {
        id: string
        patch: Partial<
          Pick<GlossaryTerm, 'sourceTerm' | 'targetTerm' | 'description' | 'domain' | 'isActive'>
        >
      }
    ): Promise<{ ok: boolean; term?: GlossaryTerm }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.update(args.id, args.patch)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return result
    }
  )

  ipcMain.handle('glossary:remove', async (_event, id: string): Promise<boolean> => {
    const prevVersion = glossaryStore.getVersion()
    const removed = await glossaryStore.remove(id)
    if (removed) {
      await translationCache.invalidateByGlossaryVersion(prevVersion)
    }
    return removed
  })

  ipcMain.handle('glossary:clear', async (): Promise<void> => {
    const prevVersion = glossaryStore.getVersion()
    await glossaryStore.clearAll()
    await translationCache.invalidateByGlossaryVersion(prevVersion)
  })

  ipcMain.handle('glossary:export', (): GlossaryExport => glossaryStore.exportTerms())

  ipcMain.handle(
    'glossary:import',
    async (
      _event,
      raw: unknown
    ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.importTerms(raw)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return result
    }
  )
}

async function loadConsentState(): Promise<ConsentState> {
  try {
    const buf = await fs.readFile(consentStatePath, 'utf-8')
    const parsed = JSON.parse(buf) as DiskConsentState
    return {
      globalConsented: !!parsed.globalConsented,
      globalConsentedAt: parsed.globalConsentedAt ?? null,
      policyVersion: parsed.policyVersion ?? POLICY_VERSION
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { globalConsented: false, globalConsentedAt: null, policyVersion: POLICY_VERSION }
    }
    throw err
  }
}

async function persistConsentState(): Promise<void> {
  await fs.writeFile(consentStatePath, JSON.stringify(consentGate.getState(), null, 2), 'utf-8')
}

function registerConsentIpc(): void {
  ipcMain.handle('consent:get', (): ConsentState => consentGate.getState())

  ipcMain.handle('consent:give', async (): Promise<ConsentState> => {
    const state = consentGate.giveGlobalConsent()
    await persistConsentState()
    return state
  })

  ipcMain.handle('consent:revoke', async (): Promise<void> => {
    consentGate.revokeGlobalConsent()
    await persistConsentState()
  })
}

function registerCredentialIpc(): void {
  ipcMain.handle('credential:list', (): CredentialRecord[] => credentialsStore.list())

  ipcMain.handle(
    'credential:save',
    async (
      _event,
      args: {
        providerType: CredentialProviderType
        displayName: string
        secret: string
        authType: 'oauth' | 'api_key' | 'local'
      }
    ): Promise<CredentialRecord> => {
      const rec = await credentialsStore.upsert(args)
      rebuildProvider(args.providerType)
      return rec
    }
  )

  ipcMain.handle(
    'credential:delete',
    async (_event, providerType: CredentialProviderType): Promise<boolean> => {
      providers.delete(providerType)
      return credentialsStore.remove(providerType)
    }
  )

  ipcMain.handle(
    'credential:validate',
    async (
      _event,
      providerType: CredentialProviderType
    ): Promise<{ ok: boolean; reason?: string }> => {
      const provider = providers.get(providerType)
      if (!provider) return { ok: false, reason: 'Provider 미초기화. credential:save 먼저.' }
      const result = await provider.validate()
      await credentialsStore.markValidated(providerType, result.ok ? 'active' : 'invalid')
      return result
    }
  )
}

function registerPrivacyIpc(): void {
  ipcMain.handle(
    'privacy:scan-page',
    async (
      _event,
      webContentsId: number
    ): Promise<{ hasPasswordField: boolean; hasCardField: boolean } | null> => {
      const wc = WebContentsRegistry.get(webContentsId)
      if (!wc) return null
      try {
        const result = (await wc.executeJavaScript(detectSensitiveFieldsScript())) as {
          hasPasswordField: boolean
          hasCardField: boolean
        }
        return result
      } catch {
        return null
      }
    }
  )

  ipcMain.handle('privacy:approve', (_event, domain: string): { token: string } => {
    const token = consentGate.issueApprovalToken(domain)
    return { token }
  })

  ipcMain.handle(
    'privacy:add-rule',
    async (_event, rule: DomainFilterRule): Promise<{ ok: boolean; error?: string }> => {
      const result = await domainPolicyStore.addRule(rule)
      return { ok: result.ok, error: result.error }
    }
  )

  ipcMain.handle(
    'privacy:remove-rule',
    async (_event, args: { pattern: string; type: 'blacklist' | 'whitelist' }): Promise<void> => {
      await domainPolicyStore.removeRule({ pattern: args.pattern, type: args.type })
    }
  )

  ipcMain.handle('privacy:get-rules', (): DomainFilterState => domainPolicyStore.getState())

  ipcMain.handle(
    'privacy:set-rules',
    async (_event, rules: DomainFilterRule[]): Promise<{ accepted: number; rejected: number }> =>
      domainPolicyStore.setRules(rules)
  )

  ipcMain.handle(
    'privacy:export-policy',
    (): DomainPolicyExport => domainPolicyStore.exportPolicy()
  )

  ipcMain.handle(
    'privacy:import-policy',
    async (
      _event,
      raw: unknown
    ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> =>
      domainPolicyStore.importPolicy(raw)
  )

  ipcMain.handle('privacy:clear-policy', async (): Promise<void> => domainPolicyStore.clearAll())

  ipcMain.handle('privacy:blocked-stats', () => transmissionLogger.getBlockedStats())
}

function registerUsageIpc(): void {
  ipcMain.handle('usage:summary', async (_event, sinceMs?: number) => usageLog.summarize(sinceMs))
  ipcMain.handle('usage:list', async (_event, sinceMs?: number) =>
    sinceMs ? usageLog.readSince(sinceMs) : usageLog.readAll()
  )
  ipcMain.handle('usage:clear-all', async (): Promise<void> => {
    await usageLog.clearAll()
  })
  ipcMain.handle(
    'usage:purge-older-than',
    async (_event, beforeMs: number): Promise<number> => usageLog.purgeOlderThan(beforeMs)
  )
}

interface TranslateArgs {
  providerType: CredentialProviderType
  input: TranslationInput
  context: {
    url: string
    hasPasswordField?: boolean
    hasCardField?: boolean
    manualApprovalToken?: string
  }
}

export interface TranslateResult {
  ok: boolean
  output?: TranslationOutput
  decision: PrivacyDecision | 'no_provider' | 'provider_error'
  reason?: string
  fromCache?: boolean
  /**
   * Sprint 003 M1: 차단 시에만 의미. true면 페이지 전체 차단 (호출자가 일괄 중단).
   * `decision !== 'blocked'` 시 undefined.
   */
  pageWideBlock?: boolean
  /**
   * Sprint 003 M1: 차단 사유 enum (UI 분기용). 차단 외에는 'none'.
   */
  blockReason?: import('../privacy/types').BlockReason
}

export async function executeTranslateRequest(args: TranslateArgs): Promise<TranslateResult> {
  const domain = extractDomain(args.context.url)

  // Sprint 007 M1 — privacyFilterEnabled false 시 domain 차단 우회.
  // 단, password/card 본문 패턴은 항상 적용 (G-004 안전 정책 무력화 금지).
  const userSetting = userSettingStore.getState()
  const evalDomains = userSetting.privacyFilterEnabled ? domainFilter : new DomainFilter()
  const evalContext = userSetting.privacyFilterEnabled
    ? {
        url: args.context.url,
        domain,
        hasPasswordField: args.context.hasPasswordField ?? false,
        hasCardField: args.context.hasCardField ?? false,
        manualApprovalToken: args.context.manualApprovalToken
      }
    : {
        url: args.context.url,
        domain,
        hasPasswordField: args.context.hasPasswordField ?? false,
        hasCardField: args.context.hasCardField ?? false
      }

  const evaluation = evaluatePrivacy({
    context: evalContext,
    text: args.input.sourceText,
    consent: consentGate,
    domains: evalDomains
  })

  if (evaluation.decision === 'blocked') {
    transmissionLogger.recordBlock({
      timestamp: Date.now(),
      url: args.context.url,
      domain,
      decision: 'blocked',
      feature: 'translation',
      reason: evaluation.reason
    })
    return {
      ok: false,
      decision: 'blocked',
      reason: evaluation.reason,
      pageWideBlock: evaluation.pageWideBlock,
      blockReason: evaluation.blockReason
    }
  }

  // Sprint 005 M2 — 활성 용어집 추출. explanation/summary는 의역이라 적용 안 함.
  const applyGlossary =
    args.input.requestType !== 'explanation' && args.input.requestType !== 'summary'
  const glossaryVersion = applyGlossary ? glossaryStore.getVersion() : 'default'
  const glossaryTerms: GlossaryTerm[] = applyGlossary
    ? glossaryStore.getActiveForDomain(domain || null)
    : []
  const glossaryContext = formatGlossaryContext(glossaryTerms)

  // Cache lookup (Privacy Filter 통과 후, Provider 호출 전).
  // Sprint 005 M1: 캐시 키에 requestType 포함 → explanation/summary도 정상 캐싱.
  // Sprint 005 M2: glossaryVersion이 키의 일부 → 용어집 mutation 시 자동 invalidation.
  const cached = await translationCache.lookup({
    sourceText: args.input.sourceText,
    sourceLanguage: args.input.sourceLanguage,
    targetLanguage: args.input.targetLanguage,
    providerType: args.providerType,
    requestType: args.input.requestType,
    glossaryVersion
  })
  if (cached) {
    return {
      ok: true,
      decision: evaluation.decision,
      fromCache: true,
      output: {
        translatedText: cached.translatedText,
        modelUsed: `${args.providerType}/cache`,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: 0
      }
    }
  }

  const usageFeature: import('../storage').Feature = featureFromRequestType(args.input.requestType)

  const provider = providers.get(args.providerType)
  if (!provider) {
    return {
      ok: false,
      decision: 'no_provider',
      reason: `Provider 미초기화: ${args.providerType}. 설정에서 등록해 주세요.`
    }
  }

  try {
    const inputWithGlossary = glossaryContext
      ? {
          ...args.input,
          context: {
            ...(args.input.context ?? {}),
            surroundingText: [args.input.context?.surroundingText, glossaryContext]
              .filter(Boolean)
              .join('\n\n')
          }
        }
      : args.input
    const output = await provider.translate(inputWithGlossary)
    await translationCache.store({
      sourceText: args.input.sourceText,
      sourceLanguage: args.input.sourceLanguage,
      targetLanguage: args.input.targetLanguage,
      providerType: args.providerType,
      requestType: args.input.requestType,
      glossaryVersion,
      translatedText: output.translatedText,
      domain,
      isSubtitle: args.input.requestType === 'subtitle'
    })
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: usageFeature,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      audioSeconds: 0,
      estimatedCostUsd: output.estimatedCostUsd,
      domain,
      privacyDecision: evaluation.decision,
      status: 'success'
    })
    await transmissionLogger.append({
      timestamp: Date.now(),
      url: args.context.url,
      domain,
      decision: evaluation.decision,
      feature: usageFeature,
      providerId: provider.info.providerType
    })
    return { ok: true, output, decision: evaluation.decision }
  } catch (err) {
    const errorCode = err instanceof ProviderError ? err.code : 'unknown'
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: usageFeature,
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
      estimatedCostUsd: 0,
      domain,
      privacyDecision: evaluation.decision,
      status: 'failed',
      errorCode
    })
    return {
      ok: false,
      decision: 'provider_error',
      reason: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Sprint 004 M2/M3 — requestType → UsageLog feature 매핑.
 */
function featureFromRequestType(
  requestType: import('../ai/types').RequestType
): import('../storage').Feature {
  if (requestType === 'explanation') return 'explanation'
  if (requestType === 'summary') return 'summary'
  return 'translation'
}

// Sprint 015 M2-8 — retired WebContents extraction helper exports 제거.
//   M2-5/M2-6 페이지 번역 폐기 후 호출자 0. M3 IndexingService 가 perception/PageNodeExtractor 와 ParagraphExtractor 모듈을 직접 import 활용.

/**
 * 외부 페이지(WebContentsView)에서 민감 필드를 스캔한다.
 * 본문 카드 패턴은 sourceText에 대해 evaluatePrivacy 안에서 별도로 평가됨.
 */
export async function scanWebContentsFields(
  webContentsId: number
): Promise<{ hasPasswordField: boolean; hasCardField: boolean }> {
  const wc = WebContentsRegistry.get(webContentsId)
  if (!wc) return { hasPasswordField: false, hasCardField: false }
  try {
    const scan = (await wc.executeJavaScript(detectSensitiveFieldsScript())) as {
      hasPasswordField: boolean
      hasCardField: boolean
    }
    return {
      hasPasswordField: !!scan?.hasPasswordField,
      hasCardField: !!scan?.hasCardField
    }
  } catch {
    return { hasPasswordField: false, hasCardField: false }
  }
}

function registerTranslateIpc(): void {
  ipcMain.handle(
    'translate:request',
    async (_event, args: TranslateArgs): Promise<TranslateResult> => {
      return executeTranslateRequest(args)
    }
  )
}

function rebuildProvider(providerType: CredentialProviderType): void {
  if (providerType === 'openai') {
    providers.set(
      'openai',
      new OpenAIApiKeyProvider(() => credentialsStore.decryptSecret('openai'))
    )
  }
  if (providerType === 'codex') {
    providers.set('codex', new CodexLoginProvider({ tokenAccess: makeCodexTokenAccess() }))
  }
}

/**
 * Sprint 014 M2 — Codex 토큰 묶음을 CredentialsStore (safeStorage 암호화) 위에 JSON으로 저장.
 * G-005 OS Keychain 위임.
 */
function makeCodexTokenAccess(): CodexTokenAccess {
  return {
    get(): TokenBundle {
      const raw = credentialsStore.decryptSecret('codex')
      const parsed = JSON.parse(raw) as TokenBundle
      return parsed
    },
    update(bundle: TokenBundle): void {
      // 비동기 upsert 트리거 (CodexLoginProvider는 fire-and-forget으로 호출). 다음 get은 갱신된 값.
      void credentialsStore.upsert({
        providerType: 'codex',
        displayName: 'Codex Login (Experimental)',
        authType: 'oauth',
        secret: JSON.stringify(bundle)
      })
    }
  }
}

/**
 * Sprint 014 M2 — Codex 로그인 세션 상태. main process에서 폴링 진행 관리.
 */
type CodexLoginStatus = 'idle' | 'pending' | 'success' | 'expired' | 'denied' | 'error'

interface CodexLoginSession {
  status: CodexLoginStatus
  deviceAuthId?: string
  userCode?: string
  verificationUrl?: string
  intervalSec?: number
  startedAt?: number
  errorReason?: string
}

let codexLoginSession: CodexLoginSession = { status: 'idle' }
let codexPollTimer: NodeJS.Timeout | null = null

function clearCodexPolling(): void {
  if (codexPollTimer) {
    clearTimeout(codexPollTimer)
    codexPollTimer = null
  }
}

async function pollCodexLoop(
  flow: DeviceCodeFlow,
  deviceAuthId: string,
  userCode: string,
  intervalSec: number,
  deadlineMs: number
): Promise<void> {
  const tick = async (): Promise<void> => {
    if (codexLoginSession.deviceAuthId !== deviceAuthId) return // 새 세션 시작됨, 종료
    if (Date.now() > deadlineMs) {
      codexLoginSession = { status: 'expired', errorReason: '15분 시간 초과' }
      return
    }
    const result = await flow.pollOnce(deviceAuthId, userCode)
    if (codexLoginSession.deviceAuthId !== deviceAuthId) return // 중간 취소
    if (result.status === 'pending') {
      codexPollTimer = setTimeout(() => void tick(), intervalSec * 1000)
      return
    }
    if (result.status === 'success') {
      try {
        const tokens = await flow.exchangeTokens({
          authorizationCode: result.authorizationCode,
          codeVerifier: result.codeVerifier
        })
        await credentialsStore.upsert({
          providerType: 'codex',
          displayName: 'Codex Login (Experimental)',
          authType: 'oauth',
          secret: JSON.stringify(tokens)
        })
        rebuildProvider('codex')
        // Sprint 014 M3-5 핫픽스 — 로그인 성공 시 defaultProviderId 자동 'codex' 전환.
        // openai credential이 없을 때만 자동 전환 (있으면 사용자 명시 선택 유지).
        try {
          if (!credentialsStore.has('openai')) {
            await userSettingStore.update({ defaultProviderId: 'codex' })
          }
        } catch {
          // 자동 전환 실패는 로그인 자체엔 영향 없음
        }
        codexLoginSession = { status: 'success' }
      } catch (err) {
        codexLoginSession = {
          status: 'error',
          errorReason: `토큰 교환 실패: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      return
    }
    // error / denied / timeout
    codexLoginSession = {
      status: result.status === 'denied' ? 'denied' : 'error',
      errorReason: result.reason ?? '폴링 오류'
    }
  }
  await tick()
}

function registerCodexIpc(): void {
  const flow = new DeviceCodeFlow()
  ipcMain.handle('codex:start-login', async (): Promise<UserCodeResult> => {
    clearCodexPolling()
    const uc = await flow.requestUserCode()
    const deadlineMs = Date.now() + 15 * 60 * 1000
    codexLoginSession = {
      status: 'pending',
      deviceAuthId: uc.deviceAuthId,
      userCode: uc.userCode,
      verificationUrl: uc.verificationUrl,
      intervalSec: uc.interval,
      startedAt: Date.now()
    }
    // 폴링 시작 (fire-and-forget)
    void pollCodexLoop(flow, uc.deviceAuthId, uc.userCode, uc.interval, deadlineMs)
    return uc
  })

  ipcMain.handle('codex:poll-status', (): { status: CodexLoginStatus; errorReason?: string } => {
    return { status: codexLoginSession.status, errorReason: codexLoginSession.errorReason }
  })

  ipcMain.handle('codex:cancel-login', (): void => {
    clearCodexPolling()
    codexLoginSession = { status: 'idle' }
  })

  ipcMain.handle('codex:logout', async (): Promise<boolean> => {
    clearCodexPolling()
    const removed = await credentialsStore.remove('codex')
    providers.delete('codex')
    codexLoginSession = { status: 'idle' }
    return removed
  })

  ipcMain.handle('codex:status', (): 'active' | 'expired' | 'none' => {
    if (!credentialsStore.has('codex')) return 'none'
    const rec = credentialsStore.list().find((r) => r.providerType === 'codex')
    return rec?.status === 'active' ? 'active' : 'expired'
  })
}

export function rebuildAllProviders(): void {
  for (const rec of credentialsStore.list()) {
    if (rec.status === 'active') {
      rebuildProvider(rec.providerType)
    }
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export const WebContentsRegistry = new (class {
  private map = new Map<number, WebContents>()
  register(wc: WebContents): void {
    this.map.set(wc.id, wc)
    wc.once('destroyed', () => this.map.delete(wc.id))
  }
  get(id: number): WebContents | undefined {
    return this.map.get(id)
  }
})()
