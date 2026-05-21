/**
 * Sprint 016 M4 T19 — NotificationService 단위 회귀.
 *
 * cover:
 *   - notify() 정상 path — OS factory.show() 호출 + delivered='os'
 *   - title 빈 / whitespace → throw
 *   - factory.isSupported()=false → renderer IPC fallback (ipc-fallback)
 *   - factory.show() throw → fallback (ipc-fallback) + reason 미포함
 *   - factory throw + 창 0 → 'unsupported' + reason 포함
 *   - isSupported=false + 창 0 → 'unsupported'
 *   - 여러 BrowserWindow 모두 broadcast (destroyed 제외)
 *   - onClick safe wrapper — handler throw 시 silent (algorithm 자체 throw 안 함)
 *   - urgency / body 옵션 전달
 *   - ipcChannel override
 *   - constructor 입력 검증 (factory / windows 미주입)
 */

import { describe, it, expect, vi } from 'vitest'

import {
  NotificationService,
  __testing,
  type NotificationFactory,
  type BrowserWindowProvider
} from '../../../src/main/NotificationService'

interface StubWindow {
  isDestroyed(): boolean
  webContents: { send: (channel: string, payload: unknown) => void }
}

function makeStubWindow(opts?: { destroyed?: boolean }): StubWindow & {
  sentEvents: Array<{ channel: string; payload: unknown }>
} {
  const sentEvents: Array<{ channel: string; payload: unknown }> = []
  return {
    isDestroyed: () => opts?.destroyed === true,
    webContents: {
      send: (channel, payload) => {
        sentEvents.push({ channel, payload })
      }
    },
    sentEvents
  }
}

function makeWindowsProvider(wins: StubWindow[]): BrowserWindowProvider {
  return {
    // BrowserWindow 캐스팅 회피 — Electron 의존성 분리 정합.
    getAllWindows: () => wins as never
  }
}

function makeFactory(opts: {
  supported: boolean
  throws?: boolean
}): NotificationFactory & {
  shows: Array<{ opts: unknown; onClick?: () => void }>
} {
  const shows: Array<{ opts: unknown; onClick?: () => void }> = []
  return {
    isSupported: () => opts.supported,
    show(showOpts, onClick) {
      if (opts.throws) {
        throw new Error('show throw simulated')
      }
      shows.push({ opts: showOpts, onClick })
    },
    shows
  }
}

describe('NotificationService — 정상 OS path', () => {
  it('factory.show() 호출 + delivered=os', () => {
    const factory = makeFactory({ supported: true })
    const win = makeStubWindow()
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([win])
    })
    const result = svc.notify({ title: 'Test', body: 'Body' })
    expect(result.delivered).toBe('os')
    expect(factory.shows).toHaveLength(1)
    expect(factory.shows[0].opts).toEqual({
      title: 'Test',
      body: 'Body',
      urgency: undefined
    })
    // IPC fallback 호출 안 함
    expect(win.sentEvents).toHaveLength(0)
  })

  it('urgency 옵션 전달', () => {
    const factory = makeFactory({ supported: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([makeStubWindow()])
    })
    svc.notify({ title: 'Critical', urgency: 'critical' })
    expect((factory.shows[0].opts as { urgency?: string }).urgency).toBe('critical')
  })

  it('onClick safe wrapper — handler throw 시 svc 자체 throw 안 함', () => {
    const factory = makeFactory({ supported: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([makeStubWindow()])
    })
    const handler = vi.fn(() => {
      throw new Error('user handler throw')
    })
    svc.notify({ title: 'T', onClick: handler })
    expect(factory.shows[0].onClick).toBeDefined()
    // wrapper 호출 시 silent — 본 함수 자체 throw 안 함
    expect(() => factory.shows[0].onClick!()).not.toThrow()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('onClick 미주입 시 wrapper 도 undefined', () => {
    const factory = makeFactory({ supported: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([makeStubWindow()])
    })
    svc.notify({ title: 'T' })
    expect(factory.shows[0].onClick).toBeUndefined()
  })
})

