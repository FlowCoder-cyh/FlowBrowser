/**
 * Sprint 015 M3-4 — NoteStore (SQLite).
 *
 * PRD §04.3.4 Note 엔티티 CRUD wrapper.
 *
 * 3중 anchor: page_id (nullable) + visit_id (nullable) + workspace_id (NOT NULL).
 * - 정상 노트: page_id + visit_id + workspace_id 모두 박힘 (선택 텍스트 → 노트)
 * - Glossary 마이그레이션: page_id + visit_id NULL, workspace_id "📥 기본" (PRD §19.4)
 *
 * created_by: 'user' (사용자 직접) / 'migration' (v0.3 Glossary 자동 이전).
 * ai_tags: JSON array (예: `["glossary", "topic:CAR-T", "domain:medicine"]`).
 *
 * 후속 PR 의존:
 *   - M3-5 EmbeddingClient — 노트 본문 임베딩 → VectorIndex.upsertNoteEmbedding
 *   - M3-6 migrations — v0.3 Glossary → 본 모듈 자동 이전
 *   - M5 NoteService + NotePanel — 선택 텍스트 → 본 모듈 + AI 자동 태그
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

export type NoteCreatedBy = 'user' | 'migration'

export interface NoteRow {
  id: string
  page_id: string | null
  visit_id: string | null
  workspace_id: string
  selected_text: string
  body: string | null
  ai_tags: string[] | null
  created_at: number
  created_by: NoteCreatedBy
}

interface NoteRowRaw {
  id: string
  page_id: string | null
  visit_id: string | null
  workspace_id: string
  selected_text: string
  body: string | null
  ai_tags: string | null
  created_at: number
  created_by: NoteCreatedBy
}

export interface CreateNoteInput {
  workspace_id: string
  selected_text: string
  page_id?: string | null
  visit_id?: string | null
  body?: string | null
  ai_tags?: string[] | null
  created_by?: NoteCreatedBy
  id?: string
  created_at?: number
}

export interface UpdateNoteInput {
  id: string
  body?: string | null
  ai_tags?: string[] | null
}

export class NoteStore {
  private readonly db: BetterSqliteNamespace.Database
  private readonly stmtInsert: Stmt
  private readonly stmtFindById: Stmt<NoteRowRaw>
  private readonly stmtListByWorkspace: Stmt<NoteRowRaw>
  private readonly stmtListByPage: Stmt<NoteRowRaw>
  private readonly stmtUpdate: Stmt
  private readonly stmtDelete: Stmt
  private readonly stmtCountByWorkspace: Stmt<{ c: number }>

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    this.stmtInsert = this.db.prepare(
      `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.stmtFindById = this.db.prepare(
      `SELECT id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by
       FROM notes WHERE id = ?`
    )
    this.stmtListByWorkspace = this.db.prepare(
      `SELECT id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by
       FROM notes WHERE workspace_id = ? ORDER BY created_at DESC`
    )
    this.stmtListByPage = this.db.prepare(
      `SELECT id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by
       FROM notes WHERE page_id = ? ORDER BY created_at ASC`
    )
    this.stmtUpdate = this.db.prepare(
      `UPDATE notes SET body = ?, ai_tags = ? WHERE id = ?`
    )
    this.stmtDelete = this.db.prepare('DELETE FROM notes WHERE id = ?')
    this.stmtCountByWorkspace = this.db.prepare(
      'SELECT COUNT(*) AS c FROM notes WHERE workspace_id = ?'
    )
  }

  create(input: CreateNoteInput): NoteRow {
    if (!input.workspace_id) throw new Error('NoteStore.create: workspace_id required')
    if (!input.selected_text) throw new Error('NoteStore.create: selected_text required')
    const row: NoteRow = {
      id: input.id ?? randomUUID(),
      page_id: input.page_id ?? null,
      visit_id: input.visit_id ?? null,
      workspace_id: input.workspace_id,
      selected_text: input.selected_text,
      body: input.body ?? null,
      ai_tags: input.ai_tags ?? null,
      created_at: input.created_at ?? Date.now(),
      created_by: input.created_by ?? 'user'
    }
    this.stmtInsert.run(
      row.id,
      row.page_id,
      row.visit_id,
      row.workspace_id,
      row.selected_text,
      row.body,
      row.ai_tags === null ? null : JSON.stringify(row.ai_tags),
      row.created_at,
      row.created_by
    )
    return row
  }

  findById(id: string): NoteRow | null {
    const raw = this.stmtFindById.get(id)
    return raw ? rawToNote(raw) : null
  }

  listByWorkspace(workspace_id: string): NoteRow[] {
    return this.stmtListByWorkspace.all(workspace_id).map(rawToNote)
  }

  listByPage(page_id: string): NoteRow[] {
    return this.stmtListByPage.all(page_id).map(rawToNote)
  }

  /**
   * 부분 업데이트 — body 또는 ai_tags 만 변경 가능. selected_text 는 immutable.
   * 두 필드 모두 입력 가능 (둘 다 변경) — 입력되지 않은 필드는 기존 값 유지.
   */
  update(input: UpdateNoteInput): NoteRow {
    const existing = this.findById(input.id)
    if (!existing) throw new Error(`NoteStore.update: not found id=${input.id}`)
    const nextBody = input.body === undefined ? existing.body : input.body
    const nextTags = input.ai_tags === undefined ? existing.ai_tags : input.ai_tags
    this.stmtUpdate.run(
      nextBody,
      nextTags === null ? null : JSON.stringify(nextTags),
      input.id
    )
    return { ...existing, body: nextBody, ai_tags: nextTags }
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0
  }

  countByWorkspace(workspace_id: string): number {
    return this.stmtCountByWorkspace.get(workspace_id)!.c
  }
}

function rawToNote(r: NoteRowRaw): NoteRow {
  let tags: string[] | null = null
  if (r.ai_tags !== null) {
    try {
      const parsed = JSON.parse(r.ai_tags)
      if (Array.isArray(parsed)) tags = parsed.map(String)
    } catch {
      tags = null
    }
  }
  return {
    id: r.id,
    page_id: r.page_id,
    visit_id: r.visit_id,
    workspace_id: r.workspace_id,
    selected_text: r.selected_text,
    body: r.body,
    ai_tags: tags,
    created_at: r.created_at,
    created_by: r.created_by
  }
}
