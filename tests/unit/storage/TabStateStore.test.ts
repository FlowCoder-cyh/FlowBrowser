/**
 * Sprint 009 M3 / S009-T10 — TabStateStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  TabStateStore,
  TAB_STATE_POLICY_VERSION
} from '../../../src/storage/TabStateStore'

describe('TabStateStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `tabs-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('load 미존재 파일 → 빈 상태', async () => {
    const store = new TabStateStore(path)
    const state = await store.load()
    expect(state.policyVersion).toBe(TAB_STATE_POLICY_VERSION)
    expect(state.tabs).toEqual([])
    expect(state.activeId).toBeNull()
  })

  it('save → load 라운드트립', async () => {
    const store = new TabStateStore(path)
    await store.save({
      tabs: [
        {
          id: 'tab_a',
          url: 'https://a.com',
          title: 'A',
          createdAt: 1,
          lastActiveAt: 2
        },
        {
          id: 'tab_b',
          url: 'https://b.com',
          title: 'B',
          createdAt: 3,
          lastActiveAt: 4
        }
      ],
      activeId: 'tab_b'
    })
    const state = await store.load()
    expect(state.tabs.length).toBe(2)
    expect(state.tabs[0].id).toBe('tab_a')
    expect(state.tabs[1].id).toBe('tab_b')
    expect(state.activeId).toBe('tab_b')
  })

  it('policyVersion 불일치 → 빈 상태 fallback', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({ policyVersion: 999, tabs: [{ id: 'x' }], activeId: 'x' })
    )
    const store = new TabStateStore(path)
    const state = await store.load()
    expect(state.tabs).toEqual([])
    expect(state.activeId).toBeNull()
  })

  it('손상 JSON → 빈 상태 fallback (예외 안 던짐)', async () => {
    await fs.writeFile(path, '{ this is not valid json')
    const store = new TabStateStore(path)
    const state = await store.load()
    expect(state.tabs).toEqual([])
    expect(state.activeId).toBeNull()
  })

  it('필드 누락된 tab 항목은 필터링', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        policyVersion: TAB_STATE_POLICY_VERSION,
        tabs: [
          { id: 'tab_a', url: 'https://a.com', title: 'A', createdAt: 1, lastActiveAt: 2 },
          { id: 'tab_b' }, // 누락
          'not-an-object'
        ],
        activeId: 'tab_a'
      })
    )
    const store = new TabStateStore(path)
    const state = await store.load()
    expect(state.tabs.length).toBe(1)
    expect(state.tabs[0].id).toBe('tab_a')
  })

  it('activeId가 tabs에 없으면 마지막 탭 자동 선택', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        policyVersion: TAB_STATE_POLICY_VERSION,
        tabs: [
          { id: 'tab_a', url: 'a.com', title: '', createdAt: 1, lastActiveAt: 2 },
          { id: 'tab_b', url: 'b.com', title: '', createdAt: 3, lastActiveAt: 4 }
        ],
        activeId: 'missing'
      })
    )
    const store = new TabStateStore(path)
    const state = await store.load()
    expect(state.activeId).toBe('tab_b')
  })

  it('clear 후 load → 빈 상태', async () => {
    const store = new TabStateStore(path)
    await store.save({
      tabs: [{ id: 'tab_a', url: 'a.com', title: '', createdAt: 1, lastActiveAt: 2 }],
      activeId: 'tab_a'
    })
    await store.clear()
    const state = await store.load()
    expect(state.tabs).toEqual([])
  })
})
