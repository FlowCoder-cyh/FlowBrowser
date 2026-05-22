/**
 * Sprint 017 M2 T10 (KI-020) — SPA `did-navigate-in-page` 자동 인덱싱 debounce scheduler 단위 회귀.
 *
 * cover:
 *   - 마지막 안정 URL 만 fire (debounce 동작) — 3회 연속 schedule → 1회 runIndex
 *   - URL consistency guard — fire 직전 currentUrl !== scheduledUrl 시 runIndex skip
 *   - isDestroyed 시 fire skip
 *   - cancel — 대기 중 timer 삭제 (fire 안 됨)
 *   - cancelAll — 다중 tab 일괄 cleanup
 *   - 독립 tab — tabId 별 timer 격리
 *   - pending count — 대기 timer 개수 정확
 *   - runIndex throw graceful (swallow)
 *   - 디폴트 debounce 1000ms 상수 정합
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSpaNavScheduler,
  isHashOnlyNavigation,
  SPA_INDEX_DEBOUNCE_MS,
  urlPathAndSearch
} from '../../../src/main/spaNavIndexingScheduler'

describe('spaNavIndexingScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('디폴트 debounce 1000ms (codex 019e4f40 Q1 권고)', () => {
    expect(SPA_INDEX_DEBOUNCE_MS).toBe(1000)
  })

  it('debounce — 3회 연속 schedule → 마지막 URL 만 fire', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 500 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    const baseDeps = {
      runIndex,
      getCurrentUrl: () => 'https://x.com/p3',
      isDestroyed: () => false
    }
    scheduler.schedule('tab1', { ...baseDeps, scheduledUrl: 'https://x.com/p1' })
    scheduler.schedule('tab1', { ...baseDeps, scheduledUrl: 'https://x.com/p2' })
    scheduler.schedule('tab1', { ...baseDeps, scheduledUrl: 'https://x.com/p3' })
    expect(scheduler.pending()).toBe(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(runIndex).toHaveBeenCalledTimes(1)
    expect(runIndex).toHaveBeenCalledWith('https://x.com/p3')
    expect(scheduler.pending()).toBe(0)
  })

  it('URL consistency guard — fire 직전 currentUrl !== scheduledUrl → runIndex skip', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 200 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    let currentUrl = 'https://x.com/scheduled'
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/scheduled',
      runIndex,
      getCurrentUrl: () => currentUrl,
      isDestroyed: () => false
    })
    // 사용자가 fire 전 다른 URL 로 full navigation 시작
    currentUrl = 'https://other.com/page'
    await vi.advanceTimersByTimeAsync(200)
    expect(runIndex).not.toHaveBeenCalled()
    expect(scheduler.pending()).toBe(0)
  })

  it('isDestroyed → fire skip', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 200 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    let destroyed = false
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/p',
      runIndex,
      getCurrentUrl: () => 'https://x.com/p',
      isDestroyed: () => destroyed
    })
    destroyed = true
    await vi.advanceTimersByTimeAsync(200)
    expect(runIndex).not.toHaveBeenCalled()
    expect(scheduler.pending()).toBe(0)
  })

  it('cancel — 대기 timer 삭제 (fire 안 됨)', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 300 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/p',
      runIndex,
      getCurrentUrl: () => 'https://x.com/p',
      isDestroyed: () => false
    })
    expect(scheduler.pending()).toBe(1)
    scheduler.cancel('tab1')
    expect(scheduler.pending()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(runIndex).not.toHaveBeenCalled()
  })

  it('cancel — 없는 tabId 호출 graceful', () => {
    const scheduler = createSpaNavScheduler()
    expect(() => scheduler.cancel('nonexistent')).not.toThrow()
  })

  it('cancelAll — 다중 tab 일괄 cleanup', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 200 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    const mkDeps = (url: string) => ({
      scheduledUrl: url,
      runIndex,
      getCurrentUrl: () => url,
      isDestroyed: () => false
    })
    scheduler.schedule('tab1', mkDeps('https://x.com/1'))
    scheduler.schedule('tab2', mkDeps('https://x.com/2'))
    scheduler.schedule('tab3', mkDeps('https://x.com/3'))
    expect(scheduler.pending()).toBe(3)
    scheduler.cancelAll()
    expect(scheduler.pending()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(runIndex).not.toHaveBeenCalled()
  })

  it('독립 tab — tabId 별 timer 격리', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 100 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    const mkDeps = (url: string) => ({
      scheduledUrl: url,
      runIndex,
      getCurrentUrl: () => url,
      isDestroyed: () => false
    })
    scheduler.schedule('tab1', mkDeps('https://x.com/a'))
    scheduler.schedule('tab2', mkDeps('https://x.com/b'))
    expect(scheduler.pending()).toBe(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(runIndex).toHaveBeenCalledTimes(2)
    const urls = runIndex.mock.calls.map((c) => c[0]).sort()
    expect(urls).toEqual(['https://x.com/a', 'https://x.com/b'])
  })

  it('runIndex throw → 본 scheduler 가 swallow (graceful)', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 100 })
    const runIndex = vi.fn().mockRejectedValue(new Error('boom'))
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/p',
      runIndex,
      getCurrentUrl: () => 'https://x.com/p',
      isDestroyed: () => false
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(runIndex).toHaveBeenCalledTimes(1)
    // throw 가 propagate 되면 본 테스트가 unhandled rejection 으로 실패
    expect(scheduler.pending()).toBe(0)
  })

  it('schedule 후 cancel + 재 schedule → 새 timer 활성', async () => {
    const scheduler = createSpaNavScheduler({ debounceMs: 100 })
    const runIndex = vi.fn().mockResolvedValue(undefined)
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/old',
      runIndex,
      getCurrentUrl: () => 'https://x.com/new',
      isDestroyed: () => false
    })
    scheduler.cancel('tab1')
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/new',
      runIndex,
      getCurrentUrl: () => 'https://x.com/new',
      isDestroyed: () => false
    })
    expect(scheduler.pending()).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(runIndex).toHaveBeenCalledTimes(1)
    expect(runIndex).toHaveBeenCalledWith('https://x.com/new')
  })

  it('codex 019e4f51 hotfix — urlPathAndSearch — origin+pathname+search (hash 제외)', () => {
    expect(urlPathAndSearch('https://x.com/page')).toBe('https://x.com/page')
    expect(urlPathAndSearch('https://x.com/page#section')).toBe('https://x.com/page')
    expect(urlPathAndSearch('https://x.com/page?tab=2')).toBe('https://x.com/page?tab=2')
    expect(urlPathAndSearch('https://x.com/page?tab=2#sec')).toBe('https://x.com/page?tab=2')
    // 파싱 실패 — trim 반환 (graceful)
    expect(urlPathAndSearch('not-a-valid-url')).toBe('not-a-valid-url')
    expect(urlPathAndSearch('')).toBe('')
    expect(urlPathAndSearch('   ')).toBe('')
  })

  it('codex 019e4f51 hotfix — isHashOnlyNavigation — hash 만 다르면 true', () => {
    // 첫 호출 (lastPath null) — false (schedule 진행)
    expect(isHashOnlyNavigation('https://x.com/page', null)).toBe(false)
    // hash 만 변경 — true (skip)
    expect(isHashOnlyNavigation('https://x.com/page#a', 'https://x.com/page')).toBe(true)
    expect(isHashOnlyNavigation('https://x.com/page#b', 'https://x.com/page')).toBe(true)
    // pathname 변경 — false (schedule)
    expect(isHashOnlyNavigation('https://x.com/page2', 'https://x.com/page')).toBe(false)
    // search 변경 — false (schedule)
    expect(
      isHashOnlyNavigation('https://x.com/page?tab=2', 'https://x.com/page')
    ).toBe(false)
    // search 동일 + hash 만 변경 — true
    expect(
      isHashOnlyNavigation('https://x.com/page?tab=2#sec', 'https://x.com/page?tab=2')
    ).toBe(true)
  })

  it('주입된 setTimeout / clearTimeout 사용', () => {
    const fakeHandles: Array<{ id: number }> = []
    let id = 0
    const setT = vi.fn((_fn: () => void, _ms: number) => {
      const h = { id: ++id }
      fakeHandles.push(h)
      return h as unknown as ReturnType<typeof setTimeout>
    })
    const clearT = vi.fn()
    const scheduler = createSpaNavScheduler({
      debounceMs: 100,
      setTimeout: setT,
      clearTimeout: clearT
    })
    const runIndex = vi.fn()
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/p',
      runIndex,
      getCurrentUrl: () => 'https://x.com/p',
      isDestroyed: () => false
    })
    scheduler.schedule('tab1', {
      scheduledUrl: 'https://x.com/p2',
      runIndex,
      getCurrentUrl: () => 'https://x.com/p2',
      isDestroyed: () => false
    })
    expect(setT).toHaveBeenCalledTimes(2)
    expect(clearT).toHaveBeenCalledTimes(1) // 직전 timer clear
    scheduler.cancel('tab1')
    expect(clearT).toHaveBeenCalledTimes(2)
  })
})
