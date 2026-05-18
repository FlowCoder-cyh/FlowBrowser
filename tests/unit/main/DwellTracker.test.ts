/**
 * Sprint 015 M4-3 — DwellTracker 단위 테스트.
 *
 * cover:
 *   - start() 신규 entry + active
 *   - pause() 누적 + status='paused'
 *   - resume() 재개 + status='active'
 *   - stop() 최종 누적 ms + onStop 콜백
 *   - 멱등 (재 stop null / 재 start idempotent)
 *   - pauseAll (윈도우 blur)
 *   - currentMs 실시간 계산
 *   - pruneStopped / clear / activeCount / size
 *   - IndexedPageStoreSqlite.updateVisitDwell 통합 검증 (M4-5 wiring 준비)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DwellTracker } from '../../../src/main/DwellTracker'
import type { DwellStopPayload } from '../../../src/main/DwellTracker'
import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'

describe('DwellTracker — 상태 전이', () => {
  it('start() 신규 entry → active, accumulated=0', () => {
    const t = new DwellTracker()
    const e = t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 1000 })
    expect(e.status).toBe('active')
    expect(e.accumulatedMs).toBe(0)
    expect(e.activeSince).toBe(1000)
    expect(e.createdAt).toBe(1000)
  })

  it('pause() 호출 시 누적 + status=paused + activeSince undefined', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 1000 })
    const paused = t.pause('v1', 3000)
    expect(paused!.status).toBe('paused')
    expect(paused!.accumulatedMs).toBe(2000)
    expect(paused!.activeSince).toBeUndefined()
  })

  it('resume() paused → active, 누적 보존', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.pause('v1', 1000) // +1000
    const resumed = t.resume('v1', 5000)
    expect(resumed!.status).toBe('active')
    expect(resumed!.activeSince).toBe(5000)
    expect(resumed!.accumulatedMs).toBe(1000)
  })

  it('stop() — 누적 ms 확정 + status=stopped + onStop 콜백', () => {
    const captured: DwellStopPayload[] = []
    const t = new DwellTracker({ onStop: (p) => captured.push(p) })
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws-a', now: 0 })
    t.pause('v1', 1000) // +1000
    t.resume('v1', 2000)
    const stopped = t.stop('v1', 5000) // +3000 = 4000 total
    expect(stopped!.dwellMs).toBe(4000)
    expect(stopped!.visitId).toBe('v1')
    expect(stopped!.pageId).toBe('p1')
    expect(stopped!.workspaceId).toBe('ws-a')
    expect(captured).toHaveLength(1)
    expect(captured[0].dwellMs).toBe(4000)
  })

  it('stop() 도중 paused 상태 — 누적 그대로 + onStop 콜백', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.pause('v1', 1500)
    const stopped = t.stop('v1', 9999)
    expect(stopped!.dwellMs).toBe(1500)
  })
})

describe('DwellTracker — 멱등 / 엣지', () => {
  it('재 stop() null 반환 + onStop 1회만 호출', () => {
    const captured: DwellStopPayload[] = []
    const t = new DwellTracker({ onStop: (p) => captured.push(p) })
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.stop('v1', 1000)
    const second = t.stop('v1', 9999)
    expect(second).toBeNull()
    expect(captured).toHaveLength(1)
  })

  it('stop 된 visit 에 start() 재호출 시 throw', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.stop('v1', 1000)
    expect(() => t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws' })).toThrow(
      /already stopped/
    )
  })

  it('이미 active 상태에서 start() 재호출 — no-op (idempotent)', () => {
    const t = new DwellTracker()
    const e1 = t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 1000 })
    const e2 = t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 5000 })
    expect(e2.activeSince).toBe(1000) // 변경 없음
    expect(e2.status).toBe('active')
    expect(e1.activeSince).toBe(1000)
  })

  it('paused 에서 start() 재호출 — resume 동일 효과', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.pause('v1', 1000)
    const e = t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 3000 })
    expect(e.status).toBe('active')
    expect(e.activeSince).toBe(3000)
  })

  it('미존재 visit pause/resume/stop/get 모두 null', () => {
    const t = new DwellTracker()
    expect(t.pause('missing')).toBeNull()
    expect(t.resume('missing')).toBeNull()
    expect(t.stop('missing')).toBeNull()
    expect(t.get('missing')).toBeNull()
    expect(t.currentMs('missing')).toBeNull()
  })

  it('active 에서 resume / paused 에서 pause — no-op 반환', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    const r1 = t.resume('v1', 1000)
    expect(r1!.status).toBe('active')
    t.pause('v1', 2000)
    const p2 = t.pause('v1', 3000)
    expect(p2!.status).toBe('paused')
  })
})

describe('DwellTracker — pauseAll / currentMs', () => {
  it('pauseAll — 모든 active entry pause + count 반환', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.start({ visitId: 'v2', pageId: 'p2', workspaceId: 'ws', now: 0 })
    t.pause('v2', 500) // v2 미리 paused
    const paused = t.pauseAll(1000)
    expect(paused).toBe(1) // v1만 active 였으니 1건
    expect(t.get('v1')!.status).toBe('paused')
    expect(t.get('v1')!.accumulatedMs).toBe(1000)
    expect(t.get('v2')!.accumulatedMs).toBe(500) // 변경 없음
  })

  it('currentMs — active 실시간 계산', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.pause('v1', 1000)
    t.resume('v1', 2000)
    expect(t.currentMs('v1', 5000)).toBe(4000) // 1000 + (5000-2000)
  })

  it('currentMs — stopped 시 영속 누적값', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.stop('v1', 3000)
    expect(t.currentMs('v1', 9999)).toBe(3000)
  })
})

describe('DwellTracker — 메모리 관리', () => {
  it('activeCount / size / pruneStopped', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.start({ visitId: 'v2', pageId: 'p2', workspaceId: 'ws', now: 0 })
    t.start({ visitId: 'v3', pageId: 'p3', workspaceId: 'ws', now: 0 })
    t.stop('v3', 1000)
    expect(t.activeCount()).toBe(2)
    expect(t.size()).toBe(3)
    const pruned = t.pruneStopped()
    expect(pruned).toBe(1)
    expect(t.size()).toBe(2)
  })

  it('clear() — 모든 entry 제거', () => {
    const t = new DwellTracker()
    t.start({ visitId: 'v1', pageId: 'p1', workspaceId: 'ws', now: 0 })
    t.clear()
    expect(t.size()).toBe(0)
  })
})

describe('IndexedPageStoreSqlite.updateVisitDwell (M4-5 wiring 준비)', () => {
  let fb: FlowbrowserDatabase
  let store: IndexedPageStoreSqlite

  beforeEach(() => {
    fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    store = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  })

  afterEach(() => {
    fb.close()
  })

  it('updateVisitDwell — 정상 update + getVisit 검증', async () => {
    const { visit } = await store.recordVisit({
      url: 'https://example.com/p',
      content: 'body',
      dwell_ms: 0
    })
    const ok = store.updateVisitDwell(visit.id, 12345)
    expect(ok).toBe(true)
    expect(store.getVisit(visit.id)!.dwell_ms).toBe(12345)
  })

  it('updateVisitDwell — 음수 input → 0 clamp', async () => {
    const { visit } = await store.recordVisit({
      url: 'https://example.com/p',
      content: 'body'
    })
    store.updateVisitDwell(visit.id, -500)
    expect(store.getVisit(visit.id)!.dwell_ms).toBe(0)
  })

  it('updateVisitDwell — 소수점 input → floor', async () => {
    const { visit } = await store.recordVisit({
      url: 'https://example.com/p',
      content: 'body'
    })
    store.updateVisitDwell(visit.id, 1234.789)
    expect(store.getVisit(visit.id)!.dwell_ms).toBe(1234)
  })

  it('updateVisitDwell — 미존재 visit id false', () => {
    const ok = store.updateVisitDwell('no-such-id', 1000)
    expect(ok).toBe(false)
  })

  it('DwellTracker.onStop → updateVisitDwell 통합', async () => {
    const { visit } = await store.recordVisit({
      url: 'https://example.com/p',
      content: 'body'
    })
    const t = new DwellTracker({
      onStop: (p) => {
        store.updateVisitDwell(p.visitId, p.dwellMs)
      }
    })
    t.start({ visitId: visit.id, pageId: visit.page_id, workspaceId: visit.workspace_id, now: 0 })
    t.stop(visit.id, 7777)
    expect(store.getVisit(visit.id)!.dwell_ms).toBe(7777)
  })
})
