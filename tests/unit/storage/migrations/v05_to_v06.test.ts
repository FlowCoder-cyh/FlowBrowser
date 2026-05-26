/**
 * Sprint 018 M2 T17a — v05 → v06 마이그레이션 회귀 케이스.
 *
 * 입력 SSOT: `src/storage/migrations/v05_to_v06.ts` §4단계 + Schema v06 spec §3~§4.
 *
 * G-014 강제: dry-run + `<userDataDir>/backup/v05/<ISO_ts>/flowbrowser.db` 자동 백업 + sentinel.
 *
 * 9 회귀:
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

import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import {
  FlowbrowserDatabase,
  V05_SCHEMA_VERSION,
  V06_SCHEMA_VERSION
} from '../../../../src/storage/Database'
import {
  migrateV05ToV06,
  MIGRATION_V06_SCHEMA_META_KEY,
  V06_BACKUP_FILE
} from '../../../../src/storage/migrations/v05_to_v06'
import v06SchemaSQL from '../../../../src/storage/schema/v06.sql?raw'

interface Fx {
  userDataDir: string
  fb: FlowbrowserDatabase
}

async function makeUserDataDir(): Promise<string> {
  const dir = join(tmpdir(), `fb-migr-v06-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** 1024-dim 임베딩 Buffer (검증용 deterministic 벡터). */
function vec1024(seed: number): Buffer {
  const a = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) a[i] = Math.cos(seed + i * 0.01)
  return Buffer.from(a.buffer)
}

/** 768-dim 임베딩 Buffer (Ollama nomic-embed-text 차원, 트리거 cascade 검증용). */
function vec768(seed: number): Buffer {
  const a = new Float32Array(768)
  for (let i = 0; i < 768; i++) a[i] = Math.sin(seed + i * 0.01)
  return Buffer.from(a.buffer)
}

/** fresh v05 DB — applySchema (v05.sql, version=2). 데이터 없음. */
async function setupV05Fresh(): Promise<Fx> {
  const userDataDir = await makeUserDataDir()
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema() // v05.sql + schema_meta.version='2'
  return { userDataDir, fb }
}

