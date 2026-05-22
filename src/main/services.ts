/**
 * Main 프로세스 서비스 초기화 + IPC 등록.
 * Privacy / Credentials / UsageLog / Provider 통합 진입점.
 */

import { app, BrowserWindow, ipcMain, session, type WebContents } from 'electron'
import { dirname, join } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'

import {
  ConsentGate,
  DomainFilter,
  DomainPolicyStore,
  TransmissionLogger,
  IndexingGate,
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
  AIResponseCache,
  GlossaryStore,
  UserSettingStore,
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
  defaultAIResponseCachePath,
  defaultGlossaryPath,
  defaultUserSettingPath,
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
// Sprint 017 M1 T06 — HighlightStore wiring + IPC handler 4종.
//   Sprint 017 M1 T07 — `migrateV04ToV05` 동반 import (G-014 정합 자동 백업 + applySchema + sentinel).
//   Sprint 017 M1 T08 — `runHighlightRemoveVisual` + `runHighlightScrollTo` page context inject (visual UX).
import { HighlightStore } from '../storage'
import { migrateV04ToV05 } from '../storage'
import { runHighlightRemoveVisual, runHighlightScrollTo } from './highlightRestore'
import {
  handleHighlightCreate,
  handleHighlightListByPage,
  handleHighlightListByNote,
  handleHighlightRemove,
  type HighlightCreateArgs,
  type HighlightCreateResponse,
  type HighlightListByPageArgs,
  type HighlightListByNoteArgs,
  type HighlightListResponse,
  type HighlightRemoveArgs,
  type HighlightRemoveResponse
} from './highlightHandlers'
import { WorkspaceService } from './WorkspaceService'
import { WorkspacePartitionManager } from './WorkspacePartitionManager'
import { WorkspaceExportImportService } from './WorkspaceExportImportService'
import {
  handleWorkspaceList,
  handleWorkspaceGetCurrent,
  handleWorkspaceCreate,
  handleWorkspaceUpdate,
  handleWorkspaceSwitch,
  handleWorkspaceDelete,
  handleWorkspaceExportJson,
  handleWorkspaceImportJson,
  type WorkspaceCreateArgs,
  type WorkspaceUpdateArgs,
  type WorkspaceSwitchArgs,
  type WorkspaceDeleteArgs,
  type WorkspaceExportArgs,
  type WorkspaceImportArgs,
  type WorkspaceMutationResponse,
  type WorkspaceSwitchResponse,
  type WorkspaceDeleteResponse,
  type WorkspaceListResponse,
  type WorkspaceExportResponse,
  type WorkspaceImportResponse,
  type SerializedWorkspace
} from './workspaceHandlers'
import { MemoryService } from './MemoryService'
import {
  handleMemoryStats,
  type MemoryStatsArgs,
  type MemoryStatsResponse
} from './memoryHandlers'
import {
  IndexingService,
  type IndexPageInput,
  type IndexPageResult,
  type IndexingStatusPayload
} from './IndexingService'
import { extractParagraphsScript } from '../perception/ParagraphExtractor'

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
// Sprint 016 M2 T10a — selection 번역 흐름이 provider.chat() 호출로 통합 (provider.translate() 폐기 준비).
//   buildSystemPrompt / buildUserPrompt 는 OpenAIApiKeyProvider 내부에서 export 된 helper.
//   PRD §10.1 chat 파이프라인 + §15.2 Provider 패턴 정합.
import {
  buildSystemPrompt,
  buildUserPrompt
} from '../ai/providers/OpenAIApiKeyProvider'
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
// Sprint 016 M2 T10b — TranslationCache 통째 폐기. AIResponseCache(kind='translation') 단독 backend.
let aiResponseCache!: AIResponseCache
let glossaryStore!: GlossaryStore
let userSettingStore!: UserSettingStore
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
// Sprint 016 M3 T14/T15 (G-015) — 워크스페이스 단위 cookies/storage partition 격리.
// initServices 시점에 인스턴스화 (Electron `session.fromPartition` 위임).
// createTabView (main/index.ts) 가 `getWorkspacePartitionName(workspaceId)` 호출 → WebContentsView
// `webPreferences.partition` 박음. 미설정 시 디폴트 session.
let workspacePartitionManager: WorkspacePartitionManager | null = null
// Sprint 016 M3 T17 (KI-008) — Workspace JSON Export/Import 서비스.
// workspace:export-json / workspace:import-json IPC 가 사용.
let workspaceExportImportService: WorkspaceExportImportService | null = null
let memoryService: MemoryService | null = null
// Sprint 017 M1 T06 — HighlightStore (in-memory) main wiring 진입.
//   Sprint 016 M4 T20 박힌 store class 의 IPC 노출은 본 PR 부터.
//   Sprint 017 M1 T07 SQLite swap 후에도 동일 lazy slot 유지 (동일 interface).
//   bootstrap 실패 (인프라 미주입) 와 무관하게 단독 동작 가능 (HighlightStore 는 SQLite 의존 0).
let highlightStore: HighlightStore | null = null
// Sprint 016 M0 T05 (KI-010) — IndexingGate + IndexingService wiring.
// did-finish-load hook 호출 (main/index.ts) 시점에 indexingService.indexPage(...) 진입.
// onStatusChange 콜백이 status='indexed' 인 경우 broadcastMemoryInvalidated(workspaceId) 호출.
let indexingGate: IndexingGate | null = null
let indexingService: IndexingService | null = null
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
 * Sprint 016 M3 T15 (G-015) — 워크스페이스 partition name 조회.
 *
 * main/index.ts createTabView 가 호출 → WebContentsView `webPreferences.partition` 박음.
 *
 * 반환:
 *   - workspaceId 가 valid + manager 초기화 됨 → `persist:ws-{workspaceId}`
 *   - workspaceId 가 null/undefined/빈 문자열 → undefined (디폴트 session)
 *   - manager 미초기화 (bootstrap 실패) → undefined (디폴트 session, graceful)
 *   - manager.getPartitionName() throw (invalid id) → undefined + console.warn
 *
 * 사용 패턴:
 *   const partition = getWorkspacePartitionName(workspaceId)
 *   new WebContentsView({ webPreferences: buildTabWebPreferences({ partition }) })
 */
export function getWorkspacePartitionName(
  workspaceId: string | null | undefined
): string | undefined {
  if (!workspaceId) return undefined
  if (!workspacePartitionManager) return undefined
  try {
    return workspacePartitionManager.getPartitionName(workspaceId)
  } catch (err) {
    console.warn(
      '[services] getWorkspacePartitionName invalid workspaceId:',
      err instanceof Error ? err.message : String(err)
    )
    return undefined
  }
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
 * Sprint 016 M3 T16 (G-015, codex BLOCKING #1) — 워크스페이스 삭제 직후 live 탭/view cleanup hook.
 * main/index.ts 가 등록 — 삭제된 ws 의 모든 탭 close + destroyTabView + active filter 갱신.
 * 등록 미설정 시 (테스트) no-op.
 */
let workspaceDeleteHook:
  | ((workspaceId: string, newActiveId: string) => void)
  | null = null

export function setWorkspaceDeleteHook(
  hook: ((workspaceId: string, newActiveId: string) => void) | null
): void {
  workspaceDeleteHook = hook
}

/**
 * Sprint 017 M1 T08 — `highlight:remove` / `highlight:scroll-to` IPC 가 active WebContentsView 의
 * WebContents 에 inject script 실행 위해 호출하는 hook. main/index.ts 가 등록.
 *
 * 미등록 시 (테스트 / fresh install) no-op — IPC 자체는 store 동작은 보장 (visual 만 미적용).
 *
 * codex 019e4ec8 #2 정합 — store remove 와 page context CSS.highlights registry 별도 상태.
 */
let activeWebContentsGetter: (() => Electron.WebContents | null) | null = null

export function setActiveWebContentsGetter(
  getter: (() => Electron.WebContents | null) | null
): void {
  activeWebContentsGetter = getter
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

/**
 * Sprint 016 M0 T05 (KI-010) — IndexingService onStatusChange → broadcast 결합 factory.
 *
 * 본 함수는 IndexingService 인스턴스화 시점 onStatusChange 콜백을 만들어 반환. 단위 테스트 측에서
 * 임의의 broadcaster 를 주입해 status='indexed' 시 broadcaster 호출 정합 검증 가능 (codex T05 NEEDS_CHANGES #7 해소).
 *
 * 정책:
 *   - status='indexed' 시 → broadcaster(payload.workspaceId ?? null) 호출
 *   - status='blocked' 시 → no-op (payload.workspaceId 미정의 + Page/Visit 미생성 → broadcast 의미 없음)
 *
 * broadcaster 가 null workspaceId 에 대해 안전 (services 본체 `broadcastMemoryInvalidated` 는 null guard 보유).
 */
export function createIndexingBroadcastHandler(
  broadcaster: (workspaceId: string | null) => void
): (payload: IndexingStatusPayload) => void {
  return (payload: IndexingStatusPayload): void => {
    if (payload.result.status !== 'indexed') return
    broadcaster(payload.workspaceId ?? null)
  }
}

/**
 * Sprint 016 M0 T05 (KI-010) — `did-finish-load` 시점 호출용 헬퍼.
 *
 * `main/index.ts` createTabView 의 `did-finish-load` 핸들러가 호출.
 * IndexingService 미초기화 시 (인프라 bootstrap 실패 / 테스트) graceful null 반환 — 호출자 no-op.
 *
 * 호출자는 WebContents 에서 직접 (1) 패스워드 필드 감지 (`scanWebContentsFields`)
 * + (2) 본문 추출 (`extractParagraphsScript` executeJavaScript) 결과를 수집 후
 * 본 헬퍼에 넘긴다. IndexingGate 가 차단하면 status='blocked' — 본문/임베딩 미생성.
 *
 * `did-finish-load` 는 반복 fire 가능 (SPA navigate-in-page 또는 reload). IndexingService 가
 * `IndexedPageStoreSqlite.recordVisit` 의 UPSERT + content_hash 매칭으로 중복 임베딩을 자체 차단.
 */
export async function tryIndexPage(input: IndexPageInput): Promise<IndexPageResult | null> {
  if (!indexingService) return null
  try {
    return await indexingService.indexPage(input)
  } catch (err) {
    // 인덱싱 실패는 UX 영향 없음 — 다음 did-finish-load 시점에 재시도.
    console.warn(
      '[services] 인덱싱 실패 (graceful) — url=',
      input.url,
      err instanceof Error ? err.message : String(err)
    )
    return null
  }
}

/**
 * Sprint 016 M0 T05 (KI-010) — `did-finish-load` 호출자 위한 ParagraphExtractor script 헬퍼.
 * `WebContents.executeJavaScript(getParagraphsExtractScript())` 결과로 본문을 합쳐 indexPage 본문 입력.
 */
export function getParagraphsExtractScript(): string {
  return extractParagraphsScript()
}

/**
 * Sprint 016 M0 T05 (KI-010) — 테스트용 IndexingService 접근자.
 * 프로덕션 코드는 `tryIndexPage` 사용 권장 — graceful null 반환 보장.
 */
export function getIndexingServiceForTest(): IndexingService | null {
  return indexingService
}

/**
 * Sprint 017 M1 T06 — HighlightStore 접근자.
 *
 * main/index.ts 의 did-finish-load hook 및 highlightHandlers 가 사용.
 * 본 store 는 in-memory — bootstrap 실패와 무관하게 instance 보장 (SQLite 의존 0).
 * T07 SQLite swap 시점에 동일 함수 signature 유지하며 backend 만 교체.
 */
export function getHighlightStore(): HighlightStore | null {
  return highlightStore
}

/**
 * Sprint 017 M1 T06 — main/index.ts context-menu 하이라이트 path 가 사용.
 * handleHighlightCreate 의 composite (신규 노트 + highlight) 분기에 NoteService 전달.
 * 인프라 미초기화 시 null — handler 가 graceful error 반환.
 */
export function getNoteServiceForHighlight(): NoteService | null {
  return noteService
}

/**
 * Sprint 017 M1 T06 — 외부 호출자 (main/index.ts) 가 신규 노트 + highlight 저장 후
 * MemoryStatsPanel refresh 트리거할 수 있도록 broadcast helper 노출.
 *
 * BrowserWindow.getAllWindows()[0] 미존재 시 (테스트 / headless) no-op.
 */
export function broadcastMemoryInvalidatedExternal(workspaceId: string | null): void {
  broadcastMemoryInvalidated(workspaceId)
}

/**
 * Sprint 017 M2 T11 (KI-021) — 워크스페이스 partition cleanup reconcile.
 *
 * `initServices()` 후 fire-and-forget 호출 (UI 부팅 지연 회피). workspaces 테이블 active set 과
 * `<userData>/Partitions/ws-*` 디렉토리 listing 비교 → orphan partition cleanup 재시도.
 *
 * codex 019e4f65 사전 협의 권고 흡수:
 *   - activeWorkspaceIds.length === 0 시 skip (`reconcileOrphanPartitions` 가 처리)
 *   - listExistingPartitionIds throw 시 graceful skip (enumerationError 박음)
 *   - `getStoragePath()` 로 Partitions parent derive (Electron 공식 계약 정합)
 *   - decodeURIComponent 안 함 (UUID 라 영향 0)
 *   - summary log 는 orphan>0 || errors>0 시만 (정상 boot noisy 회피)
 *
 * boot path 깨지 않도록 모든 throw graceful — caller (main/index.ts) 는 `void` + `.catch`.
 */
export async function reconcileWorkspacePartitions(): Promise<void> {
  if (!workspacePartitionManager || !workspaceService) {
    // 인프라 bootstrap 실패 path — 다음 부팅 시 재시도.
    return
  }
  const mgr = workspacePartitionManager
  const activeIds = workspaceService.list().map((w) => w.id)
  const result = await mgr.reconcileOrphanPartitions(activeIds, () =>
    listPersistedWorkspacePartitionIds(activeIds[0] ?? null)
  )
  if (result.skipped === 'empty_active_set') {
    console.warn(
      '[services] workspace partition reconcile skipped — active workspaces 0 (DB/bootstrap 이상 신호?)'
    )
    return
  }
  if (result.enumerationError) {
    console.warn(
      '[services] workspace partition reconcile enumeration failed:',
      result.enumerationError.message
    )
    return
  }
  if (result.orphaned.length > 0 || result.errors.length > 0) {
    console.warn(
      `[services] workspace partition reconcile — inspected=${result.inspected} ` +
        `orphaned=${result.orphaned.length} cleared=${result.cleared.length} ` +
        `errors=${result.errors.length}`
    )
    for (const e of result.errors) {
      console.warn(
        `[services]   - ws=${e.workspaceId} clearStorageData/Cache failed: ${e.error.message}`
      )
    }
  }
}

/**
 * Sprint 017 M2 T11 — `<userData>/Partitions` 디렉토리 enum + `ws-` prefix filter.
 *
 * Electron `Session.getStoragePath()` 가 persistent partition 의 실 디스크 root 반환 (in-memory 면
 * null). `sampleActiveId` 가 null 이면 path derive 불가 — caller 가 skip (reconcileOrphanPartitions
 * 의 `empty_active_set` 분기 정합).
 *
 * decodeURIComponent 미사용 — workspaceId 는 UUID 라 인코딩 영향 0 (codex Q2 정합).
 *
 * 디렉토리 미존재 / 권한 부족 / sampleActiveId null 시 throw — caller (reconcileOrphanPartitions)
 * 의 `enumerationError` 분기 graceful.
 */
async function listPersistedWorkspacePartitionIds(
  sampleActiveId: string | null
): Promise<string[]> {
  if (!sampleActiveId) {
    throw new Error('sample active workspace id missing — cannot derive partitions root')
  }
  if (!workspacePartitionManager) {
    throw new Error('workspacePartitionManager not initialised')
  }
  const ses = workspacePartitionManager.getSession(sampleActiveId)
  const samplePath =
    typeof ses.getStoragePath === 'function' ? (ses.getStoragePath() as string | null) : null
  if (!samplePath) {
    throw new Error('session.getStoragePath() returned null — partition not persistent?')
  }
  const partitionsDir = dirname(samplePath)
  let entries: string[]
  try {
    entries = await fs.readdir(partitionsDir)
  } catch (err) {
    // codex 019e4f77 NEEDS_CHANGES #2 hotfix —
    //   fresh install / first run 시점은 Electron 이 아직 `Partitions` parent 디렉토리를
    //   생성 안 했을 가능성. ENOENT 는 "orphan 0" 의 정상 path 로 처리 (false positive warning 차단).
    //   다른 에러 (권한 부족 / IO 오류) 는 그대로 throw → caller 의 `enumerationError` 분기 graceful.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries.filter((name) => name.startsWith('ws-')).map((name) => name.slice(3))
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

  aiResponseCache = new AIResponseCache(defaultAIResponseCachePath(userDataDir))
  await aiResponseCache.load()

  glossaryStore = new GlossaryStore(defaultGlossaryPath(userDataDir))
  await glossaryStore.load()

  userSettingStore = new UserSettingStore(defaultUserSettingPath(userDataDir))
  await userSettingStore.load()

  tabStateStore = new TabStateStore(defaultTabStatePath(userDataDir))

  shortcutStore = new ShortcutStore(defaultShortcutPath(userDataDir))
  await shortcutStore.load()

  // Sprint 017 M1 T07 — HighlightStore in-memory fallback (SQLite native 로드 실패 시 graceful path).
  //   bootstrap 성공 후 `new HighlightStore(flowbrowserDb)` 로 재할당 (영속 활성).
  //   codex 019e4dd1 #4 + 019e4e82 NOTABLE #5 정합 — 명시 factory `inMemoryForFallback()` 사용
  //   (silent in-memory production footgun 차단 — `new HighlightStore()` no-arg 는 단위 테스트 한정).
  highlightStore = HighlightStore.inMemoryForFallback()

  // Sprint 015 M5-3b → Sprint 017 M1 T07 — bootstrap 분해 (G-014 정합, codex 019e4dd1 BLOCKING).
  //   기존: `FlowbrowserDatabase.bootstrap({path})` (open + applySchema + ensureDefaultWorkspace 한 번에)
  //   변경: open → migrateV04ToV05 (백업 + applySchema + sentinel) → ensureDefaultWorkspace
  //   이유: v04 → v05 schema 변경 전 `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 자동 백업 강제.
  // bootstrap 실패 (sqlite-vec native 로드 실패 등) 시 검색만 graceful disable — 다른 IPC 는 정상 동작.
  // M3 PoC 시점 (specs/m3-spike-decisions.md) windows-x64 검증 완료, macOS 미검증 (KI-001 추적).
  try {
    const dbPath = join(userDataDir, 'flowbrowser.db')
    flowbrowserDb = FlowbrowserDatabase.open({ path: dbPath })
    // Sprint 017 M1 T07 — V4 → V5 자동 마이그레이션 (G-014 dry-run + 백업 + sentinel).
    //   fresh install 시 백업 skip + applySchema(v05) + sentinel 박힘.
    //   v04 DB 시 `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 자동 백업 (WAL safe snapshot) + applySchema(v05) + sentinel.
    //   already_migrated 시 skip.
    await migrateV04ToV05({ userDataDir, fb: flowbrowserDb })
    const defaultWs = flowbrowserDb.ensureDefaultWorkspace()
    defaultWorkspaceId = defaultWs.id
    vectorIndex = new VectorIndex(flowbrowserDb)
    indexedPageStore = new IndexedPageStoreSqlite(flowbrowserDb, {
      defaultWorkspaceId: defaultWs.id
    })
    noteStore = new NoteStore(flowbrowserDb)
    aiChatHistoryStore = new AiChatHistoryStore(flowbrowserDb)
    embeddingQueue = new EmbeddingQueue(flowbrowserDb)
    // Sprint 017 M1 T07 — HighlightStore SQLite-backed 재할당.
    //   codex 019e4dd1 #4 정합 — DB bootstrap 성공 후 SQLite backend 으로 swap.
    //   v05.sql 의 `highlights` 테이블 prepared statements 박힘. 영속 활성.
    highlightStore = new HighlightStore(flowbrowserDb)
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
    // Sprint 016 M3 T15 (G-015) — WorkspacePartitionManager 인스턴스화.
    // Electron `session.fromPartition` 위임 — main/index.ts createTabView 가
    // `webPreferences.partition` 으로 박는다. 워크스페이스 삭제 시점 cleanup 은 T16.
    workspacePartitionManager = new WorkspacePartitionManager({
      factory: { fromPartition: (name: string) => session.fromPartition(name) }
    })
    // Sprint 016 M3 T17 (KI-008) — Workspace JSON Export/Import 서비스.
    workspaceExportImportService = new WorkspaceExportImportService({ fb: flowbrowserDb })
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
    // Sprint 016 M0 T05 (KI-010) — IndexingGate + IndexingService wiring.
    // IndexingGate 는 UserSetting.privacyExclusions 를 getter 로 매번 풀어옴 (사용자 갱신 즉시 반영).
    // IndexingService onStatusChange 는 status='indexed' 시 broadcastMemoryInvalidated 호출 —
    // MemoryStatsPanel 의 'memory:stats-invalidated' 구독이 활성 ws 와 일치하면 즉시 재로드.
    indexingGate = new IndexingGate({
      getUserExclusions: () => userSettingStore.getState().privacyExclusions
    })
    indexingService = new IndexingService({
      gate: indexingGate,
      pageStore: indexedPageStore,
      embeddingQueue,
      // Sprint 016 M0 T02-followup (KI-006, codex BLOCKING #2) — VectorIndex 주입 시 unchanged 분기에서
      // vector 미존재 (이전 abort 등) 감지 후 재 enqueue 회복 path 활성. 누락 시 영구 미생성 차단.
      vectorIndex,
      onStatusChange: createIndexingBroadcastHandler(broadcastMemoryInvalidated)
    })
  } catch (err) {
    // 인프라 미준비 — search / chat / note / memory / indexing 호출 시 graceful error 반환.
    flowbrowserDb = null
    vectorIndex = null
    indexedPageStore = null
    noteStore = null
    aiChatHistoryStore = null
    embeddingQueue = null
    searchService = null
    noteService = null
    workspaceService = null
    workspacePartitionManager = null
    workspaceExportImportService = null
    memoryService = null
    indexingGate = null
    indexingService = null
    defaultWorkspaceId = null
    // Sprint 017 M1 T07 — bootstrap 실패 시 HighlightStore 는 in-memory 단독 instance 유지.
    //   codex 019e4dd1 #4 권고 — fb 미주입 fallback 으로 IPC handler graceful 동작 (영속 부재 명시).
    //   `highlightStore = new HighlightStore()` 는 try 블록 진입 전 이미 박힘 (Line 435).
    console.warn(
      '[services] v0.4 SQLite 인프라 bootstrap 실패 — 검색 / 채팅 / 노트 / 워크스페이스 / 인덱싱 비활성 (HighlightStore in-memory fallback):',
      err instanceof Error ? err.message : String(err)
    )
  }

  registerConsentIpc()
  registerCredentialIpc()
  registerPrivacyIpc()
  registerUsageIpc()
  registerTranslateIpc()
  registerGlossaryIpc()
  registerUserSettingIpc()
  registerCodexIpc()
  registerShortcutIpc()
  registerSearchIpc()
  registerChatIpc()
  registerNoteIpc()
  registerHighlightIpc()
  registerWorkspaceIpc()
  registerMemoryIpc()
}

/**
 * Sprint 017 M1 T06 — highlight IPC.
 * `highlight:create` — HighlightStore.add (+ NoteService.createNote composite, noteId 미명시 시)
 * `highlight:list-by-page` — workspaceId + (pageId 또는 url+contentHash) 필터
 * `highlight:list-by-note` — 단일 노트의 1:N highlight
 * `highlight:remove` — id 로 삭제
 *
 * 인프라 (HighlightStore) 미초기화 시 handler 가 graceful empty / error.
 * NoteService 미초기화 + noteId 미명시 시 invalid_input — 호출자가 명시 noteId 지정 path.
 */
function registerHighlightIpc(): void {
  ipcMain.handle(
    'highlight:create',
    async (_event, args: HighlightCreateArgs): Promise<HighlightCreateResponse> => {
      const response = await handleHighlightCreate(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getHighlightStore: () => highlightStore,
        getNoteService: () => noteService
      })
      // 신규 노트 동반 생성 분기 시 MemoryStatsPanel 즉시 refresh.
      if (response.ok && response.note) {
        broadcastMemoryInvalidated(response.note.workspaceId)
      }
      return response
    }
  )
  ipcMain.handle(
    'highlight:list-by-page',
    (_event, args: HighlightListByPageArgs): HighlightListResponse => {
      return handleHighlightListByPage(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getHighlightStore: () => highlightStore,
        getNoteService: () => noteService
      })
    }
  )
  ipcMain.handle(
    'highlight:list-by-note',
    (_event, args: HighlightListByNoteArgs): HighlightListResponse => {
      return handleHighlightListByNote(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getHighlightStore: () => highlightStore,
        getNoteService: () => noteService
      })
    }
  )
  ipcMain.handle(
    'highlight:remove',
    async (
      _event,
      args: HighlightRemoveArgs & { expectedUrl?: string }
    ): Promise<HighlightRemoveResponse> => {
      // codex 019e4eda NEEDS_CHANGES #3 — expectedUrl 가 명시되면 active WebContents URL 과 매칭 강제.
      //   tab switch / navigate race 시 잘못된 highlight 삭제 차단. 매칭 mismatch 시 ok:false (store 도 skip).
      if (args.expectedUrl && activeWebContentsGetter) {
        const wc = activeWebContentsGetter()
        if (wc && !wc.isDestroyed() && wc.getURL() !== args.expectedUrl) {
          console.warn(
            '[highlight:remove] expectedUrl mismatch — graceful skip',
            JSON.stringify({ expected: args.expectedUrl, actual: wc.getURL() })
          )
          return { ok: false }
        }
      }
      const response = handleHighlightRemove(args, {
        getActiveWorkspaceId: () => getActiveWorkspaceId(),
        getHighlightStore: () => highlightStore,
        getNoteService: () => noteService
      })
      // Sprint 017 M1 T08 (codex 019e4ec8 #2) — store DELETE 성공 시 active page context visual delete.
      if (response.ok && args.id && activeWebContentsGetter) {
        try {
          const wc = activeWebContentsGetter()
          if (wc && !wc.isDestroyed()) {
            await runHighlightRemoveVisual(wc, args.id)
          }
        } catch (err) {
          console.warn(
            '[highlight:remove] visual delete graceful fail —',
            err instanceof Error ? err.message : String(err)
          )
        }
      }
      return response
    }
  )
  // Sprint 017 M1 T08 — `highlight:scroll-to` IPC 신규 (NoteHighlight list item 클릭 시).
  //   active WebContents 미주입 / non-http(s) / API 미지원 시 graceful no-op.
  //   codex 019e4eda NEEDS_CHANGES #3 — expectedUrl mismatch 시 graceful no-op (잘못된 탭에 scroll 방지).
  ipcMain.handle(
    'highlight:scroll-to',
    async (
      _event,
      args: { id: string; expectedUrl?: string }
    ): Promise<{ ok: boolean; scrolled: boolean }> => {
      if (!args?.id) return { ok: false, scrolled: false }
      if (!activeWebContentsGetter) return { ok: true, scrolled: false }
      try {
        const wc = activeWebContentsGetter()
        if (!wc || wc.isDestroyed()) return { ok: true, scrolled: false }
        if (args.expectedUrl && wc.getURL() !== args.expectedUrl) {
          console.warn(
            '[highlight:scroll-to] expectedUrl mismatch — graceful skip',
            JSON.stringify({ expected: args.expectedUrl, actual: wc.getURL() })
          )
          return { ok: true, scrolled: false }
        }
        const result = await runHighlightScrollTo(wc, args.id)
        return { ok: result?.ok ?? true, scrolled: result?.scrolled ?? false }
      } catch (err) {
        console.warn(
          '[highlight:scroll-to] graceful fail —',
          err instanceof Error ? err.message : String(err)
        )
        return { ok: false, scrolled: false }
      }
    }
  )
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
        },
        // Sprint 016 M0 T02-followup (KI-006) — 워크스페이스 전환 abort 정책 callback 3종 실 wiring.
        //   T02 (PR #186) 가 인터페이스만 박은 상태에서, 본 PR (T02-followup) 로 실 구현 wiring.
        //   각 callback throw 는 workspaceHandlers 의 invokeAbortCallback 가 swallow + console.warn.
        abortIndexing: (ws) => indexingService?.abort(ws),
        clearEmbeddingQueue: (ws) => {
          if (embeddingQueue) embeddingQueue.clearWorkspace(ws)
        },
        abortChatStreaming: (ws) => ChatService.abortStreaming(ws)
      })
    }
  )
  ipcMain.handle(
    'workspace:delete',
    async (_event, args: WorkspaceDeleteArgs): Promise<WorkspaceDeleteResponse> => {
      return handleWorkspaceDelete(args, {
        getService: () => workspaceService,
        // Sprint 016 M3 T16 (G-015) — DB cascade 성공 후 live view cleanup → partition cleanup 순서.
        // hook 미등록 (테스트) 또는 manager null (bootstrap 실패) 시 callback 미주입 — handler 가 no-op.
        destroyWorkspaceTabs: workspaceDeleteHook ?? undefined,
        clearWorkspacePartition: workspacePartitionManager
          ? (ws: string) => workspacePartitionManager!.clearWorkspaceData(ws)
          : undefined
      })
    }
  )
  // Sprint 016 M3 T17 (KI-008) — Workspace JSON Export/Import IPC.
  ipcMain.handle(
    'workspace:export-json',
    (_event, args: WorkspaceExportArgs): WorkspaceExportResponse => {
      return handleWorkspaceExportJson(args, {
        getService: () => workspaceService,
        getExportImportService: () => workspaceExportImportService
      })
    }
  )
  ipcMain.handle(
    'workspace:import-json',
    (_event, args: WorkspaceImportArgs): WorkspaceImportResponse => {
      return handleWorkspaceImportJson(args, {
        getService: () => workspaceService,
        getExportImportService: () => workspaceExportImportService
      })
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

// Sprint 016 M2 T12 — PageResultStore 어댑터 + pageResult:* IPC + PageCachePanel UI 통째 폐기 (KI-002 closed).
//   v0.4 인덱싱 통계는 MemoryStatsPanel (memory:stats IPC) 가 흡수.

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

// Sprint 016 M2 T11 — cache:* IPC 3종 + cacheApi 폐기.
// Sprint 016 M2 T10b — TranslationCache 클래스 자체 폐기. AIResponseCache(kind='translation') 단독.
//   glossary mutation 시 cache 무효화는 services.ts 내부 호출 유지 (selection 번역 cache 정합).

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
        await invalidateTranslationCacheByGlossaryVersion(prevVersion)
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
        await invalidateTranslationCacheByGlossaryVersion(prevVersion)
      }
      return result
    }
  )

  ipcMain.handle('glossary:remove', async (_event, id: string): Promise<boolean> => {
    const prevVersion = glossaryStore.getVersion()
    const removed = await glossaryStore.remove(id)
    if (removed) {
      await invalidateTranslationCacheByGlossaryVersion(prevVersion)
    }
    return removed
  })

  ipcMain.handle('glossary:clear', async (): Promise<void> => {
    const prevVersion = glossaryStore.getVersion()
    await glossaryStore.clearAll()
    await invalidateTranslationCacheByGlossaryVersion(prevVersion)
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
        await invalidateTranslationCacheByGlossaryVersion(prevVersion)
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
  // Sprint 016 M2 T10b — TranslationCache → AIResponseCache(kind='translation') 직접 호출.
  //   composite key 알고리즘은 sha256(sourceText)|src|tgt|provider|requestType|glossaryVersion 그대로 보존.
  //   value shape: { translatedText, sourceText, providerType } (codex BLOCKING 사전 경계 #2 정합).
  //   metadata: { glossaryVersion, sourceLanguage, targetLanguage, requestType, sourceHash } (invalidation predicate 입력).
  const cacheKey = buildTranslationCacheKey({
    sourceText: args.input.sourceText,
    sourceLanguage: args.input.sourceLanguage,
    targetLanguage: args.input.targetLanguage,
    providerType: args.providerType,
    requestType: args.input.requestType,
    glossaryVersion
  })
  const cached = await aiResponseCache.lookup<TranslationCacheValue>({
    kind: 'translation',
    key: cacheKey
  })
  if (cached) {
    return {
      ok: true,
      decision: evaluation.decision,
      fromCache: true,
      output: {
        translatedText: cached.value.translatedText,
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
    // Sprint 016 M2 T10a — provider.translate() 호출 폐기. selection 번역 흐름을 provider.chat() 으로 통합.
    //   기존 buildSystemPrompt + buildUserPrompt helper 재사용 (OpenAIApiKeyProvider.translate() 의
    //   buildMessages 와 동일 결과 — translate 시점의 system/user prompt 분리 그대로 보존).
    //   CodexLoginProvider 는 chat() 내부에서 splitMessagesForResponsesApi 가 system → instructions 분리.
    //   ChatResponse → TranslationOutput 어댑트 (text → translatedText, 나머지 1:1).
    if (!provider.chat) {
      return {
        ok: false,
        decision: 'no_provider',
        reason: `Provider ${args.providerType} chat() 미지원. ProviderInfo.supportsChat 가 false.`
      }
    }
    const chatResp = await provider.chat(buildTranslationChatRequest(inputWithGlossary))
    const output = chatResponseToTranslationOutput(chatResp)
    // Sprint 016 M2 T10b — AIResponseCache(kind='translation') 단독 backend.
    //   subtitle TTL 365d 보존 (codex 사전 경계 #3) — `ttlMs` 명시 전달.
    //   composite key 5-tuple + sourceHash 알고리즘은 T11 마이그레이션 output 과 1:1 정합.
    const isSubtitle = args.input.requestType === 'subtitle'
    const ttlMs = isSubtitle ? 365 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000
    await aiResponseCache.store<TranslationCacheValue>({
      kind: 'translation',
      key: cacheKey,
      value: {
        translatedText: output.translatedText,
        sourceText: args.input.sourceText,
        providerType: args.providerType
      },
      ttlMs,
      metadata: {
        glossaryVersion,
        sourceLanguage: args.input.sourceLanguage,
        targetLanguage: args.input.targetLanguage,
        requestType: args.input.requestType,
        sourceHash: cacheKey.split('|')[0],
        domain
      }
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
 * Sprint 016 M2 T10b — selection 번역 cache value shape (runtime store).
 *   AIResponseCache(kind='translation') 의 value 페이로드.
 *
 *   read-compatible 책임:
 *     - lookup 시 본 모듈은 `translatedText` 만 직접 읽음 (services.ts:fromCache 분기).
 *     - T11 마이그레이션 (`migrateTranslationCache`) output 도 본 shape 의 3 필드 (translatedText/sourceText/providerType) 를
 *       포함 (codex NEEDS_CHANGES #8 hotfix 정합) + 마이그레이션 한정 후방호환 필드 (id/domain/createdAt) 추가 보유.
 *     - 향후 본 shape 의 신규 필드 추가 시 마이그레이션 모듈 동기 갱신 필수 (G-013 단계별 PR — 신규 필드 PR + backfill PR 분할).
 */
export interface TranslationCacheValue {
  translatedText: string
  sourceText: string
  providerType: string
}

/**
 * Sprint 016 M2 T10b — composite cache key builder.
 *   Sprint 005~015 의 `TranslationCache.buildKey` 와 1:1 알고리즘 보존.
 *   `sha256(sourceText)|sourceLanguage|targetLanguage|providerType|requestType|glossaryVersion` (default fallback).
 */
export function buildTranslationCacheKey(args: {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  providerType: string
  requestType: import('../ai/types').RequestType
  glossaryVersion?: string
}): string {
  const sourceHash = createHash('sha256').update(args.sourceText).digest('hex')
  return [
    sourceHash,
    args.sourceLanguage,
    args.targetLanguage,
    args.providerType,
    args.requestType,
    args.glossaryVersion ?? 'default'
  ].join('|')
}

/**
 * Sprint 016 M2 T10b — glossary mutation 시 selection 번역 cache 무효화 helper.
 *   metadata.glossaryVersion === prevVersion 인 entry 만 제거. AIResponseCache.invalidate 직결.
 *   Sprint 015~016 의 `TranslationCache.invalidateByGlossaryVersion` 와 의미 동치.
 */
export async function invalidateTranslationCacheByGlossaryVersion(
  prevVersion: string
): Promise<number> {
  return aiResponseCache.invalidate('translation', (entry) => {
    const meta = entry.metadata as { glossaryVersion?: string } | undefined
    return meta?.glossaryVersion === prevVersion
  })
}

/**
 * Sprint 016 M2 T10a — selection 번역 chat 호출 입력 builder.
 *   buildSystemPrompt + buildUserPrompt 재사용 (OpenAIApiKeyProvider 의 translate 시점 prompt 패턴 그대로).
 *   temperature 0.3 (번역 일관성), modelHint 는 호출자 명시 전달.
 *   단위 테스트가 직접 호출 가능 (codex NEEDS_CHANGES #1 흡수 — executeTranslateRequest 회귀 안전망).
 */
export function buildTranslationChatRequest(input: TranslationInput): import('../ai/types').ChatRequest {
  return {
    messages: [
      { role: 'system', content: buildSystemPrompt(input) },
      { role: 'user', content: buildUserPrompt(input) }
    ],
    modelHint: input.modelHint,
    temperature: 0.3
  }
}

/**
 * Sprint 016 M2 T10a — ChatResponse → TranslationOutput 어댑트.
 *   text → translatedText, 나머지 5 필드 1:1 매핑. translate path 결과와 동치.
 */
export function chatResponseToTranslationOutput(
  resp: import('../ai/types').ChatResponse
): TranslationOutput {
  return {
    translatedText: resp.text,
    modelUsed: resp.modelUsed,
    inputTokens: resp.inputTokens,
    outputTokens: resp.outputTokens,
    estimatedCostUsd: resp.estimatedCostUsd,
    durationMs: resp.durationMs
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
