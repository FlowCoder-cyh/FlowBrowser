/**
 * Translation Cache.
 * PRD §12.4: 복합 키 (sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion).
 * TTL 기본 90일 / 자막 365일. LRU 만료 (디스크 한도 1GB).
 *
 * JSON 영속 (SQLite 도입은 추후 데이터 규모에 따라).
 *
 * Sprint 016 M2 T11 — AIResponseCache 어댑터 모드 (backend 분기) 제거.
 *   본 클래스는 v0.3 JSON 영속 단일 path 만 유지. v0.4 selection 번역 흐름의
 *   캐싱은 T10 (executeTranslateRequest → ChatService.chat 마이그레이션) 시점에
 *   AIResponseCache (kind='translation') 가 직접 책임. 본 클래스 자체 폐기는 T10 후.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'

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
}

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const SUBTITLE_TTL_MS = 365 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

export class TranslationCache {
  private memory = new Map<string, CacheEntry>()
  private opts: Required<CacheOptions>
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
    return this.memory.size
  }

  stats(): { count: number; hitTotal: number } {
    let hitTotal = 0
    for (const e of this.memory.values()) hitTotal += e.hitCount
    return { count: this.memory.size, hitTotal }
  }

  /**
   * 테스트/디버그용 — writeQueue가 비어있는지 보장.
   */
  async flush(): Promise<void> {
    await this.writeQueue
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
