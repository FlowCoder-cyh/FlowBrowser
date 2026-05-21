/**
 * Sprint 016 M3 T15 (G-015) — buildTabWebPreferences 단위 회귀.
 *
 * cover:
 *   - 디폴트 (partition 미지정) — contextIsolation/nodeIntegration/sandbox 박힘, partition key 없음
 *   - partition 지정 — 같은 디폴트 + partition 박힘
 *   - undefined partition — partition key 누락 (Electron 디폴트 session)
 *   - 빈 문자열 partition — partition: '' 그대로 박힘 (caller 책임)
 *   - 옵션 object 미지정 — 디폴트와 동일
 */

import { describe, it, expect } from 'vitest'
import { buildTabWebPreferences } from '../../../src/main/tabViewWebPreferences'

describe('buildTabWebPreferences', () => {
  it('partition 미지정 시 디폴트 보안 옵션만 박힘 (partition key 누락)', () => {
    const pref = buildTabWebPreferences()
    expect(pref.contextIsolation).toBe(true)
    expect(pref.nodeIntegration).toBe(false)
    expect(pref.sandbox).toBe(true)
    expect('partition' in pref).toBe(false)
  })

  it('partition undefined 명시 시 partition key 자체 누락 (Electron 디폴트 session)', () => {
    const pref = buildTabWebPreferences({ partition: undefined })
    expect('partition' in pref).toBe(false)
    expect(pref.contextIsolation).toBe(true)
    expect(pref.nodeIntegration).toBe(false)
    expect(pref.sandbox).toBe(true)
  })

  it('partition 지정 시 webPreferences.partition 박힘 + 디폴트 보안 유지', () => {
    const pref = buildTabWebPreferences({ partition: 'persist:ws-abc' })
    expect(pref.partition).toBe('persist:ws-abc')
    expect(pref.contextIsolation).toBe(true)
    expect(pref.nodeIntegration).toBe(false)
    expect(pref.sandbox).toBe(true)
  })

  it('partition 빈 문자열은 그대로 박힘 (caller 책임 — 보통 발생 X)', () => {
    // 본 helper 는 검증 책임 없음 — invalid workspaceId 거부는 WorkspacePartitionManager 단위.
    // helper 자체는 conditional spread 로 빈 문자열도 받아들임. caller 가 getWorkspacePartitionName 결과를
    // 그대로 전달하는 정상 흐름에선 빈 문자열 발생 X (undefined 또는 'persist:ws-...').
    const pref = buildTabWebPreferences({ partition: '' })
    expect(pref.partition).toBe('')
  })

  it('다른 워크스페이스 partition 은 다른 partition 값 (격리 invariant — caller 책임 검증)', () => {
    const prefA = buildTabWebPreferences({ partition: 'persist:ws-a' })
    const prefB = buildTabWebPreferences({ partition: 'persist:ws-b' })
    expect(prefA.partition).not.toBe(prefB.partition)
  })

  it('보안 옵션 3종이 모든 호출에서 일관 (격리 정책 차이 없음, partition 만 ws 별 분리)', () => {
    const prefDefault = buildTabWebPreferences()
    const prefWithPartition = buildTabWebPreferences({ partition: 'persist:ws-x' })
    expect(prefDefault.contextIsolation).toBe(prefWithPartition.contextIsolation)
    expect(prefDefault.nodeIntegration).toBe(prefWithPartition.nodeIntegration)
    expect(prefDefault.sandbox).toBe(prefWithPartition.sandbox)
  })

  it('새 객체 반환 (caller 가 결과 mutate 해도 다음 호출 영향 0)', () => {
    const pref1 = buildTabWebPreferences({ partition: 'persist:ws-mut' })
    pref1.partition = 'CHANGED'
    const pref2 = buildTabWebPreferences({ partition: 'persist:ws-mut' })
    expect(pref2.partition).toBe('persist:ws-mut')
  })
})
