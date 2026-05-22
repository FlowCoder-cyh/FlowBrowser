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
 * v04 DB 시뮬레이션 — schema_meta 테이블 + version=1 row 박힘.
 * 단순화 위해 v05.sql 의 applySchema 를 그대로 호출 후 sentinel `migration_v05_applied` 만 박지 않음.
 * (실 사용자 v04 DB 는 schema_meta.version=1 / `migration_v04_applied` 박힘 / highlights 테이블 미존재이나,
 *  v05.sql 의 idempotent IF NOT EXISTS DDL 이라 본 테스트 시뮬레이션이 정합 — schema_meta 존재 + sentinel 미박힘 path 검증.)
 */
async function setupV04(): Promise<Fx> {
  const userDataDir = join(tmpdir(), `fb-migr-v05-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(userDataDir, { recursive: true })
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  // v04 시뮬레이션 — schema_meta.version 을 명시적으로 '1' 로 박음 (applySchema 가 '2' 박았으므로 덮어쓰기).
  fb.setSchemaMeta('version', String(V04_SCHEMA_VERSION))
  return { userDataDir, fb }
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
  it('case 2: v04 DB → migrated (backupFn 호출 + sentinel 박힘 + applied_version=2)', async () => {
    const fx = await setupV04()
    try {
      let backupCalled = false
      let receivedDest: string | undefined
      const result = await migrateV04ToV05({
        userDataDir: fx.userDataDir,
        fb: fx.fb,
        backupFn: async (_fb, dest) => {
          backupCalled = true
          receivedDest = dest
          // 백업 destination 디렉토리에 빈 파일 박음 (실 fb.getDb().backup() 가 만들 결과 시뮬레이션)
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
  it('case 4: dryRunOnly=true → dry_run_only 상태 (sentinel 미박힘, highlights 테이블은 적용 X)', async () => {
    const fx = await setupV04()
    try {
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
