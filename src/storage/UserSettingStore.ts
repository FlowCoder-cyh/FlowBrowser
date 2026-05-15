/**
 * Sprint 006 M2 — UserSettingStore.
 * PRD §12.1 UserSetting의 코드 측 1:1 구현 (Sprint 006에서는 translationMode 우선).
 *
 * JSON 영속. 콘텐츠 아님 → G-005 적용 외.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export type TranslationMode = 'panel' | 'replace' | 'overlay'

export interface UserSettingState {
  translationMode: TranslationMode
  // PRD §12.1의 나머지 필드는 추후 Sprint에서 점진 추가.
}

const DEFAULTS: UserSettingState = {
  translationMode: 'panel'
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
          mode === 'panel' || mode === 'replace' || mode === 'overlay' ? mode : 'panel'
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
    if (patch.translationMode) {
      const m = patch.translationMode
      if (m !== 'panel' && m !== 'replace' && m !== 'overlay') {
        throw new Error(`invalid translationMode: ${m}`)
      }
      this.state.translationMode = m
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
