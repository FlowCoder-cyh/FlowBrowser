/**
 * Sprint 018 M2 write-path wiring — EmbeddingWorker 단위 테스트.
 *
 * 주입형 타이머(setTimer/clearTimer) + mock processJob 으로 결정적 검증:
 *   - drain until idle → pollInterval 재스케줄
 *   - provider_unavailable → backoffInterval 재스케줄 (release 는 processNextEmbeddingJob 책임)
 *   - maxBatch 도달 → 0ms 재스케줄 (event loop 양보)
 *   - succeeded/failed/orphan → 계속 drain
 *   - start() boot 시 requeueStaleOnStart 1회 + idempotent
 *   - stop() → 타이머 해제 + running=false + 이후 미스케줄
 */

import { describe, it, expect, vi } from 'vitest'

import { EmbeddingWorker } from '../../../src/ai/embedding/EmbeddingWorker'
import type { ProcessJobResult } from '../../../src/ai/embedding/EmbeddingClient'

const POLL = 3000
const BACKOFF = 30000

interface Harness {
  worker: EmbeddingWorker
  processJob: ReturnType<typeof vi.fn>
  requeueStale: ReturnType<typeof vi.fn>
  /** 마지막으로 스케줄된 타이머 (worker 는 동시 1개만 유지). */
  scheduled: { cb: () => void; ms: number } | null
  /** 스케줄된 타이머 발화 + worker 의 비동기 drain 완료까지 flush. */
  fire: () => Promise<void>
}

