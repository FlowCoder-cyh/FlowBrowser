/**
 * Translation Cache.
 * PRD §12.4: 복합 키 (sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion).
 * TTL 기본 90일 / 자막 365일. LRU 만료 (디스크 한도 1GB).
 *
 * JSON 영속 (SQLite 도입은 추후 데이터 규모에 따라).
 *
 * Sprint 015 M2-1 — AIResponseCache 어댑터 모드 추가.
 *   - 생성자 `opts.backend` 미주입: 기존 v0.3 JSON 동작 100% 보존
 *   - 생성자 `opts.backend` 주입: 모든 read/write 를 AIResponseCache (kind='translation') 로 위임
 *     (services.ts 가 feature flag `flowbrowser.v04.enabled` 검사 후 backend 주입 — M2-2 이후)
 *   - 본 어댑터는 M5 종료 시 TranslationCache 자체와 함께 제거 (PRD §19.5.4)
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'

import { AIResponseCache, type AICacheEntry } from './AIResponseCache'

/**
 * Sprint 005 M1 — requestType 도입. 같은 sourceText로 다른 requestType
 * (선택 영역 번역 vs 자막 vs 페이지 등) 호출 시 별도 캐시 항목 보존.
 */
export type CacheRequestType =
  | 'selection'
  | 'paragraph'
  | 'page'
  | 'subtitle'
  | 'tts_script'
  | 'explanation'
  | 'summary'

export interface CacheKeyInput {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  providerType: string
  requestType: CacheRequestType
  glossaryVersion?: string
}

export interface CacheEntry {
  id: string
  sourceHash: string
  sourceText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  providerType: string
  requestType: CacheRequestType
  glossaryVersion: string
  domain: string | null
  hitCount: number
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  expiresAt: number
}

export interface CacheOptions {
  defaultTtlMs?: number
  subtitleTtlMs?: number
  maxBytes?: number
  /**
   * Sprint 015 M2-1 — 주입 시 모든 read/write 가 AIResponseCache (kind='translation') 로 위임.
   * 미주입 시 v0.3 JSON 파일 동작 100% 보존.
   */
  backend?: AIResponseCache
}

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const SUBTITLE_TTL_MS = 365 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

interface TranslationCacheValue {
  id: string
  sourceText: string
  translatedText: string
  domain: string | null
  createdAt: number
}

