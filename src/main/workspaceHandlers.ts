/**
 * Sprint 015 M6 T28 — workspace IPC pure handlers.
 *
 * services.ts 의 ipcMain.handle thin wrapper → 본 모듈로 분기 로직 추출.
 * WorkspaceService 가 인프라 부재 (FlowbrowserDatabase bootstrap 실패) 시 graceful error 응답.
 *
 * 단위 테스트 친화 — Mock WorkspaceService + UserSettingStore 주입.
 */

import type { LevelPreference, WorkspaceRow } from '../storage/Database'
import type { WorkspaceService } from './WorkspaceService'
import { WorkspaceValidationError } from './WorkspaceService'

export interface SerializedWorkspace {
  id: string
  name: string
  icon: string
  createdAt: number
  levelPreference: LevelPreference
}

export interface WorkspaceListResponse {
  workspaces: SerializedWorkspace[]
  activeId: string | null
}

export interface WorkspaceCreateArgs {
  name: string
  icon: string
  levelPreference?: LevelPreference
}

export interface WorkspaceUpdateArgs {
  id: string
  patch: {
    name?: string
    icon?: string
    levelPreference?: LevelPreference
  }
}

export interface WorkspaceMutationResponse {
  ok: boolean
  workspace?: SerializedWorkspace
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found' | 'no_change'
}

export interface WorkspaceSwitchArgs {
  id: string
}

export interface WorkspaceSwitchResponse {
  ok: boolean
  active?: SerializedWorkspace
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found'
}

export interface WorkspaceDeleteArgs {
  id: string
}

export interface WorkspaceDeleteResponse {
  ok: boolean
  /** 마지막 1개 삭제 시 자동 생성된 "📥 기본" — 있으면 클라이언트가 list 재로드. */
  replacement?: SerializedWorkspace
  /** 삭제 후 활성 워크스페이스 id. */
  newActiveId?: string
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found'
}

export interface WorkspaceHandlerDeps {
  getService: () => WorkspaceService | null
  /**
   * Sprint 016 M0 T03c (KI-007) — 워크스페이스 전환 성공 직후 후속 wiring 호출.
   * TabManager.setActiveWorkspaceFilter + 활성 BrowserView 갱신 등.
   * 미주입 시 (테스트) no-op.
   */
  onWorkspaceSwitched?: (workspaceId: string) => void
  /**
   * Sprint 016 M0 T02 (KI-006) — 워크스페이스 전환 abort 정책 callback 3종.
   *
   * `setActive()` 호출 직전 (성공 분기) 에 일괄 invoke — 활성 워크스페이스의 진행 중 비동기 작업을
   * 모두 정리 후 새 워크스페이스로 전환한다. callback 자체 throw 는 swallow (UX 차단 안 함, console.warn).
   *
   * 호출 순서 (현재 워크스페이스 id 기준):
   *   1. abortIndexing(prevWs) — IndexingService 진행 중 인덱싱 cancel (PRD §11.8)
   *   2. clearEmbeddingQueue(prevWs) — EmbeddingQueue 의 prevWs pending 작업 제거
   *   3. abortChatStreaming(prevWs) — ChatService SSE streaming abort
   *
   * 본 PR (T02) 은 callback 인터페이스만 박음. 실 구현 (IndexingService.abort / EmbeddingQueue.clear /
   * ChatService.abortStreaming) 은 후속 PR (G-013 단계별 PR 전략 정합). 호출자가 미주입 시 (테스트) no-op.
   */
  abortIndexing?: (workspaceId: string) => void
  clearEmbeddingQueue?: (workspaceId: string) => void
  abortChatStreaming?: (workspaceId: string) => void
}

/**
 * Sprint 016 M0 T02 (KI-006) — abort callback 호출 헬퍼.
 * callback throw 는 swallow + console.warn — UX 차단 안 함.
 */
