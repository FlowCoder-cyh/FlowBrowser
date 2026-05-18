/**
 * Sprint 015 M5-1 — ShortcutStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ShortcutStore,
  ShortcutConflictError,
  SHORTCUT_BINDING_IDS,
  isValidAccelerator,
  acceleratorsEqual
} from '../../../src/storage/ShortcutStore'

describe('ShortcutStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `sc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('throws getBindings() before load()', () => {
    const store = new ShortcutStore(path)
    expect(() => store.getBindings()).toThrow('ShortcutStore.load() not called')
  })

  it('returns default bindings when file missing', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    const bindings = store.getBindings()
    expect(bindings).toHaveLength(SHORTCUT_BINDING_IDS.length)
    const focus = bindings.find((b) => b.id === 'searchBar.focus')
    expect(focus?.accelerator).toBe('CommandOrControl+K')
  })

  it('returns deep copy from getBindings() (caller mutation does not leak)', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    const first = store.getBindings()
    first[0].accelerator = 'HACKED+Z'
    const second = store.getBindings()
    expect(second[0].accelerator).not.toBe('HACKED+Z')
  })

  it('setBinding persists and reload preserves', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    const result = await store.setBinding('searchBar.focus', 'CommandOrControl+Shift+K')
    expect(result.accelerator).toBe('CommandOrControl+Shift+K')

    const reloaded = new ShortcutStore(path)
    await reloaded.load()
    expect(reloaded.getBinding('searchBar.focus')?.accelerator).toBe('CommandOrControl+Shift+K')
  })

  it('setBinding throws on invalid accelerator', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    await expect(store.setBinding('searchBar.focus', '')).rejects.toThrow('invalid accelerator')
    await expect(store.setBinding('searchBar.focus', 'BadKey+@@')).rejects.toThrow(
      'invalid accelerator'
    )
  })

  it('setBinding throws on unknown id', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    await expect(
      // @ts-expect-error 의도적 잘못된 id 전달 테스트
      store.setBinding('unknown.binding', 'Ctrl+K')
    ).rejects.toThrow('unknown binding id')
  })

  it('falls back to default when disk file has invalid accelerator', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({ bindings: [{ id: 'searchBar.focus', accelerator: 'bogus@@' }] })
    )
    const store = new ShortcutStore(path)
    await store.load()
    expect(store.getBinding('searchBar.focus')?.accelerator).toBe('CommandOrControl+K')
  })

  it('preserves valid bindings and fills missing with defaults', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({ bindings: [{ id: 'searchBar.focus', accelerator: 'CommandOrControl+J' }] })
    )
    const store = new ShortcutStore(path)
    await store.load()
    expect(store.getBinding('searchBar.focus')?.accelerator).toBe('CommandOrControl+J')
  })

  it('trims accelerator input', async () => {
    const store = new ShortcutStore(path)
    await store.load()
    const result = await store.setBinding('searchBar.focus', '  Ctrl+K  ')
    expect(result.accelerator).toBe('Ctrl+K')
  })
})

describe('isValidAccelerator', () => {
  it('accepts single letter key with modifier', () => {
    expect(isValidAccelerator('Ctrl+K')).toBe(true)
    expect(isValidAccelerator('CommandOrControl+K')).toBe(true)
    expect(isValidAccelerator('Cmd+Shift+K')).toBe(true)
    expect(isValidAccelerator('Alt+K')).toBe(true)
  })

  it('accepts function keys', () => {
    expect(isValidAccelerator('F1')).toBe(true)
    expect(isValidAccelerator('Ctrl+F12')).toBe(true)
    expect(isValidAccelerator('F24')).toBe(true)
  })

  it('accepts special keys', () => {
    expect(isValidAccelerator('Ctrl+Space')).toBe(true)
    expect(isValidAccelerator('Alt+Tab')).toBe(true)
    expect(isValidAccelerator('Ctrl+Enter')).toBe(true)
  })

  it('rejects empty / invalid', () => {
    expect(isValidAccelerator('')).toBe(false)
    expect(isValidAccelerator('   ')).toBe(false)
    expect(isValidAccelerator('Ctrl+')).toBe(false)
    expect(isValidAccelerator('Ctrl+@@')).toBe(false)
    expect(isValidAccelerator('Foo+K')).toBe(false)
    expect(isValidAccelerator('F25')).toBe(false)
  })

  it('rejects duplicate modifiers', () => {
    expect(isValidAccelerator('Ctrl+Ctrl+K')).toBe(false)
  })
})

describe('acceleratorsEqual', () => {
  it('treats Cmd / Command as equivalent', () => {
    expect(acceleratorsEqual('Cmd+K', 'Command+K')).toBe(true)
  })

  it('treats CmdOrCtrl / CommandOrControl as equivalent', () => {
    expect(acceleratorsEqual('CmdOrCtrl+K', 'CommandOrControl+K')).toBe(true)
  })

  it('treats Option / Alt as equivalent', () => {
    expect(acceleratorsEqual('Option+K', 'Alt+K')).toBe(true)
  })

  it('is modifier-order insensitive', () => {
    expect(acceleratorsEqual('Ctrl+Shift+K', 'Shift+Ctrl+K')).toBe(true)
  })

  it('distinguishes different keys', () => {
    expect(acceleratorsEqual('Ctrl+K', 'Ctrl+J')).toBe(false)
  })
})

describe('ShortcutStore conflict detection', () => {
  // 본 테스트는 SHORTCUT_BINDING_IDS 가 1개일 때는 자기 자신과 비교라 conflict 가 발생할 수 없다.
  // 향후 binding 추가 시 conflict 검증 회귀가 의미를 가진다.
  // 본 테스트는 ShortcutConflictError 가 export 되고 instanceof 체크 가능함을 확인.
  it('ShortcutConflictError is exported and constructible', () => {
    const err = new ShortcutConflictError('searchBar.focus', 'Ctrl+K')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ShortcutConflictError')
    expect(err.conflictsWith).toBe('searchBar.focus')
    expect(err.accelerator).toBe('Ctrl+K')
  })
})
