/**
 * Sprint 015 M5-1 — buildAcceleratorFromEvent 단위 테스트.
 * ShortcutPanel "단축키 변경" KeyboardEvent → Electron Accelerator 변환.
 */
import { describe, it, expect } from 'vitest'
import {
  buildAcceleratorFromEvent,
  normalizeKeyName
} from '../../../src/renderer/src/settings/acceleratorFromEvent'

function build(overrides: Partial<{ key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }>): {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
} {
  return {
    key: overrides.key ?? 'a',
    ctrlKey: overrides.ctrl ?? false,
    metaKey: overrides.meta ?? false,
    altKey: overrides.alt ?? false,
    shiftKey: overrides.shift ?? false
  }
}

describe('buildAcceleratorFromEvent', () => {
  it('Ctrl+K combo', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'k', ctrl: true }))).toBe('Control+K')
  })

  it('Cmd+K on mac (metaKey)', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'k', meta: true }))).toBe('Command+K')
  })

  it('Cmd+Shift+K', () => {
    // KeyboardEvent.key 는 shift 적용된 표기로 옴 — 대문자 K
    expect(
      buildAcceleratorFromEvent(build({ key: 'K', meta: true, shift: true }))
    ).toBe('Command+Shift+K')
  })

  it('Ctrl+Alt+J', () => {
    expect(
      buildAcceleratorFromEvent(build({ key: 'j', ctrl: true, alt: true }))
    ).toBe('Control+Alt+J')
  })

  it('modifier 없는 단일 알파벳 → null (오작동 방지)', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'k' }))).toBeNull()
  })

  it('modifier 없는 F-key 는 허용', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'F1' }))).toBe('F1')
    expect(buildAcceleratorFromEvent(build({ key: 'F12' }))).toBe('F12')
  })

  it('F-key + modifier 도 허용', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'F5', ctrl: true }))).toBe('Control+F5')
  })

  it('modifier-only 키 입력 → null (조합 완성 대기)', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'Control' }))).toBeNull()
    expect(buildAcceleratorFromEvent(build({ key: 'Meta' }))).toBeNull()
    expect(buildAcceleratorFromEvent(build({ key: 'Alt' }))).toBeNull()
    expect(buildAcceleratorFromEvent(build({ key: 'Shift' }))).toBeNull()
  })

  it('Escape 는 null (취소용으로 예약)', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'Escape' }))).toBeNull()
    expect(buildAcceleratorFromEvent(build({ key: 'Escape', ctrl: true }))).toBeNull()
  })

  it('알 수 없는 key → null', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'Dead', ctrl: true }))).toBeNull()
  })

  it('Arrow key 매핑', () => {
    expect(buildAcceleratorFromEvent(build({ key: 'ArrowUp', ctrl: true }))).toBe('Control+Up')
    expect(buildAcceleratorFromEvent(build({ key: 'ArrowDown', ctrl: true }))).toBe('Control+Down')
  })

  it('숫자 키 + modifier', () => {
    expect(buildAcceleratorFromEvent(build({ key: '7', ctrl: true, shift: true }))).toBe(
      'Control+Shift+7'
    )
  })
})

describe('normalizeKeyName', () => {
  it('영문 소문자 → 대문자', () => {
    expect(normalizeKeyName('k')).toBe('K')
    expect(normalizeKeyName('z')).toBe('Z')
  })

  it('영문 대문자 → 그대로', () => {
    expect(normalizeKeyName('K')).toBe('K')
  })

  it('숫자 → 그대로', () => {
    expect(normalizeKeyName('5')).toBe('5')
  })

  it('F-key 정규화', () => {
    expect(normalizeKeyName('F5')).toBe('F5')
    expect(normalizeKeyName('f12')).toBe('F12')
  })

  it('special key 매핑', () => {
    expect(normalizeKeyName('Enter')).toBe('Enter')
    expect(normalizeKeyName('Tab')).toBe('Tab')
    expect(normalizeKeyName(' ')).toBe('Space')
    expect(normalizeKeyName('Space')).toBe('Space')
    expect(normalizeKeyName('Backspace')).toBe('Backspace')
  })

  it('Escape 는 null (binding 불가)', () => {
    expect(normalizeKeyName('Escape')).toBeNull()
  })

  it('알 수 없는 key → null', () => {
    expect(normalizeKeyName('Dead')).toBeNull()
    expect(normalizeKeyName('@@')).toBeNull()
  })
})
