/**
 * Sprint 009 M3 — TabStateStore.
 * TabManager 상태(tabs + activeId)를 디스크에 영속해 앱 재시작 후 복원.
 *
 * JSON 영속. policyVersion=1. 손상 시 빈 상태 fallback.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export type PersistedTabColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'gray'
  | null

const VALID_COLORS: ReadonlySet<string> = new Set([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray'
])

export interface PersistedTabSession {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
  /** Sprint 011 M2 — 누락 시 null fallback (호환) */
  color: PersistedTabColor
  /** Sprint 011 M3 — 누락 시 false fallback (호환) */
  pinned: boolean
}

export interface PersistedTabState {
  policyVersion: number
  tabs: PersistedTabSession[]
  activeId: string | null
}

export const TAB_STATE_POLICY_VERSION = 1

export class TabStateStore {
  constructor(private filePath: string) {}

  async load(): Promise<PersistedTabState> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<PersistedTabState>
      if (parsed.policyVersion !== TAB_STATE_POLICY_VERSION) {
        return this.empty()
      }
      const rawTabs = Array.isArray(parsed.tabs) ? (parsed.tabs as unknown[]) : []
      const tabs: PersistedTabSession[] = []
      for (const item of rawTabs) {
        if (typeof item !== 'object' || item === null) continue
        const t = item as Record<string, unknown>
        if (
          typeof t.id !== 'string' ||
          typeof t.url !== 'string' ||
          typeof t.title !== 'string' ||
          typeof t.createdAt !== 'number' ||
          typeof t.lastActiveAt !== 'number'
        ) {
          continue
        }
        tabs.push({
          id: t.id,
          url: t.url,
          title: t.title,
          createdAt: t.createdAt,
          lastActiveAt: t.lastActiveAt,
          color:
            typeof t.color === 'string' && VALID_COLORS.has(t.color)
              ? (t.color as PersistedTabColor)
              : null,
          pinned: typeof t.pinned === 'boolean' ? t.pinned : false
        })
      }
      const activeId =
        typeof parsed.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId)
          ? parsed.activeId
          : tabs.length > 0
            ? tabs[tabs.length - 1].id
            : null
      return { policyVersion: TAB_STATE_POLICY_VERSION, tabs, activeId }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.empty()
      }
      // JSON 손상 / 기타 IO 오류는 빈 상태 반환 (안전 fallback)
      return this.empty()
    }
  }

  async save(state: { tabs: PersistedTabSession[]; activeId: string | null }): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload: PersistedTabState = {
      policyVersion: TAB_STATE_POLICY_VERSION,
      tabs: state.tabs,
      activeId: state.activeId
    }
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  private empty(): PersistedTabState {
    return { policyVersion: TAB_STATE_POLICY_VERSION, tabs: [], activeId: null }
  }
}

export function defaultTabStatePath(userDataDir: string): string {
  return join(userDataDir, 'tabs.json')
}
