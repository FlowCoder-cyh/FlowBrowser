/**
 * Sprint 017 M1 T07 — v04 → v05 마이그레이션 회귀 케이스.
 *
 * 입력 SSOT: `src/storage/migrations/v04_to_v05.ts` §5 단계 (codex 019e4dd1 BLOCKING 정합).
 *
 * G-014 강제: dry-run + `<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db` 자동 백업 + sentinel.
 *
 * 8 회귀:
 *   1. fresh install → applySchema + sentinel (백업 skip)
 *   2. v04 DB → 백업 + applySchema + sentinel
 *   3. v04 DB 기존 데이터 보존 (workspaces / pages / notes / etc.)
 *   4. dry-run only → 백업만, schema 미적용, sentinel 미박힘
 *   5. Idempotent — 두 번째 실행 시 already_migrated
 *   6. 백업 파일 실존 검증 (flowbrowser.db snapshot)
 *   7. v04 → v05 직후 highlights 테이블 INSERT 가능
 *   8. 백업 실패 시 schema/sentinel 미박힘 (revert 안전)
 */

import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase, V04_SCHEMA_VERSION, V05_SCHEMA_VERSION } from '../../../../src/storage/Database'
import {
  migrateV04ToV05,
  MIGRATION_V05_SCHEMA_META_KEY,
  V05_LOG_FILE,
  V05_BACKUP_FILE
} from '../../../../src/storage/migrations/v04_to_v05'
// codex 019e4e82 NEEDS_CHANGES #2 hotfix — 실 v04 schema 적용하여 v04 → v05 transition 검증.
//   본 PR 의 Database.ts 는 v05.sql import 라 fb.applySchema 가 v05 적용 → highlights 가 이미 박힘.
//   따라서 v04 fixture 는 v04.sql 을 별도 exec 하여 highlights 부재 상태로 박음.
import v04SchemaSQL from '../../../../src/storage/schema/v04.sql?raw'

interface Fx {
  userDataDir: string
  fb: FlowbrowserDatabase
}

