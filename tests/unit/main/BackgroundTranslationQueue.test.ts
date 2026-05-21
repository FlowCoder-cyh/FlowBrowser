/**
 * Sprint 016 M4 T18 — BackgroundTranslationQueue 단위 회귀.
 *
 * cover (codex T18 사전 협의 5 위험 방지선 정합):
 *   1. enqueue + FIFO order
 *   2. processor 정상 → 'completed' + event
 *   3. processor throw → 'failed' + event + errorMessage
 *   4. cancel pending → 'cancelled' 즉시 + event
 *   5. cancel running → AbortController + processor 종료 후 'cancelled'
 *   6. throttle: job 시작 간 최소 60초 (minStartIntervalMs)
 *   7. threshold sliding window warn-only (차단 X)
 *   8. progress coalesce (5초 간격 + 100% 즉시)
 *   9. event listener API (on/off/once)
 *  10. recoverRunnableJobs (in_progress 리셋)
 *  11. enqueue 입력 검증
 *  12. constructor 입력 검증
 *
 * vi.useFakeTimers — Date.now() 시간 제어 + setTimeout 추적.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  BackgroundTranslationQueue,
  InMemoryTranslationJobStore,
  __testing,
  type TranslationJob,
  type JobProcessor,
  type QueueEventMap,
  type QueuePolicy
} from '../../../src/main/BackgroundTranslationQueue'

interface FakeTime {
  now: number
}

interface Fx {
  fakeTime: FakeTime
  store: InMemoryTranslationJobStore
  /** scheduled timers — { fn, fireAt }. flush(toTime) 호출 시 발화. */
  timers: Array<{ id: number; fn: () => void; fireAt: number }>
  nextTimerId: number
}

function setupFx(): Fx {
  const fakeTime: FakeTime = { now: 1_000_000 }
  const store = new InMemoryTranslationJobStore()
  return { fakeTime, store, timers: [], nextTimerId: 1 }
}

function makeQueue(
  fx: Fx,
  processor: JobProcessor,
  policy?: Partial<QueuePolicy>
): BackgroundTranslationQueue {
  const q = new BackgroundTranslationQueue({
    store: fx.store,
    processor,
    policy,
    now: () => fx.fakeTime.now,
    scheduleTimer: (fn, ms) => {
      const id = fx.nextTimerId++
      fx.timers.push({ id, fn, fireAt: fx.fakeTime.now + ms })
      return id
    },
    clearScheduledTimer: (handle) => {
      fx.timers = fx.timers.filter((t) => t.id !== handle)
    }
  })
  return q
}

/** 시간을 advance + 발화 시점 도달한 timer 모두 발화. */
function advance(fx: Fx, ms: number): void {
  fx.fakeTime.now += ms
  const due = fx.timers.filter((t) => t.fireAt <= fx.fakeTime.now)
  fx.timers = fx.timers.filter((t) => t.fireAt > fx.fakeTime.now)
  for (const t of due) t.fn()
}

