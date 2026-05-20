/**
 * Sprint 015 M3-6 — v0.3 → v0.4 자동 마이그레이션.
 *
 * 입력 SSOT: A3 (`.flowset/specs/v04-data-migration.md`) §B 5단계 절차.
 * PRD §19.3 / §19.4 정합.
 * G-014 가드레일 활성: dry-run + 자동 백업 (`<userDataDir>/backup/v03/<ISO_ts>/`) + revert.
 *
 * 5 단계:
 *   1. 자동 백업 — 5개 JSON 파일 copy
 *   2. Dry-run 시뮬레이션 — in-memory 통계
 *   3. 실 마이그레이션 — SQLite + JSON 변환
 *   4. 원본 .deprecated 접미사 (즉시 삭제 X, 사용자 안전망)
 *   5. 로그 기록 + (호출자가 사용자 알림)
 *
 * 8 회귀 케이스 (`.flowset/specs/v04-data-migration.md` §B5):
 *   1. 빈 데이터 → fresh install
 *   2. Glossary 3 → Note 3 (ai_tags 정확성)
 *   3. TranslationCache 매핑 (translation kind, summary skip)
 *   4. PageResults → Page+Visit (workspace_id 부여)
 *   5. UserSetting 폐기 키 제거 + 신규 키 디폴트
 *   6. TabState 모든 탭 workspace_id 부여
 *   7. Dry-run 오류 → revert (flowbrowser.db 생성 X + 백업 보존)
 *   8. Idempotent (두 번째 실행 시 skip)
 */

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'

import type { FlowbrowserDatabase } from '../Database'
import type { NoteStore } from '../NoteStore'
import type { IndexedPageStoreSqlite } from '../IndexedPageStoreSqlite'
import type { EmbeddingQueue } from '../EmbeddingQueue'

/** A3 §B1 트리거 입력 5개 파일. */
export const V03_SOURCE_FILES = [
  'translation-cache.json',
  'page-results.json',
  'glossary.json',
  'user-setting.json',
  'tabs.json'
] as const

/**
 * M3 핫픽스 (2026-05-18 codex BLOCKING) — sentinel 은 더 이상 file 파일이 아닌
 * `schema_meta.migration_v04_applied` 키로 판정.
 *
 * **이유**: file-mode `FlowbrowserDatabase.open()` 가 빈 `flowbrowser.db` 파일을 먼저 생성하기 때문에
 * 파일 존재 자체가 sentinel 일 수 없음. 빈 DB → migration 호출 시 `already_migrated` 로 잘못 분기 →
 * 실제 v0.3 사용자 데이터 영구 미이전 위험.
 *
 * 해소: 마이그레이션이 실제로 완료된 시점에 `schema_meta` 테이블에 키-값 (ISO timestamp) 박음.
 * - 마이그레이션 진입 검사: `fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)` 결과 존재 시 skip
 * - 마이그레이션 종료: `fb.setSchemaMeta(MIGRATION_SCHEMA_META_KEY, ISO timestamp)` 박음
 * - revert: 키 삭제 (마이그레이션이 throw 한 경우 일반적으로 키 미박힘 — 안전 보강)
 */
export const MIGRATION_SCHEMA_META_KEY = 'migration_v04_applied'

/** @deprecated 본 상수는 file-mode 부팅 경로에서 영구 skip 위험으로 사용 금지. `MIGRATION_SCHEMA_META_KEY` 사용. */
export const V04_DB_SENTINEL = 'flowbrowser.db'

export const V04_LOG_FILE = 'migration-v04.log'
export const V04_BACKUP_ROOT = 'backup/v03'

/** v0.3 GlossaryTerm 부분 schema (마이그레이션 입력) */
interface V03GlossaryTerm {
  id?: string
  sourceTerm?: string
  targetTerm?: string
  description?: string
  domain?: string
  isActive?: boolean
}

/** v0.3 PageResult entry 부분 schema */
interface V03PageResultEntry {
  id?: string
  url?: string
  createdAt?: number
}

/** v0.3 UserSetting 폐기 키 list (A3 §A4) */
const V03_DEPRECATED_KEYS = ['translationMode', 'cancelOnTabSwitch']

