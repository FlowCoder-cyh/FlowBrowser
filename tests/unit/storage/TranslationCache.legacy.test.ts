/**
 * Sprint 016 M2 T11 (codex NEEDS_CHANGES #1 / evaluator NEEDS_CHANGES #7 hotfix) —
 * v0.3 JSON path 단일 동작 회귀 안전망.
 *
 * 본 PR (T11) 에서 어댑터 모드 (AIResponseCache backend 분기) 제거 후
 * 기존 `TranslationCache.adapter.test.ts` 가 폐기되어 v0.3 path 직접 회귀 cover 가
 * 통합 흐름 (executeTranslateRequest) 외 0 이 됨. 본 파일은 v0.3 single-path 의
 * 영속 / lookup / TTL / invalidation / clearAll / LRU 동작을 직접 검증.
 *
 * TranslationCache 클래스 자체는 T10 (executeTranslateRequest → ChatService.chat
 * 마이그레이션) 후 폐기 예정 — 본 테스트도 그 시점에 함께 폐기.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TranslationCache, type CacheKeyInput } from '../../../src/storage/TranslationCache'

const baseKey = (overrides: Partial<CacheKeyInput> = {}): CacheKeyInput => ({
  sourceText: 'hello',
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  providerType: 'openai',
  requestType: 'selection',
  glossaryVersion: 'default',
  ...overrides
})

describe('TranslationCache (v0.3 JSON single-path)', () => {
  let filePath: string

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    filePath = join(tmpdir(), `tc-legacy-${suffix}.json`)
  })

  afterEach(async () => {
    await fs.unlink(filePath).catch(() => {})
  })

  it('load() ENOENT → 빈 캐시', async () => {
    const tc = new TranslationCache(filePath)
    await tc.load()
    expect(tc.size()).toBe(0)
  })

  it('store() + lookup() round-trip + raw array shape 영속', async () => {
    const tc = new TranslationCache(filePath)
    await tc.load()
    const stored = await tc.store({ ...baseKey(), translatedText: '안녕' })
    expect(stored.translatedText).toBe('안녕')
    await tc.flush()

    // 디스크 영속 shape 검증 = raw array (T12 codex BLOCKING #1 패턴 cover)
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    expect(Array.isArray(raw)).toBe(true)
    expect(raw.length).toBe(1)
    expect(raw[0].translatedText).toBe('안녕')

    const hit = await tc.lookup(baseKey())
    expect(hit?.translatedText).toBe('안녕')
    expect(hit?.hitCount).toBe(1)
  })

  it('load() raw array shape parse + requestType fallback (selection)', async () => {
    const now = Date.now()
    const legacyEntry = {
      id: 'tc_legacy',
      sourceHash: 'h',
      sourceText: 'x',
      translatedText: '엑스',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      // requestType 의도적 누락 (구 항목 fallback 검증)
      glossaryVersion: 'default',
      domain: null,
      hitCount: 0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: now + 1000_000
    }
    await fs.writeFile(filePath, JSON.stringify([legacyEntry]), 'utf-8')

    const tc = new TranslationCache(filePath)
    await tc.load()
    expect(tc.size()).toBe(1)
    // requestType fallback = 'selection' 확인 — 같은 입력으로 lookup 가능
    const hit = await tc.lookup({
      sourceText: 'x',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection',
      glossaryVersion: 'default'
    })
    // sourceHash 가 'h' 인데 buildKey 는 sha256 — composite mismatch 로 lookup miss 예상.
    // 핵심 검증: load 단계에서 fallback 자체가 던지지 않음 (graceful).
    expect(hit).toBeNull()
  })

  it('lookup() expired entry → null + 자동 purge', async () => {
    const tc = new TranslationCache(filePath, { defaultTtlMs: 5 })
    await tc.load()
    await tc.store({ ...baseKey(), translatedText: '만료' })
    await new Promise((r) => setTimeout(r, 10))
    const hit = await tc.lookup(baseKey())
    expect(hit).toBeNull()
    expect(tc.size()).toBe(0)
  })

  it('invalidateByGlossaryVersion() 매칭 entry 만 제거', async () => {
    const tc = new TranslationCache(filePath)
    await tc.load()
    await tc.store({ ...baseKey({ sourceText: 'a' }), translatedText: 'A', glossaryVersion: 'v1' })
    await tc.store({ ...baseKey({ sourceText: 'b' }), translatedText: 'B', glossaryVersion: 'v1' })
    await tc.store({ ...baseKey({ sourceText: 'c' }), translatedText: 'C', glossaryVersion: 'v2' })
    expect(tc.size()).toBe(3)
    const removed = await tc.invalidateByGlossaryVersion('v1')
    expect(removed).toBe(2)
    expect(tc.size()).toBe(1)
  })

  it('clearAll() → 파일 unlink + memory clear', async () => {
    const tc = new TranslationCache(filePath)
    await tc.load()
    await tc.store({ ...baseKey(), translatedText: '청소' })
    await tc.flush()
    expect(tc.size()).toBe(1)
    await tc.clearAll()
    expect(tc.size()).toBe(0)
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it('LRU 절반 trim — maxBytes 초과 시 lastAccessedAt 기준 절반 제거', async () => {
    // 매우 작은 maxBytes 로 강제 trim 발생
    const tc = new TranslationCache(filePath, { maxBytes: 600 })
    await tc.load()
    for (let i = 0; i < 6; i++) {
      await tc.store({
        ...baseKey({ sourceText: `entry_${i}`, providerType: `p${i}` }),
        translatedText: `T_${i}`
      })
      // lastAccessedAt 분산 위한 미세 sleep
      await new Promise((r) => setTimeout(r, 2))
    }
    await tc.flush()
    expect(tc.size()).toBeLessThanOrEqual(3)
  })

  it('stats() — count + hitTotal 정합', async () => {
    const tc = new TranslationCache(filePath)
    await tc.load()
    await tc.store({ ...baseKey({ sourceText: 'x' }), translatedText: 'X' })
    await tc.store({ ...baseKey({ sourceText: 'y' }), translatedText: 'Y' })
    await tc.lookup(baseKey({ sourceText: 'x' }))
    await tc.lookup(baseKey({ sourceText: 'x' }))
    await tc.lookup(baseKey({ sourceText: 'y' }))
    const s = tc.stats()
    expect(s.count).toBe(2)
    expect(s.hitTotal).toBe(3)
  })
})
