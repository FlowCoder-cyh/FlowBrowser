/**
 * Sprint 015 M3-4 — AiChatHistoryStore (SQLite).
 *
 * PRD §04.3.5 "AI 메모" 엔티티 CRUD.
 *
 * role: 'user' / 'assistant' / 'system' / 'error'
 *   - 'error' = Provider 호출 실패 시 시스템 메시지
 * status: 'ok' (디폴트) / 'pending' (진행 중) / 'failed' / 'aborted'
 *
 * anchor: workspace_id (NOT NULL) + page_id (nullable) + visit_id (nullable).
 *   - 워크스페이스 단독 대화 가능 (페이지 컨텍스트 없이)
 *
 * retrieved_items: JSON `[{type: 'page'|'note', id, page_id, visit_id?}]`
 * chat_meta: JSON `{rows, columns, cells: [{value, sources: [...]}]}`
 *
 * 후속 PR 의존:
 *   - M5 ChatService — 사용자 입력 → user 메시지 INSERT → assistant 응답 INSERT
 *   - M5 ChatPanel — listByWorkspace + 출처 셀 클릭 복원
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

export type ChatRole = 'user' | 'assistant' | 'system' | 'error'
export type ChatStatus = 'ok' | 'pending' | 'failed' | 'aborted'

export interface RetrievedItem {
  type: 'page' | 'note'
  id: string
  page_id?: string
  visit_id?: string
}

export interface ChatRow {
  id: string
  workspace_id: string
  page_id: string | null
  visit_id: string | null
  role: ChatRole
  content: string
  retrieved_items: RetrievedItem[] | null
  chat_meta: unknown | null
  status: ChatStatus
  created_at: number
}

interface ChatRowRaw {
  id: string
  workspace_id: string
  page_id: string | null
  visit_id: string | null
  role: ChatRole
  content: string
  retrieved_items: string | null
  chat_meta: string | null
  status: ChatStatus
  created_at: number
}

export interface CreateChatInput {
  workspace_id: string
  role: ChatRole
  content: string
  page_id?: string | null
  visit_id?: string | null
  retrieved_items?: RetrievedItem[] | null
  chat_meta?: unknown | null
  status?: ChatStatus
  id?: string
  created_at?: number
}

export interface UpdateChatStatusInput {
  id: string
  status: ChatStatus
  content?: string // 'failed' 시 에러 메시지 갱신
  chat_meta?: unknown | null
  retrieved_items?: RetrievedItem[] | null
}

export class AiChatHistoryStore {
  private readonly db: BetterSqliteNamespace.Database
  private readonly stmtInsert: Stmt
  private readonly stmtFindById: Stmt<ChatRowRaw>
  private readonly stmtListByWorkspace: Stmt<ChatRowRaw>
  private readonly stmtListByPage: Stmt<ChatRowRaw>
  private readonly stmtUpdateStatus: Stmt
  private readonly stmtDelete: Stmt
  private readonly stmtCountByWorkspace: Stmt<{ c: number }>

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    this.stmtInsert = this.db.prepare(
      `INSERT INTO ai_chat_history(id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.stmtFindById = this.db.prepare(
      `SELECT id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at
       FROM ai_chat_history WHERE id = ?`
    )
    this.stmtListByWorkspace = this.db.prepare(
      `SELECT id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at
       FROM ai_chat_history WHERE workspace_id = ? ORDER BY created_at ASC`
    )
    this.stmtListByPage = this.db.prepare(
      `SELECT id, workspace_id, page_id, visit_id, role, content, retrieved_items, chat_meta, status, created_at
       FROM ai_chat_history WHERE page_id = ? ORDER BY created_at ASC`
    )
    this.stmtUpdateStatus = this.db.prepare(
      `UPDATE ai_chat_history
       SET status = ?,
           content = COALESCE(?, content),
           chat_meta = ?,
           retrieved_items = ?
       WHERE id = ?`
    )
    this.stmtDelete = this.db.prepare('DELETE FROM ai_chat_history WHERE id = ?')
    this.stmtCountByWorkspace = this.db.prepare(
      'SELECT COUNT(*) AS c FROM ai_chat_history WHERE workspace_id = ?'
    )
  }

  create(input: CreateChatInput): ChatRow {
    if (!input.workspace_id) throw new Error('AiChatHistoryStore.create: workspace_id required')
    if (!input.content) throw new Error('AiChatHistoryStore.create: content required')
    const row: ChatRow = {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspace_id,
      page_id: input.page_id ?? null,
      visit_id: input.visit_id ?? null,
      role: input.role,
      content: input.content,
      retrieved_items: input.retrieved_items ?? null,
      chat_meta: input.chat_meta ?? null,
      status: input.status ?? 'ok',
      created_at: input.created_at ?? Date.now()
    }
    this.stmtInsert.run(
      row.id,
      row.workspace_id,
      row.page_id,
      row.visit_id,
      row.role,
      row.content,
      row.retrieved_items === null ? null : JSON.stringify(row.retrieved_items),
      row.chat_meta === null ? null : JSON.stringify(row.chat_meta),
      row.status,
      row.created_at
    )
    return row
  }

  findById(id: string): ChatRow | null {
    const raw = this.stmtFindById.get(id)
    return raw ? rawToChat(raw) : null
  }

  listByWorkspace(workspace_id: string): ChatRow[] {
    return this.stmtListByWorkspace.all(workspace_id).map(rawToChat)
  }

  listByPage(page_id: string): ChatRow[] {
    return this.stmtListByPage.all(page_id).map(rawToChat)
  }

  /**
   * 응답 상태 / 본문 / 메타 갱신. 'pending' → 'ok' (정상 완료) / 'failed' (에러) / 'aborted' (사용자 abort).
   */
  updateStatus(input: UpdateChatStatusInput): ChatRow {
    const existing = this.findById(input.id)
    if (!existing) throw new Error(`AiChatHistoryStore.updateStatus: not found id=${input.id}`)
    const nextContent = input.content === undefined ? null : input.content
    const nextMeta =
      input.chat_meta === undefined ? existing.chat_meta : input.chat_meta
    const nextItems =
      input.retrieved_items === undefined ? existing.retrieved_items : input.retrieved_items
    this.stmtUpdateStatus.run(
      input.status,
      nextContent,
      nextMeta === null ? null : JSON.stringify(nextMeta),
      nextItems === null ? null : JSON.stringify(nextItems),
      input.id
    )
    return this.findById(input.id)!
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0
  }

  countByWorkspace(workspace_id: string): number {
    return this.stmtCountByWorkspace.get(workspace_id)!.c
  }
}

function rawToChat(r: ChatRowRaw): ChatRow {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    page_id: r.page_id,
    visit_id: r.visit_id,
    role: r.role,
    content: r.content,
    retrieved_items: parseJson<RetrievedItem[]>(r.retrieved_items),
    chat_meta: parseJson<unknown>(r.chat_meta),
    status: r.status,
    created_at: r.created_at
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
