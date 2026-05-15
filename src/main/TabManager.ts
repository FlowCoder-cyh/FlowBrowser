/**
 * Sprint 008 M1 — TabManager.
 * PRD §9.1 탭 관리 P2.
 *
 * 순수 데이터 모델 — WebContentsView 인스턴스 관리는 main/index.ts 책임.
 * 본 클래스는 탭 메타데이터(id/url/title/timestamps) + 활성 탭 + 변동 콜백만 담당.
 */

export interface TabSession {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
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
      lastActiveAt: now
    }
    this.tabs.set(id, session)
    this.order.push(id)
    this.activeId = id
    this.emit()
    return { ...session }
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
   * Sprint 010 M1 — 탭 순서 변경.
   * newIndex는 음수면 0, length 초과면 length-1로 clamp.
   * 같은 위치면 no-op (emit skip).
   * 활성 탭 및 메타데이터는 보존.
   */
  reorder(tabId: string, newIndex: number): boolean {
    const fromIdx = this.order.indexOf(tabId)
    if (fromIdx < 0) return false
    const len = this.order.length
    const clamped = Math.max(0, Math.min(newIndex, len - 1))
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
      this.tabs.set(s.id, { ...s })
      this.order.push(s.id)
    }
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
