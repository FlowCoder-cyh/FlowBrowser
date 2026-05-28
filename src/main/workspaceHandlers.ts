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
import type {
  WorkspaceExportImportService,
  WorkspaceExportV1,
  ImportResultSummary
} from './WorkspaceExportImportService'
import { WorkspaceExportImportError } from './WorkspaceExportImportService'

export interface SerializedWorkspace {
  id: string
  name: string
  icon: string
  createdAt: number
  levelPreference: LevelPreference
  /** Sprint 018 M2 T17d — 워크스페이스 임베딩 모델 full id (UX 표시 + 생성 시 선택값 반영). */
  embeddingModel: string
}

export interface WorkspaceListResponse {
  workspaces: SerializedWorkspace[]
  activeId: string | null
}

export interface WorkspaceCreateArgs {
  name: string
  icon: string
  levelPreference?: LevelPreference
  /** Sprint 018 M2 T17d — 사용자 선택 임베딩 모델 full id. 미주입/null 시 DB DEFAULT. 미지원 id 는 invalid_input. */
  embeddingModel?: string | null
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
  /**
   * Sprint 016 M3 T16 (G-015, codex BLOCKING #1) — 삭제된 워크스페이스의 live 탭/view cleanup.
   *
   * `svc.delete()` 성공 직후 + `clearWorkspacePartition` 호출 **직전** 에 호출. 책임:
   *   - 삭제된 ws id 에 속한 모든 탭 close + WebContentsView destroy
   *   - TabManager.setActiveWorkspaceFilter(newActiveId) 갱신
   *   - 활성 탭이 삭제 ws 였다면 newActiveId 의 첫 탭 또는 새 빈 탭으로 전환
   *
   * 순서가 중요: live WebContents 가 살아있는 상태에서 partition.clearStorageData() 를 호출하면
   * 페이지가 storage/cookie 를 다시 만들 가능성 + 다음 부팅에서 persisted tab state 의 삭제 ws id 가
   * `createTabView` 로 재생성될 위험. 본 callback 이 destroy + filter 갱신 후 partition cleanup.
   *
   * 정책:
   *   - callback throw 는 swallow (DB cascade 는 이미 성공, partition cleanup 은 계속 진행)
   *   - 미주입 시 (테스트) no-op
   */
  destroyWorkspaceTabs?: (workspaceId: string, newActiveId: string) => void
  /**
   * Sprint 016 M3 T16 (G-015) — 워크스페이스 삭제 cascade cleanup.
   *
   * `svc.delete()` 성공 직후 (DB cascade 완료 후) + `destroyWorkspaceTabs` 직후에 삭제된
   * 워크스페이스의 partition session 을 clearStorageData + clearCache. 호출 인자는 **삭제된 ws id**
   * 만 — 다른 워크스페이스 partition 은 영향 0 (manager.clearWorkspaceData 가 workspaceId 매개 호출).
   *
   * 정책:
   *   - callback throw 는 swallow (DB cascade 는 이미 성공, 부분 정합 — partition 잔존은 다음 부팅
   *     시점에 cleanup 시도 가능, 잠재 KI-021 reconcile path 부재)
   *   - 호출 자체 await — partition cleanup 비동기 완료 후 응답 반환
   *
   * 미주입 시 (테스트) no-op.
   */
  clearWorkspacePartition?: (workspaceId: string) => Promise<void>
  /**
   * Sprint 016 M3 T17 (KI-008 closed) — Workspace JSON Export/Import service getter.
   * `workspace:export-json` / `workspace:import-json` IPC 가 사용.
   * 미주입 (테스트) 또는 null (bootstrap 실패) 시 infra_unavailable 응답.
   */
  getExportImportService?: () => WorkspaceExportImportService | null
}

export interface WorkspaceExportArgs {
  id: string
}

export interface WorkspaceExportResponse {
  ok: boolean
  payload?: WorkspaceExportV1
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'not_found'
}

export interface WorkspaceImportArgs {
  payload: unknown
}

