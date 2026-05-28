/**
 * Sprint 016 M3 T17 (KI-008) — WorkspaceExportImportService 단위 회귀.
 *
 * cover:
 *   - exportWorkspace — 빈 워크스페이스 / 여러 child 포함 / 없는 ws 에러
 *   - importWorkspace — round-trip / id remap 정합 / chat_meta page_id rewrite /
 *     version/schema 검증 / 단일 TX rollback
 *   - schema version 상수 정합
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import {
  WorkspaceExportImportService,
  WorkspaceExportImportError,
  WORKSPACE_EXPORT_VERSION,
  WORKSPACE_EXPORT_SCHEMA_VERSION,
  WORKSPACE_EXPORT_SCHEMA_VERSIONS_ACCEPTED,
  type WorkspaceExportV1,
  type ExportedHighlight
} from '../../../src/main/WorkspaceExportImportService'
import { DEFAULT_EMBEDDING_MODEL_ID } from '../../../src/storage/embeddingModel'
import { applyV06Schema } from '../../helpers/v06Schema'

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

/** Sprint 018 M2 T17d — v06 harness (embedding_model 컬럼 — round-trip 보존 검증용). */
function makeHarnessV06(): Harness {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb)
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
    it('version=1 + schemaVersion=v06 (Sprint 018 M2 T17d bump — embedding_model 포함)', () => {
      expect(WORKSPACE_EXPORT_VERSION).toBe(1)
      expect(WORKSPACE_EXPORT_SCHEMA_VERSION).toBe('v06')
    })

    it('accepted schema versions = [v04, v05, v06] (BC)', () => {
      expect(WORKSPACE_EXPORT_SCHEMA_VERSIONS_ACCEPTED).toEqual(['v04', 'v05', 'v06'])
    })
  })

  describe('exportWorkspace', () => {
    it('빈 워크스페이스 export — child 배열 모두 빈 배열 (highlights 포함)', () => {
      const payload = h.svc.exportWorkspace(h.defaultId)
      expect(payload.version).toBe(1)
      expect(payload.schemaVersion).toBe('v06')
      expect(payload.workspace.id).toBe(h.defaultId)
      expect(payload.workspace.name).toBe('기본')
      expect(payload.pages).toEqual([])
      expect(payload.visits).toEqual([])
      expect(payload.notes).toEqual([])
      expect(payload.aiChatHistory).toEqual([])
      expect(payload.tags).toEqual([])
      expect(payload.pageTags).toEqual([])
      expect(payload.noteTags).toEqual([])
      expect(payload.highlights).toEqual([])
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
        h.svc.importWorkspace({ version: 999, schemaVersion: 'v05', workspace: { name: 'x', icon: '📚' } })
      ).toThrow(/invalid_version/)
    })

    // Sprint 017 M1 T09 — codex 019e4f02 Q1 권고: v99 reject 로 변경 (v04/v05 모두 수용).
    it('unsupported_schema_version 거부 (v04 / v05 외)', () => {
      expect(() =>
        h.svc.importWorkspace({ version: 1, schemaVersion: 'v99', workspace: { name: 'x', icon: '📚' } })
      ).toThrow(/unsupported_schema_version/)
    })

    it('invalid_export_schema — workspace 필드 missing', () => {
      expect(() => h.svc.importWorkspace({ version: 1, schemaVersion: 'v05' })).toThrow(
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
          schemaVersion: 'v05',
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
        schemaVersion: 'v05',
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
        noteTags: [],
        highlights: []
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

  /**
   * Sprint 017 M1 T09 (AC-2 #4 closure) — highlights export/import 통합.
   *
   * codex 019e4f02 사전 협의 정합:
   *   - Q1: schemaVersion v04→v05 bump + v04 payload graceful (highlights=[] normalize)
   *   - Q2: note_id 매핑 누락 시 skip / page_id 누락 시 null / workspace_id 강제
   *   - Q3: contentHash dedupe X (round-trip 보존) + duplicate highlight.id 방어 skip
   *   - Q5: anchor JSON parse 실패 시 skip (HighlightStore 조회 시점 throw 차단)
   */
  describe('T09 — highlights export/import', () => {
    const sampleAnchor = JSON.stringify({
      rootSelector: 'body',
      startPath: [0, 0],
      endPath: [0, 0],
      startOffset: 0,
      endOffset: 10,
      selectedText: 'sample',
      prefix: '',
      suffix: '',
      contentHash: 'a'.repeat(64),
      contextHash: 'b'.repeat(64)
    })

    function seedHighlight(
      ws: string,
      noteId: string,
      pageId: string | null,
      overrides: Partial<ExportedHighlight> = {}
    ): string {
      const db = h.fb.getDb()
      const id = overrides.id ?? randomUUID()
      db.prepare(
        `INSERT INTO highlights(id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        noteId,
        ws,
        pageId,
        overrides.url ?? 'https://example.com',
        overrides.content_hash ?? 'hash1',
        overrides.anchor ?? sampleAnchor,
        overrides.created_at ?? Date.now()
      )
      return id
    }

    it('exportWorkspace — highlights 포함 (workspace_id 격리 + ORDER BY created_at ASC)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const hl1Id = seedHighlight(h.defaultId, ids.noteId, ids.pageId, {
        url: 'https://a.com',
        content_hash: 'h-a',
        created_at: 1000
      })
      const hl2Id = seedHighlight(h.defaultId, ids.noteId, ids.pageId, {
        url: 'https://b.com',
        content_hash: 'h-b',
        created_at: 2000
      })
      const payload = h.svc.exportWorkspace(h.defaultId)
      expect(payload.highlights).toHaveLength(2)
      expect(payload.highlights[0].id).toBe(hl1Id)
      expect(payload.highlights[1].id).toBe(hl2Id)
      expect(payload.highlights[0].url).toBe('https://a.com')
      expect(payload.highlights[0].anchor).toBe(sampleAnchor)
      expect(payload.highlights[0].content_hash).toBe('h-a')
    })

    it('exportWorkspace — cross-workspace 차단 (다른 ws 의 highlights 미포함)', () => {
      const wsA = h.defaultId
      const wsB = h.fb.createWorkspace({ name: 'B', icon: '💻' })
      const idsA = seedWorkspaceData(h, wsA)
      const idsB = seedWorkspaceData(h, wsB.id)
      const hlAId = seedHighlight(wsA, idsA.noteId, idsA.pageId, { url: 'https://a.com' })
      const hlBId = seedHighlight(wsB.id, idsB.noteId, idsB.pageId, { url: 'https://b.com' })
      const payloadA = h.svc.exportWorkspace(wsA)
      const payloadB = h.svc.exportWorkspace(wsB.id)
      expect(payloadA.highlights.map((x) => x.id)).toEqual([hlAId])
      expect(payloadB.highlights.map((x) => x.id)).toEqual([hlBId])
      expect(payloadA.highlights.find((x) => x.id === hlBId)).toBeUndefined()
    })

    it('round-trip — highlights 보존 + note_id/page_id 새 id 로 rewrite + url/content_hash/anchor 원문 보존', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const originalHlId = seedHighlight(h.defaultId, ids.noteId, ids.pageId, {
        url: 'https://round.com',
        content_hash: 'rt-hash',
        created_at: 12345
      })
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(1)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(1)
      const restored = reExported.highlights[0]
      // 새 id (다른 child 와 정책 정합 — randomUUID)
      expect(restored.id).not.toBe(originalHlId)
      // note_id / page_id 새 id 로 rewrite (원본과 다름)
      expect(restored.note_id).not.toBe(ids.noteId)
      expect(restored.note_id).toBe(reExported.notes[0].id)
      expect(restored.page_id).not.toBe(ids.pageId)
      expect(restored.page_id).toBe(reExported.pages[0].id)
      // workspace_id 는 새 ws (export query 가 ws 필터 → 자명)
      // url / content_hash / anchor / created_at 보존
      expect(restored.url).toBe('https://round.com')
      expect(restored.content_hash).toBe('rt-hash')
      expect(restored.anchor).toBe(sampleAnchor)
      expect(restored.created_at).toBe(12345)
    })

    it('v04 payload (highlights 미포함) graceful import — highlights=0 + 나머지 정상', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exportedV5 = h.svc.exportWorkspace(h.defaultId)
      // v04 형태 (Sprint 016 M3 T17 산출물 모사) — highlights 키 제거 + schemaVersion 'v04'
      const v4Payload = {
        ...exportedV5,
        schemaVersion: 'v04' as const,
        highlights: undefined
      }
      delete (v4Payload as Record<string, unknown>).highlights
      const summary = h.svc.importWorkspace(v4Payload)
      expect(summary.highlights).toBe(0)
      expect(summary.pages).toBe(1)
      expect(summary.notes).toBe(1)
      // lint 회피
      expect(ids.pageId).toBeTruthy()
    })

    it('highlight.note_id 매핑 누락 시 skip — note 가 export 에 없으면 highlight skip (NOT NULL FK)', () => {
      const exported: WorkspaceExportV1 = {
        version: 1,
        schemaVersion: 'v05',
        exportedAt: Date.now(),
        workspace: {
          id: 'old-ws',
          name: 'Test',
          icon: '📚',
          created_at: Date.now(),
          level_preference: null
        },
        pages: [],
        visits: [],
        notes: [],
        aiChatHistory: [],
        tags: [],
        pageTags: [],
        noteTags: [],
        highlights: [
          {
            id: 'orphan-hl',
            note_id: 'non-existent-note',
            page_id: null,
            url: 'https://x.com',
            content_hash: 'orph',
            anchor: sampleAnchor,
            created_at: Date.now()
          }
        ]
      }
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(0)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(0)
    })

    it('highlight.page_id 매핑 누락 시 null 박음 (page SET NULL 정책 정합)', () => {
      // note 만 있고 page 없는 export — highlight.page_id 가 page 가 아닌 fake id 참조
      const exported: WorkspaceExportV1 = {
        version: 1,
        schemaVersion: 'v05',
        exportedAt: Date.now(),
        workspace: {
          id: 'old-ws',
          name: 'Test',
          icon: '📚',
          created_at: Date.now(),
          level_preference: null
        },
        pages: [],
        visits: [],
        notes: [
          {
            id: 'src-note',
            page_id: null,
            visit_id: null,
            selected_text: 'sel',
            body: null,
            ai_tags: null,
            created_at: Date.now(),
            created_by: 'user'
          }
        ],
        aiChatHistory: [],
        tags: [],
        pageTags: [],
        noteTags: [],
        highlights: [
          {
            id: 'hl-page-null',
            note_id: 'src-note',
            page_id: 'non-existent-page', // pageIdMap 누락 → null
            url: 'https://x.com',
            content_hash: 'h',
            anchor: sampleAnchor,
            created_at: Date.now()
          }
        ]
      }
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(1)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(1)
      expect(reExported.highlights[0].page_id).toBeNull()
    })

    it('동일 contentHash highlight 2개도 모두 round-trip (dedupe X — codex Q3)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const sameHash = 'same-content-hash'
      seedHighlight(h.defaultId, ids.noteId, ids.pageId, {
        content_hash: sameHash,
        url: 'https://x.com',
        created_at: 1
      })
      seedHighlight(h.defaultId, ids.noteId, ids.pageId, {
        content_hash: sameHash,
        url: 'https://x.com',
        created_at: 2
      })
      const exported = h.svc.exportWorkspace(h.defaultId)
      expect(exported.highlights).toHaveLength(2)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(2)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(2)
      expect(reExported.highlights.every((x) => x.content_hash === sameHash)).toBe(true)
    })

    it('duplicate source highlight.id 두 번 등장 시 둘째 skip (corrupt payload 방어 — codex Q3)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const sharedSrcId = 'shared-src-id'
      const exported: WorkspaceExportV1 = h.svc.exportWorkspace(h.defaultId)
      const noteRow = exported.notes[0]
      const pageRow = exported.pages[0]
      exported.highlights = [
        {
          id: sharedSrcId,
          note_id: noteRow.id,
          page_id: pageRow.id,
          url: 'https://x.com',
          content_hash: 'h',
          anchor: sampleAnchor,
          created_at: 1
        },
        {
          id: sharedSrcId, // 두 번째 등장 → skip
          note_id: noteRow.id,
          page_id: pageRow.id,
          url: 'https://y.com',
          content_hash: 'h2',
          anchor: sampleAnchor,
          created_at: 2
        }
      ]
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(1) // 둘째 skip
      // 첫 번째 row 만 INSERT — url 'https://x.com'
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(1)
      expect(reExported.highlights[0].url).toBe('https://x.com')
      // lint 회피
      expect(ids.noteId).toBeTruthy()
    })

    it('malformed anchor (JSON parse 실패) 시 skip — HighlightStore 조회 시점 throw 차단', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported: WorkspaceExportV1 = h.svc.exportWorkspace(h.defaultId)
      exported.highlights = [
        {
          id: randomUUID(),
          note_id: exported.notes[0].id,
          page_id: exported.pages[0].id,
          url: 'https://valid.com',
          content_hash: 'h-ok',
          anchor: sampleAnchor,
          created_at: 1
        },
        {
          id: randomUUID(),
          note_id: exported.notes[0].id,
          page_id: exported.pages[0].id,
          url: 'https://bad.com',
          content_hash: 'h-bad',
          anchor: '{not valid json',
          created_at: 2
        }
      ]
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(1) // malformed 둘째 skip
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(1)
      expect(reExported.highlights[0].url).toBe('https://valid.com')
      // lint 회피
      expect(ids.noteId).toBeTruthy()
    })

    it('workspace_id 강제 — payload 의 workspace_id 가 다른 ws 라도 newWorkspaceId 로 INSERT (cross-ws 유입 차단)', () => {
      const wsB = h.fb.createWorkspace({ name: 'B', icon: '💻' })
      const idsA = seedWorkspaceData(h, h.defaultId)
      // wsA 의 export 에 wsB 의 가짜 workspace_id 가 박힌 corrupt payload (안 박혀도 service 가 강제 — 본 테스트는 확정)
      const exported = h.svc.exportWorkspace(h.defaultId)
      // 이 시점 export.highlights[].workspace_id 는 export query 자체에 미포함 (ExportedHighlight 인터페이스에 없음)
      // → service 의 INSERT 시 항상 newWorkspaceId 강제 정합 cover
      seedHighlight(h.defaultId, idsA.noteId, idsA.pageId, {
        url: 'https://forcecheck.com',
        content_hash: 'ws-force'
      })
      const exportedAfter = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exportedAfter)
      // import 후 new ws 에 highlight 가 들어있어야 함 (wsB 영향 0)
      const reExportedB = h.svc.exportWorkspace(wsB.id)
      expect(reExportedB.highlights).toHaveLength(0)
      const reExportedNew = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExportedNew.highlights.find((x) => x.url === 'https://forcecheck.com')).toBeTruthy()
      // 원본 wsA 도 그대로 보존
      const reExportedA = h.svc.exportWorkspace(h.defaultId)
      expect(reExportedA.highlights.length).toBeGreaterThan(0)
      // lint 회피
      expect(exported.highlights).toBeDefined()
    })

    it('summary.highlights 가 실제 INSERT 수 (입력 length X — note_id skip + malformed skip 합산)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported: WorkspaceExportV1 = h.svc.exportWorkspace(h.defaultId)
      exported.highlights = [
        // 1. 정상
        {
          id: randomUUID(),
          note_id: exported.notes[0].id,
          page_id: exported.pages[0].id,
          url: 'https://1.com',
          content_hash: 'h1',
          anchor: sampleAnchor,
          created_at: 1
        },
        // 2. note 매핑 누락 → skip
        {
          id: randomUUID(),
          note_id: 'missing-note',
          page_id: null,
          url: 'https://2.com',
          content_hash: 'h2',
          anchor: sampleAnchor,
          created_at: 2
        },
        // 3. malformed anchor → skip
        {
          id: randomUUID(),
          note_id: exported.notes[0].id,
          page_id: null,
          url: 'https://3.com',
          content_hash: 'h3',
          anchor: 'not json',
          created_at: 3
        }
      ]
      const summary = h.svc.importWorkspace(exported)
      expect(summary.highlights).toBe(1)
      expect(ids.noteId).toBeTruthy()
    })

    it('round-trip — Sprint 017 M1 T09 합산: highlights + 다른 child 모두 정합', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      seedHighlight(h.defaultId, ids.noteId, ids.pageId, { url: 'https://h.com', content_hash: 'ch' })
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.pages).toBe(1)
      expect(summary.notes).toBe(1)
      expect(summary.aiChatHistory).toBe(1)
      expect(summary.highlights).toBe(1)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights[0].url).toBe('https://h.com')
      expect(reExported.highlights[0].note_id).toBe(reExported.notes[0].id)
    })

    // codex 019e4f19 NEEDS_CHANGES #1 hotfix — v04 payload 는 highlights 필드가 있어도 무시.
    it('v04 payload + highlights[] 포함 시 무시 (forward-compat 위배 차단)', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      // v04 모사 — schemaVersion 'v04' + highlights 박음 (corrupt payload)
      const corrupt = {
        ...exported,
        schemaVersion: 'v04' as const,
        highlights: [
          {
            id: 'should-be-ignored',
            note_id: exported.notes[0].id,
            page_id: exported.pages[0].id,
            url: 'https://ignored.com',
            content_hash: 'h-ignored',
            anchor: sampleAnchor,
            created_at: 1
          }
        ]
      }
      const summary = h.svc.importWorkspace(corrupt)
      expect(summary.highlights).toBe(0) // v04 면 highlights 무시
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(0)
      expect(ids.noteId).toBeTruthy()
    })

    // codex 019e4f19 NEEDS_CHANGES #2 hotfix — NOT NULL 컬럼 missing 시 per-row skip (transaction rollback 차단).
    it('missing NOT NULL 필드 (url / content_hash / created_at / id) per-row skip — transaction rollback 차단', () => {
      const ids = seedWorkspaceData(h, h.defaultId)
      const exported: WorkspaceExportV1 = h.svc.exportWorkspace(h.defaultId)
      const validNoteId = exported.notes[0].id
      const validPageId = exported.pages[0].id
      // 각각 필드 missing 한 corrupt row + 마지막에 valid row 박음
      // valid row 가 INSERT 되어야 transaction 전체 rollback 차단 확인 가능.
      exported.highlights = [
        // 1. id missing → skip
        {
          note_id: validNoteId,
          page_id: validPageId,
          url: 'https://1.com',
          content_hash: 'h1',
          anchor: sampleAnchor,
          created_at: 1
        } as unknown as ExportedHighlight,
        // 2. url missing → skip (NOT NULL)
        {
          id: randomUUID(),
          note_id: validNoteId,
          page_id: validPageId,
          content_hash: 'h2',
          anchor: sampleAnchor,
          created_at: 2
        } as unknown as ExportedHighlight,
        // 3. content_hash missing → skip (NOT NULL)
        {
          id: randomUUID(),
          note_id: validNoteId,
          page_id: validPageId,
          url: 'https://3.com',
          anchor: sampleAnchor,
          created_at: 3
        } as unknown as ExportedHighlight,
        // 4. created_at missing → skip (NOT NULL)
        {
          id: randomUUID(),
          note_id: validNoteId,
          page_id: validPageId,
          url: 'https://4.com',
          content_hash: 'h4',
          anchor: sampleAnchor
        } as unknown as ExportedHighlight,
        // 5. valid row → INSERT
        {
          id: randomUUID(),
          note_id: validNoteId,
          page_id: validPageId,
          url: 'https://valid.com',
          content_hash: 'h-valid',
          anchor: sampleAnchor,
          created_at: 99
        }
      ]
      const summary = h.svc.importWorkspace(exported)
      // 4 skip + 1 INSERT = 1
      expect(summary.highlights).toBe(1)
      // 다른 child 도 정상 INSERT (transaction 전체 rollback 차단 확인)
      expect(summary.pages).toBe(1)
      expect(summary.notes).toBe(1)
      const reExported = h.svc.exportWorkspace(summary.workspaceId)
      expect(reExported.highlights).toHaveLength(1)
      expect(reExported.highlights[0].url).toBe('https://valid.com')
      expect(ids.noteId).toBeTruthy()
    })
  })

  describe('Sprint 017 M2 T12 (KI-022) — embedding_queue 자동 re-enqueue', () => {
    it('embeddingQueue 미주입 (기존 path) → summary.embeddingJobs = { pages:0, notes:0 }', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const summary = h.svc.importWorkspace(exported)
      expect(summary.embeddingJobs).toEqual({ pages: 0, notes: 0 })
    })

    it('embeddingQueue 주입 — page/note 각각 enqueue (priority=1) + summary.embeddingJobs 정확', () => {
      seedWorkspaceData(h, h.defaultId) // 1 page (content='body') + 1 note (body='body text')
      const exported = h.svc.exportWorkspace(h.defaultId)
      const enqueueSpy = vi.fn().mockReturnValue({
        id: 'job',
        target_type: 'page',
        target_id: 'x',
        workspace_id: 'ws',
        priority: 1,
        status: 'pending',
        attempts: 0,
        last_error: null,
        created_at: 0,
        updated_at: 0
      })
      const queue = { enqueue: enqueueSpy }

      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: queue as any
      })
      const summary = svc.importWorkspace(exported)
      expect(enqueueSpy).toHaveBeenCalledTimes(2)
      const [pageCall] = enqueueSpy.mock.calls.find(
        (c) => (c[0] as { target_type: string }).target_type === 'page'
      )!
      expect(pageCall).toMatchObject({
        target_type: 'page',
        workspace_id: summary.workspaceId,
        priority: 1
      })
      const [noteCall] = enqueueSpy.mock.calls.find(
        (c) => (c[0] as { target_type: string }).target_type === 'note'
      )!
      expect(noteCall).toMatchObject({
        target_type: 'note',
        workspace_id: summary.workspaceId,
        priority: 1
      })
      expect(summary.embeddingJobs).toEqual({ pages: 1, notes: 1 })
    })

    it('content empty page → enqueue skip (page count 변동 0, embeddingJobs.pages=0)', () => {
      // pages 1개 + content='' 박힘 (직접 INSERT)
      const wsId = h.defaultId
      const db = h.fb.getDb()
      const pageId = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageId, wsId, 'https://empty.com', 'Empty', '', null, null, 1, now, now)

      const exported = h.svc.exportWorkspace(wsId)
      const enqueueSpy = vi.fn()
      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: { enqueue: enqueueSpy } as any
      })
      const summary = svc.importWorkspace(exported)
      expect(summary.pages).toBe(1) // INSERT 됨
      expect(summary.embeddingJobs.pages).toBe(0) // enqueue 안 됨
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('body+selected_text 둘 다 empty note → enqueue skip', () => {
      const wsId = h.defaultId
      const db = h.fb.getDb()
      const pageId = randomUUID()
      const noteId = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageId, wsId, 'https://x.com', 'X', 'page-body', 'h', 'en', 1, now, now)
      db.prepare(
        `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(noteId, pageId, null, wsId, '', null, null, now, 'user')

      const exported = h.svc.exportWorkspace(wsId)
      const enqueueSpy = vi.fn()
      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: { enqueue: enqueueSpy } as any
      })
      const summary = svc.importWorkspace(exported)
      expect(summary.notes).toBe(1)
      expect(summary.embeddingJobs).toEqual({ pages: 1, notes: 0 })
      // enqueue 는 page 1회만 (note skip)
      expect(enqueueSpy).toHaveBeenCalledTimes(1)
      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ target_type: 'page' })
      )
    })

    it('import error (invalid schema) → enqueue 호출 0 (TX rollback 정합)', () => {
      const enqueueSpy = vi.fn()
      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: { enqueue: enqueueSpy } as any
      })
      expect(() =>
        svc.importWorkspace({ version: 999, schemaVersion: 'v05', workspace: { name: 'x', icon: '📚' } })
      ).toThrow(/invalid_version/)
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('codex 019e4fb7 NEEDS_CHANGES #1 — whitespace-only content/note 도 enqueue skip (trim 정합)', () => {
      const wsId = h.defaultId
      const db = h.fb.getDb()
      const now = Date.now()
      // page 1: whitespace-only content
      const pageWs = randomUUID()
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageWs, wsId, 'https://ws-page.com', 'WS', '   \n  \t  ', null, null, 1, now, now)
      // note 1: whitespace-only body + selected_text
      const noteWs = randomUUID()
      db.prepare(
        `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(noteWs, pageWs, null, wsId, '   ', '\t\t', null, now, 'user')

      const exported = h.svc.exportWorkspace(wsId)
      const enqueueSpy = vi.fn()
      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: { enqueue: enqueueSpy } as any
      })
      const summary = svc.importWorkspace(exported)
      // pages/notes 는 정상 INSERT (whitespace-only 도 row 자체는 박힘)
      expect(summary.pages).toBe(1)
      expect(summary.notes).toBe(1)
      // 그러나 embeddingJobs 둘 다 0 — trim 정합 skip
      expect(summary.embeddingJobs).toEqual({ pages: 0, notes: 0 })
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('codex 019e4fb7 NEEDS_CHANGES #2 — 실 EmbeddingQueue 주입 시 page+note row 박힘 (prepared statement TX 정합)', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      const realQueue = new EmbeddingQueue(h.fb)
      const svc = new WorkspaceExportImportService({
        fb: h.fb,
        embeddingQueue: realQueue
      })
      const summary = svc.importWorkspace(exported)
      // 실 큐로 page=1 + note=1 박힘
      expect(summary.embeddingJobs).toEqual({ pages: 1, notes: 1 })
      // 실 DB 에 embedding_queue row 2 개 박힘 — pending 상태
      const stats = realQueue.stats()
      expect(stats.pending).toBe(2)
      // workspace_id 매칭 — 새 import 된 workspaceId 로
      const rows = h.fb
        .getDb()
        .prepare(
          `SELECT target_type, workspace_id, priority FROM embedding_queue WHERE workspace_id = ? ORDER BY target_type ASC`
        )
        .all(summary.workspaceId) as Array<{
        target_type: string
        workspace_id: string
        priority: number
      }>
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.target_type).sort()).toEqual(['note', 'page'])
      expect(rows.every((r) => r.priority === 1)).toBe(true)
      // claim 도 정상 동작 (재시도 가능 path)
      const claimed = realQueue.claimNext()
      expect(claimed).not.toBeNull()
    })

    it('codex 019e4fb7 NEEDS_CHANGES #2 — enqueue mid-import throw 시 page/note INSERT 모두 rollback', () => {
      seedWorkspaceData(h, h.defaultId)
      const exported = h.svc.exportWorkspace(h.defaultId)
      // 첫 호출에 throw — TX 진입 후 page INSERT 후 enqueue 시점에서 throw
      const enqueueSpy = vi.fn(() => {
        throw new Error('enqueue boom')
      })
      const svc = new WorkspaceExportImportService({
        fb: h.fb,

        embeddingQueue: { enqueue: enqueueSpy } as any
      })
      const before = h.fb.getDb().prepare(`SELECT COUNT(*) AS c FROM pages`).get() as { c: number }
      expect(() => svc.importWorkspace(exported)).toThrow(/enqueue boom/)
      // rollback 정합 — pages row 변동 0
      const after = h.fb.getDb().prepare(`SELECT COUNT(*) AS c FROM pages`).get() as { c: number }
      expect(after.c).toBe(before.c)
      // 새 workspace 도 INSERT 안 박힘 (TX atomicity)
      const wsRows = h.fb
        .getDb()
        .prepare(`SELECT COUNT(*) AS c FROM workspaces WHERE name = ?`)
        .get(exported.workspace.name) as { c: number }
      // 기존 default workspace 1 개만 — 새 import 한 거 안 박힘
      expect(wsRows.c).toBe(1)
    })
  })
})

// Sprint 018 M2 T17d — embedding_model export/import round-trip (codex 019e6e62 NC).
describe('WorkspaceExportImportService — embedding_model (T17d)', () => {
  let h: Harness

  afterEach(() => {
    cleanup(h)
  })

  it('export 가 워크스페이스 embedding_model 포함 (v06 default → openai:1024)', () => {
    h = makeHarnessV06()
    const payload = h.svc.exportWorkspace(h.defaultId)
    expect(payload.workspace.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)
  })

  it('round-trip — ollama:768 워크스페이스 export → import 시 모델 보존', () => {
    h = makeHarnessV06()
    const ws = h.fb.createWorkspace({
      name: 'KO',
      icon: '🇰🇷',
      embedding_model: 'ollama:nomic-embed-text:768'
    })
    const payload = h.svc.exportWorkspace(ws.id)
    expect(payload.workspace.embedding_model).toBe('ollama:nomic-embed-text:768')

    const summary = h.svc.importWorkspace(payload)
    const imported = h.fb.findWorkspaceById(summary.workspaceId)
    expect(imported?.embedding_model).toBe('ollama:nomic-embed-text:768')
  })

  it('v05 payload (embedding_model 부재) import → DEFAULT (backward compat)', () => {
    // v05 harness — 컬럼 미지정 import path. payload 에 embedding_model 없음.
    h = makeHarness()
    const v05Payload: WorkspaceExportV1 = {
      version: 1,
      schemaVersion: 'v05',
      exportedAt: Date.now(),
      workspace: { id: randomUUID(), name: 'Legacy', icon: '📦', created_at: Date.now(), level_preference: null },
      pages: [],
      visits: [],
      notes: [],
      aiChatHistory: [],
      tags: [],
      pageTags: [],
      noteTags: [],
      highlights: []
    }
    const summary = h.svc.importWorkspace(v05Payload)
    const imported = h.fb.findWorkspaceById(summary.workspaceId)
    // v05 schema 접근자가 컬럼 부재 시 DEFAULT 백필.
    expect(imported?.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)
  })

  it('import 시 미지원 embedding_model 은 drop → DEFAULT (forward-compat graceful)', () => {
    h = makeHarnessV06()
    const payload: WorkspaceExportV1 = {
      version: 1,
      schemaVersion: 'v06',
      exportedAt: Date.now(),
      workspace: {
        id: randomUUID(),
        name: 'Future',
        icon: '🔮',
        created_at: Date.now(),
        level_preference: null,
        embedding_model: 'future:mystery-model:512'
      },
      pages: [],
      visits: [],
      notes: [],
      aiChatHistory: [],
      tags: [],
      pageTags: [],
      noteTags: [],
      highlights: []
    }
    const summary = h.svc.importWorkspace(payload)
    const imported = h.fb.findWorkspaceById(summary.workspaceId)
    expect(imported?.embedding_model).toBe(DEFAULT_EMBEDDING_MODEL_ID)
  })
})
