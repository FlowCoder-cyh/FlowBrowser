/**
 * Sprint 015 M5-7 — NoteService.
 *
 * PRD §11 노트 (Note) 신규 패널.
 *
 * 책임:
 *   1. createNote(input) — NoteStore.create + EmbeddingQueue.enqueue (note 임베딩 자동 큐)
 *   2. listNotes(workspaceId) / deleteNote(id) — 편의 위임
 *
 * NoteStore (M3-4) + EmbeddingQueue (M3-4) 의존 주입. UI / IPC wiring 은 noteHandlers.ts 별도.
 *
 * KI-003 BYOK (HIGH) 정합:
 *   AutoTagger 자동 호출이 Codex OAuth 주입 시 ChatGPT 한도 묵시 소진 위협. 본 PR 은 AutoTagger
 *   통합 자체 미도입 — 안전 디폴트. note 자동 태깅 도입은 KI-005 후속 (`AutoTagger.tagNote` 신규
 *   메서드 — attachToPage 우회 + attachToNote 호출 필요).
 *
 * KI-005 (codex M5-7 PR #159 발견) — AutoTagger.tagPage 가 내부에서 attachToPage 호출하므로
 *   note.id 를 pageId 자리에 주입 시 page_tags FK 위반. 별도 PR 에서 tagNote 도입 시 해소.
 */

import type { NoteStore, CreateNoteInput, NoteRow } from '../storage/NoteStore'
import type { EmbeddingQueue } from '../storage/EmbeddingQueue'

export interface NoteServiceOptions {
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
}

export interface CreateNoteServiceInput {
  workspaceId: string
  selectedText: string
  pageId?: string | null
  visitId?: string | null
  body?: string | null
  /** 호출자 명시 ai_tags (글로사리 마이그레이션 등). */
  initialTags?: string[]
  /** EmbeddingQueue 우선순위 (활성 탭 10 / 백그라운드 1). 디폴트 10 (사용자 명시 노트 우선). */
  priority?: number
  /**
   * KI-005 후속 — 현 시점 호출자가 명시해도 'not_called' 반환 (safety). AutoTagger.tagNote 도입 후
   * 본 옵션 활성 (KI-005 closed 시점).
   */
  enableAutoTagging?: boolean
}

export interface CreateNoteResult {
  note: NoteRow
  /** EmbeddingQueue job id. note 본문 빈 케이스 시 undefined. */
  embeddingJobId?: string
  /** AutoTagger 호출 결과 status. 현 시점 항상 'not_called' (KI-005 closed 시 활성). */
  autoTaggingStatus?: 'tagged' | 'skipped' | 'failed' | 'not_called'
}

const DEFAULT_PRIORITY = 10

export class NoteService {
  private readonly noteStore: NoteStore
  private readonly embeddingQueue: EmbeddingQueue

  constructor(opts: NoteServiceOptions) {
    this.noteStore = opts.noteStore
    this.embeddingQueue = opts.embeddingQueue
  }

  /**
   * 노트 생성 흐름:
   *   1. selectedText / workspaceId 입력 검증 (whitespace-only 차단)
   *   2. NoteStore.create (workspace_id + selected_text + optional anchors)
   *   3. EmbeddingQueue.enqueue (target_type='note', priority=10 디폴트)
   *
   * codex M5-7 PR #159 NEEDS_CHANGES 정정 — whitespace-only selectedText guard + KI-005 안전 디폴트.
   */
  async createNote(input: CreateNoteServiceInput): Promise<CreateNoteResult> {
    if (!input.selectedText || input.selectedText.trim().length === 0) {
      throw new Error('NoteService.createNote: selectedText 가 비어 있습니다.')
    }
    if (!input.workspaceId) {
      throw new Error('NoteService.createNote: workspaceId required.')
    }

    const noteInput: CreateNoteInput = {
      workspace_id: input.workspaceId,
      selected_text: input.selectedText,
      page_id: input.pageId ?? null,
      visit_id: input.visitId ?? null,
      body: input.body ?? null,
      ai_tags: input.initialTags ?? null,
      created_by: 'user'
    }
    const note = this.noteStore.create(noteInput)

    // 임베딩 큐 등록 — body 또는 selected_text 가 있을 때만
    let embeddingJobId: string | undefined
    const hasContent =
      (input.body && input.body.trim().length > 0) || input.selectedText.trim().length > 0
    if (hasContent) {
      const job = this.embeddingQueue.enqueue({
        target_type: 'note',
        target_id: note.id,
        workspace_id: input.workspaceId,
        priority: input.priority ?? DEFAULT_PRIORITY
      })
      embeddingJobId = job.id
    }

    // KI-005 — note 자동 태깅 미구현 (AutoTagger.tagNote 도입 시 활성). 현 시점 항상 'not_called'.
    const autoTaggingStatus: CreateNoteResult['autoTaggingStatus'] = 'not_called'

    return { note, embeddingJobId, autoTaggingStatus }
  }

  listNotes(workspaceId: string): NoteRow[] {
    return this.noteStore.listByWorkspace(workspaceId)
  }

  deleteNote(id: string): boolean {
    return this.noteStore.delete(id)
  }
}
