export { CredentialsStore, defaultCredentialsPath } from './Credentials'
export type { CredentialRecord, ProviderType as CredentialProviderType } from './Credentials'

export { UsageLog, defaultUsageLogPath } from './UsageLog'
export type { UsageLogEntry, Feature, UsageStatus } from './UsageLog'

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
export { PageResultStore, defaultPageResultPath, normalizePageUrl } from './PageResultStore'
export type {
  PageResultEntry,
  PageResultInstruction,
  PageResultLookupKey,
  PageResultStoreOptions
} from './PageResultStore'

export { TabStateStore, defaultTabStatePath, TAB_STATE_POLICY_VERSION } from './TabStateStore'
export type { PersistedTabSession, PersistedTabState } from './TabStateStore'