async function setupFresh(): Promise<Fx> {
  const userDataDir = join(tmpdir(), `fb-migr-v05-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(userDataDir, { recursive: true })
  // schema 미적용 — fresh install path.
  const fb = FlowbrowserDatabase.openInMemory()
  return { userDataDir, fb }
}

/**
 * 실 v04 DB 시뮬레이션 — v04.sql 직접 exec (highlights 미존재 + schema_meta.version='1').
 *
 * codex 019e4e82 NEEDS_CHANGES #2 — 본 PR 의 fb.applySchema() 는 v05 적용 → highlights 즉시 박힘.
 *   따라서 진짜 v04 transition 검증 위해 v04.sql 직접 exec.
 *
 * 후속: v04 DB 의 highlights 테이블은 마이그레이션 후에만 생성되어야 함.
 */
async function setupV04(): Promise<Fx> {
  const userDataDir = join(tmpdir(), `fb-migr-v05-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(userDataDir, { recursive: true })
  const fb = FlowbrowserDatabase.openInMemory()
  // v04 schema 직접 exec — applySchema (v05) 호출 X. sqlite-vec 는 openInMemory 시점 이미 로드됨.
  fb.getDb().exec(v04SchemaSQL)
  fb.setSchemaMeta('version', String(V04_SCHEMA_VERSION))
  return { userDataDir, fb }
}

/** v04 DB 에 highlights 테이블이 미존재함을 사실로 검증. */
function highlightsTableExists(fb: FlowbrowserDatabase): boolean {
  const row = fb
    .getDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='highlights'`)
    .get() as { name?: string } | undefined
  return Boolean(row?.name)
}

async function teardown(fx: Fx): Promise<void> {
  fx.fb.close()
  await fs.rm(fx.userDataDir, { recursive: true, force: true }).catch(() => {})
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

describe('migrateV04ToV05 — 8 회귀 케이스', () => {
  // 1. Fresh install → applySchema + sentinel (백업 skip)
  it('case 1: fresh install → fresh_install 상태 + sentinel 박힘 (백업 skip)', async () => {
    const fx = await setupFresh()
    try {
      const result = await migrateV04ToV05({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(result.status).toBe('fresh_install')
      expect(result.backup_path).toBeUndefined()
      expect(result.backup_file).toBeUndefined()
      expect(result.previous_version).toBeNull()
      expect(result.applied_version).toBe(String(V05_SCHEMA_VERSION))
      // sentinel 박힘
      expect(fx.fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)).not.toBeNull()
      // highlights 테이블 존재
      const tbl = fx.fb
        .getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='highlights'`)
        .get()
      expect(tbl).toBeTruthy()
      // log 파일 생성
      expect(await exists(join(fx.userDataDir, V05_LOG_FILE))).toBe(true)
    } finally {
      await teardown(fx)
    }
  })

  // 2. v04 DB → 백업 + applySchema + sentinel
  it('case 2: v04 DB → migrated (highlights 마이그레이션 전 미존재 → 후 존재)', async () => {
    const fx = await setupV04()
    try {
      // 마이그레이션 전 — v04 fixture 라 highlights 미존재
      expect(highlightsTableExists(fx.fb)).toBe(false)

      let backupCalled = false
      let receivedDest: string | undefined
      const result = await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          backupCalled = true
          receivedDest = dest
          await fs.writeFile(dest, 'mock-backup', 'utf-8')
        }
      })
      expect(result.status).toBe('migrated')
      expect(backupCalled).toBe(true)
      expect(receivedDest).toBeTruthy()
      expect(receivedDest).toContain(`backup${sep}v04${sep}`)
      expect(receivedDest!.endsWith(V05_BACKUP_FILE)).toBe(true)
      expect(result.previous_version).toBe(String(V04_SCHEMA_VERSION))
      expect(result.applied_version).toBe(String(V05_SCHEMA_VERSION))
      expect(fx.fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)).not.toBeNull()
      expect(await exists(receivedDest!)).toBe(true)

      // 마이그레이션 후 — highlights 테이블 생성됨 (실 v04 → v05 DDL 적용 정합)
      expect(highlightsTableExists(fx.fb)).toBe(true)
    } finally {
      await teardown(fx)
    }
  })

  // 3. v04 DB 기존 데이터 보존
  it('case 3: v04 DB 기존 workspaces / notes 데이터 보존 (마이그레이션 후 조회 가능)', async () => {
    const fx = await setupV04()
    try {
      const ws = fx.fb.createWorkspace({ name: '실험', icon: '🧪' })
      const db = fx.fb.getDb()
      db.prepare(
        `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
         VALUES (?, NULL, NULL, ?, ?, ?, NULL, ?, ?)`
      ).run('note-1', ws.id, 'preserved', 'body', 1000, 'user')

      await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          await fs.writeFile(dest, 'mock-backup', 'utf-8')
        }
      })

      const wsFound = fx.fb.findWorkspaceById(ws.id)
      expect(wsFound?.name).toBe('실험')
      const note = db.prepare('SELECT id, selected_text FROM notes WHERE id = ?').get('note-1') as
        | { id: string; selected_text: string }
        | undefined
      expect(note?.selected_text).toBe('preserved')
    } finally {
      await teardown(fx)
    }
  })

  // 4. dry-run only → 백업만, schema 미적용, sentinel 미박힘
  it('case 4: dryRunOnly=true → dry_run_only 상태 (sentinel 미박힘 + highlights 부재 보존)', async () => {
    const fx = await setupV04()
    try {
      // 진입 전 — highlights 미존재 (v04 fixture)
      expect(highlightsTableExists(fx.fb)).toBe(false)

      let backupCalled = false
      const result = await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        dryRunOnly: true,
        backupFn: async (_fb, dest) => {
          backupCalled = true
          await fs.writeFile(dest, 'mock-backup', 'utf-8')
        }
      })
      expect(result.status).toBe('dry_run_only')
      expect(backupCalled).toBe(true)
      expect(result.backup_file).toBeTruthy()
      // sentinel 미박힘
      expect(fx.fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)).toBeNull()
      // schema_meta.version 변동 없음 — 여전히 v04
      expect(fx.fb.getSchemaMeta('version')?.value).toBe(String(V04_SCHEMA_VERSION))
      // dry-run 후에도 highlights 미존재 — schema 변경 없음 강제 (codex 019e4e82 NEEDS_CHANGES #2 정합)
      expect(highlightsTableExists(fx.fb)).toBe(false)
    } finally {
      await teardown(fx)
    }
  })

  // 5. Idempotent — 두 번째 실행 시 already_migrated
  it('case 5: 두 번째 실행 → already_migrated (backupFn 미호출)', async () => {
    const fx = await setupV04()
    try {
      await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          await fs.writeFile(dest, 'mock-backup', 'utf-8')
        }
      })

      let secondBackup = false
      const second = await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          secondBackup = true
          await fs.writeFile(dest, 'mock-backup-2', 'utf-8')
        }
      })
      expect(second.status).toBe('already_migrated')
      expect(secondBackup).toBe(false)
    } finally {
      await teardown(fx)
    }
  })

  // 6. 백업 파일 실존 검증 (디렉토리 + 파일)
  it('case 6: 백업 디렉토리 + flowbrowser.db 파일 실존 박힘', async () => {
    const fx = await setupV04()
    try {
      const result = await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          await fs.writeFile(dest, 'snapshot-bytes', 'utf-8')
        }
      })
      expect(await exists(result.backup_path!)).toBe(true)
      expect(await exists(result.backup_file!)).toBe(true)
      const content = await fs.readFile(result.backup_file!, 'utf-8')
      expect(content).toBe('snapshot-bytes')
    } finally {
      await teardown(fx)
    }
  })

  // 7. v04 → v05 직후 highlights 테이블 INSERT 가능
  it('case 7: 마이그레이션 직후 highlights 테이블 INSERT 가능 (schema 정상 적용)', async () => {
    const fx = await setupV04()
    try {
      await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          await fs.writeFile(dest, 'mock-backup', 'utf-8')
        }
      })
      const ws = fx.fb.ensureDefaultWorkspace()
      const db = fx.fb.getDb()
      db.prepare(
        `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
         VALUES (?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`
      ).run('note-1', ws.id, 'sel', 1000, 'user')
      db.prepare(
        `INSERT INTO highlights(id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
      ).run('h1', 'note-1', ws.id, 'https://a.com', 'hashA', JSON.stringify({}), 1000)
      const count = db.prepare('SELECT COUNT(*) AS c FROM highlights').get() as { c: number }
      expect(count.c).toBe(1)
    } finally {
      await teardown(fx)
    }
  })

  // 8. 백업 실패 시 schema/sentinel 미박힘 (revert 안전)
  it('case 8: backupFn throw → schema/sentinel 미박힘 (v04 상태 유지)', async () => {
    const fx = await setupV04()
    try {
      await expect(
        migrateV04ToV05({
          userDataDir: fx.userDataDir,
          fb: fx.fb,
          backupFn: async () => {
            throw new Error('disk full')
          }
        })
      ).rejects.toThrow(/disk full/)
      // sentinel 미박힘
      expect(fx.fb.getSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY)).toBeNull()
      // schema_meta.version 변동 없음
      expect(fx.fb.getSchemaMeta('version')?.value).toBe(String(V04_SCHEMA_VERSION))
    } finally {
      await teardown(fx)
    }
  })
})
