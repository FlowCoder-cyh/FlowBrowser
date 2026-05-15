/**
 * Sprint 008 M1 / S008-T01 — TabManager 단위 테스트.
 * 순수 모델이라 외부 의존성 없이 매트릭스 검증.
 */
import { describe, it, expect, vi } from 'vitest'
import { TabManager } from '../../../src/main/TabManager'

describe('TabManager', () => {
  it('초기 상태: 빈 탭 + null active', () => {
    const tm = new TabManager()
    expect(tm.size()).toBe(0)
    expect(tm.list()).toEqual([])
    expect(tm.getActive()).toBeNull()
    expect(tm.getActiveId()).toBeNull()
  })

  it('open() 신규 탭 생성 + 활성 자동 설정', () => {
    const tm = new TabManager()
    const s = tm.open('https://example.com')
    expect(s.url).toBe('https://example.com')
    expect(s.title).toBe('')
    expect(tm.size()).toBe(1)
    expect(tm.getActiveId()).toBe(s.id)
    expect(tm.getActive()?.id).toBe(s.id)
  })

  it('open() 기본 URL은 about:blank', () => {
    const tm = new TabManager()
    const s = tm.open()
    expect(s.url).toBe('about:blank')
  })

  it('open() 여러 번 — 각각 다른 id, 마지막이 활성', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    const b = tm.open('b.com')
    const c = tm.open('c.com')
    expect(a.id).not.toBe(b.id)
    expect(b.id).not.toBe(c.id)
    expect(tm.size()).toBe(3)
    expect(tm.getActiveId()).toBe(c.id)
    expect(tm.list().map((t) => t.url)).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('close() 존재하지 않는 id → false, 변동 없음', () => {
    const tm = new TabManager()
    tm.open('a.com')
    const before = tm.size()
    expect(tm.close('nope')).toBe(false)
    expect(tm.size()).toBe(before)
  })

  it('close() 활성 탭 → 직전 위치로 자동 전환', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    const b = tm.open('b.com')
    const c = tm.open('c.com')
    expect(tm.getActiveId()).toBe(c.id)
    // c를 닫으면 b가 활성 (이전 위치)
    tm.close(c.id)
    expect(tm.getActiveId()).toBe(b.id)
    // b를 닫으면 a 활성
    tm.close(b.id)
    expect(tm.getActiveId()).toBe(a.id)
    // a를 닫으면 null
    tm.close(a.id)
    expect(tm.getActiveId()).toBeNull()
  })

  it('close() 비활성 탭 → 활성 유지', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    const b = tm.open('b.com')
    expect(tm.getActiveId()).toBe(b.id)
    tm.close(a.id)
    expect(tm.getActiveId()).toBe(b.id)
    expect(tm.size()).toBe(1)
  })

  it('switch() 활성 변경 + lastActiveAt 갱신', async () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    await new Promise((r) => setTimeout(r, 5))
    tm.open('b.com')
    const beforeSwitchA = tm.getActive()
    await new Promise((r) => setTimeout(r, 5))
    expect(tm.switch(a.id)).toBe(true)
    expect(tm.getActiveId()).toBe(a.id)
    const newActive = tm.getActive()
    expect(newActive?.lastActiveAt).toBeGreaterThan(beforeSwitchA?.lastActiveAt ?? 0)
    expect(tm.size()).toBe(2)
  })

  it('switch() 존재하지 않는 id → false', () => {
    const tm = new TabManager()
    tm.open('a.com')
    expect(tm.switch('nope')).toBe(false)
  })

  it('updateUrl() / updateTitle()', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    expect(tm.updateUrl(a.id, 'aaa.com')).toBe(true)
    expect(tm.updateTitle(a.id, 'New Title')).toBe(true)
    const updated = tm.list().find((t) => t.id === a.id)
    expect(updated?.url).toBe('aaa.com')
    expect(updated?.title).toBe('New Title')
  })

  it('updateUrl() 동일 값이면 noop (true 반환, 이벤트 미발생)', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    const handler = vi.fn()
    tm.subscribe(handler)
    handler.mockClear() // open 이벤트 무시
    expect(tm.updateUrl(a.id, 'a.com')).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('subscribe / unsubscribe', () => {
    const tm = new TabManager()
    const handler = vi.fn()
    const off = tm.subscribe(handler)
    tm.open('a.com')
    expect(handler).toHaveBeenCalledTimes(1)
    off()
    tm.open('b.com')
    expect(handler).toHaveBeenCalledTimes(1) // 더 안 늘어남
  })

  it('snapshot() — list + activeId 일관성', () => {
    const tm = new TabManager()
    const a = tm.open('a.com')
    const b = tm.open('b.com')
    const snap = tm.snapshot()
    expect(snap.tabs.length).toBe(2)
    expect(snap.activeId).toBe(b.id)
    expect(snap.tabs[0].id).toBe(a.id)
    expect(snap.tabs[1].id).toBe(b.id)
  })

  // Sprint 008 M3 — 격리 / 통합 시나리오
  describe('integration (Sprint 008 M3)', () => {
    it('open → switch → close 전환 chain', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      tm.switch(a.id)
      expect(tm.getActiveId()).toBe(a.id)
      tm.close(a.id)
      // a가 활성이었으므로 직전 위치(인덱스 0)에서 가까운 탭 = 이제 b가 0번. 활성 b.
      expect(tm.getActiveId()).toBe(b.id)
      tm.switch(c.id)
      tm.close(b.id) // 비활성 close → 활성 유지
      expect(tm.getActiveId()).toBe(c.id)
      expect(tm.size()).toBe(1)
    })

    it('subscribe — open/close/switch 모두 emit', () => {
      const tm = new TabManager()
      const handler = vi.fn()
      tm.subscribe(handler)
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      tm.switch(a.id)
      tm.close(b.id)
      // open 2 + switch 1 + close 1 = 4
      expect(handler).toHaveBeenCalledTimes(4)
      const last = handler.mock.calls[3][0]
      expect(last.activeId).toBe(a.id)
      expect(last.tabs.length).toBe(1)
    })

    it('updateUrl/updateTitle도 emit', () => {
      const tm = new TabManager()
      const handler = vi.fn()
      const a = tm.open('a.com')
      tm.subscribe(handler)
      handler.mockClear()
      tm.updateUrl(a.id, 'a2.com')
      tm.updateTitle(a.id, 'New')
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('order 보존: 중간 close 후 새 탭 추가 — 마지막에 위치', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      tm.close(b.id)
      const d = tm.open('d.com')
      expect(tm.list().map((t) => t.id)).toEqual([a.id, c.id, d.id])
    })
  })

  // Sprint 010 M1 — reorder
  describe('reorder (Sprint 010 M1)', () => {
    it('정상 이동: 0 → 2', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      expect(tm.reorder(a.id, 2)).toBe(true)
      expect(tm.list().map((t) => t.id)).toEqual([b.id, c.id, a.id])
    })

    it('같은 위치 → no-op (true, emit skip)', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.open('b.com')
      const handler = vi.fn()
      tm.subscribe(handler)
      handler.mockClear()
      expect(tm.reorder(a.id, 0)).toBe(true)
      expect(handler).not.toHaveBeenCalled()
    })

    it('음수 newIndex → 0으로 clamp', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.open('b.com')
      const c = tm.open('c.com')
      expect(tm.reorder(c.id, -5)).toBe(true)
      expect(tm.list().map((t) => t.url)).toEqual(['c.com', 'a.com', 'b.com'])
    })

    it('length 초과 newIndex → length-1로 clamp', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.open('b.com')
      tm.open('c.com')
      expect(tm.reorder(a.id, 99)).toBe(true)
      expect(tm.list().map((t) => t.url)).toEqual(['b.com', 'c.com', 'a.com'])
    })

    it('존재하지 않는 id → false, 변동 없음', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.open('b.com')
      const before = tm.list().map((t) => t.id)
      expect(tm.reorder('nope', 0)).toBe(false)
      expect(tm.list().map((t) => t.id)).toEqual(before)
    })

    it('활성 탭 및 메타데이터(url/title/timestamps) 보존', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      tm.updateTitle(a.id, 'Title A')
      tm.switch(a.id)
      const aBefore = tm.list().find((t) => t.id === a.id)
      expect(tm.reorder(a.id, 1)).toBe(true)
      expect(tm.getActiveId()).toBe(a.id) // 활성 보존
      const aAfter = tm.list().find((t) => t.id === a.id)
      expect(aAfter?.url).toBe(aBefore?.url)
      expect(aAfter?.title).toBe('Title A')
      expect(aAfter?.createdAt).toBe(aBefore?.createdAt)
      expect(aAfter?.lastActiveAt).toBe(aBefore?.lastActiveAt)
      expect(tm.list().map((t) => t.id)).toEqual([b.id, a.id])
    })
  })

  // Sprint 010 M2 — closeOthers / closeRight / duplicate
  describe('closeOthers (Sprint 010 M2)', () => {
    it('기본: keepId 외 모두 close, keepId 활성', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      tm.switch(c.id)
      const result = tm.closeOthers(b.id)
      expect(result.ok).toBe(true)
      expect(result.closed.sort()).toEqual([a.id, c.id].sort())
      expect(tm.size()).toBe(1)
      expect(tm.getActiveId()).toBe(b.id)
      expect(tm.list().map((t) => t.id)).toEqual([b.id])
    })

    it('keepId 존재하지 않음 → false, 변동 없음', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.open('b.com')
      const before = tm.size()
      const result = tm.closeOthers('nope')
      expect(result.ok).toBe(false)
      expect(result.closed).toEqual([])
      expect(tm.size()).toBe(before)
    })

    it('단일 탭: closed 빈 배열, emit skip', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const handler = vi.fn()
      tm.subscribe(handler)
      handler.mockClear()
      const result = tm.closeOthers(a.id)
      expect(result.ok).toBe(true)
      expect(result.closed).toEqual([])
      expect(tm.size()).toBe(1)
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('closeRight (Sprint 010 M2)', () => {
    it('오른쪽 다수 close, fromId 활성 보존', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      const d = tm.open('d.com')
      tm.switch(b.id)
      const result = tm.closeRight(b.id)
      expect(result.ok).toBe(true)
      expect(result.closed).toEqual([c.id, d.id])
      expect(tm.size()).toBe(2)
      expect(tm.list().map((t) => t.id)).toEqual([a.id, b.id])
      expect(tm.getActiveId()).toBe(b.id)
    })

    it('가장 오른쪽 fromId → 닫을 게 없음 (ok, closed=[])', () => {
      const tm = new TabManager()
      tm.open('a.com')
      const b = tm.open('b.com')
      const result = tm.closeRight(b.id)
      expect(result.ok).toBe(true)
      expect(result.closed).toEqual([])
      expect(tm.size()).toBe(2)
    })

    it('존재하지 않는 fromId → false', () => {
      const tm = new TabManager()
      tm.open('a.com')
      const result = tm.closeRight('nope')
      expect(result.ok).toBe(false)
    })

    it('활성 탭이 오른쪽에 있었으면 fromId가 활성으로 전환', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      tm.open('c.com')
      tm.switch(a.id) // 우선 a 활성
      tm.switch(tm.list()[2].id) // c 활성
      tm.closeRight(a.id) // b, c close → a 활성
      expect(tm.getActiveId()).toBe(a.id)
      expect(tm.size()).toBe(1)
      expect(b.id).toBeDefined() // b는 닫혔지만 ref는 살아있음
    })
  })

  // Sprint 011 M3 — setPinned
  describe('setPinned (Sprint 011 M3)', () => {
    it('핀 시 핀 영역 끝으로 이동 (단일 핀)', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.open('b.com')
      const c = tm.open('c.com')
      expect(tm.setPinned(c.id, true)).toBe(true)
      // c가 0번 (핀), 그 뒤 a, b
      expect(tm.list().map((t) => t.url)).toEqual(['c.com', 'a.com', 'b.com'])
      expect(tm.list()[0].pinned).toBe(true)
    })

    it('핀 해제 시 비핀 영역 끝으로 이동', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.open('b.com')
      tm.open('c.com')
      tm.setPinned(a.id, true)
      // 현재: a(핀), b, c
      expect(tm.setPinned(a.id, false)).toBe(true)
      expect(tm.list().map((t) => t.url)).toEqual(['b.com', 'c.com', 'a.com'])
      expect(tm.list().find((t) => t.id === a.id)?.pinned).toBe(false)
    })

    it('다중 핀 사이 순서 — 새 핀은 핀 영역 끝(첫 비핀 직전)', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      tm.setPinned(a.id, true) // 핀: a / 비핀: b, c
      tm.setPinned(b.id, true) // 핀: a, b / 비핀: c
      tm.setPinned(c.id, true) // 핀: a, b, c
      expect(tm.list().map((t) => t.url)).toEqual(['a.com', 'b.com', 'c.com'])
      expect(tm.list().every((t) => t.pinned)).toBe(true)
    })

    it('같은 상태 → no-op (emit skip)', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const handler = vi.fn()
      tm.subscribe(handler)
      handler.mockClear()
      expect(tm.setPinned(a.id, false)).toBe(true) // 이미 false
      expect(handler).not.toHaveBeenCalled()
    })

    it('존재하지 않는 id → false', () => {
      const tm = new TabManager()
      tm.open('a.com')
      expect(tm.setPinned('nope', true)).toBe(false)
    })
  })

  // Sprint 011 M3 — closeOthers / closeRight 핀 제외
  describe('closeOthers / closeRight 핀 제외 (Sprint 011 M3)', () => {
    it('closeOthers 시 핀 탭 자동 보존', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      tm.setPinned(a.id, true) // a 핀
      // 순서: a(핀), b, c
      const result = tm.closeOthers(c.id)
      expect(result.ok).toBe(true)
      // closed에 a 없음 (핀 보존), b만 닫힘
      expect(result.closed).toEqual([b.id])
      expect(tm.size()).toBe(2) // a (핀) + c
      expect(tm.getActiveId()).toBe(c.id)
    })

    it('closeRight 시 오른쪽 핀 탭 보존 (드문 케이스 invariant 보호)', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      const b = tm.open('b.com')
      const c = tm.open('c.com')
      // 인위적으로 c를 핀 (b 다음 비핀 다음에 핀 — invariant 위반 시뮬, 단 setPinned가 invariant 유지 → 핀 옮김)
      tm.setPinned(c.id, true) // c가 0번 (핀 영역)
      // 순서: c(핀), a, b
      const result = tm.closeRight(a.id)
      expect(result.ok).toBe(true)
      // a 오른쪽 = b만 (c는 a 왼쪽). 핀 무관하게 b 닫힘
      expect(result.closed).toEqual([b.id])
      expect(tm.size()).toBe(2)
    })
  })

  // Sprint 011 M2 — setColor
  describe('setColor (Sprint 011 M2)', () => {
    it('palette 정상 색상 → true, color 변경', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      expect(tm.setColor(a.id, 'red')).toBe(true)
      expect(tm.list().find((t) => t.id === a.id)?.color).toBe('red')
    })

    it('palette 외 값 거부 → false', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      // @ts-expect-error invalid color for test
      expect(tm.setColor(a.id, 'magenta')).toBe(false)
      expect(tm.list().find((t) => t.id === a.id)?.color).toBeNull()
    })

    it('null 허용 (색상 제거)', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.setColor(a.id, 'blue')
      expect(tm.setColor(a.id, null)).toBe(true)
      expect(tm.list().find((t) => t.id === a.id)?.color).toBeNull()
    })

    it('같은 색 → true, emit skip', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.setColor(a.id, 'green')
      const handler = vi.fn()
      tm.subscribe(handler)
      handler.mockClear()
      expect(tm.setColor(a.id, 'green')).toBe(true)
      expect(handler).not.toHaveBeenCalled()
    })

    it('존재하지 않는 id → false', () => {
      const tm = new TabManager()
      tm.open('a.com')
      expect(tm.setColor('nope', 'red')).toBe(false)
    })
  })

  describe('duplicate (Sprint 010 M2)', () => {
    it('동일 url로 새 탭 생성 + 활성 전환', () => {
      const tm = new TabManager()
      const a = tm.open('a.com')
      tm.open('b.com')
      const dup = tm.duplicate(a.id)
      expect(dup).not.toBeNull()
      expect(dup?.url).toBe('a.com')
      expect(dup?.id).not.toBe(a.id)
      expect(tm.size()).toBe(3)
      expect(tm.getActiveId()).toBe(dup?.id)
    })

    it('존재하지 않는 id → null, 변동 없음', () => {
      const tm = new TabManager()
      tm.open('a.com')
      const before = tm.size()
      expect(tm.duplicate('nope')).toBeNull()
      expect(tm.size()).toBe(before)
    })

    it('about:blank 복제 — about:blank로 신규', () => {
      const tm = new TabManager()
      const a = tm.open() // about:blank
      const dup = tm.duplicate(a.id)
      expect(dup?.url).toBe('about:blank')
    })
  })

  // Sprint 009 M3 — restore
  describe('restore (Sprint 009 M3)', () => {
    it('외부 상태 import — 기존 상태 모두 제거, emit 1회', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.open('b.com')
      const handler = vi.fn()
      tm.subscribe(handler)
      handler.mockClear()
      tm.restore({
        tabs: [
          { id: 'r1', url: 'r1.com', title: 'R1', createdAt: 1, lastActiveAt: 2, color: null, pinned: false },
          { id: 'r2', url: 'r2.com', title: 'R2', createdAt: 3, lastActiveAt: 4, color: null, pinned: false }
        ],
        activeId: 'r2'
      })
      expect(handler).toHaveBeenCalledTimes(1)
      expect(tm.size()).toBe(2)
      expect(tm.getActiveId()).toBe('r2')
      expect(tm.list().map((t) => t.id)).toEqual(['r1', 'r2'])
    })

    it('activeId가 tabs에 없으면 마지막 탭으로 fallback', () => {
      const tm = new TabManager()
      tm.restore({
        tabs: [
          { id: 'r1', url: 'r1.com', title: '', createdAt: 1, lastActiveAt: 2, color: null, pinned: false },
          { id: 'r2', url: 'r2.com', title: '', createdAt: 3, lastActiveAt: 4, color: null, pinned: false }
        ],
        activeId: 'missing'
      })
      expect(tm.getActiveId()).toBe('r2')
    })

    it('빈 tabs 복원 → activeId null', () => {
      const tm = new TabManager()
      tm.open('a.com')
      tm.restore({ tabs: [], activeId: null })
      expect(tm.size()).toBe(0)
      expect(tm.getActiveId()).toBeNull()
    })
  })
})
