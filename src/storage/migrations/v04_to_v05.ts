/**
 * Sprint 017 M1 T07 — v0.4 → v0.5 자동 마이그레이션.
 *
 * 입력 SSOT:
 *   - `.flowset/contracts/sprint-017.md` §2 M1 T07 (`v05.sql` + `v04_to_v05.ts` + HighlightStore SQLite swap)
 *   - PRD §11.2.1 highlights — 노트 anchor 영속 (Sprint 016 M5 T24 v0.4.1 발행 시점 박힘)
 *   - G-014 강제: dry-run + `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 자동 백업
 *
 * 5 단계 (codex 사전 협의 019e4dd1 BLOCKING 정합 — 마이그레이션 함수가 schema 적용 순서 소유):
 *   1. sentinel 체크 — `schema_meta.migration_v05_applied` 박힘 시 `already_migrated` skip
 *   2. v04 DB 판정 — `schema_meta` 테이블 존재 + row 검사 (fresh install 분기)
 *   3. 자동 백업 — `fb.getDb().backup(<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db)`
 *      WAL 모드 safe snapshot (codex 019e4dd1 #3 권고 — `fs.copyFile` 단독 부적합).
 *      fresh install 시 backup skip (백업할 v04 데이터 없음).
 *   4. (선택) dry-run — `dryRunOnly: true` 시 백업까지만, schema/sentinel 박지 않음.
 *   5. 실 적용 — `fb.applySchema()` (v05.sql idempotent, highlights 테이블 + 4종 인덱스 추가) + sentinel 박음.
 *
 * 호출 순서 (services.ts wiring 정합):
 *   1. `fb = FlowbrowserDatabase.open({ path })` — schema 미적용
 *   2. `result = await migrateV04ToV05({ fb, userDataDir })` — 백업 + schema 적용 + sentinel
 *   3. `fb.ensureDefaultWorkspace()` — 본 단계 호출자 책임
 *
 * 회귀 케이스 (`tests/unit/storage/migrations/v04_to_v05.test.ts`):
 *   1. Fresh install → applySchema + sentinel (백업 skip)
 *   2. v04 DB → 백업 + applySchema + sentinel (highlights 테이블 추가)
 *   3. v04 DB + 기존 데이터 보존 (workspaces / pages / notes / etc.)
 *   4. dry-run only → 백업만, schema 미적용, sentinel 미박힘
 *   5. Idempotent — 두 번째 실행 시 `already_migrated`
 *   6. 백업 파일 실존 검증 (`flowbrowser.db` snapshot)
 *   7. v04 → v05 직후 highlights 테이블 INSERT 가능
 *   8. 백업 실패 시 schema/sentinel 미박힘 (revert 안전)
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { FlowbrowserDatabase } from '../Database'

/**
 * v04 → v05 sentinel — 마이그레이션 완료 시점에 박는 `schema_meta` 키.
 *
 * 멱등성:
 *   - 진입 검사: `fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)` 결과 존재 시 skip
 *   - 종료 시: `fb.setSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY, ISO timestamp)` 박음
 *
 * v03 → v04 의 `migration_v04_applied` 와 동일 패턴 (학습 #8 박힘).
 */
export const MIGRATION_V05_SCHEMA_META_KEY = 'migration_v05_applied'

/** 마이그레이션 로그 파일명. v03 → v04 의 `migration-v04.log` 와 분리. */
export const V05_LOG_FILE = 'migration-v05.log'

/** 자동 백업 root (G-014). `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 박힘. */
export const V05_BACKUP_ROOT = 'backup/v04'

/** 백업 대상 파일명 — 일관 snapshot 위해 `fb.getDb().backup()` 사용 (WAL safe). */
export const V05_BACKUP_FILE = 'flowbrowser.db'

export interface MigrateV05Options {
  /** Electron `app.getPath('userData')` (백업 root + log 경로 base). */
  userDataDir: string
  /** 열린 `FlowbrowserDatabase` (schema 미적용 상태 권장 — 본 함수가 적용 책임). */
  fb: FlowbrowserDatabase
  /** 디폴트 false. true 면 백업까지만, schema 적용 + sentinel skip (dry-run mode). */
  dryRunOnly?: boolean
  /**
   * 테스트 / 검증용 — backup() 호출 대신 임의 함수 주입 (예: 백업 실패 시 throw simulate).
   * 미주입 시 `fb.getDb().backup(destPath)` 사용. better-sqlite3 12.x 의 `Backup` API 정합.
   */
  backupFn?: (fb: FlowbrowserDatabase, destPath: string) => Promise<void>
}

export type MigrateV05Status =
  | 'fresh_install' // schema_meta 미존재 — 빈 DB, 백업 skip, applySchema + sentinel
  | 'migrated' // v04 DB → 백업 + applySchema + sentinel
  | 'already_migrated' // sentinel 존재 — skip
  | 'dry_run_only' // dryRunOnly=true — 백업까지만

