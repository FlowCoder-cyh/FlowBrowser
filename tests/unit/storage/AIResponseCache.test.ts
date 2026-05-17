import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AIResponseCache,
  AI_CACHE_TTL_DEFAULTS,
  defaultAIResponseCachePath
} from '../../../src/storage/AIResponseCache'

describe('AIResponseCache', () => {
  let cachePath: string

  beforeEach(() => {
    cachePath = join(
      tmpdir(),
      `aic-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
  })

  afterEach(async () => {
    try {
      await fs.unlink(cachePath)
    } catch {
      // ignore
    }
  })

  describe('lookup / store (kind 분리)', () => {
    it('returns null on miss', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      const hit = await cache.lookup({ kind: 'translation', key: 'k1' })
      expect(hit).toBeNull()
    })

    it('stores and retrieves value per kind without collision', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k1', value: 'hello' })
      await cache.store({ kind: 'embedding', key: 'k1', value: [0.1, 0.2, 0.3] })
      await cache.store({ kind: 'ai_response', key: 'k1', value: { text: 'response' } })
      await cache.store({ kind: 'tag', key: 'k1', value: ['topic-1', 'topic-2'] })
      expect(cache.size()).toBe(4)
      expect((await cache.lookup({ kind: 'translation', key: 'k1' }))?.value).toBe('hello')
      expect((await cache.lookup({ kind: 'embedding', key: 'k1' }))?.value).toEqual([0.1, 0.2, 0.3])
      expect((await cache.lookup<{ text: string }>({ kind: 'ai_response', key: 'k1' }))?.value).toEqual({
        text: 'response'
      })
      expect((await cache.lookup({ kind: 'tag', key: 'k1' }))?.value).toEqual(['topic-1', 'topic-2'])
    })

    it('increments hitCount on each lookup hit', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k1', value: 'v1' })
      const h1 = await cache.lookup({ kind: 'translation', key: 'k1' })
      const h2 = await cache.lookup({ kind: 'translation', key: 'k1' })
      const h3 = await cache.lookup({ kind: 'translation', key: 'k1' })
      expect(h1?.hitCount).toBe(1)
      expect(h2?.hitCount).toBe(2)
      expect(h3?.hitCount).toBe(3)
    })

    it('store with same key updates value and extends expiry', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      const a = await cache.store({ kind: 'translation', key: 'k1', value: 'v1' })
      await new Promise((r) => setTimeout(r, 3))
      const b = await cache.store({ kind: 'translation', key: 'k1', value: 'v2' })
      expect(b.id).toBe(a.id)
      expect(b.value).toBe('v2')
      expect(b.expiresAt).toBeGreaterThanOrEqual(a.expiresAt)
    })

    it('persists metadata across store/lookup', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({
        kind: 'translation',
        key: 'k1',
        value: 'v',
        metadata: { sourceLanguage: 'en', targetLanguage: 'ko' }
      })
      const hit = await cache.lookup({ kind: 'translation', key: 'k1' })
      expect(hit?.metadata).toEqual({ sourceLanguage: 'en', targetLanguage: 'ko' })
    })
  })

  describe('TTL', () => {
    it('uses kind-specific TTL defaults', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      const before = Date.now()
      const trans = await cache.store({ kind: 'translation', key: 'kt', value: 'v' })
      const emb = await cache.store({ kind: 'embedding', key: 'ke', value: [0] })
      const ai = await cache.store({ kind: 'ai_response', key: 'ka', value: 'v' })
      const tag = await cache.store({ kind: 'tag', key: 'kg', value: ['t'] })
      expect(trans.expiresAt - before).toBeGreaterThanOrEqual(AI_CACHE_TTL_DEFAULTS.translation - 1000)
      expect(emb.expiresAt - before).toBeGreaterThanOrEqual(AI_CACHE_TTL_DEFAULTS.embedding - 1000)
      expect(ai.expiresAt - before).toBeGreaterThanOrEqual(AI_CACHE_TTL_DEFAULTS.ai_response - 1000)
      expect(tag.expiresAt - before).toBeGreaterThanOrEqual(AI_CACHE_TTL_DEFAULTS.tag - 1000)
    })

    it('explicit ttlMs overrides default', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      const before = Date.now()
      const entry = await cache.store({
        kind: 'translation',
        key: 'k',
        value: 'v',
        ttlMs: 7 * 24 * 60 * 60 * 1000
      })
      const seven = 7 * 24 * 60 * 60 * 1000
      expect(entry.expiresAt - before).toBeGreaterThanOrEqual(seven - 1000)
      expect(entry.expiresAt - before).toBeLessThan(seven + 1000)
    })

    it('expired entries drop on lookup', async () => {
      const cache = new AIResponseCache(cachePath, {
        ttlDefaults: { translation: 5 }
      })
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k', value: 'v' })
      await new Promise((r) => setTimeout(r, 20))
      const hit = await cache.lookup({ kind: 'translation', key: 'k' })
      expect(hit).toBeNull()
      expect(cache.size()).toBe(0)
    })
  })

  describe('invalidate / clearKind / clearAll', () => {
    it('invalidate removes only entries matching predicate within kind', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({
        kind: 'translation',
        key: 'k1',
        value: 'a',
        metadata: { glossaryVersion: 'v1' }
      })
      await cache.store({
        kind: 'translation',
        key: 'k2',
        value: 'b',
        metadata: { glossaryVersion: 'v2' }
      })
      await cache.store({ kind: 'embedding', key: 'ke', value: [0] })
      const removed = await cache.invalidate(
        'translation',
        (entry) => entry.metadata?.glossaryVersion === 'v1'
      )
      expect(removed).toBe(1)
      expect(cache.size()).toBe(2)
      expect((await cache.lookup({ kind: 'translation', key: 'k1' }))).toBeNull()
      expect((await cache.lookup({ kind: 'translation', key: 'k2' }))?.value).toBe('b')
      expect((await cache.lookup({ kind: 'embedding', key: 'ke' }))?.value).toEqual([0])
    })

    it('clearKind removes only entries of that kind', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k1', value: 'a' })
      await cache.store({ kind: 'translation', key: 'k2', value: 'b' })
      await cache.store({ kind: 'embedding', key: 'ke', value: [0] })
      const removed = await cache.clearKind('translation')
      expect(removed).toBe(2)
      expect(cache.size()).toBe(1)
      expect(cache.sizeOf('translation')).toBe(0)
      expect(cache.sizeOf('embedding')).toBe(1)
    })

    it('clearAll wipes memory and disk', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k', value: 'v' })
      await cache.clearAll()
      expect(cache.size()).toBe(0)
      await expect(fs.readFile(cachePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('stats', () => {
    it('reports per-kind count and hitTotal', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k1', value: 'a' })
      await cache.store({ kind: 'translation', key: 'k2', value: 'b' })
      await cache.store({ kind: 'embedding', key: 'ke', value: [0] })
      await cache.lookup({ kind: 'translation', key: 'k1' })
      await cache.lookup({ kind: 'translation', key: 'k1' })
      await cache.lookup({ kind: 'embedding', key: 'ke' })
      const stats = cache.stats()
      expect(stats.count).toBe(3)
      expect(stats.hitTotal).toBe(3)
      expect(stats.perKind.translation.count).toBe(2)
      expect(stats.perKind.translation.hitTotal).toBe(2)
      expect(stats.perKind.embedding.count).toBe(1)
      expect(stats.perKind.embedding.hitTotal).toBe(1)
      expect(stats.perKind.ai_response.count).toBe(0)
      expect(stats.perKind.tag.count).toBe(0)
    })
  })

  describe('persistence', () => {
    it('loads previously persisted entries from disk', async () => {
      const c1 = new AIResponseCache(cachePath)
      await c1.load()
      await c1.store({
        kind: 'translation',
        key: 'k1',
        value: 'v1',
        metadata: { sourceLanguage: 'en' }
      })
      await c1.store({ kind: 'embedding', key: 'ke', value: [1, 2, 3] })
      await c1.flush()

      const c2 = new AIResponseCache(cachePath)
      await c2.load()
      const t = await c2.lookup({ kind: 'translation', key: 'k1' })
      const e = await c2.lookup({ kind: 'embedding', key: 'ke' })
      expect(t?.value).toBe('v1')
      expect(t?.metadata).toEqual({ sourceLanguage: 'en' })
      expect(e?.value).toEqual([1, 2, 3])
    })

    it('parser rejects entries with invalid kind', async () => {
      await fs.writeFile(
        cachePath,
        JSON.stringify([
          {
            id: 'aic_bad',
            kind: 'unknown_kind',
            key: 'k1',
            value: 'v',
            hitCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastAccessedAt: Date.now(),
            expiresAt: Date.now() + 10000
          },
          {
            id: 'aic_good',
            kind: 'translation',
            key: 'k2',
            value: 'good',
            hitCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastAccessedAt: Date.now(),
            expiresAt: Date.now() + 10000
          }
        ]),
        'utf-8'
      )
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(1)
      expect((await cache.lookup({ kind: 'translation', key: 'k2' }))?.value).toBe('good')
    })
  })

  describe('LRU (maxBytes)', () => {
    it('drops half of entries (LRU order) when serialized size exceeds maxBytes', async () => {
      const cache = new AIResponseCache(cachePath, { maxBytes: 500 })
      await cache.load()
      for (let i = 0; i < 8; i++) {
        await cache.store({
          kind: 'translation',
          key: `key-${i}`,
          value: 'x'.repeat(100)
        })
        await new Promise((r) => setTimeout(r, 2))
      }
      // 일부는 LRU로 제거됐어야 함
      expect(cache.size()).toBeLessThan(8)
      expect(cache.size()).toBeGreaterThan(0)
      // 가장 최근에 store 된 항목은 남아있어야 함
      const recent = await cache.lookup({ kind: 'translation', key: 'key-7' })
      expect(recent).not.toBeNull()
    })
  })

  describe('defaultAIResponseCachePath', () => {
    it('returns join(userDataDir, ai-response-cache.json)', () => {
      expect(defaultAIResponseCachePath('/tmp/foo')).toMatch(/ai-response-cache\.json$/)
    })
  })

  describe('error handling', () => {
    it('throws when lookup is called before load()', async () => {
      const cache = new AIResponseCache(cachePath)
      await expect(cache.lookup({ kind: 'translation', key: 'k' })).rejects.toThrow(
        'AIResponseCache.load() not called'
      )
    })

    it('throws when peek is called before load()', async () => {
      const cache = new AIResponseCache(cachePath)
      expect(() => cache.peek({ kind: 'translation', key: 'k' })).toThrow(
        'AIResponseCache.load() not called'
      )
    })
  })

  // M2-1 codex 권고 — side-effect free peek
  describe('peek (side-effect free)', () => {
    it('returns null on miss without scheduling write', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.peek({ kind: 'translation', key: 'absent' })).toBeNull()
    })

    it('returns entry without incrementing hitCount or updating lastAccessedAt', async () => {
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      const stored = await cache.store({ kind: 'translation', key: 'k', value: 'v' })
      const p1 = cache.peek({ kind: 'translation', key: 'k' })
      const p2 = cache.peek({ kind: 'translation', key: 'k' })
      expect(p1?.hitCount).toBe(0)
      expect(p2?.hitCount).toBe(0)
      expect(p1?.lastAccessedAt).toBe(stored.lastAccessedAt)
      expect(p2?.lastAccessedAt).toBe(stored.lastAccessedAt)
    })

    it('peek does not extend expiry or persist', async () => {
      const cache = new AIResponseCache(cachePath, { ttlDefaults: { translation: 50 } })
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k', value: 'v' })
      await cache.flush()
      const sizeBefore = (await fs.stat(cachePath)).size
      cache.peek({ kind: 'translation', key: 'k' })
      cache.peek({ kind: 'translation', key: 'k' })
      await cache.flush()
      const sizeAfter = (await fs.stat(cachePath)).size
      expect(sizeAfter).toBe(sizeBefore)
    })

    it('peek returns expired entry (caller responsibility to check expiresAt)', async () => {
      const cache = new AIResponseCache(cachePath, { ttlDefaults: { translation: 5 } })
      await cache.load()
      await cache.store({ kind: 'translation', key: 'k', value: 'v' })
      await new Promise((r) => setTimeout(r, 20))
      const peeked = cache.peek({ kind: 'translation', key: 'k' })
      expect(peeked).not.toBeNull()
      expect(peeked!.expiresAt).toBeLessThan(Date.now())
    })
  })

  // M2-1 codex 권고 — parseEntry invariant 강화
  describe('parseEntry invariant (M2-1 codex 핫픽스)', () => {
    async function writeRaw(entries: unknown[]) {
      await fs.writeFile(cachePath, JSON.stringify(entries), 'utf-8')
    }

    function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      const now = Date.now()
      return {
        id: 'aic_x',
        kind: 'translation',
        key: 'k',
        value: 'v',
        hitCount: 0,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        expiresAt: now + 10000,
        ...overrides
      }
    }

    it('rejects negative hitCount', async () => {
      await writeRaw([validEntry({ hitCount: -1 })])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('rejects non-integer hitCount (NaN / Infinity / float)', async () => {
      await writeRaw([
        validEntry({ id: 'a', key: 'a', hitCount: Number.NaN }),
        validEntry({ id: 'b', key: 'b', hitCount: Number.POSITIVE_INFINITY }),
        validEntry({ id: 'c', key: 'c', hitCount: 1.5 })
      ])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('rejects negative timestamps', async () => {
      await writeRaw([validEntry({ createdAt: -1 })])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('rejects updatedAt < createdAt', async () => {
      const now = Date.now()
      await writeRaw([validEntry({ createdAt: now, updatedAt: now - 1000 })])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('rejects lastAccessedAt < createdAt', async () => {
      const now = Date.now()
      await writeRaw([validEntry({ createdAt: now, lastAccessedAt: now - 1000 })])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('rejects expiresAt <= createdAt', async () => {
      const now = Date.now()
      await writeRaw([validEntry({ createdAt: now, expiresAt: now })])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(0)
    })

    it('accepts valid entry that passes all invariants', async () => {
      const now = Date.now()
      await writeRaw([
        validEntry({
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + 1000
        })
      ])
      const cache = new AIResponseCache(cachePath)
      await cache.load()
      expect(cache.size()).toBe(1)
    })
  })
})
