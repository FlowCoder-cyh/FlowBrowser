/**
 * 외부 Provider 전송 로그.
 * PRD §10.3 (감사 가능) / §12.8 UsageLog.
 *
 * 본 로거는 메모리 누적 + 디스크 영속화(JSONL).
 * blocked 결정은 기록하지 않음 (PRD §12.8 privacyDecision = allowed / user_approved만).
 * 단, 차단 통계는 별도 카운터로 보관 (사용자에게 표시할 수 있도록).
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import type { TransmissionLogEntry } from './types'

export interface BlockedCounter {
  byDomain: Record<string, number>
  byReason: Record<string, number>
  total: number
}

export class TransmissionLogger {
  private memory: TransmissionLogEntry[] = []
  private blocked: BlockedCounter = { byDomain: {}, byReason: {}, total: 0 }
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private logFilePath: string) {}

  async append(entry: TransmissionLogEntry): Promise<void> {
    if (entry.decision === 'blocked') {
      this.recordBlock(entry)
      return
    }
    this.memory.push(entry)
    this.writeQueue = this.writeQueue.then(() => this.persistEntry(entry))
    await this.writeQueue
  }

  recordBlock(entry: TransmissionLogEntry): void {
    this.blocked.total += 1
    this.blocked.byDomain[entry.domain] = (this.blocked.byDomain[entry.domain] ?? 0) + 1
    const reason = entry.reason ?? 'unknown'
    this.blocked.byReason[reason] = (this.blocked.byReason[reason] ?? 0) + 1
  }

  getMemorySnapshot(): readonly TransmissionLogEntry[] {
    return this.memory.slice()
  }

  getBlockedStats(): BlockedCounter {
    return {
      byDomain: { ...this.blocked.byDomain },
      byReason: { ...this.blocked.byReason },
      total: this.blocked.total
    }
  }

  async loadFromDisk(): Promise<void> {
    try {
      const buf = await fs.readFile(this.logFilePath, 'utf-8')
      const lines = buf.split(/\r?\n/).filter((l) => l.trim().length > 0)
      this.memory = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TransmissionLogEntry
          } catch {
            return null
          }
        })
        .filter((e): e is TransmissionLogEntry => e !== null)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.memory = []
        return
      }
      throw err
    }
  }

  async clearAll(): Promise<void> {
    this.memory = []
    this.blocked = { byDomain: {}, byReason: {}, total: 0 }
    try {
      await fs.unlink(this.logFilePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
    }
  }

  private async persistEntry(entry: TransmissionLogEntry): Promise<void> {
    await fs.mkdir(dirname(this.logFilePath), { recursive: true })
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(this.logFilePath, line, 'utf-8')
  }
}

export function defaultLogFilePath(userDataDir: string): string {
  return join(userDataDir, 'transmission-log.jsonl')
}
