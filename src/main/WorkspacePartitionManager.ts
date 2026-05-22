/**
 * Sprint 016 M3 T14 (G-015) — WorkspacePartitionManager.
 *
 * Phase 2 cookies/storage partition 격리 모듈. 워크스페이스별 Electron Session 을
 * `persist:ws-{workspaceId}` 단위 partition 으로 분리한다.
 *
 * 책임:
 *   - partition 이름 생성/조회 (`persist:ws-{workspaceId}`)
 *   - workspaceId 별 Electron Session 객체 조회 (factory 위임)
 *   - 워크스페이스 삭제 시 해당 partition 의 cookies/storage/cache cleanup
 *
 * 비책임:
 *   - WebContentsView 라이프사이클 (main/index.ts createTabView 책임 — T15 wiring)
 *   - WorkspaceService 와 직접 결합 — workspaceHandlers 가 svc.delete() 후 본 manager 호출 (T16)
 *   - Session 객체 Map 캐시 — Electron 의 `session.fromPartition` 자체가 같은 partition name 이면
 *     동일 Session 반환 (공식 문서 보장). 별도 캐시는 stale 위험 + 테스트 부담만 추가.
 *
 * 호출 패턴:
 *   import { session } from 'electron'
 *   const mgr = new WorkspacePartitionManager({ factory: { fromPartition: session.fromPartition } })
 *   const partition = mgr.getPartitionName(ws.id)  // 'persist:ws-{uuid}'
 *   const ses = mgr.getSession(ws.id)
 *   await mgr.clearWorkspaceData(deletedWs.id)
 *
 * PRD 인용: §11.2.2 워크스페이스 cookies/storage 격리 (Phase 2)
 * 가드레일: G-015 cookies partition 격리
 */

import type { Session } from 'electron'

/** partition prefix — `session.fromPartition` 의 'persist:' prefix 가 영속 파티션을 의미. */
export const WORKSPACE_PARTITION_PREFIX = 'persist:ws-'

/**
 * Electron `session` 모듈에서 `fromPartition` 만 추출한 factory.
 * 단위 테스트에서 Mock Session 주입 가능 + main 측 wiring 은 Electron `session` 그대로 위임.
 */
export interface SessionFactory {
  fromPartition(name: string): Session
}

/** 검증 실패 — workspaceId 가 empty 또는 invalid type */
export class WorkspacePartitionError extends Error {
  constructor(public readonly code: 'invalid_workspace_id') {
    super(code)
    this.name = 'WorkspacePartitionError'
  }
}

/**
 * workspaceId 검증.
 *
 * 정책 (codex 사전 dual review NEEDS_CHANGES #1 hotfix):
 *   - string 만 허용
 *   - 빈 문자열 / 공백만 거부
 *   - **leading/trailing 공백 거부** — trim 결과를 반환하지 않음. `'abc'` 와 `' abc '` 가 같은 partition
 *     으로 alias 되는 격리 invariant 위반을 차단. caller (workspaceHandlers / WorkspaceService) 가
 *     이미 validated workspaceId (DB row id) 를 주입하므로 정상 흐름은 trim 불필요.
 *   - injection 방지: `persist:ws-` prefix 자체를 포함한 id 도 escape 없이 그대로 박힘 (`persist:ws-persist:ws-xxx`).
 *     prefix 위치가 항상 맨 앞이라 alias 위험 0.
 */
function validateWorkspaceId(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkspacePartitionError('invalid_workspace_id')
  if (raw.length === 0) throw new WorkspacePartitionError('invalid_workspace_id')
  if (raw !== raw.trim()) throw new WorkspacePartitionError('invalid_workspace_id')
  // trim 후에도 길이 0 (전체 공백) 거부 — raw === raw.trim() 이 통과한 후 length 검사로 충분.
  if (raw.trim().length === 0) throw new WorkspacePartitionError('invalid_workspace_id')
  return raw
}

export interface WorkspacePartitionManagerOptions {
  factory: SessionFactory
}

export class WorkspacePartitionManager {
  private readonly factory: SessionFactory

  constructor(opts: WorkspacePartitionManagerOptions) {
    this.factory = opts.factory
  }

  /**
   * `persist:ws-{workspaceId}` partition 이름 생성.
   * `session.fromPartition` 및 `WebContentsView({webPreferences:{partition}})` 에 직접 전달.
   * 같은 workspaceId 는 항상 같은 partition name 반환 (Pure).
   *
   * workspaceId 가 비어 있거나 string 아니면 `WorkspacePartitionError('invalid_workspace_id')`.
   */
  getPartitionName(workspaceId: string): string {
    const id = validateWorkspaceId(workspaceId)
    return `${WORKSPACE_PARTITION_PREFIX}${id}`
  }