export interface MigrateV05Result {
  status: MigrateV05Status
  /** 백업 디렉토리 (`<userDataDir>/backup/v04/<ISO_ts>/`). fresh_install / already_migrated 시 undefined. */
  backup_path?: string
  /** 백업 파일 절대 경로 (`<backup_path>/flowbrowser.db`). 백업 미수행 시 undefined. */
  backup_file?: string
  /** 마이그레이션 로그 파일 절대 경로. */
  log_path: string
  /** 이전 schema_meta.version (v04 DB 인 경우 '1'). fresh install 시 null. */
  previous_version: string | null
  /** 적용 후 schema_meta.version ('2' 박힘). already_migrated/dry-run 시 변동 X. */
  applied_version: string | null
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function appendLog(logPath: string, lines: string[]): Promise<void> {
  await fs.mkdir(join(logPath, '..'), { recursive: true }).catch(() => {})
  await fs.appendFile(logPath, lines.map((l) => `${l}\n`).join(''), 'utf-8')
}

/**
 * schema_meta 테이블 존재 여부 + (있으면) `version` 행 값. v04 vs fresh install 판정.
 *
 * - fresh install: `schema_meta` 테이블 미존재 → { hasTable: false, version: null }
 * - v04 DB (Sprint 015 M3 박힘): `schema_meta` 존재 + version='1'
 * - 이론적 v05 DB (사용자가 백업에서 v05 복원): version='2' — 다만 `migration_v05_applied` sentinel 도 동반 존재
 */
function probeSchemaMeta(fb: FlowbrowserDatabase): { hasTable: boolean; version: string | null } {
  const db = fb.getDb()
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`)
    .get() as { name?: string } | undefined
  if (!tbl?.name) return { hasTable: false, version: null }
  const versionRow = fb.getSchemaMeta('version')
  return { hasTable: true, version: versionRow?.value ?? null }
}

/**
 * Public entry — v04 → v05 마이그레이션 (G-014 정합).
 *
 * 5 단계 (codex 019e4dd1 BLOCKING — 마이그레이션 함수가 schema 적용 순서 소유):
 *   1. sentinel 체크 → already_migrated skip
 *   2. v04 vs fresh install 판정
 *   3. 자동 백업 (v04 인 경우만)
 *   4. dryRunOnly 분기
 *   5. applySchema + sentinel 박음
 *
 * 멱등성: sentinel `migration_v05_applied` 가 박혀 있으면 즉시 `already_migrated` 반환.
 */
export async function migrateV04ToV05(opts: MigrateV05Options): Promise<MigrateV05Result> {
  const { userDataDir, fb, dryRunOnly = false, backupFn } = opts
  const logPath = join(userDataDir, V05_LOG_FILE)
  await appendLog(logPath, [`[${isoTimestamp()}] v04 → v05 마이그레이션 진입 (dryRunOnly=${dryRunOnly})`])

  // 1. v04 vs fresh install 판정 (먼저) — schema_meta 테이블 자체 미존재 시 fresh install.
  //   getSchemaMeta 호출 전에 테이블 존재 확인 — fresh DB 에서 `no such table` throw 차단.
  const probe = probeSchemaMeta(fb)
  const isFreshInstall = !probe.hasTable

  // 2. sentinel 체크 — schema_meta 테이블 존재 시에만 가능.
  if (probe.hasTable) {
    const sentinel = fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)
    if (sentinel) {
      await appendLog(logPath, [
        `[skip] schema_meta.${MIGRATION_V05_SCHEMA_META_KEY}=${sentinel.value} → already_migrated`
      ])
      return {
        status: 'already_migrated',
        log_path: logPath,
        previous_version: probe.version,
        applied_version: probe.version
      }
    }
  }
  await appendLog(logPath, [
    `[probe] schema_meta.hasTable=${probe.hasTable} version=${probe.version ?? 'null'} → ${
      isFreshInstall ? 'fresh_install' : 'v04 → v05 migration'
    }`
  ])

  // 3. 자동 백업 — schema_meta 테이블 존재 시만 (= 기존 DB 데이터 보호).
  //   codex 019e4dd1 #3: WAL safe snapshot via `fb.getDb().backup(destPath)` (better-sqlite3 12.x API).
  //   fresh install 시 backup skip (백업할 데이터 없음).
  let backupDir: string | undefined
  let backupFile: string | undefined
  if (!isFreshInstall) {
    const ts = isoTimestamp()
    backupDir = join(userDataDir, V05_BACKUP_ROOT, ts)
    backupFile = join(backupDir, V05_BACKUP_FILE)
    await fs.mkdir(backupDir, { recursive: true })
    if (backupFn) {
      await backupFn(fb, backupFile)
    } else {
      // better-sqlite3 12.x `Database.backup(destPath)` 는 Promise 반환 (WAL safe online snapshot).
      // 호출자가 in-memory DB 인 경우에도 dest 가 file path 면 정상 동작.
      const dbAny = fb.getDb() as unknown as {
        backup: (dest: string) => Promise<{ totalPages: number; remainingPages: number }>
      }
      await dbAny.backup(backupFile)
    }
    await appendLog(logPath, [`[backup] flowbrowser.db → ${backupFile} (WAL safe snapshot)`])
  }

  // 4. dryRunOnly 분기
  if (dryRunOnly) {
    await appendLog(logPath, [
      `[dry-run] applySchema + sentinel 박지 않음. backup 만 박힘 (${backupFile ?? 'skip (fresh install)'})`
    ])
    return {
      status: 'dry_run_only',
      backup_path: backupDir,
      backup_file: backupFile,
      log_path: logPath,
      previous_version: probe.version,
      applied_version: probe.version
    }
  }

  // 5. 실 적용 — applySchema (v05.sql idempotent IF NOT EXISTS) + sentinel
  fb.applySchema()
  fb.setSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY, isoTimestamp())
  const after = probeSchemaMeta(fb)
  await appendLog(logPath, [
    `[apply] v05.sql → ${after.version ?? 'null'} (previous=${probe.version ?? 'null'})`,
    `[sentinel] schema_meta.${MIGRATION_V05_SCHEMA_META_KEY} 박힘`
  ])

  return {
    status: isFreshInstall ? 'fresh_install' : 'migrated',
    backup_path: backupDir,
    backup_file: backupFile,
    log_path: logPath,
    previous_version: probe.version,
    applied_version: after.version
  }
}
