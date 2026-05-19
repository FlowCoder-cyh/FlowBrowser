/**
 * Sprint 006 M2 / S006-T05 — UserSettingStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'

describe('UserSettingStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `us-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('throws before load()', async () => {
    const store = new UserSettingStore(path)
    expect(() => store.getState()).toThrow('UserSettingStore.load() not called')
  })

  it('returns default panel mode when file missing', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    expect(store.getState().translationMode).toBe('panel')
  })

  it('update persists to disk', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    const updated = await store.update({ translationMode: 'replace' })
    expect(updated.translationMode).toBe('replace')

    const reloaded = new UserSettingStore(path)
    await reloaded.load()
    expect(reloaded.getState().translationMode).toBe('replace')
  })

  it('throws on invalid translationMode', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    await expect(
      // @ts-expect-error invalid value test
      store.update({ translationMode: 'bogus' })
    ).rejects.toThrow('invalid translationMode')
  })

  it('falls back to panel when disk file has unknown mode', async () => {
    await fs.writeFile(path, JSON.stringify({ translationMode: 'mystery' }))
    const store = new UserSettingStore(path)
    await store.load()
    expect(store.getState().translationMode).toBe('panel')
  })

  it('accepts overlay and panel and replace', async () => {
    const store = new UserSettingStore(path)
    await store.load()
    for (const m of ['overlay', 'panel', 'replace'] as const) {
      const s = await store.update({ translationMode: m })
      expect(s.translationMode).toBe(m)
    }
  })

  // Sprint 007 M1 — UserSetting 잔여 4 필드
  describe('extended fields (Sprint 007 M1)', () => {
    it('default values for new fields when file missing', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = store.getState()
      expect(s.defaultLanguage).toBe('ko')
      expect(s.sourceLanguage).toBe('auto')
      expect(s.defaultProviderId).toBe('openai')
      expect(s.privacyFilterEnabled).toBe(true)
    })

    it('update persists all 4 new fields', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = await store.update({
        defaultLanguage: 'ja',
        sourceLanguage: 'en',
        defaultProviderId: 'codex',
        privacyFilterEnabled: false
      })
      expect(s.defaultLanguage).toBe('ja')
      expect(s.sourceLanguage).toBe('en')
      expect(s.defaultProviderId).toBe('codex')
      expect(s.privacyFilterEnabled).toBe(false)

      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().defaultLanguage).toBe('ja')
      expect(reloaded.getState().privacyFilterEnabled).toBe(false)
    })

    it('rejects empty string for language / provider fields', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(store.update({ defaultLanguage: '' })).rejects.toThrow('invalid defaultLanguage')
      await expect(store.update({ sourceLanguage: '   ' })).rejects.toThrow('invalid sourceLanguage')
      await expect(store.update({ defaultProviderId: '' })).rejects.toThrow(
        'invalid defaultProviderId'
      )
    })

    it('rejects non-boolean privacyFilterEnabled', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ privacyFilterEnabled: 'yes' })
      ).rejects.toThrow('invalid privacyFilterEnabled')
    })

    it('disk fallback when new fields missing or wrong types', async () => {
      await fs.writeFile(
        path,
        JSON.stringify({
          translationMode: 'replace',
          defaultLanguage: '   ', // whitespace → fallback
          // sourceLanguage 누락 → fallback
          defaultProviderId: 42, // wrong type → fallback
          privacyFilterEnabled: 'true' // wrong type → fallback
        })
      )
      const store = new UserSettingStore(path)
      await store.load()
      const s = store.getState()
      expect(s.translationMode).toBe('replace')
      expect(s.defaultLanguage).toBe('ko') // 기본값 fallback
      expect(s.sourceLanguage).toBe('auto')
      expect(s.defaultProviderId).toBe('openai')
      expect(s.privacyFilterEnabled).toBe(true)
    })

    it('partial update preserves other fields', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await store.update({ defaultLanguage: 'ja' })
      await store.update({ privacyFilterEnabled: false })
      const s = store.getState()
      expect(s.defaultLanguage).toBe('ja')
      expect(s.privacyFilterEnabled).toBe(false)
      expect(s.sourceLanguage).toBe('auto') // 변경 없음
      expect(s.translationMode).toBe('panel') // 변경 없음
    })
  })

  // Sprint 014 M3 — onboardingShown
  describe('onboardingShown (Sprint 014 M3)', () => {
    it('기본값 false', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().onboardingShown).toBe(false)
    })

    it('update + persist', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = await store.update({ onboardingShown: true })
      expect(s.onboardingShown).toBe(true)
      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().onboardingShown).toBe(true)
    })

    it('비-boolean 값 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ onboardingShown: 'yes' })
      ).rejects.toThrow('invalid onboardingShown')
    })

    it('기존 파일에 onboardingShown 누락 → false fallback', async () => {
      await fs.writeFile(
        path,
        JSON.stringify({ translationMode: 'panel' }) // 옛 형식
      )
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().onboardingShown).toBe(false)
    })
  })

  // Sprint 010 M3 — cancelOnTabSwitch
  describe('cancelOnTabSwitch (Sprint 010 M3)', () => {
    it('기본값 false', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().cancelOnTabSwitch).toBe(false)
    })

    it('update + persist', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = await store.update({ cancelOnTabSwitch: true })
      expect(s.cancelOnTabSwitch).toBe(true)

      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().cancelOnTabSwitch).toBe(true)
    })

    it('비-boolean 값 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ cancelOnTabSwitch: 'yes' })
      ).rejects.toThrow('invalid cancelOnTabSwitch')
    })
  })

  // Sprint 015 M2-1 — v04Enabled (feature flag `flowbrowser.v04.enabled`)
  describe('v04Enabled (Sprint 015 M2-1)', () => {
    it('기본값 false (Phase 1 마이그레이션 안전)', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().v04Enabled).toBe(false)
    })

    it('update + persist', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = await store.update({ v04Enabled: true })
      expect(s.v04Enabled).toBe(true)

      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().v04Enabled).toBe(true)
    })

    it('비-boolean 값 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ v04Enabled: 'yes' })
      ).rejects.toThrow('invalid v04Enabled')
    })

    it('기존 파일에 v04Enabled 누락 → false fallback', async () => {
      await fs.writeFile(
        path,
        JSON.stringify({ translationMode: 'panel' }) // 옛 형식
      )
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().v04Enabled).toBe(false)
    })
  })

  // Sprint 015 M4-4 — privacyExclusions (IndexingGate 사용자 추가/제외 패턴)
  describe('privacyExclusions (Sprint 015 M4-4)', () => {
    it('기본값 빈 배열', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().privacyExclusions).toEqual([])
    })

    it('update + persist', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const s = await store.update({
        privacyExclusions: [
          { pattern: '*.example.com', type: 'block' },
          { pattern: 'gmail.com', type: 'allow' }
        ]
      })
      expect(s.privacyExclusions).toHaveLength(2)

      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().privacyExclusions).toEqual([
        { pattern: '*.example.com', type: 'block' },
        { pattern: 'gmail.com', type: 'allow' }
      ])
    })

    it('비-array 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ privacyExclusions: 'bogus' })
      ).rejects.toThrow('invalid privacyExclusions')
    })

    it('잘못된 entry 거부 (pattern 빈 문자열 / type 잘못된 값)', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        store.update({ privacyExclusions: [{ pattern: '', type: 'block' }] })
      ).rejects.toThrow('invalid privacyExclusions entry')
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ privacyExclusions: [{ pattern: 'x.com', type: 'bogus' }] })
      ).rejects.toThrow('invalid privacyExclusions entry')
    })

    it('디스크 파일의 잘못된 entry 무시 + 중복 제거', async () => {
      await fs.writeFile(
        path,
        JSON.stringify({
          translationMode: 'panel',
          privacyExclusions: [
            { pattern: 'a.com', type: 'block' },
            { pattern: 'a.com', type: 'block' }, // 중복
            { pattern: '', type: 'allow' }, // 빈 pattern
            { pattern: 'b.com', type: 'unknown' }, // 잘못된 type
            'invalid', // 잘못된 entry
            { pattern: 'c.com', type: 'allow' }
          ]
        })
      )
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().privacyExclusions).toEqual([
        { pattern: 'a.com', type: 'block' },
        { pattern: 'c.com', type: 'allow' }
      ])
    })

    it('getState 반환값 변경이 내부 state 에 영향 없음 (deep copy)', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await store.update({ privacyExclusions: [{ pattern: 'x.com', type: 'block' }] })
      const s = store.getState()
      s.privacyExclusions.push({ pattern: 'y.com', type: 'block' })
      expect(store.getState().privacyExclusions).toHaveLength(1)
    })

    it('기존 파일에 privacyExclusions 누락 → 빈 배열 fallback', async () => {
      await fs.writeFile(path, JSON.stringify({ translationMode: 'panel' }))
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().privacyExclusions).toEqual([])
    })
  })

  // Sprint 015 M6 T28 — activeWorkspaceId (WorkspaceService 영속)
  describe('activeWorkspaceId (Sprint 015 M6 T28)', () => {
    it('기본값 null (services.ts bootstrap 가 fresh install 시 default UUID 주입)', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().activeWorkspaceId).toBeNull()
    })

    it('update + persist UUID 문자열', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      const fakeUuid = '11111111-2222-3333-4444-555555555555'
      const s = await store.update({ activeWorkspaceId: fakeUuid })
      expect(s.activeWorkspaceId).toBe(fakeUuid)

      const reloaded = new UserSettingStore(path)
      await reloaded.load()
      expect(reloaded.getState().activeWorkspaceId).toBe(fakeUuid)
    })

    it('update null 도 허용 (워크스페이스 0 상태 신호)', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await store.update({ activeWorkspaceId: 'x' })
      const s = await store.update({ activeWorkspaceId: null })
      expect(s.activeWorkspaceId).toBeNull()
    })

    it('빈 문자열 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(store.update({ activeWorkspaceId: '' })).rejects.toThrow(
        'invalid activeWorkspaceId'
      )
    })

    it('비-string/비-null 거부', async () => {
      const store = new UserSettingStore(path)
      await store.load()
      await expect(
        // @ts-expect-error invalid type for test
        store.update({ activeWorkspaceId: 123 })
      ).rejects.toThrow('invalid activeWorkspaceId')
    })

    it('기존 파일에 activeWorkspaceId 누락 → null fallback', async () => {
      await fs.writeFile(path, JSON.stringify({ translationMode: 'panel' }))
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().activeWorkspaceId).toBeNull()
    })

    it('디스크 파일의 빈 문자열 → null fallback', async () => {
      await fs.writeFile(
        path,
        JSON.stringify({ translationMode: 'panel', activeWorkspaceId: '' })
      )
      const store = new UserSettingStore(path)
      await store.load()
      expect(store.getState().activeWorkspaceId).toBeNull()
    })
  })
})
