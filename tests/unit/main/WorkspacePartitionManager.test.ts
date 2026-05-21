/**
 * Sprint 016 M3 T14 (G-015) — WorkspacePartitionManager 단위 테스트.
 *
 * cover:
 *   - partition name 생성 (`persist:ws-{workspaceId}`)
 *   - workspaceId 검증 (string non-empty / undefined / null / non-string 거부)
 *   - getSession 호출 시 factory.fromPartition 정확한 이름 호출
 *   - clearWorkspaceData — clearStorageData + clearCache 순차 호출
 *   - 다른 workspaceId → 다른 Session 객체 (cascade 격리 invariant)
 *   - 같은 workspaceId 두 번 호출 → factory.fromPartition 두 번 호출 (캐시 X 정책)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session } from 'electron'
import {
  WorkspacePartitionManager,
  WorkspacePartitionError,
  WORKSPACE_PARTITION_PREFIX,
  type SessionFactory
} from '../../../src/main/WorkspacePartitionManager'

interface MockSession {
  clearStorageData: ReturnType<typeof vi.fn>
  clearCache: ReturnType<typeof vi.fn>
  /** 어떤 partition 으로 생성됐는지 검증용 (factory 가 박음) */
  partitionName: string
}

interface MockHarness {
  factory: SessionFactory
  sessions: Map<string, MockSession>
  fromPartitionSpy: ReturnType<typeof vi.fn>
}

function makeMockHarness(): MockHarness {
  const sessions = new Map<string, MockSession>()
  const fromPartitionSpy = vi.fn((name: string) => {
    if (!sessions.has(name)) {
      sessions.set(name, {
        clearStorageData: vi.fn().mockResolvedValue(undefined),
        clearCache: vi.fn().mockResolvedValue(undefined),
        partitionName: name
      })
    }
    return sessions.get(name) as unknown as Session
  })
  return {
    factory: { fromPartition: fromPartitionSpy as unknown as (name: string) => Session },
    sessions,
    fromPartitionSpy
  }
}

