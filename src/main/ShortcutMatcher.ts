/**
 * Sprint 015 M5-1 — ShortcutMatcher.
 * PRD §7.4.3 — Main 프로세스 글로벌 캡처. WebContentsView 내부 `before-input-event` 입력을
 * accelerator 문자열과 매칭. 매칭 시 main 이 가로채 SearchBar 포커스 IPC 전달.
 *
 * Electron Accelerator 표기 → modifier flag 4종 (cmd / ctrl / alt / shift) + key 로 정규화 후 비교.
 * - `CommandOrControl` / `CmdOrCtrl` 은 mac → cmd / 그 외 → ctrl 로 분기
 * - `Command` / `Cmd` → mac 의 meta 키 (Cmd)
 * - `Control` / `Ctrl` → ctrl 키
 * - `Alt` / `Option` → alt 키
 * - `Shift` → shift 키
 */

import type { Input } from 'electron'

interface NormalizedAccelerator {
  key: string
  cmd: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** accelerator 문자열을 modifier flag + 정규화 key 로 분해. */
export function normalizeAccelerator(
  accelerator: string,
  platform: NodeJS.Platform
): NormalizedAccelerator {
  const segments = accelerator.trim().split('+')
  const keyToken = segments[segments.length - 1]
  let cmd = false
  let ctrl = false
  let alt = false
  let shift = false
  for (const seg of segments.slice(0, -1)) {
    switch (seg) {
      case 'Cmd':
      case 'Command':
      case 'Meta':
      case 'Super':
        cmd = true
        break
      case 'Ctrl':
      case 'Control':
        ctrl = true
        break
      case 'CmdOrCtrl':
      case 'CommandOrControl':
        if (platform === 'darwin') cmd = true
        else ctrl = true
        break
      case 'Alt':
      case 'Option':
        alt = true
        break
      case 'Shift':
        shift = true
        break
      // 그 외 modifier 는 무시 (isValidAccelerator 가 표준 modifier 만 허용함)
    }
  }
  return { key: normalizeKeyToken(keyToken), cmd, ctrl, alt, shift }
}

/** Electron Accelerator key → DOM KeyboardEvent.key 표기로 매핑. */
function normalizeKeyToken(token: string): string {
  // 한 글자 (a-z / 0-9) 는 대문자로 정규화
  if (/^[A-Za-z0-9]$/.test(token)) return token.toUpperCase()
  // F1~F24 는 그대로
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) return token
  // 특수 key alias
  switch (token) {
    case 'Esc':
    case 'Escape':
      return 'ESCAPE'
    case 'Return':
    case 'Enter':
      return 'ENTER'
    case 'Space':
      return ' '
    case 'Plus':
      return '+'
    case 'PageUp':
      return 'PAGEUP'
    case 'PageDown':
      return 'PAGEDOWN'
    default:
      return token.toUpperCase()
  }
}

/** Electron Input.key → 정규화 key. */
function normalizeInputKey(rawKey: string): string {
  const upper = rawKey.toUpperCase()
  if (upper === 'ESCAPE') return 'ESCAPE'
  if (upper === 'ENTER') return 'ENTER'
  if (upper === 'PAGEUP') return 'PAGEUP'
  if (upper === 'PAGEDOWN') return 'PAGEDOWN'
  return upper
}

/**
 * Electron `Input` 이 주어진 accelerator 와 매칭하는지 검사.
 *
 * 매칭 규칙:
 * - `input.type === 'keyDown'` 만 처리
 * - cmd / ctrl / alt / shift modifier 상태가 정확히 일치해야 함 (잉여 modifier 거부)
 * - key 비교는 정규화된 표기 (대문자) 로 동등성
 *
 * 주의: mac 외 platform 에서 `input.meta` 는 Windows 키 / Super 키. 본 시스템은 표준 accelerator (Cmd/Ctrl/Alt/Shift) 만 사용하므로 meta 키 별도 처리는 안 함 — 비-mac 사용자가 Super+K 같은 비표준 단축키를 설정하면 매칭 안 됨 (Accelerator 검증 단계에서 막힘).
 */
export function inputMatchesAccelerator(
  input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'shift' | 'alt'>,
  accelerator: string,
  platform: NodeJS.Platform
): boolean {
  if (input.type !== 'keyDown') return false
  const wanted = normalizeAccelerator(accelerator, platform)
  // 실제 modifier 상태 — mac 에서 meta = Cmd, 그 외 platform 에서 meta = Windows/Super 키
  const actualCmd = platform === 'darwin' ? input.meta : false
  const actualCtrl = input.control
  // mac 외 platform 에서 meta 키는 binding 에 사용되지 않는다 — 누르고 있으면 매칭 거부
  if (platform !== 'darwin' && input.meta) return false
  if (wanted.cmd !== actualCmd) return false
  if (wanted.ctrl !== actualCtrl) return false
  if (wanted.alt !== input.alt) return false
  if (wanted.shift !== input.shift) return false
  const actualKey = normalizeInputKey(input.key)
  return actualKey === wanted.key
}
