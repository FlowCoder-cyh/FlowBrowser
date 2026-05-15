/**
 * Sprint 003 M1 / S003-T01 — TranslationCache LRU trim 직접 측정.
 * Sprint 002 evaluator §3 후속 1 해소: maxBytes 초과 시 절반 trim + 최근 사용 항목 우선 보존.
 *
 * persistOnce는 private이지만 store/lookup 흐름에서 자동 호출되므로, store를 반복 호출하면
 * maxBytes 임계 초과 시 trim 분기를 실행한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TranslationCache } from '../../../src/storage/TranslationCache'

const ITEM_COUNT = 12
const SOURCE_LEN = 120

function buildEntryArgs(idx: number) {
  return {
    sourceText: `${'L'.repeat(SOURCE_LEN)}-src-${idx}`,
    translatedText: `${'T'.repeat(SOURCE_LEN)}-dst-${idx}`,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    providerType: 'openai',
    domain: 'example.com',
    isSubtitle: false
  } as const
}

describe('TranslationCache — LRU trim (Sprint 003 M1 / AC-1)', () => {
  let cachePath: string

  beforeEach(() => {
    cachePath = join(
      tmpdir(),
      `tc-lru-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
  })

  afterEach(async () => {
    try {
      await fs.unlink(cachePath)
    } catch {
      // ignore
    }
  })

  it('persistOnce trims to ~half when serialized size exceeds maxBytes', async () => {
    // 각 항목 직렬화 크기는 sourceText/translatedText 합쳐 ≈ 350~450 bytes.
    // maxBytes 800 → 2~3 항목만 들어가도 임계 초과 → trim.
    const cache = new TranslationCache(cachePath, { maxBytes: 800 })
    await cache.load()

    for (let i = 0; i < ITEM_COUNT; i++) {
      await cache.store(buildEntryArgs(i))
    }

    const sizeAfter = cache.size()
    // 절반 trim 후 새 항목이 추가될 때마다 다시 임계 도달 → 반복. 최종 크기는
    // 누적 12개의 절반 = 6 이하로 안정. 보수적으로 ≤ ITEM_COUNT/2 검증.
    expect(sizeAfter).toBeGreaterThan(0)
    expect(sizeAfter).toBeLessThanOrEqual(Math.floor(ITEM_COUNT / 2))

    // 디스크 영속이 실제로 trim된 결과만 직렬화하는지 확인.
    await cache.flush()
    const persisted = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as unknown[]
    expect(persisted.length).toBe(sizeAfter)
    expect(Buffer.byteLength(JSON.stringify(persisted, null, 0))).toBeLessThanOrEqual(800)
  })

  it('keeps most-recently-accessed entries after trim', async () => {
    // 직렬화 측정: 항목당 ≈ 637 bytes, 6개 ≈ 3829 bytes, 8개 ≈ 5105 bytes.
    // maxBytes=4500 → 6,7개는 trim 없음, 8개째 store에서 trim 발생 → 절반(4개)만 보존.
    const cache = new TranslationCache(cachePath, { maxBytes: 4500 })
    await cache.load()

    // 6개 적재 (trim 안 일어남)
    for (let i = 0; i < 6; i++) {
      await cache.store(buildEntryArgs(i))
    }
    expect(cache.size()).toBe(6)

    // idx=0 항목을 lookup → lastAccessedAt 최신화 (가장 오래된 → 더 새로움)
    const oldestKey = {
      sourceText: buildEntryArgs(0).sourceText,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      providerType: 'openai'
    }
    await new Promise((r) => setTimeout(r, 5))
    const refreshed = await cache.lookup(oldestKey)
    expect(refreshed).not.toBeNull()

    // idx=6, 7 store → 7개는 OK, 8개째에서 trim 트리거
    await new Promise((r) => setTimeout(r, 5))
    await cache.store(buildEntryArgs(6))
    await cache.store(buildEntryArgs(7))

    // trim 후 갱신한 idx=0가 상위 절반에 포함되어 살아남는지 확인.
    // 정렬 (lastAccessedAt 내림): idx=7, 6, 0, 5, 4, 3, 2, 1 → 상위 4개 = idx=7, 6, 0, 5.
    expect(cache.size()).toBeLessThanOrEqual(4)
    const survivor = await cache.lookup(oldestKey)
    expect(survivor).not.toBeNull()
    expect(survivor?.sourceText).toBe(buildEntryArgs(0).sourceText)
  })

  it('trim only occurs when size exceeds maxBytes', async () => {
    // 매우 큰 maxBytes → trim 발생 안 함 → 모든 항목 보존
    const cache = new TranslationCache(cachePath, { maxBytes: 1024 * 1024 })
    await cache.load()
    for (let i = 0; i < ITEM_COUNT; i++) {
      await cache.store(buildEntryArgs(i))
    }
    expect(cache.size()).toBe(ITEM_COUNT)
  })
})
