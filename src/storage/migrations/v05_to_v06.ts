/**
 * Sprint 018 M2 T17a — v0.5 → v0.6 자동 마이그레이션 (로컬 임베딩 통합 진입 조건).
 *
 * 입력 SSOT:
 *   - `.flowset/specs/sprint-018-schema-v06-spec.md` §3~§4 (B3+B2 결정 + 마이그레이션 5단계)
 *   - `src/storage/schema/v06.sql` (canonical v06 선언 스키마 — drift-check 기준)
 *   - G-014 강제: dry-run + `<userDataDir>/backup/v05/<ISO_ts>/flowbrowser.db` 자동 백업
 *   - codex 019e6574 권고 A (explicit 변환, applySchema 불변) + 트랜잭션 래핑 권고
 *
 * v06 transition 3종 (v06 는 순수 additive 아님 — applySchema IF NOT EXISTS 로 불충분):
 *   1. workspaces.embedding_model 컬럼 추가 (ALTER ADD COLUMN, DEFAULT 'openai:text-embedding-3-small:1024')
 *   2. vec_pages → vec_pages_1024 (+ vec_pages_768 신규) / vec_notes → vec_notes_1024 (+ vec_notes_768 신규)
 *      — vec0 ALTER RENAME 불가 (T17a PoC 실측: shadow 테이블 미동반 → 깨짐) → INSERT…SELECT copy + DROP 원본
 *   3. 트리거 교체 — pages/notes DELETE 시 _1024 + _768 둘 다 삭제 (v05 단일 → v06 이중)
 *
 * 호출 순서 (services.ts wiring — T17b 에서 체인 적용):
 *   1. `fb = FlowbrowserDatabase.open({ path })`
 *   2. `v05 = await migrateV04ToV05({ fb, userDataDir })`
 *   3. `await migrateV05ToV06({ fb, userDataDir, freshInstall: v05.status === 'fresh_install' })`  ← T17b
 *   4. `fb.ensureDefaultWorkspace()`
 *   ※ T17a 는 함수 + 회귀만. services.ts 체인 + VectorIndex dimension 분기는 T17b.
 *
 * 안전성 (T17a PoC 실측):
 *   - 변환 DDL/DML 전체를 단일 better-sqlite3 transaction 으로 래핑 — 중간 실패 시 vec_pages 복원 +
 *     embedding_model 컬럼 미추가 + schema_meta.version/sentinel 미박힘 (rollback 검증 통과).
 *   - 백업은 transaction 진입 전 (파일 op) — 실패 시 schema 무변경.
 *
 * 회귀 케이스 (`tests/unit/storage/migrations/v05_to_v06.test.ts`):
 *   1. fresh v05 → 변환 + sentinel (백업 skip, freshInstall=true)
 *   2. v05 DB (데이터 보유) → 백업 + 변환 + sentinel
 *   3. vec 데이터 보존 (vec_pages → vec_pages_1024 행/검색 보존)
 *   4. embedding_model 컬럼 DEFAULT 채움 + CHECK 위반 거부
 *   5. dry-run only → 백업만, 변환/sentinel 미박힘
 *   6. Idempotent — 두 번째 실행 시 already_migrated
 *   7. 백업 파일 실존 검증 (flowbrowser.db snapshot)
 *   8. 변환 중 실패 시 rollback (vec_pages 복원, schema 무변경)
 *   9. drift-check — migrate(v05) schema shape ≡ fresh applySchema(v06.sql)
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { FlowbrowserDatabase } from '../Database'
import { V06_SCHEMA_VERSION } from '../Database'

/**
 * v05 → v06 sentinel — 마이그레이션 완료 시점에 박는 `schema_meta` 키.
 * 진입 검사: 존재 시 즉시 `already_migrated`. 종료 시: ISO timestamp 박음.
 * v04 → v05 의 `migration_v05_applied` 와 동일 패턴.
 */
export const MIGRATION_V06_SCHEMA_META_KEY = 'migration_v06_applied'

/** 마이그레이션 로그 파일명. */
export const V06_LOG_FILE = 'migration-v06.log'

/** 자동 백업 root (G-014). `<userDataDir>/backup/v05/<ISO_ts>/flowbrowser.db` 박힘. */
export const V06_BACKUP_ROOT = 'backup/v05'

