/**
 * Sprint 006 M2 — UserSettingStore.
 * PRD §12.1 UserSetting의 코드 측 1:1 구현 (Sprint 006에서는 translationMode 우선).
 *
 * JSON 영속. 콘텐츠 아님 → G-005 적용 외.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export type TranslationMode = 'panel' | 'replace' | 'overlay'

/**
 * Sprint 007 M1 — PRD §12.1 잔여 필드 확장.
 * subtitleMode / ttsEnabled / syncMode 등 Phase 2~4 필드는 해당 Phase 진입 시 추가.
 */
export interface UserSettingState {
  translationMode: TranslationMode
  defaultLanguage: string
  sourceLanguage: string
  defaultProviderId: string
  privacyFilterEnabled: boolean
  /** Sprint 010 M3 — 탭 전환 시 진행 중 paragraphs/page 작업 자동 abort. 기본 false (호환). */
  cancelOnTabSwitch: boolean
  /** Sprint 014 M3 — 첫 실행 OnboardingTour 표시 여부. 한 번이라도 닫으면 true (영속). */
  onboardingShown: boolean
}

const DEFAULTS: UserSettingState = {
  translationMode: 'panel',
  defaultLanguage: 'ko',
  sourceLanguage: 'auto',
  defaultProviderId: 'openai',
  privacyFilterEnabled: true,
  cancelOnTabSwitch: false,
  onboardingShown: false
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export class UserSettingStore {
  private state: UserSettingState = { ...DEFAULTS }
  private loaded = false

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<UserSettingState>
      const mode = parsed.translationMode
      this.state = {
        translationMode:
          mode === 'panel' || mode === 'replace' || mode === 'overlay' ? mode : 'panel',
        defaultLanguage: isNonEmptyString(parsed.defaultLanguage)
          ? parsed.defaultLanguage.trim()
          : DEFAULTS.defaultLanguage,
        sourceLanguage: isNonEmptyString(parsed.sourceLanguage)
          ? parsed.sourceLanguage.trim()
          : DEFAULTS.sourceLanguage,
        defaultProviderId: isNonEmptyString(parsed.defaultProviderId)
          ? parsed.defaultProviderId.trim()
          : DEFAULTS.defaultProviderId,
        privacyFilterEnabled:
          typeof parsed.privacyFilterEnabled === 'boolean'
            ? parsed.privacyFilterEnabled
            : DEFAULTS.privacyFilterEnabled,
        cancelOnTabSwitch:
          typeof parsed.cancelOnTabSwitch === 'boolean'
            ? parsed.cancelOnTabSwitch
            : DEFAULTS.cancelOnTabSwitch,
        onboardingShown:
          typeof parsed.onboardingShown === 'boolean'
            ? parsed.onboardingShown
            : DEFAULTS.onboardingShown
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.state = { ...DEFAULTS }
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  getState(): UserSettingState {
    this.ensureLoaded()
    return { ...this.state }
  }

  async update(patch: Partial<UserSettingState>): Promise<UserSettingState> {
    this.ensureLoaded()
    if (patch.translationMode !== undefined) {
      const m = patch.translationMode
      if (m !== 'panel' && m !== 'replace' && m !== 'overlay') {
        throw new Error(`invalid translationMode: ${m}`)
      }
      this.state.translationMode = m
    }
    if (patch.defaultLanguage !== undefined) {
      if (!isNonEmptyString(patch.defaultLanguage)) {
        throw new Error('invalid defaultLanguage')
      }
      this.state.defaultLanguage = patch.defaultLanguage.trim()
    }
    if (patch.sourceLanguage !== undefined) {
      if (!isNonEmptyString(patch.sourceLanguage)) {
        throw new Error('invalid sourceLanguage')
      }
      this.state.sourceLanguage = patch.sourceLanguage.trim()
    }
    if (patch.defaultProviderId !== undefined) {
      if (!isNonEmptyString(patch.defaultProviderId)) {
        throw new Error('invalid defaultProviderId')
      }
      this.state.defaultProviderId = patch.defaultProviderId.trim()
    }
    if (patch.privacyFilterEnabled !== undefined) {
      if (typeof patch.privacyFilterEnabled !== 'boolean') {
        throw new Error('invalid privacyFilterEnabled')
      }
      this.state.privacyFilterEnabled = patch.privacyFilterEnabled
    }
    if (patch.cancelOnTabSwitch !== undefined) {
      if (typeof patch.cancelOnTabSwitch !== 'boolean') {
        throw new Error('invalid cancelOnTabSwitch')
      }
      this.state.cancelOnTabSwitch = patch.cancelOnTabSwitch
    }
    if (patch.onboardingShown !== undefined) {
      if (typeof patch.onboardingShown !== 'boolean') {
        throw new Error('invalid onboardingShown')
      }
      this.state.onboardingShown = patch.onboardingShown
    }
    await this.persist()
    return this.getState()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('UserSettingStore.load() not called')
    }
  }
}

export function defaultUserSettingPath(userDataDir: string): string {
  return join(userDataDir, 'user-setting.json')
}
