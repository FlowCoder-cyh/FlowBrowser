/**
 * Sprint 015 M3-4 — EmbeddingQueue 단위 테스트.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'

interface Fx {
  fb: FlowbrowserDatabase
  q: EmbeddingQueue
  wsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsId = fb.ensureDefaultWorkspace().id
  return { fb, q: new EmbeddingQueue(fb), wsId }
}

describe('EmbeddingQueue', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('enqueue → pending + 디폴트 priority 0 + attempts 0', () => {
    const job = fx.q.enqueue({
      target_type: 'page',
      target_id: randomUUID(),
      workspace_id: fx.wsId
    })
    expect(job.status).toBe('pending')
    expect(job.priority).toBe(0)
    expect(job.attempts).toBe(0)
    expect(fx.q.stats()).toEqual({ pending: 1, in_progress: 0, succeeded: 0, failed: 0 })
  })

  it('claimNext priority DESC + created_at ASC (FIFO 내 우선)', () => {
    const a = fx.q.enqueue({
      target_type: 'page',
      target_id: 'a',
      workspace_id: fx.wsId,
      priority: 0
    })
    const b = fx.q.enqueue({
      target_type: 'page',
      target_id: 'b',
      workspace_id: fx.wsId,
      priority: 10 // 우선
    })
    const c = fx.q.enqueue({
      target_type: 'note',
      target_id: 'c',
      workspace_id: fx.wsId,
      priority: 0
    })
    expect(fx.q.claimNext()?.id).toBe(b.id) // priority 10 우선
    expect(fx.q.claimNext()?.id).toBe(a.id) // priority 0, FIFO
    expect(fx.q.claimNext()?.id).toBe(c.id)
    expect(fx.q.claimNext()).toBeNull()
  })

  it('claimNext 상태 pending → in_progress 전환', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    const claimed = fx.q.claimNext()!
    expect(claimed.id).toBe(a.id)
    expect(claimed.status).toBe('in_progress')
    expect(fx.q.findById(a.id)?.status).toBe('in_progress')
    expect(fx.q.stats()).toEqual({ pending: 0, in_progress: 1, succeeded: 0, failed: 0 })
  })

  it('markSucceeded in_progress → succeeded', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    fx.q.claimNext()
    fx.q.markSucceeded(a.id)
    expect(fx.q.findById(a.id)?.status).toBe('succeeded')
    expect(fx.q.stats().succeeded).toBe(1)
  })

  it('markFailed → failed + attempts +1 + last_error 저장', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    fx.q.claimNext()
    fx.q.markFailed(a.id, 'HTTP 503 from OpenAI')
    const reread = fx.q.findById(a.id)!
    expect(reread.status).toBe('failed')
    expect(reread.attempts).toBe(1)
    expect(reread.last_error).toBe('HTTP 503 from OpenAI')
  })

  it('markFailed 재 enqueue 후 두 번째 실패 → attempts 2', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    fx.q.claimNext()
    fx.q.markFailed(a.id, 'err1')
    // 호출자가 재시도 정책 결정 — 같은 잡 markFailed 두 번 호출 시 attempts 증가
    fx.q.markFailed(a.id, 'err2')
    const reread = fx.q.findById(a.id)!
    expect(reread.attempts).toBe(2)
    expect(reread.last_error).toBe('err2')
  })

  it('purgeSucceeded 완료된 잡 일괄 제거', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    const b = fx.q.enqueue({ target_type: 'page', target_id: 'b', workspace_id: fx.wsId })
    fx.q.claimNext()
    fx.q.markSucceeded(a.id)
    fx.q.claimNext()
    fx.q.markSucceeded(b.id)
    expect(fx.q.purgeSucceeded()).toBe(2)
    expect(fx.q.stats().succeeded).toBe(0)
  })

  it('cancel pending / failed 만 가능', () => {
    const pending = fx.q.enqueue({
      target_type: 'page',
      target_id: 'pend',
      workspace_id: fx.wsId
    })
    const inProgress = fx.q.enqueue({
      target_type: 'page',
      target_id: 'inp',
      workspace_id: fx.wsId,
      priority: 10
    })
    fx.q.claimNext() // inProgress 가 먼저 claim
    expect(fx.q.cancel(pending.id)).toBe(true) // pending → 제거
    expect(fx.q.cancel(inProgress.id)).toBe(false) // in_progress → 차단
    fx.q.markSucceeded(inProgress.id)
    expect(fx.q.cancel(inProgress.id)).toBe(false) // succeeded → 차단
  })

  it('cancel failed 잡 가능 (재시도 포기 시나리오)', () => {
    const a = fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    fx.q.claimNext()
    fx.q.markFailed(a.id, 'permanent error')
    expect(fx.q.cancel(a.id)).toBe(true)
    expect(fx.q.findById(a.id)).toBeNull()
  })

  it('workspace CASCADE → embedding_queue 동반 제거 (FK on delete cascade)', () => {
    fx.q.enqueue({ target_type: 'page', target_id: 'a', workspace_id: fx.wsId })
    fx.q.enqueue({ target_type: 'page', target_id: 'b', workspace_id: fx.wsId })
    fx.fb.getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(fx.wsId)
    expect(fx.q.stats()).toEqual({ pending: 0, in_progress: 0, succeeded: 0, failed: 0 })
  })

  it('claimNext 빈 큐 → null', () => {
    expect(fx.q.claimNext()).toBeNull()
  })

  it('CHECK target_type 위반 → throw (page/note 만)', () => {
    expect(() =>
      fx.fb
        .getDb()
        .prepare(
          `INSERT INTO embedding_queue(id, target_type, target_id, workspace_id, priority, status, attempts, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'pending', 0, NULL, ?, ?)`
        )
        .run(randomUUID(), 'invalid', 't', fx.wsId, Date.now(), Date.now())
    ).toThrow()
  })
})

/**
 * Sprint 016 M0 T02-followup (KI-006) — workspace 전환 시 pending 잡 일괄 제거.
 *
 * clearWorkspace(ws):
 *   - pending status + workspace_id 매칭 row DELETE
 *   - in_progress / succeeded / failed 는 보존
 *   - 다른 ws 영향 0
 *   - 반환값 = 제거된 row 수
 */
