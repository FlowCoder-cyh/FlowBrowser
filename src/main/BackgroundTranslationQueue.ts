/**
 * Sprint 016 M4 T18 — BackgroundTranslationQueue.
 *
 * PRD §14 백그라운드 번역 (Phase 2 신규) 1단계 모듈 — queue skeleton + policy.
 *
 * 책임 (G-013 1단계 정합):
 *   1. TranslationJob 라이프사이클 (queued → in_progress → completed/failed/cancelled)
 *   2. FIFO 큐 + 동시 1 작업 (PRD §14.8)
 *   3. rate limit: job 시작 간 최소 60초 (PRD §14.8 "분당 1 페이지")
 *   4. threshold warn-only: 300 페이지 / 5h sliding window (PRD §14.8 + contract §7 #6 — 차단 X)
 *   5. cancel (pending → 'cancelled' 즉시, running → AbortController + 'cancelled' 수렴)
 *   6. progress coalesce (5초 간격 또는 100% 완료 시 즉시)
 *   7. EventEmitter (completed / failed / cancelled / progress / thresholdExceeded)
 *
 * **본 PR 미포함** (G-013 2/3단계 후속 PR):
 *   - SQLite TranslationJobStore (영속) — interface 만 박음, in-memory 디폴트 구현
 *   - schema/v05.sql + 마이그레이션
 *   - TranslationJobRunner (processor 호출 wiring)
 *   - TranslationJobPanel (UI)
 *   - IPC handler + preload API
 *   - main/index.ts wiring (NotificationService 결합)
 *   - PDF 추출
 *
 * **의도 — codex T18 사전 협의 정합**:
 *   - 큐는 provider 모름 (processor 함수 주입)
 *   - 정책 (throttle / threshold) 은 큐 내부 강제 — 호출자 우회 차단
 *   - T19 NotificationService 결합은 외부 subscriber (EventEmitter listener)
 *   - durable resume 은 interface 자리만 — SQLite Store swap 후 완성
 *
 * **PRD §14 정합** (Phase 2 schema 미생성 시점):
 *   - TranslationJob 타입은 PRD §14.3.1 schema 와 1:1 매핑
 *   - status enum: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
 *   - progress_pct: 0~100
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

export type TranslationJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TranslationJob {
  id: string
  workspaceId: string
  pageId: string | null
  sourceText: string
  sourceLang: string | null
  targetLang: string
  translatedText: string | null
  providerId: string
  model: string | null
  reasoningEffort: string | null
  status: TranslationJobStatus
  progressPct: number
  estimatedCostUsd: number | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  errorCode: string | null
  errorMessage: string | null
}

/**
 * enqueue 입력 — 필수 필드만. id / 시점 / status 등은 큐 내부 박음.
 */
export interface EnqueueInput {
  workspaceId: string
  sourceText: string
  providerId: string
  targetLang?: string
  pageId?: string | null
  sourceLang?: string | null
  model?: string | null
  reasoningEffort?: string | null
  estimatedCostUsd?: number | null
}

/**
 * processor — 큐가 호출. provider.chat 등 실제 번역 수행 + progress 보고.
 *
 * 큐는 provider 모름 — BYOK 검증 / Codex OAuth 한도 / model 결정은 processor 외부 책임 (Runner / 호출자).
 *
 * 반환값 = 번역 결과 (translatedText) — 'completed' 시 저장. throw 시 'failed' 수렴.
 * ctx.signal AbortSignal — cancel 시 abort. processor 가 무시해도 큐가 완료 직전 status 재확인.
 * ctx.reportProgress(pct) — 0~100. 큐가 coalesce.
 */
export interface ProcessorContext {
  signal: AbortSignal
  reportProgress: (pct: number) => void
}

export type JobProcessor = (
  job: TranslationJob,
  ctx: ProcessorContext
) => Promise<{ translatedText: string; estimatedCostUsd?: number | null; model?: string | null }>

/**
 * TranslationJobStore — 큐 외부 영속 추상화.
 *
 * 본 PR 은 InMemoryTranslationJobStore 디폴트. SQLite Store 후속 PR 에서 swap.
 *
 * recoverRunnableJobs() — 앱 재시작 후 'queued' / 'in_progress' 항목 회수 (in_progress 는
 * PRD §14.8 정합 'queued' 로 리셋 후 처음부터). 본 PR in-memory 구현은 빈 배열 반환.
 */
