/**
 * Sprint 016 M3 T17 (KI-008 closed) — Workspace JSON Export/Import.
 *
 * 책임:
 *   - 한 워크스페이스의 모든 데이터를 versioned JSON 으로 export (Workspace + Page + Visit + Note +
 *     AiChatHistory + Tag + page_tags + note_tags 일괄)
 *   - JSON 을 새 워크스페이스로 import (모든 id 새 발급 + child 참조 재매핑 + chat_meta/retrieved_items
 *     page_id 참조 rewrite)
 *
 * 비책임:
 *   - vec_pages / vec_notes 임베딩 row export/import — derived data, model/dimension/sqlite-vec 버전 의존.
 *     Import 후 embedding_queue 재 enqueue 는 후속 hotfix (KI-022 후보)
 *   - UI 책임 (파일 다이얼로그 등) — workspaceHandlers + IPC layer 책임
 *   - 충돌 워크스페이스 id reject path — 항상 새 id 발급 (codex 협의 정합)
 *
 * Schema:
 *   - version: 1 (변경 시 마이그레이션 로직 추가)
 *   - schemaVersion: 'v04' (DB schema 버전 추적 — 향후 v05 호환성)
 *
 * 단위 회귀: tests/unit/main/WorkspaceExportImportService.test.ts
 * PRD 인용: §11.5.6 (Phase 1, M6) — Workspace JSON Export/Import.
 */

import { randomUUID } from 'node:crypto'
import type { Database as BetterDatabase } from 'better-sqlite3'
import type { FlowbrowserDatabase, WorkspaceRow, LevelPreference } from '../storage/Database'

export const WORKSPACE_EXPORT_VERSION = 1 as const
export const WORKSPACE_EXPORT_SCHEMA_VERSION = 'v04' as const

export interface ExportedWorkspace {
  id: string
  name: string
  icon: string
  created_at: number
  level_preference: LevelPreference
}

export interface ExportedPage {
  id: string
  url: string
  title: string
  content: string
  content_hash: string | null
  lang: string | null
  visited_count: number
  created_at: number
  updated_at: number
}

export interface ExportedVisit {
  id: string
  page_id: string
  visited_at: number
  dwell_ms: number
}

export interface ExportedNote {
  id: string
  page_id: string | null
  visit_id: string | null
  selected_text: string
  body: string | null
  ai_tags: string | null
  created_at: number
  created_by: 'user' | 'migration'
}

export interface ExportedAiChatHistory {
  id: string
  page_id: string | null
  visit_id: string | null
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  /** TEXT 컬럼 그대로 (JSON 파싱은 import 측에서 ID rewrite 시 수행) */
  retrieved_items: string | null
  /** TEXT 컬럼 그대로 */
  chat_meta: string | null
  status: 'ok' | 'pending' | 'failed' | 'aborted'
  created_at: number
}

export interface ExportedTag {
  id: string
  name: string
  kind: 'topic' | 'entity' | 'metric' | 'sentiment' | 'domain' | 'freeform'
  ai_generated: number
  created_at: number
}

export interface ExportedPageTag {
  page_id: string
  tag_id: string
  ai_generated: number
  created_at: number
}

export interface ExportedNoteTag {
  note_id: string
  tag_id: string
  ai_generated: number
  created_at: number
}

export interface WorkspaceExportV1 {
  version: 1
  schemaVersion: 'v04'
  exportedAt: number
  workspace: ExportedWorkspace
  pages: ExportedPage[]
  visits: ExportedVisit[]
  notes: ExportedNote[]
  aiChatHistory: ExportedAiChatHistory[]
  tags: ExportedTag[]
  pageTags: ExportedPageTag[]
  noteTags: ExportedNoteTag[]
}

export interface ImportResultSummary {
  workspaceId: string
  pages: number
  visits: number
  notes: number
  aiChatHistory: number
  tags: number
  pageTags: number
  noteTags: number
}

export class WorkspaceExportImportError extends Error {
  constructor(
    public readonly code:
      | 'workspace_not_found'
      | 'invalid_export_schema'
      | 'invalid_version'
      | 'unsupported_schema_version',
    detail?: string
  ) {
    // message 는 항상 code 로 시작 — 테스트 toThrow(/code/) + caller 가 code 분기 정합.
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'WorkspaceExportImportError'
  }
}

export interface WorkspaceExportImportServiceOptions {
  fb: FlowbrowserDatabase
}

export class WorkspaceExportImportService {
  private readonly fb: FlowbrowserDatabase
  private readonly db: BetterDatabase

  constructor(opts: WorkspaceExportImportServiceOptions) {
    this.fb = opts.fb
    this.db = opts.fb.getDb()
  }

