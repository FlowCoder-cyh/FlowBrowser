/**
 * Sprint 008 M1 — TabManager.
 * PRD §9.1 탭 관리 P2.
 *
 * 순수 데이터 모델 — WebContentsView 인스턴스 관리는 main/index.ts 책임.
 * 본 클래스는 탭 메타데이터(id/url/title/timestamps) + 활성 탭 + 변동 콜백만 담당.
 */

export type TabColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | null

export const TAB_COLOR_PALETTE: TabColor[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
  null
]

export interface TabSession {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
  /** Sprint 011 M2 — 사용자 시각 분류용 컬러 라벨 (기본 null) */
  color: TabColor
  /** Sprint 011 M3 — 핀(고정) 상태 (기본 false). 핀 탭은 항상 좌측 + closeOthers/closeRight 자동 제외 */
  pinned: boolean
  /**
   * Sprint 016 M0 T03a (KI-007) — 워크스페이스 격리 메타.
   * null = 미할당 (V1 영속 마이그레이션 직후 + 첫 wiring 전).
   * T03c (stash/restore wiring) 시점에 active workspace 로 자동 backfill.
   */
  workspace_id: string | null
}

/** Sprint 016 M0 T03a — open() 옵션. workspaceId 미지정 시 null (T03c wiring 에서 채움). */
export interface OpenTabOptions {
  workspaceId?: string | null
}

export type TabsChangeHandler = (snapshot: {
  tabs: TabSession[]
  activeId: string | null
}) => void

export class TabManager {
  private tabs = new Map<string, TabSession>()
  private order: string[] = []
  private activeId: string | null = null
  private subscribers: Set<TabsChangeHandler> = new Set()
  /**
   * Sprint 016 M0 T03c (KI-007) — 활성 워크스페이스 필터.
   * null 이면 모든 탭 표시 (V1 호환 / fresh install). 값이 설정되면 list / snapshot 이 자동 필터.
   * 워크스페이스 전환 시 `setActiveWorkspaceFilter` 호출 → broadcast 1회.
   */
  private activeWorkspaceFilter: string | null = null
  /** Sprint 016 M0 T03c — workspace_id 별 마지막 활성 탭 id (stash 복원용). */
  private activeTabByWorkspace: Map<string, string> = new Map()

