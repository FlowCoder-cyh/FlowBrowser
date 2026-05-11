/**
 * UsageLog 저장소.
 * PRD §12.8.
 *
 * 외부 Provider 전송 사용량 + 외부 전송 감사 로그.
 * JSONL 파일에 누적. 90일 이후 자동 정리 (별도 작업).
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import type { PrivacyDecision } from '../privacy/types'

export type Feature = 'translation' | 'summary' | 'tts' | 'stt' | 'explanation'
export type UsageStatus = 'success' | 'failed'

export interface UsageLogEntry {
  id: string
  providerId: string
  feature: Feature
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  domain: string
  privacyDecision: 'allowed' | 'user_approved' // blocked는 TransmissionLogger 카운터에만
  status: UsageStatus
  errorCode?: string
  createdAt: number
}

export class UsageLog {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private filePath: string) {}

  async append(entry: Omit<UsageLogEntry, 'id' | 'createdAt'>): Promise<UsageLogEntry> {
    const full: UsageLogEntry = {
      ...entry,
      id: `use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now()
    }
    this.writeQueue = this.writeQueue.then(() => this.persist(full))
    await this.writeQueue
    return full
  }

  async readAll(): Promise<UsageLogEntry[]> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      return buf
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as UsageLogEntry
          } catch {
            return null
          }
        })
        .filter((e): e is UsageLogEntry => e !== null)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  async readSince(sinceMs: number): Promise<UsageLogEntry[]> {
    const all = await this.readAll()
    return all.filter((e) => e.createdAt >= sinceMs)
  }

  async summarize(sinceMs?: number): Promise<{
    total: number
    successCount: number
    failedCount: number
    totalCostUsd: number
    byProvider: Record<string, { count: number; costUsd: number }>
    byFeature: Record<Feature, { count: number; costUsd: number }>
  }> {
    const since = sinceMs ?? 0
    const entries = await this.readSince(since)
    const summary = {
      total: entries.length,
      successCount: 0,
      failedCount: 0,
      totalCostUsd: 0,
      byProvider: {} as Record<string, { count: number; costUsd: number }>,
      byFeature: {} as Record<Feature, { count: number; costUsd: number }>
    }
    for (const e of entries) {
      if (e.status === 'success') summary.successCount++
      else summary.failedCount++
      summary.totalCostUsd += e.estimatedCostUsd

      summary.byProvider[e.providerId] = summary.byProvider[e.providerId] ?? { count: 0, costUsd: 0 }
      summary.byProvider[e.providerId].count++
      summary.byProvider[e.providerId].costUsd += e.estimatedCostUsd

      summary.byFeature[e.feature] = summary.byFeature[e.feature] ?? { count: 0, costUsd: 0 }
      summary.byFeature[e.feature].count++
      summary.byFeature[e.feature].costUsd += e.estimatedCostUsd
    }
    summary.totalCostUsd = Math.round(summary.totalCostUsd * 1_000_000) / 1_000_000
    return summary
  }

  async clearAll(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.unlink(this.filePath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    })
    await this.writeQueue
  }

  async purgeOlderThan(beforeMs: number): Promise<number> {
    const all = await this.readAll()
    const kept = all.filter((e) => e.createdAt >= beforeMs)
    const removed = all.length - kept.length
    if (removed === 0) return 0
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const content = kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : '')
    await fs.writeFile(this.filePath, content, 'utf-8')
    return removed
  }

  private async persist(entry: UsageLogEntry): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    await fs.appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }
}

export function defaultUsageLogPath(userDataDir: string): string {
  return join(userDataDir, 'usage-log.jsonl')
}

export type { PrivacyDecision }
