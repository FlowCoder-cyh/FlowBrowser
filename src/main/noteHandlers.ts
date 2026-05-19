/**
 * Sprint 015 M5-7 — note IPC handler pure logic.
 *
 * `services.ts` 의 `note:create` / `note:list` / `note:delete` IPC handler 를 pure 함수로 추출.
 * 단위 테스트 가능 — Electron `ipcMain` 의존 없음.
 *
 * 책임:
 *   1. handleNoteCreate — NoteService.createNote → SerializedNoteRow
 *   2. handleNoteList — workspace 별 list → SerializedNoteRow[]
 *   3. handleNoteDelete — boolean
 *
 * 의존 주입 — 호출자 (services.ts) 가 NoteService 와 active workspace id 를 lazy resolver 로 주입.
 * 인프라 미초기화 시 graceful error 반환.
 */

import type { NoteService } from './NoteService'
import type { NoteRow } from '../storage/NoteStore'

export interface SerializedNoteRow {
  id: string
  workspaceId: string
  pageId: string | null
  visitId: string | null
  selectedText: string
  body: string | null
  aiTags: string[] | null
  createdAt: number
  createdBy: 'user' | 'migration'
}

export interface NoteCreateArgs {
  workspaceId?: string
  selectedText: string
  pageId?: string | null
  visitId?: string | null
  body?: string | null
  initialTags?: string[]
  enableAutoTagging?: boolean
}

export interface NoteCreateResponse {
  ok: boolean
  note?: SerializedNoteRow
  embeddingJobId?: string
  autoTaggingStatus?: 'tagged' | 'skipped' | 'failed' | 'not_called'
  error?: string
  errorCode?: 'invalid_input' | 'infra_unavailable'
}

export interface NoteHandlersDeps {
  getActiveWorkspaceId(): string | null
  getNoteService(): NoteService | null
}

export async function handleNoteCreate(
  args: NoteCreateArgs,
  deps: NoteHandlersDeps
): Promise<NoteCreateResponse> {
  const selectedText = args.selectedText?.trim() ?? ''
  if (selectedText.length === 0) {
    return { ok: false, error: '선택 텍스트가 비어 있습니다.', errorCode: 'invalid_input' }
  }
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) {
    return { ok: false, error: '워크스페이스가 초기화되지 않았습니다.', errorCode: 'invalid_input' }
  }
  const service = deps.getNoteService()
  if (!service) {
    return {
      ok: false,
      error: '노트 인프라가 아직 준비되지 않았습니다.',
      errorCode: 'infra_unavailable'
    }
  }
  const result = await service.createNote({
    workspaceId,
    selectedText,
    pageId: args.pageId,
    visitId: args.visitId,
    body: args.body,
    initialTags: args.initialTags,
    enableAutoTagging: args.enableAutoTagging
  })
  return {
    ok: true,
    note: toSerialized(result.note),
    embeddingJobId: result.embeddingJobId,
    autoTaggingStatus: result.autoTaggingStatus
  }
}

export interface NoteListArgs {
  workspaceId?: string
}

export interface NoteListResponse {
  notes: SerializedNoteRow[]
}

export function handleNoteList(args: NoteListArgs, deps: NoteHandlersDeps): NoteListResponse {
  const service = deps.getNoteService()
  if (!service) return { notes: [] }
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) return { notes: [] }
  const rows = service.listNotes(workspaceId)
  return { notes: rows.map(toSerialized) }
}

export interface NoteDeleteArgs {
  id: string
}

export interface NoteDeleteResponse {
  ok: boolean
}

export function handleNoteDelete(args: NoteDeleteArgs, deps: NoteHandlersDeps): NoteDeleteResponse {
  const service = deps.getNoteService()
  if (!service) return { ok: false }
  if (!args.id) return { ok: false }
  const removed = service.deleteNote(args.id)
  return { ok: removed }
}

function toSerialized(row: NoteRow): SerializedNoteRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    visitId: row.visit_id,
    selectedText: row.selected_text,
    body: row.body,
    aiTags: row.ai_tags,
    createdAt: row.created_at,
    createdBy: row.created_by
  }
}