  /**
   * 한 워크스페이스의 모든 데이터를 JSON 객체로 export.
   *
   * 워크스페이스 미존재 시 `WorkspaceExportImportError('workspace_not_found')`.
   * vec_pages / vec_notes 는 export 대상 외 (재계산 권장 — KI-022 후보).
   *
   * JSON column (retrieved_items / chat_meta) 은 TEXT 그대로 export — import 시 ID remap 후 다시 INSERT.
   */
  exportWorkspace(workspaceId: string): WorkspaceExportV1 {
    const ws = this.fb.findWorkspaceById(workspaceId)
    if (!ws) {
      throw new WorkspaceExportImportError('workspace_not_found')
    }

    const pages = this.db
      .prepare(
        `SELECT id, url, title, content, content_hash, lang, visited_count, created_at, updated_at
         FROM pages WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedPage[]

    const visits = this.db
      .prepare(
        `SELECT id, page_id, visited_at, dwell_ms
         FROM visits WHERE workspace_id = ? ORDER BY visited_at ASC`
      )
      .all(workspaceId) as ExportedVisit[]

    const notes = this.db
      .prepare(
        `SELECT id, page_id, visit_id, selected_text, body, ai_tags, created_at, created_by
         FROM notes WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedNote[]

    const aiChatHistory = this.db
      .prepare(
        `SELECT id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at
         FROM ai_chat_history WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedAiChatHistory[]

    const tags = this.db
      .prepare(
        `SELECT id, name, kind, ai_generated, created_at
         FROM tags WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedTag[]

    const pageTags = this.db
      .prepare(
        `SELECT page_id, tag_id, ai_generated, created_at
         FROM page_tags WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedPageTag[]

    const noteTags = this.db
      .prepare(
        `SELECT note_id, tag_id, ai_generated, created_at
         FROM note_tags WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .all(workspaceId) as ExportedNoteTag[]

    return {
      version: WORKSPACE_EXPORT_VERSION,
      schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
      exportedAt: Date.now(),
      workspace: {
        id: ws.id,
        name: ws.name,
        icon: ws.icon,
        created_at: ws.created_at,
        level_preference: ws.level_preference
      },
      pages,
      visits,
      notes,
      aiChatHistory,
      tags,
      pageTags,
      noteTags
    }
  }

  /**
   * JSON 을 새 워크스페이스로 import.
   *
   * 정책:
   *   - 항상 새 workspace id 발급 (workspaces.id 충돌 회피)
   *   - 모든 child id (page/visit/note/tag) 도 새로 발급 + 참조 재매핑
   *   - ai_chat_history.retrieved_items / chat_meta 안의 page_id / visit_id / note_id 도 재매핑
   *   - 단일 TX (BEGIN ... COMMIT) — 부분 import 실패 시 rollback
   *   - vec_pages / vec_notes 미생성 (caller 가 embedding_queue 재 enqueue, KI-022 후보)
   *
   * 검증 실패 시:
   *   - version 외 값 → `invalid_version`
   *   - schemaVersion 외 값 → `unsupported_schema_version`
   *   - workspace 필드 missing → `invalid_export_schema`
   */
  importWorkspace(payload: unknown): ImportResultSummary {
    const data = this.validatePayload(payload)
    const now = Date.now()

    // 새 id 매핑 테이블 — codex BLOCKING #2 hotfix:
    //   pageIdMap / tagIdMap 은 사전 (모든 row 가 INSERT 됨 확정).
    //   visitIdMap / noteIdMap 은 INSERT 성공한 row 만 박힘 (dangling 참조 graceful).
    //   skipped visit / note 의 id 가 chat retrieved_items / chat_meta 에 등장하면 매핑 없음 → null 박힘.
    const newWorkspaceId = randomUUID()
    const pageIdMap = new Map<string, string>()
    const visitIdMap = new Map<string, string>()
    const noteIdMap = new Map<string, string>()
    const tagIdMap = new Map<string, string>()
    for (const p of data.pages) pageIdMap.set(p.id, randomUUID())
    for (const t of data.tags) tagIdMap.set(t.id, randomUUID())
    // visitIdMap / noteIdMap 은 실제 INSERT 시점에 박힘 (skip 정합)

    const insertWs = this.db.prepare(
      `INSERT INTO workspaces(id, name, icon, created_at, level_preference) VALUES (?, ?, ?, ?, ?)`
    )
    const insertPage = this.db.prepare(
      `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertVisit = this.db.prepare(
      `INSERT INTO visits(id, page_id, workspace_id, visited_at, dwell_ms) VALUES (?, ?, ?, ?, ?)`
    )
    const insertNote = this.db.prepare(
      `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertChat = this.db.prepare(
      `INSERT INTO ai_chat_history(id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertTag = this.db.prepare(
      `INSERT INTO tags(id, workspace_id, name, kind, ai_generated, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const insertPageTag = this.db.prepare(
      `INSERT INTO page_tags(page_id, tag_id, workspace_id, ai_generated, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    const insertNoteTag = this.db.prepare(
      `INSERT INTO note_tags(note_id, tag_id, workspace_id, ai_generated, created_at) VALUES (?, ?, ?, ?, ?)`
    )

    // codex NEEDS_CHANGES #1 hotfix — 실제 INSERT 된 row 카운트 (입력 length X)
    const counts = {
      pages: 0,
      visits: 0,
      notes: 0,
      aiChatHistory: 0,
      tags: 0,
      pageTags: 0,
      noteTags: 0
    }

    const tx = this.db.transaction((): ImportResultSummary => {
      insertWs.run(
        newWorkspaceId,
        data.workspace.name,
        data.workspace.icon,
        now,
        data.workspace.level_preference
      )

      for (const p of data.pages) {
        insertPage.run(
          pageIdMap.get(p.id)!,
          newWorkspaceId,
          p.url,
          p.title,
          p.content,
          p.content_hash,
          p.lang,
          p.visited_count,
          p.created_at,
          p.updated_at
        )
        counts.pages++
      }

      for (const v of data.visits) {
        const newPageId = pageIdMap.get(v.page_id)
        if (!newPageId) continue // codex BLOCKING #2 hotfix — pageIdMap 누락이면 visit skip (visitIdMap 박지 않음)
        const newVisitId = randomUUID()
        insertVisit.run(newVisitId, newPageId, newWorkspaceId, v.visited_at, v.dwell_ms)
        visitIdMap.set(v.id, newVisitId)
        counts.visits++
      }

      for (const n of data.notes) {
        const newPageId = n.page_id ? pageIdMap.get(n.page_id) ?? null : null
        // codex BLOCKING #2 hotfix — skipped visit 참조면 null (FK 위반 방지)
        const newVisitId = n.visit_id ? visitIdMap.get(n.visit_id) ?? null : null
        const newNoteId = randomUUID()
        insertNote.run(
          newNoteId,
          newPageId,
          newVisitId,
          newWorkspaceId,
          n.selected_text,
          n.body,
          n.ai_tags,
          n.created_at,
          n.created_by
        )
        noteIdMap.set(n.id, newNoteId)
        counts.notes++
      }

      for (const c of data.aiChatHistory) {
        const newPageId = c.page_id ? pageIdMap.get(c.page_id) ?? null : null
        const newVisitId = c.visit_id ? visitIdMap.get(c.visit_id) ?? null : null
        // retrieved_items / chat_meta 안의 page_id / visit_id / note_id 참조 rewrite.
        // codex BLOCKING #2 hotfix — 매핑 없는 visit_id / note_id 는 null 로 박음 (dangling 제거).
        const remappedRetrieved = remapJsonIds(c.retrieved_items, pageIdMap, visitIdMap, noteIdMap)
        const remappedChatMeta = remapJsonIds(c.chat_meta, pageIdMap, visitIdMap, noteIdMap)
        insertChat.run(
          randomUUID(),
          newWorkspaceId,
          newPageId,
          newVisitId,
          c.role,
          c.content,
          remappedRetrieved,
          remappedChatMeta,
          c.status,
          c.created_at
        )
        counts.aiChatHistory++
      }

      for (const t of data.tags) {
        insertTag.run(
          tagIdMap.get(t.id)!,
          newWorkspaceId,
          t.name,
          t.kind,
          t.ai_generated,
          t.created_at
        )
        counts.tags++
      }

      for (const pt of data.pageTags) {
        const newPageId = pageIdMap.get(pt.page_id)
        const newTagId = tagIdMap.get(pt.tag_id)
        if (!newPageId || !newTagId) continue
        insertPageTag.run(newPageId, newTagId, newWorkspaceId, pt.ai_generated, pt.created_at)
        counts.pageTags++
      }

      for (const nt of data.noteTags) {
        const newNoteId = noteIdMap.get(nt.note_id)
        const newTagId = tagIdMap.get(nt.tag_id)
        if (!newNoteId || !newTagId) continue
        insertNoteTag.run(newNoteId, newTagId, newWorkspaceId, nt.ai_generated, nt.created_at)
        counts.noteTags++
      }

      return {
        workspaceId: newWorkspaceId,
        pages: counts.pages,
        visits: counts.visits,
        notes: counts.notes,
        aiChatHistory: counts.aiChatHistory,
        tags: counts.tags,
        pageTags: counts.pageTags,
        noteTags: counts.noteTags
      }
    })

    return tx()
  }

  private validatePayload(raw: unknown): WorkspaceExportV1 {
    if (raw === null || typeof raw !== 'object') {
      throw new WorkspaceExportImportError('invalid_export_schema', 'payload must be an object')
    }
    const obj = raw as Record<string, unknown>
    if (obj.version !== WORKSPACE_EXPORT_VERSION) {
      throw new WorkspaceExportImportError('invalid_version', `version=${obj.version}`)
    }
    if (obj.schemaVersion !== WORKSPACE_EXPORT_SCHEMA_VERSION) {
      throw new WorkspaceExportImportError(
        'unsupported_schema_version',
        `schemaVersion=${obj.schemaVersion}`
      )
    }
    if (!obj.workspace || typeof obj.workspace !== 'object') {
      throw new WorkspaceExportImportError('invalid_export_schema', 'workspace required')
    }
    const ws = obj.workspace as Record<string, unknown>
    if (typeof ws.name !== 'string' || typeof ws.icon !== 'string') {
      throw new WorkspaceExportImportError('invalid_export_schema', 'workspace.name/icon required')
    }
    // child arrays default to empty array (forward-compat)
    const data: WorkspaceExportV1 = {
      version: WORKSPACE_EXPORT_VERSION,
      schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
      workspace: {
        id: typeof ws.id === 'string' ? ws.id : '',
        name: ws.name,
        icon: ws.icon,
        created_at: typeof ws.created_at === 'number' ? ws.created_at : Date.now(),
        level_preference: (ws.level_preference ?? null) as WorkspaceRow['level_preference']
      },
      pages: (Array.isArray(obj.pages) ? obj.pages : []) as ExportedPage[],
      visits: (Array.isArray(obj.visits) ? obj.visits : []) as ExportedVisit[],
      notes: (Array.isArray(obj.notes) ? obj.notes : []) as ExportedNote[],
      aiChatHistory: (Array.isArray(obj.aiChatHistory)
        ? obj.aiChatHistory
        : []) as ExportedAiChatHistory[],
      tags: (Array.isArray(obj.tags) ? obj.tags : []) as ExportedTag[],
      pageTags: (Array.isArray(obj.pageTags) ? obj.pageTags : []) as ExportedPageTag[],
      noteTags: (Array.isArray(obj.noteTags) ? obj.noteTags : []) as ExportedNoteTag[]
    }
    return data
  }
}

/**
 * JSON 문자열 안의 page_id / visit_id / note_id 참조를 매핑 테이블 기준으로 rewrite.
 *
 * 정책:
 *   - null/빈 문자열 → null
 *   - 파싱 실패 → 원본 그대로 (graceful)
 *   - 매핑 없는 id → 원본 id 그대로 (dangling 참조 — Import 후 사용자가 확인)
 */
function remapJsonIds(
  raw: string | null,
  pageIdMap: Map<string, string>,
  visitIdMap: Map<string, string>,
  noteIdMap: Map<string, string>
): string | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw // graceful fallback
  }
  const remapped = remapValue(parsed, pageIdMap, visitIdMap, noteIdMap)
  return JSON.stringify(remapped)
}

function remapValue(
  v: unknown,
  pageIdMap: Map<string, string>,
  visitIdMap: Map<string, string>,
  noteIdMap: Map<string, string>
): unknown {
  if (v === null) return null
  if (Array.isArray(v)) {
    return v.map((item) => remapValue(item, pageIdMap, visitIdMap, noteIdMap))
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    // RetrievedItem 패턴 — {type: 'page'|'note', id: string, ...} 의 `id` 필드는
    // type 기반으로 pageIdMap / noteIdMap rewrite. AiChatHistoryStore.RetrievedItem 정합.
    // codex BLOCKING #2 hotfix — 매핑 없는 참조는 null 박음 (dangling 제거).
    //   page_id / visit_id / note_id 모두 매핑 누락이면 null (원본 id 유지 X — re-import 시 dangling 확장 방지).
    //   ai_chat_history.retrieved_items 의 RetrievedItem.id (type='page'/'note') 도 동일 정책.
    const objType = obj.type
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(obj)) {
      if (k === 'page_id' && typeof val === 'string') {
        out[k] = pageIdMap.get(val) ?? null
      } else if (k === 'visit_id' && typeof val === 'string') {
        out[k] = visitIdMap.get(val) ?? null
      } else if (k === 'note_id' && typeof val === 'string') {
        out[k] = noteIdMap.get(val) ?? null
      } else if (k === 'id' && typeof val === 'string' && objType === 'page') {
        out[k] = pageIdMap.get(val) ?? null
      } else if (k === 'id' && typeof val === 'string' && objType === 'note') {
        out[k] = noteIdMap.get(val) ?? null
      } else {
        out[k] = remapValue(val, pageIdMap, visitIdMap, noteIdMap)
      }
    }
    return out
  }
  return v
}
