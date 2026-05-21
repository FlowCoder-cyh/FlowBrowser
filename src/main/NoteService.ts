/**
 * Sprint 015 M5-7 — NoteService.
 * Sprint 016 M4 T21 — AutoTagger.tagNote wiring (KI-005 closed).
 *
 * PRD §11 노트 (Note) 신규 패널.
 *
 * 책임:
 *   1. createNote(input) — NoteStore.create + EmbeddingQueue.enqueue (note 임베딩 자동 큐)
 *      + 선택적 AutoTagger.tagNote (enableAutoTagging=true + opts.autoTagger 주입 시)
 *   2. listNotes(workspaceId) / deleteNote(id) — 편의 위임
 *
 * NoteStore + EmbeddingQueue + 선택적 AutoTagger 의존 주입. UI / IPC wiring 은 noteHandlers.ts 별도.
 *
 * KI-003 BYOK (HIGH) 정합:
 *   AutoTagger 자동 호출이 Codex OAuth 주입 시 ChatGPT 한도 묵시 소진 위협. 본 모듈 자체는
 *   provider 종류 무관 — 호출자 (services.ts) 가 autoTagger 인스턴스에 OpenAI Provider 만 주입.
 *
 * KI-005 closed (Sprint 016 M4 T21):
 *   AutoTagger.tagNote 신규 — attachToPage 우회 + attachToNote 호출. page_tags FK 위반 없음.
 *   본 모듈 createNote 에서 enableAutoTagging=true + opts.autoTagger 주입 시 tagNote 호출.
 *   opts.autoTagger 미주입 또는 enableAutoTagging=false 시 'not_called'.
 */

import type { NoteStore, CreateNoteInput, NoteRow } from '../storage/NoteStore'
import type { EmbeddingQueue } from '../storage/EmbeddingQueue'
import type { AutoTagger } from '../ai/tagging/AutoTagger'
import { normalizeOptionalId } from '../storage/idNormalize'

export interface NoteServiceOptions {
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
  /**
   * Sprint 016 M4 T21 (KI-005 closed) — note 자동 태깅 wiring.
   * 미주입 시 enableAutoTagging=true 입력 무시 (safety) → autoTaggingStatus='not_called'.
   */
  autoTagger?: AutoTagger
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
   * Sprint 016 M4 T21 (KI-005 closed) — AutoTagger.tagNote 호출 트리거.
   * - true + opts.autoTagger 주입: tagNote 호출 + autoTaggingStatus='tagged'|'skipped'|'failed'
   * - true + autoTagger 미주입: 'not_called' (safety)
   * - false / 미지정: 'not_called'
   */
  enableAutoTagging?: boolean
}

export interface CreateNoteResult {
  note: NoteRow
  /** EmbeddingQueue job id. note 본문 빈 케이스 시 undefined. */
  embeddingJobId?: string
  /**
   * AutoTagger 호출 결과 status.
   * - 'tagged': tagNote 성공 + 태그 attach 완료
   * - 'skipped': empty content / no_chat_support
   * - 'failed': provider.chat throw
   * - 'not_called': enableAutoTagging=false 또는 autoTagger 미주입
   */
  autoTaggingStatus?: 'tagged' | 'skipped' | 'failed' | 'not_called'
}

const DEFAULT_PRIORITY = 10

export class NoteService {
  private readonly noteStore: NoteStore
  private readonly embeddingQueue: EmbeddingQueue
  private readonly autoTagger: AutoTagger | undefined

  constructor(opts: NoteServiceOptions) {
    this.noteStore = opts.noteStore
    this.embeddingQueue = opts.embeddingQueue
    this.autoTagger = opts.autoTagger
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

    // 방어선 normalize — IPC 외 직접 호출자도 정합 (Sprint 017 T02).
    // `'' or whitespace-only → null` 강제 — `?? null` 만으로는 '' 통과.
    const noteInput: CreateNoteInput = {
      workspace_id: input.workspaceId,
      selected_text: input.selectedText,
      page_id: normalizeOptionalId(input.pageId),
      visit_id: normalizeOptionalId(input.visitId),
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

    // Sprint 016 M4 T21 (KI-005 closed) — AutoTagger.tagNote 호출.
    // enableAutoTagging=true + opts.autoTagger 주입 시 호출 / 그 외 'not_called'.
    let autoTaggingStatus: CreateNoteResult['autoTaggingStatus'] = 'not_called'
    if (input.enableAutoTagging === true && this.autoTagger) {
      // content 결합 — selected_text + body (body 있으면 \n\n 결합, 없으면 selected_text 만).
      // 호출자가 입력한 그대로 — 본 모듈은 trim 만 (AutoTagger 내부에서 추가 trim/truncate).
      const noteContent =
        input.body && input.body.trim().length > 0
          ? `${input.selectedText}\n\n${input.body}`
          : input.selectedText
      // codex T21 사전 dual review NEEDS_CHANGES #1 흡수 — autoTagger 호출이 throw 해도
      // createNote 자체 throw 안 되도록 try/catch 격리. note + embedding job 은 이미 영속.
      // AutoTagger.tagContent 내부는 provider.chat throw 만 'failed' 변환, attach 단계 DB/FK
      // throw 는 그대로 전파 → 본 모듈에서 catch + status='failed' 처리.
      try {
        const result = await this.autoTagger.tagNote({
          noteId: note.id,
          workspaceId: input.workspaceId,
          content: noteContent
        })
        autoTaggingStatus = result.status
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
}
