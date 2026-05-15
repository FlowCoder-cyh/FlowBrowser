/**
 * Sprint 013 M1 — ClosedTabHistory 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import { ClosedTabHistory } from '../../../src/main/ClosedTabHistory'

function basicEntry(url: string): {
  url: string
  title: string
  color: null
  pinned: false
} {
  return { url, title: url, color: null, pinned: false }
}

describe('ClosedTabHistory', () => {
  it('push → pop LIFO', () => {
    const h = new ClosedTabHistory(10)
    h.push(basicEntry('a.com'))
    h.push(basicEntry('b.com'))
    expect(h.pop()?.url).toBe('b.com')
    expect(h.pop()?.url).toBe('a.com')
    expect(h.pop()).toBeNull()
  })

  it('pop 빈 스택 → null', () => {
    const h = new ClosedTabHistory(10)
    expect(h.pop()).toBeNull()
  })

  it('peek는 제거 없이 마지막 반환', () => {
    const h = new ClosedTabHistory(10)
    h.push(basicEntry('x.com'))
    expect(h.peek()?.url).toBe('x.com')
    expect(h.size()).toBe(1) // 변동 없음
  })

  it('한계 초과 시 가장 오래된 제거', () => {
    const h = new ClosedTabHistory(3)
    h.push(basicEntry('a'))
    h.push(basicEntry('b'))
    h.push(basicEntry('c'))
    h.push(basicEntry('d')) // a가 밀려나야 함
    expect(h.size()).toBe(3)
    expect(h.pop()?.url).toBe('d')
    expect(h.pop()?.url).toBe('c')
    expect(h.pop()?.url).toBe('b')
    expect(h.pop()).toBeNull() // a는 이미 제거
  })

  it('clear → size 0', () => {
    const h = new ClosedTabHistory(3)
    h.push(basicEntry('a'))
    h.push(basicEntry('b'))
    h.clear()
    expect(h.size()).toBe(0)
    expect(h.pop()).toBeNull()
  })

  it('closedAt 자동 설정', () => {
    const h = new ClosedTabHistory(3)
    const before = Date.now()
    h.push(basicEntry('a'))
    const entry = h.pop()
    expect(entry?.closedAt).toBeGreaterThanOrEqual(before)
  })

  it('maxItems < 1 → throw', () => {
    expect(() => new ClosedTabHistory(0)).toThrow()
  })
})
