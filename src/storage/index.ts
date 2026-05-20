export { CredentialsStore, defaultCredentialsPath } from './Credentials'
export type { CredentialRecord, ProviderType as CredentialProviderType } from './Credentials'

export { UsageLog, defaultUsageLogPath, V04_FEATURES } from './UsageLog'
export type { UsageLogEntry, Feature, V03Feature, V04Feature, UsageStatus } from './UsageLog'

export { TranslationCache, defaultTranslationCachePath } from './TranslationCache'
export type { CacheEntry, CacheKeyInput, CacheOptions, CacheRequestType } from './TranslationCache'

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
  V04_SCHEMA_VERSION
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
  bufferToEmbedding
} from './VectorIndex'
export type { VectorSearchResult, EmbeddingInput } from './VectorIndex'

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
