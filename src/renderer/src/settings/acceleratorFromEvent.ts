/**
 * Sprint 015 M5-1 — KeyboardEvent → Electron Accelerator 변환.
 * ShortcutPanel 의 "단축키 변경" 동작에 사용. 본 함수는 main 의 ShortcutStore.setBinding
 * 검증을 우회하지 않는다 — 사용자 입력을 1차 정규화만.
 *
 * KeyboardEvent 의 `key` 는 modifier 가 눌린 상태에서 case-sensitive (Shift 적용됨).
 * 본 함수는 영숫자 1글자만 대문자 정규화하고, 특수 key (Escape / Enter / Tab / Arrow / F-keys) 는
 * Electron Accelerator 표기로 매핑한다.
 *
 * modifier-only 키 (Control / Meta / Alt / Shift) 가 들어오면 null — caller 는 조합 완성 대기.
 * Escape 는 null — UI 에서 "취소" 로 처리.
 */

export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function buildAcceleratorFromEvent(e: KeyEventLike): string | null {
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') {
    return null
  }
  const keyName = normalizeKeyName(e.key)
  if (!keyName) return null
  const modifiers: string[] = []
  if (e.ctrlKey) modifiers.push('Control')
  if (e.metaKey) modifiers.push('Command')
  if (e.altKey) modifiers.push('Alt')
  if (e.shiftKey) modifiers.push('Shift')
  // 단일 알파벳/숫자 키는 modifier 없이 등록 불가 (오작동 방지).
  // F-key 는 단독 binding 가능 (F1 같은 표준 단축키 사용 사례 존재).
  if (modifiers.length === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(keyName)) {
    return null
  }
  return [...modifiers, keyName].join('+')
}

export function normalizeKeyName(key: string): string | null {
  if (key.length === 1 && /^[a-zA-Z0-9]$/.test(key)) return key.toUpperCase()
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()
  switch (key) {
    case 'Escape':
      return null
    case 'Enter':
      return 'Enter'
    case 'Tab':
      return 'Tab'
    case ' ':
    case 'Space':
      return 'Space'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'PageUp':
      return 'PageUp'
    case 'PageDown':
      return 'PageDown'
    case 'Home':
      return 'Home'
    case 'End':
      return 'End'
    case 'Delete':
      return 'Delete'
    case 'Backspace':
      return 'Backspace'
    case 'Insert':
      return 'Insert'
    default:
      return null
  }
}
