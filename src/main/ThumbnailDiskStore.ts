/**
 * Sprint 013 M2 — ThumbnailStore 디스크 영속.
 * thumbnails.json (policyVersion=1).
 * 손상/누락 시 빈 배열 fallback (안전).
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ThumbnailEntry } from './ThumbnailStore'

export interface PersistedThumbnailItem {
  tabId: string
  entry: ThumbnailEntry
}

interface PersistedThumbnailFile {
  policyVersion: number
  items: PersistedThumbnailItem[]
}

export const THUMBNAIL_POLICY_VERSION = 1

export class ThumbnailDiskStore {
  constructor(private filePath: string) {}

  async load(): Promise<PersistedThumbnailItem[]> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<PersistedThumbnailFile>
      if (parsed.policyVersion !== THUMBNAIL_POLICY_VERSION) return []
      if (!Array.isArray(parsed.items)) return []
      const out: PersistedThumbnailItem[] = []
      for (const item of parsed.items as unknown[]) {
        if (typeof item !== 'object' || item === null) continue
        const obj = item as Record<string, unknown>
        if (typeof obj.tabId !== 'string') continue
        const entry = obj.entry
        if (typeof entry !== 'object' || entry === null) continue
        const e = entry as Record<string, unknown>
        if (
          typeof e.dataUrl !== 'string' ||
          typeof e.capturedAt !== 'number' ||
          typeof e.width !== 'number' ||
          typeof e.height !== 'number'
        ) {
          continue
        }
        out.push({
          tabId: obj.tabId,
          entry: {
            dataUrl: e.dataUrl,
            capturedAt: e.capturedAt,
            width: e.width,
            height: e.height
          }
        })
      }
      return out
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      // 손상 JSON / 기타 IO → 빈 배열 (안전 fallback)
      return []
    }
  }

  async save(items: PersistedThumbnailItem[]): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload: PersistedThumbnailFile = {
      policyVersion: THUMBNAIL_POLICY_VERSION,
      items
    }
    await fs.writeFile(this.filePath, JSON.stringify(payload), 'utf-8')
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}

export function defaultThumbnailsPath(userDataDir: string): string {
  return join(userDataDir, 'thumbnails.json')
}
