/**
 * Sprint 015 M6 T28 — workspaceHandlers 단위 테스트.
 *
 * cover:
 *   - infra_unavailable graceful 응답 (svc null)
 *   - list / get-current / create / update / switch / delete 정합
 *   - validation error → errorCode 매핑
 *   - 마지막 1개 삭제 시 replacement 정합
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'
import { WorkspaceService } from '../../../src/main/WorkspaceService'
import {
  handleWorkspaceList,
  handleWorkspaceGetCurrent,
  handleWorkspaceCreate,
  handleWorkspaceUpdate,
  handleWorkspaceSwitch,
  handleWorkspaceDelete
} from '../../../src/main/workspaceHandlers'

interface Harness {
  db: FlowbrowserDatabase
  userSetting: UserSettingStore
  svc: WorkspaceService
  defaultId: string
  settingPath: string
}

async function makeHarness(): Promise<Harness> {
  const db = FlowbrowserDatabase.bootstrap({ path: ':memory:', enableWal: false })
  const settingPath = join(
    tmpdir(),
    `wsh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )
  const userSetting = new UserSettingStore(settingPath)
  await userSetting.load()
  const defaultWs = db.ensureDefaultWorkspace()
  const svc = new WorkspaceService({ db, userSettingStore: userSetting, defaultWorkspace: defaultWs })
  return { db, userSetting, svc, defaultId: defaultWs.id, settingPath }
}

async function cleanup(h: Harness): Promise<void> {
  h.db.close()
  try {
    await fs.unlink(h.settingPath)
  } catch {
    // ignore
  }
}

describe('workspaceHandlers', () => {
  let h: Harness

  beforeEach(async () => {
    h = await makeHarness()
  })

  afterEach(async () => {
    await cleanup(h)
  })

  it('list returns workspaces + activeId when svc available', () => {
    const res = handleWorkspaceList({ getService: () => h.svc })
    expect(res.workspaces.length).toBe(1)
    expect(res.workspaces[0].name).toBe('기본')
    expect(res.activeId).toBe(h.defaultId)
  })

  it('list returns empty + null when svc unavailable', () => {
    const res = handleWorkspaceList({ getService: () => null })
    expect(res.workspaces).toEqual([])
    expect(res.activeId).toBeNull()
  })

  it('get-current returns serialized active workspace', () => {
    const res = handleWorkspaceGetCurrent({ getService: () => h.svc })
    expect(res?.id).toBe(h.defaultId)
    expect(res?.icon).toBe('📥')
  })

  it('get-current returns null when svc unavailable', () => {
    expect(handleWorkspaceGetCurrent({ getService: () => null })).toBeNull()
  })

  it('create returns ok with serialized workspace', async () => {
    const res = await handleWorkspaceCreate(
      { name: 'X', icon: '📚', levelPreference: 'novice' },
      { getService: () => h.svc }
    )
    expect(res.ok).toBe(true)
    expect(res.workspace?.name).toBe('X')
    expect(res.workspace?.levelPreference).toBe('novice')
  })

  it('create returns invalid_input on empty name', async () => {
    const res = await handleWorkspaceCreate(
      { name: '', icon: '📚' },
      { getService: () => h.svc }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_input')
  })

  it('create returns infra_unavailable on null svc', async () => {
    const res = await handleWorkspaceCreate(
      { name: 'X', icon: '📚' },
      { getService: () => null }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('infra_unavailable')
  })

  it('switch updates active + returns serialized active', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceSwitch({ id: ws.id }, { getService: () => h.svc })
    expect(res.ok).toBe(true)
    expect(res.active?.id).toBe(ws.id)
  })

  it('switch returns not_found for unknown id', async () => {
    const res = await handleWorkspaceSwitch({ id: 'nope' }, { getService: () => h.svc })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('not_found')
  })

  it('switch returns invalid_input on empty id', async () => {
    const res = await handleWorkspaceSwitch({ id: '' }, { getService: () => h.svc })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_input')
  })

  // Sprint 016 M0 T03c (KI-007) — 워크스페이스 전환 후 후속 wiring callback
  it('switch invokes onWorkspaceSwitched callback after setActive (KI-007 stash/restore wiring)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const calls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: ws.id },
      { getService: () => h.svc, onWorkspaceSwitched: (wid) => calls.push(wid) }
    )
    expect(res.ok).toBe(true)
    expect(calls).toEqual([ws.id])
  })

  it('switch swallows onWorkspaceSwitched throw (UX 차단 안 함)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceSwitch(
      { id: ws.id },
      {
        getService: () => h.svc,
        onWorkspaceSwitched: () => {
          throw new Error('callback boom')
        }
      }
    )
    expect(res.ok).toBe(true)
    expect(res.active?.id).toBe(ws.id)
  })

  it('switch failure path does not invoke onWorkspaceSwitched (not_found)', async () => {
    const calls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: 'missing' },
      { getService: () => h.svc, onWorkspaceSwitched: (wid) => calls.push(wid) }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('not_found')
    expect(calls).toEqual([])
  })

  // Sprint 016 M0 T02 (KI-006) — 워크스페이스 전환 abort callback 3종
  it('KI-006 — switch invokes abort 3 callbacks with prev workspace id (setActive 직전)', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    const wsB = await h.svc.create({ name: 'B', icon: '💻' })
    await h.svc.setActive(wsA.id)
    const abortIndexingCalls: string[] = []
    const clearQueueCalls: string[] = []
    const abortChatCalls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: wsB.id },
      {
        getService: () => h.svc,
        abortIndexing: (wid) => abortIndexingCalls.push(wid),
        clearEmbeddingQueue: (wid) => clearQueueCalls.push(wid),
        abortChatStreaming: (wid) => abortChatCalls.push(wid)
      }
    )
    expect(res.ok).toBe(true)
    expect(abortIndexingCalls).toEqual([wsA.id])
    expect(clearQueueCalls).toEqual([wsA.id])
    expect(abortChatCalls).toEqual([wsA.id])
  })

  it('KI-006 — abort callbacks skip when prev workspace === target (no-op self-switch)', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    await h.svc.setActive(wsA.id)
    const calls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: wsA.id },
      {
        getService: () => h.svc,
        abortIndexing: (wid) => calls.push(`abort:${wid}`),
        clearEmbeddingQueue: (wid) => calls.push(`clear:${wid}`),
        abortChatStreaming: (wid) => calls.push(`chat:${wid}`)
      }
    )
    expect(res.ok).toBe(true)
    expect(calls).toEqual([])
  })

  it('KI-006 — abort callback throw 는 swallow (다른 callback + setActive 진행)', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    const wsB = await h.svc.create({ name: 'B', icon: '💻' })
    await h.svc.setActive(wsA.id)
    const clearCalls: string[] = []
    const chatCalls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: wsB.id },
      {
        getService: () => h.svc,
        abortIndexing: () => {
          throw new Error('boom 1')
        },
        clearEmbeddingQueue: (wid) => clearCalls.push(wid),
        abortChatStreaming: (wid) => chatCalls.push(wid)
      }
    )
    expect(res.ok).toBe(true)
    expect(res.active?.id).toBe(wsB.id)
    // 첫 callback throw 후에도 나머지 callback 호출 진행
    expect(clearCalls).toEqual([wsA.id])
    expect(chatCalls).toEqual([wsA.id])
  })

  it('KI-006 — abort callback 미주입 시 no-op (테스트 호환성)', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    const wsB = await h.svc.create({ name: 'B', icon: '💻' })
    await h.svc.setActive(wsA.id)
    const res = await handleWorkspaceSwitch(
      { id: wsB.id },
      { getService: () => h.svc } // 3 callback 미주입
    )
    expect(res.ok).toBe(true)
    expect(res.active?.id).toBe(wsB.id)
  })

  it('KI-006 — invalid args (empty id) 시 abort callback 호출 안 함', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    await h.svc.setActive(wsA.id)
    const calls: string[] = []
    const res = await handleWorkspaceSwitch(
      { id: '' },
      {
        getService: () => h.svc,
        abortIndexing: (wid) => calls.push(wid),
        clearEmbeddingQueue: (wid) => calls.push(wid),
        abortChatStreaming: (wid) => calls.push(wid)
      }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_input')
    expect(calls).toEqual([])
  })

  it('update patches name + returns ok', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceUpdate(
      { id: ws.id, patch: { name: 'B' } },
      { getService: () => h.svc }
    )
    expect(res.ok).toBe(true)
    expect(res.workspace?.name).toBe('B')
  })

  it('update returns no_change when patch makes no diff', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceUpdate({ id: ws.id, patch: {} }, { getService: () => h.svc })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('no_change')
  })

  it('delete removes + returns newActiveId', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceDelete({ id: ws.id }, { getService: () => h.svc })
    expect(res.ok).toBe(true)
    expect(res.newActiveId).toBe(h.defaultId)
    expect(res.replacement).toBeUndefined()
  })

  it('delete last triggers replacement', async () => {
    const res = await handleWorkspaceDelete(
      { id: h.defaultId },
      { getService: () => h.svc }
    )
    expect(res.ok).toBe(true)
    expect(res.replacement).toBeDefined()
    expect(res.replacement?.icon).toBe('📥')
    expect(res.newActiveId).toBe(res.replacement?.id)
  })

  it('delete returns not_found for unknown id', async () => {
    const res = await handleWorkspaceDelete({ id: 'nope' }, { getService: () => h.svc })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('not_found')
  })

  it('delete returns invalid_input on empty id', async () => {
    const res = await handleWorkspaceDelete({ id: '' }, { getService: () => h.svc })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_input')
  })

  it('delete returns infra_unavailable on null svc', async () => {
    const res = await handleWorkspaceDelete({ id: 'x' }, { getService: () => null })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('infra_unavailable')
  })

  // Sprint 016 M3 T16 (G-015) — 워크스페이스 삭제 partition cleanup cascade
  it('T16 — delete invokes clearWorkspacePartition with deleted ws id (DB cascade 후)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => h.svc,
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(true)
    expect(cleanupCalls).toEqual([ws.id])
  })

  it('T16 — clearWorkspacePartition 호출 인자는 삭제 대상 ws id 만 (다른 ws 영향 0)', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    const wsB = await h.svc.create({ name: 'B', icon: '💻' })
    const wsC = await h.svc.create({ name: 'C', icon: '🎯' })
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: wsB.id },
      {
        getService: () => h.svc,
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(true)
    // wsB 만 cleanup. wsA / wsC / defaultId 영향 0.
    expect(cleanupCalls).toEqual([wsB.id])
    expect(cleanupCalls).not.toContain(wsA.id)
    expect(cleanupCalls).not.toContain(wsC.id)
    expect(cleanupCalls).not.toContain(h.defaultId)
  })

  it('T16 — clearWorkspacePartition throw 는 swallow (DB cascade 는 이미 성공, ok=true)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => h.svc,
        clearWorkspacePartition: async () => {
          throw new Error('cleanup boom')
        }
      }
    )
    // DB cascade 는 이미 성공 → ok 유지 (partition 잔존은 다음 부팅 시점 cleanup 가능)
    expect(res.ok).toBe(true)
    expect(res.newActiveId).toBe(h.defaultId)
  })

  it('T16 — clearWorkspacePartition 미주입 시 no-op (테스트 호환성)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      { getService: () => h.svc } // clearWorkspacePartition 미주입
    )
    expect(res.ok).toBe(true)
    expect(res.newActiveId).toBe(h.defaultId)
  })

  it('T16 — not_found 시 clearWorkspacePartition 호출 안 함 (DB cascade 실패 → cleanup 의미 없음)', async () => {
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: 'nope' },
      {
        getService: () => h.svc,
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('not_found')
    expect(cleanupCalls).toEqual([])
  })

  it('T16 — 마지막 1개 삭제 시 replacement 정합 + 삭제된 ws id 만 cleanup (replacement id 영향 0)', async () => {
    // h.defaultId 가 유일한 워크스페이스 — 삭제 시 자동 "📥 기본" 재생성.
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: h.defaultId },
      {
        getService: () => h.svc,
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(true)
    expect(res.replacement).toBeDefined()
    // 삭제된 ws (h.defaultId) 만 cleanup. replacement (새로 생긴 "📥 기본") 의 partition 영향 0.
    expect(cleanupCalls).toEqual([h.defaultId])
    expect(cleanupCalls).not.toContain(res.replacement!.id)
  })

  // Sprint 016 M3 T16 — codex BLOCKING #1 hotfix: destroyWorkspaceTabs cleanup 회귀
  it('T16 BLOCKING #1 — destroyWorkspaceTabs 가 clearWorkspacePartition 직전에 호출 (순서 정합)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const callOrder: string[] = []
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => h.svc,
        destroyWorkspaceTabs: (wid, newActiveId) => {
          callOrder.push(`destroy:${wid}->${newActiveId}`)
        },
        clearWorkspacePartition: async (wid) => {
          callOrder.push(`clear:${wid}`)
        }
      }
    )
    expect(res.ok).toBe(true)
    // 순서: destroy → clear (살아있는 WebContents 가 storage 재생성 위험 차단)
    expect(callOrder).toEqual([`destroy:${ws.id}->${h.defaultId}`, `clear:${ws.id}`])
  })

  it('T16 BLOCKING #1 — destroyWorkspaceTabs 호출 인자는 (삭제 ws, newActiveId) 정합', async () => {
    const wsA = await h.svc.create({ name: 'A', icon: '📚' })
    // wsB 생성으로 잔여 ws 확보 (마지막 1개 replacement path 회피)
    await h.svc.create({ name: 'B', icon: '💻' })
    await h.svc.setActive(wsA.id)
    const destroyCalls: Array<[string, string]> = []
    const res = await handleWorkspaceDelete(
      { id: wsA.id },
      {
        getService: () => h.svc,
        destroyWorkspaceTabs: (wid, newActiveId) => {
          destroyCalls.push([wid, newActiveId])
        }
      }
    )
    expect(res.ok).toBe(true)
    // active wsA 삭제 → newActiveId 는 잔여 첫 워크스페이스 (defaultId 또는 wsB — order 의존).
    // 정확한 newActiveId 값은 svc.delete() 의 newActiveId 와 동일해야 함.
    expect(destroyCalls.length).toBe(1)
    expect(destroyCalls[0][0]).toBe(wsA.id)
    expect(destroyCalls[0][1]).toBe(res.newActiveId)
  })

  it('T16 BLOCKING #1 — destroyWorkspaceTabs throw 는 swallow (clearWorkspacePartition 계속 진행)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => h.svc,
        destroyWorkspaceTabs: () => {
          throw new Error('destroy boom')
        },
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    // destroy throw 후에도 clear 계속 진행 + ok 유지
    expect(res.ok).toBe(true)
    expect(cleanupCalls).toEqual([ws.id])
  })

  it('T16 BLOCKING #1 — destroyWorkspaceTabs 미주입 시 no-op (clearWorkspacePartition 만 진행)', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => h.svc,
        // destroyWorkspaceTabs 미주입
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(true)
    expect(cleanupCalls).toEqual([ws.id])
  })

  // codex NEEDS_CHANGES 누락 케이스 흡수
  it('T16 NEEDS_CHANGES — invalid_input ("") 시 두 callback 모두 미호출', async () => {
    const destroyCalls: string[] = []
    const cleanupCalls: string[] = []
    const res = await handleWorkspaceDelete(
      { id: '' },
      {
        getService: () => h.svc,
        destroyWorkspaceTabs: (wid) => destroyCalls.push(wid),
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_input')
    expect(destroyCalls).toEqual([])
    expect(cleanupCalls).toEqual([])
  })

  it('T16 NEEDS_CHANGES — svc.delete() unexpected throw 시 두 callback 모두 미호출', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const destroyCalls: string[] = []
    const cleanupCalls: string[] = []
    // svc.delete() 를 강제로 throw 하는 svc proxy
    const failingSvc = new Proxy(h.svc, {
      get(target, prop, recv) {
        if (prop === 'delete') {
          return async () => {
            throw new Error('svc.delete unexpected')
          }
        }
        return Reflect.get(target, prop, recv)
      }
    })
    const res = await handleWorkspaceDelete(
      { id: ws.id },
      {
        getService: () => failingSvc as typeof h.svc,
        destroyWorkspaceTabs: (wid) => destroyCalls.push(wid),
        clearWorkspacePartition: async (wid) => {
          cleanupCalls.push(wid)
        }
      }
    )
    expect(res.ok).toBe(false)
    expect(destroyCalls).toEqual([])
    expect(cleanupCalls).toEqual([])
  })
})
