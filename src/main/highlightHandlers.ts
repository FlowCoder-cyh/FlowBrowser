/**
 * Sprint 017 M1 T06 — highlight IPC handler pure logic.
 *
 * `services.ts` 의 `highlight:create` / `highlight:list-by-page` / `highlight:list-by-note` /
 * `highlight:remove` IPC handler 를 pure 함수로 추출. 단위 테스트 가능 — Electron `ipcMain` 의존 없음.
 *
 * 책임:
 *   1. handleHighlightCreate — NoteService.createNote 동반 호출 + HighlightStore.add (composite).
 *      noteId 명시 시 기존 노트에 highlight 추가, 미명시 시 selectedText 로 새 노트 생성.
 *   2. handleHighlightListByPage — workspaceId + (pageId 또는 url+contentHash) 필터로 list.
 *   3. handleHighlightListByNote — 단일 노트의 모든 highlight (1:N).
 *   4. handleHighlightRemove — id 로 삭제.
 *
 * 의존 주입 — 호출자 (services.ts) 가 HighlightStore / NoteService / active workspace id 를
 * lazy resolver 로 주입. 인프라 미초기화 시 graceful error 반환.
 *
 * codex 사전 협의 (2026-05-22, threadId 019e4b75) 정합 — IPC 4종 + composite create.
 */

import type { HighlightRecord, HighlightStore } from '../storage/HighlightStore'
import type { HighlightAnchor } from '../perception/highlightAnchor'
import type { NoteService } from './NoteService'
import type { NoteRow } from '../storage/NoteStore'
import { normalizeOptionalId } from '../storage/idNormalize'

export interface SerializedHighlightRecord {
  id: string
  noteId: string
  pageId: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchor
  workspaceId: string
  createdAt: number
}

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

export interface HighlightCreateArgs {
  workspaceId?: string
  /** 명시 시 기존 노트에 highlight 만 추가. 미명시 시 selectedText 로 신규 노트 + highlight composite. */
  noteId?: string
  /** anchor 의 selectedText 가 본 필드의 fallback. 신규 노트 분기 시 필수. */
  selectedText?: string
  pageId?: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchor
  body?: string | null
}

export interface HighlightCreateResponse {
  ok: boolean
  highlight?: SerializedHighlightRecord
  /** 신규 노트 생성 시점에만 반환. 기존 noteId 분기에서는 미반환. */
  note?: SerializedNoteRow
  error?: string
  errorCode?:
    | 'invalid_input'
    | 'infra_unavailable'
    | 'note_not_found'
    | 'duplicate_id'
}

export interface HighlightListByPageArgs {
  workspaceId?: string
  pageId?: string | null
  url?: string
  contentHash?: string
}

export interface HighlightListResponse {
  highlights: SerializedHighlightRecord[]
}

export interface HighlightListByNoteArgs {
  noteId: string
}

export interface HighlightRemoveArgs {
  id: string
}

export interface HighlightRemoveResponse {
  ok: boolean
}

export interface HighlightHandlersDeps {
  getActiveWorkspaceId(): string | null
  getHighlightStore(): HighlightStore | null
  getNoteService(): NoteService | null
}

