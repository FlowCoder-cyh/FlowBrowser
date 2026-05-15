/**
 * Sprint 012 M1 — ThumbnailStore 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import { ThumbnailStore } from '../../../src/main/ThumbnailStore'

function entry(label: string): {
  dataUrl: string
  capturedAt: number
  width: number
  height: number
} {
  return {
    dataUrl: `data:image/png;base64,${label}`,
    capturedAt: Date.now(),
    width: 300,
    height: 200
  }
}

describe('ThumbnailStore', () => {
  it('set + get round-trip', () => {
    const s = new ThumbnailStore(10)
    s.set('a', entry('A'))
    const got = s.get('a')
    expect(got?.dataUrl).toBe('data:image/png;base64,A')
    expect(got?.width).toBe(300)
  })

  it('set 동일 tabId → 갱신 (size 유지)', () => {
    const s = new ThumbnailStore(10)
    s.set('a', entry('A1'))
    s.set('a', entry('A2'))
    expect(s.size()).toBe(1)
    expect(s.get('a')?.dataUrl).toBe('data:image/png;base64,A2')
  })

  it('LRU 한계 초과 시 가장 오래된 제거', () => {
    const s = new ThumbnailStore(3)
    s.set('a', entry('A'))
    s.set('b', entry('B'))
    s.set('c', entry('C'))
    s.set('d', entry('D')) // a 제거
    expect(s.size()).toBe(3)
    expect(s.get('a')).toBeNull()
    expect(s.get('b')?.dataUrl).toBe('data:image/png;base64,B')
    expect(s.get('d')?.dataUrl).toBe('data:image/png;base64,D')
  })

  it('get은 last-touched 갱신 (LRU 갱신)', () => {
    const s = new ThumbnailStore(3)
    s.set('a', entry('A'))
    s.set('b', entry('B'))
    s.set('c', entry('C'))
    // a 조회 → a가 최근 사용
    s.get('a')
    s.set('d', entry('D')) // 가장 오래된 = b (a는 최근 조회)
    expect(s.get('a')?.dataUrl).toBe('data:image/png;base64,A') // 살아있음
    expect(s.get('b')).toBeNull() // 제거됨
    expect(s.get('c')?.dataUrl).toBe('data:image/png;base64,C')
    expect(s.get('d')?.dataUrl).toBe('data:image/png;base64,D')
  })

  it('remove 존재 시 true, 없으면 false', () => {
    const s = new ThumbnailStore(3)
    s.set('a', entry('A'))
    expect(s.remove('a')).toBe(true)
    expect(s.remove('a')).toBe(false)
    expect(s.size()).toBe(0)
  })

  it('clear 전체 제거', () => {
    const s = new ThumbnailStore(3)
    s.set('a', entry('A'))
    s.set('b', entry('B'))
    s.clear()
    expect(s.size()).toBe(0)
    expect(s.get('a')).toBeNull()
  })

  it('get 없는 id → null', () => {
    const s = new ThumbnailStore(3)
    expect(s.get('nope')).toBeNull()
  })

  it('maxItems < 1 → throw', () => {
    expect(() => new ThumbnailStore(0)).toThrow()
  })
})
