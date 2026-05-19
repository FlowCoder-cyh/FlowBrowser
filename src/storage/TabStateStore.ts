/**
 * Sprint 009 M3 — TabStateStore.
 * TabManager 상태(tabs + activeId)를 디스크에 영속해 앱 재시작 후 복원.
 *
 * JSON 영속. policyVersion=2 (Sprint 016 M0 T03a — workspace_id 컬럼 신규).
 * V1 → V2 마이그레이션: workspace_id 누락 → null fallback (T03c wiring 에서 active workspace backfill).
 * 손상 시 빈 상태 fallback.
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
  /** Sprint 016 M0 T03a (KI-007) — 워크스페이스 격리 메타. V1 누락 시 null fallback (T03c backfill). */
  workspace_id: string | null
}

export interface PersistedTabState {
  policyVersion: number
  tabs: PersistedTabSession[]
  activeId: string | null
}

/**
 * Sprint 016 M0 T03a — V1 (Sprint 009~015) → V2 (workspace_id 컬럼) 마이그레이션.
 * V1 파일은 자동으로 V2 로 읽혀짐 (workspace_id = null fallback). 다음 save 시 V2 로 영속.
 */
export const TAB_STATE_POLICY_VERSION = 2
const TAB_STATE_POLICY_V1 = 1

export class TabStateStore {
  constructor(private filePath: string) {}

  async load(): Promise<PersistedTabState> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<PersistedTabState>
      // Sprint 016 M0 T03a — V1 (workspace_id 누락) → V2 자동 마이그레이션. 그 외 미인지 버전은 빈 상태 fallback.
      if (
        parsed.policyVersion !== TAB_STATE_POLICY_VERSION &&
        parsed.policyVersion !== TAB_STATE_POLICY_V1
      ) {
        return this.empty()
      }
      // Sprint 016 M0 T03a (codex BLOCKING #1 — G-014 정합) — V1 파일 발견 시 same-dir `.v1.bak` 백업 1회.
      // 본 store 의 save() 가 다음 호출 때 V2 로 덮어쓰기 전 보존. 백업 파일이 이미 있으면 skip (반복 호출 idempotent).
      if (parsed.policyVersion === TAB_STATE_POLICY_V1) {
        await this.backupV1Once(buf)
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
        // codex BLOCKING #2 — v03_to_v04 마이그레이션 잔재 'workspaceId' camelCase 도 수용 (snake_case 우선).
        const wsRaw =
          typeof t.workspace_id === 'string'
            ? t.workspace_id
            : typeof t.workspaceId === 'string'
              ? t.workspaceId
              : null
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
          pinned: typeof t.pinned === 'boolean' ? t.pinned : false,
          workspace_id: wsRaw
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

  /**
   * Sprint 016 M0 T03a — V1 영속 파일 발견 시 1회 백업 (G-014).
   * `${filePath}.v1.bak` 가 이미 있으면 skip — V1 → V2 첫 load 시점만 백업.
   * 백업 실패 (디스크 권한 등) 는 load 자체를 막지 않음 (warn 만).
   */
  private async backupV1Once(rawBuf: string): Promise<void> {
    const backupPath = `${this.filePath}.v1.bak`
    try {
      await fs.access(backupPath)
      // 이미 존재 — skip
      return
    } catch {
      // 미존재 — 백업 진행
    }
    try {
      await fs.writeFile(backupPath, rawBuf, 'utf-8')
    } catch {
      // 백업 실패는 load 차단 안 함 (G-014 권고 best-effort)
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
