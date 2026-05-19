/**
 * Sprint 015 M6 T28 — WorkspaceService 단위 테스트.
 *
 * cover:
 *   - preset 12종 상수 정합
 *   - emoji 검증 (preset / 사용자 이모지 / 한글 거부 / 빈 문자열 거부 / 2자 거부)
 *   - name 검증 (1~50자, 공백만 거부)
 *   - level_preference 검증 (novice / intermediate / advanced / null)
 *   - create / list / setActive / getActiveId / update / delete
 *   - 마지막 1개 삭제 시 자동 "📥 기본" 재생성 (§11.5.5)
 *   - active 워크스페이스 삭제 시 자동 전환
 *   - 캐시 invalidation (mutation 후 list 재로드)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'
import {
  WorkspaceService,
  WORKSPACE_PRESET_ICONS,
  WorkspaceValidationError,
  validateWorkspaceIcon
} from '../../../src/main/WorkspaceService'

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
    `ws-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

describe('WorkspaceService', () => {
  let h: Harness

  beforeEach(async () => {
    h = await makeHarness()
  })

  afterEach(async () => {
    await cleanup(h)
  })

  it('exposes preset 12종 in PRD-defined order', () => {
    expect(WORKSPACE_PRESET_ICONS).toEqual([
      '📚',
      '💻',
      '🎯',
      '🏠',
      '🔬',
      '✍️',
      '🎨',
      '📊',
      '🌍',
      '⚖️',
      '💡',
      '🛒'
    ])
    expect(WORKSPACE_PRESET_ICONS.length).toBe(12)
  })

  it('list() returns default workspace after bootstrap', () => {
    const all = h.svc.list()
    expect(all.length).toBe(1)
    expect(all[0].name).toBe('기본')
    expect(all[0].icon).toBe('📥')
  })

  it('getActiveId() falls back to first workspace when UserSetting unset', () => {
    expect(h.svc.getActiveId()).toBe(h.defaultId)
  })

  it('create() persists with preset icon', async () => {
    const ws = await h.svc.create({ name: 'GraphQL 학습', icon: '💻', level_preference: 'novice' })
    expect(ws.name).toBe('GraphQL 학습')
    expect(ws.icon).toBe('💻')
    expect(ws.level_preference).toBe('novice')
    expect(h.svc.list().length).toBe(2)
  })

  it('create() accepts user emoji (non-preset)', async () => {
    const ws = await h.svc.create({ name: '게임', icon: '🎮' })
    expect(ws.icon).toBe('🎮')
  })

  it('create() rejects empty name', async () => {
    await expect(h.svc.create({ name: '   ', icon: '📚' })).rejects.toThrow(WorkspaceValidationError)
  })

  it('create() rejects name longer than 50 codepoints', async () => {
    const longName = 'a'.repeat(51)
    await expect(h.svc.create({ name: longName, icon: '📚' })).rejects.toThrow(
      WorkspaceValidationError
    )
  })

  it('create() rejects icon with multiple graphemes', async () => {
    await expect(h.svc.create({ name: 'X', icon: '📚📚' })).rejects.toThrow(
      WorkspaceValidationError
    )
  })

  it('create() rejects non-emoji icon (한글)', async () => {
    await expect(h.svc.create({ name: 'X', icon: '가' })).rejects.toThrow(WorkspaceValidationError)
  })

  it('create() rejects non-emoji icon (latin)', async () => {
    await expect(h.svc.create({ name: 'X', icon: 'A' })).rejects.toThrow(WorkspaceValidationError)
  })

  it('create() rejects invalid level_preference', async () => {
    await expect(
      h.svc.create({
        name: 'X',
        icon: '📚',
        level_preference: 'expert' as never
      })
    ).rejects.toThrow(WorkspaceValidationError)
  })

  it('setActive() persists to UserSetting + returns row', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const row = await h.svc.setActive(ws.id)
    expect(row.id).toBe(ws.id)
    expect(h.svc.getActiveId()).toBe(ws.id)
    expect(
      (h.userSetting.getState() as { activeWorkspaceId?: string }).activeWorkspaceId
    ).toBe(ws.id)
  })

  it('setActive() rejects unknown id', async () => {
    await expect(h.svc.setActive('not-real-uuid')).rejects.toThrow(WorkspaceValidationError)
  })

  it('getActiveId() prefers persisted active over first workspace', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    await h.svc.setActive(ws.id)
    // 새 인스턴스 시뮬레이션 — UserSetting 만 활용
    const svc2 = new WorkspaceService({
      db: h.db,
      userSettingStore: h.userSetting
    })
    expect(svc2.getActiveId()).toBe(ws.id)
  })

  it('update() patches name/icon/level_preference', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const updated = await h.svc.update({
      id: ws.id,
      patch: { name: 'B', icon: '💻', level_preference: 'advanced' }
    })
    expect(updated.name).toBe('B')
    expect(updated.icon).toBe('💻')
    expect(updated.level_preference).toBe('advanced')
  })

  it('update() throws no_change when patch is empty mutation', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    await expect(h.svc.update({ id: ws.id, patch: {} })).rejects.toThrow(WorkspaceValidationError)
  })

  it('update() throws not_found for unknown id', async () => {
    await expect(
      h.svc.update({ id: 'nope', patch: { name: 'X' } })
    ).rejects.toThrow(WorkspaceValidationError)
  })

  it('delete() removes workspace + cascade', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    const result = await h.svc.delete(ws.id)
    expect(result.deleted).toBe(true)
    expect(result.replacement).toBeUndefined()
    expect(h.svc.list().find((w) => w.id === ws.id)).toBeUndefined()
  })

  it('delete() last workspace triggers auto "📥 기본" recreation', async () => {
    const result = await h.svc.delete(h.defaultId)
    expect(result.deleted).toBe(true)
    expect(result.replacement).toBeDefined()
    expect(result.replacement!.name).toBe('기본')
    expect(result.replacement!.icon).toBe('📥')
    expect(h.svc.list().length).toBe(1)
    expect(result.newActiveId).toBe(result.replacement!.id)
  })

  it('delete() of active workspace auto-switches to remaining first', async () => {
    const ws = await h.svc.create({ name: 'A', icon: '📚' })
    await h.svc.setActive(ws.id)
    const result = await h.svc.delete(ws.id)
    expect(result.deleted).toBe(true)
    expect(result.newActiveId).toBe(h.defaultId)
    expect(h.svc.getActiveId()).toBe(h.defaultId)
  })

  it('delete() rejects unknown id', async () => {
    await expect(h.svc.delete('nope')).rejects.toThrow(WorkspaceValidationError)
  })

  it('cache invalidation: list reflects create immediately', async () => {
    expect(h.svc.list().length).toBe(1)
    await h.svc.create({ name: 'X', icon: '📚' })
    expect(h.svc.list().length).toBe(2)
  })
})

describe('validateWorkspaceIcon', () => {
  it('accepts all 12 presets', () => {
    for (const preset of WORKSPACE_PRESET_ICONS) {
      expect(validateWorkspaceIcon(preset)).toBe(preset)
    }
  })

  it('accepts variation-selector emoji (✍️)', () => {
    expect(validateWorkspaceIcon('✍️')).toBe('✍️')
  })

  it('accepts BMP emoji (☺)', () => {
    // BMP emoji codepoint 0x263A — misc symbols range
    expect(validateWorkspaceIcon('☺')).toBe('☺')
  })

  it('accepts custom SMP emoji (🎮)', () => {
    expect(validateWorkspaceIcon('🎮')).toBe('🎮')
  })

  it('accepts regional indicator pair (국기)', () => {
    // 🇰🇷 = 2 regional indicators → Intl.Segmenter groups as 1 grapheme cluster
    expect(validateWorkspaceIcon('🇰🇷')).toBe('🇰🇷')
  })

  it('rejects empty', () => {
    expect(() => validateWorkspaceIcon('')).toThrow(WorkspaceValidationError)
    expect(() => validateWorkspaceIcon('   ')).toThrow(WorkspaceValidationError)
  })

  it('rejects 2 grapheme clusters', () => {
    expect(() => validateWorkspaceIcon('📚💻')).toThrow(WorkspaceValidationError)
  })

  it('rejects 한글', () => {
    expect(() => validateWorkspaceIcon('가')).toThrow(WorkspaceValidationError)
  })

  it('rejects latin letter', () => {
    expect(() => validateWorkspaceIcon('A')).toThrow(WorkspaceValidationError)
  })

  it('rejects number', () => {
    expect(() => validateWorkspaceIcon('1')).toThrow(WorkspaceValidationError)
  })

  it('rejects non-string', () => {
    expect(() => validateWorkspaceIcon(123 as never)).toThrow(WorkspaceValidationError)
    expect(() => validateWorkspaceIcon(null as never)).toThrow(WorkspaceValidationError)
  })

  // 핫픽스 (codex NEEDS_CHANGES #2) — modifier-only 거부 / Extended_Pictographic 정밀 검증
  // 보이지 않는 문자는 파일 인코딩 안전성을 위해 String.fromCodePoint 로 명시.
  it('rejects standalone variation selector (FE0F)', () => {
    const vs = String.fromCodePoint(0xfe0f)
    expect(() => validateWorkspaceIcon(vs)).toThrow(WorkspaceValidationError)
  })

  it('rejects standalone ZWJ', () => {
    const zwj = String.fromCodePoint(0x200d)
    expect(() => validateWorkspaceIcon(zwj)).toThrow(WorkspaceValidationError)
  })

  it('rejects standalone skin tone modifier', () => {
    const skin = String.fromCodePoint(0x1f3fb)
    expect(() => validateWorkspaceIcon(skin)).toThrow(WorkspaceValidationError)
  })

  it('rejects keycap-only attempt (digit + FE0F + 20E3)', () => {
    // U+0031 (digit 1) base 가 emoji codepoint 아님 → 거부.
    // PRD §11.5.1 "preset 12종 또는 사용자 이모지 1자" — keycap 시퀀스는 모호하므로 거부 정책.
    const keycap =
      String.fromCodePoint(0x0031) + String.fromCodePoint(0xfe0f) + String.fromCodePoint(0x20e3)
    expect(() => validateWorkspaceIcon(keycap)).toThrow(WorkspaceValidationError)
  })

  it('accepts ZWJ family (👨‍👩‍👧)', () => {
    expect(validateWorkspaceIcon('👨‍👩‍👧')).toBe('👨‍👩‍👧')
  })

  it('accepts emoji with skin tone (👋🏻)', () => {
    expect(validateWorkspaceIcon('👋🏻')).toBe('👋🏻')
  })

  it('accepts emoji clock (⌚)', () => {
    expect(validateWorkspaceIcon('⌚')).toBe('⌚')
  })

  it('rejects misc technical non-emoji (⎈ U+2388)', () => {
    expect(() => validateWorkspaceIcon('⎈')).toThrow(WorkspaceValidationError)
  })
})
