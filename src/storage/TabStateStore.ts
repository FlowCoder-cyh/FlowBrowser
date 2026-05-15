/**
 * Sprint 009 M3 — TabStateStore.
 * TabManager 상태(tabs + activeId)를 디스크에 영속해 앱 재시작 후 복원.
 *
 * JSON 영속. policyVersion=1. 손상 시 빈 상태 fallback.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PersistedTabSession {
  id: string
  url: string
  title: string
  createdAt: number
  lastActiveAt: number
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
      const tabs = Array.isArray(parsed.tabs)
        ? parsed.tabs.filter(
            (t): t is PersistedTabSession =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as PersistedTabSession).id === 'string' &&
              typeof (t as PersistedTabSession).url === 'string' &&
              typeof (t as PersistedTabSession).title === 'string' &&
              typeof (t as PersistedTabSession).createdAt === 'number' &&
              typeof (t as PersistedTabSession).lastActiveAt === 'number'
          )
        : []
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