  open(url: string = 'about:blank', opts: OpenTabOptions = {}): TabSession {
    const now = Date.now()
    const id = `tab_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const session: TabSession = {
      id,
      url,
      title: '',
      createdAt: now,
      lastActiveAt: now,
      color: null,
      pinned: false,
      workspace_id: opts.workspaceId ?? null
    }
    this.tabs.set(id, session)
    // 신규 탭은 비핀이라 기존 핀 영역 뒤 (마지막)로 push — 핀 탭이 좌측에 모이는 invariant 유지
    this.order.push(id)
    this.activeId = id
    this.emit()
    return { ...session }
  }

  /**
   * Sprint 016 M0 T03c (KI-007) — 활성 워크스페이스 필터 설정.
   *
   * 동작:
   *  1. 이전 activeWorkspaceFilter (있다면) 의 activeId 를 `activeTabByWorkspace` 에 stash
   *  2. 새 필터 적용 — list / snapshot 이 자동 필터됨
   *  3. 새 ws 의 stash 된 active tab 이 있으면 복원, 없으면 첫 visible 탭, 빈 set 이면 null
   *  4. 같은 값 no-op (true, emit skip)
   *
   * 호출자: `workspaceHandlers.handleWorkspaceSwitch` 후속 callback. fresh install / V1 호환 시 null 유지.
   */
  setActiveWorkspaceFilter(workspaceId: string | null): boolean {
    if (this.activeWorkspaceFilter === workspaceId) return true
    // 1. 기존 활성 ws 의 activeId 를 stash
    if (this.activeWorkspaceFilter !== null && this.activeId !== null) {
      this.activeTabByWorkspace.set(this.activeWorkspaceFilter, this.activeId)
    }
    this.activeWorkspaceFilter = workspaceId
    // 2. 새 ws 의 stash 된 active 복원 또는 첫 visible 탭 / 없으면 null
    if (workspaceId === null) {
      // 전체 표시 모드 — activeId 변경하지 않음
    } else {
      const stashed = this.activeTabByWorkspace.get(workspaceId)
      const visible = this.listByWorkspace(workspaceId)
      if (stashed && visible.some((t) => t.id === stashed)) {
        this.activeId = stashed
      } else if (visible.length > 0) {
        this.activeId = visible[visible.length - 1].id
      } else {
        this.activeId = null
      }
      if (this.activeId !== null) {
        const s = this.tabs.get(this.activeId)
        if (s) s.lastActiveAt = Date.now()
      }
    }
    this.emit()
    return true
  }

  getActiveWorkspaceFilter(): string | null {
    return this.activeWorkspaceFilter
  }

  /**
   * Sprint 016 M0 T03c (KI-007) — V1 마이그레이션 직후 backfill helper.
   * workspace_id 가 null 인 모든 탭에 한 번에 디폴트 ws 박음. emit 1회 (or 0).
   * 호출자: `main/index.ts` initializeTabs — TabStateStore.load 결과 V1 호환 fallback.
   * 변경된 탭 수 반환.
   */
  backfillUnassignedWorkspaceId(workspaceId: string): number {
    let count = 0
    for (const s of this.tabs.values()) {
      if (s.workspace_id === null) {
        s.workspace_id = workspaceId
        count++
      }
    }
    if (count > 0) this.emit()
    return count
  }

  /**
   * Sprint 016 M0 T03a (KI-007) — 탭 워크스페이스 메타 변경.
   * 같은 값 no-op (true, emit skip). 존재하지 않는 id false.
   * 호출자 (T03c workspaceHandlers stash/restore wiring) 가 active workspace 로 backfill.
   */
  setWorkspaceId(id: string, workspaceId: string | null): boolean {
    const s = this.tabs.get(id)
    if (!s) return false
    if (s.workspace_id === workspaceId) return true
    s.workspace_id = workspaceId
    this.emit()
    return true
  }

  /**
   * Sprint 016 M0 T03a (KI-007) — 워크스페이스 필터 목록.
   * workspace_id 가 정확히 일치하는 탭만 반환 (null 도 일치).
   * order 보존, list() 와 같은 shallow clone 보장.
   */
  listByWorkspace(workspaceId: string | null): TabSession[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((s): s is TabSession => s !== undefined && s.workspace_id === workspaceId)
      .map((s) => ({ ...s }))
  }

  /**
   * Sprint 011 M3 — 탭 핀 토글.
   * 핀 시: order에서 제거 후 핀 영역 끝(첫 비핀 직전)에 삽입
   * 핀 해제 시: order에서 제거 후 마지막에 삽입
   * 같은 상태면 no-op (emit skip).
   */
  setPinned(id: string, pinned: boolean): boolean {
    const s = this.tabs.get(id)
    if (!s) return false
    if (s.pinned === pinned) return true
    s.pinned = pinned
    // order 재정렬: 핀 영역 좌측 + 비핀 영역 우측 invariant 유지
    const fromIdx = this.order.indexOf(id)
    if (fromIdx >= 0) this.order.splice(fromIdx, 1)
    if (pinned) {
      // 핀 영역 끝 = 첫 비핀 탭의 index
      let insertIdx = this.order.findIndex((tid) => !(this.tabs.get(tid)?.pinned ?? false))
      if (insertIdx < 0) insertIdx = this.order.length
      this.order.splice(insertIdx, 0, id)
    } else {
      // 비핀 영역 끝 (마지막)
      this.order.push(id)
    }
    this.emit()
    return true
  }

  /**
   * Sprint 011 M2 — 탭 컬러 라벨 변경.
   * palette 외 값 false, 같은 색 no-op (emit skip).
   */
  setColor(id: string, color: TabColor): boolean {
    const s = this.tabs.get(id)
    if (!s) return false
    if (!TAB_COLOR_PALETTE.includes(color)) return false
    if (s.color === color) return true
    s.color = color
    this.emit()
    return true
  }

  close(id: string): boolean {
    if (!this.tabs.has(id)) return false
    // Sprint 016 M0 T03c — stash map 에서 해당 탭 참조 정리.
    for (const [ws, tabId] of this.activeTabByWorkspace) {
      if (tabId === id) this.activeTabByWorkspace.delete(ws)
    }
    this.tabs.delete(id)
    const idx = this.order.indexOf(id)
    if (idx >= 0) this.order.splice(idx, 1)
    if (this.activeId === id) {
      // 닫은 탭이 활성이었으면 가장 가까운 탭으로 전환 (이전 위치 우선, 없으면 새 마지막).
      // Sprint 016 M0 T03c — activeWorkspaceFilter 가 있으면 같은 ws 탭 중에서 우선 선택.
      const candidatePool =
        this.activeWorkspaceFilter !== null
          ? this.order.filter((tid) => this.tabs.get(tid)?.workspace_id === this.activeWorkspaceFilter)
          : this.order
      if (candidatePool.length === 0) {
        this.activeId = null
      } else {
        // 닫힌 탭의 order index 기준 가장 가까운 same-ws 탭 선택
        const nextCandidateIdx = candidatePool.findIndex(
          (tid) => this.order.indexOf(tid) >= idx
        )
        this.activeId =
          nextCandidateIdx >= 0
            ? candidatePool[nextCandidateIdx]
            : candidatePool[candidatePool.length - 1]
        const s = this.tabs.get(this.activeId)
        if (s) s.lastActiveAt = Date.now()
      }
    }
    this.emit()
    return true
  }

  switch(id: string): boolean {
    if (!this.tabs.has(id)) return false
    if (this.activeId === id) return true
    this.activeId = id
    const s = this.tabs.get(id)
    if (s) s.lastActiveAt = Date.now()
    this.emit()
    return true
  }

  list(): TabSession[] {
    // Sprint 016 M0 T03c — activeWorkspaceFilter 설정 시 해당 ws 탭만 반환 (격리 가시성).
    if (this.activeWorkspaceFilter !== null) {
      return this.listByWorkspace(this.activeWorkspaceFilter)
    }
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((s): s is TabSession => s !== undefined)
      .map((s) => ({ ...s }))
  }

  /** Sprint 016 M0 T03c — 필터 무시한 전체 탭 (영속 / 디버깅용). */
  listAll(): TabSession[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((s): s is TabSession => s !== undefined)
      .map((s) => ({ ...s }))
  }

  getActive(): TabSession | null {
    if (!this.activeId) return null
    const s = this.tabs.get(this.activeId)
    return s ? { ...s } : null
  }

  getActiveId(): string | null {
    return this.activeId
  }

  size(): number {
    return this.tabs.size
  }

  updateUrl(id: string, url: string): boolean {
    const s = this.tabs.get(id)
    if (!s) return false
    if (s.url === url) return true
    s.url = url
    this.emit()
    return true
  }

  updateTitle(id: string, title: string): boolean {
    const s = this.tabs.get(id)
    if (!s) return false
    if (s.title === title) return true
    s.title = title
    this.emit()
    return true
  }

  /**
   * 탭 변동 시 호출. unsubscribe 함수 반환.
   */
  subscribe(handler: TabsChangeHandler): () => void {
    this.subscribers.add(handler)
    return () => {
      this.subscribers.delete(handler)
    }
  }

  snapshot(): { tabs: TabSession[]; activeId: string | null } {
    return { tabs: this.list(), activeId: this.activeId }
  }

  /** Sprint 016 M0 T03c — 영속 / 종합 갱신용 — 필터 무시한 전체 탭 + activeId. */
  snapshotAll(): { tabs: TabSession[]; activeId: string | null } {
    return { tabs: this.listAll(), activeId: this.activeId }
  }

  /**
   * Sprint 012 M3 — 현재 활성 탭 기준 다음/이전 탭의 id 반환 (순환).
   * 활성 탭 없거나 탭 0개면 null.
   * 단일 탭이면 같은 id 반환 (caller가 noop 판단).
   */
  cycleActiveTabId(direction: 'next' | 'prev'): string | null {
    // Sprint 016 M0 T03c hotfix (codex BLOCKING #3) — activeWorkspaceFilter 설정 시 같은 ws 탭만 cycle.
    // 다른 ws 탭으로 순환 시 격리 위반 + setActiveTabView 시 BrowserView 노출.
    const filter = this.activeWorkspaceFilter
    const pool =
      filter !== null
        ? this.order.filter((tid) => this.tabs.get(tid)?.workspace_id === filter)
        : this.order
    if (pool.length === 0) return null
    if (this.activeId === null) return null
    const idx = pool.indexOf(this.activeId)
    if (idx < 0) return null
    const len = pool.length
    const nextIdx = direction === 'next' ? (idx + 1) % len : (idx - 1 + len) % len
    return pool[nextIdx]
  }

  /**
   * Sprint 010 M2 — keepId 외 모든 탭 close. keepId 활성 보장.
   * keepId가 존재하지 않으면 false 반환, 변동 없음.
   * 닫힌 탭 id 배열 반환 (main/index.ts가 destroyTabView에 사용).
   * Sprint 011 M3 — 핀 탭은 자동 보존 (closed에서 제외).
   */
  closeOthers(keepId: string): { ok: boolean; closed: string[] } {
    if (!this.tabs.has(keepId)) return { ok: false, closed: [] }
    // Sprint 016 M0 T03c hotfix (codex BLOCKING #1) — activeWorkspaceFilter 설정 시 같은 ws 탭만 대상.
    // 다른 ws 탭은 보존 (격리 invariant — 사용자가 보이지 않는 탭을 닫지 못함).
    const filter = this.activeWorkspaceFilter
    const closed: string[] = []
    for (const id of [...this.order]) {
      if (id === keepId) continue
      const s = this.tabs.get(id)
      if (s?.pinned) continue // Sprint 011 M3 핀 자동 보존
      if (filter !== null && s?.workspace_id !== filter) continue // 다른 ws 보존
      // stash map cleanup
      for (const [ws, tid] of this.activeTabByWorkspace) {
        if (tid === id) this.activeTabByWorkspace.delete(ws)
      }
      this.tabs.delete(id)
      const idx = this.order.indexOf(id)
      if (idx >= 0) this.order.splice(idx, 1)
      closed.push(id)
    }
    if (this.activeId !== keepId) {
      this.activeId = keepId
      const s = this.tabs.get(keepId)
      if (s) s.lastActiveAt = Date.now()
    }
    if (closed.length > 0) this.emit()
    return { ok: true, closed }
  }

  /**
   * Sprint 010 M2 — fromId 오른쪽(order index >) 탭들만 close.
   * fromId 활성 유지 (단, 닫힌 탭 중에 활성이 있었으면 fromId로 전환).
   * Sprint 011 M3 — 핀 탭은 자동 보존 (closed에서 제외).
   */
  closeRight(fromId: string): { ok: boolean; closed: string[] } {
    const fromIdx = this.order.indexOf(fromId)
    if (fromIdx < 0) return { ok: false, closed: [] }
    // Sprint 016 M0 T03c hotfix (codex BLOCKING #2) — activeWorkspaceFilter 설정 시 같은 ws 탭만 대상.
    const filter = this.activeWorkspaceFilter
    const rightSlice = this.order.slice(fromIdx + 1)
    const toClose = rightSlice.filter((id) => {
      const s = this.tabs.get(id)
      if (!s) return false
      if (s.pinned) return false
      if (filter !== null && s.workspace_id !== filter) return false // 다른 ws 보존
      return true
    })
    if (toClose.length === 0) return { ok: true, closed: [] }
    const wasActiveClosed = this.activeId !== null && toClose.includes(this.activeId)
    for (const id of toClose) {
      for (const [ws, tid] of this.activeTabByWorkspace) {
        if (tid === id) this.activeTabByWorkspace.delete(ws)
      }
      this.tabs.delete(id)
      const idx = this.order.indexOf(id)
      if (idx >= 0) this.order.splice(idx, 1)
    }
    if (wasActiveClosed) {
      this.activeId = fromId
      const s = this.tabs.get(fromId)
      if (s) s.lastActiveAt = Date.now()
    }
    this.emit()
    return { ok: true, closed: toClose }
  }

  /**
   * Sprint 010 M2 — 동일 url로 새 탭 생성 후 활성화.
   * 원본이 존재하지 않으면 null 반환.
   */
  duplicate(id: string): TabSession | null {
    const src = this.tabs.get(id)
    if (!src) return null
    // Sprint 016 M0 T03a — 원본 workspace_id 보존 (격리 invariant 유지)
    return this.open(src.url, { workspaceId: src.workspace_id })
  }

  /**
   * Sprint 010 M1 — 탭 순서 변경.
   * newIndex는 음수면 0, length 초과면 length-1로 clamp.
   * 같은 위치면 no-op (emit skip).
   * 활성 탭 및 메타데이터는 보존.
   */
  reorder(tabId: string, newIndex: number): boolean {
    const fromIdx = this.order.indexOf(tabId)
    if (fromIdx < 0) return false
    const len = this.order.length
    let clamped = Math.max(0, Math.min(newIndex, len - 1))
    // Sprint 011 M3 — 핀↔비핀 경계 넘기는 이동 제한 (clamp)
    const isPinned = this.tabs.get(tabId)?.pinned ?? false
    const pinnedCount = this.order.reduce(
      (acc, id) => acc + (this.tabs.get(id)?.pinned ? 1 : 0),
      0
    )
    if (isPinned) {
      // 핀 영역: [0, pinnedCount-1]
      clamped = Math.min(clamped, pinnedCount - 1)
    } else {
      // 비핀 영역: [pinnedCount, len-1]
      clamped = Math.max(clamped, pinnedCount)
    }
    if (clamped === fromIdx) return true
    this.order.splice(fromIdx, 1)
    this.order.splice(clamped, 0, tabId)
    this.emit()
    return true
  }

  /**
   * Sprint 009 M3 — 외부 상태(TabStateStore) 복원.
   * 기존 상태는 모두 제거. emit 1회.
   */
  restore(state: { tabs: TabSession[]; activeId: string | null }): void {
    this.tabs.clear()
    this.order = []
    for (const s of state.tabs) {
      // 영속 파일에 color/pinned/workspace_id 누락 시 fallback (V1 → V2 호환)
      this.tabs.set(s.id, {
        ...s,
        color: s.color ?? null,
        pinned: s.pinned ?? false,
        workspace_id: s.workspace_id ?? null
      })
      this.order.push(s.id)
    }
    // Sprint 011 M3 — 핀 탭이 좌측에 오도록 정렬 (stable: 같은 핀 상태 안에서는 원래 순서 유지)
    this.order.sort((a, b) => {
      const pa = this.tabs.get(a)?.pinned ? 1 : 0
      const pb = this.tabs.get(b)?.pinned ? 1 : 0
      return pb - pa // 핀(1)이 앞
    })
    if (state.activeId && this.tabs.has(state.activeId)) {
      this.activeId = state.activeId
    } else if (this.order.length > 0) {
      this.activeId = this.order[this.order.length - 1]
    } else {
      this.activeId = null
    }
    this.emit()
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const h of this.subscribers) {
      try {
        h(snap)
      } catch {
        // subscriber 오류는 다른 subscriber 영향 안 줌
      }
    }
  }
}