/** processor 결과를 외부 제어 가능한 deferred Promise. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('InMemoryTranslationJobStore', () => {
  it('insert + findById + listQueued + listAll', () => {
    const store = new InMemoryTranslationJobStore()
    const job: TranslationJob = {
      id: 'j1',
      workspaceId: 'ws',
      pageId: null,
      sourceText: 'src',
      sourceLang: null,
      targetLang: 'ko',
      translatedText: null,
      providerId: 'openai-key',
      model: null,
      reasoningEffort: null,
      status: 'queued',
      progressPct: 0,
      estimatedCostUsd: null,
      createdAt: 1,
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null
    }
    store.insert(job)
    expect(store.findById('j1')).toEqual(job)
    expect(store.listQueued()).toHaveLength(1)
    expect(store.listAll()).toHaveLength(1)
  })

  it('insert duplicate → throw', () => {
    const store = new InMemoryTranslationJobStore()
    const job = makeJob('j1', 'queued')
    store.insert(job)
    expect(() => store.insert(job)).toThrow(/duplicate/)
  })

  it('update partial — id 변경 안 됨', () => {
    const store = new InMemoryTranslationJobStore()
    store.insert(makeJob('j1', 'queued', 100))
    const updated = store.update('j1', { status: 'in_progress' as never })
    expect(updated?.id).toBe('j1')
    expect(updated?.status).toBe('in_progress')
  })

  it('listQueued — queued 만 + createdAt asc', () => {
    const store = new InMemoryTranslationJobStore()
    store.insert(makeJob('j3', 'queued', 300))
    store.insert(makeJob('j1', 'queued', 100))
    store.insert(makeJob('j2', 'completed', 200))
    const queued = store.listQueued()
    expect(queued.map((j) => j.id)).toEqual(['j1', 'j3'])
  })

  it('recoverRunnableJobs in-memory → 빈 배열', () => {
    const store = new InMemoryTranslationJobStore()
    store.insert(makeJob('j1', 'queued'))
    store.insert(makeJob('j2', 'in_progress'))
    expect(store.recoverRunnableJobs()).toEqual([])
  })
})

describe('BackgroundTranslationQueue — enqueue', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('정상 enqueue — id 자동 + status=queued + createdAt=now', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    const job = q.enqueue({
      workspaceId: 'ws',
      sourceText: 'hi',
      providerId: 'openai-key'
    })
    expect(job.id).toBeDefined()
    expect(job.status).toBe('queued')
    expect(job.createdAt).toBe(fx.fakeTime.now)
    expect(job.targetLang).toBe('ko') // 디폴트
  })

  it('FIFO order — 3개 enqueue 후 listQueued 동일 순서', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    const j1 = q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    fx.fakeTime.now += 1
    const j2 = q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    fx.fakeTime.now += 1
    const j3 = q.enqueue({ workspaceId: 'ws', sourceText: 'c', providerId: 'p' })
    const queued = fx.store.listQueued()
    expect(queued.map((j) => j.id)).toEqual([j1.id, j2.id, j3.id])
  })

  it('입력 검증 — workspaceId 빈 → throw', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    expect(() =>
      q.enqueue({ workspaceId: '', sourceText: 'x', providerId: 'p' })
    ).toThrow(/workspaceId/)
  })

  it('입력 검증 — sourceText 빈/whitespace → throw', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    expect(() =>
      q.enqueue({ workspaceId: 'ws', sourceText: '', providerId: 'p' })
    ).toThrow(/sourceText/)
    expect(() =>
      q.enqueue({ workspaceId: 'ws', sourceText: '   ', providerId: 'p' })
    ).toThrow(/sourceText/)
  })

  it('입력 검증 — providerId 빈 → throw', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    expect(() =>
      q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: '' })
    ).toThrow(/providerId/)
  })
})

describe('BackgroundTranslationQueue — processor 정상/실패', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('processor 정상 → completed event + translatedText 저장', async () => {
    const q = makeQueue(fx, async () => ({ translatedText: '안녕', estimatedCostUsd: 0.001 }))
    const completed = vi.fn()
    q.on('completed', completed)
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'hello', providerId: 'p' })
    q.start()
    // 첫 dispatch (lastStartAt=null → wait=0) → setTimeout 0
    advance(fx, 0)
    // processor microtask flush
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    const final = fx.store.findById(job.id)!
    expect(final.status).toBe('completed')
    expect(final.translatedText).toBe('안녕')
    expect(final.estimatedCostUsd).toBe(0.001)
    expect(final.progressPct).toBe(100)
    expect(final.completedAt).toBe(fx.fakeTime.now)
  })

  it('processor throw → failed event + errorMessage + errorCode', async () => {
    const q = makeQueue(fx, async () => {
      throw new Error('rate limit')
    })
    const failed = vi.fn()
    q.on('failed', failed)
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    const final = fx.store.findById(job.id)!
    expect(final.status).toBe('failed')
    expect(final.errorMessage).toBe('rate limit')
    expect(final.errorCode).toBe('PROCESSOR_THROW')
  })
})

describe('BackgroundTranslationQueue — cancel', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('cancel pending → cancelled 즉시 + event + completedAt 박힘', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    const cancelled = vi.fn()
    q.on('cancelled', cancelled)
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: 'p' })
    // start 안 함 — pending
    const result = q.cancel(job.id)
    expect(result).toBe(true)
    expect(cancelled).toHaveBeenCalledTimes(1)
    const final = fx.store.findById(job.id)!
    expect(final.status).toBe('cancelled')
    expect(final.completedAt).toBe(fx.fakeTime.now)
  })

  it('cancel running → AbortController + processor 종료 후 cancelled', async () => {
    const d = deferred<{ translatedText: string }>()
    const abortSignals: AbortSignal[] = []
    const q = makeQueue(fx, async (_job, ctx) => {
      abortSignals.push(ctx.signal)
      return d.promise
    })
    const cancelled = vi.fn()
    q.on('cancelled', cancelled)
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: 'p' })
    q.start()
    advance(fx, 0)
    // processor 실행 중 — activeJob 박힘
    await vi.waitFor(() => expect(abortSignals).toHaveLength(1))
    expect(q.getActiveJob()?.status).toBe('in_progress')

    // cancel 호출
    const result = q.cancel(job.id)
    expect(result).toBe(true)
    expect(abortSignals[0].aborted).toBe(true)
    // processor 가 무시하고 정상 resolve 해도 cancelled 수렴
    d.resolve({ translatedText: 'should not save' })
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
    const final = fx.store.findById(job.id)!
    expect(final.status).toBe('cancelled')
    expect(final.translatedText).toBeNull()
  })

  it('cancel 미존재 jobId → false', () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    expect(q.cancel('nonexistent')).toBe(false)
  })

  it('cancel completed → false (no-op)', async () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(job.id)?.status).toBe('completed'))
    expect(q.cancel(job.id)).toBe(false)
  })
})

describe('BackgroundTranslationQueue — throttle (minStartIntervalMs)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('두 번째 job 은 첫 시작 후 60초 후에 시작', async () => {
    const startTimes: number[] = []
    const q = makeQueue(fx, async (job) => {
      startTimes.push(fx.fakeTime.now)
      return { translatedText: `t-${job.id}` }
    })
    const j1 = q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    const j2 = q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j1.id)?.status).toBe('completed'))
    // 두 번째 dispatch 는 60초 대기
    expect(fx.store.findById(j2.id)?.status).toBe('queued')
    // 30초 advance → 아직 미시작
    advance(fx, 30_000)
    expect(fx.store.findById(j2.id)?.status).toBe('queued')
    // 추가 30초 → 60초 도달 → 시작
    advance(fx, 30_000)
    await vi.waitFor(() => expect(fx.store.findById(j2.id)?.status).toBe('completed'))
    // startTimes 가 60초 이상 차이
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(60_000)
  })

  it('policy 디폴트 minStartIntervalMs = 60000', () => {
    expect(__testing.DEFAULT_POLICY.minStartIntervalMs).toBe(60_000)
  })
})

describe('BackgroundTranslationQueue — threshold warn-only', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('threshold 초과 시 thresholdExceeded event 1회 (codex NC #4 dedupe — 매 completed 마다 emit X)', async () => {
    const thresholdSpy = vi.fn()
    const q = makeQueue(
      fx,
      async () => ({ translatedText: 'ok' }),
      { thresholdPages: 2, minStartIntervalMs: 0, thresholdWindowMs: 1_000_000 }
    )
    q.on('thresholdExceeded', thresholdSpy)
    const j1 = q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    const j2 = q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    const j3 = q.enqueue({ workspaceId: 'ws', sourceText: 'c', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j1.id)?.status).toBe('completed'))
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j2.id)?.status).toBe('completed'))
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j3.id)?.status).toBe('completed'))
    // threshold 2 → j2 completed 시 1회만 emit (j3 도 above 유지하지만 dedupe → 추가 emit X)
    expect(thresholdSpy).toHaveBeenCalledTimes(1)
    // 모든 job 정상 completed (차단 X)
    expect(fx.store.findById(j3.id)?.status).toBe('completed')
  })

  it('threshold sliding window — 오래된 completed 는 카운트 제외', async () => {
    const thresholdSpy = vi.fn()
    const q = makeQueue(
      fx,
      async () => ({ translatedText: 'ok' }),
      { thresholdPages: 2, minStartIntervalMs: 0, thresholdWindowMs: 100 }
    )
    q.on('thresholdExceeded', thresholdSpy)
    const j1 = q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j1.id)?.status).toBe('completed'))
    // 200ms advance — 이전 completed 가 window 밖
    advance(fx, 200)
    const j2 = q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.findById(j2.id)?.status).toBe('completed'))
    // j1 (window 밖) + j2 (window 안) = 1 → threshold 2 미달 → event 없음
    expect(thresholdSpy).not.toHaveBeenCalled()
  })
})

describe('BackgroundTranslationQueue — progress coalesce', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('progress 5초 미만 연속 호출 → event 1회 (coalesce) / store 는 매번 update', async () => {
    const d = deferred<{ translatedText: string }>()
    let capturedCtx: { reportProgress: (pct: number) => void } | null = null
    const q = makeQueue(fx, async (_job, ctx) => {
      capturedCtx = ctx
      return d.promise
    })
    const progressSpy = vi.fn()
    q.on('progress', progressSpy)
    const job = q.enqueue({ workspaceId: 'ws', sourceText: 'x', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(capturedCtx).not.toBeNull())

    // 첫 progress (last=0, now=1000000 → 즉시 emit)
    capturedCtx!.reportProgress(10)
    expect(progressSpy).toHaveBeenCalledTimes(1)
    // 같은 시점 추가 progress — coalesce (now - last < 5000)
    capturedCtx!.reportProgress(20)
    capturedCtx!.reportProgress(30)
    expect(progressSpy).toHaveBeenCalledTimes(1)
    // store 는 매번 update
    expect(fx.store.findById(job.id)?.progressPct).toBe(30)

    // 5초 advance → 다음 progress emit
    advance(fx, 5000)
    capturedCtx!.reportProgress(40)
    expect(progressSpy).toHaveBeenCalledTimes(2)

    // 100% 는 즉시 (coalesce 무시)
    capturedCtx!.reportProgress(100)
    expect(progressSpy).toHaveBeenCalledTimes(3)

    d.resolve({ translatedText: 'done' })
    await vi.waitFor(() => expect(fx.store.findById(job.id)?.status).toBe('completed'))
  })
})

describe('BackgroundTranslationQueue — event listener API', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('on / off / once', async () => {
    const q = makeQueue(fx, async () => ({ translatedText: 'ok' }))
    const onSpy = vi.fn()
    const onceSpy = vi.fn()
    q.on('completed', onSpy)
    q.once('completed', onceSpy)

    q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(onSpy).toHaveBeenCalledTimes(1))
    advance(fx, 60_000)
    await vi.waitFor(() => expect(onSpy).toHaveBeenCalledTimes(2))
    expect(onceSpy).toHaveBeenCalledTimes(1) // once

    q.off('completed', onSpy)
    q.enqueue({ workspaceId: 'ws', sourceText: 'c', providerId: 'p' })
    advance(fx, 60_000)
    await vi.waitFor(() => expect(fx.store.listAll().filter((j) => j.status === 'completed').length).toBe(3))
    expect(onSpy).toHaveBeenCalledTimes(2) // off 후 추가 호출 없음
  })
})

describe('BackgroundTranslationQueue — recoverRunnableJobs', () => {
  it('start() 시 in_progress 항목 → queued 리셋 (PRD §14.8)', () => {
    const fx = setupFx()
    // 사전 박음 — recoverRunnableJobs 가 in_progress 반환하는 store stub
    const inProgressJob = makeJob('j-recovery', 'in_progress', 100)
    inProgressJob.startedAt = 999
    inProgressJob.progressPct = 50
    const stubStore = {
      ...fx.store,
      insert: (j: TranslationJob) => fx.store.insert(j),
      update: (id: string, p: Partial<TranslationJob>) => fx.store.update(id, p),
      findById: (id: string) => fx.store.findById(id),
      listQueued: () => fx.store.listQueued(),
      listAll: () => fx.store.listAll(),
      recoverRunnableJobs: () => [inProgressJob],
      countCompletedInWindow: (p: string, w: number) =>
        fx.store.countCompletedInWindow(p, w)
    }
    fx.store.insert(inProgressJob) // 큐 update 가 찾을 수 있도록 동일 store 에 박음
    const q = new BackgroundTranslationQueue({
      store: stubStore,
      processor: async () => ({ translatedText: 'ok' }),
      now: () => fx.fakeTime.now,
      scheduleTimer: (fn, ms) => {
        const id = fx.nextTimerId++
        fx.timers.push({ id, fn, fireAt: fx.fakeTime.now + ms })
        return id
      },
      clearScheduledTimer: (handle) => {
        fx.timers = fx.timers.filter((t) => t.id !== handle)
      }
    })
    q.start()
    // in_progress → queued 리셋
    const after = fx.store.findById('j-recovery')!
    expect(after.status).toBe('queued')
    expect(after.startedAt).toBeNull()
    expect(after.progressPct).toBe(0)
  })
})

describe('BackgroundTranslationQueue — constructor 입력 검증', () => {
  it('store 미주입 → throw', () => {
    expect(
      () =>
        new BackgroundTranslationQueue({
          store: undefined as never,
          processor: async () => ({ translatedText: 'ok' })
        })
    ).toThrow(/store/)
  })

  it('processor 미주입 → throw', () => {
    expect(
      () =>
        new BackgroundTranslationQueue({
          store: new InMemoryTranslationJobStore(),
          processor: undefined as never
        })
    ).toThrow(/processor/)
  })
})

describe('BackgroundTranslationQueue — typed event handlers cover', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('thresholdExceeded payload schema', async () => {
    const q = makeQueue(
      fx,
      async () => ({ translatedText: 'ok' }),
      { thresholdPages: 1, minStartIntervalMs: 0, thresholdWindowMs: 1_000_000 }
    )
    const payloads: Parameters<QueueEventMap['thresholdExceeded']>[0][] = []
    q.on('thresholdExceeded', (info) => payloads.push(info))
    q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'openai-key' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0]).toMatchObject({
      providerId: 'openai-key',
      completedInWindow: 1,
      thresholdPages: 1
    })
    expect(typeof payloads[0].windowMs).toBe('number')
  })
})

describe('BackgroundTranslationQueue — codex T18 NEEDS_CHANGES hotfix', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })

  it('NC #1 — stop() 후 start() 재호출 중 activeJob 있으면 recoverRunnableJobs skip', () => {
    // 시나리오: stop() 호출했으나 active job processor 가 아직 진행 중. 다시 start() 시
    // SQLite store 가 in_progress job 을 recover 해 'queued' 로 리셋하면 동일 job 이중처리 위험.
    const recoverCalled = vi.fn(() => [] as TranslationJob[])
    const stubStore = {
      insert: (j: TranslationJob) => fx.store.insert(j),
      update: (id: string, p: Partial<TranslationJob>) => fx.store.update(id, p),
      findById: (id: string) => fx.store.findById(id),
      listQueued: () => fx.store.listQueued(),
      listAll: () => fx.store.listAll(),
      recoverRunnableJobs: recoverCalled,
      countCompletedInWindow: (p: string, w: number) =>
        fx.store.countCompletedInWindow(p, w)
    }
    const d = deferred<{ translatedText: string }>()
    const q = new BackgroundTranslationQueue({
      store: stubStore,
      processor: async () => d.promise,
      now: () => fx.fakeTime.now,
      scheduleTimer: (fn, ms) => {
        const id = fx.nextTimerId++
        fx.timers.push({ id, fn, fireAt: fx.fakeTime.now + ms })
        return id
      },
      clearScheduledTimer: (handle) => {
        fx.timers = fx.timers.filter((t) => t.id !== handle)
      }
    })
    q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    q.start()
    expect(recoverCalled).toHaveBeenCalledTimes(1)
    advance(fx, 0)
    // active job 진행 중
    return vi.waitFor(() => expect(q.getActiveJob()).not.toBeNull()).then(() => {
      // stop() 후 다시 start() — recover skip 검증
      q.stop()
      recoverCalled.mockClear()
      q.start()
      expect(recoverCalled).toHaveBeenCalledTimes(0)
      // cleanup
      d.resolve({ translatedText: 'x' })
    })
  })

  it('NC #2 — update() 반환 객체 mutate 시 store 영향 없음 (참조 누출 차단)', () => {
    const store = new InMemoryTranslationJobStore()
    const job = makeJob('j1', 'queued', 100)
    store.insert(job)
    const updated = store.update('j1', { status: 'in_progress' })!
    // 반환 객체 mutate
    updated.translatedText = 'leak'
    updated.progressPct = 999
    // store 내부 상태 영향 없음
    const fetched = store.findById('j1')!
    expect(fetched.translatedText).toBeNull()
    expect(fetched.progressPct).toBe(0)
    expect(fetched.status).toBe('in_progress')
  })

  it('NC #3 — countCompletedInWindow 메서드 동작', () => {
    const store = new InMemoryTranslationJobStore()
    // window 안 completed 3 (provider-a)
    for (let i = 0; i < 3; i++) {
      const j = makeJob(`a-${i}`, 'completed', 100 + i)
      j.providerId = 'provider-a'
      j.completedAt = 200 + i
      store.insert(j)
    }
    // window 안 completed 1 (provider-b)
    const b1 = makeJob('b-1', 'completed', 100)
    b1.providerId = 'provider-b'
    b1.completedAt = 250
    store.insert(b1)
    // window 밖 completed 1 (provider-a, 이전 windowStart 보다 작음)
    const old = makeJob('a-old', 'completed', 0)
    old.providerId = 'provider-a'
    old.completedAt = 50
    store.insert(old)

    expect(store.countCompletedInWindow('provider-a', 100)).toBe(3) // old 50 < 100 제외
    expect(store.countCompletedInWindow('provider-b', 100)).toBe(1)
    expect(store.countCompletedInWindow('provider-c', 100)).toBe(0)
  })

  it('NC #4 — threshold below → above crossing 시점에만 emit (window slide 후 재 emit)', async () => {
    const thresholdSpy = vi.fn()
    const q = makeQueue(
      fx,
      async () => ({ translatedText: 'ok' }),
      { thresholdPages: 2, minStartIntervalMs: 0, thresholdWindowMs: 100 }
    )
    q.on('thresholdExceeded', thresholdSpy)
    // 첫 2개 — below(0) → above(2) crossing → emit 1회
    q.enqueue({ workspaceId: 'ws', sourceText: 'a', providerId: 'p' })
    q.enqueue({ workspaceId: 'ws', sourceText: 'b', providerId: 'p' })
    q.start()
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.listAll().filter((j) => j.status === 'completed').length).toBe(1))
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.listAll().filter((j) => j.status === 'completed').length).toBe(2))
    expect(thresholdSpy).toHaveBeenCalledTimes(1)

    // 200ms advance → 이전 completed 2건 모두 window 밖
    advance(fx, 200)
    // 세 번째 completed (window 안 1건만, count=1 < threshold=2) → wasActive=true 였으나
    // 평가 시 wasActive=true && below → false 로 reset
    q.enqueue({ workspaceId: 'ws', sourceText: 'c', providerId: 'p' })
    advance(fx, 0)
    await vi.waitFor(() => expect(fx.store.listAll().filter((j) => j.status === 'completed').length).toBe(3))
    expect(thresholdSpy).toHaveBeenCalledTimes(1) // 아직 추가 emit X

    // 네 번째 completed (window 안 c+d, count=2) → wasActive=false → above crossing 재 emit
    q.enqueue({ workspaceId: 'ws', sourceText: 'd', providerId: 'p' })
    advance(fx, 0)
    await vi.waitFor(() => expect(thresholdSpy).toHaveBeenCalledTimes(2))
  })
})

// ===== helpers =====

function makeJob(
  id: string,
  status: TranslationJob['status'],
  createdAt = 0
): TranslationJob {
  return {
    id,
    workspaceId: 'ws',
    pageId: null,
    sourceText: 'src',
    sourceLang: null,
    targetLang: 'ko',
    translatedText: null,
    providerId: 'p',
    model: null,
    reasoningEffort: null,
    status,
    progressPct: 0,
    estimatedCostUsd: null,
    createdAt,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null
  }
}

afterEach(() => {
  vi.useRealTimers()
})