/** 백업 대상 파일명 — 일관 snapshot 위해 `fb.getDb().backup()` 사용 (WAL safe). */
export const V06_BACKUP_FILE = 'flowbrowser.db'

export interface MigrateV06Options {
  /** Electron `app.getPath('userData')` (백업 root + log 경로 base). */
  userDataDir: string
  /** 열린 `FlowbrowserDatabase` (v05 schema 적용 상태 권장 — migrateV04ToV05 직후). */
  fb: FlowbrowserDatabase
  /**
   * 디폴트 false. true 면 백업 skip (백업할 사용자 데이터 없음).
   * services.ts 에서 `migrateV04ToV05` 반환 status === 'fresh_install' 일 때 전달 (T17b).
   * codex 019e6574 — workspace row count 판정 금지, 직전 마이그레이션 status 전달 권고.
   */
  freshInstall?: boolean
  /** 디폴트 false. true 면 백업까지만, 변환 + sentinel skip (dry-run mode). */
  dryRunOnly?: boolean
  /**
   * 테스트 / 검증용 — backup() 호출 대신 임의 함수 주입 (예: 백업 실패 시 throw simulate).
   * 미주입 시 `fb.getDb().backup(destPath)` 사용.
   */
  backupFn?: (fb: FlowbrowserDatabase, destPath: string) => Promise<void>
}

export type MigrateV06Status =
  | 'fresh_install' // freshInstall=true — 백업 skip, 변환 + sentinel
  | 'migrated' // v05 DB → 백업 + 변환 + sentinel
  | 'already_migrated' // sentinel 존재 — skip
  | 'dry_run_only' // dryRunOnly=true — 백업까지만

