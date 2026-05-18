/**
 * Sprint 015 M3-1 — FlowbrowserDatabase 단위 테스트.
 *
 * cover:
 *   - schema 적용 idempotent
 *   - 11 entity + 11 index + 2 vec0 virtual table 존재 검증
 *   - PRAGMA foreign_keys / journal_mode
 *   - workspaces CRUD + ensureDefaultWorkspace ("📥 기본")
 *   - schema_meta 키-값 영속 + UPSERT
 *   - sqlite-vec vec0 partition isolation (workspace 격리 검증)
 *   - CASCADE DELETE: workspace 제거 → pages / visits / notes / ai_chat_history / tags 동반 제거
 *   - CHECK 제약 (ai_chat_history.role / .status / notes.created_by / tags.kind)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import {
  FlowbrowserDatabase,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_ICON,
  V04_SCHEMA_VERSION
} from '../../../src/storage/Database'

const EXPECTED_TABLES = [
  'workspaces',
  'pages',
  'visits',
  'notes',
  'ai_chat_history',
  'tags',
  'page_tags',
  'note_tags',
  'embedding_queue',
  'schema_meta'
]

const EXPECTED_INDEXES = [
  'idx_page_workspace_url',
  'idx_page_workspace_content_hash',
  'idx_visit_workspace_time',
  'idx_visit_page',
  'idx_note_workspace_time',
  'idx_note_page_visit',
  'idx_chat_workspace_time',
  'idx_chat_status',
  'idx_tag_workspace_kind',
  'idx_embedding_queue_status_priority',
  'idx_embedding_queue_target'
]

const EXPECTED_VEC_TABLES = ['vec_pages', 'vec_notes']

function fresh(): FlowbrowserDatabase {
  const db = FlowbrowserDatabase.openInMemory()
  db.applySchema()
  return db
}

function makeEmbedding(seed: number): Buffer {
  const arr = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) arr[i] = Math.sin(seed + i * 0.01)
  return Buffer.from(arr.buffer)
}

describe('FlowbrowserDatabase', () => {
  describe('open / version probes', () => {
    it('opens in-memory DB + loads sqlite-vec', () => {
      const db = FlowbrowserDatabase.openInMemory()
      expect(db.sqliteVersion()).toMatch(/^\d+\.\d+\.\d+/)
      expect(db.sqliteVecVersion()).toMatch(/^v?\d+\.\d+\.\d+/)
      db.close()
    })

    it('opens file path + ensures WAL by default', async () => {
      const tmp = join(tmpdir(), `fb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
      try {
        const db = FlowbrowserDatabase.open({ path: tmp })
        db.applySchema()
        const journal = db
          .getDb()
          .prepare('PRAGMA journal_mode')
          .get() as { journal_mode: string }
        expect(journal.journal_mode.toLowerCase()).toBe('wal')
        db.close()
      } finally {
        await fs.unlink(tmp).catch(() => {})
        await fs.unlink(`${tmp}-wal`).catch(() => {})
        await fs.unlink(`${tmp}-shm`).catch(() => {})
      }
    })

    it('PRAGMA foreign_keys ON by default', () => {
      const db = FlowbrowserDatabase.openInMemory()
      const fk = db.getDb().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
      expect(fk.foreign_keys).toBe(1)
      db.close()
    })
  })

  describe('applySchema', () => {
    let db: FlowbrowserDatabase

    beforeEach(() => {
      db = fresh()
    })

    afterEach(() => {
      db.close()
    })

    it('creates all expected real tables', () => {
      const rows = db
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
      const names = rows.map((r) => r.name)
      for (const t of EXPECTED_TABLES) expect(names).toContain(t)
    })

    it('creates vec_pages + vec_notes virtual tables', () => {
      const rows = db
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
      const names = rows.map((r) => r.name)
      for (const t of EXPECTED_VEC_TABLES) expect(names).toContain(t)
    })

    it('creates all expected indexes (excluding sqlite-vec internals)', () => {
      const rows = db
        .getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[]
      const names = rows.map((r) => r.name)
      for (const idx of EXPECTED_INDEXES) expect(names).toContain(idx)
    })

    it('is idempotent (re-apply twice produces no error)', () => {
      expect(() => db.applySchema()).not.toThrow()
      expect(() => db.applySchema()).not.toThrow()
    })

    it('writes schema_meta.version = V04_SCHEMA_VERSION', () => {
      const meta = db.getSchemaMeta('version')
      expect(meta).not.toBeNull()
      expect(meta?.value).toBe(String(V04_SCHEMA_VERSION))
      expect(meta?.updated_at).toBeGreaterThan(0)
    })
  })

  describe('workspaces CRUD', () => {
    let db: FlowbrowserDatabase

    beforeEach(() => {
      db = fresh()
    })

    afterEach(() => {
      db.close()
    })

    it('createWorkspace + findWorkspaceById round-trip', () => {
      const created = db.createWorkspace({ name: '📚 신약 리서치', icon: '📚' })
      expect(created.id).toMatch(/[0-9a-f-]{36}/)
      expect(created.name).toBe('📚 신약 리서치')
      expect(created.level_preference).toBeNull()
      const found = db.findWorkspaceById(created.id)
      expect(found).toEqual(created)
    })

    it('createWorkspace honors provided id (migration path)', () => {
      const id = randomUUID()
      const ws = db.createWorkspace({ id, name: 'X', icon: '🧪' })
      expect(ws.id).toBe(id)
    })

    it('createWorkspace persists level_preference', () => {
      const ws = db.createWorkspace({ name: 'L', icon: '🎓', level_preference: 'advanced' })
      const reread = db.findWorkspaceById(ws.id)
      expect(reread?.level_preference).toBe('advanced')
    })

    it('listWorkspaces returns created order (ASC)', () => {
      const a = db.createWorkspace({ name: 'A', icon: '🅰' })
      const b = db.createWorkspace({ name: 'B', icon: '🅱' })
      const rows = db.listWorkspaces()
      expect(rows.map((r) => r.id)).toEqual([a.id, b.id])
    })

    it('ensureDefaultWorkspace creates "📥 기본" on first call, reuses on second', () => {
      const first = db.ensureDefaultWorkspace()
      expect(first.name).toBe(DEFAULT_WORKSPACE_NAME)
      expect(first.icon).toBe(DEFAULT_WORKSPACE_ICON)
      const second = db.ensureDefaultWorkspace()
      expect(second.id).toBe(first.id)
      expect(db.listWorkspaces()).toHaveLength(1)
    })

    it('rejects level_preference outside CHECK enum', () => {
      expect(() =>
        db
          .getDb()
          .prepare(
            `INSERT INTO workspaces(id, name, icon, created_at, level_preference)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), 'X', '🌶', Date.now(), 'invalid-level')
      ).toThrow()
    })
  })

  describe('schema_meta UPSERT', () => {
    let db: FlowbrowserDatabase

    beforeEach(() => {
      db = fresh()
    })

    afterEach(() => {
      db.close()
    })

    it('setSchemaMeta + getSchemaMeta round-trip + UPSERT updates value', () => {
      db.setSchemaMeta('migration_phase', 'idle')
      expect(db.getSchemaMeta('migration_phase')?.value).toBe('idle')
      db.setSchemaMeta('migration_phase', 'in_progress')
      expect(db.getSchemaMeta('migration_phase')?.value).toBe('in_progress')
    })

    it('returns null for missing key', () => {
      expect(db.getSchemaMeta('does-not-exist')).toBeNull()
    })
  })

  describe('CHECK constraints', () => {
    let db: FlowbrowserDatabase
    let wsId: string

    beforeEach(() => {
      db = fresh()
      wsId = db.ensureDefaultWorkspace().id
    })

    afterEach(() => {
      db.close()
    })

    it('rejects ai_chat_history.role outside enum', () => {
      expect(() =>
        db
          .getDb()
          .prepare(
            `INSERT INTO ai_chat_history(id, workspace_id, role, content, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), wsId, 'invalid-role', 'hi', 'ok', Date.now())
      ).toThrow()
    })

    it('rejects ai_chat_history.status outside enum', () => {
      expect(() =>
        db
          .getDb()
          .prepare(
            `INSERT INTO ai_chat_history(id, workspace_id, role, content, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), wsId, 'user', 'hi', 'invalid-status', Date.now())
      ).toThrow()
    })

    it('rejects notes.created_by outside enum', () => {
      expect(() =>
        db
          .getDb()
          .prepare(
            `INSERT INTO notes(id, workspace_id, selected_text, body, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), wsId, 'sel', null, Date.now(), 'invalid-source')
      ).toThrow()
    })

    it('rejects tags.kind outside 6-enum', () => {
      expect(() =>
        db
          .getDb()
          .prepare(
            `INSERT INTO tags(id, workspace_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), wsId, 'tagname', 'invalid-kind', Date.now())
      ).toThrow()
    })

    it('tags UNIQUE (workspace_id, kind, name) duplicate rejected', () => {
      const stmt = db
        .getDb()
        .prepare(
          `INSERT INTO tags(id, workspace_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`
        )
      stmt.run(randomUUID(), wsId, 'dup', 'topic', Date.now())
      expect(() => stmt.run(randomUUID(), wsId, 'dup', 'topic', Date.now())).toThrow()
    })
  })

  describe('CASCADE DELETE (PRD §04.6)', () => {
    let db: FlowbrowserDatabase
    let wsId: string

    beforeEach(() => {
      db = fresh()
      wsId = db.ensureDefaultWorkspace().id
    })

    afterEach(() => {
      db.close()
    })

    it('deleting workspace cascades pages / visits / notes / ai_chat_history / tags', () => {
      const native = db.getDb()
      const pageId = randomUUID()
      const visitId = randomUUID()
      const noteId = randomUUID()
      const chatId = randomUUID()
      const tagId = randomUUID()
      native
        .prepare(
          `INSERT INTO pages(id, workspace_id, url, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(pageId, wsId, 'https://x.test/a', 'h1', Date.now(), Date.now())
      native
        .prepare(
          `INSERT INTO visits(id, page_id, workspace_id, visited_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(visitId, pageId, wsId, Date.now())
      native
        .prepare(
          `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(noteId, pageId, visitId, wsId, 'sel', Date.now(), 'user')
      native
        .prepare(
          `INSERT INTO ai_chat_history(id, workspace_id, role, content, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(chatId, wsId, 'user', 'hi', 'ok', Date.now())
      native
        .prepare(
          `INSERT INTO tags(id, workspace_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(tagId, wsId, 'topicA', 'topic', Date.now())
      // pre-delete sanity
      const counts = (): Record<string, number> => ({
        pages: (native.prepare('SELECT COUNT(*) c FROM pages').get() as { c: number }).c,
        visits: (native.prepare('SELECT COUNT(*) c FROM visits').get() as { c: number }).c,
        notes: (native.prepare('SELECT COUNT(*) c FROM notes').get() as { c: number }).c,
        chats: (native.prepare('SELECT COUNT(*) c FROM ai_chat_history').get() as { c: number }).c,
        tags: (native.prepare('SELECT COUNT(*) c FROM tags').get() as { c: number }).c
      })
      expect(counts()).toEqual({ pages: 1, visits: 1, notes: 1, chats: 1, tags: 1 })
      native.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId)
      expect(counts()).toEqual({ pages: 0, visits: 0, notes: 0, chats: 0, tags: 0 })
    })

    it('deleting page cascades visits + SET NULL notes.page_id/visit_id', () => {
      const native = db.getDb()
      const pageId = randomUUID()
      const visitId = randomUUID()
      const noteId = randomUUID()
      native
        .prepare(
          `INSERT INTO pages(id, workspace_id, url, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(pageId, wsId, 'https://x.test/a', 'h1', Date.now(), Date.now())
      native
        .prepare(
          `INSERT INTO visits(id, page_id, workspace_id, visited_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(visitId, pageId, wsId, Date.now())
      native
        .prepare(
          `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(noteId, pageId, visitId, wsId, 'sel', Date.now(), 'user')
      native.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
      const note = native
        .prepare('SELECT page_id, visit_id FROM notes WHERE id = ?')
        .get(noteId) as { page_id: string | null; visit_id: string | null }
      expect(note.page_id).toBeNull()
      expect(note.visit_id).toBeNull()
      const visitCount = (
        native.prepare('SELECT COUNT(*) c FROM visits').get() as { c: number }
      ).c
      expect(visitCount).toBe(0)
    })
  })

  describe('sqlite-vec partition isolation (vec_pages)', () => {
    let db: FlowbrowserDatabase

    beforeEach(() => {
      db = fresh()
    })

    afterEach(() => {
      db.close()
    })

    it('top-k retrieval limited to query workspace_id', () => {
      const native = db.getDb()
      const insert = native.prepare(
        'INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)'
      )
      insert.run('p1', 'ws-A', makeEmbedding(1))
      insert.run('p2', 'ws-A', makeEmbedding(2))
      insert.run('p3', 'ws-A', makeEmbedding(2.05))
      insert.run('p4', 'ws-B', makeEmbedding(10))
      insert.run('p5', 'ws-B', makeEmbedding(20))
      const queryVec = makeEmbedding(2.01)
      const rows = native
        .prepare(
          `SELECT page_id, workspace_id, distance
           FROM vec_pages
           WHERE workspace_id = 'ws-A'
             AND embedding MATCH ?
             AND k = 3
           ORDER BY distance`
        )
        .all(queryVec) as { page_id: string; workspace_id: string; distance: number }[]
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.workspace_id === 'ws-A')).toBe(true)
      // 시작 seed 와 가장 가까운 p2 (seed=2) 가 top-1
      expect(rows[0].page_id).toBe('p2')
    })
  })

  describe('sqliteVecLoader injection (테스트 격리)', () => {
    it('honors custom loader (no real sqlite-vec call)', () => {
      let called = false
      const fake = () => {
        called = true
      }
      const db = FlowbrowserDatabase.openInMemory(fake)
      expect(called).toBe(true)
      // 가짜 로더 사용 → vec_version 함수 없음 → applySchema 도 vec0 모듈 부재로 throw
      // 본 케이스는 의존 주입 인터페이스 검증에 한정 (실제 vec0 사용은 별도 케이스)
      db.close()
    })
  })
})