describe('WorkspacePartitionManager', () => {
  let harness: MockHarness
  let mgr: WorkspacePartitionManager

  beforeEach(() => {
    harness = makeMockHarness()
    mgr = new WorkspacePartitionManager({ factory: harness.factory })
  })

  describe('partition name 생성', () => {
    it('persist:ws-{workspaceId} 형식으로 생성한다', () => {
      const name = mgr.getPartitionName('ws_abc123')
      expect(name).toBe('persist:ws-ws_abc123')
      expect(name.startsWith(WORKSPACE_PARTITION_PREFIX)).toBe(true)
    })

    it('같은 workspaceId 는 같은 partition name 반환한다 (Pure)', () => {
      expect(mgr.getPartitionName('ws_xyz')).toBe(mgr.getPartitionName('ws_xyz'))
    })

    it('다른 workspaceId 는 다른 partition name 반환한다 (격리 invariant)', () => {
      expect(mgr.getPartitionName('ws_a')).not.toBe(mgr.getPartitionName('ws_b'))
    })

    it('persist:ws- prefix 포함 workspaceId 도 그대로 박힘 (escape 없이, alias 위험 0)', () => {
      // codex NB #2 — prefix 자체를 포함한 id 도 escape 없이 박힘. prefix 위치 always 맨 앞이라 alias 0.
      expect(mgr.getPartitionName('persist:ws-xxx')).toBe('persist:ws-persist:ws-xxx')
    })
  })

  describe('workspaceId 검증', () => {
    it('빈 문자열 거부 → WorkspacePartitionError', () => {
      expect(() => mgr.getPartitionName('')).toThrow(WorkspacePartitionError)
      expect(() => mgr.getPartitionName('')).toThrow(/invalid_workspace_id/)
    })

    it('공백만 있는 문자열 거부', () => {
      expect(() => mgr.getPartitionName('   ')).toThrow(WorkspacePartitionError)
    })

    it('leading/trailing 공백 거부 — trim alias 방지 (codex NEEDS_CHANGES #1 hotfix)', () => {
      // 'abc' 와 ' abc ' 가 같은 partition 으로 alias 되면 격리 invariant 위반.
      // → trim 결과를 반환하지 않고, 공백 잔존 시 거부.
      expect(() => mgr.getPartitionName(' ws_alias')).toThrow(WorkspacePartitionError)
      expect(() => mgr.getPartitionName('ws_alias ')).toThrow(WorkspacePartitionError)
      expect(() => mgr.getPartitionName(' ws_alias ')).toThrow(WorkspacePartitionError)
      expect(() => mgr.getPartitionName('\tws_alias')).toThrow(WorkspacePartitionError)
    })

    it('trim 결과 alias 가 없음을 partition name 매핑으로 직접 확인', () => {
      // 'abc' 는 통과 / ' abc ' 는 거부 → 두 id 가 같은 partition 이름 박힐 가능성 0.
      const safe = mgr.getPartitionName('abc')
      expect(safe).toBe('persist:ws-abc')
      expect(() => mgr.getPartitionName(' abc ')).toThrow(WorkspacePartitionError)
    })

    it('undefined 거부', () => {
      expect(() => mgr.getPartitionName(undefined as unknown as string)).toThrow(
        WorkspacePartitionError
      )
    })

    it('null 거부', () => {
      expect(() => mgr.getPartitionName(null as unknown as string)).toThrow(
        WorkspacePartitionError
      )
    })

    it('number 거부', () => {
      expect(() => mgr.getPartitionName(123 as unknown as string)).toThrow(
        WorkspacePartitionError
      )
    })
  })

  describe('getSession', () => {
    it('factory.fromPartition 에 정확한 partition name 전달', () => {
      mgr.getSession('ws_test_1')
      expect(harness.fromPartitionSpy).toHaveBeenCalledTimes(1)
      expect(harness.fromPartitionSpy).toHaveBeenCalledWith('persist:ws-ws_test_1')
    })

    it('Electron 보장 정합 — 같은 workspaceId 는 동일 Session 객체 반환 (factory 가 같은 인스턴스 반환)', () => {
      const s1 = mgr.getSession('ws_same')
      const s2 = mgr.getSession('ws_same')
      expect(s1).toBe(s2)
    })

    it('같은 workspaceId 라도 factory 는 매번 호출 (자체 캐시 X)', () => {
      mgr.getSession('ws_no_cache')
      mgr.getSession('ws_no_cache')
      mgr.getSession('ws_no_cache')
      expect(harness.fromPartitionSpy).toHaveBeenCalledTimes(3)
    })

    it('다른 workspaceId 는 다른 Session 객체 (격리 invariant)', () => {
      const sA = mgr.getSession('ws_iso_a')
      const sB = mgr.getSession('ws_iso_b')
      expect(sA).not.toBe(sB)
    })

    it('invalid workspaceId throw', () => {
      expect(() => mgr.getSession('')).toThrow(WorkspacePartitionError)
    })
  })

  describe('clearWorkspaceData', () => {
    it('clearStorageData + clearCache 순차 호출', async () => {
      await mgr.clearWorkspaceData('ws_to_clear')
      const ses = harness.sessions.get('persist:ws-ws_to_clear')!
      expect(ses).toBeDefined()
      expect(ses.clearStorageData).toHaveBeenCalledTimes(1)
      expect(ses.clearCache).toHaveBeenCalledTimes(1)
      // 순서 보장 (mock invocationCallOrder)
      const storageCall = ses.clearStorageData.mock.invocationCallOrder[0]
      const cacheCall = ses.clearCache.mock.invocationCallOrder[0]
      expect(storageCall).toBeLessThan(cacheCall)
    })

    it('clearStorageData 가 실패하면 clearCache 는 호출되지 않는다 (await throw 전파)', async () => {
      const failHarness = makeMockHarness()
      // 사전에 강제로 실패하는 Session 박음
      failHarness.sessions.set('persist:ws-fail', {
        clearStorageData: vi.fn().mockRejectedValue(new Error('boom')),
        clearCache: vi.fn(),
        partitionName: 'persist:ws-fail'
      })
      // factory 가 이 기존 session 반환하도록 spy 재정의
      ;(failHarness.fromPartitionSpy as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => failHarness.sessions.get(name) as unknown as Session
      )
      const failMgr = new WorkspacePartitionManager({ factory: failHarness.factory })
      await expect(failMgr.clearWorkspaceData('fail')).rejects.toThrow('boom')
      const ses = failHarness.sessions.get('persist:ws-fail')!
      expect(ses.clearCache).not.toHaveBeenCalled()
    })

    it('다른 워크스페이스 partition 영향 0 (cascade 격리)', async () => {
      // 두 워크스페이스 partition 박은 후 한쪽만 clear
      mgr.getSession('ws_keep')
      mgr.getSession('ws_delete')
      await mgr.clearWorkspaceData('ws_delete')
      const keep = harness.sessions.get('persist:ws-ws_keep')!
      const del = harness.sessions.get('persist:ws-ws_delete')!
      expect(keep.clearStorageData).not.toHaveBeenCalled()
      expect(keep.clearCache).not.toHaveBeenCalled()
      expect(del.clearStorageData).toHaveBeenCalledTimes(1)
      expect(del.clearCache).toHaveBeenCalledTimes(1)
    })

    it('invalid workspaceId throw', async () => {
      await expect(mgr.clearWorkspaceData('')).rejects.toThrow(WorkspacePartitionError)
    })
  })

  describe('통합 — partition prefix 상수 export', () => {
    it('WORKSPACE_PARTITION_PREFIX 가 persist: prefix 포함 (Electron 영속 파티션)', () => {
      expect(WORKSPACE_PARTITION_PREFIX).toBe('persist:ws-')
      expect(WORKSPACE_PARTITION_PREFIX.startsWith('persist:')).toBe(true)
    })
  })
})