export interface MigrateV06Result {
  status: MigrateV06Status
  /** 백업 디렉토리 (`<userDataDir>/backup/v05/<ISO_ts>/`). fresh / already_migrated 시 undefined. */
  backup_path?: string
  /** 백업 파일 절대 경로 (`<backup_path>/flowbrowser.db`). 백업 미수행 시 undefined. */
  backup_file?: string
  /** 마이그레이션 로그 파일 절대 경로. */
  log_path: string
  /** 이전 schema_meta.version (v05 DB 인 경우 '2'). schema_meta 미존재 시 null. */
  previous_version: string | null
  /** 적용 후 schema_meta.version ('3' 박힘). already_migrated/dry-run 시 변동 X. */
  applied_version: string | null
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function appendLog(logPath: string, lines: string[]): Promise<void> {
  await fs.mkdir(join(logPath, '..'), { recursive: true }).catch(() => {})
  await fs.appendFile(logPath, lines.map((l) => `${l}\n`).join(''), 'utf-8')
}

/** schema_meta.version 행 값 (없으면 null). schema_meta 테이블 미존재 시에도 안전. */
function probeVersion(fb: FlowbrowserDatabase): string | null {
  const db = fb.getDb()
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`)
    .get() as { name?: string } | undefined
  if (!tbl?.name) return null
  return fb.getSchemaMeta('version')?.value ?? null
}

/** workspaces.embedding_model 컬럼 존재 여부 (이미 v06 인지 방어 판정). */
function hasEmbeddingModelColumn(fb: FlowbrowserDatabase): boolean {
  const cols = fb.getDb().prepare(`PRAGMA table_info(workspaces)`).all() as Array<{ name: string }>
  return cols.some((c) => c.name === 'embedding_model')
}

/**
 * v05 → v06 변환 DDL/DML (단일 transaction 내 실행 — 호출자가 db.transaction 으로 래핑).
 *
 * codex 019e6574 권고 순서: old trigger drop → ALTER → _1024/_768 생성 → copy → old vec drop →
 * new trigger create → version + sentinel 박음. 전부 sync.
 *
 * @param sentinelTs — `migration_v06_applied` sentinel 에 박을 ISO timestamp.
 *   version 과 sentinel 을 **동일 transaction 내** 박음 (codex 019e658a NEEDS_CHANGES #1) —
 *   commit 후 별도 sentinel write 시 commit↔write 사이 crash 로 "v06 인데 sentinel 부재" 영구 inconsistency 차단.
 */
function applyV06Transform(fb: FlowbrowserDatabase, sentinelTs: string): void {
  const db = fb.getDb()
  // 1. 기존(v05) 트리거 제거 — dropped table 가리키는 깨진 trigger 방지 (codex 019e6574).
  db.exec(`
    DROP TRIGGER IF EXISTS pages_after_delete_vec_pages;
    DROP TRIGGER IF EXISTS notes_after_delete_vec_notes;
  `)
  // 2. workspaces.embedding_model 컬럼 추가 (NOT NULL DEFAULT + CHECK — 기존 행 DEFAULT 채움).
  db.exec(`
    ALTER TABLE workspaces ADD COLUMN embedding_model TEXT NOT NULL
      DEFAULT 'openai:text-embedding-3-small:1024'
      CHECK (embedding_model IN (
        'openai:text-embedding-3-small:1024',
        'ollama:nomic-embed-text:768'
      ))
  `)
  // 3. dimension 별 vec0 테이블 신규 (1024 + 768, pages + notes).
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages_1024 USING vec0(
      page_id TEXT, workspace_id TEXT partition key, embedding float[1024] distance_metric=cosine
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages_768 USING vec0(
      page_id TEXT, workspace_id TEXT partition key, embedding float[768] distance_metric=cosine
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes_1024 USING vec0(
      note_id TEXT, workspace_id TEXT partition key, embedding float[1024] distance_metric=cosine
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes_768 USING vec0(
      note_id TEXT, workspace_id TEXT partition key, embedding float[768] distance_metric=cosine
    );
  `)
  // 4. 기존 1024 데이터 copy (vec_pages → vec_pages_1024, vec_notes → vec_notes_1024).
  //    vec0 ALTER RENAME 불가 (shadow 미동반) → INSERT…SELECT (embedding Buffer 보존, T17a PoC).
  db.exec(`
    INSERT INTO vec_pages_1024(page_id, workspace_id, embedding)
      SELECT page_id, workspace_id, embedding FROM vec_pages;
    INSERT INTO vec_notes_1024(note_id, workspace_id, embedding)
      SELECT note_id, workspace_id, embedding FROM vec_notes;
  `)
  // 5. 원본 단일 vec 테이블 제거.
  db.exec(`
    DROP TABLE vec_pages;
    DROP TABLE vec_notes;
  `)
  // 6. v06 트리거 신규 — _1024 + _768 둘 다 삭제.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS pages_after_delete_vec_pages_v06
      AFTER DELETE ON pages FOR EACH ROW
      BEGIN
        DELETE FROM vec_pages_1024 WHERE page_id = OLD.id;
        DELETE FROM vec_pages_768 WHERE page_id = OLD.id;
      END;
    CREATE TRIGGER IF NOT EXISTS notes_after_delete_vec_notes_v06
      AFTER DELETE ON notes FOR EACH ROW
      BEGIN
        DELETE FROM vec_notes_1024 WHERE note_id = OLD.id;
        DELETE FROM vec_notes_768 WHERE note_id = OLD.id;
      END;
  `)
  // 7. schema_meta.version = 3 + sentinel (transaction 내 — rollback 시 함께 원복, atomic 박힘).
  //    version + sentinel 을 같은 txn 에 두어 부분 박힘(version 만 / sentinel 만) inconsistency 차단.
  fb.setSchemaMeta('version', String(V06_SCHEMA_VERSION))
  fb.setSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY, sentinelTs)
}

/**
 * Public entry — v05 → v06 마이그레이션 (G-014 정합).
 *
 * 5 단계:
 *   1. sentinel 체크 → 존재 시 already_migrated skip. sentinel 부재 + embedding_model 컬럼 존재 시
 *      hard fail (부분/외부 변형 — 조용한 skip 금지, codex 019e658a NEEDS_CHANGES #2)
 *   2. 백업 (freshInstall=false 인 경우만 — G-014, `backup/v05/<ts>/flowbrowser.db`)
 *   3. dryRunOnly 분기 → 백업까지만
 *   4. 변환 transaction (old trigger drop → ALTER → _1024/_768 생성 → copy → old vec drop →
 *      new trigger → version + sentinel) — 실패 시 전체 rollback. version + sentinel 동일 txn (atomic).
 *   5. commit 후 결과 반환 (version=3 + sentinel 박힌 상태)
 */
export async function migrateV05ToV06(opts: MigrateV06Options): Promise<MigrateV06Result> {
  const { userDataDir, fb, freshInstall = false, dryRunOnly = false, backupFn } = opts
  const logPath = join(userDataDir, V06_LOG_FILE)
  await appendLog(logPath, [
    `[${isoTimestamp()}] v05 → v06 마이그레이션 진입 (freshInstall=${freshInstall}, dryRunOnly=${dryRunOnly})`
  ])

  const previousVersion = probeVersion(fb)

  // 1. sentinel 체크 — 존재 시 already_migrated. sentinel 은 version 과 동일 transaction 박힘 (신뢰 가능 단일 신호).
  const sentinel = fb.getSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY)
  if (sentinel) {
    await appendLog(logPath, [`[skip] sentinel=${sentinel.value} → already_migrated`])
    return {
      status: 'already_migrated',
      log_path: logPath,
      previous_version: previousVersion,
      applied_version: previousVersion
    }
  }
  // sentinel 부재인데 embedding_model 컬럼이 이미 존재 = 부분 마이그레이션 / 외부 변형 상태.
  //   정상 경로(version+sentinel 동일 txn)에서는 불가 — crash-mid-commit / 수동 변형 / 이전 실험 빌드 흔적.
  //   조용한 skip 금지 (codex 019e658a NEEDS_CHANGES #2) — 명시 hard fail 로 사용자 복구(백업 복원) 유도.
  if (hasEmbeddingModelColumn(fb)) {
    await appendLog(logPath, [
      `[error] embedding_model 컬럼 존재 + migration_v06_applied sentinel 부재 → 부분/외부 변형 의심 (hard fail)`
    ])
    throw new Error(
      'migrateV05ToV06: 일관성 위반 — workspaces.embedding_model 컬럼이 있으나 migration_v06_applied sentinel 부재. ' +
        '부분 마이그레이션/외부 변형 의심 — 수동 복구 필요 (backup/v05/<ISO_ts>/flowbrowser.db 복원 후 재시도).'
    )
  }

  // 2. 자동 백업 — freshInstall=false 인 경우만 (백업할 사용자 데이터 없음 시 skip).
  let backupDir: string | undefined
  let backupFile: string | undefined
  if (!freshInstall) {
    const ts = isoTimestamp()
    backupDir = join(userDataDir, V06_BACKUP_ROOT, ts)
    backupFile = join(backupDir, V06_BACKUP_FILE)
    await fs.mkdir(backupDir, { recursive: true })
    if (backupFn) {
      await backupFn(fb, backupFile)
    } else {
      const dbAny = fb.getDb() as unknown as {
        backup: (dest: string) => Promise<{ totalPages: number; remainingPages: number }>
      }
      await dbAny.backup(backupFile)
    }
    await appendLog(logPath, [`[backup] flowbrowser.db → ${backupFile} (WAL safe snapshot)`])
  } else {
    await appendLog(logPath, [`[backup] skip (freshInstall — 백업할 사용자 데이터 없음)`])
  }

  // 3. dryRunOnly 분기 — 백업까지만, 변환/sentinel 박지 않음.
  if (dryRunOnly) {
    await appendLog(logPath, [
      `[dry-run] 변환 + sentinel 박지 않음. backup 만 박힘 (${backupFile ?? 'skip (freshInstall)'})`
    ])
    return {
      status: 'dry_run_only',
      backup_path: backupDir,
      backup_file: backupFile,
      log_path: logPath,
      previous_version: previousVersion,
      applied_version: previousVersion
    }
  }

  // 4. 변환 transaction — version + sentinel 동일 txn 내 박음 (atomic, codex 019e658a NEEDS_CHANGES #1).
  //    중간 실패 시 전체 rollback (vec_pages 복원, version/sentinel 미박힘). T17a PoC + 회귀 8 검증.
  const sentinelTs = isoTimestamp()
  fb.getDb().transaction(() => {
    applyV06Transform(fb, sentinelTs)
  })()

  // 5. commit 후 — version + sentinel 둘 다 박힌 상태.
  const appliedVersion = probeVersion(fb)
  await appendLog(logPath, [
    `[apply] v05 → v06 변환 commit (${previousVersion ?? 'null'} → ${appliedVersion ?? 'null'})`,
    `[sentinel] schema_meta.${MIGRATION_V06_SCHEMA_META_KEY} 박힘 (변환 transaction 내, atomic)`
  ])

  return {
    status: freshInstall ? 'fresh_install' : 'migrated',
    backup_path: backupDir,
    backup_file: backupFile,
    log_path: logPath,
    previous_version: previousVersion,
    applied_version: appliedVersion
  }
}
