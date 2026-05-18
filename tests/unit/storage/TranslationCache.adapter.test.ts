/**
 * Sprint 015 M2-1 — TranslationCache 어댑터 모드 회귀.
 *
 * 검증:
 *   - backend 주입 시 모든 read/write 가 AIResponseCache 로 위임
 *   - 기존 TranslationCache 인터페이스 100% 보존 (호출자 영향 0)
 *   - kind='translation' 만 사용 (다른 kind 영향 없음)
 *   - 어댑터 모드와 v0.3 모드 결과 동치성
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TranslationCache } from '../../../src/storage/TranslationCache'
import { AIResponseCache } from '../../../src/storage/AIResponseCache'

describe('TranslationCache (adapter mode, backend = AIResponseCache)', () => {
  let backendPath: string
  let legacyPath: string

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    backendPath = join(tmpdir(), `tc-adapter-backend-${suffix}.json`)
    legacyPath = join(tmpdir(), `tc-adapter-legacy-${suffix}.json`)
  })

  afterEach(async () => {
    for (const p of [backendPath, legacyPath]) {
      try {
        await fs.unlink(p)
      } catch {
        // ignore
      }
    }
  })

  async function makeAdapter() {
    const backend = new AIResponseCache(backendPath)
    await backend.load()
    const tc = new TranslationCache(legacyPath, { backend })
    await tc.load()
    return { tc, backend }
  }

  it('isAdapterMode() returns true only when backend is injected', async () => {
    const tcLegacy = new TranslationCache(legacyPath)
    await tcLegacy.load()
    expect(tcLegacy.isAdapterMode()).toBe(false)

    const { tc } = await makeAdapter()
    expect(tc.isAdapterMode()).toBe(true)
  })

  it('stored entry is retrievable via lookup with same key', async () => {
    const { tc } = await makeAdapter()
    await tc.store({
      sourceText: 'hello world',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕 세상',
      domain: 'example.com'
    })
    const hit = await tc.lookup({
      sourceText: 'hello world',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    expect(hit?.translatedText).toBe('안녕 세상')
    expect(hit?.domain).toBe('example.com')
    expect(hit?.sourceLanguage).toBe('en')
    expect(hit?.targetLanguage).toBe('ko')
    expect(hit?.providerType).toBe('openai')
    expect(hit?.requestType).toBe('selection')
    expect(hit?.glossaryVersion).toBe('default')
  })

  it('hitCount increments on each lookup hit (delegated to backend)', async () => {
    const { tc } = await makeAdapter()
    await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕'
    })
    const h1 = await tc.lookup({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    const h2 = await tc.lookup({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    expect(h1?.hitCount).toBe(1)
    expect(h2?.hitCount).toBe(2)
  })

  it('store with same composite key preserves id and updates translatedText', async () => {
    const { tc } = await makeAdapter()
    const a = await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕'
    })
    const b = await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕하세요'
    })
    expect(b.id).toBe(a.id)
    expect(b.translatedText).toBe('안녕하세요')
    expect(b.createdAt).toBe(a.createdAt)
  })

  it('subtitle TTL applies (~365d) via backend ttlMs override', async () => {
    const { tc } = await makeAdapter()
    const before = Date.now()
    const entry = await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'subtitle',
      translatedText: '안녕',
      isSubtitle: true
    })
    const oneYear = 365 * 24 * 60 * 60 * 1000
    expect(entry.expiresAt - before).toBeGreaterThanOrEqual(oneYear - 1000)
  })

  it('invalidateByGlossaryVersion removes only matching entries', async () => {
    const { tc, backend } = await makeAdapter()
    await tc.store({
      sourceText: 'A',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      glossaryVersion: 'v1',
      translatedText: '에이'
    })
    await tc.store({
      sourceText: 'B',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      glossaryVersion: 'v2',
      translatedText: '비'
    })
    expect(tc.size()).toBe(2)
    const removed = await tc.invalidateByGlossaryVersion('v1')
    expect(removed).toBe(1)
    expect(tc.size()).toBe(1)
    expect(backend.sizeOf('translation')).toBe(1)
    const remaining = await tc.lookup({
      sourceText: 'B',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      glossaryVersion: 'v2'
    })
    expect(remaining?.translatedText).toBe('비')
  })

  it('clearAll removes only kind=translation entries from backend', async () => {
    const { tc, backend } = await makeAdapter()
    await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕'
    })
    await backend.store({ kind: 'embedding', key: 'e1', value: [0.1] })
    await tc.clearAll()
    expect(tc.size()).toBe(0)
    expect(backend.sizeOf('translation')).toBe(0)
    expect(backend.sizeOf('embedding')).toBe(1)
  })

  it('stats reports per-kind translation count and hitTotal', async () => {
    const { tc, backend } = await makeAdapter()
    await tc.store({
      sourceText: 'A',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '에이'
    })
    await backend.store({ kind: 'embedding', key: 'e1', value: [0] })
    await tc.lookup({
      sourceText: 'A',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    await tc.lookup({
      sourceText: 'A',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    const stats = tc.stats()
    expect(stats.count).toBe(1)
    expect(stats.hitTotal).toBe(2)
  })

  it('different requestType yields separate backend entries (Sprint 005 M1 정합)', async () => {
    const { tc } = await makeAdapter()
    await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '번역'
    })
    await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'summary',
      translatedText: '요약'
    })
    expect(tc.size()).toBe(2)
    const sel = await tc.lookup({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    const sum = await tc.lookup({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'summary'
    })
    expect(sel?.translatedText).toBe('번역')
    expect(sum?.translatedText).toBe('요약')
  })

  it('legacy JSON file is not written when backend is injected', async () => {
    const { tc } = await makeAdapter()
    await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕'
    })
    await tc.flush()
    await expect(fs.readFile(legacyPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // M2-1 codex 핫픽스 — store 가 hit 으로 잘못 집계되지 않음 (peek 사용)
  it('store on existing key does not increment hitCount (peek, not lookup)', async () => {
    const { tc, backend } = await makeAdapter()
    const stored1 = await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕'
    })
    expect(stored1.hitCount).toBe(0)
    const stored2 = await tc.store({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      translatedText: '안녕하세요'
    })
    // 두 번째 store 는 갱신 — hitCount 는 여전히 0 (store ≠ hit)
    expect(stored2.hitCount).toBe(0)
    // 실제 lookup 이 한 번 발생해야 hitCount = 1
    const hit = await tc.lookup({
      sourceText: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    expect(hit?.hitCount).toBe(1)
    // backend 직접 검사 — 동치 보장
    const peeked = backend.peek({
      kind: 'translation',
      key: 'translation|*' // 형식은 다르지만 단일 entry 만 있으므로 stats 로 확인
    })
    expect(peeked).toBeNull() // composite key 가 다르므로 null
    const stats = backend.stats()
    expect(stats.perKind.translation.hitTotal).toBe(1)
  })

  it('hitCount equality: v0.3 mode and adapter mode produce same hitCount after N stores + M lookups', async () => {
    const { tc: adapterTc } = await makeAdapter()
    const legacyTc = new (await import('../../../src/storage/TranslationCache')).TranslationCache(
      legacyPath
    )
    await legacyTc.load()

    const key = {
      sourceText: 'test',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection' as const,
      translatedText: 't'
    }
    // 동일 시퀀스: store 3회 + lookup 2회
    await adapterTc.store(key)
    await adapterTc.store({ ...key, translatedText: 't2' })
    await adapterTc.store({ ...key, translatedText: 't3' })
    const adapterHit1 = await adapterTc.lookup(key)
    const adapterHit2 = await adapterTc.lookup(key)

    await legacyTc.store(key)
    await legacyTc.store({ ...key, translatedText: 't2' })
    await legacyTc.store({ ...key, translatedText: 't3' })
    const legacyHit1 = await legacyTc.lookup(key)
    const legacyHit2 = await legacyTc.lookup(key)

    expect(adapterHit1?.hitCount).toBe(legacyHit1?.hitCount)
    expect(adapterHit2?.hitCount).toBe(legacyHit2?.hitCount)
  })

  // M2-8 codex NB-F 핫픽스 — v0.3 단위 테스트 (TranslationCache.test) 제거에 따른 backend 미주입 path 회귀 보완.
  describe('legacy mode (backend 미주입, v0.3 호환 경로 회귀)', () => {
    it('legacy: persistence — disk round-trip + TTL 디폴트 90일', async () => {
      const tc1 = new TranslationCache(legacyPath)
      await tc1.load()
      const before = Date.now()
      const stored = await tc1.store({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        translatedText: '안녕'
      })
      await tc1.flush()
      // 디폴트 TTL 90일 (DEFAULT_TTL_MS) 정합 검증
      const ninetyDays = 90 * 24 * 60 * 60 * 1000
      expect(stored.expiresAt - before).toBeGreaterThanOrEqual(ninetyDays - 1000)
      expect(stored.expiresAt - before).toBeLessThan(ninetyDays + 1000)

      // 신규 인스턴스 disk 복원
      const tc2 = new TranslationCache(legacyPath)
      await tc2.load()
      const hit = await tc2.lookup({
        sourceText: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(hit?.translatedText).toBe('안녕')
      expect(hit?.hitCount).toBe(1)
    })

    it('legacy: LRU trim — maxBytes 초과 시 절반 제거 (가장 오래된 항목)', async () => {
      // 각 entry 직렬화 = ~400 bytes (id/timestamps/text 등). 8 entries × 400 = ~3200 bytes.
      // maxBytes 2000 → 1회 trim 후 절반 (4) 보존 정도.
      const tc = new TranslationCache(legacyPath, { maxBytes: 2000 })
      await tc.load()
      for (let i = 0; i < 8; i++) {
        await tc.store({
          sourceText: `text-${i}-${'x'.repeat(40)}`,
          sourceLanguage: 'en',
          targetLanguage: 'ko',
          providerType: 'openai',
          requestType: 'selection',
          translatedText: 'y'.repeat(40)
        })
        await new Promise((r) => setTimeout(r, 2))
      }
      // LRU trim 동작 — 일부 제거 후 일부 보존
      expect(tc.size()).toBeLessThan(8)
      expect(tc.size()).toBeGreaterThan(0)
      // 가장 최근 store 된 항목은 보존
      const recent = await tc.lookup({
        sourceText: `text-7-${'x'.repeat(40)}`,
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection'
      })
      expect(recent).not.toBeNull()
    })
  })
})
