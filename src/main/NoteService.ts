/**
 * Sprint 015 M5-7 — NoteService.
 *
 * PRD §11 노트 (Note) 신규 패널 + 자동 태깅 (M4-2 AutoTagger 재활용).
 *
 * 책임:
 *   1. createNote(input) — NoteStore.create + EmbeddingQueue.enqueue (note 임베딩 자동 큐)
 *   2. (옵션) AutoTagger 자동 태그 — 호출자가 BYOK 검증된 provider 주입 시 (KI-003 정합)
 *   3. listNotes(workspaceId) / deleteNote(id) — 편의 위임
 *
 * NoteStore (M3-4) + EmbeddingQueue (M3-4) + TagStore (M3-4) + AutoTagger (M4-2) 의존 주입.
 * UI / IPC wiring 은 noteHandlers.ts 별도 — pure class.
 *
 * KI-003 BYOK (HIGH) 정합:
 *   AutoTagger 자동 호출이 Codex OAuth 주입 시 ChatGPT 한도 묵시 소진 위협 — 호출자가 provider 검증 후
 *   NoteService.createNote(opts.autoTagging=true) 시에만 AutoTagger 호출. 기본은 false.
 */

import type { NoteStore, CreateNoteInput, NoteRow } from '../storage/NoteStore'
import type { EmbeddingQueue } from '../storage/EmbeddingQueue'
import type { TagStore } from '../storage/TagStore'
import type { AutoTagger } from '../ai/tagging/AutoTagger'

/**
 * AutoTagger 의 최소 인터페이스 — `tagPage` 만 활용. class 전체 (provider/tagStore/maxTags 등) 와 결합
 * 회피 → mock 가능 + 의존 주입 명료.
 */
export interface AutoTaggerService {
  tagPage: AutoTagger['tagPage']
}

export type AutoTagSucceeded = Extract<
  Awaited<ReturnType<AutoTaggerService['tagPage']>>,
  { status: 'tagged' }
>

/**
 * AutoTagger 시그니처는 page 기준 — 본 모듈은 노트 자동 태깅 시 호출자가 직접 처리하거나
 * 추후 AutoTagger 확장 (tagNote). 본 PR 은 page only (autoTagging=false 디폴트).
 */
export interface NoteServiceOptions {
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
  tagStore: TagStore
  /** AutoTagger 인스턴스 — 호출자가 BYOK 검증된 provider 로 주입. 미주입 시 자동 태깅 비활성. */
  autoTagger?: AutoTaggerService
}

export interface CreateNoteServiceInput {
  workspaceId: string
  selectedText: string
  pageId?: string | null
  visitId?: string | null
  body?: string | null
  /** 호출자 명시 ai_tags (글로사리 마이그레이션 등). AutoTagger 결과와 별개. */
  initialTags?: string[]
  /** AutoTagger 자동 태깅 활성 — autoTagger 주입 + BYOK 정합 시에만 실제 호출. */
  enableAutoTagging?: boolean
  /** EmbeddingQueue 우선순위 (활성 탭 10 / 백그라운드 1). 디폴트 10 (사용자 명시 노트 우선). */
  priority?: number
}

export interface CreateNoteResult {
  note: NoteRow
  /** EmbeddingQueue job id. note 본문 빈 케이스 시 undefined. */
  embeddingJobId?: string
  /** AutoTagger 호출 시 결과 status. 미호출 시 'skipped'. */
  autoTaggingStatus?: 'tagged' | 'skipped' | 'failed' | 'not_called'
}

const DEFAULT_PRIORITY = 10

export class NoteService {
  private readonly noteStore: NoteStore
  private readonly embeddingQueue: EmbeddingQueue
  private readonly tagStore: TagStore
  private readonly autoTagger: AutoTaggerService | null

  constructor(opts: NoteServiceOptions) {
    this.noteStore = opts.noteStore
    this.embeddingQueue = opts.embeddingQueue
    this.tagStore = opts.tagStore
    this.autoTagger = opts.autoTagger ?? null
  }

  /**
   * 노트 생성 흐름:
   *   1. NoteStore.create (workspace_id + selected_text + optional anchors)
   *   2. EmbeddingQueue.enqueue (target_type='note', priority=10 디폴트)
   *   3. (옵션) AutoTagger 호출 — BYOK 정합 시 호출자가 enableAutoTagging=true 주입
   *
   * 호출 전 BYOK 검증은 호출자 책임 (services.ts noteHandlers 가 allowedProviders 검증).
   */
  async createNote(input: CreateNoteServiceInput): Promise<CreateNoteResult> {
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

    // 임베딩 큐 등록 — body 또는 selected_text 가 있을 때만 (M3-5 EmbeddingClient.embedNote 정합)
    let embeddingJobId: string | undefined
    const hasContent = (input.body && input.body.trim().length > 0) || input.selectedText.trim().length > 0
    if (hasContent) {
      const job = this.embeddingQueue.enqueue({
        target_type: 'note',
        target_id: note.id,
        workspace_id: input.workspaceId,
        priority: input.priority ?? DEFAULT_PRIORITY
      })
      embeddingJobId = job.id
    }

    // AutoTagger 자동 태깅 — 호출자가 명시 활성 + autoTagger 주입 시
    let autoTaggingStatus: CreateNoteResult['autoTaggingStatus'] = 'not_called'
    if (input.enableAutoTagging && this.autoTagger) {
      try {
        const result = await this.autoTagger.tagPage({
          pageId: note.id, // note id 를 pageId 자리에 주입 — AutoTagger 가 결과 tag 만 반환 (attach 호출자 책임)
          workspaceId: input.workspaceId,
          title: '',
          content: input.body ?? input.selectedText
        })
        if (result.status === 'tagged') {
          this.attachTagsToNote(note.id, input.workspaceId, result)
          autoTaggingStatus = 'tagged'
        } else if (result.status === 'skipped') {
          autoTaggingStatus = 'skipped'
        } else {
          autoTaggingStatus = 'failed'
        }
      } catch {
        autoTaggingStatus = 'failed'
      }
    }

    return { note, embeddingJobId, autoTaggingStatus }
  }

  listNotes(workspaceId: string): NoteRow[] {
    return this.noteStore.listByWorkspace(workspaceId)
  }

  deleteNote(id: string): boolean {
    return this.noteStore.delete(id)
  }

  /** AutoTagger 결과의 tag 들을 노트에 attach. AutoTagger 가 attachToPage 호출하므로 본 시점엔 attachToNote 별도 처리. */
  private attachTagsToNote(noteId: string, workspaceId: string, result: AutoTagSucceeded): void {
    for (const tag of result.tags) {
      this.tagStore.attachToNote(noteId, {
        workspace_id: workspaceId,
        tag_id: tag.id,
        ai_generated: true
      })
    }
  }
}
