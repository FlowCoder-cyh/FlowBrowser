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
})