export interface TranslationJobStore {
  insert(job: TranslationJob): void
  update(jobId: string, patch: Partial<TranslationJob>): TranslationJob | null
  findById(jobId: string): TranslationJob | null
  /** queued 상태 FIFO 순서 (createdAt asc). */
  listQueued(): TranslationJob[]
  listAll(): TranslationJob[]
  /**
   * 앱 재시작 후 runnable (queued + in_progress) 회수. in_progress 는 'queued' 로 리셋.
   * in-memory 디폴트는 빈 배열 (재시작 = 새 process = 빈 상태).
   */
  recoverRunnableJobs(): TranslationJob[]
}

export class InMemoryTranslationJobStore implements TranslationJobStore {
  private readonly jobs = new Map<string, TranslationJob>()

  insert(job: TranslationJob): void {
    if (this.jobs.has(job.id)) {
      throw new Error(`InMemoryTranslationJobStore.insert: duplicate id=${job.id}`)
    }
    this.jobs.set(job.id, { ...job })
  }

  update(jobId: string, patch: Partial<TranslationJob>): TranslationJob | null {
    const existing = this.jobs.get(jobId)
    if (!existing) return null
    const updated: TranslationJob = { ...existing, ...patch, id: existing.id }
    this.jobs.set(jobId, updated)
    return updated
  }

  findById(jobId: string): TranslationJob | null {
    const j = this.jobs.get(jobId)
    return j ? { ...j } : null
  }

  listQueued(): TranslationJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((j) => ({ ...j }))
  }

  listAll(): TranslationJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }

  /** in-memory: 재시작 시 빈 상태 (PRD §14.8 정합 — durable resume 은 SQLite Store 후속). */
  recoverRunnableJobs(): TranslationJob[] {
    return []
  }
}

/**
 * 큐 정책 디폴트 (PRD §14.8 + codex T18 사전 협의 정합).
 */
export interface QueuePolicy {
  /** job 시작 간 최소 ms (디폴트 60000 = 1분, PRD "분당 1 페이지"). */
  minStartIntervalMs: number
  /** threshold sliding window ms (디폴트 5h). */
  thresholdWindowMs: number
  /** threshold 페이지 수 (디폴트 300, contract §7 #6). 초과 시 warn-only event. */
  thresholdPages: number
  /** progress coalesce 최소 간격 ms (디폴트 5000 = 5초). */
  progressCoalesceMs: number
}

const DEFAULT_POLICY: QueuePolicy = {
  minStartIntervalMs: 60_000,
  thresholdWindowMs: 5 * 60 * 60 * 1000,
  thresholdPages: 300,
  progressCoalesceMs: 5000
}

export interface BackgroundTranslationQueueOptions {
  store: TranslationJobStore
  processor: JobProcessor
  policy?: Partial<QueuePolicy>
  /** Date.now 주입 (테스트). 디폴트 Date.now. */
  now?: () => number
  /** setTimeout 주입 (테스트 — fake timers). 디폴트 globalThis.setTimeout. */
  scheduleTimer?: (fn: () => void, ms: number) => unknown
  /** clearTimeout 주입 (테스트). 디폴트 globalThis.clearTimeout. */
  clearScheduledTimer?: (handle: unknown) => void
}

/**
 * EventEmitter typed event map.
 */
export interface QueueEventMap {
  completed: (job: TranslationJob) => void
  failed: (job: TranslationJob) => void
  cancelled: (job: TranslationJob) => void
  progress: (job: TranslationJob) => void
  thresholdExceeded: (info: {
    providerId: string
    completedInWindow: number
    thresholdPages: number
    windowMs: number
  }) => void
}

export class BackgroundTranslationQueue {
  private readonly store: TranslationJobStore
  private readonly processor: JobProcessor
  private readonly policy: QueuePolicy
  private readonly now: () => number
  private readonly scheduleTimer: (fn: () => void, ms: number) => unknown
  private readonly clearScheduledTimer: (handle: unknown) => void
  private readonly emitter = new EventEmitter()

  private running = false
  /** 현재 처리 중 job (동시 1). */
  private activeJob: { jobId: string; abort: AbortController } | null = null
  /** 마지막 job 시작 시점 (rate limit 계산). */
  private lastStartAt: number | null = null
  /** progress 마지막 emit 시점 (coalesce). */
  private lastProgressEmitAt = new Map<string, number>()
  /** dispatch 예약 핸들 (cleanup 용). */
  private dispatchHandle: unknown = null