describe('EmbeddingQueue — clearWorkspace (Sprint 016 M0 T02-followup, KI-006)', () => {
  let fx: Fx
  let altWsId: string

  beforeEach(() => {
    fx = setup()
    altWsId = fx.fb.createWorkspace({ name: 'Alt', icon: '🧪' }).id
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('clearWorkspace(ws) → pending 매칭 row 모두 DELETE + 반환 카운트', () => {
    // default ws pending 3개
    fx.q.enqueue({ target_type: 'page', target_id: 'p1', workspace_id: fx.wsId })
    fx.q.enqueue({ target_type: 'page', target_id: 'p2', workspace_id: fx.wsId })
    fx.q.enqueue({ target_type: 'note', target_id: 'n1', workspace_id: fx.wsId })
    // alt ws pending 2개 (격리 확인용)
    fx.q.enqueue({ target_type: 'page', target_id: 'p3', workspace_id: altWsId })
    fx.q.enqueue({ target_type: 'page', target_id: 'p4', workspace_id: altWsId })

    expect(fx.q.stats().pending).toBe(5)
    const removed = fx.q.clearWorkspace(fx.wsId)
    expect(removed).toBe(3)
    // alt ws 영향 0
    expect(fx.q.stats().pending).toBe(2)
  })

  it('clearWorkspace(ws) → in_progress / succeeded / failed 보존 (pending 만 제거)', () => {
    const j1 = fx.q.enqueue({ target_type: 'page', target_id: 'p1', workspace_id: fx.wsId })
    const j2 = fx.q.enqueue({ target_type: 'page', target_id: 'p2', workspace_id: fx.wsId })
    const j3 = fx.q.enqueue({ target_type: 'page', target_id: 'p3', workspace_id: fx.wsId })
    const j4 = fx.q.enqueue({ target_type: 'page', target_id: 'p4', workspace_id: fx.wsId })

    // j1 in_progress (claim)
    fx.q.claimNext()
    // j2 markSucceeded — claim 후 success
    fx.q.claimNext()
    fx.q.markSucceeded(j2.id)
    // j3 markFailed — claim 후 failed
    fx.q.claimNext()
    fx.q.markFailed(j3.id, 'rate-limit')
    // j4 는 pending 유지

    const before = fx.q.stats()
    expect(before).toEqual({ pending: 1, in_progress: 1, succeeded: 1, failed: 1 })

    const removed = fx.q.clearWorkspace(fx.wsId)
    expect(removed).toBe(1) // pending 만

    const after = fx.q.stats()
    expect(after).toEqual({ pending: 0, in_progress: 1, succeeded: 1, failed: 1 })

    // 보존된 j1/j2/j3 행 직접 확인
    expect(fx.q.findById(j1.id)?.status).toBe('in_progress')
    expect(fx.q.findById(j2.id)?.status).toBe('succeeded')
    expect(fx.q.findById(j3.id)?.status).toBe('failed')
    // j4 삭제
    expect(fx.q.findById(j4.id)).toBeNull()
  })

  it('clearWorkspace(ws) → 빈 큐 → 0 반환 (no-op)', () => {
    const removed = fx.q.clearWorkspace(fx.wsId)
    expect(removed).toBe(0)
  })

  it('clearWorkspace(other ws) → 무관 ws 호출 시 0 반환 + 기존 pending 보존', () => {
    fx.q.enqueue({ target_type: 'page', target_id: 'p1', workspace_id: fx.wsId })
    fx.q.enqueue({ target_type: 'page', target_id: 'p2', workspace_id: fx.wsId })

    // 존재하지 않는 ws id 호출
    const removed = fx.q.clearWorkspace('non-existent-ws-id')
    expect(removed).toBe(0)
    // 기존 pending 보존
    expect(fx.q.stats().pending).toBe(2)
  })
})
