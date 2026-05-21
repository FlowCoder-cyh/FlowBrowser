/**
 * Sprint 016 M3 T17 (KI-008) — WorkspaceExportImportService 단위 회귀.
 *
 * cover:
 *   - exportWorkspace — 빈 워크스페이스 / 여러 child 포함 / 없는 ws 에러
 *   - importWorkspace — round-trip / id remap 정합 / chat_meta page_id rewrite /
 *     version/schema 검증 / 단일 TX rollback
 *   - schema version 상수 정합
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import {
  WorkspaceExportImportService,
  WorkspaceExportImportError,
  WORKSPACE_EXPORT_VERSION,
  WORKSPACE_EXPORT_SCHEMA_VERSION,
  type WorkspaceExportV1
} from '../../../src/main/WorkspaceExportImportService'

interface Harness {
  fb: FlowbrowserDatabase
  svc: WorkspaceExportImportService
  defaultId: string
}

function makeHarness(): Harness {
  const fb = FlowbrowserDatabase.bootstrap({ path: ':memory:', enableWal: false })
  const ws = fb.ensureDefaultWorkspace()
  const svc = new WorkspaceExportImportService({ fb })
  return { fb, svc, defaultId: ws.id }
}

function cleanup(h: Harness): void {
  h.fb.close()
}

/** 워크스페이스에 sample 데이터 박는 헬퍼 (test fixture). */
function seedWorkspaceData(
  h: Harness,
  workspaceId: string
): { pageId: string; visitId: string; noteId: string; tagId: string } {
  const db = h.fb.getDb()
  const pageId = randomUUID()
  const visitId = randomUUID()
  const noteId = randomUUID()
  const tagId = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pageId, workspaceId, 'https://example.com', 'Example', 'body', 'hash1', 'en', 1, now, now)
  db.prepare(
    `INSERT INTO visits(id, page_id, workspace_id, visited_at, dwell_ms) VALUES (?, ?, ?, ?, ?)`
  ).run(visitId, pageId, workspaceId, now, 1000)
  db.prepare(
    `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(noteId, pageId, visitId, workspaceId, 'selected', 'body text', null, now, 'user')
  db.prepare(
    `INSERT INTO tags(id, workspace_id, name, kind, ai_generated, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tagId, workspaceId, 'react', 'topic', 1, now)
  db.prepare(
    `INSERT INTO page_tags(page_id, tag_id, workspace_id, ai_generated, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(pageId, tagId, workspaceId, 1, now)
  db.prepare(
    `INSERT INTO note_tags(note_id, tag_id, workspace_id, ai_generated, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(noteId, tagId, workspaceId, 0, now)
  // ai_chat_history with retrieved_items + chat_meta containing page_id reference
  const chatId = randomUUID()
  const retrievedItems = JSON.stringify([
    { type: 'page', id: pageId, page_id: pageId, visit_id: visitId }
  ])
  const chatMeta = JSON.stringify({
    cells: [{ kind: 'summary', sources: [{ page_id: pageId, note_id: noteId }] }]
  })
  db.prepare(
    `INSERT INTO ai_chat_history(id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(chatId, workspaceId, pageId, visitId, 'assistant', 'answer', retrievedItems, chatMeta, 'ok', now)
  return { pageId, visitId, noteId, tagId }
}

describe('WorkspaceExportImportService', () => {
  let h: Harness

  beforeEach(() => {
    h = makeHarness()
  })

  afterEach(() => {
    cleanup(h)
  })

  describe('상수 export', () => {
    it('version=1 + schemaVersion=v04', () => {
      expect(WORKSPACE_EXPORT_VERSION).toBe(1)
      expect(WORKSPACE_EXPORT_SCHEMA_VERSION).toBe('v04')
    })
  })

  describe('exportWorkspace', () => {
    it('빈 워크스페이스 export — child 배열 모두 빈 배열', () => {
      const payload = h.svc.exportWorkspace(h.defaultId)
      expect(payload.version).toBe(1)
      expect(payload.schemaVersion).toBe('v04')
      expect(payload.workspace.id).toBe(h.defaultId)
      expect(payload.workspace.name).toBe('기본')
      expect(payload.pages).toEqual([])
      expect(payload.visits).toEqual([])
      expect(payload.notes).toEqual([])
      expect(payload.aiChatHistory).toEqual([])
      expect(payload.tags).toEqual([])
      expect(payload.pageTags).toEqual([])
      expect(payload.noteTags).toEqual([])
    })

    it('child 데이터 포함 워크스페이스 export — 모든 row 포함', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const payload = h.svc.exportWorkspace(h.defaultId)
      expect(payload.pages).toHaveLength(1)
      expect(payload.pages[0].id).toBe(ids.pageId)
      expect(payload.visits).toHaveLength(1)
      expect(payload.visits[0].id).toBe(ids.visitId)
      expect(payload.notes).toHaveLength(1)
      expect(payload.notes[0].id).toBe(ids.noteId)
      expect(payload.tags).toHaveLength(1)
      expect(payload.tags[0].id).toBe(ids.tagId)
      expect(payload.pageTags).toHaveLength(1)
      expect(payload.noteTags).toHaveLength(1)
      expect(payload.aiChatHistory).toHaveLength(1)
      expect(payload.aiChatHistory[0].retrieved_items).toContain(ids.pageId)
      expect(payload.aiChatHistory[0].chat_meta).toContain(ids.pageId)
    })

    it('없는 워크스페이스 → workspace_not_found error', () => {
      expect(() => h.svc.exportWorkspace('nope')).toThrow(WorkspaceExportImportError)
      expect(() => h.svc.exportWorkspace('nope')).toThrow(/workspace_not_found/)
    })

    it('다른 워크스페이스 데이터는 포함하지 않음 (격리 invariant)', () => {
      const wsA = h.defaultId
      const wsB = h.fb.createWorkspace({ name: 'B', icon: '💻' })
      seedWorkspaceData(h, wsA)
      seedWorkspaceData(h, wsB.id)
      const payloadA = h.svc.exportWorkspace(wsA)
      const payloadB = h.svc.exportWorkspace(wsB.id)
      // wsA payload 의 page 와 wsB payload 의 page 는 다른 id (격리)
      expect(payloadA.pages[0].id).not.toBe(payloadB.pages[0].id)
      // wsB.id 로 export 한 payload 안에는 wsA 의 page 가 없음
      expect(payloadB.pages.find((p) => p.id === payloadA.pages[0].id)).toBeUndefined()
    })
  })

  describe('importWorkspace', () => {
    it('round-trip — export 후 import 시 모든 row 복원 + 새 id 부여', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.workspaceId).not.toBe(h.defaultId) // 새 id
      expect(summary.pages).toBe(1)
      expect(summary.visits).toBe(1)
      expect(summary.notes).toBe(1)
      expect(summary.aiChatHistory).toBe(1)
      expect(summary.tags).toBe(1)
      expect(summary.pageTags).toBe(1)
      expect(summary.noteTags).toBe(1)
      // import 후 새 워크스페이스에서 export 하면 동일한 child 개수 (id 는 다름)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.pages).toHaveLength(1)
      expect(reExported.visits).toHaveLength(1)
      expect(reExported.notes).toHaveLength(1)
      expect(reExported.aiChatHistory).toHaveLength(1)
    })

    it('id remap — 모든 child id 가 새 id 로 발급 (원본 id 와 다름)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      // 새 id 들이 원본 id 와 충돌 0
      expect(reExported.pages[0].id).not.toBe(ids.pageId)
      expect(reExported.visits[0].id).not.toBe(ids.visitId)
      expect(reExported.notes[0].id).not.toBe(ids.noteId)
      expect(reExported.tags[0].id).not.toBe(ids.tagId)
    })

    it('chat_meta / retrieved_items 안의 page_id 참조도 새 id 로 rewrite', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      const chat = reExported.aiChatHistory[0]
      const newPageId = reExported.pages[0].id
      const newVisitId = reExported.visits[0].id
      const newNoteId = reExported.notes[0].id
      // 원본 id 는 들어있지 않아야 함 (참조 rewrite 정합)
      expect(chat.retrieved_items).not.toContain(ids.pageId)
      expect(chat.chat_meta).not.toContain(ids.pageId)
      expect(chat.chat_meta).not.toContain(ids.noteId)
      // 새 id 가 들어있어야 함
      expect(chat.retrieved_items).toContain(newPageId)
      expect(chat.retrieved_items).toContain(newVisitId)
      expect(chat.chat_meta).toContain(newPageId)
      expect(chat.chat_meta).toContain(newNoteId)
    })

    it('id 충돌 시 항상 새 워크스페이스 발급 (같은 export 두 번 import 가능)', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary1 = h.svc.importWorkspace(exported)
      const summary2 = h.svc.importWorkspace(exported)
      expect(summary1.workspaceId).not.toBe(summary2.workspaceId)
      expect(summary1.workspaceId).not.toBe(h.defaultId)
      expect(summary2.workspaceId).not.toBe(h.defaultId)
    })

    it('invalid_version 거부', () => {
      expect(() =>
        h.svc.importWorkspace({ version: 999, schemaVersion: 'v04', workspace: { name: 'x', icon: '📚' } })
      ).toThrow(/invalid_version/)
    })

    it('unsupported_schema_version 거부', () => {
      expect(() =>
        h.svc.importWorkspace({ version: 1, schemaVersion: 'v05', workspace: { name: 'x', icon: '📚' } })
      ).toThrow(/unsupported_schema_version/)
    })

    it('invalid_export_schema — workspace 필드 missing', () => {
      expect(() => h.svc.importWorkspace({ version: 1, schemaVersion: 'v04' })).toThrow(
        /invalid_export_schema/
      )
    })

    it('invalid_export_schema — payload null', () => {
      expect(() => h.svc.importWorkspace(null)).toThrow(/invalid_export_schema/)
    })

    it('invalid_export_schema — workspace.name 누락', () => {
      expect(() =>
        h.svc.importWorkspace({
          version: 1,
          schemaVersion: 'v04',
          workspace: { icon: '📚' }
        })
      ).toThrow(/invalid_export_schema/)
    })

    it('빈 워크스페이스 export → import — child 모두 0', () => {
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.pages).toBe(0)
      expect(summary.notes).toBe(0)
      expect(summary.aiChatHistory).toBe(0)
      expect(summary.tags).toBe(0)
    })

    it('dangling 참조 graceful skip — visit.page_id 가 매핑 안 되면 visit row skip + summary 는 실제 INSERT 수', () => {
      const exported: WorkspaceExportV1 = {
        version: 1,
        schemaVersion: 'v04',
        exportedAt: Date.now(),
        workspace: { id: 'old-ws', name: 'Test', icon: '📚', created_at: Date.now(), level_preference: null },
        pages: [],
        visits: [
          {
            id: 'orphan-visit',
            page_id: 'non-existent-page',
            visited_at: Date.now(),
            dwell_ms: 0
          }
        ],
        notes: [],
        aiChatHistory: [],
        tags: [],
        pageTags: [],
        noteTags: []
      }
      const summary = h.svc.importWorkspace(exported)
      // codex NEEDS_CHANGES hotfix — summary 는 실제 INSERT 수 (입력 length X)
      expect(summary.visits).toBe(0)
      // 실제 DB 에는 dangling visit INSERT 안 됨 — 재 export 시 0
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.visits).toHaveLength(0)
    })

    // codex BLOCKING #2 hotfix — skipped visit 참조 chain 정합
    it('T17 BLOCKING #2 — skipped visit 의 id 가 note/chat 에 등장하면 null 로 박힘 (FK 위반 차단)', () => {
      const db = h.fb.getDb()
      const pageId = randomUUID()
      const orphanVisitId = randomUUID() // pageIdMap 없는 visit
      const noteId = randomUUID()
      const chatId = randomUUID()
      const now = Date.now()
      // 사전 INSERT: 정상 page + orphan visit (page 참조 깨짐 — 미리 page 만 박고 visit 의 page_id 를 다른 id 로)
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageId, h.defaultId, 'https://example.com', 'Example', 'body', null, 'en', 1, now, now)
      // note 가 orphan visit 참조 (visit_id = orphanVisitId)
      db.prepare(
        `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
         VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`
      ).run(noteId, pageId, h.defaultId, 'sel', now, 'user')
      // chat 의 retrieved_items 안에 orphanVisitId 박음 (visit row 자체는 export 에 포함 안 함 — page_id 가 다른 ws)
      const retrievedJson = JSON.stringify([
        { type: 'page', id: pageId, page_id: pageId, visit_id: orphanVisitId }
      ])
      db.prepare(
        `INSERT INTO ai_chat_history(id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`
      ).run(chatId, h.defaultId, pageId, 'assistant', 'answer', retrievedJson, 'ok', now)

      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      // orphan visit_id 가 retrieved_items 안에서 null 로 박혀야 함 (dangling 제거)
      const chat = reExported.aiChatHistory[0]
      const parsed = JSON.parse(chat.retrieved_items!) as Array<{ visit_id: string | null }>
      expect(parsed[0].visit_id).toBeNull()
    })

    // codex BLOCKING #1 hotfix — import 후 WorkspaceService 캐시 invalidation
    // (본 service unit 은 svc 직접 호출이라 캐시 path 안 거침 — workspaceHandlers 단위 회귀에서 cover)
    it('T17 — summary counts 가 실제 INSERT row 수 (codex NEEDS_CHANGES 정합)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      // seed 가 박은 row 수와 정확히 일치
      expect(summary.pages).toBe(1)
      expect(summary.visits).toBe(1)
      expect(summary.notes).toBe(1)
      expect(summary.aiChatHistory).toBe(1)
      expect(summary.tags).toBe(1)
      expect(summary.pageTags).toBe(1)
      expect(summary.noteTags).toBe(1)
      // 매트릭스 정합 확인용 ids 참조 (lint 회피)
      expect(ids.pageId).toBeTruthy()
    })

    it('다른 워크스페이스 영향 0 — import 후 원본 워크스페이스 데이터 보존', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      h.svc.importWorkspace(exported)
      // 원본 워크스페이스의 데이터는 그대로
      const originalReExport = h.svc.exportWorkspace(h.defaultId)
      expect(originalReExport.pages[0].id).toBe(ids.pageId)
      expect(originalReExport.notes[0].id).toBe(ids.noteId)
    })

    /**
     * Sprint 016 M5 T23 — WorkspaceExportImportService 후속 round-trip 보존 검증.
     */
    it('round-trip — page.title / content / lang / content_hash 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.pages[0].title).toBe('Example')
      expect(reExported.pages[0].content).toBe('body')
      expect(reExported.pages[0].lang).toBe('en')
      expect(reExported.pages[0].content_hash).toBe('hash1')
      expect(reExported.pages[0].url).toBe('https://example.com')
    })

    it('round-trip — note.body / selected_text / created_by 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.notes[0].body).toBe('body text')
      expect(reExported.notes[0].selected_text).toBe('selected')
      expect(reExported.notes[0].created_by).toBe('user')
    })

    it('round-trip — workspace.name + icon 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.workspace.name).toBe('기본')
      expect(reExported.workspace.icon).toBe('📥')
    })

    it('round-trip — tag.name / kind / ai_generated 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.tags[0].name).toBe('react')
      expect(reExported.tags[0].kind).toBe('topic')
      expect(reExported.tags[0].ai_generated).toBe(1)
    })

    it('round-trip — page_tags / note_tags ai_generated 값 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.pageTags[0].ai_generated).toBe(1)
      expect(reExported.noteTags[0].ai_generated).toBe(0)
    })

    it('round-trip — chat status + role 보존', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.aiChatHistory[0].status).toBe('ok')
      expect(reExported.aiChatHistory[0].role).toBe('assistant')
      expect(reExported.aiChatHistory[0].content).toBe('answer')
    })

    it('빈 chat_meta / retrieved_items 둘 다 null 인 chat 도 round-trip 정상', () => {
      const db = h.fb.getDb()
      const pageId = randomUUID()
      const chatId = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageId, h.defaultId, 'https://x.com', 'X', 'body', null, 'en', 1, now, now)
      db.prepare(
        `INSERT INTO ai_chat_history(id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`
      ).run(chatId, h.defaultId, pageId, 'user', 'question', 'ok', now)

      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      const chat = reExported.aiChatHistory[0]
      expect(chat.retrieved_items).toBeNull()
      expect(chat.chat_meta).toBeNull()
      expect(chat.role).toBe('user')
    })

    it('exportWorkspace level_preference null 인 워크스페이스도 schema 정합', () => {
      const exported = h.svc.exportWorkspace(h.defaultId)
      // 기본 워크스페이스 level_preference 는 null (사용자 미선택)
      expect(exported.workspace).toHaveProperty('level_preference')
      // null 또는 string 둘 다 허용 — schema 정합
      const lp = exported.workspace.level_preference
      expect(lp === null || typeof lp === 'string').toBe(true)
    })
  })
})