export async function handleHighlightCreate(
  args: HighlightCreateArgs,
  deps: HighlightHandlersDeps
): Promise<HighlightCreateResponse> {
  if (!args.url) {
    return { ok: false, error: 'url 이 비어 있습니다.', errorCode: 'invalid_input' }
  }
  if (!args.contentHash) {
    return { ok: false, error: 'contentHash 가 비어 있습니다.', errorCode: 'invalid_input' }
  }
  if (!args.anchor) {
    return { ok: false, error: 'anchor 가 비어 있습니다.', errorCode: 'invalid_input' }
  }
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) {
    return {
      ok: false,
      error: '워크스페이스가 초기화되지 않았습니다.',
      errorCode: 'invalid_input'
    }
  }
  const store = deps.getHighlightStore()
  if (!store) {
    return {
      ok: false,
      error: '하이라이트 인프라가 아직 준비되지 않았습니다.',
      errorCode: 'infra_unavailable'
    }
  }
  const normalizedPageId = normalizeOptionalId(args.pageId)
  // 신규 노트 + highlight composite — noteId 미명시 시 selectedText 로 새 노트 생성.
  let noteRow: NoteRow | null = null
  let resolvedNoteId: string
  if (args.noteId && args.noteId.trim().length > 0) {
    // codex dual review Finding 4 흡수 — noteId 명시 분기에서 무결성 검증.
    //   미존재 → errorCode='note_not_found' / cross-workspace → 동일 errorCode (격리 강제).
    //   NoteService 미주입 시 검증 불가 → infra_unavailable (composite 분기와 동일 path).
    const noteService = deps.getNoteService()
    if (!noteService) {
      return {
        ok: false,
        error: '노트 인프라가 아직 준비되지 않았습니다.',
        errorCode: 'infra_unavailable'
      }
    }
    const existing = noteService.getNote(args.noteId)
    if (!existing) {
      return {
        ok: false,
        error: `노트를 찾을 수 없습니다: ${args.noteId}`,
        errorCode: 'note_not_found'
      }
    }
    if (existing.workspace_id !== workspaceId) {
      return {
        ok: false,
        error: '노트와 워크스페이스가 일치하지 않습니다.',
        errorCode: 'note_not_found'
      }
    }
    resolvedNoteId = args.noteId
  } else {
    const noteService = deps.getNoteService()
    if (!noteService) {
      return {
        ok: false,
        error: '노트 인프라가 아직 준비되지 않았습니다.',
        errorCode: 'infra_unavailable'
      }
    }
    const selectedText = (args.selectedText ?? args.anchor.selectedText ?? '').trim()
    if (selectedText.length === 0) {
      return {
        ok: false,
        error: '선택 텍스트가 비어 있습니다.',
        errorCode: 'invalid_input'
      }
    }
    const created = await noteService.createNote({
      workspaceId,
      selectedText,
      pageId: normalizedPageId,
      body: args.body ?? null
    })
    noteRow = created.note
    resolvedNoteId = noteRow.id
  }

  let record: HighlightRecord
  try {
    record = store.add({
      noteId: resolvedNoteId,
      pageId: normalizedPageId,
      url: args.url,
      contentHash: args.contentHash,
      anchor: args.anchor,
      workspaceId
    })
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'invalid_input'
    }
  }

  return {
    ok: true,
    highlight: toSerializedHighlight(record),
    note: noteRow ? toSerializedNote(noteRow) : undefined
  }
}

export function handleHighlightListByPage(
  args: HighlightListByPageArgs,
  deps: HighlightHandlersDeps
): HighlightListResponse {
  const store = deps.getHighlightStore()
  if (!store) return { highlights: [] }
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) return { highlights: [] }
  const normalizedPageId = normalizeOptionalId(args.pageId)
  const hasUrl = typeof args.url === 'string' && args.url.length > 0
  if (normalizedPageId === null && !hasUrl) return { highlights: [] }
  try {
    const records = store.listByPage({
      workspaceId,
      pageId: normalizedPageId,
      url: hasUrl ? args.url : undefined,
      contentHash: args.contentHash
    })
    return { highlights: records.map(toSerializedHighlight) }
  } catch {
    return { highlights: [] }
  }
}

export function handleHighlightListByNote(
  args: HighlightListByNoteArgs,
  deps: HighlightHandlersDeps
): HighlightListResponse {
  const store = deps.getHighlightStore()
  if (!store) return { highlights: [] }
  if (!args.noteId) return { highlights: [] }
  const records = store.listByNote(args.noteId)
  return { highlights: records.map(toSerializedHighlight) }
}

export function handleHighlightRemove(
  args: HighlightRemoveArgs,
  deps: HighlightHandlersDeps
): HighlightRemoveResponse {
  const store = deps.getHighlightStore()
  if (!store) return { ok: false }
  if (!args.id) return { ok: false }
  return { ok: store.remove(args.id) }
}

function toSerializedHighlight(record: HighlightRecord): SerializedHighlightRecord {
  return {
    id: record.id,
    noteId: record.noteId,
    pageId: record.pageId,
    url: record.url,
    contentHash: record.contentHash,
    anchor: record.anchor,
    workspaceId: record.workspaceId,
    createdAt: record.createdAt
  }
}

function toSerializedNote(row: NoteRow): SerializedNoteRow {
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