export interface WorkspaceImportResponse {
  ok: boolean
  summary?: ImportResultSummary
  error?: string
  errorCode?: 'infra_unavailable' | 'invalid_input' | 'invalid_export_schema' | 'invalid_version' | 'unsupported_schema_version'
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
    levelPreference: row.level_preference,
    embeddingModel: row.embedding_model
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
      level_preference: args.levelPreference ?? null,
      embedding_model: args.embeddingModel ?? null
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
    if (result.deleted) {
      // Sprint 016 M3 T16 (G-015, codex BLOCKING #1) — DB cascade 후 cleanup 순서:
      //   1. destroyWorkspaceTabs — 삭제된 ws 의 live WebContentsView destroy + TabManager 정리
      //   2. clearWorkspacePartition — partition session storage/cache cleanup
      // 순서 거꾸로 (partition cleanup 먼저) 하면 살아있는 WebContents 가 storage 재생성 위험.
      if (deps.destroyWorkspaceTabs) {
        try {
          deps.destroyWorkspaceTabs(args.id, result.newActiveId)
        } catch (destroyErr) {
          console.warn(
            '[workspace:delete] destroyWorkspaceTabs 실패 (DB cascade 는 성공, partition cleanup 진행):',
            destroyErr instanceof Error ? destroyErr.message : String(destroyErr)
          )
        }
      }
      if (deps.clearWorkspacePartition) {
        try {
          await deps.clearWorkspacePartition(args.id)
        } catch (cleanupErr) {
          console.warn(
            '[workspace:delete] clearWorkspacePartition 실패 (DB cascade 는 성공, partition 잔존):',
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
          )
        }
      }
    }
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

/**
 * Sprint 016 M3 T17 (KI-008) — workspace:export-json IPC handler.
 *
 * 한 워크스페이스의 모든 데이터를 versioned JSON 으로 export.
 * caller (renderer) 가 결과를 파일에 저장.
 */
export function handleWorkspaceExportJson(
  args: WorkspaceExportArgs,
  deps: WorkspaceHandlerDeps
): WorkspaceExportResponse {
  if (typeof args?.id !== 'string' || args.id.length === 0) {
    return { ok: false, errorCode: 'invalid_input', error: 'id 가 필요합니다.' }
  }
  const svc = deps.getExportImportService?.()
  if (!svc) {
    return {
      ok: false,
      errorCode: 'infra_unavailable',
      error: 'Export/Import 인프라가 비활성입니다.'
    }
  }
  try {
    const payload = svc.exportWorkspace(args.id)
    return { ok: true, payload }
  } catch (err) {
    if (err instanceof WorkspaceExportImportError && err.code === 'workspace_not_found') {
      return { ok: false, errorCode: 'not_found', error: err.message }
    }
    return { ok: false, errorCode: 'invalid_input', error: errMessage(err) }
  }
}

/**
 * Sprint 016 M3 T17 (KI-008) — workspace:import-json IPC handler.
 *
 * JSON payload (보통 파일에서 읽힌) 을 새 워크스페이스로 import.
 * 항상 새 workspace id 발급 + 모든 child id 새로 발급 + 참조 재매핑.
 */
export function handleWorkspaceImportJson(
  args: WorkspaceImportArgs,
  deps: WorkspaceHandlerDeps
): WorkspaceImportResponse {
  if (args === null || args === undefined) {
    return { ok: false, errorCode: 'invalid_input', error: 'args 가 필요합니다.' }
  }
  const svc = deps.getExportImportService?.()
  if (!svc) {
    return {
      ok: false,
      errorCode: 'infra_unavailable',
      error: 'Export/Import 인프라가 비활성입니다.'
    }
  }
  try {
    const summary = svc.importWorkspace(args.payload)
    // codex BLOCKING #1 hotfix — import 성공 후 WorkspaceService 캐시 invalidation.
    // svc 가 자체 list() 캐시를 들고 있어 import 후 새 워크스페이스가 sidebar 에 안 보이는 위험 차단.
    const wsSvc = deps.getService()
    if (wsSvc) {
      wsSvc.invalidateCache()
    }
    return { ok: true, summary }
  } catch (err) {
    if (err instanceof WorkspaceExportImportError) {
      const code = err.code
      const errorCode =
        code === 'invalid_export_schema'
          ? 'invalid_export_schema'
          : code === 'invalid_version'
            ? 'invalid_version'
            : code === 'unsupported_schema_version'
              ? 'unsupported_schema_version'
              : 'invalid_input'
      return { ok: false, errorCode, error: err.message }
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
