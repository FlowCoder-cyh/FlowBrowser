/**
 * Sprint 015 M6 T29 — MemoryService.
 *
 * 책임: 워크스페이스별 메모리 통계 집계 (페이지·방문·노트·AI 메모 + 마지막 인덱싱 시간).
 *
 * 호출자: memory:* IPC pure handler 가 본 서비스 위임.
 *
 * pure aggregator — DB 접근만 (외부 호출 0). 단위 테스트는 in-memory FlowbrowserDatabase 활용.
 */

import type { IndexedPageStoreSqlite } from '../storage/IndexedPageStoreSqlite'
import type { NoteStore } from '../storage/NoteStore'
import type { AiChatHistoryStore } from '../storage/AiChatHistoryStore'

export interface MemoryStats {
  workspaceId: string
  pagesCount: number
  visitsCount: number
  notesCount: number
  chatMessagesCount: number
  /** 가장 최근 visit timestamp (epoch ms). visits 0건이면 null. */
  lastIndexedAt: number | null
}

export interface MemoryServiceOptions {
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  chatStore: AiChatHistoryStore
}

export class MemoryService {
  private readonly pageStore: IndexedPageStoreSqlite
  private readonly noteStore: NoteStore
  private readonly chatStore: AiChatHistoryStore

  constructor(opts: MemoryServiceOptions) {
    this.pageStore = opts.pageStore
    this.noteStore = opts.noteStore
    this.chatStore = opts.chatStore
  }

  getStats(workspaceId: string): MemoryStats {
    if (!workspaceId || workspaceId.length === 0) {
      throw new Error('MemoryService.getStats: workspaceId required')
    }
    return {
      workspaceId,
      pagesCount: this.pageStore.countPages(workspaceId),
      visitsCount: this.pageStore.countVisits(workspaceId),
      notesCount: this.noteStore.countByWorkspace(workspaceId),
      chatMessagesCount: this.chatStore.countByWorkspace(workspaceId),
      lastIndexedAt: this.pageStore.lastVisitedAt(workspaceId)
    }
  }
}
