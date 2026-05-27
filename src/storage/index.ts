export { CredentialsStore, defaultCredentialsPath } from './Credentials'
export type { CredentialRecord, ProviderType as CredentialProviderType } from './Credentials'

export { UsageLog, defaultUsageLogPath, V04_FEATURES } from './UsageLog'
export type { UsageLogEntry, Feature, V03Feature, V04Feature, UsageStatus } from './UsageLog'

// Sprint 016 M2 T10b — TranslationCache 클래스 + .legacy.test 통째 폐기.
//   selection 번역 cache 는 AIResponseCache(kind='translation') 단독 backend (services.ts 직접 호출).
//   v0.3 → v0.4 마이그레이션 (`translation-cache.json` → `ai-response-cache.json`) 은 migrations/v03_to_v04.ts 유지.

export {
  AIResponseCache,
  defaultAIResponseCachePath,
  AI_CACHE_TTL_DEFAULTS
} from './AIResponseCache'

export {
  IndexedPageStore,
  defaultIndexedPagePath,
  normalizeIndexedUrl,
  contentHashOf,
  DEFAULT_WORKSPACE_ID
} from './IndexedPageStore'
export type {
  Page,
  Visit,
  UpsertPageInput,
  UpsertAction,
  UpsertPageResult,
  CreateVisitInput,
  RecordVisitInput,
  RecordVisitResult,
  IndexedPageStoreOptions,
  IndexedPageStats
} from './IndexedPageStore'
export type {
  AICacheKind,
  AICacheEntry,
  AICacheStoreInput,
  AICacheLookupInput,
  AICacheOptions,
  AICacheStats
} from './AIResponseCache'

export { isV04Enabled } from './featureFlags'
export type { V04FlagSource } from './featureFlags'

export {
  FlowbrowserDatabase,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_ICON,
  V04_SCHEMA_VERSION,
  V05_SCHEMA_VERSION,
  V06_SCHEMA_VERSION
} from './Database'
export type {
  WorkspaceRow,
  CreateWorkspaceInput,
  SchemaMetaRow,
  FlowbrowserDatabaseOptions,
  LevelPreference
} from './Database'

export {
  VectorIndex,
  EMBEDDING_DIMENSIONS,
  embeddingToBuffer,
  bufferToEmbedding,
  selectVecPagesTable,
  selectVecNotesTable
} from './VectorIndex'
export type { VectorSearchResult, EmbeddingInput } from './VectorIndex'

// Sprint 018 M2 T17b — 임베딩 모델 레지스트리 SSOT (v06.sql CHECK ↔ vec0 테이블 ↔ UX 3자 일치).
export {
  EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_MODEL_ID,
  SUPPORTED_EMBEDDING_DIMENSIONS,
  isSupportedEmbeddingModel,
  parseEmbeddingModel,
  resolveEmbeddingModel,
  resolveEmbeddingDimensions
} from './embeddingModel'
export type {
  EmbeddingModelSpec,
  EmbeddingModelId,
  SupportedEmbeddingDimension
} from './embeddingModel'

export { IndexedPageStoreSqlite } from './IndexedPageStoreSqlite'
export type { IndexedPageStoreSqliteOptions } from './IndexedPageStoreSqlite'

export { NoteStore } from './NoteStore'
export type {
  NoteRow,
  NoteCreatedBy,
  CreateNoteInput,
  UpdateNoteInput
} from './NoteStore'

export { AiChatHistoryStore } from './AiChatHistoryStore'
export type {
  ChatRow,
  ChatRole,
  ChatStatus,
  RetrievedItem,
  CreateChatInput,
  UpdateChatStatusInput
} from './AiChatHistoryStore'

export { TagStore, TAG_KINDS } from './TagStore'
export type { TagRow, TagKind, EnsureTagInput, AttachInput } from './TagStore'

