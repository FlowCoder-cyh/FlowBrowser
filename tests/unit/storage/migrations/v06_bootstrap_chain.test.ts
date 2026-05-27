/**
 * Sprint 018 M2 T17b — services 부트 마이그레이션 체인 end-to-end 회귀.
 *
 * services.ts 의 실 부트 순서를 Electron 없이 재현:
 *   open → migrateV04ToV05 → migrateV05ToV06({ freshInstall: v05.status==='fresh_install' }) →
 *   ensureDefaultWorkspace → new VectorIndex → upsert/search.
 *
 * 검증 핵심 (codex 019e6898 — "services bootstrap 회귀를 실 체인으로 별도"):
 *   - 체인 후 schema 가 v06 (VectorIndex 가 dimension 별 테이블 타깃 — 부트 깨짐 회귀 차단, codex 019e658a BLOCKING)
 *   - freshInstall 판정이 migrateV04ToV05 status 에서 파생 (백업 skip 계약)
 *   - fresh → 백업 미수행 / v05 데이터 → 백업 수행 + 데이터 보존 + old vec_pages 부재
 *   - 마이그레이션 후 VectorIndex 검색이 실제 동작 (vec0 public 테이블 4종 + 검색 가능 — shadow 이름 비의존)
 */

import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase, V06_SCHEMA_VERSION } from '../../../../src/storage/Database'
import {
  migrateV04ToV05,
  MIGRATION_V05_SCHEMA_META_KEY
} from '../../../../src/storage/migrations/v04_to_v05'
import { migrateV05ToV06 } from '../../../../src/storage/migrations/v05_to_v06'
import { VectorIndex } from '../../../../src/storage/VectorIndex'
import { DEFAULT_EMBEDDING_MODEL_ID } from '../../../../src/storage/embeddingModel'

async function makeUserDataDir(): Promise<string> {
  const dir = join(tmpdir(), `fb-chain-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function emb(seed: number, dim = 1024): Float32Array {
  const a = new Float32Array(dim)
  for (let i = 0; i < dim; i++) a[i] = Math.cos(seed + i * 0.01)
  return a
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
  return Boolean(
    fb
      .getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  )
}

describe('services 부트 체인 — fresh install (migrateV04ToV05 → migrateV05ToV06)', () => {
  it('fresh DB → v06 도달 + VectorIndex 검색 동작 + 백업 skip', async () => {
    const userDataDir = await makeUserDataDir()
    // 실 부트: open 만 (schema 미적용 — 마이그레이션 체인이 소유).
    const fb = FlowbrowserDatabase.openInMemory()
    try {
      const v05 = await migrateV04ToV05({ userDataDir, fb })
      expect(v05.status).toBe('fresh_install')

      const v06 = await migrateV05ToV06({
        userDataDir,
        fb,
        freshInstall: v05.status === 'fresh_install'
      })
      expect(v06.status).toBe('fresh_install')
      // freshInstall 백업 skip 계약 — 백업 디렉토리/파일 미생성.
      expect(v06.backup_path).toBeUndefined()
      expect(v06.backup_file).toBeUndefined()
      expect(v06.applied_version).toBe(String(V06_SCHEMA_VERSION))

      const defaultWs = fb.ensureDefaultWorkspace()
      // v06 컬럼 — 디폴트 임베딩 모델 채움.
      expect(defaultWs.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)
      expect(fb.findWorkspaceById(defaultWs.id)?.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)

      // 체인 후 schema 가 v06 — VectorIndex 가 dimension 별 테이블에 prepare (부트 깨짐 회귀 차단).
      expect(tableExists(fb, 'vec_pages')).toBe(false)
      expect(tableExists(fb, 'vec_pages_1024')).toBe(true)
      const vec = new VectorIndex(fb)

      // 실제 upsert + search 동작 (1024 = 디폴트 모델 차원).
      const db = fb.getDb()
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('pg1', defaultWs.id, 'https://x.test/1', 'h', Date.now(), Date.now())
      vec.upsertPageEmbedding('pg1', defaultWs.id, emb(1), 1024)
      const hits = vec.searchPages(defaultWs.id, emb(1.001), 5, 1024)
      expect(hits.map((h) => h.id)).toEqual(['pg1'])
    } finally {
      fb.close()
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})

describe('services 부트 체인 — v05 DB + 사용자 데이터 (백업 + 보존)', () => {
  it('v05 데이터 → v06 마이그레이션 + 백업 수행 + 데이터 보존 + VectorIndex 검색', async () => {
    const userDataDir = await makeUserDataDir()
    // v05 DB + 데이터 세팅 (applySchema = v05, sentinel 미박힘 — migrateV04ToV05 already_migrated 아님).
    const fb = FlowbrowserDatabase.openInMemory()
    try {
      fb.applySchema() // v05.sql
      const db = fb.getDb()
      const now = Date.now()
      db.prepare('INSERT INTO workspaces(id, name, icon, created_at) VALUES (?, ?, ?, ?)').run(
        'ws-a',
        '연구',
        '📚',
        now
      )
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('pg1', 'ws-a', 'https://x.test/1', 'h', now, now)
      db.prepare('INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(
        'pg1',
        'ws-a',
        Buffer.from(emb(7).buffer)
      )

      // 실 부트 체인: migrateV04ToV05 (이미 v05 schema → already_migrated 가 아니라 'migrated' — sentinel 미박힘).
      const v05 = await migrateV04ToV05({ userDataDir, fb })
      // schema_meta 존재 + v05 sentinel 미박힘 → 'migrated' (또는 'fresh' 아님). freshInstall=false.
      expect(v05.status).not.toBe('fresh_install')

      const v06 = await migrateV05ToV06({
        userDataDir,
        fb,
        freshInstall: v05.status === 'fresh_install'
      })
      expect(v06.status).toBe('migrated')
      // 백업 수행 계약 — 파일 실존.
      expect(v06.backup_file).toBeDefined()
      expect(await exists(v06.backup_file!)).toBe(true)

      // old vec_pages 부재 + 데이터가 vec_pages_1024 로 보존.
      expect(tableExists(fb, 'vec_pages')).toBe(false)
      const vec = new VectorIndex(fb)
      expect(vec.countPages('ws-a')).toBe(1)
      const hits = vec.searchPages('ws-a', emb(7.001), 5, 1024)
      expect(hits.map((h) => h.id)).toEqual(['pg1'])
      // 기존 워크스페이스 embedding_model = DEFAULT (ALTER DEFAULT 채움).
      expect(fb.findWorkspaceById('ws-a')?.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)
    } finally {
      fb.close()
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('already_migrated(v05 sentinel 보유) → freshInstall=false → v06 백업 수행 (codex 019e6898 NOTABLE)', async () => {
    const userDataDir = await makeUserDataDir()
    const fb = FlowbrowserDatabase.openInMemory()
    try {
      fb.applySchema() // v05
      // v05 마이그레이션 완료 흔적(sentinel) — 정상 운영 중 v05 DB 시뮬레이션.
      fb.setSchemaMeta(MIGRATION_V05_SCHEMA_META_KEY, new Date().toISOString())

      const v05 = await migrateV04ToV05({ userDataDir, fb })
      expect(v05.status).toBe('already_migrated')
      // already_migrated 도 fresh 아님 → freshInstall=false → 백업 수행.
      const v06 = await migrateV05ToV06({
        userDataDir,
        fb,
        freshInstall: v05.status === 'fresh_install'
      })
      expect(v06.status).toBe('migrated')
      expect(v06.backup_file).toBeDefined()
      expect(await exists(v06.backup_file!)).toBe(true)
    } finally {
      fb.close()
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