function makeWorker(
  results: ProcessJobResult['status'][],
  opts: { maxBatch?: number } = {}
): Harness {
  const queue = [...results]
  // 결과 소진 후엔 idle 반복 (무한 대기 방지).
  const processJob = vi.fn(async (): Promise<ProcessJobResult> => {
    const status = queue.shift() ?? 'idle'
    return { status }
  })
  const requeueStale = vi.fn(() => 0)

  const h: Harness = {
    scheduled: null,
    processJob,
    requeueStale,
    worker: null as unknown as EmbeddingWorker,
    fire: async () => {
      const s = h.scheduled
      if (!s) throw new Error('no timer scheduled')
      h.scheduled = null
      s.cb()
      // worker 의 drain 은 resolved-promise 체인 — 실 setTimeout(0) 1회로 전체 microtask flush.
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  let nextId = 1
  h.worker = new EmbeddingWorker({
    processJob,
    requeueStaleOnStart: requeueStale,
    pollIntervalMs: POLL,
    backoffIntervalMs: BACKOFF,
    maxBatch: opts.maxBatch ?? 10,
    setTimer: (cb, ms) => {
      h.scheduled = { cb, ms }
      return nextId++ as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: () => {
      h.scheduled = null
    }
  })
  return h
}

describe('EmbeddingWorker', () => {
  let h: Harness

  it('start() → requeueStaleOnStart 1회 + 즉시(0ms) 첫 drain 스케줄', () => {
    h = makeWorker(['idle'])
    h.worker.start()
    expect(h.requeueStale).toHaveBeenCalledTimes(1)
    expect(h.worker.isRunning()).toBe(true)
    expect(h.scheduled?.ms).toBe(0)
    // 아직 processJob 호출 전 (타이머 발화 전)
    expect(h.processJob).not.toHaveBeenCalled()
  })

  it('drain until idle → pollInterval 재스케줄', async () => {
    h = makeWorker(['succeeded', 'succeeded', 'idle'])
    h.worker.start()
    await h.fire()
    // 2 succeeded + 1 idle = 3회 호출 후 idle 에서 break
    expect(h.processJob).toHaveBeenCalledTimes(3)
    expect(h.scheduled?.ms).toBe(POLL)
  })

  it('provider_unavailable → backoffInterval 재스케줄 (즉시 break)', async () => {
    h = makeWorker(['provider_unavailable', 'succeeded'])
    h.worker.start()
    await h.fire()
    // 첫 잡 provider_unavailable 에서 즉시 break — 두 번째 잡 안 집음
    expect(h.processJob).toHaveBeenCalledTimes(1)
    expect(h.scheduled?.ms).toBe(BACKOFF)
  })

  it('failed / orphan → 계속 drain (영구 실패도 다음 잡 진행)', async () => {
    h = makeWorker(['failed', 'orphan', 'succeeded', 'idle'])
    h.worker.start()
    await h.fire()
    expect(h.processJob).toHaveBeenCalledTimes(4)
    expect(h.scheduled?.ms).toBe(POLL)
  })

  it('maxBatch 도달 → 0ms 재스케줄 (남은 잡 다음 tick 에서 계속)', async () => {
    h = makeWorker(['succeeded', 'succeeded', 'succeeded', 'idle'], { maxBatch: 2 })
    h.worker.start()
    await h.fire() // 2건 처리 후 maxBatch → 0ms
    expect(h.processJob).toHaveBeenCalledTimes(2)
    expect(h.scheduled?.ms).toBe(0)
    await h.fire() // 1 succeeded + idle
    expect(h.processJob).toHaveBeenCalledTimes(4)
    expect(h.scheduled?.ms).toBe(POLL)
  })

  it('idle 폴링 반복 — fire 마다 큐 재확인', async () => {
    h = makeWorker(['idle'])
    h.worker.start()
    await h.fire()
    expect(h.scheduled?.ms).toBe(POLL)
    // 다음 폴링도 idle (큐 소진 → idle 반복)
    await h.fire()
    expect(h.scheduled?.ms).toBe(POLL)
    expect(h.processJob).toHaveBeenCalledTimes(2)
  })

  it('stop() → running=false + 타이머 해제 + 이후 미스케줄', async () => {
    h = makeWorker(['succeeded', 'idle'])
    h.worker.start()
    await h.fire() // idle → poll 스케줄됨
    expect(h.scheduled).not.toBeNull()
    h.worker.stop()
    expect(h.worker.isRunning()).toBe(false)
    expect(h.scheduled).toBeNull()
  })

  it('stop() 직후 start() 안 한 상태 → 발화 대상 없음', () => {
    h = makeWorker(['idle'])
    h.worker.start()
    h.worker.stop()
    expect(h.scheduled).toBeNull()
    expect(h.worker.isRunning()).toBe(false)
  })

  it('start() idempotent — 중복 호출 시 requeueStale 1회 + 타이머 1개', () => {
    h = makeWorker(['idle'])
    h.worker.start()
    h.worker.start()
    expect(h.requeueStale).toHaveBeenCalledTimes(1)
    expect(h.worker.isRunning()).toBe(true)
  })

  it('drain 중 stop() → 진행 중 결과 반영 후 재스케줄 안 함', async () => {
    // processJob 이 호출되는 순간 stop() — 결과는 반영되지만 다음 스케줄 없음.
    const queue: ProcessJobResult['status'][] = ['succeeded', 'succeeded', 'idle']
    let nextId = 1
    const scheduledRef: { cb: () => void; ms: number } | null = null
    const box = { scheduled: scheduledRef as { cb: () => void; ms: number } | null }
    const worker = new EmbeddingWorker({
      processJob: async () => {
        worker.stop() // 첫 잡 처리 직후 정지 요청
        return { status: queue.shift() ?? 'idle' }
      },
      pollIntervalMs: POLL,
      backoffIntervalMs: BACKOFF,
      setTimer: (cb, ms) => {
        box.scheduled = { cb, ms }
        return nextId++ as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {
        box.scheduled = null
      }
    })
    worker.start()
    const first = box.scheduled!
    box.scheduled = null
    first.cb()
    await new Promise((r) => setTimeout(r, 0))
    // stop() 이 running=false → tick 의 finally 가 schedule 안 함
    expect(worker.isRunning()).toBe(false)
    expect(box.scheduled).toBeNull()
  })
})
