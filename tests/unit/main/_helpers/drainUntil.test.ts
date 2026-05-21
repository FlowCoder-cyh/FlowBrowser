/**
 * Sprint 017 M0 T01 — drainUntil helper 단위 회귀.
 *
 * cover:
 *   1. predicate 진입 시점 true → step 미호출 + 즉시 resolve
 *   2. step 1~N 회 반복 후 predicate true → step 호출 횟수 정확 + resolve
 *   3. maxIterations 도달 후에도 predicate false → throw + 메시지에 description 포함
 *   4. maxIterations 0 또는 음수 → 즉시 throw (입력 검증)
 *   5. fakeTimers + scheduled setTimeout chain → step 호출 시 microtask flush 동작
 *   6. options 미전달 시 디폴트 max=20 적용
 *   7. predicate throw → 그대로 전파 (helper 가 catch 하지 않음)
 *   8. description 미전달 시 메시지 정상 (suffix 없음)
 *   9. step throw → 그대로 전파 (helper 가 catch 하지 않음)
 *  10. predicate가 step 부수효과로 점진적 만족 → 정확한 시점에 종료
 *  11. maxIterations 1 → 1회 step 후 종료 또는 throw
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { drainUntil } from './drainUntil'

describe('drainUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('predicate 진입 시점 true → step 미호출 + 즉시 resolve', async () => {
    const step = vi.fn()
    await drainUntil(step, () => true)
    expect(step).not.toHaveBeenCalled()
  })

  it('step N 회 반복 후 predicate true → step 정확 N 회 호출', async () => {
    let counter = 0
    const step = vi.fn(() => {
      counter += 1
    })
    await drainUntil(step, () => counter >= 3)
    expect(step).toHaveBeenCalledTimes(3)
    expect(counter).toBe(3)
  })

  it('maxIterations 도달 후에도 predicate false → throw + description 메시지 포함', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: 5, description: 'job completed' })
    ).rejects.toThrow(/predicate did not become true within 5 iterations.*job completed/)
    expect(step).toHaveBeenCalledTimes(5)
  })

  it('maxIterations 0 → throw (입력 검증)', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: 0 })
    ).rejects.toThrow(/maxIterations must be a positive integer \(got 0\)/)
    expect(step).not.toHaveBeenCalled()
  })

  it('maxIterations 음수 → throw (입력 검증) + description 포함', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: -3, description: 'neg' })
    ).rejects.toThrow(
      /maxIterations must be a positive integer \(got -3\).*neg/
    )
    expect(step).not.toHaveBeenCalled()
  })

  it('maxIterations NaN → throw (입력 검증)', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: Number.NaN })
    ).rejects.toThrow(/maxIterations must be a positive integer \(got NaN\)/)
    expect(step).not.toHaveBeenCalled()
  })

  it('maxIterations Infinity → throw (입력 검증) — 무한 hang 회피', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: Number.POSITIVE_INFINITY })
    ).rejects.toThrow(
      /maxIterations must be a positive integer \(got Infinity\)/
    )
    expect(step).not.toHaveBeenCalled()
  })

  it('maxIterations 비정수 (1.5) → throw (입력 검증)', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: 1.5 })
    ).rejects.toThrow(/maxIterations must be a positive integer \(got 1.5\)/)
    expect(step).not.toHaveBeenCalled()
  })

  it('fakeTimers + setTimeout chain — step 호출 + microtask flush 로 promise 체인 풀림', async () => {
    let phase: 'init' | 'step1' | 'step2' | 'done' = 'init'
    // chain: phase 'init' 일 때 step 1회 → setTimeout(0) 발화 시 'step1' 로 전이.
    // 'step1' 다음 step 발화 → microtask flush 후 'step2'. 'step2' 다음 step → 'done'.
    function step(): void {
      if (phase === 'init') {
        setTimeout(() => {
          phase = 'step1'
        }, 0)
      } else if (phase === 'step1') {
        setTimeout(() => {
          phase = 'step2'
        }, 0)
      } else if (phase === 'step2') {
        setTimeout(() => {
          phase = 'done'
        }, 0)
      }
      vi.advanceTimersByTime(0)
    }
    await drainUntil(step, () => phase === 'done', { maxIterations: 10 })
    expect(phase).toBe('done')
  })

  it('promise continuation chain — timer callback 이 next timer 를 promise 연속으로 등록 (BackgroundTranslationQueue dispatch 루프 정합)', async () => {
    // BackgroundTranslationQueue.dispatchNext() 의 실제 패턴 시뮬레이션:
    //   - setTimeout(0) 발화 → processor await → resolve 시점에 next setTimeout 등록.
    // microtask 1회 flush 없으면 next timer 가 보이지 않음 — helper 의 `await Promise.resolve()` 검증.
    let phase: 'init' | 'p1' | 'p2' | 'p3' | 'done' = 'init'
    function scheduleNext(): void {
      setTimeout(() => {
        // resolve 후 microtask 에서 next timer 등록 — drainUntil 의 microtask flush 가 필수.
        Promise.resolve().then(() => {
          if (phase === 'init') phase = 'p1'
          else if (phase === 'p1') phase = 'p2'
          else if (phase === 'p2') phase = 'p3'
          else if (phase === 'p3') phase = 'done'
        })
      }, 0)
    }
    function step(): void {
      if (phase !== 'done') scheduleNext()
      vi.advanceTimersByTime(0)
    }
    await drainUntil(step, () => phase === 'done', { maxIterations: 20 })
    expect(phase).toBe('done')
  })

  it('options 미전달 → 디폴트 max=20 적용', async () => {
    const step = vi.fn()
    await expect(drainUntil(step, () => false)).rejects.toThrow(
      /within 20 iterations/
    )
    expect(step).toHaveBeenCalledTimes(20)
  })

  it('predicate throw → drainUntil 가 그대로 전파', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => {
        throw new Error('predicate boom')
      })
    ).rejects.toThrow('predicate boom')
  })

  it('description 미전달 → 메시지에 suffix 없음', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: 1 })
    ).rejects.toThrow(/within 1 iterations$/)
  })

  it('step throw → drainUntil 가 그대로 전파', async () => {
    let n = 0
    function step(): void {
      n += 1
      if (n === 2) throw new Error('step boom')
    }
    await expect(drainUntil(step, () => false, { maxIterations: 5 })).rejects.toThrow(
      'step boom'
    )
    expect(n).toBe(2)
  })

  it('step 부수효과로 점진 만족 → 정확한 시점 종료 (step 호출 횟수 == 만족 시점)', async () => {
    const log: number[] = []
    let i = 0
    const step = (): void => {
      i += 1
      log.push(i)
    }
    await drainUntil(step, () => i === 7, { maxIterations: 20 })
    expect(log).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('maxIterations 1 + 1회 step 후 predicate true → 정상 resolve', async () => {
    let n = 0
    const step = vi.fn(() => {
      n += 1
    })
    await drainUntil(step, () => n >= 1, { maxIterations: 1 })
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('maxIterations 1 + 1회 step 후에도 predicate false → throw (1회만 step 호출)', async () => {
    const step = vi.fn()
    await expect(
      drainUntil(step, () => false, { maxIterations: 1 })
    ).rejects.toThrow(/within 1 iterations/)
    expect(step).toHaveBeenCalledTimes(1)
  })
})