describe('NotificationService — fallback path (isSupported=false)', () => {
  it('IPC fallback 직행 — delivered=ipc-fallback', () => {
    const factory = makeFactory({ supported: false })
    const win = makeStubWindow()
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([win])
    })
    const result = svc.notify({ title: 'Headless', body: 'Body' })
    expect(result.delivered).toBe('ipc-fallback')
    expect(factory.shows).toHaveLength(0)
    expect(win.sentEvents).toHaveLength(1)
    expect(win.sentEvents[0].channel).toBe('notification:fallback')
    expect(win.sentEvents[0].payload).toEqual({
      title: 'Headless',
      body: 'Body',
      urgency: 'normal'
    })
  })

  it('isSupported=false + 창 0 → unsupported', () => {
    const factory = makeFactory({ supported: false })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([])
    })
    const result = svc.notify({ title: 'T' })
    expect(result.delivered).toBe('unsupported')
    expect(result.reason).toBeDefined()
  })

  it('isSupported=false + 창들 모두 destroyed → unsupported', () => {
    const factory = makeFactory({ supported: false })
    const wins = [makeStubWindow({ destroyed: true }), makeStubWindow({ destroyed: true })]
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider(wins)
    })
    const result = svc.notify({ title: 'T' })
    expect(result.delivered).toBe('unsupported')
  })

  it('여러 BrowserWindow 모두 IPC broadcast (destroyed 제외)', () => {
    const factory = makeFactory({ supported: false })
    const win1 = makeStubWindow()
    const winDestroyed = makeStubWindow({ destroyed: true })
    const win2 = makeStubWindow()
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([win1, winDestroyed, win2])
    })
    svc.notify({ title: 'T' })
    expect(win1.sentEvents).toHaveLength(1)
    expect(win2.sentEvents).toHaveLength(1)
    // destroyed 창에 send 호출 0
    expect(winDestroyed.sentEvents).toHaveLength(0)
  })

  it('ipcChannel override', () => {
    const factory = makeFactory({ supported: false })
    const win = makeStubWindow()
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([win]),
      ipcChannel: 'custom:notify'
    })
    svc.notify({ title: 'T' })
    expect(win.sentEvents[0].channel).toBe('custom:notify')
  })
})

describe('NotificationService — fallback path (factory.show throw)', () => {
  it('factory throw + 창 있음 → IPC fallback', () => {
    const factory = makeFactory({ supported: true, throws: true })
    const win = makeStubWindow()
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([win])
    })
    const result = svc.notify({ title: 'T' })
    expect(result.delivered).toBe('ipc-fallback')
    expect(win.sentEvents).toHaveLength(1)
  })

  it('factory throw + 창 0 → unsupported + reason 에 throw 메시지 + fallback 메시지', () => {
    const factory = makeFactory({ supported: true, throws: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([])
    })
    const result = svc.notify({ title: 'T' })
    expect(result.delivered).toBe('unsupported')
    expect(result.reason).toContain('OS notify throw')
    expect(result.reason).toContain('fallback no windows')
  })
})

describe('NotificationService — 입력 검증', () => {
  it('title 빈 문자열 → throw', () => {
    const factory = makeFactory({ supported: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([makeStubWindow()])
    })
    expect(() => svc.notify({ title: '' })).toThrow(/title/)
  })

  it('title whitespace-only → throw', () => {
    const factory = makeFactory({ supported: true })
    const svc = new NotificationService({
      factory,
      windows: makeWindowsProvider([makeStubWindow()])
    })
    expect(() => svc.notify({ title: '   ' })).toThrow(/title/)
  })

  it('constructor — factory 미주입 → throw', () => {
    expect(
      () =>
        new NotificationService({
          factory: undefined as never,
          windows: makeWindowsProvider([])
        })
    ).toThrow(/factory/)
  })

  it('constructor — windows 미주입 → throw', () => {
    expect(
      () =>
        new NotificationService({
          factory: makeFactory({ supported: true }),
          windows: undefined as never
        })
    ).toThrow(/windows/)
  })
})

describe('NotificationService — __testing 상수', () => {
  it('DEFAULT_IPC_CHANNEL 노출', () => {
    expect(__testing.DEFAULT_IPC_CHANNEL).toBe('notification:fallback')
  })
})
