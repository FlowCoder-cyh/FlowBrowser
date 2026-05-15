/**
 * Sprint 006 M2 / S006-T05 — UserSettingStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'

describe('UserSettingStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `us-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('throws before load()', async () => {
    const store = new UserSettingStore(path)
    expect(() => store.getState()).toThrow('UserSettingStore.load() not called')
  })

  it('returns default panel mode when file missing', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    expect(store.getState().translationMode).toBe('panel')
  })

  it('update persists to disk', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    const updated = await store.update({ translationMode: 'replace' })
    expect(updated.translationMode).toBe('replace')

    const reloaded = new UserSettingStore(path)
    await reloaded.load()
    expect(reloaded.getState().translationMode).toBe('replace')
  })

  it('throws on invalid translationMode', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    await expect(
      // @ts-expect-error invalid value test
      store.update({ translationMode: 'bogus' })
    ).rejects.toThrow('invalid translationMode')
  })

  it('falls back to panel when disk file has unknown mode', async () => {
    await fs.writeFile(path, JSON.stringify({ translationMode: 'mystery' }))
    const store = new UserSettingStore(path)
    await store.load()
    expect(store.getState().translationMode).toBe('panel')
  })

  it('accepts overlay and panel and replace', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    for (const m of ['overlay', 'panel', 'replace'] as const) {
      const s = await store.update({ translationMode: m })
      expect(s.translationMode).toBe(m)
    }
  })
})
