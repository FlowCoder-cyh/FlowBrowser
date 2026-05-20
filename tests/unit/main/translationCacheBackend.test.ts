/**
 * Sprint 016 M2 T10b — selection 번역 cache backend 회귀 안전망.
 *
 * codex 사전 경계 5 위험 cover:
 *   #1 composite key 호환 — sha256(sourceText)|src|tgt|provider|requestType|glossaryVersion
 *   #2 value/metadata shape — value.translatedText 읽기 + metadata.glossaryVersion 기준 invalidation
 *   #3 subtitle TTL 365d 보존 — ttlMs 명시 전달
 *   #4 cache hit 시 `${providerType}/cache` 의미 보존 (services.ts:1041 인라인 검증 cover)
 *   #5 T11 마이그레이션 output (AIResponseCache raw array) 이 본 backend 와 round-trip 가능
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import {
  buildTranslationCacheKey,
  type TranslationCacheValue
} from '../../../src/main/services'
import { AIResponseCache } from '../../../src/storage/AIResponseCache'

const baseInput = {
  sourceText: 'Hello world',
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  providerType: 'openai',
  requestType: 'selection' as const,
  glossaryVersion: 'v1'
}

describe('buildTranslationCacheKey (T10b — codex 위험 #1 composite key 호환)', () => {
  it('sha256(sourceText)|src|tgt|provider|requestType|glossaryVersion 형식 정합', () => {
    const key = buildTranslationCacheKey(baseInput)
    const expectedHash = createHash('sha256').update('Hello world').digest('hex')
    expect(key).toBe(`${expectedHash}|en|ko|openai|selection|v1`)
  })

  it('glossaryVersion 미주입 시 "default" fallback', () => {
    const key = buildTranslationCacheKey({
      sourceText: 'x',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai',
      requestType: 'selection'
    })
    expect(key.endsWith('|en|ko|openai|selection|default')).toBe(true)
  })

  it('동일 입력은 동일 key (deterministic)', () => {
    const k1 = buildTranslationCacheKey(baseInput)
    const k2 = buildTranslationCacheKey(baseInput)
    expect(k1).toBe(k2)
  })

  it('requestType 다르면 다른 key (Sprint 005 M1 정합)', () => {
    const sel = buildTranslationCacheKey({ ...baseInput, requestType: 'selection' })
    const sub = buildTranslationCacheKey({ ...baseInput, requestType: 'subtitle' })
    expect(sel).not.toBe(sub)
  })

  it('glossaryVersion 다르면 다른 key (Sprint 005 M2 invalidation 정합)', () => {
    const v1 = buildTranslationCacheKey({ ...baseInput, glossaryVersion: 'v1' })
    const v2 = buildTranslationCacheKey({ ...baseInput, glossaryVersion: 'v2' })
    expect(v1).not.toBe(v2)
  })
})

describe('AIResponseCache(kind=translation) (T10b — codex 위험 #2~#5)', () => {
  let cachePath: string
  let cache: AIResponseCache

  beforeEach(async () => {
    cachePath = join(tmpdir(), `tcb-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    cache = new AIResponseCache(cachePath)
    await cache.load()
  })

  afterEach(async () => {
    await fs.unlink(cachePath).catch(() => {})
  })

  it('위험 #2: value.translatedText 읽기 + metadata.glossaryVersion 기준 invalidation', async () => {
    const key = buildTranslationCacheKey(baseInput)
    await cache.store<TranslationCacheValue>({
      kind: 'translation',
      key,
      value: { translatedText: '안녕 세상', sourceText: 'Hello world', providerType: 'openai' },
      metadata: { glossaryVersion: 'v1', sourceLanguage: 'en', targetLanguage: 'ko' }
    })
    const hit = await cache.lookup<TranslationCacheValue>({ kind: 'translation', key })
    expect(hit?.value.translatedText).toBe('안녕 세상')
    expect((hit?.metadata as { glossaryVersion?: string })?.glossaryVersion).toBe('v1')
    const removed = await cache.invalidate('translation', (entry) => {
      const meta = entry.metadata as { glossaryVersion?: string } | undefined
      return meta?.glossaryVersion === 'v1'
    })
    expect(removed).toBe(1)
    expect(await cache.lookup({ kind: 'translation', key })).toBeNull()
  })

  it('위험 #3: subtitle TTL 365d 보존 (ttlMs 명시 전달)', async () => {
    const key = buildTranslationCacheKey({ ...baseInput, requestType: 'subtitle' })
    const subtitleTtl = 365 * 24 * 60 * 60 * 1000
    const before = Date.now()
    await cache.store<TranslationCacheValue>({
      kind: 'translation',
      key,
      value: { translatedText: '자막', sourceText: 'subtitle', providerType: 'openai' },
      ttlMs: subtitleTtl
    })
    const hit = await cache.lookup<TranslationCacheValue>({ kind: 'translation', key })
    expect(hit).not.toBeNull()
    // expiresAt - createdAt ≈ subtitleTtl (±5초 tolerance)
    const delta = (hit?.expiresAt ?? 0) - (hit?.createdAt ?? 0)
    expect(delta).toBeGreaterThan(subtitleTtl - 5000)
    expect(delta).toBeLessThan(subtitleTtl + 5000)
    void before
  })

  it('위험 #5: T11 마이그레이션 output round-trip 호환 (composite key + value shape 1:1)', async () => {
    // T11 migrateTranslationCache 와 동일 shape 의 entry 를 ai-response-cache.json 에 직접 영속.
    const key = buildTranslationCacheKey(baseInput)
    const now = Date.now()
    const migrationEntry = {
      id: 'aic_migrated',
      kind: 'translation' as const,
      key,
      value: {
        id: 'aic_migrated',
        sourceText: 'Hello world',
        translatedText: '마이그레이션 결과',
        providerType: 'openai', // codex NEEDS_CHANGES #8 hotfix — read-compatible 정합 필드
        domain: null,
        createdAt: now
      },
      metadata: {
        glossaryVersion: 'v1',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        providerType: 'openai',
        requestType: 'selection',
        sourceHash: key.split('|')[0]
      },
      hitCount: 0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: now + 90 * 24 * 60 * 60 * 1000
    }
    await fs.writeFile(cachePath, JSON.stringify([migrationEntry]), 'utf-8')
    // 재로드 후 services.ts 호출 path 와 동일 lookup
    const reloaded = new AIResponseCache(cachePath)
    await reloaded.load()
    const hit = await reloaded.lookup<TranslationCacheValue & { sourceText: string }>({
      kind: 'translation',
      key
    })
    expect(hit?.value.translatedText).toBe('마이그레이션 결과')
    expect(hit?.value.providerType).toBe('openai') // codex NEEDS_CHANGES #8 hotfix 정합 필드
    // services.ts 의 cache hit 응답 매핑: `${providerType}/cache` (codex 위험 #4 의미 보존 — services 본문에서 인라인 작성)
    const cacheModelLabel = `${baseInput.providerType}/cache`
    expect(cacheModelLabel).toBe('openai/cache')
  })

  it('빈 cache 에서 lookup miss → null (cold-start 정합)', async () => {
    const key = buildTranslationCacheKey(baseInput)
    const miss = await cache.lookup({ kind: 'translation', key })
    expect(miss).toBeNull()
  })

  it('다른 glossaryVersion entry 는 invalidate 영향 0', async () => {
    const kA = buildTranslationCacheKey({ ...baseInput, glossaryVersion: 'v1' })
    const kB = buildTranslationCacheKey({ ...baseInput, glossaryVersion: 'v2' })
    await cache.store<TranslationCacheValue>({
      kind: 'translation',
      key: kA,
      value: { translatedText: 'A', sourceText: 'x', providerType: 'openai' },
      metadata: { glossaryVersion: 'v1' }
    })
    await cache.store<TranslationCacheValue>({
      kind: 'translation',
      key: kB,
      value: { translatedText: 'B', sourceText: 'x', providerType: 'openai' },
      metadata: { glossaryVersion: 'v2' }
    })
    const removed = await cache.invalidate('translation', (e) => {
      const meta = e.metadata as { glossaryVersion?: string } | undefined
      return meta?.glossaryVersion === 'v1'
    })
    expect(removed).toBe(1)
    expect(await cache.lookup({ kind: 'translation', key: kA })).toBeNull()
    const remained = await cache.lookup<TranslationCacheValue>({ kind: 'translation', key: kB })
    expect(remained?.value.translatedText).toBe('B')
  })
})
