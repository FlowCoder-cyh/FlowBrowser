/**
 * Sprint 016 M0 T06 — perf bench (KI-014 워크스페이스 전환 < 1초 / 10탭 기준).
 *
 * PRD §11.8 / §11.3.2 — WorkspaceService.setActive() + onWorkspaceSwitched callback 시퀀스 평균 1초 임계.
 *
 * 측정: 10 워크스페이스 + 워크스페이스마다 10 페이지 시드 → setActive() bench (callback 동기 swallow 케이스).
 *
 * 임계: 평균 hz × 1000ms = 1/s 이상 (1회당 < 1초).
 * 미달 시: 후속 hotfix 또는 KI-014 status `open` 유지 (Sprint 016 contract §6 매트릭스 #8).
 *
 * 비고: KI-006 abort + KI-007 stash/restore 의 실제 wiring 은 후속 PR (T02 / T03) — 본 bench 는 setActive() 단순 경로.
 */

import { bench, describe, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { UserSettingStore } from '../../src/storage/UserSettingStore'
import { WorkspaceService } from '../../src/main/WorkspaceService'

interface Fx {
  fb: FlowbrowserDatabase
  svc: WorkspaceService
  wsIds: string[]
  cycleIdx: number
  tmpDir: string
}

async function setup(workspaceCount: number, tabsPerWs: number): Promise<Fx> {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  const tmpDir = mkdtempSync(join(tmpdir(), 'fb-perf-ws-'))
  const userSettingStore = new UserSettingStore(join(tmpDir, 'user-setting.json'))
  await userSettingStore.load()
  const svc = new WorkspaceService({ db: fb, userSettingStore, defaultWorkspace: defaultWs })

  const wsIds: string[] = [defaultWs.id]
  for (let w = 1; w < workspaceCount; w++) {
    const ws = await svc.create({ name: `WS ${w}`, icon: '📦' })
    wsIds.push(ws.id)
  }
  const base = Date.now()
  for (const wsId of wsIds) {
    for (let t = 0; t < tabsPerWs; t++) {
      await pageStore.recordVisit({
        workspace_id: wsId,
        url: `https://ws-${wsId}.example/tab${t}`,
        title: `Tab ${t}`,
        content: `body ${t}`,
        visited_at: base + t * 1000
      })
    }
  }
  return { fb, svc, wsIds, cycleIdx: 0, tmpDir }
}

describe('KI-014 워크스페이스 전환 < 1초 (10 워크스페이스 × 10 탭)', () => {
  let fx: Fx
  beforeAll(async () => {
    fx = await setup(10, 10)
  })
  afterAll(() => {
    fx.fb.close()
    rmSync(fx.tmpDir, { recursive: true, force: true })
  })

  bench('WorkspaceService.setActive — round-robin', async () => {
    fx.cycleIdx = (fx.cycleIdx + 1) % fx.wsIds.length
    await fx.svc.setActive(fx.wsIds[fx.cycleIdx])
  })
})
