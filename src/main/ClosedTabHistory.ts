/**
 * Sprint 013 M1 — 닫은 탭 히스토리.
 * Ctrl+Shift+T 또는 tab:reopen IPC로 복원 가능.
 * LIFO 스택, 최대 N=20 (기본).
 */

import type { TabColor } from './TabManager'

export interface ClosedTabEntry {
  url: string
  title: string
  color: TabColor
  pinned: boolean
  closedAt: number
}

export class ClosedTabHistory {
  private stack: ClosedTabEntry[] = []

  constructor(private maxItems: number = 20) {
    if (maxItems < 1) {
      throw new Error('ClosedTabHistory maxItems must be ≥ 1')
    }
  }

  push(entry: Omit<ClosedTabEntry, 'closedAt'>): void {
    this.stack.push({ ...entry, closedAt: Date.now() })
    while (this.stack.length > this.maxItems) {
      this.stack.shift()
    }
  }

  pop(): ClosedTabEntry | null {
    return this.stack.pop() ?? null
  }

  peek(): ClosedTabEntry | null {
    if (this.stack.length === 0) return null
    return { ...this.stack[this.stack.length - 1] }
  }

  clear(): void {
    this.stack = []
  }

  size(): number {
    return this.stack.length
  }
}
