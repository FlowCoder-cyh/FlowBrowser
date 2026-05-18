/**
 * Sprint 015 M4-3 — DwellTracker.
 *
 * PRD §8.5 — Visit.dwell_ms 측정 모델 (탭 활성 + WebContentsView focus 기반).
 *
 * 책임:
 *   - visit_id 단위 누적 active 시간(ms) 추적
 *   - 활성 ↔ 일시정지 ↔ 종료 상태 전이
 *   - stop() 시 최종 누적 ms 반환 (호출자가 Visit.dwell_ms UPDATE 위임)
 *
 * 외부 신호 (호출자 책임 — wiring 은 M4-5 또는 후속):
 *   - 탭 활성 / 비활성  → start() / pause()
 *   - 윈도우 focus / blur → pauseAll() / resumeAll()
 *   - 페이지 닫기 / 탭 닫기 → stop()
 *   - 페이지 navigate (다음 페이지 진입) → 이전 visit stop() + 신규 visit start()
 *
 * Phase 1 base: 탭 활성 + focus 만으로 충분 (PRD §8.5.3 정밀 측정은 Phase 2+).
 * - 스크롤 깊이 / mousemove / viewport visibility 등 정밀 신호는 Phase 2+
 * - 사용자 idle (15초 무입력) auto-pause 도 Phase 2+ (별도 IdleDetector 모듈)
 *
 * 시간 주입: 모든 시간 인자는 옵션 `now?: number` (테스트 격리). 미주입 시 Date.now().
 *
 * 본 모듈은 pure data — Visit.dwell_ms 영속 UPDATE 는 호출자가 onStop 콜백으로 위임.
 */

export type DwellStatus = 'active' | 'paused' | 'stopped'

export interface DwellEntry {
  visitId: string
  pageId: string
  workspaceId: string
  status: DwellStatus
  /** 현재 active 구간 시작 시각. status='paused' 시 undefined. */
  activeSince?: number
  /** 누적 active ms (이전 active 구간 합산). */
  accumulatedMs: number
  /** start() 호출 시각. */
  createdAt: number
  /** stop() 호출 시각. status='stopped' 시 set. */
  stoppedAt?: number
}

export interface StartInput {
  visitId: string
  pageId: string
  workspaceId: string
  now?: number
}

export interface DwellStopPayload {
  visitId: string
  pageId: string
  workspaceId: string
  dwellMs: number
  startedAt: number
  stoppedAt: number
}

export interface DwellTrackerOptions {
  /** stop() 호출 시점 broadcast — Visit.dwell_ms UPDATE 위임 (M4-5 또는 호출자 책임). */
  onStop?: (payload: DwellStopPayload) => void
}

export class DwellTracker {
  private readonly entries = new Map<string, DwellEntry>()
  private readonly onStop?: (payload: DwellStopPayload) => void

  constructor(options: DwellTrackerOptions = {}) {
    this.onStop = options.onStop
  }

  /**
   * visit 신규 진입 — active 시작.
   * 동일 visitId 재호출 시 idempotent (이미 active 면 무시, paused 면 resume 의미).
   */
  start(input: StartInput): DwellEntry {
    const now = input.now ?? Date.now()
    const existing = this.entries.get(input.visitId)
    if (existing) {
      if (existing.status === 'stopped') {
        throw new Error(
          `DwellTracker.start: visit ${input.visitId} already stopped — cannot restart`
        )
      }
      if (existing.status === 'paused') {
        existing.status = 'active'
        existing.activeSince = now
      }
      // active 면 no-op (idempotent)
      return { ...existing }
    }
    const entry: DwellEntry = {
      visitId: input.visitId,
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      status: 'active',
      activeSince: now,
      accumulatedMs: 0,
      createdAt: now
    }
    this.entries.set(input.visitId, entry)
    return { ...entry }
  }

  /**
   * 일시정지 — active 구간 누적 + status='paused'.
   * 이미 paused 또는 stopped 면 no-op.
   */
  pause(visitId: string, now?: number): DwellEntry | null {
    const entry = this.entries.get(visitId)
    if (!entry) return null
    if (entry.status !== 'active') return { ...entry }
    const ts = now ?? Date.now()
    if (entry.activeSince !== undefined) {
      entry.accumulatedMs += Math.max(0, ts - entry.activeSince)
    }
    entry.activeSince = undefined
    entry.status = 'paused'
    return { ...entry }
  }

  /**
   * 재개 — paused 에서 active 로 복귀.
   * active 또는 stopped 면 no-op.
   */
  resume(visitId: string, now?: number): DwellEntry | null {
    const entry = this.entries.get(visitId)
    if (!entry) return null
    if (entry.status !== 'paused') return { ...entry }
    entry.status = 'active'
    entry.activeSince = now ?? Date.now()
    return { ...entry }
  }

  /**
   * 종료 — 누적 ms 확정 + status='stopped'.
   * onStop 콜백 호출. 동일 visitId 재 stop 은 누적 변경 없이 기존 payload 재방출 X (멱등 보장 — 두번째 호출은 null 반환).
   */
  stop(visitId: string, now?: number): DwellStopPayload | null {
    const entry = this.entries.get(visitId)
    if (!entry) return null
    if (entry.status === 'stopped') return null
    const ts = now ?? Date.now()
    if (entry.status === 'active' && entry.activeSince !== undefined) {
      entry.accumulatedMs += Math.max(0, ts - entry.activeSince)
    }
    entry.activeSince = undefined
    entry.status = 'stopped'
    entry.stoppedAt = ts
    const payload: DwellStopPayload = {
      visitId: entry.visitId,
      pageId: entry.pageId,
      workspaceId: entry.workspaceId,
      dwellMs: entry.accumulatedMs,
      startedAt: entry.createdAt,
      stoppedAt: ts
    }
    if (this.onStop) this.onStop(payload)
    return payload
  }

  /**
   * 윈도우 focus 잃음 — 활성 entry 모두 pause.
   * 호출자가 윈도우 blur 이벤트와 wiring.
   */
  pauseAll(now?: number): number {
    const ts = now ?? Date.now()
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.status === 'active') {
        if (entry.activeSince !== undefined) {
          entry.accumulatedMs += Math.max(0, ts - entry.activeSince)
        }
        entry.activeSince = undefined
        entry.status = 'paused'
        count++
      }
    }
    return count
  }

  /**
   * 현재 시점까지 누적 ms (실시간 계산).
   * stopped 면 영속 누적값 반환. active 면 진행 중 구간 합산.
   */
  currentMs(visitId: string, now?: number): number | null {
    const entry = this.entries.get(visitId)
    if (!entry) return null
    if (entry.status === 'active' && entry.activeSince !== undefined) {
      const ts = now ?? Date.now()
      return entry.accumulatedMs + Math.max(0, ts - entry.activeSince)
    }
    return entry.accumulatedMs
  }

  get(visitId: string): DwellEntry | null {
    const entry = this.entries.get(visitId)
    return entry ? { ...entry } : null
  }

  /** 활성 entry 수 — broadcast/디버깅용. */
  activeCount(): number {
    let n = 0
    for (const e of this.entries.values()) {
      if (e.status === 'active') n++
    }
    return n
  }

  /** stopped 포함 전체 entry 수. */
  size(): number {
    return this.entries.size
  }

  /** stopped entry 정리 (메모리 회수). */
  pruneStopped(): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (entry.status === 'stopped') {
        this.entries.delete(id)
        n++
      }
    }
    return n
  }

  clear(): void {
    this.entries.clear()
  }
}
