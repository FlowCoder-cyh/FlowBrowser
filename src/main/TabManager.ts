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

  open(url: string = 'about:blank'): TabSession {
    const now = Date.now()
    const id = `tab_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const session: TabSession = {
      id,
      url,
      title: '',
      createdAt: now,
      lastActiveAt: now,
      color: null,
      pinned: false
    }
    this.tabs.set(id, session)
    // 신규 탭은 비핀이라 기존 핀 영역 뒤 (마지막)로 push — 핀 탭이 좌측에 모이는 invariant 유지
    this.order.push(id)
    this.activeId = id
    this.emit()
    return { ...session }
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
    this.tabs.delete(id)
    const idx = this.order.indexOf(id)
    if (idx >= 0) this.order.splice(idx, 1)
    if (this.activeId === id) {
      // 닫은 탭이 활성이었으면 가장 가까운 탭으로 전환 (이전 위치 우선, 없으면 새 마지막).
      if (this.order.length === 0) {
        this.activeId = null
      } else {
        const nextIdx = Math.min(idx, this.order.length - 1)
        this.activeId = this.order[Math.max(0, nextIdx)]
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

  /**
   * Sprint 010 M2 — keepId 외 모든 탭 close. keepId 활성 보장.
   * keepId가 존재하지 않으면 false 반환, 변동 없음.
   * 닫힌 탭 id 배열 반환 (main/index.ts가 destroyTabView에 사용).
   * Sprint 011 M3 — 핀 탭은 자동 보존 (closed에서 제외).
   */
  closeOthers(keepId: string): { ok: boolean; closed: string[] } {
    if (!this.tabs.has(keepId)) return { ok: false, closed: [] }
    const closed: string[] = []
    for (const id of [...this.order]) {
      if (id === keepId) continue
      const s = this.tabs.get(id)
      if (s?.pinned) continue // Sprint 011 M3 핀 자동 보존
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
    const rightSlice = this.order.slice(fromIdx + 1)
    const toClose = rightSlice.filter((id) => !(this.tabs.get(id)?.pinned ?? false))
    if (toClose.length === 0) return { ok: true, closed: [] }
    const wasActiveClosed = this.activeId !== null && toClose.includes(this.activeId)
    for (const id of toClose) {
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
    return this.open(src.url)
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
      // 영속 파일에 color/pinned 누락 시 fallback
      this.tabs.set(s.id, {
        ...s,
        color: s.color ?? null,
        pinned: s.pinned ?? false
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