  /**
   * workspaceId 의 Electron Session 객체 조회.
   *
   * Electron 보장 (https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options):
   *   같은 partition name 은 process lifetime 동안 동일 Session 객체 반환.
   * 별도 Map 캐시 X — codex 권고 정합 (stale 위험 회피).
   */
  getSession(workspaceId: string): Session {
    const name = this.getPartitionName(workspaceId)
    return this.factory.fromPartition(name)
  }

  /**
   * 워크스페이스 partition 의 모든 storage + cache cleanup.
   * 워크스페이스 삭제 cascade (T16) 시점에 호출.
   *
   * 호출 순서 (strict — codex NB #1 정합):
   *   1. clearStorageData() — cookies / localStorage / IndexedDB / serviceWorkers / sessionStorage
   *   2. clearCache() — HTTP cache
   *
   * 실패 정책: clearStorageData() 실패 시 clearCache() 건너뜀 + throw 전파.
   * best-effort (둘 다 시도) 가 필요하면 caller (T16 workspaceHandlers) 가 try/catch 로 분리.
   *
   * 다른 워크스페이스 partition 영향 0 (workspaceId 매개 호출 → 서로 다른 Session 객체).
   * 호출 후 같은 workspaceId 로 다시 getSession() 호출하면 새 빈 Session 상태.
   *
   * workspaceId invalid 시 throw — caller (workspaceHandlers) 가 catch + console.warn.
   */
  async clearWorkspaceData(workspaceId: string): Promise<void> {
    const ses = this.getSession(workspaceId)
    await ses.clearStorageData()
    await ses.clearCache()
  }

  /**
   * Sprint 017 M2 T11 (KI-021) — 워크스페이스 partition cleanup reconcile.
   *
   * 부팅 시점에 호출 — 워크스페이스 DB row 는 cascade 로 정상 삭제됐으나 `clearStorageData()`
   * 실패 (디스크 IO / Electron session crash) 로 디스크 잔존 partition 정리 path.
   *
   * codex 019e4f65 사전 협의 권고 흡수:
   *   - `activeWorkspaceIds.length === 0` 시 skip (DB/bootstrap 이상 신호 — 전체 삭제 차단)
   *   - `listExistingPartitionIds` throw 시 graceful skip (`enumerationError` 박음, boot path 미파괴)
   *   - `cleared` 명명 (clearStorageData 는 storage/cache clear 이지 디렉토리 삭제 보장 아님)
   *   - orphan 별 개별 try/catch (한 개 실패 시 다른 정상 orphan 처리 계속)
   *
   * 본 함수는 디스크 디렉토리 enum 책임 X — caller (services.ts) 가 fs.readdir + filter 후
   * `listExistingPartitionIds` callback 으로 주입. 단위 회귀 fs 의존성 0.
   */
  async reconcileOrphanPartitions(
    activeWorkspaceIds: readonly string[],
    listExistingPartitionIds: () => Promise<string[]> | string[]
  ): Promise<ReconcileOrphanPartitionsResult> {
    if (activeWorkspaceIds.length === 0) {
      return {
        inspected: 0,
        orphaned: [],
        cleared: [],
        errors: [],
        skipped: 'empty_active_set'
      }
    }
    let existing: string[]
    try {
      existing = await Promise.resolve(listExistingPartitionIds())
    } catch (err) {
      return {
        inspected: 0,
        orphaned: [],
        cleared: [],
        errors: [],
        enumerationError: err instanceof Error ? err : new Error(String(err))
      }
    }
    const activeSet = new Set(activeWorkspaceIds)
    const orphaned = existing.filter((id) => !activeSet.has(id))
    const cleared: string[] = []
    const errors: Array<{ workspaceId: string; error: Error }> = []
    for (const id of orphaned) {
      try {
        await this.clearWorkspaceData(id)
        cleared.push(id)
      } catch (err) {
        errors.push({
          workspaceId: id,
          error: err instanceof Error ? err : new Error(String(err))
        })
      }
    }
    return { inspected: existing.length, orphaned, cleared, errors }
  }
}

/**
 * Sprint 017 M2 T11 (KI-021) — reconcileOrphanPartitions 결과.
 *
 * 정상 path: `inspected` (디렉토리 listing 개수) + `orphaned` (active set 에 없는 id) +
 * `cleared` (clearStorageData/clearCache 성공) + `errors` (개별 실패).
 *
 * skip path:
 *   - `skipped: 'empty_active_set'` — activeWorkspaceIds.length === 0 (DB 이상 신호)
 *   - `enumerationError: Error` — listExistingPartitionIds throw
 */
export interface ReconcileOrphanPartitionsResult {
  inspected: number
  orphaned: string[]
  cleared: string[]
  errors: Array<{ workspaceId: string; error: Error }>
  enumerationError?: Error
  skipped?: 'empty_active_set'
}
