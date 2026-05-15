/**
 * Sprint 006 M3 / S006-T08 — PageResultStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PageResultStore,
  normalizePageUrl,
  nodesSignatureFromTexts
} from '../../../src/storage/PageResultStore'

describe('normalizePageUrl', () => {
  it('strips query and fragment', () => {
    expect(normalizePageUrl('https://example.com/path?q=1#frag')).toBe(
      'https://example.com/path'
    )
  })

  it('returns origin+pathname only', () => {
    expect(normalizePageUrl('https://example.com:8080/foo/bar')).toBe(
      'https://example.com:8080/foo/bar'
    )
  })

  it('returns empty string for empty input', () => {
    expect(normalizePageUrl('')).toBe('')
  })

  it('falls back to trim on invalid url', () => {
    expect(normalizePageUrl('  not a url  ')).toBe('not a url')
  })
})

describe('nodesSignatureFromTexts', () => {
  it('returns deterministic 32-char hex', () => {
    const s1 = nodesSignatureFromTexts([
      { id: 'n0', text: 'hello' },
      { id: 'n1', text: 'world' }
    ])
    const s2 = nodesSignatureFromTexts([
      { id: 'n0', text: 'hello' },
      { id: 'n1', text: 'world' }
    ])
    expect(s1).toBe(s2)
    expect(s1.length).toBe(32)
  })

  it('changes when any text changes', () => {
    const a = nodesSignatureFromTexts([{ id: 'n0', text: 'hello' }])
    const b = nodesSignatureFromTexts([{ id: 'n0', text: 'world' }])
    expect(a).not.toBe(b)
  })
})

describe('PageResultStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `pr-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('throws before load', async () => {
    const store = new PageResultStore(path)
    await expect(
      store.store({
        url: 'https://a.com/x',
        targetLanguage: 'ko',
        providerType: 'openai',
        nodesSignature: 'abc',
        selectorPreset: 'page',
        instructions: []
      })
    ).rejects.toThrow('PageResultStore.load() not called')
  })

  it('empty load when file missing', async () => {
    const store = new PageResultStore(path)
    await store.load()
    expect(store.size()).toBe(0)
  })

  it('store + lookup hit (same key)', async () => {
    const store = new PageResultStore(path)
    await store.load()
    await store.store({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig1',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    const hit = await store.lookup({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai'
    })
    expect(hit).not.toBeNull()
    expect(hit?.instructions.length).toBe(1)
  })

  it('query/fragment is ignored — normalized URL', async () => {
    const store = new PageResultStore(path)
    await store.load()
    await store.store({
      url: 'https://example.com/page?x=1',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig1',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    const hit = await store.lookup({
      url: 'https://example.com/page#frag',
      targetLanguage: 'ko',
      providerType: 'openai'
    })
    expect(hit).not.toBeNull()
  })

  it('different glossaryVersion → different key (miss)', async () => {
    const store = new PageResultStore(path)
    await store.load()
    await store.store({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai',
      glossaryVersion: 'v1',
      nodesSignature: 'sig1',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    const miss = await store.lookup({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai',
      glossaryVersion: 'v2'
    })
    expect(miss).toBeNull()
  })

  it('nodesSignature mismatch returns null', async () => {
    const store = new PageResultStore(path)
    await store.load()
    await store.store({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig-old',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    const miss = await store.lookup({
      url: 'https://example.com/page',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig-new'
    })
    expect(miss).toBeNull()
  })

  it('expired entry is removed on lookup', async () => {
    const store = new PageResultStore(path, { ttlMs: 1 })
    await store.load()
    await store.store({
      url: 'https://example.com/x',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    await new Promise((r) => setTimeout(r, 20))
    const miss = await store.lookup({
      url: 'https://example.com/x',
      targetLanguage: 'ko',
      providerType: 'openai'
    })
    expect(miss).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('persistence: reload reads stored entries', async () => {
    const s1 = new PageResultStore(path)
    await s1.load()
    await s1.store({
      url: 'https://example.com/x',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    await s1.flush()
    const s2 = new PageResultStore(path)
    await s2.load()
    const hit = await s2.lookup({
      url: 'https://example.com/x',
      targetLanguage: 'ko',
      providerType: 'openai'
    })
    expect(hit?.instructions[0]?.translatedText).toBe('안녕')
  })

  it('clearAll removes memory + disk', async () => {
    const store = new PageResultStore(path)
    await store.load()
    await store.store({
      url: 'https://example.com/x',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [{ id: 'n0', translatedText: '안녕' }]
    })
    await store.clearAll()
    expect(store.size()).toBe(0)
    await expect(fs.access(path)).rejects.toThrow()
  })

  it('LRU trim when maxBytes exceeded', async () => {
    // 항목당 약 536 bytes. maxBytes 1500이면 3 항목째 직렬화 시 초과 → trim → 절반(1) 보존.
    const store = new PageResultStore(path, { maxBytes: 1500 })
    await store.load()
    for (let i = 0; i < 6; i++) {
      await store.store({
        url: `https://example.com/p${i}`,
        targetLanguage: 'ko',
        providerType: 'openai',
        nodesSignature: `sig${i}`,
        selectorPreset: 'page',
        instructions: [
          { id: 'n0', translatedText: 'x'.repeat(60) },
          { id: 'n1', translatedText: 'y'.repeat(60) }
        ]
      })
    }
    // trim 발생 후 절반 ≤ 3
    expect(store.size()).toBeGreaterThan(0)
    expect(store.size()).toBeLessThanOrEqual(3)
  })
})
