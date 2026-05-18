/**
 * Sprint 015 M5-1 — ShortcutStore.
 * PRD §7.4.7 ShortcutSettings / §05 §5.3.1 `shortcut:get-bindings` / `shortcut:set-binding` IPC.
 *
 * JSON 영속. 사용자 설정 가능한 단축키 binding map.
 * Phase 1 Binding ID 는 `searchBar.focus` 1개 (M5-1). 추후 M5 후속 + M6 에서 추가.
 *
 * Accelerator 표기는 Electron `globalShortcut` / Menu accelerator 표준 — 예: 'CommandOrControl+K'.
 * 본 Store 는 표기를 검증 (key 1개 + 0~N modifier) + 다른 binding 과 중복 거부.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 시스템에서 사용되는 binding ID 목록.
 * Phase 1: `searchBar.focus` 1개. M5/M6 진입 시 확장.
 */
export const SHORTCUT_BINDING_IDS = ['searchBar.focus'] as const
export type ShortcutBindingId = (typeof SHORTCUT_BINDING_IDS)[number]

/** Electron Accelerator 표준 — 'CommandOrControl' / 'Cmd' / 'Ctrl' / 'Alt' / 'Shift' + KeyCode */
export interface ShortcutBinding {
  id: ShortcutBindingId
  accelerator: string
}

interface PersistedShortcutState {
  bindings: ShortcutBinding[]
}

const DEFAULT_BINDINGS: Record<ShortcutBindingId, string> = {
  'searchBar.focus': 'CommandOrControl+K'
}

/**
 * 본 시스템이 허용하는 Electron Accelerator modifier 집합.
 * `AltGr` / `Super` / `Meta` 같은 비표준 modifier 는 ShortcutMatcher 가 안정적으로 처리하지 못해
 * (예: 비-mac platform 에서 Super 키 누름 자체를 거부) 일관성을 위해 본 화이트리스트에서 제거.
 * PRD §7.4.3 디폴트 `CommandOrControl+K` 와 사용자 변경 권장 (`Cmd+Shift+K` 등) 모두 본 집합으로 충분.
 */
const MODIFIER_TOKENS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'Shift'
])

/**
 * accelerator 문자열을 검증한다.
 * - `+` 로 분리한 segment 1+ 개
 * - 마지막 segment 는 key (한 글자 또는 'F1~F24' / 'Esc' / 'Enter' / 'Space' 등)
 * - 그 외 segment 는 modifier 집합
 * - 빈 문자열 / 중복 modifier / key 누락 거부
 *
 * 본 검증은 Electron Accelerator 의 모든 key 명을 망라하지 않는다 — 일반 key + 함수 key + 대표 special key 만.
 * Electron 이 Accelerator 를 거부하면 SettingsPage 에서 사용자에게 재입력 안내.
 */
const VALID_SPECIAL_KEYS = new Set([
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'PrintScreen'
])

export function isValidAccelerator(value: string): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  const segments = trimmed.split('+')
  if (segments.length === 0) return false
  const key = segments[segments.length - 1]
  const modifiers = segments.slice(0, -1)
  if (key.length === 0) return false
  // key validation: 한 글자 (a-z / 0-9) 또는 F1~F24 또는 특수 key
  const keyOk =
    /^[A-Za-z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || VALID_SPECIAL_KEYS.has(key)
  if (!keyOk) return false
  // modifier validation: 모두 알려진 modifier, 중복 없음
  const seen = new Set<string>()
  for (const m of modifiers) {
    if (!MODIFIER_TOKENS.has(m)) return false
    if (seen.has(m)) return false
    seen.add(m)
  }
  return true
}

/**
 * 두 accelerator 가 동일한 단축키를 표현하는지 비교한다.
 * 'CommandOrControl' 과 'CmdOrCtrl' 같은 alias 는 정규화 후 비교.
 * modifier 순서는 무관.
 */
function canonicalAccelerator(accelerator: string): string {
  const segments = accelerator.trim().split('+')
  const key = segments[segments.length - 1].toUpperCase()
  const modifiers = segments.slice(0, -1).map((m) => {
    if (m === 'Cmd') return 'Command'
    if (m === 'Ctrl') return 'Control'
    if (m === 'CmdOrCtrl') return 'CommandOrControl'
    if (m === 'Option') return 'Alt'
    return m
  })
  return [...modifiers.sort(), key].join('+')
}

export function acceleratorsEqual(a: string, b: string): boolean {
  return canonicalAccelerator(a) === canonicalAccelerator(b)
}

function isBindingId(value: unknown): value is ShortcutBindingId {
  return (
    typeof value === 'string' && (SHORTCUT_BINDING_IDS as readonly string[]).includes(value)
  )
}

function buildDefaultBindings(): ShortcutBinding[] {
  return SHORTCUT_BINDING_IDS.map((id) => ({ id, accelerator: DEFAULT_BINDINGS[id] }))
}

function normalizeBindings(input: unknown): ShortcutBinding[] {
  const defaults = buildDefaultBindings()
  if (!Array.isArray(input)) return defaults
  const byId = new Map(defaults.map((b) => [b.id, b.accelerator]))
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (!isBindingId(r.id)) continue
    if (typeof r.accelerator !== 'string') continue
    const accelerator = r.accelerator.trim()
    if (!isValidAccelerator(accelerator)) continue
    byId.set(r.id, accelerator)
  }
  return SHORTCUT_BINDING_IDS.map((id) => ({ id, accelerator: byId.get(id) ?? DEFAULT_BINDINGS[id] }))
}

export class ShortcutStore {
  private bindings: ShortcutBinding[] = buildDefaultBindings()
  private loaded = false

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<PersistedShortcutState>
      this.bindings = normalizeBindings(parsed.bindings)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.bindings = buildDefaultBindings()
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  getBindings(): ShortcutBinding[] {
    this.ensureLoaded()
    return this.bindings.map((b) => ({ ...b }))
  }

  getBinding(id: ShortcutBindingId): ShortcutBinding | null {
    this.ensureLoaded()
    const found = this.bindings.find((b) => b.id === id)
    return found ? { ...found } : null
  }

  /**
   * 단일 binding 갱신. 다른 binding 과 동일 accelerator 면 conflict 로 거부.
   * conflict 발생 시 호출자는 `ShortcutConflictError` 처리 후 사용자에게 안내.
   */
  async setBinding(id: ShortcutBindingId, accelerator: string): Promise<ShortcutBinding> {
    this.ensureLoaded()
    if (!isBindingId(id)) {
      throw new Error(`unknown binding id: ${String(id)}`)
    }
    const trimmed = accelerator.trim()
    if (!isValidAccelerator(trimmed)) {
      throw new Error(`invalid accelerator: ${accelerator}`)
    }
    for (const other of this.bindings) {
      if (other.id === id) continue
      if (acceleratorsEqual(other.accelerator, trimmed)) {
        throw new ShortcutConflictError(other.id, trimmed)
      }
    }
    this.bindings = this.bindings.map((b) => (b.id === id ? { id, accelerator: trimmed } : b))
    await this.persist()
    return { id, accelerator: trimmed }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload: PersistedShortcutState = { bindings: this.bindings }
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('ShortcutStore.load() not called')
    }
  }
}

export class ShortcutConflictError extends Error {
  constructor(
    public readonly conflictsWith: ShortcutBindingId,
    public readonly accelerator: string
  ) {
    super(`accelerator ${accelerator} already bound to ${conflictsWith}`)
    this.name = 'ShortcutConflictError'
  }
}

export function defaultShortcutPath(userDataDir: string): string {
  return join(userDataDir, 'shortcut-bindings.json')
}
