import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TranslationCache } from '../../../src/storage/TranslationCache'

describe('TranslationCache', () => {
  let cachePath: string

  beforeEach(() => {
    cachePath = join(
      tmpdir(),
      `tc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
  })

  afterEach(async () => {
    try {
      await fs.unlink(cachePath)
    } catch {
      // ignore
    }
  })

  describe('buildKey', () => {
    it('produces consistent sourceHash for the same text', () => {
      const k1 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      const k2 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(k1.sourceHash).toBe(k2.sourceHash)
      expect(k1.composite).toBe(k2.composite)
    })

    it('produces different composite for different language pair', () => {
      const k1 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      const k2 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(k1.composite).not.toBe(k2.composite)
    })

    it('produces different composite for different provider', () => {
      const k1 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      const k2 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'anthropic',
        requestType: 'selection'
      })
      expect(k1.composite).not.toBe(k2.composite)
    })

    it('requestType is part of the key (Sprint 005 M1)', () => {
      const k1 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      const k2 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'summary'
      })
      const k3 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'explanation'
      })
      expect(k1.sourceHash).toBe(k2.sourceHash) // 같은 source
      expect(k1.composite).not.toBe(k2.composite) // 키는 다름
      expect(k1.composite).not.toBe(k3.composite)
      expect(k2.composite).not.toBe(k3.composite)
    })

    it('glossaryVersion is part of the key', () => {
      const k1 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        glossaryVersion: 'v1'
      })
      const k2 = TranslationCache.buildKey({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        glossaryVersion: 'v2'
      })
      expect(k1.composite).not.toBe(k2.composite)
    })
  })

  describe('requestType 분리 (Sprint 005 M1)', () => {
    it('same sourceText with different requestType keeps separate entries', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      await cache.store({
        sourceText: 'hello world',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '번역: 안녕'
      })
      await cache.store({
        sourceText: 'hello world',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'summary',
        translatedText: '요약: 인사말'
      })
      await cache.store({
        sourceText: 'hello world',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'explanation',
        translatedText: '설명: 일반적 인사'
      })
      expect(cache.size()).toBe(3)
      const sel = await cache.lookup({
        sourceText: 'hello world',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      const sum = await cache.lookup({
        sourceText: 'hello world',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'summary'
      })
      expect(sel?.translatedText).toBe('번역: 안녕')
      expect(sum?.translatedText).toBe('요약: 인사말')
    })
  })

  describe('store / lookup', () => {
    it('returns null on miss', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      const hit = await cache.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit).toBeNull()
    })

    it('returns stored entry on hit + increments hitCount', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕',
        domain: 'www.example.com'
      })
      const hit1 = await cache.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit1).not.toBeNull()
      expect(hit1?.translatedText).toBe('안녕')
      expect(hit1?.hitCount).toBe(1)
      const hit2 = await cache.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit2?.hitCount).toBe(2)
    })

    it('store with same key updates translation + extends expiry', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      const a = await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      await new Promise((r) => setTimeout(r, 3))
      const b = await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕하세요'
      })
      expect(b.id).toBe(a.id)
      expect(b.translatedText).toBe('안녕하세요')
      expect(b.expiresAt).toBeGreaterThanOrEqual(a.expiresAt)
    })
  })

  describe('TTL', () => {
    it('default TTL is approximately 90 days', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      const before = Date.now()
      const entry = await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      const ninetyDays = 90 * 24 * 60 * 60 * 1000
      expect(entry.expiresAt - before).toBeGreaterThanOrEqual(ninetyDays - 1000)
      expect(entry.expiresAt - before).toBeLessThan(ninetyDays + 1000)
    })

    it('subtitle TTL is approximately 365 days', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      const before = Date.now()
      const entry = await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕',
        isSubtitle: true
      })
      const oneYear = 365 * 24 * 60 * 60 * 1000
      expect(entry.expiresAt - before).toBeGreaterThanOrEqual(oneYear - 1000)
    })

    it('expired entries are dropped on lookup', async () => {
      const cache = new TranslationCache(cachePath, { defaultTtlMs: 5 })
      await cache.load()
      await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      await new Promise((r) => setTimeout(r, 20))
      const hit = await cache.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit).toBeNull()
      expect(cache.size()).toBe(0)
    })
  })

  describe('persistence', () => {
    it('loads previously persisted entries from disk', async () => {
      const cache1 = new TranslationCache(cachePath)
      await cache1.load()
      await cache1.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      await cache1.flush()

      const cache2 = new TranslationCache(cachePath)
      await cache2.load()
      const hit = await cache2.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit?.translatedText).toBe('안녕')
    })

    it('clearAll removes memory and disk', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      await cache.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      await cache.clearAll()
      expect(cache.size()).toBe(0)
      await expect(fs.readFile(cachePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('glossary invalidation', () => {
    it('invalidateByGlossaryVersion removes only matching entries', async () => {
      const cache = new TranslationCache(cachePath)
      await cache.load()
      await cache.store({
        sourceText: 'A',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        glossaryVersion: 'v1',
        translatedText: '에이'
      })
      await cache.store({
        sourceText: 'B',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        glossaryVersion: 'v2',
        translatedText: '비'
      })
      expect(cache.size()).toBe(2)
      const removed = await cache.invalidateByGlossaryVersion('v1')
      expect(removed).toBe(1)
      expect(cache.size()).toBe(1)
      const hit = await cache.lookup({
        sourceText: 'B',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        glossaryVersion: 'v2'
      })
      expect(hit?.translatedText).toBe('비')
    })
  })
})