export { EmbeddingQueue } from './EmbeddingQueue'
export type {
  EmbeddingJobRow,
  EmbeddingTargetType,
  EmbeddingJobStatus,
  EnqueueInput,
  QueueStats
} from './EmbeddingQueue'

export {
  migrateV03ToV04,
  revertMigration,
  V03_SOURCE_FILES,
  V04_DB_SENTINEL,
  V04_LOG_FILE,
  V04_BACKUP_ROOT,
  MIGRATION_SCHEMA_META_KEY
} from './migrations/v03_to_v04'
export type {
  MigrateOptions,
  MigrationCounts,
  MigrationResult
} from './migrations/v03_to_v04'

// Sprint 017 M1 T07 — v04 → v05 마이그레이션 (G-014 dry-run + `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 백업).
//   highlights 테이블 + 4종 인덱스 추가. HighlightStore SQLite swap 동반.
export {
  migrateV04ToV05,
  MIGRATION_V05_SCHEMA_META_KEY,
  V05_LOG_FILE,
  V05_BACKUP_ROOT,
  V05_BACKUP_FILE
} from './migrations/v04_to_v05'
export type {
  MigrateV05Options,
  MigrateV05Status,
  MigrateV05Result
} from './migrations/v04_to_v05'

// Sprint 018 M2 T17a — v05 → v06 마이그레이션 (G-014 dry-run + `<userDataDir>/backup/v05/<ISO_ts>/flowbrowser.db` 백업).
//   workspaces.embedding_model 컬럼 + dimension 별 vec0 테이블 (vec_pages_1024/768 + vec_notes_1024/768) + 트리거 갱신.
//   services.ts 체인 wiring + VectorIndex dimension 분기는 T17b.
export {
  migrateV05ToV06,
  MIGRATION_V06_SCHEMA_META_KEY,
  V06_LOG_FILE,
  V06_BACKUP_ROOT,
  V06_BACKUP_FILE
} from './migrations/v05_to_v06'
export type {
  MigrateV06Options,
  MigrateV06Status,
  MigrateV06Result
} from './migrations/v05_to_v06'

export {
  GlossaryStore,
  defaultGlossaryPath,
  validateTerm,
  formatGlossaryContext,
  GLOSSARY_POLICY_VERSION
} from './GlossaryStore'
export type {
  GlossaryTerm,
  GlossaryExport,
  GlossaryValidationError,
  GlossaryValidationResult
} from './GlossaryStore'

export { UserSettingStore, defaultUserSettingPath } from './UserSettingStore'
export type { UserSettingState, TranslationMode } from './UserSettingStore'

// Sprint 015 M2-8 — retired page-node signature helper export 제거 (함수 자체 폐기).
// Sprint 016 M2 T12 — PageResultStore 어댑터 자체 제거 (KI-002 closed).
//   v0.4 인덱싱은 IndexedPageStoreSqlite (Page + Visit 단일 TX) 가 직접 책임.
//   URL 정규화는 IndexedPageStore.normalizeIndexedUrl 단일 source.

export { TabStateStore, defaultTabStatePath, TAB_STATE_POLICY_VERSION } from './TabStateStore'
export type { PersistedTabSession, PersistedTabState } from './TabStateStore'

export {
  ShortcutStore,
  ShortcutConflictError,
  SHORTCUT_BINDING_IDS,
  defaultShortcutPath,
  isValidAccelerator,
  acceleratorsEqual
} from './ShortcutStore'
export type { ShortcutBinding, ShortcutBindingId } from './ShortcutStore'

// Sprint 017 M1 T06 — HighlightStore (in-memory) main wiring 진입.
//   Sprint 016 M4 T20 박힌 store 의 IPC 노출은 본 PR (T06) 부터.
//   Sprint 017 M1 T07 SQLite swap 시점에도 본 export 동일 유지 (동일 interface).
export { HighlightStore } from './HighlightStore'
export type {
  HighlightRecord,
  CreateHighlightInput,
  ListByPageFilter
} from './HighlightStore'