export class TranslationCache {
  private memory = new Map<string, CacheEntry>()
  private opts: Required<Omit<CacheOptions, 'backend'>>
  private backend: AIResponseCache | null
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    private filePath: string,
    opts: CacheOptions = {}
  ) {
    this.opts = {
      defaultTtlMs: opts.defaultTtlMs ?? DEFAULT_TTL_MS,
      subtitleTtlMs: opts.subtitleTtlMs ?? SUBTITLE_TTL_MS,
      maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES
    }
    this.backend = opts.backend ?? null
  }

  /**
   * Sprint 015 M2-1 — v0.4 어댑터 모드 활성 여부 (단위 테스트 / services.ts 진단용).
   */
  isAdapterMode(): boolean {
    return this.backend !== null
  }

  static buildKey(args: CacheKeyInput): { sourceHash: string; composite: string } {
    const sourceHash = createHash('sha256').update(args.sourceText).digest('hex')
    const composite = [
      sourceHash,
      args.sourceLanguage,
      args.targetLanguage,
      args.providerType,
      args.requestType,
      args.glossaryVersion ?? 'default'
    ].join('|')
    return { sourceHash, composite }
  }

  async load(): Promise<void> {
    if (this.backend) {
      // backend 모드: AIResponseCache 가 이미 load 됐다고 가정 (services.ts 책임).
      this.loaded = true
      return
    }
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Array<CacheEntry & { requestType?: CacheRequestType }>
      this.memory.clear()
      for (const raw of parsed) {
        // Sprint 005 M1: requestType이 없는 구 항목은 'selection'으로 fallback (자연 폐기 대상)
        const entry: CacheEntry = {
          ...raw,
          requestType: raw.requestType ?? 'selection'
        }
        const composite = this.compositeFromEntry(entry)
        this.memory.set(composite, entry)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.memory.clear()
      } else {
        throw err
      }
    }
    this.purgeExpiredSync()
    this.loaded = true
  }

  async lookup(key: CacheKeyInput): Promise<CacheEntry | null> {
    this.ensureLoaded()
    const { composite } = TranslationCache.buildKey(key)
    if (this.backend) {
      const found = await this.backend.lookup<TranslationCacheValue>({
        kind: 'translation',
        key: composite
      })
      if (!found) return null
      return this.toCacheEntry(key, found)
    }
    const entry = this.memory.get(composite)
    if (!entry) return null
    const now = Date.now()
    if (entry.expiresAt < now) {
      this.memory.delete(composite)
      await this.scheduleWrite()
      return null
    }
    entry.hitCount += 1
    entry.lastAccessedAt = now
    await this.scheduleWrite()
    return { ...entry }
  }

  async store(
    args: CacheKeyInput & {
      translatedText: string
      domain?: string | null
      isSubtitle?: boolean
    }
  ): Promise<CacheEntry> {
    this.ensureLoaded()
    const { sourceHash, composite } = TranslationCache.buildKey(args)
    const now = Date.now()
    const ttlMs = args.isSubtitle ? this.opts.subtitleTtlMs : this.opts.defaultTtlMs
    if (this.backend) {
      // M2-1 codex 권고: side-effect free peek 사용 (lookup 은 hitCount 증가 → store 가 cache hit 로 잘못 집계됨)
      const existingBackend = this.backend.peek<TranslationCacheValue>({
        kind: 'translation',
        key: composite
      })
      const value: TranslationCacheValue = existingBackend
        ? {
            id: existingBackend.value.id,
            sourceText: args.sourceText,
            translatedText: args.translatedText,
            domain: args.domain ?? existingBackend.value.domain,
            createdAt: existingBackend.value.createdAt
          }
        : {
            id: `tc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            sourceText: args.sourceText,
            translatedText: args.translatedText,
            domain: args.domain ?? null,
            createdAt: now
          }
      const stored = await this.backend.store<TranslationCacheValue>({
        kind: 'translation',
        key: composite,
        value,
        ttlMs,
        metadata: {
          sourceHash,
          sourceLanguage: args.sourceLanguage,
          targetLanguage: args.targetLanguage,
          providerType: args.providerType,
          requestType: args.requestType,
          glossaryVersion: args.glossaryVersion ?? 'default'
        }
      })
      return this.toCacheEntry(args, stored)
    }
    const existing = this.memory.get(composite)
    const entry: CacheEntry = existing
      ? {
          ...existing,
          translatedText: args.translatedText,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + ttlMs
        }
      : {
          id: `tc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          sourceHash,
          sourceText: args.sourceText,
          translatedText: args.translatedText,
          sourceLanguage: args.sourceLanguage,
          targetLanguage: args.targetLanguage,
          providerType: args.providerType,
          requestType: args.requestType,
          glossaryVersion: args.glossaryVersion ?? 'default',
          domain: args.domain ?? null,
          hitCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + ttlMs
        }
    this.memory.set(composite, entry)
    await this.scheduleWrite()
    return { ...entry }
  }

  async invalidateByGlossaryVersion(version: string): Promise<number> {
    this.ensureLoaded()
    if (this.backend) {
      return this.backend.invalidate('translation', (entry) => {
        const parts = entry.key.split('|')
        return parts.length >= 6 && parts[5] === version
      })
    }
    let removed = 0
    for (const [key, entry] of this.memory.entries()) {
      if (entry.glossaryVersion === version) {
        this.memory.delete(key)
        removed++
      }
    }
    if (removed > 0) await this.scheduleWrite()
    return removed
  }

  async clearAll(): Promise<void> {
    if (this.backend) {
      await this.backend.clearKind('translation')
      return
    }
    this.memory.clear()
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.unlink(this.filePath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    })
    await this.writeQueue
  }

  size(): number {
    if (this.backend) {
      return this.backend.sizeOf('translation')
    }
    return this.memory.size
  }

  stats(): { count: number; hitTotal: number } {
    if (this.backend) {
      const perKind = this.backend.stats().perKind.translation
      return { count: perKind.count, hitTotal: perKind.hitTotal }
    }
    let hitTotal = 0
    for (const e of this.memory.values()) hitTotal += e.hitCount
    return { count: this.memory.size, hitTotal }
  }

  /**
   * 테스트/디버그용 — writeQueue가 비어있는지 보장.
   */
  async flush(): Promise<void> {
    if (this.backend) {
      await this.backend.flush()
      return
    }
    await this.writeQueue
  }

  private toCacheEntry(
    input: CacheKeyInput,
    entry: AICacheEntry<TranslationCacheValue>
  ): CacheEntry {
    const { sourceHash } = TranslationCache.buildKey(input)
    return {
      id: entry.value.id,
      sourceHash,
      sourceText: entry.value.sourceText,
      translatedText: entry.value.translatedText,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      providerType: input.providerType,
      requestType: input.requestType,
      glossaryVersion: input.glossaryVersion ?? 'default',
      domain: entry.value.domain,
      hitCount: entry.hitCount,
      createdAt: entry.value.createdAt,
      updatedAt: entry.updatedAt,
      lastAccessedAt: entry.lastAccessedAt,
      expiresAt: entry.expiresAt
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('TranslationCache.load() not called')
    }
  }

  private compositeFromEntry(e: CacheEntry): string {
    return [
      e.sourceHash,
      e.sourceLanguage,
      e.targetLanguage,
      e.providerType,
      e.requestType,
      e.glossaryVersion
    ].join('|')
  }

  private purgeExpiredSync(): void {
    const now = Date.now()
    for (const [key, entry] of this.memory.entries()) {
      if (entry.expiresAt < now) {
        this.memory.delete(key)
      }
    }
  }

  private async scheduleWrite(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.persistOnce())
    await this.writeQueue
  }

  private async persistOnce(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const all = Array.from(this.memory.values())
    const serialized = JSON.stringify(all, null, 0)
    if (Buffer.byteLength(serialized) > this.opts.maxBytes) {
      // LRU 정렬 후 절반 제거
      all.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const half = all.slice(0, Math.floor(all.length / 2))
      this.memory.clear()
      for (const e of half) {
        this.memory.set(this.compositeFromEntry(e), e)
      }
      const trimmed = JSON.stringify(half, null, 0)
      await fs.writeFile(this.filePath, trimmed, 'utf-8')
      return
    }
    await fs.writeFile(this.filePath, serialized, 'utf-8')
  }
}

export function defaultTranslationCachePath(userDataDir: string): string {
  return join(userDataDir, 'translation-cache.json')
}
