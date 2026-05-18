/**
 * Sprint 015 M3-4 — TagStore (SQLite).
 *
 * PRD §04.3.6 Tag 엔티티 + §04.3.7 PageTag / NoteTag M:N CRUD.
 *
 * kind: 6종 — topic / entity / metric / sentiment / domain / freeform.
 * UNIQUE: (workspace_id, kind, name) — 같은 워크스페이스 내 같은 kind+name 중복 차단.
 *
 * ai_generated: AutoTagger 자동 vs 사용자 수동.
 *
 * 후속 PR 의존:
 *   - M4 AutoTagger — 자동 태깅 결과 → 본 모듈 ensureTag + attachToPage/Note
 *   - M5 NoteService — 사용자 수동 태그
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

export type TagKind = 'topic' | 'entity' | 'metric' | 'sentiment' | 'domain' | 'freeform'

export const TAG_KINDS: readonly TagKind[] = [
  'topic',
  'entity',
  'metric',
  'sentiment',
  'domain',
  'freeform'
] as const

export interface TagRow {
  id: string
  workspace_id: string
  name: string
  kind: TagKind
  ai_generated: boolean
  created_at: number
}

interface TagRowRaw {
  id: string
  workspace_id: string
  name: string
  kind: TagKind
  ai_generated: number // SQLite boolean as 0/1
  created_at: number
}

export interface EnsureTagInput {
  workspace_id: string
  name: string
  kind: TagKind
  ai_generated?: boolean
}

export interface AttachInput {
  /** 워크스페이스 (page / note 와 정합) */
  workspace_id: string
  tag_id: string
  ai_generated?: boolean
}

export class TagStore {
  private readonly db: BetterSqliteNamespace.Database
  private readonly stmtFindByUnique: Stmt<TagRowRaw>
  private readonly stmtFindById: Stmt<TagRowRaw>
  private readonly stmtInsertTag: Stmt
  private readonly stmtListByWorkspace: Stmt<TagRowRaw>
  private readonly stmtDeleteTag: Stmt
  private readonly stmtInsertPageTag: Stmt
  private readonly stmtInsertNoteTag: Stmt
  private readonly stmtListPageTags: Stmt<TagRowRaw>
  private readonly stmtListNoteTags: Stmt<TagRowRaw>
  private readonly stmtDetachPageTag: Stmt
  private readonly stmtDetachNoteTag: Stmt

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    this.stmtFindByUnique = this.db.prepare(
      `SELECT id, workspace_id, name, kind, ai_generated, created_at
       FROM tags WHERE workspace_id = ? AND kind = ? AND name = ?`
    )
    this.stmtFindById = this.db.prepare(
      `SELECT id, workspace_id, name, kind, ai_generated, created_at FROM tags WHERE id = ?`
    )
    this.stmtInsertTag = this.db.prepare(
      `INSERT INTO tags(id, workspace_id, name, kind, ai_generated, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    this.stmtListByWorkspace = this.db.prepare(
      `SELECT id, workspace_id, name, kind, ai_generated, created_at
       FROM tags WHERE workspace_id = ? ORDER BY kind ASC, name ASC`
    )
    this.stmtDeleteTag = this.db.prepare('DELETE FROM tags WHERE id = ?')
    this.stmtInsertPageTag = this.db.prepare(
      `INSERT OR IGNORE INTO page_tags(page_id, tag_id, workspace_id, ai_generated, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    this.stmtInsertNoteTag = this.db.prepare(
      `INSERT OR IGNORE INTO note_tags(note_id, tag_id, workspace_id, ai_generated, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    this.stmtListPageTags = this.db.prepare(
      `SELECT t.id, t.workspace_id, t.name, t.kind, t.ai_generated, t.created_at
       FROM tags t INNER JOIN page_tags pt ON pt.tag_id = t.id
       WHERE pt.page_id = ?
       ORDER BY t.kind ASC, t.name ASC`
    )
    this.stmtListNoteTags = this.db.prepare(
      `SELECT t.id, t.workspace_id, t.name, t.kind, t.ai_generated, t.created_at
       FROM tags t INNER JOIN note_tags nt ON nt.tag_id = t.id
       WHERE nt.note_id = ?
       ORDER BY t.kind ASC, t.name ASC`
    )
    this.stmtDetachPageTag = this.db.prepare(
      'DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?'
    )
    this.stmtDetachNoteTag = this.db.prepare(
      'DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?'
    )
  }

  /**
   * 태그 (workspace, kind, name) 단위 lookup / 없으면 생성 (idempotent).
   * 이미 존재하면 그대로 반환 — ai_generated 는 첫 등록 값 유지 (이후 수정 X — PRD §04.3.6 정합).
   */
  ensureTag(input: EnsureTagInput): TagRow {
    if (!TAG_KINDS.includes(input.kind)) {
      throw new Error(`TagStore.ensureTag: invalid kind=${input.kind}`)
    }
    if (!input.name) throw new Error('TagStore.ensureTag: name required')
    const existing = this.stmtFindByUnique.get(input.workspace_id, input.kind, input.name)
    if (existing) return rawToTag(existing)
    const row: TagRow = {
      id: randomUUID(),
      workspace_id: input.workspace_id,
      name: input.name,
      kind: input.kind,
      ai_generated: input.ai_generated ?? false,
      created_at: Date.now()
    }
    this.stmtInsertTag.run(
      row.id,
      row.workspace_id,
      row.name,
      row.kind,
      row.ai_generated ? 1 : 0,
      row.created_at
    )
    return row
  }

  findById(id: string): TagRow | null {
    const raw = this.stmtFindById.get(id)
    return raw ? rawToTag(raw) : null
  }

  listByWorkspace(workspace_id: string): TagRow[] {
    return this.stmtListByWorkspace.all(workspace_id).map(rawToTag)
  }

  deleteTag(id: string): boolean {
    return this.stmtDeleteTag.run(id).changes > 0
  }

  /** PageTag M:N. 동일 (page_id, tag_id) 중복 시 IGNORE (idempotent). */
  attachToPage(page_id: string, input: AttachInput): void {
    this.stmtInsertPageTag.run(
      page_id,
      input.tag_id,
      input.workspace_id,
      input.ai_generated ? 1 : 0,
      Date.now()
    )
  }

  /** NoteTag M:N. 동일 (note_id, tag_id) 중복 시 IGNORE. */
  attachToNote(note_id: string, input: AttachInput): void {
    this.stmtInsertNoteTag.run(
      note_id,
      input.tag_id,
      input.workspace_id,
      input.ai_generated ? 1 : 0,
      Date.now()
    )
  }

  listPageTags(page_id: string): TagRow[] {
    return this.stmtListPageTags.all(page_id).map(rawToTag)
  }

  listNoteTags(note_id: string): TagRow[] {
    return this.stmtListNoteTags.all(note_id).map(rawToTag)
  }

  detachFromPage(page_id: string, tag_id: string): boolean {
    return this.stmtDetachPageTag.run(page_id, tag_id).changes > 0
  }

  detachFromNote(note_id: string, tag_id: string): boolean {
    return this.stmtDetachNoteTag.run(note_id, tag_id).changes > 0
  }
}

function rawToTag(r: TagRowRaw): TagRow {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    kind: r.kind,
    ai_generated: r.ai_generated === 1,
    created_at: r.created_at
  }
}
