/**
 * Sprint 015 M6 T29 — memory IPC pure handlers.
 *
 * services.ts ipcMain.handle 가 본 모듈로 위임. MemoryService 또는 active workspace id 부재 시 graceful empty.
 *
 * 단위 테스트 친화 — getActiveWorkspaceId + getMemoryService 의존 주입.
 */

import type { MemoryService, MemoryStats } from './MemoryService'

export interface MemoryStatsArgs {
  /** 미주입 시 active workspace 활용. */
  workspaceId?: string
}

export interface MemoryStatsResponse {
  ok: boolean
  stats?: MemoryStats
  errorCode?: 'infra_unavailable' | 'no_active_workspace'
}

export interface MemoryHandlerDeps {
  getActiveWorkspaceId: () => string | null
  getMemoryService: () => MemoryService | null
}

export function handleMemoryStats(
  args: MemoryStatsArgs,
  deps: MemoryHandlerDeps
): MemoryStatsResponse {
  const svc = deps.getMemoryService()
  if (!svc) return { ok: false, errorCode: 'infra_unavailable' }
  const workspaceId = args?.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) return { ok: false, errorCode: 'no_active_workspace' }
  return { ok: true, stats: svc.getStats(workspaceId) }
}
