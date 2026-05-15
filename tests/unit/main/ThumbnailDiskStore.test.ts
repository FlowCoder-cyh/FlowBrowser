/**
 * Sprint 013 M2 — ThumbnailDiskStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ThumbnailDiskStore,
  THUMBNAIL_POLICY_VERSION
} from '../../../src/main/ThumbnailDiskStore'

describe('ThumbnailDiskStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `thumbs-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('save → load round-trip', async () => {
    const s = new ThumbnailDiskStore(path)
    await s.save([
      {
        tabId: 'a',
        entry: { dataUrl: 'data:image/png;base64,AAA', capturedAt: 1, width: 300, height: 200 }
      },
      {
        tabId: 'b',
        entry: { dataUrl: 'data:image/png;base64,BBB', capturedAt: 2, width: 300, height: 200 }
      }
    ])
    const items = await s.load()
    expect(items.length).toBe(2)
    expect(items[0].tabId).toBe('a')
    expect(items[0].entry.dataUrl).toBe('data:image/png;base64,AAA')
    expect(items[1].tabId).toBe('b')
  })

  it('파일 없음 → 빈 배열', async () => {
    const s = new ThumbnailDiskStore(path)
    const items = await s.load()
    expect(items).toEqual([])
  })

  it('손상 JSON → 빈 배열 (예외 안 던짐)', async () => {
    await fs.writeFile(path, '{ this is not valid json')
    const s = new ThumbnailDiskStore(path)
    const items = await s.load()
    expect(items).toEqual([])
  })

  it('policyVersion 불일치 → 빈 배열', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        policyVersion: 999,
        items: [
          { tabId: 'a', entry: { dataUrl: 'x', capturedAt: 1, width: 1, height: 1 } }
        ]
      })
    )
    const s = new ThumbnailDiskStore(path)
    const items = await s.load()
    expect(items).toEqual([])
  })

  it('필드 누락된 item 필터링', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        policyVersion: THUMBNAIL_POLICY_VERSION,
        items: [
          {
            tabId: 'good',
            entry: { dataUrl: 'd', capturedAt: 1, width: 100, height: 50 }
          },
          { tabId: 'bad' }, // entry 누락
          'not-an-object',
          {
            entry: { dataUrl: 'd', capturedAt: 1, width: 100, height: 50 } // tabId 누락
          }
        ]
      })
    )
    const s = new ThumbnailDiskStore(path)
    const items = await s.load()
    expect(items.length).toBe(1)
    expect(items[0].tabId).toBe('good')
  })

  it('clear 후 load → 빈 배열', async () => {
    const s = new ThumbnailDiskStore(path)
    await s.save([
      { tabId: 'a', entry: { dataUrl: 'x', capturedAt: 1, width: 1, height: 1 } }
    ])
    await s.clear()
    const items = await s.load()
    expect(items).toEqual([])
  })
})
