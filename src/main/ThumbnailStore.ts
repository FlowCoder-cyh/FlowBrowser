/**
 * Sprint 012 M1 — 탭 미리보기 (hover thumbnail) 메모리 LRU 저장소.
 *
 * 활성 탭 변경 직전 capturePage() 결과를 dataURL로 저장.
 * 비활성 탭의 paint 정지 문제는 "활성일 때 캡처"로 우회.
 *
 * LRU: set/get 시 last-touched 갱신, 최대 N개 초과 시 가장 오래된 항목 제거.
 */

export interface ThumbnailEntry {
  dataUrl: string
  capturedAt: number
  width: number
  height: number
}

export class ThumbnailStore {
  private items = new Map<string, ThumbnailEntry>()
  private touchOrder: string[] = []

  constructor(private maxItems: number = 50) {
    if (maxItems < 1) {
      throw new Error('ThumbnailStore maxItems must be ≥ 1')
    }
  }

  set(tabId: string, entry: ThumbnailEntry): void {
    if (this.items.has(tabId)) {
      // 갱신 — touchOrder에서 기존 위치 제거 후 끝으로
      const idx = this.touchOrder.indexOf(tabId)
      if (idx >= 0) this.touchOrder.splice(idx, 1)
    }
    this.items.set(tabId, { ...entry })
    this.touchOrder.push(tabId)
    // LRU 한계 초과 시 가장 오래된 제거
    while (this.touchOrder.length > this.maxItems) {
      const oldest = this.touchOrder.shift()
      if (oldest !== undefined) this.items.delete(oldest)
    }
  }

  get(tabId: string): ThumbnailEntry | null {
    const entry = this.items.get(tabId)
    if (!entry) return null
    // 조회도 last-touched 갱신 (true LRU)
    const idx = this.touchOrder.indexOf(tabId)
    if (idx >= 0) {
      this.touchOrder.splice(idx, 1)
      this.touchOrder.push(tabId)
    }
    return { ...entry }
  }

  remove(tabId: string): boolean {
    if (!this.items.has(tabId)) return false
    this.items.delete(tabId)
    const idx = this.touchOrder.indexOf(tabId)
    if (idx >= 0) this.touchOrder.splice(idx, 1)
    return true
  }

  clear(): void {
    this.items.clear()
    this.touchOrder = []
  }

  size(): number {
    return this.items.size
  }

  /**
   * Sprint 013 M2 — 디스크에서 일괄 로드. touchOrder 순서 보존 (배열 순서 = 오래된→최신).
   * 한계 초과 시 가장 오래된 자동 제거.
   */
  bulkLoad(items: Array<{ tabId: string; entry: ThumbnailEntry }>): void {
    for (const item of items) {
      this.set(item.tabId, item.entry)
    }
  }

  /**
   * Sprint 013 M2 — 디스크 영속용 스냅샷. touchOrder 순서로 반환.
   */
  entries(): Array<{ tabId: string; entry: ThumbnailEntry }> {
    return this.touchOrder
      .map((tabId) => {
        const e = this.items.get(tabId)
        return e ? { tabId, entry: { ...e } } : null
      })
      .filter((x): x is { tabId: string; entry: ThumbnailEntry } => x !== null)
  }
}
