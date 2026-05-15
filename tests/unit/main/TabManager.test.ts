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
})
