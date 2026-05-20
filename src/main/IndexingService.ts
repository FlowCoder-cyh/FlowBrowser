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
import type { VectorIndex } from '../storage/VectorIndex'
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
      /**
       * 임베딩 큐 등록 skip 사유:
       * - `'empty_content'` (본문 빈값)
       * - `'unchanged'` (재방문 본문 동일)
       * - `'aborted'` (Sprint 016 M0 T02-followup KI-006 — workspace 전환 직전 abort).
       *   Visit 자체는 영속, enqueue/emit 만 suppress.
       */
      embeddingSkipReason?: 'empty_content' | 'unchanged' | 'aborted'
    }
  | {
      status: 'blocked'
      evaluation: IndexingEvaluation
    }

/** `onStatusChange` 콜백 payload — Renderer broadcast 입력. */
export interface IndexingStatusPayload {
  url: string
  result: IndexPageResult
  /**
   * Sprint 016 M0 T05 (KI-010) — indexed page 의 workspace_id.
   * `status='blocked'` 시 undefined (Page/Visit 미생성 — workspace 컨텍스트 없음).
   * `status='indexed'` 시 항상 채워짐 — `visit.page.workspace_id` (input 미주입 시 defaultWorkspaceId).
   * broadcast 측에서 `memory:stats-invalidated` 의 `workspaceId` 분기에 활용.
   */
  workspaceId?: string
  timestamp: number
}

export interface IndexingServiceOptions {
  gate: IndexingGate
  pageStore: IndexedPageStoreSqlite
  embeddingQueue: EmbeddingQueue
  /**
   * Sprint 016 M0 T02-followup (KI-006) — VectorIndex 주입 (optional).
   *
   * `unchanged` 분기에서 vector 미존재 (e.g. 이전 abort 또는 embedding worker 실패) 확인 후
   * 재 enqueue 회복 판정에 사용. 미주입 시 unchanged → 항상 enqueue skip (이전 동작 호환).
   */
  vectorIndex?: VectorIndex
  /** 페이지 인덱싱 결과 broadcast (IPC wiring 은 호출자 책임). */
  onStatusChange?: (payload: IndexingStatusPayload) => void
}

const PRIORITY_ACTIVE_TAB = 10
const PRIORITY_BACKGROUND = 1

export class IndexingService {
  private readonly gate: IndexingGate
  private readonly pageStore: IndexedPageStoreSqlite
  private readonly embeddingQueue: EmbeddingQueue
  private readonly vectorIndex?: VectorIndex
  private readonly onStatusChange?: (payload: IndexingStatusPayload) => void
  /**
   * Sprint 016 M0 T02-followup (KI-006) — workspace 단위 abort generation counter.
   *
   * codex BLOCKING #1 흡수 (boolean Set 1회 suppress 의 race condition 해소):
   *   - abort(ws) → `generations.get(ws) + 1`
   *   - indexPage 시작 시 startGen 캡처
   *   - indexPage 종료 직전 currentGen 확인 → `startGen < currentGen` 이면 suppress
   *
   * 효과:
   *   - abort 호출 이전에 시작된 모든 in-flight indexPage 가 suppress (동시 2건 race-safe)
   *   - abort 호출 이후 새로 시작된 indexPage 는 정상 처리 (오탐 차단)
   *   - workspace 격리 (Map key = ws id)
   *
   * 호출자 (workspaceHandlers.handleWorkspaceSwitch) 가 `setActive` 직전 abort(prevWs) 호출 →
   * 직후 새 ws 의 indexPage 는 새 startGen (currentGen) 으로 시작 → 정상 처리.
   */
  private readonly abortGenerations = new Map<string, number>()

  constructor(opts: IndexingServiceOptions) {
    this.gate = opts.gate
    this.pageStore = opts.pageStore
    this.embeddingQueue = opts.embeddingQueue
    this.vectorIndex = opts.vectorIndex
    this.onStatusChange = opts.onStatusChange
  }

  /**
   * Sprint 016 M0 T02-followup (KI-006) — workspace 인덱싱 abort (race-safe generation 패턴).
   *
   * 호출 시점 generation +1 → 그 이전에 시작된 모든 in-flight indexPage 의 후속 enqueue + emit
   * 을 suppress. 호출 이후 새로 시작된 indexPage 는 정상 처리 (workspaceHandlers 가 `setActive`
   * 직전에 호출 → 직후 새 ws 또는 같은 ws 신규 indexPage 정상).
   *
   * 진행 중인 DB TX (recordVisit) 자체는 rollback 안 함 — `Visit` 행은 영속 (UX 일관성).
   * EmbeddingQueue pending 항목은 별도 `EmbeddingQueue.clearWorkspace(workspaceId)` 에서 정리.
   * 본 PR scope (G-013 2단계): provider.chat 의 fetch abort 통전은 후속 PR (3단계).
   * EmbeddingClient in_progress 보호 (PRD §11.3.3 정합) 도 후속 PR (worker 측 generation 확인).
   */
  abort(workspaceId: string): void {
    const prev = this.abortGenerations.get(workspaceId) ?? 0
    this.abortGenerations.set(workspaceId, prev + 1)
  }

