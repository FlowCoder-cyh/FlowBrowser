/**
 * Sprint 015 M2-1 — AIResponseCache.
 * PRD §06.4 / §19.5.1 / v04-direction §17 S3 — TranslationCache 일반화.
 *
 * 4-kind 단일 cache layer:
 *   - translation: 번역 결과 (sourceHash + 4-tuple, TTL 90d / subtitle 365d)
 *   - embedding:   임베딩 벡터 캐시 (queryHash, TTL 30d)
 *   - ai_response: AI 채팅 응답 캐시 (promptHash + model, TTL 30d)
 *   - tag:         자동 태그 결과 캐시 (contentHash, TTL 365d)
 *
 * 본 M2-1 단계는 단독 JSON 영속 (ai-response-cache.json).
 * M3 통합 DB 진입 시 schema/v04.sql 의 cache 테이블로 흡수.
 *
 * Sprint 016 M2 T11 — TranslationCache 어댑터 모드 제거 후 본 모듈은 단독 cache layer.
 *   v0.4 selection 번역 chat 마이그레이션 (T10) 시점에 chat / embedding / tag 모두 본 모듈로 통합 예정.
 *
 * LRU 정책 주의 (M2-1 시점):
 *   - `maxBytes` 임계는 **전체 kind 공유** (kind 별 격리 X). embedding 대량 쓰기가 translation/tag 를 함께 밀어낼 수 있음.
 *   - kind 별 quota 는 Sprint 016+ M3 임베딩 도입 시 재평가 (PRD §15 비용/저장 임계 측정 후 결정).
 *
 * Side-effect free lookup (M2-1 codex 권고):
 *   - `peek(kind, key)` — hitCount / lastAccessedAt 증가 없이 entry 조회. upsert 경로 (chat / embedding 캐시) 에서 사용.
 *   - `lookup(kind, key)` — hitCount += 1 + lastAccessedAt 갱신. 진짜 cache hit 경로에서만 사용.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export type AICacheKind = 'translation' | 'embedding' | 'ai_response' | 'tag'

const DAY_MS = 24 * 60 * 60 * 1000

export const AI_CACHE_TTL_DEFAULTS: Record<AICacheKind, number> = {
  translation: 90 * DAY_MS,
  embedding: 30 * DAY_MS,
  ai_response: 30 * DAY_MS,
  tag: 365 * DAY_MS
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

export interface AICacheEntry<TValue = unknown> {
  id: string
  kind: AICacheKind
  key: string
  value: TValue
  hitCount: number
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  expiresAt: number
  metadata?: Record<string, unknown>
}

export interface AICacheStoreInput<TValue = unknown> {
  kind: AICacheKind
  key: string
  value: TValue
  ttlMs?: number
  metadata?: Record<string, unknown>
}

export interface AICacheLookupInput {
  kind: AICacheKind
  key: string
}

export interface AICacheOptions {
  ttlDefaults?: Partial<Record<AICacheKind, number>>
  maxBytes?: number
}

export interface AICacheStats {
  count: number
  hitTotal: number
  perKind: Record<AICacheKind, { count: number; hitTotal: number }>
}

function emptyPerKind(): Record<AICacheKind, { count: number; hitTotal: number }> {
  return {
    translation: { count: 0, hitTotal: 0 },
    embedding: { count: 0, hitTotal: 0 },
    ai_response: { count: 0, hitTotal: 0 },
    tag: { count: 0, hitTotal: 0 }
  }
}

function isAICacheKind(v: unknown): v is AICacheKind {
  return v === 'translation' || v === 'embedding' || v === 'ai_response' || v === 'tag'
}

function compositeKey(kind: AICacheKind, key: string): string {
  return `${kind}|${key}`
}

export class AIResponseCache {
  private memory = new Map<string, AICacheEntry>()
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false
  private ttlDefaults: Record<AICacheKind, number>
  private maxBytes: number

  constructor(
    private filePath: string,
    opts: AICacheOptions = {}
  ) {
    this.ttlDefaults = {
      ...AI_CACHE_TTL_DEFAULTS,
      ...(opts.ttlDefaults ?? {})
    }
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  }

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Array<unknown>
      this.memory.clear()
      for (const raw of parsed) {
        const entry = this.parseEntry(raw)
        if (!entry) continue
        this.memory.set(compositeKey(entry.kind, entry.key), entry)
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

  async lookup<TValue = unknown>(args: AICacheLookupInput): Promise<AICacheEntry<TValue> | null> {
    this.ensureLoaded()
    const composite = compositeKey(args.kind, args.key)
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
    return { ...(entry as AICacheEntry<TValue>) }
  }

  /**
   * Side-effect free 조회 (M2-1 codex 권고).
   * hitCount / lastAccessedAt 증가 없이 entry 반환. expired entry 도 그대로 노출 (호출자가 검사).
   * 용도: upsert 경로 (chat / embedding / tag store) 에서 기존 createdAt/id 보존용 조회.
   */
  peek<TValue = unknown>(args: AICacheLookupInput): AICacheEntry<TValue> | null {
    this.ensureLoaded()
    const composite = compositeKey(args.kind, args.key)
    const entry = this.memory.get(composite)
    if (!entry) return null
    return { ...(entry as AICacheEntry<TValue>) }
  }

  async store<TValue = unknown>(
    args: AICacheStoreInput<TValue>
  ): Promise<AICacheEntry<TValue>> {
    this.ensureLoaded()
    const composite = compositeKey(args.kind, args.key)
    const now = Date.now()
    const ttlMs = args.ttlMs ?? this.ttlDefaults[args.kind]
    const existing = this.memory.get(composite)
    const entry: AICacheEntry<TValue> = existing
      ? {
          ...(existing as AICacheEntry<TValue>),
          value: args.value,
          metadata: args.metadata ?? existing.metadata,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + ttlMs
        }
      : {
          id: `aic_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          kind: args.kind,
          key: args.key,
          value: args.value,
          metadata: args.metadata,
          hitCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + ttlMs
        }
    this.memory.set(composite, entry as AICacheEntry)
    await this.scheduleWrite()
    return { ...entry }
  }

  async invalidate(kind: AICacheKind, predicate: (entry: AICacheEntry) => boolean): Promise<number> {
    this.ensureLoaded()
    let removed = 0
    for (const [composite, entry] of this.memory.entries()) {
      if (entry.kind !== kind) continue
      if (predicate(entry)) {
        this.memory.delete(composite)
        removed++
      }
    }
    if (removed > 0) await this.scheduleWrite()
    return removed
  }

  async clearKind(kind: AICacheKind): Promise<number> {
    this.ensureLoaded()
    let removed = 0
    for (const [composite, entry] of this.memory.entries()) {
      if (entry.kind === kind) {
        this.memory.delete(composite)
        removed++
      }
    }
    if (removed > 0) await this.scheduleWrite()
    return removed
  }

  async clearAll(): Promise<void> {
    this.ensureLoaded()
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

  sizeOf(kind: AICacheKind): number {
    let n = 0
    for (const entry of this.memory.values()) {
      if (entry.kind === kind) n++
    }
    return n
  }

  stats(): AICacheStats {
    const perKind = emptyPerKind()
    let hitTotal = 0
    for (const entry of this.memory.values()) {
      hitTotal += entry.hitCount
      perKind[entry.kind].count += 1
      perKind[entry.kind].hitTotal += entry.hitCount
    }
    return { count: this.memory.size, hitTotal, perKind }
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('AIResponseCache.load() not called')
    }
  }

  private parseEntry(raw: unknown): AICacheEntry | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (!isAICacheKind(obj.kind)) return null
    if (typeof obj.key !== 'string' || obj.key.length === 0) return null
    if (typeof obj.id !== 'string' || obj.id.length === 0) return null
    // M2-1 codex 권고: 숫자 invariant — finite + non-negative + 시간 순서 (createdAt ≤ updatedAt / lastAccessedAt, expiresAt > createdAt)
    const hitCount = obj.hitCount
    if (
      typeof hitCount !== 'number' ||
      !Number.isFinite(hitCount) ||
      hitCount < 0 ||
      !Number.isInteger(hitCount)
    ) {
      return null
    }
    const createdAt = this.parseTimestamp(obj.createdAt)
    const updatedAt = this.parseTimestamp(obj.updatedAt)
    const lastAccessedAt = this.parseTimestamp(obj.lastAccessedAt)
    const expiresAt = this.parseTimestamp(obj.expiresAt)
    if (createdAt === null || updatedAt === null || lastAccessedAt === null || expiresAt === null) {
      return null
    }
    if (updatedAt < createdAt) return null
    if (lastAccessedAt < createdAt) return null
    if (expiresAt <= createdAt) return null
    const entry: AICacheEntry = {
      id: obj.id,
      kind: obj.kind,
      key: obj.key,
      value: obj.value,
      hitCount,
      createdAt,
      updatedAt,
      lastAccessedAt,
      expiresAt
    }
    if (obj.metadata && typeof obj.metadata === 'object') {
      entry.metadata = obj.metadata as Record<string, unknown>
    }
    return entry
  }

  private parseTimestamp(v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
    return v
  }

  private purgeExpiredSync(): void {
    const now = Date.now()
    for (const [composite, entry] of this.memory.entries()) {
      if (entry.expiresAt < now) {
        this.memory.delete(composite)
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
    if (Buffer.byteLength(serialized) > this.maxBytes) {
      all.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const half = all.slice(0, Math.floor(all.length / 2))
      this.memory.clear()
      for (const entry of half) {
        this.memory.set(compositeKey(entry.kind, entry.key), entry)
      }
      const trimmed = JSON.stringify(half, null, 0)
      await fs.writeFile(this.filePath, trimmed, 'utf-8')
      return
    }
    await fs.writeFile(this.filePath, serialized, 'utf-8')
  }
}

export function defaultAIResponseCachePath(userDataDir: string): string {
  return join(userDataDir, 'ai-response-cache.json')
}