function invokeAbortCallback(
  cb: ((workspaceId: string) => void) | undefined,
  workspaceId: string,
  label: string
): void {
  if (!cb) return
  try {
    cb(workspaceId)
  } catch (err) {
    console.warn(
      `[workspace:switch] ${label} callback 실패:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

export function serializeWorkspace(row: WorkspaceRow): SerializedWorkspace {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    createdAt: row.created_at,
    levelPreference: row.level_preference
  }
}

export function handleWorkspaceList(deps: WorkspaceHandlerDeps): WorkspaceListResponse {
  const svc = deps.getService()
  if (!svc) return { workspaces: [], activeId: null }
  return {
    workspaces: svc.list().map(serializeWorkspace),
    activeId: svc.getActiveId()
  }
}

export function handleWorkspaceGetCurrent(deps: WorkspaceHandlerDeps): SerializedWorkspace | null {
  const svc = deps.getService()
  if (!svc) return null
  return serializeWorkspace(svc.getActive())
}

export async function handleWorkspaceCreate(
  args: WorkspaceCreateArgs,
  deps: WorkspaceHandlerDeps
): Promise<WorkspaceMutationResponse> {
  const svc = deps.getService()
  if (!svc) {
    return { ok: false, errorCode: 'infra_unavailable', error: '워크스페이스 인프라가 비활성입니다.' }
  }
  try {
    const row = await svc.create({
      name: args.name,
      icon: args.icon,
      level_preference: args.levelPreference ?? null
    })
    return { ok: true, workspace: serializeWorkspace(row) }
  } catch (err) {
    return failure(err)
  }
}

export async function handleWorkspaceUpdate(
  args: WorkspaceUpdateArgs,
  deps: WorkspaceHandlerDeps
): Promise<WorkspaceMutationResponse> {
  const svc = deps.getService()
  if (!svc) {
    return { ok: false, errorCode: 'infra_unavailable', error: '워크스페이스 인프라가 비활성입니다.' }
  }
  try {
    const row = await svc.update({
      id: args.id,
      patch: {
        name: args.patch?.name,
        icon: args.patch?.icon,
        level_preference: args.patch?.levelPreference
      }
    })
    return { ok: true, workspace: serializeWorkspace(row) }
  } catch (err) {
    return failure(err)
  }
}

export async function handleWorkspaceSwitch(
  args: WorkspaceSwitchArgs,
  deps: WorkspaceHandlerDeps
): Promise<WorkspaceSwitchResponse> {
  const svc = deps.getService()
  if (!svc) {
    return { ok: false, errorCode: 'infra_unavailable', error: '워크스페이스 인프라가 비활성입니다.' }
  }
  if (typeof args?.id !== 'string' || args.id.length === 0) {
    return { ok: false, errorCode: 'invalid_input', error: 'id 가 필요합니다.' }
  }
  // Sprint 016 M0 T02 (KI-006) — setActive 직전에 현재 워크스페이스의 abort callback 3종 호출.
  // 같은 워크스페이스로 재전환 (no-op) 케이스에서도 호출하나, prevId === args.id 시 skip.
  const prevId = svc.getActiveId()
  if (prevId && prevId !== args.id) {
    invokeAbortCallback(deps.abortIndexing, prevId, 'abortIndexing')
    invokeAbortCallback(deps.clearEmbeddingQueue, prevId, 'clearEmbeddingQueue')
    invokeAbortCallback(deps.abortChatStreaming, prevId, 'abortChatStreaming')
  }
  try {
    const row = await svc.setActive(args.id)
    // Sprint 016 M0 T03c (KI-007) — 후속 wiring callback (TabManager 필터 + BrowserView refresh).
    // callback 자체 throw 는 swallow (UX 차단 안 함, console.warn).
    if (deps.onWorkspaceSwitched) {
      try {
        deps.onWorkspaceSwitched(row.id)
      } catch (cbErr) {
        console.warn(
          '[workspace:switch] onWorkspaceSwitched callback 실패:',
          cbErr instanceof Error ? cbErr.message : String(cbErr)
        )
      }
    }
    return { ok: true, active: serializeWorkspace(row) }
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      return {
        ok: false,
        errorCode: err.code === 'not_found' ? 'not_found' : 'invalid_input',
        error: err.code
      }
    }
    return { ok: false, errorCode: 'invalid_input', error: errMessage(err) }
  }
}

export async function handleWorkspaceDelete(
  args: WorkspaceDeleteArgs,
  deps: WorkspaceHandlerDeps
): Promise<WorkspaceDeleteResponse> {
  const svc = deps.getService()
  if (!svc) {
    return { ok: false, errorCode: 'infra_unavailable', error: '워크스페이스 인프라가 비활성입니다.' }
  }
  if (typeof args?.id !== 'string' || args.id.length === 0) {
    return { ok: false, errorCode: 'invalid_input', error: 'id 가 필요합니다.' }
  }
  try {
    const result = await svc.delete(args.id)
    return {
      ok: result.deleted,
      replacement: result.replacement ? serializeWorkspace(result.replacement) : undefined,
      newActiveId: result.newActiveId
    }
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      return {
        ok: false,
        errorCode: err.code === 'not_found' ? 'not_found' : 'invalid_input',
        error: err.code
      }
    }
    return { ok: false, errorCode: 'invalid_input', error: errMessage(err) }
  }
}

function failure(err: unknown): WorkspaceMutationResponse {
  if (err instanceof WorkspaceValidationError) {
    return {
      ok: false,
      errorCode:
        err.code === 'not_found'
          ? 'not_found'
          : err.code === 'no_change'
            ? 'no_change'
            : 'invalid_input',
      error: err.code
    }
  }
  return { ok: false, errorCode: 'invalid_input', error: errMessage(err) }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
