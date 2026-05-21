/**
 * Sprint 017 M0 T03 — MemoryStatsPanel React 컴포넌트 단위 회귀 (KI-009 closed).
 *
 * cover (contract §2 T03 정의 + 추가):
 *   1. mount + workspaceId 정상 → memoryApi.stats() 1회 호출 + stats 표시
 *   2. workspaceId 변경 → 재 refresh (호출 횟수 누적)
 *   3. 폴링 (pollIntervalMs > 0) → setInterval 통해 추가 호출
 *   4. error fallback (memoryApi.stats throw 시 메시지 표시)
 *   5. workspaceId === null → "워크스페이스 미선택" + stats() 호출 0
 *   6. r.ok=false + errorCode='infra_unavailable' → "인프라 비활성" 표시
 *   7. r.ok=false + errorCode='no_active_workspace' → "워크스페이스 미선택" 표시
 *   8. onInvalidated broadcast 수신 시 즉시 refresh (workspaceId 매칭)
 *   9. onInvalidated broadcast workspaceId 불일치 시 refresh 0 (다른 ws 격리)
 *  10. unmount 시 setInterval clear + onInvalidated cleanup
 *
 * happy-dom 환경 (vitest.config.ts environmentMatchGlobs `tests/unit/renderer/**`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

import MemoryStatsPanel from '../../../src/renderer/src/memory/MemoryStatsPanel'

interface MemoryStatsPayload {
  workspaceId: string
  pagesCount: number
  visitsCount: number
  notesCount: number
  chatMessagesCount: number
  lastIndexedAt: number | null
}

interface MemoryStatsResponse {
  ok: boolean
  stats?: MemoryStatsPayload
  errorCode?: 'infra_unavailable' | 'no_active_workspace'
}

interface MemoryInvalidatedPayload {
  workspaceId: string
}

interface MemoryApi {
  stats: (args: { workspaceId?: string }) => Promise<MemoryStatsResponse>
  onInvalidated: (handler: (payload: MemoryInvalidatedPayload) => void) => () => void
}

declare global {
  var memoryApi: MemoryApi
}

interface Fx {
  statsSpy: ReturnType<typeof vi.fn>
  invalidationHandlers: Array<(payload: MemoryInvalidatedPayload) => void>
  offSpy: ReturnType<typeof vi.fn>
}

function setupFx(): Fx {
  const invalidationHandlers: Array<(payload: MemoryInvalidatedPayload) => void> = []
  const offSpy = vi.fn()
  const fx: Fx = {
    statsSpy: vi.fn(),
    invalidationHandlers,
    offSpy
  }
  // window.memoryApi mock — happy-dom 의 globalThis.window 를 *보존* 하고 memoryApi 만 부착.
  // (이전 구현은 globalThis.window 전체 덮어써서 react-dom 의 HTMLIFrameElement 등 lookup 실패.)
  ;(window as unknown as { memoryApi: MemoryApi }).memoryApi = {
    stats: fx.statsSpy as MemoryApi['stats'],
    onInvalidated: (handler) => {
      invalidationHandlers.push(handler)
      return () => {
        offSpy()
        const idx = invalidationHandlers.indexOf(handler)
        if (idx >= 0) invalidationHandlers.splice(idx, 1)
      }
    }
  }
  return fx
}

function makeStats(overrides: Partial<MemoryStatsPayload> = {}): MemoryStatsPayload {
  return {
    workspaceId: 'ws-default',
    pagesCount: 12,
    visitsCount: 30,
    notesCount: 5,
    chatMessagesCount: 7,
    lastIndexedAt: 1_700_000_000_000,
    ...overrides
  }
}

describe('MemoryStatsPanel — mount + 정상 stats 표시 (contract case 1)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
  })

  it('workspaceId 정상 → memoryApi.stats() 1회 호출 + 카운트 표시', async () => {
    fx.statsSpy.mockResolvedValue({ ok: true, stats: makeStats({ pagesCount: 42 }) })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    // 초기 refresh 마이크로태스크 flush.
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
    expect(fx.statsSpy).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(screen.getByText('42건')).toBeDefined()
  })
})

describe('MemoryStatsPanel — workspaceId 변경 시 재 refresh (contract case 2)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
  })

  it('workspaceId prop 갱신 → 새 stats() 호출', async () => {
    fx.statsSpy
      .mockResolvedValueOnce({
        ok: true,
        stats: makeStats({ workspaceId: 'ws-1', pagesCount: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        stats: makeStats({ workspaceId: 'ws-2', pagesCount: 99 })
      })
    const { rerender } = render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
    expect(fx.statsSpy).toHaveBeenLastCalledWith({ workspaceId: 'ws-1' })

    rerender(<MemoryStatsPanel workspaceId="ws-2" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(2)
    expect(fx.statsSpy).toHaveBeenLastCalledWith({ workspaceId: 'ws-2' })
    expect(screen.getByText('99건')).toBeDefined()
  })
})

describe('MemoryStatsPanel — 폴링 (contract case 3)', () => {
  let fx: Fx
  beforeEach(() => {
    vi.useFakeTimers()
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('pollIntervalMs > 0 → setInterval 통해 N회 추가 호출', async () => {
    fx.statsSpy.mockResolvedValue({ ok: true, stats: makeStats() })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={1000} />)
    // 초기 1회.
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
    // 1초 → 2회.
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(2)
    // 추가 2초 → 4회.
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(4)
  })
})

describe('MemoryStatsPanel — error fallback (contract case 4)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
  })

  it('stats() throw → error 메시지 표시', async () => {
    fx.statsSpy.mockRejectedValue(new Error('네트워크 에러'))
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('네트워크 에러')).toBeDefined()
  })

  it('r.ok=false + errorCode=infra_unavailable → "인프라 비활성" 표시', async () => {
    fx.statsSpy.mockResolvedValue({ ok: false, errorCode: 'infra_unavailable' })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('인프라 비활성')).toBeDefined()
  })

  it('r.ok=false + errorCode=no_active_workspace → "워크스페이스 미선택" 표시', async () => {
    fx.statsSpy.mockResolvedValue({ ok: false, errorCode: 'no_active_workspace' })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('워크스페이스 미선택')).toBeDefined()
  })
})

describe('MemoryStatsPanel — workspaceId null + onInvalidated 격리 + cleanup', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
  })

  it('workspaceId === null → stats() 호출 0 + "워크스페이스 미선택" 표시', async () => {
    render(<MemoryStatsPanel workspaceId={null} pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).not.toHaveBeenCalled()
    expect(screen.getByText('워크스페이스 미선택')).toBeDefined()
  })

  it('onInvalidated broadcast workspaceId 매칭 → 즉시 refresh', async () => {
    fx.statsSpy.mockResolvedValue({ ok: true, stats: makeStats() })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
    // broadcast 발화 — 매칭 ws.
    await act(async () => {
      fx.invalidationHandlers.forEach((h) => h({ workspaceId: 'ws-1' }))
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(2)
  })

  it('onInvalidated broadcast workspaceId 불일치 → refresh 0 (격리)', async () => {
    fx.statsSpy.mockResolvedValue({ ok: true, stats: makeStats() })
    render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
    // broadcast 발화 — 다른 ws.
    await act(async () => {
      fx.invalidationHandlers.forEach((h) => h({ workspaceId: 'ws-2' }))
      await Promise.resolve()
    })
    expect(fx.statsSpy).toHaveBeenCalledTimes(1)
  })

  it('unmount → setInterval clear + onInvalidated cleanup (off 호출)', async () => {
    vi.useFakeTimers()
    try {
      fx.statsSpy.mockResolvedValue({ ok: true, stats: makeStats() })
      const { unmount } = render(<MemoryStatsPanel workspaceId="ws-1" pollIntervalMs={500} />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(fx.statsSpy).toHaveBeenCalledTimes(1)
      unmount()
      // cleanup 후 timer advance — 추가 호출 X.
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })
      expect(fx.statsSpy).toHaveBeenCalledTimes(1)
      expect(fx.offSpy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