  /** 테스트 / 디버그용 — workspace 현재 abort generation. */
  getAbortGeneration(workspaceId: string): number {
    return this.abortGenerations.get(workspaceId) ?? 0
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
    // Sprint 016 M0 T02-followup (KI-006) — abort generation 캡처 (race-safe).
    // 호출 시점 ws 의 generation 을 저장 → 종료 직전 비교. input.workspaceId 미주입 시 recordVisit
    // 후 visit.page.workspace_id 로 결정되는데, generation 캡처는 input.workspaceId 또는 미주입 시
    // undefined → 종료 직전 visit.page.workspace_id 기준 비교에서 ws 분리 정합.
    const startGen = input.workspaceId
      ? this.abortGenerations.get(input.workspaceId) ?? 0
      : undefined

    const evaluation = this.gate.evaluate({
      url: input.url,
      hasPasswordField: input.hasPasswordField,
      overrideToken: input.overrideToken
    })

    if (!evaluation.allowed) {
      const result: IndexPageResult = { status: 'blocked', evaluation }
      this.emit(input.url, result, undefined)
      return result
    }

    // PRD §8.4 정합 — whitespace-only 본문은 '빈 본문' 으로 normalize.
    // contentHashOf('') === null 이라 Page.content_hash = NULL 로 영속 (재방문 시 동일 처리).
    // codex M4-1 hotfix NB-1: 이전엔 raw '   ' 가 그대로 저장되어 hash 가 비-NULL 이 되는 SSOT 미정합.
    const rawContent = input.content ?? ''
    const trimmedEmpty = rawContent.trim().length === 0
    const persistedContent = trimmedEmpty ? '' : rawContent

    const visit = await this.pageStore.recordVisit({
      url: input.url,
      title: input.title ?? '',
      content: persistedContent,
      lang: input.lang,
      workspace_id: input.workspaceId
    })

    // Sprint 016 M0 T02-followup (KI-006) — abort generation 비교 (race-safe).
    // input.workspaceId 미주입 시 visit.page.workspace_id (defaultWorkspaceId) 기준 startGen 재캡처
    // 필요 — 시작 시점에 ws 알 수 없었던 케이스. 단, 시작 시점 ↔ recordVisit 완료 사이에 abort 가
    // 일어나면 동일 generation 비교는 정확. defaultWorkspace 케이스는 startGen 미설정이라 currentGen 만
    // 비교 (즉, abort 호출 이후 시작 indexPage 도 영향 받음 — defaultWorkspace 명시 미주입 path 은
    // 호출자 측 (services.ts createTabView) 이 명시적으로 workspaceId 주입 권고).
    const resolvedStartGen = startGen ?? this.abortGenerations.get(visit.page.workspace_id) ?? 0
    const currentGen = this.abortGenerations.get(visit.page.workspace_id) ?? 0
    if (resolvedStartGen < currentGen) {
      // abort 호출 이전 시작된 in-flight → suppress (enqueue + emit 차단)
      // Visit 자체는 영속 (DB TX 완료 + UX 일관성, recordVisit rollback 안 함)
      return {
        status: 'indexed',
        pageId: visit.page.id,
        visitId: visit.visit.id,
        action: visit.action,
        embeddingSkipReason: 'aborted'
      }
    }

    let embeddingJobId: string | undefined
    let embeddingSkipReason: 'empty_content' | 'unchanged' | undefined

    if (trimmedEmpty) {
      embeddingSkipReason = 'empty_content'
    } else if (visit.action === 'unchanged') {
      // 재방문 + 본문 동일 → 이전 임베딩 재사용 (PRD §8.4 정합).
      // codex BLOCKING #2 흡수 — vector 미존재 시 (이전 abort 또는 worker 실패) 재 enqueue 회복.
      // VectorIndex 주입된 경우만 회복 path 적용. 미주입 시 이전 동작 호환 (항상 skip).
      const needsRecovery =
        this.vectorIndex !== undefined && !this.vectorIndex.hasPageEmbedding(visit.page.id)
      if (needsRecovery) {
        const priority = input.isActiveTab ? PRIORITY_ACTIVE_TAB : PRIORITY_BACKGROUND
        const job = this.embeddingQueue.enqueue({
          target_type: 'page',
          target_id: visit.page.id,
          workspace_id: visit.page.workspace_id,
          priority
        })
        embeddingJobId = job.id
      } else {
        embeddingSkipReason = 'unchanged'
      }
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
    this.emit(input.url, result, visit.page.workspace_id)
    return result
  }

  private emit(url: string, result: IndexPageResult, workspaceId: string | undefined): void {
    if (!this.onStatusChange) return
    this.onStatusChange({ url, result, workspaceId, timestamp: Date.now() })
  }
}

export const __testing = {
  PRIORITY_ACTIVE_TAB,
  PRIORITY_BACKGROUND
}
