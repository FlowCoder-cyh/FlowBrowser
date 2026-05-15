/**
 * Sprint 006 M3 — PageResultStore.
 * 페이지 단위 번역 결과 영속 + 재방문 복원.
 *
 * 키 = sha256(정규화된 URL + targetLanguage + providerType + glossaryVersion)
 * 값 = { url, instructions[], nodesSignature, timestamps }
 *
 * TTL 30일, 디스크 한도 500MB (초과 시 LRU 절반 trim).
 * 정규화: 쿼리/프래그먼트 제외 (오직 origin + pathname).
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PageResultInstruction {
  id: string
  translatedText: string
}

export interface PageResultEntry {
  id: string
  key: string
  url: string
  targetLanguage: string
  providerType: string
  glossaryVersion: string
  nodesSignature: string
  selectorPreset: 'paragraph' | 'page'
  instructions: PageResultInstruction[]
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  expiresAt: number
}

export interface PageResultLookupKey {
  url: string
  targetLanguage: string
  providerType: string
  glossaryVersion?: string
}

export interface PageResultStoreOptions {
  ttlMs?: number
  maxBytes?: number
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024

/**
 * URL을 origin + pathname만 남기는 정규화. 쿼리/프래그먼트는 제외.
 * 파싱 실패 시 원본 trim 반환.
 */
export function normalizePageUrl(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    return raw.trim()
  }
}

/**
 * 노드 ID + 원문 텍스트 해시. 페이지 변경 감지용.
 */
export function nodesSignatureFromTexts(nodes: Array<{ id: string; text: string }>): string {
  const joined = nodes.map((n) => `${n.id}|${n.text}`).join('\n')
  return createHash('sha256').update(joined).digest('hex').slice(0, 32)
}

function buildKey(args: PageResultLookupKey): string {
  const normalized = normalizePageUrl(args.url)
  const payload = [
    normalized,
    args.targetLanguage,
    args.providerType,
    args.glossaryVersion ?? 'default'
  ].join('|')
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export class PageResultStore {
  private memory = new Map<string, PageResultEntry>()
  private opts: Required<PageResultStoreOptions>
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(private filePath: string, opts: PageResultStoreOptions = {}) {
    this.opts = {
      ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
      maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES
    }
  }

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as PageResultEntry[]
      this.memory.clear()
      for (const entry of parsed) {
        if (!entry?.key) continue
        this.memory.set(entry.key, entry)
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

  async lookup(
    args: PageResultLookupKey & { nodesSignature?: string }
  ): Promise<PageResultEntry | null> {
    this.ensureLoaded()
    const key = buildKey(args)
    const entry = this.memory.get(key)
    if (!entry) return null
    const now = Date.now()
    if (entry.expiresAt < now) {
      this.memory.delete(key)
      await this.scheduleWrite()
      return null
    }
    // 페이지 변경 감지 — 노드 시그니처 불일치면 복원 불가
    if (args.nodesSignature && args.nodesSignature !== entry.nodesSignature) {
      return null
    }
    entry.lastAccessedAt = now
    await this.scheduleWrite()
    return { ...entry, instructions: [...entry.instructions] }
  }

  async store(args: {
    url: string
    targetLanguage: string
    providerType: string
    glossaryVersion?: string
    nodesSignature: string
    selectorPreset: 'paragraph' | 'page'
    instructions: PageResultInstruction[]
  }): Promise<PageResultEntry> {
    this.ensureLoaded()
    const key = buildKey(args)
    const now = Date.now()
    const existing = this.memory.get(key)
    const entry: PageResultEntry = existing
      ? {
          ...existing,
          nodesSignature: args.nodesSignature,
          selectorPreset: args.selectorPreset,
          instructions: [...args.instructions],
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + this.opts.ttlMs
        }
      : {
          id: `pr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          key,
          url: normalizePageUrl(args.url),
          targetLanguage: args.targetLanguage,
          providerType: args.providerType,
          glossaryVersion: args.glossaryVersion ?? 'default',
          nodesSignature: args.nodesSignature,
          selectorPreset: args.selectorPreset,
          instructions: [...args.instructions],
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          expiresAt: now + this.opts.ttlMs
        }
    this.memory.set(key, entry)
    await this.scheduleWrite()
    return entry
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

  stats(): { count: number } {
    return { count: this.memory.size }
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('PageResultStore.load() not called')
    }
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
      all.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const half = all.slice(0, Math.floor(all.length / 2))
      this.memory.clear()
      for (const e of half) this.memory.set(e.key, e)
      await fs.writeFile(this.filePath, JSON.stringify(half, null, 0), 'utf-8')
      return
    }
    await fs.writeFile(this.filePath, serialized, 'utf-8')
  }
}

export function defaultPageResultPath(userDataDir: string): string {
  return join(userDataDir, 'page-results.json')
}