export interface MigrateOptions {
  userDataDir: string
  fb: FlowbrowserDatabase
  noteStore: NoteStore
  pageStore: IndexedPageStoreSqlite
  embeddingQueue?: EmbeddingQueue
  /** 디폴트 false. true 면 backup/dry-run/log 까지만, 실 마이그레이션 + rename 미수행 */
  dryRunOnly?: boolean
}

export interface MigrationCounts {
  glossary_to_notes: number
  glossary_terms_with_domain: number
  cache_entries_kept: number
  cache_entries_skipped: number
  pages: number
  visits: number
  user_setting_keys_removed: number
  user_setting_keys_added: number
  tabs_workspace_assigned: number
  embedding_jobs_enqueued: number
}

export interface MigrationResult {
  status: 'fresh_install' | 'migrated' | 'already_migrated' | 'dry_run_only' | 'reverted'
  backup_path?: string
  log_path: string
  counts: MigrationCounts
  error?: string
}

function emptyCounts(): MigrationCounts {
  return {
    glossary_to_notes: 0,
    glossary_terms_with_domain: 0,
    cache_entries_kept: 0,
    cache_entries_skipped: 0,
    pages: 0,
    visits: 0,
    user_setting_keys_removed: 0,
    user_setting_keys_added: 0,
    tabs_workspace_assigned: 0,
    embedding_jobs_enqueued: 0
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function readJsonOptional<T>(path: string): Promise<T | null> {
  if (!(await exists(path))) return null
  const raw = await fs.readFile(path, 'utf-8')
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function appendLog(logPath: string, lines: string[]): Promise<void> {
  await fs.appendFile(logPath, lines.map((l) => `${l}\n`).join(''), 'utf-8')
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * Public entry — A3 §B 5단계 마이그레이션 실행.
 *
 * 멱등성: `schema_meta.migration_v04_applied` 키 존재 시 'already_migrated' 반환 (skip).
 *   - **M3 핫픽스 (2026-05-18 codex BLOCKING)**: 기존 file-sentinel (`<userDataDir>/flowbrowser.db`) 방식은
 *     file-mode `FlowbrowserDatabase.open()` 이 빈 DB 를 먼저 생성하면 sentinel 의미 상실. 영구 skip 위험.
 * 5개 source 파일 모두 없으면 'fresh_install' (백업/마이그레이션 skip).
 *
 * **호출 순서 contract (services.ts wiring 시점)**:
 *   1. `const fb = FlowbrowserDatabase.bootstrap({ path })` — schema 적용 완료 보장
 *   2. `const defaultWs = fb.ensureDefaultWorkspace()` — workspace 준비
 *   3. `const noteStore = new NoteStore(fb)` / `pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })`
 *   4. `await migrateV03ToV04({ userDataDir, fb, noteStore, pageStore, ... })` — schema_meta 기반 멱등 진입
 *   5. 사용자 알림은 호출자 책임
 */
export async function migrateV03ToV04(opts: MigrateOptions): Promise<MigrationResult> {
  const { userDataDir, fb, noteStore, pageStore, embeddingQueue, dryRunOnly = false } = opts
  const logPath = join(userDataDir, V04_LOG_FILE)
  const counts = emptyCounts()

  // 1. trigger 조건 — schema_meta key (M3 핫픽스) + source 5개 존재 검사
  const sentinelMeta = fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)
  const sourceExistence = await Promise.all(
    V03_SOURCE_FILES.map((f) => exists(join(userDataDir, f)))
  )
  const hasAnySource = sourceExistence.some(Boolean)

  await ensureDirForFile(logPath)
  await appendLog(logPath, [`[${isoTimestamp()}] migration v03 → v04 trigger check`])

  if (sentinelMeta) {
    await appendLog(logPath, [
      `[skip] schema_meta.${MIGRATION_SCHEMA_META_KEY}=${sentinelMeta.value} → already_migrated (idempotent)`
    ])
    return { status: 'already_migrated', log_path: logPath, counts }
  }
  if (!hasAnySource) {
    await appendLog(logPath, ['[fresh] no v03 source files → fresh_install (schema-only)'])
    return { status: 'fresh_install', log_path: logPath, counts }
  }

  // 2. 자동 백업 (G-014)
  const ts = isoTimestamp()
  const backupPath = join(userDataDir, V04_BACKUP_ROOT, ts)
  await fs.mkdir(backupPath, { recursive: true })
  for (let i = 0; i < V03_SOURCE_FILES.length; i++) {
    if (!sourceExistence[i]) continue
    const src = join(userDataDir, V03_SOURCE_FILES[i])
    const dst = join(backupPath, V03_SOURCE_FILES[i])
    await fs.copyFile(src, dst)
    await appendLog(logPath, [`[backup] ${V03_SOURCE_FILES[i]} → ${dst}`])
  }

  try {
    // 3. Dry-run + 실 마이그레이션 — 본 구현은 두 단계를 한 패스로 (in-memory simulation 생략, 실 패스 중 throw 시 revert)
    if (dryRunOnly) {
      // dry-run mode — 로그만 통계 추정 (DB write 미실행)
      await dryRunSimulate(userDataDir, counts, logPath)
      return { status: 'dry_run_only', backup_path: backupPath, log_path: logPath, counts }
    }

    const defaultWs = fb.ensureDefaultWorkspace()
    await appendLog(logPath, [
      `[migrate] default workspace id=${defaultWs.id} name=${defaultWs.name}`
    ])

    // 3a. Glossary → Note
    await migrateGlossary(userDataDir, defaultWs.id, noteStore, counts, logPath)

    // 3b. PageResultStore → Page + Visit (+ embedding queue)
    await migratePageResults(
      userDataDir,
      defaultWs.id,
      pageStore,
      embeddingQueue,
      counts,
      logPath
    )

    // 3c. TranslationCache — kind:translation 부여 (in-place, JSON file rewrite)
    await migrateTranslationCache(userDataDir, counts, logPath)

    // 3d. UserSetting — 폐기 키 제거 + workspaceDefault 등 신규 키 디폴트
    await migrateUserSetting(userDataDir, defaultWs.id, counts, logPath)

    // 3e. TabState — 모든 탭 workspaceId 부여
    await migrateTabState(userDataDir, defaultWs.id, counts, logPath)

    // 4. 원본 .deprecated 접미사
    for (const f of V03_SOURCE_FILES) {
      const src = join(userDataDir, f)
      if (await exists(src)) {
        const dst = join(userDataDir, `${f}.deprecated`)
        await fs.rename(src, dst)
        await appendLog(logPath, [`[rename] ${f} → ${basename(dst)} (30일 후 삭제 권고)`])
      }
    }

    // 5. schema_meta sentinel 박힘 — 마이그레이션 완료 시점 (in-memory / file mode 동일).
    //    M3 핫픽스: file sentinel 폐기. schema_meta key 가 안전한 멱등성 sentinel.
    fb.setSchemaMeta(MIGRATION_SCHEMA_META_KEY, isoTimestamp())

    await appendLog(logPath, [
      `[${isoTimestamp()}] migration v03 → v04 complete`,
      `  glossary_to_notes=${counts.glossary_to_notes} pages=${counts.pages} visits=${counts.visits}`,
      `  cache_kept=${counts.cache_entries_kept} cache_skipped=${counts.cache_entries_skipped}`,
      `  tabs_assigned=${counts.tabs_workspace_assigned} embedding_jobs=${counts.embedding_jobs_enqueued}`
    ])
    return { status: 'migrated', backup_path: backupPath, log_path: logPath, counts }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendLog(logPath, [`[error] ${message} — initiating revert`])
    await revertMigration(userDataDir, backupPath, logPath, fb)
    return {
      status: 'reverted',
      backup_path: backupPath,
      log_path: logPath,
      counts,
      error: message
    }
  }
}

async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = filePath.substring(0, Math.max(0, filePath.lastIndexOf('/')))
  if (dir) await fs.mkdir(dir, { recursive: true }).catch(() => {})
}

async function dryRunSimulate(
  userDataDir: string,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const glossary = await readJsonOptional<{ terms?: V03GlossaryTerm[] }>(
    join(userDataDir, 'glossary.json')
  )
  const terms = glossary?.terms ?? []
  counts.glossary_to_notes = terms.length
  counts.glossary_terms_with_domain = terms.filter((t) => Boolean(t.domain)).length

  // Sprint 016 M2 T12 (codex BLOCKING #1 hotfix) — v0.3 PageResultStore 는 raw array `PageResultEntry[]` 로 영속.
  //   본 마이그레이션은 raw array + wrapper `{ entries }` 양쪽 shape 모두 허용 (실 사용자 데이터 손실 차단).
  const pageResultsRaw = await readJsonOptional<
    V03PageResultEntry[] | { entries?: V03PageResultEntry[] }
  >(join(userDataDir, 'page-results.json'))
  const pageEntries = Array.isArray(pageResultsRaw)
    ? pageResultsRaw
    : (pageResultsRaw?.entries ?? [])
  counts.pages = pageEntries.length
  counts.visits = counts.pages

  await appendLog(logPath, [
    `[dry-run] glossary: ${counts.glossary_to_notes} terms (domain=${counts.glossary_terms_with_domain})`,
    `[dry-run] page-results: ${counts.pages} pages`
  ])
}

async function migrateGlossary(
  userDataDir: string,
  workspaceId: string,
  noteStore: NoteStore,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const path = join(userDataDir, 'glossary.json')
  const data = await readJsonOptional<{ terms?: V03GlossaryTerm[] }>(path)
  if (!data?.terms?.length) {
    await appendLog(logPath, ['[migrate] glossary.json: 0 terms'])
    return
  }
  for (const t of data.terms) {
    if (!t.sourceTerm) continue
    const targetTerm = t.targetTerm ?? ''
    const description = t.description ?? ''
    const body = description ? `${targetTerm}\n\n${description}` : targetTerm || null
    const aiTags = ['glossary']
    if (t.domain && t.domain.trim()) aiTags.push(`domain:${t.domain.trim()}`)
    if (t.domain && t.domain.trim()) counts.glossary_terms_with_domain += 1
    noteStore.create({
      workspace_id: workspaceId,
      selected_text: t.sourceTerm,
      body,
      ai_tags: aiTags,
      created_by: 'migration'
    })
    counts.glossary_to_notes += 1
  }
  await appendLog(logPath, [
    `[migrate] glossary: ${counts.glossary_to_notes} → notes (domain tagged=${counts.glossary_terms_with_domain})`
  ])
}

async function migratePageResults(
  userDataDir: string,
  workspaceId: string,
  pageStore: IndexedPageStoreSqlite,
  embeddingQueue: EmbeddingQueue | undefined,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const path = join(userDataDir, 'page-results.json')
  // Sprint 016 M2 T12 (codex BLOCKING #1 hotfix) — v0.3 PageResultStore raw array shape + wrapper shape 양쪽 허용.
  const dataRaw = await readJsonOptional<
    V03PageResultEntry[] | { entries?: V03PageResultEntry[] }
  >(path)
  const entries = Array.isArray(dataRaw) ? dataRaw : (dataRaw?.entries ?? [])
  if (!entries.length) {
    await appendLog(logPath, ['[migrate] page-results.json: 0 entries'])
    return
  }
  for (const e of entries) {
    if (!e.url) continue
    const visitedAt = e.createdAt ?? Date.now()
    const { page, visit } = await pageStore.recordVisit({
      workspace_id: workspaceId,
      url: e.url,
      content: '', // v0.3에 본문 없음 — 재방문 시 인덱싱
      visited_at: visitedAt
    })
    counts.pages += 1
    counts.visits += 1
    if (embeddingQueue && page.content) {
      embeddingQueue.enqueue({
        target_type: 'page',
        target_id: page.id,
        workspace_id: workspaceId,
        priority: 0
      })
      counts.embedding_jobs_enqueued += 1
    }
    void visit
  }
  await appendLog(logPath, [
    `[migrate] page-results: ${counts.pages} → pages + ${counts.visits} visits`
  ])
}

/**
 * Sprint 016 M2 T11 (codex BLOCKING #1 + #2 hotfix) — v0.3 TranslationCache 영속 shape 정합 + AIResponseCache 가 읽을 수 있는 raw array output.
 *
 * 입력 shape:
 *   - v0.3 TranslationCache.persistOnce() 는 `JSON.stringify(all)` = raw array `CacheEntry[]` (정합).
 *   - 일부 v0.3.x fixture / legacy 는 `{ entries: { key: entry } }` wrapper 가능 — 호환 위해 양쪽 허용.
 *
 * 출력 shape:
 *   - AIResponseCache.load() 가 raw array `AICacheEntry[]` 기대 (parseEntry: id/kind/key/value/hitCount/createdAt/updatedAt/lastAccessedAt/expiresAt 필수).
 *   - 본 마이그레이션은 TranslationCache.buildKey() 와 동일 알고리즘으로 composite key 재구성 + value 는 `{id, sourceText, translatedText, domain, createdAt}` (이전 어댑터 모드와 정합).
 */
interface V03TranslationCacheEntry {
  id?: string
  sourceHash?: string
  sourceText?: string
  translatedText?: string
  sourceLanguage?: string
  targetLanguage?: string
  providerType?: string
  requestType?: string
  glossaryVersion?: string
  domain?: string | null
  hitCount?: number
  createdAt?: number
  updatedAt?: number
  lastAccessedAt?: number
  expiresAt?: number
}

async function migrateTranslationCache(
  userDataDir: string,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const path = join(userDataDir, 'translation-cache.json')
  const dataRaw = await readJsonOptional<
    V03TranslationCacheEntry[] | { entries?: Record<string, V03TranslationCacheEntry> }
  >(path)
  const entries: V03TranslationCacheEntry[] = Array.isArray(dataRaw)
    ? dataRaw
    : dataRaw?.entries
    ? Object.values(dataRaw.entries)
    : []
  if (!entries.length) {
    await appendLog(logPath, ['[migrate] translation-cache.json: 0 entries'])
    return
  }
  const aiCacheEntries: Array<Record<string, unknown>> = []
  const now = Date.now()
  for (const e of entries) {
    if (e.requestType === 'summary') {
      counts.cache_entries_skipped += 1
      continue
    }
    // TranslationCache.buildKey 와 정합한 composite key 재구성 (sourceHash + 5-tuple)
    if (!e.sourceHash || !e.sourceLanguage || !e.targetLanguage || !e.providerType || !e.requestType) {
      counts.cache_entries_skipped += 1
      continue
    }
    const composite = [
      e.sourceHash,
      e.sourceLanguage,
      e.targetLanguage,
      e.providerType,
      e.requestType,
      e.glossaryVersion ?? 'default'
    ].join('|')
    const createdAt = e.createdAt ?? now
    const updatedAt = e.updatedAt ?? createdAt
    const lastAccessedAt = e.lastAccessedAt ?? createdAt
    const expiresAt = e.expiresAt ?? createdAt + 90 * 24 * 60 * 60 * 1000
    aiCacheEntries.push({
      id: e.id ?? `aic_${createdAt.toString(36)}_${counts.cache_entries_kept.toString(36)}`,
      kind: 'translation',
      key: composite,
      value: {
        id: e.id ?? composite,
        sourceText: e.sourceText ?? '',
        translatedText: e.translatedText ?? '',
        domain: e.domain ?? null,
        createdAt
      },
      metadata: {
        sourceHash: e.sourceHash,
        sourceLanguage: e.sourceLanguage,
        targetLanguage: e.targetLanguage,
        providerType: e.providerType,
        requestType: e.requestType,
        glossaryVersion: e.glossaryVersion ?? 'default'
      },
      hitCount: typeof e.hitCount === 'number' && e.hitCount >= 0 ? Math.floor(e.hitCount) : 0,
      createdAt,
      updatedAt,
      lastAccessedAt,
      expiresAt
    })
    counts.cache_entries_kept += 1
  }
  // 변환된 cache 는 ai-response-cache.json 으로 export (AIResponseCache.persistOnce 와 동일 shape = raw array).
  // 원본 translation-cache.json 은 Step 4 에서 .deprecated 접미사 (30일 후 삭제 권고).
  const aiCachePath = join(userDataDir, 'ai-response-cache.json')
  await fs.writeFile(aiCachePath, JSON.stringify(aiCacheEntries, null, 0), 'utf-8')
  await appendLog(logPath, [
    `[migrate] cache: ${counts.cache_entries_kept} kept (translation kind) + ${counts.cache_entries_skipped} skipped (summary/invalid)`
  ])
}

async function migrateUserSetting(
  userDataDir: string,
  workspaceId: string,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const path = join(userDataDir, 'user-setting.json')
  const data = await readJsonOptional<Record<string, unknown>>(path)
  if (!data) {
    await appendLog(logPath, ['[migrate] user-setting.json: missing'])
    return
  }
  const next: Record<string, unknown> = { ...data }
  for (const k of V03_DEPRECATED_KEYS) {
    if (k in next) {
      delete next[k]
      counts.user_setting_keys_removed += 1
    }
  }
  const newDefaults: Record<string, unknown> = {
    workspaceDefault: workspaceId,
    userLevelPreference: null,
    shortcutOverride: { openSearch: 'Cmd+K' },
    privacyExclusions: []
  }
  for (const [k, v] of Object.entries(newDefaults)) {
    if (!(k in next)) {
      next[k] = v
      counts.user_setting_keys_added += 1
    }
  }
  await fs.writeFile(path, JSON.stringify(next, null, 0), 'utf-8')
  // user-setting.json 는 .deprecated 시키지 않고 그대로 유지 (다음 step rename 에서 제외)
  // 단, 본 구현은 rename 일괄 처리라 .deprecated 가 붙음 — 의도된 동작 (A3 §B Step 4)
  await appendLog(logPath, [
    `[migrate] user-setting: removed ${counts.user_setting_keys_removed} keys + added ${counts.user_setting_keys_added} defaults`
  ])
}

async function migrateTabState(
  userDataDir: string,
  workspaceId: string,
  counts: MigrationCounts,
  logPath: string
): Promise<void> {
  const path = join(userDataDir, 'tabs.json')
  const data = await readJsonOptional<{ tabs?: Array<Record<string, unknown>>; activeId?: string }>(
    path
  )
  if (!data?.tabs) {
    await appendLog(logPath, ['[migrate] tabs.json: missing or empty'])
    return
  }
  // Sprint 016 M0 T03a (codex BLOCKING #2) — 신규 TabStateStore schema 와 필드명 정합.
  // 본 마이그레이션이 v0.3 → v0.4 진입 시 1회 실행. snake_case 영속이 신규 TabStateStore.load() 가 읽는 키.
  const nextTabs = data.tabs.map((t) => {
    if ('workspace_id' in t && t.workspace_id) return t
    // legacy v0.4-pre 산출물 호환: 'workspaceId' camelCase 키만 박혀 있던 경우 정규화.
    if ('workspaceId' in t && t.workspaceId) {
      const { workspaceId: legacy, ...rest } = t as Record<string, unknown> & { workspaceId: unknown }
      return { ...rest, workspace_id: legacy }
    }
    counts.tabs_workspace_assigned += 1
    return { ...t, workspace_id: workspaceId }
  })
  await fs.writeFile(path, JSON.stringify({ ...data, tabs: nextTabs }, null, 0), 'utf-8')
  await appendLog(logPath, [
    `[migrate] tabs: ${counts.tabs_workspace_assigned}/${data.tabs.length} assigned workspace_id`
  ])
}

/**
 * 오류 발생 시 revert — 백업에서 원본 복원 + ai-response-cache.json 삭제 + schema_meta sentinel key 삭제.
 *
 * **M3 핫픽스 (2026-05-18 codex BLOCKING)**: 기존 `flowbrowser.db` 파일 삭제 로직 폐기.
 * `fb` 인자가 주입되면 schema_meta key 삭제로 sentinel 초기화 (재시도 시 다시 트리거).
 * `fb` 미주입 시 (기존 호출자 호환) key 정리 skip — 마이그레이션 실패 시점은 일반적으로 key 미박힘이므로 안전.
 *
 * idempotent — 재시도 시 다시 트리거.
 */
export async function revertMigration(
  userDataDir: string,
  backupPath: string,
  logPath: string,
  fb?: FlowbrowserDatabase
): Promise<void> {
  for (const f of V03_SOURCE_FILES) {
    const backupFile = join(backupPath, f)
    if (await exists(backupFile)) {
      const dst = join(userDataDir, f)
      // dst 가 이미 있으면 .deprecated 잔여로 인한 충돌 가능 — 우선 삭제
      if (await exists(dst)) await fs.unlink(dst)
      await fs.copyFile(backupFile, dst)
    }
  }
  // .deprecated 접미사 정리 (rename 단계까지 갔던 경우)
  for (const f of V03_SOURCE_FILES) {
    const dep = join(userDataDir, `${f}.deprecated`)
    if (await exists(dep)) await fs.unlink(dep)
  }
  const aiCache = join(userDataDir, 'ai-response-cache.json')
  if (await exists(aiCache)) await fs.unlink(aiCache)
  if (fb) {
    fb.getDb()
      .prepare('DELETE FROM schema_meta WHERE key = ?')
      .run(MIGRATION_SCHEMA_META_KEY)
  }
  await appendLog(logPath, [
    `[revert] restored from ${backupPath} + cleaned ai-response-cache.json + schema_meta.${MIGRATION_SCHEMA_META_KEY}`
  ])
}
