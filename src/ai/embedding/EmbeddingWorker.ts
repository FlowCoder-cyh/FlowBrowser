/**
 * Sprint 018 M2 write-path wiring — EmbeddingQueue drainer (백그라운드 임베딩 worker).
 *
 * 배경: `processNextEmbeddingJob`(EmbeddingClient.ts) 는 단일 잡 파이프라인이지만 prod 호출자가 없어
 * enqueue 된 잡이 영영 처리되지 않았다 (T17b/c 까지 query path 만 provider-aware). 본 worker 가 그 호출자다.
 *
 * 동작 (codex 019e6ea0 협의):
 *   - polling MVP — start() 시 즉시 1회 drain, 이후 setTimeout(pollIntervalMs) 로 재진입 (event-driven wake() 는 후속).
 *   - drain: idle / provider_unavailable / maxBatch 도달 / stop 까지 processNextEmbeddingJob 반복.
 *     · idle              → 큐 비어 다음 폴링 (pollIntervalMs)
 *     · provider_unavailable → release(→pending) 된 상태, backoffIntervalMs 후 재시도 (환경 복구 자동 회복)
 *     · maxBatch 도달      → 0ms 재스케줄 (event loop 양보 후 계속 drain — 대량 backlog 독점 방지)
 *     · succeeded/failed/orphan → 다음 잡 계속
 *   - boot orphan 회복: start() 직전 requeueStaleOnStart() 1회 (직전 종료 시 in_progress 로 stuck 된 잡 복귀).
 *   - stop(): running=false + 타이머 해제. 진행 중 embed 는 취소 불가 — 그 잡은 in_progress 로 남고 다음 boot
 *     requeueStaleOnStart 가 회복 (codex 019e6ea0 추가 결함).
 *
 * 알려진 한계 (MVP, codex C3): claimNext 가 priority DESC 로만 집어 provider 를 모르므로, 미가용 provider 의
 * 고우선 잡 1개가 가용 provider 잡 전체를 막을 수 있다 (provider_unavailable → release → 재claim 동일 잡 반복).
 * provider/workspace 별 cooldown 또는 claimNext 필터링은 후속.
 *
 * 순수 모듈 — deps 주입 (timer 포함) 으로 단위 테스트 결정적 (codex Q4).
 */

import type { ProcessJobResult } from './EmbeddingClient'

export type EmbeddingWorkerTimer = ReturnType<typeof setTimeout>

export interface EmbeddingWorkerOptions {
  /** 단일 잡 처리 — 보통 `() => processNextEmbeddingJob(deps)` 바인딩 (services.ts). */
  processJob: () => Promise<ProcessJobResult>
  /** start() 직전 1회 — boot 시 orphan in_progress → pending 회복. 보통 `() => queue.requeueInProgress()`. */
  requeueStaleOnStart?: () => number
  /** idle 폴링 간격 (ms). 디폴트 3000. */
  pollIntervalMs?: number
  /** provider 미가용 시 재시도 backoff (ms). 디폴트 30000. */
  backoffIntervalMs?: number
  /** 한 tick 당 최대 처리 건수 (event loop 양보 단위). 디폴트 10. */
  maxBatch?: number
  /** 주입형 타이머 (테스트 결정성). 디폴트 global setTimeout/clearTimeout. */
  setTimer?: (cb: () => void, ms: number) => EmbeddingWorkerTimer
  clearTimer?: (handle: EmbeddingWorkerTimer) => void
  /** drain 중 예상 못 한 throw 보고 (processNextEmbeddingJob 은 내부 catch 하므로 보통 미발생). */
  onError?: (err: unknown) => void
  /** 진단 로그 (선택). */
  log?: (message: string) => void
}

const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_BACKOFF_INTERVAL_MS = 30000
const DEFAULT_MAX_BATCH = 10

export class EmbeddingWorker {
  private readonly processJob: () => Promise<ProcessJobResult>
  private readonly requeueStaleOnStart?: () => number
  private readonly pollIntervalMs: number
  private readonly backoffIntervalMs: number
  private readonly maxBatch: number
  private readonly setTimer: (cb: () => void, ms: number) => EmbeddingWorkerTimer
  private readonly clearTimer: (handle: EmbeddingWorkerTimer) => void
  private readonly onError?: (err: unknown) => void
  private readonly log?: (message: string) => void

  private running = false
  /** tick 재진입 가드 — 한 번에 하나의 drain 만 (start 중복 호출 / 타이머 경합 대비). */
  private draining = false
  private timer: EmbeddingWorkerTimer | null = null

  constructor(opts: EmbeddingWorkerOptions) {
    this.processJob = opts.processJob
    this.requeueStaleOnStart = opts.requeueStaleOnStart
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.backoffIntervalMs = opts.backoffIntervalMs ?? DEFAULT_BACKOFF_INTERVAL_MS
    this.maxBatch = opts.maxBatch ?? DEFAULT_MAX_BATCH
    this.setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle))
    this.onError = opts.onError
    this.log = opts.log
  }

  /** 실행 중 여부 (테스트/진단). */
  isRunning(): boolean {
    return this.running
  }

  /**
   * worker 시작 — boot orphan 회복 후 즉시 첫 drain 스케줄. 이미 실행 중이면 no-op (idempotent).
   */
  start(): void {
    if (this.running) return
    this.running = true
    if (this.requeueStaleOnStart) {
      try {
        const requeued = this.requeueStaleOnStart()
        if (requeued > 0) this.log?.(`[EmbeddingWorker] boot 시 in_progress ${requeued}건 → pending 회복`)
      } catch (err) {
        this.onError?.(err)
      }
    }
    this.schedule(0)
  }

  /**
   * worker 정지 — 타이머 해제 + running=false. 진행 중 embed 는 취소 불가 (in_progress 로 남아 다음 boot 회복).
   */
  stop(): void {
    this.running = false
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private schedule(ms: number): void {
    if (!this.running) return
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.tick()
    }, ms)
  }

  /** 한 tick — maxBatch 건 또는 idle/provider_unavailable 까지 drain 후 다음 스케줄. */
  private async tick(): Promise<void> {
    if (!this.running || this.draining) return
    this.draining = true
    let nextDelay = this.pollIntervalMs
    try {
      let processed = 0
      while (this.running) {
        const result = await this.processJob()
        // stop() 이 drain 도중 호출됐을 수 있음 — 결과 반영 후 즉시 종료.
        if (!this.running) return
        if (result.status === 'idle') {
          nextDelay = this.pollIntervalMs
          break
        }
        if (result.status === 'provider_unavailable') {
          nextDelay = this.backoffIntervalMs
          break
        }
        // succeeded / failed / orphan → 다음 잡
        processed++
        if (processed >= this.maxBatch) {
          // 더 남았을 수 있음 — event loop 양보 후 즉시 다음 tick.
          nextDelay = 0
          break
        }
      }
    } catch (err) {
      // processNextEmbeddingJob 은 내부 catch 하므로 보통 미도달. 방어적으로 backoff.
      this.onError?.(err)
      nextDelay = this.backoffIntervalMs
    } finally {
      this.draining = false
      if (this.running) this.schedule(nextDelay)
    }
  }
}