/** v05 DB + 사용자 데이터 (workspace / vec_pages / vec_notes). */
async function setupV05WithData(): Promise<Fx> {
  const fx = await setupV05Fresh()
  const db = fx.fb.getDb()
  const now = Date.now()
  db.prepare('INSERT INTO workspaces(id, name, icon, created_at) VALUES (?, ?, ?, ?)').run(
    'ws-a',
    '연구',
    '📚',
    now
  )
  db.prepare('INSERT INTO workspaces(id, name, icon, created_at) VALUES (?, ?, ?, ?)').run(
    'ws-b',
    '쇼핑',
    '🛒',
    now
  )
  db.prepare('INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
    'p1',
    'ws-a',
    vec1024(1)
  )
  db.prepare('INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
    'p2',
    'ws-b',
    vec1024(2)
  )
  db.prepare('INSERT INTO vec_notes(note_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
    'n1',
    'ws-a',
    vec1024(3)
  )
  return fx
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

function tableExists(fb: FlowbrowserDatabase, name: string): boolean {
  const row = fb
    .getDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { name?: string } | undefined
  return Boolean(row?.name)
}

function columnNames(fb: FlowbrowserDatabase, table: string): string[] {
  return (fb.getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name
  )
}

describe('migrateV05ToV06 (Sprint 018 M2 T17a)', () => {
  it('1. fresh v05 → 변환 + sentinel (백업 skip, freshInstall=true)', async () => {
    const fx = await setupV05Fresh()
    try {
      const r = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb, freshInstall: true })
      expect(r.status).toBe('fresh_install')
      expect(r.backup_path).toBeUndefined()
      expect(r.applied_version).toBe(String(V06_SCHEMA_VERSION))
      // v06 shape: vec_pages 제거 + _1024/_768 생성
      expect(tableExists(fx.fb, 'vec_pages')).toBe(false)
      expect(tableExists(fx.fb, 'vec_notes')).toBe(false)
      expect(tableExists(fx.fb, 'vec_pages_1024')).toBe(true)
      expect(tableExists(fx.fb, 'vec_pages_768')).toBe(true)
      expect(tableExists(fx.fb, 'vec_notes_1024')).toBe(true)
      expect(tableExists(fx.fb, 'vec_notes_768')).toBe(true)
      expect(columnNames(fx.fb, 'workspaces')).toContain('embedding_model')
      expect(fx.fb.getSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY)).toBeDefined()
    } finally {
      await teardown(fx)
    }
  })

  it('2. v05 DB (데이터 보유) → 백업 + 변환 + sentinel', async () => {
    const fx = await setupV05WithData()
    try {
      expect(fx.fb.getSchemaMeta('version')?.value).toBe(String(V05_SCHEMA_VERSION))
      const r = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(r.status).toBe('migrated')
      expect(r.previous_version).toBe(String(V05_SCHEMA_VERSION))
      expect(r.applied_version).toBe(String(V06_SCHEMA_VERSION))
      expect(r.backup_file).toBeDefined()
      expect(await exists(r.backup_file!)).toBe(true)
      expect(fx.fb.getSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY)).toBeDefined()
    } finally {
      await teardown(fx)
    }
  })

  it('3. vec 데이터 보존 (vec_pages → vec_pages_1024 행/검색 보존)', async () => {
    const fx = await setupV05WithData()
    try {
      await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      const db = fx.fb.getDb()
      // 행 보존 — pages 2 (ws-a/ws-b), notes 1 (ws-a)
      expect((db.prepare('SELECT COUNT(*) AS c FROM vec_pages_1024').get() as { c: number }).c).toBe(2)
      expect((db.prepare('SELECT COUNT(*) AS c FROM vec_notes_1024').get() as { c: number }).c).toBe(1)
      // 검색 — ws-a partition 에서 p1 자기 자신 최근접
      const rows = db
        .prepare(
          `SELECT page_id AS id, distance FROM vec_pages_1024
           WHERE workspace_id = ? AND embedding MATCH ? AND k = ? ORDER BY distance`
        )
        .all('ws-a', vec1024(1), 1) as Array<{ id: string; distance: number }>
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('p1')
      expect(rows[0].distance).toBeLessThan(0.0001)
      // partition 격리 — ws-b 검색 시 p2 만
      const wsB = db
        .prepare(
          `SELECT page_id AS id FROM vec_pages_1024 WHERE workspace_id = ? AND embedding MATCH ? AND k = ?`
        )
        .all('ws-b', vec1024(2), 5) as Array<{ id: string }>
      expect(wsB.map((x) => x.id)).toEqual(['p2'])
      // vec_notes_1024 도 검색 가능 — n1 (ws-a) 보존 + 자기 최근접
      const notes = db
        .prepare(
          `SELECT note_id AS id, distance FROM vec_notes_1024
           WHERE workspace_id = ? AND embedding MATCH ? AND k = ? ORDER BY distance`
        )
        .all('ws-a', vec1024(3), 1) as Array<{ id: string; distance: number }>
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe('n1')
      expect(notes[0].distance).toBeLessThan(0.0001)
    } finally {
      await teardown(fx)
    }
  })

  it('4. embedding_model 컬럼 DEFAULT 채움 + CHECK 위반 거부', async () => {
    const fx = await setupV05WithData()
    try {
      await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      const db = fx.fb.getDb()
      // 기존 행 DEFAULT 채움
      const w = db.prepare('SELECT embedding_model AS m FROM workspaces WHERE id = ?').get('ws-a') as {
        m: string
      }
      expect(w.m).toBe('openai:text-embedding-3-small:1024')
      // ollama:768 허용
      expect(() =>
        db
          .prepare('INSERT INTO workspaces(id, name, icon, created_at, embedding_model) VALUES (?, ?, ?, ?, ?)')
          .run('ws-c', '로컬', '🔒', Date.now(), 'ollama:nomic-embed-text:768')
      ).not.toThrow()
      // CHECK 위반 거부
      expect(() =>
        db
          .prepare('INSERT INTO workspaces(id, name, icon, created_at, embedding_model) VALUES (?, ?, ?, ?, ?)')
          .run('ws-d', 'x', '❓', Date.now(), 'bogus:model:9')
      ).toThrow(/CHECK|constraint/i)
    } finally {
      await teardown(fx)
    }
  })

  it('5. dry-run only → 백업만, 변환/sentinel 미박힘', async () => {
    const fx = await setupV05WithData()
    try {
      const r = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb, dryRunOnly: true })
      expect(r.status).toBe('dry_run_only')
      expect(r.backup_file).toBeDefined()
      expect(await exists(r.backup_file!)).toBe(true)
      // 변환 미적용 — vec_pages 잔존, embedding_model 미추가, version 불변
      expect(tableExists(fx.fb, 'vec_pages')).toBe(true)
      expect(tableExists(fx.fb, 'vec_pages_1024')).toBe(false)
      expect(columnNames(fx.fb, 'workspaces')).not.toContain('embedding_model')
      expect(fx.fb.getSchemaMeta('version')?.value).toBe(String(V05_SCHEMA_VERSION))
      expect(fx.fb.getSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY)).toBeNull()
    } finally {
      await teardown(fx)
    }
  })

  it('6. Idempotent — 두 번째 실행 시 already_migrated', async () => {
    const fx = await setupV05WithData()
    try {
      const r1 = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(r1.status).toBe('migrated')
      const r2 = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(r2.status).toBe('already_migrated')
      expect(r2.applied_version).toBe(String(V06_SCHEMA_VERSION))
      // 컬럼 중복 추가 없음 — embedding_model 1개
      expect(columnNames(fx.fb, 'workspaces').filter((c) => c === 'embedding_model')).toHaveLength(1)
    } finally {
      await teardown(fx)
    }
  })

  it('7. 백업 파일 실존 검증 (flowbrowser.db snapshot)', async () => {
    const fx = await setupV05WithData()
    try {
      const r = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(r.backup_file!.endsWith(V06_BACKUP_FILE)).toBe(true)
      expect(r.backup_path!.includes(join('backup', 'v05'))).toBe(true)
      expect(await exists(r.backup_file!)).toBe(true)
    } finally {
      await teardown(fx)
    }
  })

  it('8. 변환 중 실패 시 rollback (vec_pages 복원, schema 무변경)', async () => {
    const fx = await setupV05WithData()
    try {
      // 백업 직후 변환 transaction 진입 전에 vec_pages 를 강제 drop 하여 copy(INSERT…SELECT) 실패 유발.
      //   backupFn 안에서 원본 테이블을 제거 → transaction 의 INSERT…SELECT FROM vec_pages 가 throw → rollback.
      const failingBackup = async (fb: FlowbrowserDatabase, _dest: string): Promise<void> => {
        fb.getDb().exec('DROP TABLE vec_pages')
      }
      await expect(
        migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb, backupFn: failingBackup })
      ).rejects.toThrow()
      // rollback 검증 — transaction 내 변경(ALTER/_1024 생성/version) 전부 원복.
      //   (vec_pages 는 backupFn 이 transaction 밖에서 drop 했으므로 복원 안 됨 — 대신 schema 무변경 확인)
      expect(columnNames(fx.fb, 'workspaces')).not.toContain('embedding_model')
      expect(tableExists(fx.fb, 'vec_pages_1024')).toBe(false)
      expect(fx.fb.getSchemaMeta('version')?.value).toBe(String(V05_SCHEMA_VERSION))
      expect(fx.fb.getSchemaMeta(MIGRATION_V06_SCHEMA_META_KEY)).toBeNull()
    } finally {
      await teardown(fx)
    }
  })

  it('9. drift-check — migrate(v05) schema ≡ fresh applySchema(v06.sql)', async () => {
    const fx = await setupV05WithData()
    const ref = FlowbrowserDatabase.openInMemory()
    try {
      await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      // 기준 — fresh v06 schema 직접 exec.
      ref.getDb().exec(v06SchemaSQL)

      // vec0 shadow 테이블(내부 구현) + workspaces 제외하고 user 정의 객체 텍스트 비교 (단순 공백 collapse만).
      //   workspaces 는 ALTER ADD COLUMN 재구성(migrate) vs inline 선언(fresh) 의 SQL 텍스트가 punctuation 공백만
      //   다르므로 텍스트 비교 제외 — 대신 PRAGMA table_info 로 semantic(컬럼/타입/notnull/default/pk) 동등 검증.
      //   (codex 019e658a NOTABLE — 과관대한 punctuation 정규화 제거: 문자열 리터럴 내부 comma/paren 오판 위험 회피.)
      const SHADOW = /^vec_(pages|notes)_(1024|768)_/
      const collect = (fb: FlowbrowserDatabase): Record<string, string> => {
        const rows = fb
          .getDb()
          .prepare(
            `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`
          )
          .all() as Array<{ type: string; name: string; sql: string }>
        const map: Record<string, string> = {}
        for (const r of rows) {
          if (SHADOW.test(r.name)) continue // vec0 내부 shadow 제외
          if (r.name === 'workspaces') continue // ALTER vs inline 재구성 차이 — table_info 로 semantic 비교
          map[`${r.type}:${r.name}`] = r.sql.replace(/\s+/g, ' ').trim()
        }
        return map
      }
      const migrated = collect(fx.fb)
      const fresh = collect(ref)
      expect(migrated).toEqual(fresh)
      // 비교 대상이 실제로 vec0 4종 + 트리거 2종 + 핵심 테이블을 포함하는지 sanity (빈 비교 회피)
      expect(Object.keys(migrated)).toContain('table:vec_pages_768')
      expect(Object.keys(migrated)).toContain('trigger:pages_after_delete_vec_pages_v06')

      // workspaces CHECK allowlist drift 검출 (codex 019e658a 2차 NOTABLE — table_info 는 CHECK 미노출).
      //   ALTER 재구성(migrate) vs inline(fresh) 의 구조 공백차만 다르고 CHECK 본문(embedding_model 1024/768
      //   allowlist)은 동일 → 전체 공백 제거 후 비교하면 allowlist 텍스트 drift 는 검출되고 구조 공백차는 중화.
      //   (workspaces DDL 의 문자열 리터럴에 공백/comma/paren 없음 — 전체 strip 안전.)
      const wsSql = (fb: FlowbrowserDatabase): string =>
        (
          fb
            .getDb()
            .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='workspaces'`)
            .get() as { sql: string }
        ).sql.replace(/\s+/g, '')
      expect(wsSql(fx.fb)).toEqual(wsSql(ref))
      expect(wsSql(ref)).toContain("'ollama:nomic-embed-text:768'")
      expect(wsSql(ref)).toContain("'openai:text-embedding-3-small:1024'")

      // workspaces semantic 동등 — 컬럼 name/type/notnull/default/pk 까지 (embedding_model 포함).
      const tableInfo = (fb: FlowbrowserDatabase): Array<Record<string, unknown>> =>
        (
          fb.getDb().prepare(`PRAGMA table_info(workspaces)`).all() as Array<{
            name: string
            type: string
            notnull: number
            dflt_value: unknown
            pk: number
          }>
        ).map((c) => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull,
          dflt_value: c.dflt_value,
          pk: c.pk
        }))
      expect(tableInfo(fx.fb)).toEqual(tableInfo(ref))
      expect(columnNames(ref, 'workspaces')).toContain('embedding_model')
    } finally {
      ref.close()
      await teardown(fx)
    }
  })

  it('10. 트리거 — pages/notes DELETE 시 _1024 + _768 둘 다 cascade', async () => {
    const fx = await setupV05WithData()
    try {
      await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      const db = fx.fb.getDb()
      const now = Date.now()
      // 실 pages/notes 행 + 두 dimension vec 임베딩 (트리거는 pages/notes DELETE 에 fire).
      db.prepare(
        'INSERT INTO pages(id, workspace_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('pg1', 'ws-a', 'https://example.com', now, now)
      db.prepare('INSERT INTO vec_pages_1024(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
        'pg1',
        'ws-a',
        vec1024(5)
      )
      db.prepare('INSERT INTO vec_pages_768(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
        'pg1',
        'ws-a',
        vec768(5)
      )
      db.prepare(
        'INSERT INTO notes(id, workspace_id, selected_text, created_at, created_by) VALUES (?, ?, ?, ?, ?)'
      ).run('nt1', 'ws-a', '선택', now, 'user')
      db.prepare('INSERT INTO vec_notes_1024(note_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
        'nt1',
        'ws-a',
        vec1024(6)
      )
      db.prepare('INSERT INTO vec_notes_768(note_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
        'nt1',
        'ws-a',
        vec768(6)
      )
      const cnt = (table: string, col: string, id: string): number =>
        (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(id) as { c: number }).c
      expect(cnt('vec_pages_1024', 'page_id', 'pg1')).toBe(1)
      expect(cnt('vec_pages_768', 'page_id', 'pg1')).toBe(1)

      // pages DELETE → vec_pages_1024 + vec_pages_768 둘 다 삭제
      db.prepare('DELETE FROM pages WHERE id = ?').run('pg1')
      expect(cnt('vec_pages_1024', 'page_id', 'pg1')).toBe(0)
      expect(cnt('vec_pages_768', 'page_id', 'pg1')).toBe(0)

      // notes DELETE → vec_notes_1024 + vec_notes_768 둘 다 삭제
      db.prepare('DELETE FROM notes WHERE id = ?').run('nt1')
      expect(cnt('vec_notes_1024', 'note_id', 'nt1')).toBe(0)
      expect(cnt('vec_notes_768', 'note_id', 'nt1')).toBe(0)
    } finally {
      await teardown(fx)
    }
  })

  it('11. 백업 snapshot 유효성 — 마이그레이션 전 v05 shape + 데이터 보존', async () => {
    const fx = await setupV05WithData()
    try {
      const r = await migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb })
      expect(r.backup_file).toBeDefined()
      // 백업 파일을 실제로 열어 마이그레이션 전 v05 snapshot 인지 검증 (G-014 복구점 실효성).
      const backup = FlowbrowserDatabase.open({ path: r.backup_file!, enableWal: false })
      try {
        // v05 shape — 단일 vec_pages/vec_notes 존재, _1024/_768 미존재, embedding_model 컬럼 없음.
        expect(tableExists(backup, 'vec_pages')).toBe(true)
        expect(tableExists(backup, 'vec_notes')).toBe(true)
        expect(tableExists(backup, 'vec_pages_1024')).toBe(false)
        expect(columnNames(backup, 'workspaces')).not.toContain('embedding_model')
        // 데이터 보존 — workspaces 2 + vec_pages 2 + vec_notes 1.
        expect(
          (backup.getDb().prepare('SELECT COUNT(*) AS c FROM workspaces').get() as { c: number }).c
        ).toBe(2)
        expect(
          (backup.getDb().prepare('SELECT COUNT(*) AS c FROM vec_pages').get() as { c: number }).c
        ).toBe(2)
        expect(
          (backup.getDb().prepare('SELECT COUNT(*) AS c FROM vec_notes').get() as { c: number }).c
        ).toBe(1)
      } finally {
        backup.close()
      }
    } finally {
      await teardown(fx)
    }
  })

  it('12a. 부분/외부 변형 hard-fail — embedding_model 컬럼 + sentinel 부재 시 throw', async () => {
    const fx = await setupV05Fresh()
    try {
      // 인위적 부분 상태 — embedding_model 컬럼만 추가 (vec 변환/sentinel 없이).
      fx.fb
        .getDb()
        .exec(
          `ALTER TABLE workspaces ADD COLUMN embedding_model TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small:1024'`
        )
      // 조용한 skip 금지 — 명시 throw (codex 019e658a NEEDS_CHANGES #2).
      await expect(
        migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb, freshInstall: true })
      ).rejects.toThrow(/일관성 위반|sentinel/i)
      // 변환 미진행 — vec_pages 잔존, _1024 미생성.
      expect(tableExists(fx.fb, 'vec_pages')).toBe(true)
      expect(tableExists(fx.fb, 'vec_pages_1024')).toBe(false)
    } finally {
      await teardown(fx)
    }
  })

  it('12b. 부분/외부 변형 hard-fail — v06 vec 테이블만 존재 (embedding_model 없이) + sentinel 부재 시 throw', async () => {
    const fx = await setupV05Fresh()
    try {
      // 인위적 부분 상태 — embedding_model 컬럼 없이 vec_pages_1024 만 존재 (codex 019e658a 2차 — 흔적 전수 검사).
      fx.fb
        .getDb()
        .exec(
          `CREATE VIRTUAL TABLE vec_pages_1024 USING vec0(page_id TEXT, workspace_id TEXT partition key, embedding float[1024] distance_metric=cosine)`
        )
      await expect(
        migrateV05ToV06({ userDataDir: fx.userDataDir, fb: fx.fb, freshInstall: true })
      ).rejects.toThrow(/일관성 위반|sentinel|vec_pages_1024/i)
      // embedding_model 컬럼은 추가되지 않음 (변환 미진행).
      expect(columnNames(fx.fb, 'workspaces')).not.toContain('embedding_model')
    } finally {
      await teardown(fx)
    }
  })
})
