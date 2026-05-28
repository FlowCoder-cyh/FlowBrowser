/**
 * Sprint 015 M3-4 — EmbeddingQueue (SQLite 백그라운드 임베딩 작업 큐).
 *
 * PRD §15 백그라운드 큐 (활성 탭 우선, 동일 priority FIFO).
 *
 * 상태: 'pending' → 'in_progress' → 'succeeded' / 'failed'
 * 재시도: M3-5 EmbeddingClient 가 markFailed 후 재 enqueue (exponential backoff 5s/30s/5m/30m/포기)
 *
 * 후속 PR 의존:
 *   - M3-5 EmbeddingClient — claimNext (priority FIFO) → 임베딩 호출 → markSuccess/markFailed
 *   - M4 IndexingService — 페이지 인덱싱 시 enqueue
 *   - M3-6 migrations — Glossary → Note 변환 후 임베딩 일괄 enqueue
 *
 * 동시성:
 *   - SQLite는 단일 writer. better-sqlite3 sync. 동시 claim 충돌은 발생 불가.
 *   - 향후 worker thread 도입 시 claimNext 가 UPDATE...WHERE status='pending' (atomic) 보장.
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

export type EmbeddingTargetType = 'page' | 'note'
export type EmbeddingJobStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed'

export interface EmbeddingJobRow {
  id: string
  target_type: EmbeddingTargetType
  target_id: string
  workspace_id: string
  priority: number
  status: EmbeddingJobStatus
  attempts: number
  last_error: string | null
  created_at: number
  updated_at: number
}

export interface EnqueueInput {
  target_type: EmbeddingTargetType
  target_id: string
  workspace_id: string
  priority?: number // 디폴트 0. 활성 탭 우선 시 +10 등.
  id?: string
}

export interface QueueStats {
  pending: number
  in_progress: number
  succeeded: number
  failed: number
}

export class EmbeddingQueue {
  private readonly db: BetterSqliteNamespace.Database
  private readonly stmtInsert: Stmt
  private readonly stmtFindById: Stmt<EmbeddingJobRow>
  private readonly stmtClaimNext: Stmt<EmbeddingJobRow>
  private readonly stmtUpdateStatus: Stmt
  private readonly stmtMarkFailed: Stmt
  /** Sprint 018 M2 write-path wiring — provider 미가용 시 단건 in_progress → pending 복귀 (attempts 불변). */
  private readonly stmtRelease: Stmt
  /** Sprint 018 M2 write-path wiring — boot 시 orphan in_progress (직전 종료/크래시) 일괄 pending 복귀 (attempts 불변). */
  private readonly stmtRequeueInProgress: Stmt
  private readonly stmtCountByStatus: Stmt<{ status: EmbeddingJobStatus; c: number }>
  private readonly stmtDeleteSucceeded: Stmt
  private readonly stmtCancel: Stmt
  /** Sprint 016 M0 T02-followup (KI-006) — workspace 전환 시 pending 잡 일괄 제거. */
  private readonly stmtClearWorkspacePending: Stmt
  private readonly claimTxn: () => EmbeddingJobRow | null

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    this.stmtInsert = this.db.prepare(
      `INSERT INTO embedding_queue(id, target_type, target_id, workspace_id, priority, status, attempts, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`
    )
    this.stmtFindById = this.db.prepare(
      `SELECT id, target_type, target_id, workspace_id, priority, status, attempts, last_error, created_at, updated_at
       FROM embedding_queue WHERE id = ?`
    )
    // priority DESC + created_at ASC (FIFO 내 우선순위)
    this.stmtClaimNext = this.db.prepare(
      `SELECT id, target_type, target_id, workspace_id, priority, status, attempts, last_error, created_at, updated_at
       FROM embedding_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`
    )
    this.stmtUpdateStatus = this.db.prepare(
      `UPDATE embedding_queue SET status = ?, updated_at = ? WHERE id = ?`
    )
    this.stmtMarkFailed = this.db.prepare(
      `UPDATE embedding_queue
       SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ?`
    )
    this.stmtCountByStatus = this.db.prepare(
      `SELECT status, COUNT(*) AS c FROM embedding_queue GROUP BY status`
    )
    this.stmtDeleteSucceeded = this.db.prepare(
      `DELETE FROM embedding_queue WHERE status = 'succeeded'`
    )
    this.stmtCancel = this.db.prepare(
      `DELETE FROM embedding_queue WHERE id = ? AND status IN ('pending', 'failed')`
    )
    this.stmtClearWorkspacePending = this.db.prepare(
      `DELETE FROM embedding_queue WHERE workspace_id = ? AND status = 'pending'`
    )
    // status 가드 (id + in_progress) — 이미 succeeded/failed 로 전이된 잡을 되돌리지 않음 (codex 019e6ea0 C2).
    this.stmtRelease = this.db.prepare(
      `UPDATE embedding_queue SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'in_progress'`
    )
    this.stmtRequeueInProgress = this.db.prepare(
      `UPDATE embedding_queue SET status = 'pending', updated_at = ? WHERE status = 'in_progress'`
    )
    // 단일 TX — race condition 방지 (UPDATE WHERE status='pending' 동시 claim 안전)
    this.claimTxn = this.db.transaction((): EmbeddingJobRow | null => {
      const next = this.stmtClaimNext.get()
      if (!next) return null
      const now = Date.now()
      this.stmtUpdateStatus.run('in_progress', now, next.id)
      return { ...next, status: 'in_progress', updated_at: now }
    })
  }

  enqueue(input: EnqueueInput): EmbeddingJobRow {
    const now = Date.now()
    const row: EmbeddingJobRow = {
      id: input.id ?? randomUUID(),
      target_type: input.target_type,
      target_id: input.target_id,
      workspace_id: input.workspace_id,
      priority: input.priority ?? 0,
      status: 'pending',
      attempts: 0,
      last_error: null,
      created_at: now,
      updated_at: now
    }
    this.stmtInsert.run(
      row.id,
      row.target_type,
      row.target_id,
      row.workspace_id,
      row.priority,
      now,
      now
    )
    return row
  }

  /**
   * priority DESC + created_at ASC 순으로 1건 pending → in_progress 전환 후 반환.
   * 큐가 비어있으면 null. 단일 TX (race-safe).
   */
  claimNext(): EmbeddingJobRow | null {
    return this.claimTxn()
  }

  findById(id: string): EmbeddingJobRow | null {
    return this.stmtFindById.get(id) ?? null
  }

  markSucceeded(id: string): void {
    this.stmtUpdateStatus.run('succeeded', Date.now(), id)
  }

  /**
   * Sprint 018 M2 write-path wiring — claim 한 잡을 다시 pending 으로 되돌림 (attempts 불변).
   *
   * provider 미가용(API key 미설정 / Ollama 미실행 / rate limit 등 환경 문제)으로 잡을 처리할 수 없을 때
   * markFailed(영구 실패) 대신 사용 — 사용자가 환경을 고치면 다음 drain 에서 자동 회복 (codex 019e6ea0 Q3).
   * 데이터/계약 오류(미지원 모델 / orphan target / dimension mismatch)는 markFailed 가 맞음.
   *
   * @returns in_progress 였던 잡을 pending 으로 되돌렸으면 true. 이미 succeeded/failed 면 false (no-op).
   */
  release(id: string): boolean {
    return this.stmtRelease.run(Date.now(), id).changes > 0
  }

  /**
   * Sprint 018 M2 write-path wiring — boot 시 orphan in_progress 잡 일괄 회복.
   *
   * 앱이 embed 진행 중(in_progress) 종료/크래시되면 그 잡은 claimNext(pending 만 집음) 가 다시 안 집어
   * 영구 stuck 된다. worker.start() 직전 1회 호출해 pending 으로 되돌린다 (attempts 불변 — 정상 재시도).
   *
   * @returns 회복된 row 수
   */
  requeueInProgress(): number {
    return this.stmtRequeueInProgress.run(Date.now()).changes
  }

  /**
   * 실패 처리 + attempts +1. last_error 영속. status → 'failed'.
   * 호출자가 재시도 정책 결정 (재 enqueue 또는 영구 포기).
   */
  markFailed(id: string, error: string): void {
    this.stmtMarkFailed.run('failed', error, Date.now(), id)
  }

  stats(): QueueStats {
    const stats: QueueStats = { pending: 0, in_progress: 0, succeeded: 0, failed: 0 }
    for (const r of this.stmtCountByStatus.all()) {
      stats[r.status] = r.c
    }
    return stats
  }

  /** 완료된 잡 일괄 제거 (큐 정리). */
  purgeSucceeded(): number {
    return this.stmtDeleteSucceeded.run().changes
  }

  /** pending / failed 잡 취소 (in_progress / succeeded 는 보존). */
  cancel(id: string): boolean {
    return this.stmtCancel.run(id).changes > 0
  }

  /**
   * Sprint 016 M0 T02-followup (KI-006) — 워크스페이스 전환 시 prev workspace 의 pending 잡 일괄 제거.
   *
   * PRD §11.8 정합 — 전환 시 진행 중 임베딩 요청은 새 ws 에 누설되면 안 됨. pending 만 제거 (in_progress
   * 는 worker 가 markSucceeded/markFailed 후 자연 종료, succeeded/failed 는 영속).
   *
   * @returns 제거된 row 수
   */
  clearWorkspace(workspace_id: string): number {
    return this.stmtClearWorkspacePending.run(workspace_id).changes
  }
}