  constructor(opts: BackgroundTranslationQueueOptions) {
    if (!opts.store) throw new Error('BackgroundTranslationQueue: store required')
    if (!opts.processor) throw new Error('BackgroundTranslationQueue: processor required')
    this.store = opts.store
    this.processor = opts.processor
    this.policy = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) }
    this.now = opts.now ?? Date.now
    this.scheduleTimer =
      opts.scheduleTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
    this.clearScheduledTimer =
      opts.clearScheduledTimer ?? ((h) => globalThis.clearTimeout(h as never))
  }

  enqueue(input: EnqueueInput): TranslationJob {
    if (!input.workspaceId) throw new Error('enqueue: workspaceId required')
    if (!input.sourceText || input.sourceText.trim().length === 0)
      throw new Error('enqueue: sourceText required')
    if (!input.providerId) throw new Error('enqueue: providerId required')

    const job: TranslationJob = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      pageId: input.pageId ?? null,
      sourceText: input.sourceText,
      sourceLang: input.sourceLang ?? null,
      targetLang: input.targetLang ?? 'ko',
      translatedText: null,
      providerId: input.providerId,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      status: 'queued',
      progressPct: 0,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      createdAt: this.now(),
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null
    }
    this.store.insert(job)
    if (this.running) {
      this.scheduleNextDispatch()
    }
    return job
  }

  /**
   * 큐 dispatch 루프 시작. 이미 running 이면 no-op.
   * 재시작 시 store.recoverRunnableJobs() 호출 + in_progress 항목 'queued' 리셋 (PRD §14.8).
   */
  start(): void {
    if (this.running) return
    this.running = true
    // 재시작 회수 — in_progress 항목 'queued' 리셋
    const runnable = this.store.recoverRunnableJobs()
    for (const j of runnable) {
      if (j.status === 'in_progress') {
        this.store.update(j.id, { status: 'queued', startedAt: null, progressPct: 0 })
      }
    }
    this.scheduleNextDispatch()
  }

  /** dispatch 루프 중지. activeJob 은 계속 실행 (강제 abort 안 함 — cancel API 사용). */
  stop(): void {
    this.running = false
    if (this.dispatchHandle !== null) {
      this.clearScheduledTimer(this.dispatchHandle)
      this.dispatchHandle = null
    }
  }

  /**
   * job 취소.
   *
   * - status='queued' → 즉시 'cancelled' + event emit
   * - status='in_progress' (activeJob 인 경우) → AbortController.abort() + processor 종료 후 'cancelled'
   * - status='completed' / 'failed' / 'cancelled' → no-op (반환 false)
   *
   * 반환: 취소 시도 결과 (이미 종료된 경우 false).
   */
  cancel(jobId: string): boolean {
    const job = this.store.findById(jobId)
    if (!job) return false
    if (job.status === 'queued') {
      const updated = this.store.update(jobId, {
        status: 'cancelled',
        completedAt: this.now()
      })
      if (updated) this.emitter.emit('cancelled', updated)
      return true
    }
    if (job.status === 'in_progress' && this.activeJob?.jobId === jobId) {
      this.activeJob.abort.abort()
      // 실제 'cancelled' 전환은 processor 종료 후 finally 단계에서 박힘 — race 방지
      return true
    }
    return false
  }

  /** 현재 job (없으면 null). */
  getActiveJob(): TranslationJob | null {
    if (!this.activeJob) return null
    return this.store.findById(this.activeJob.jobId)
  }

  /** typed listener 등록. */
  on<K extends keyof QueueEventMap>(event: K, listener: QueueEventMap[K]): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
  }

  off<K extends keyof QueueEventMap>(event: K, listener: QueueEventMap[K]): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
  }

  once<K extends keyof QueueEventMap>(event: K, listener: QueueEventMap[K]): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void)
  }

  /**
   * 다음 dispatch 예약. running=true + activeJob=null + 큐에 queued 항목 있을 때만.
   * rate limit (lastStartAt + minStartIntervalMs) 미달 시 잔여 시간 후 재시도.
   */
  private scheduleNextDispatch(): void {
    if (!this.running || this.activeJob) return
    if (this.dispatchHandle !== null) {
      this.clearScheduledTimer(this.dispatchHandle)
      this.dispatchHandle = null
    }
    const queued = this.store.listQueued()
    if (queued.length === 0) return

    const wait = this.computeStartWaitMs()
    this.dispatchHandle = this.scheduleTimer(() => {
      this.dispatchHandle = null
      this.dispatchNext().catch(() => {
        // processor / store 단 예외는 dispatchNext 내부에서 status='failed' 흡수. 여기서는 silent.
      })
    }, wait)
  }

  /**
   * 다음 job 처리. 큐 비었거나 activeJob 존재 시 no-op.
   * rate limit 재검증 후 처리 시작.
   */
  private async dispatchNext(): Promise<void> {
    if (!this.running || this.activeJob) return
    const queued = this.store.listQueued()
    if (queued.length === 0) return
    const wait = this.computeStartWaitMs()
    if (wait > 0) {
      this.scheduleNextDispatch()
      return
    }

    const job = queued[0]
    const startedAt = this.now()
    this.lastStartAt = startedAt
    const updated = this.store.update(job.id, {
      status: 'in_progress',
      startedAt,
      progressPct: 0
    })
    if (!updated) {
      this.scheduleNextDispatch()
      return
    }

    const abort = new AbortController()
    this.activeJob = { jobId: job.id, abort }

    const ctx: ProcessorContext = {
      signal: abort.signal,
      reportProgress: (pct) => this.reportProgress(job.id, pct)
    }

    let resultPatch: Partial<TranslationJob>
    let finalStatus: TranslationJobStatus = 'completed'
    try {
      const result = await this.processor(updated, ctx)
      // cancel 이 진행 중이었을 수 있음 — completed 저장 직전 재확인
      const current = this.store.findById(job.id)
      if (abort.signal.aborted || current?.status === 'cancelled') {
        finalStatus = 'cancelled'
        resultPatch = {
          status: 'cancelled',
          completedAt: this.now()
        }
      } else {
        resultPatch = {
          status: 'completed',
          translatedText: result.translatedText,
          estimatedCostUsd: result.estimatedCostUsd ?? updated.estimatedCostUsd,
          model: result.model ?? updated.model,
          progressPct: 100,
          completedAt: this.now()
        }
      }
    } catch (e) {
      if (abort.signal.aborted) {
        finalStatus = 'cancelled'
        resultPatch = {
          status: 'cancelled',
          completedAt: this.now()
        }
      } else {
        finalStatus = 'failed'
        resultPatch = {
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : String(e),
          errorCode: 'PROCESSOR_THROW',
          completedAt: this.now()
        }
      }
    } finally {
      this.activeJob = null
      this.lastProgressEmitAt.delete(job.id)
    }

    const final = this.store.update(job.id, resultPatch)
    if (final) {
      this.emitter.emit(finalStatus, final)
      if (finalStatus === 'completed') {
        this.maybeEmitThreshold(final.providerId)
      }
    }
    this.scheduleNextDispatch()
  }

  /**
   * progress coalesce — 마지막 emit 후 progressCoalesceMs 미만이면 store update 만 (event 안 emit).
   * 100% 는 항상 즉시.
   */
  private reportProgress(jobId: string, pct: number): void {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)))
    this.store.update(jobId, { progressPct: clamped })
    const now = this.now()
    const last = this.lastProgressEmitAt.get(jobId) ?? 0
    const immediate = clamped >= 100
    if (immediate || now - last >= this.policy.progressCoalesceMs) {
      this.lastProgressEmitAt.set(jobId, now)
      const job = this.store.findById(jobId)
      if (job) this.emitter.emit('progress', job)
    }
  }

  /** 다음 job 시작까지 남은 wait ms. */
  private computeStartWaitMs(): number {
    if (this.lastStartAt === null) return 0
    const elapsed = this.now() - this.lastStartAt
    const wait = this.policy.minStartIntervalMs - elapsed
    return wait > 0 ? wait : 0
  }

  /**
   * threshold sliding window (5h) 내 completed 카운트 — provider 별. 초과 시 warn-only event.
   * 차단 X (PRD §14.8 + codex T18 협의 정합).
   */
  private maybeEmitThreshold(providerId: string): void {
    const now = this.now()
    const windowStart = now - this.policy.thresholdWindowMs
    const completedInWindow = this.store
      .listAll()
      .filter(
        (j) =>
          j.providerId === providerId &&
          j.status === 'completed' &&
          (j.completedAt ?? 0) >= windowStart
      ).length
    if (completedInWindow >= this.policy.thresholdPages) {
      this.emitter.emit('thresholdExceeded', {
        providerId,
        completedInWindow,
        thresholdPages: this.policy.thresholdPages,
        windowMs: this.policy.thresholdWindowMs
      })
    }
  }
}

export const __testing = {
  DEFAULT_POLICY
}
