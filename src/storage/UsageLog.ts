/**
 * UsageLog 저장소.
 * PRD §12.8 (v0.3) + §05 + §15 (v0.4 GENERALIZE).
 *
 * 외부 Provider 전송 사용량 + 외부 전송 감사 로그.
 * JSONL 파일에 누적. 90일 이후 자동 정리 (별도 작업).
 *
 * Sprint 015 M3-7 — GENERALIZE:
 *   - feature enum 확장: v0.3 (translation/summary/tts/stt/explanation) + v0.4 (chat/embed/tag/background_translation)
 *   - 신규 옵션 컬럼: workspaceId (워크스페이스별 비용 추적) / model (대시보드 분리) / durationMs (지연 추적)
 *   - 마이그레이션: migrateLegacyEntries() — v0.3 entries 에 workspaceId 부여 (디폴트 "📥 기본" UUID)
 *   - 폐기 결정: 기존 v0.3 feature 값은 보존 (감사 로그 보존성). v0.4 신규 호출은 v0.4 feature 사용.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import type { PrivacyDecision } from '../privacy/types'

/** v0.3 호환 feature — 감사 로그 보존성 위해 유지. */
export type V03Feature = 'translation' | 'summary' | 'tts' | 'stt' | 'explanation'

/** v0.4 신규 feature (Sprint 015 M3-7). */
export type V04Feature = 'chat' | 'embed' | 'tag' | 'background_translation'

export type Feature = V03Feature | V04Feature

export const V04_FEATURES: readonly V04Feature[] = [
  'chat',
  'embed',
  'tag',
  'background_translation'
] as const

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
  /**
   * v0.4 GENERALIZE — 워크스페이스별 비용 추적 (M3-7 추가).
   * v0.3 entry 는 마이그레이션 시 디폴트 워크스페이스 UUID 부여 (`migrateLegacyEntries`).
   */
  workspaceId?: string
  /**
   * v0.4 GENERALIZE — 모델명 (예: 'gpt-4o-mini', 'text-embedding-3-small'). 대시보드 분리.
   */
  model?: string
  /**
   * v0.4 GENERALIZE — 응답 지연 ms (provider 호출 → 응답 도착).
   */
  durationMs?: number
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
    byWorkspace: Record<string, { count: number; costUsd: number }>
    byModel: Record<string, { count: number; costUsd: number }>
  }> {
    const since = sinceMs ?? 0
    const entries = await this.readSince(since)
    const summary = {
      total: entries.length,
      successCount: 0,
      failedCount: 0,
      totalCostUsd: 0,
      byProvider: {} as Record<string, { count: number; costUsd: number }>,
      byFeature: {} as Record<Feature, { count: number; costUsd: number }>,
      byWorkspace: {} as Record<string, { count: number; costUsd: number }>,
      byModel: {} as Record<string, { count: number; costUsd: number }>
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

      // M3-7 v0.4 GENERALIZE — workspace + model 집계 (옵션 컬럼, 미주입 시 'unknown' bucket)
      const wsKey = e.workspaceId ?? 'unknown'
      summary.byWorkspace[wsKey] = summary.byWorkspace[wsKey] ?? { count: 0, costUsd: 0 }
      summary.byWorkspace[wsKey].count++
      summary.byWorkspace[wsKey].costUsd += e.estimatedCostUsd

      const modelKey = e.model ?? 'unknown'
      summary.byModel[modelKey] = summary.byModel[modelKey] ?? { count: 0, costUsd: 0 }
      summary.byModel[modelKey].count++
      summary.byModel[modelKey].costUsd += e.estimatedCostUsd
    }
    summary.totalCostUsd = Math.round(summary.totalCostUsd * 1_000_000) / 1_000_000
    return summary
  }

  /**
   * M3-7 — v0.3 entry → v0.4 schema 마이그레이션.
   *
   * 정책:
   *   - workspaceId 미주입 entry 에 defaultWorkspaceId 부여
   *   - feature 값은 보존 (감사 로그 보존성, 매핑 X)
   *   - model / durationMs 는 v0.3 정보 없음 — 미주입 (옵션 컬럼)
   *   - 동일 entry 두 번째 호출 시 idempotent (workspaceId 이미 있으면 no-op)
   *
   * 반환: 갱신된 entry 수.
   */
  async migrateLegacyEntries(defaultWorkspaceId: string): Promise<number> {
    const all = await this.readAll()
    let migrated = 0
    const next = all.map((e) => {
      if (e.workspaceId) return e
      migrated++
      return { ...e, workspaceId: defaultWorkspaceId }
    })
    if (migrated === 0) return 0
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const content = next.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await fs.writeFile(this.filePath, content, 'utf-8')
    return migrated
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
