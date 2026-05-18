/**
 * Sprint 015 M4-1 — IndexingService.
 *
 * PRD §5.4.1 / §8.1 — 페이지 인덱싱 라이프사이클 진입점 (Main process).
 * `did-finish-load` hook 호출자가 본 서비스 `indexPage()` 를 invoke.
 *
 * 책임:
 *   1. IndexingGate.evaluate() — 차단 도메인 / 비밀번호 필드 / 사용자 차단 검사
 *   2. (통과) IndexedPageStoreSqlite.recordVisit() — 단일 TX (Page UPSERT + Visit INSERT)
 *   3. (본문 있음) EmbeddingQueue.enqueue() — 활성 탭 priority 10 / 백그라운드 1
 *   4. onStatusChange 콜백 — Renderer broadcast (IPC wiring 은 호출자 책임, M4-5 또는 후속)
 *
 * 본 모듈은 wiring 분리 (G-013 단계별 PR) — did-finish-load hook 자체는 main/index.ts 에 박힘.
 * 본 PR (M4-1) 은 모듈 + 단위 테스트만. wiring 은 M4-5 회귀 셋 또는 후속.
 *
 * 의존 주입 — 모든 storage / privacy 객체는 호출자가 생성 후 주입.
 * 테스트 시 in-memory FlowbrowserDatabase + IndexingGate stub 으로 격리 가능.
 */

import type { IndexingGate } from '../privacy/IndexingGate'
import type { IndexedPageStoreSqlite } from '../storage/IndexedPageStoreSqlite'
import type { EmbeddingQueue } from '../storage/EmbeddingQueue'
import type { IndexingEvaluation } from '../privacy/types'

/** `indexPage()` 입력 — `did-finish-load` hook 시점에 호출자가 수집. */
export interface IndexPageInput {
  /** 페이지 URL (raw). IndexingGate URL 매칭 + IndexedPageStore url 컬럼 입력. */
  url: string
  /** 페이지 제목 (document.title). */
  title?: string
  /** ParagraphExtractor 본문 텍스트. 빈 문자열이면 임베딩 큐 skip (PRD §8.4 본문 빈값 케이스). */
  content?: string
  /** `<html lang>` 속성. */
  lang?: string
  /** SensitiveFieldDetector hint — `<input type='password'>` 감지 여부. */
  hasPasswordField: boolean
  /** workspace_id (UUID). 미주입 시 IndexedPageStoreSqlite 가 defaultWorkspaceId 적용. */
  workspaceId?: string
  /** 현재 활성 탭 여부 — true 시 임베딩 priority 10, false 시 1. */
  isActiveTab?: boolean
  /** 사용자 1회 override token (`IndexingGate.issueOverrideToken()` 발급). */
  overrideToken?: string
}

/**
 * `indexPage()` 결과.
 *
 * 단일 TX 내 Page upsert + Visit C 가 끝나면 `pageId` 채워짐. embedding 은 비동기 queue 등록만 —
 * 실제 embedding 호출은 EmbeddingClient (M3-5, 별도 worker).
 */
export type IndexPageResult =
  | {
      status: 'indexed'
      pageId: string
      visitId: string
      /** IndexedPageStoreSqlite.recordVisit() upsert 분기 — created / unchanged / updated_changed. */
      action: 'created' | 'unchanged' | 'updated_changed'
      /** 임베딩 큐 등록 시 row id. 본문 빈값/매칭 부재 시 undefined. */
      embeddingJobId?: string
      /** 임베딩 큐 등록 skip 사유 — 'empty_content' (본문 빈값) 또는 'unchanged' (재방문 본문 동일). */
      embeddingSkipReason?: 'empty_content' | 'unchanged'
    }
  | {
      status: 'blocked'
      evaluation: IndexingEvaluation
    }

/** `onStatusChange` 콜백 payload — Renderer broadcast 입력. */
export interface IndexingStatusPayload {
  url: string
  result: IndexPageResult
  timestamp: number
}

export interface IndexingServiceOptions {
  gate: IndexingGate
  pageStore: IndexedPageStoreSqlite
  embeddingQueue: EmbeddingQueue
  /** 페이지 인덱싱 결과 broadcast (IPC wiring 은 호출자 책임). */
  onStatusChange?: (payload: IndexingStatusPayload) => void
}

const PRIORITY_ACTIVE_TAB = 10
const PRIORITY_BACKGROUND = 1

export class IndexingService {
  private readonly gate: IndexingGate
  private readonly pageStore: IndexedPageStoreSqlite
  private readonly embeddingQueue: EmbeddingQueue
  private readonly onStatusChange?: (payload: IndexingStatusPayload) => void

  constructor(opts: IndexingServiceOptions) {
    this.gate = opts.gate
    this.pageStore = opts.pageStore
    this.embeddingQueue = opts.embeddingQueue
    this.onStatusChange = opts.onStatusChange
  }

  /**
   * `did-finish-load` 시점에 호출. 단일 진입점.
   *
   * 흐름:
   *   1. IndexingGate.evaluate() — 차단 시 즉시 return (Page/Visit/Embedding 미생성)
   *   2. IndexedPageStoreSqlite.recordVisit() — 단일 TX (Page upsert + Visit C)
   *   3. 본문 빈값 또는 unchanged 시 임베딩 큐 skip
   *   4. 그 외 → EmbeddingQueue.enqueue() (priority active=10 / background=1)
   *   5. onStatusChange broadcast (Renderer)
   */
  async indexPage(input: IndexPageInput): Promise<IndexPageResult> {
    const evaluation = this.gate.evaluate({
      url: input.url,
      hasPasswordField: input.hasPasswordField,
      overrideToken: input.overrideToken
    })

    if (!evaluation.allowed) {
      const result: IndexPageResult = { status: 'blocked', evaluation }
      this.emit(input.url, result)
      return result
    }

    const visit = await this.pageStore.recordVisit({
      url: input.url,
      title: input.title ?? '',
      content: input.content ?? '',
      lang: input.lang,
      workspace_id: input.workspaceId
    })

    const content = input.content ?? ''
    const trimmedEmpty = content.trim().length === 0

    let embeddingJobId: string | undefined
    let embeddingSkipReason: 'empty_content' | 'unchanged' | undefined

    if (trimmedEmpty) {
      embeddingSkipReason = 'empty_content'
    } else if (visit.action === 'unchanged') {
      // 재방문 + 본문 동일 → 이전 임베딩 재사용 (PRD §8.4 정합)
      embeddingSkipReason = 'unchanged'
    } else {
      const priority = input.isActiveTab ? PRIORITY_ACTIVE_TAB : PRIORITY_BACKGROUND
      const job = this.embeddingQueue.enqueue({
        target_type: 'page',
        target_id: visit.page.id,
        workspace_id: visit.page.workspace_id,
        priority
      })
      embeddingJobId = job.id
    }

    const result: IndexPageResult = {
      status: 'indexed',
      pageId: visit.page.id,
      visitId: visit.visit.id,
      action: visit.action,
      embeddingJobId,
      embeddingSkipReason
    }
    this.emit(input.url, result)
    return result
  }

  private emit(url: string, result: IndexPageResult): void {
    if (!this.onStatusChange) return
    this.onStatusChange({ url, result, timestamp: Date.now() })
  }
}

export const __testing = {
  PRIORITY_ACTIVE_TAB,
  PRIORITY_BACKGROUND
}
