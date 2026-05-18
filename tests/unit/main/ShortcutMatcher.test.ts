/**
 * Sprint 015 M5-1 — ShortcutMatcher 단위 테스트.
 * Electron Input 객체 → accelerator 매칭 verification.
 */
import { describe, it, expect } from 'vitest'
import type { Input } from 'electron'
import {
  inputMatchesAccelerator,
  normalizeAccelerator
} from '../../../src/main/ShortcutMatcher'

function buildInput(overrides: Partial<Input>): Input {
  return {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    modifiers: [],
    location: 0,
    ...overrides
  } as Input
}

describe('inputMatchesAccelerator', () => {
  describe('darwin (mac)', () => {
    it('matches Cmd+K when meta+k pressed', () => {
      const input = buildInput({ key: 'k', meta: true })
      expect(inputMatchesAccelerator(input, 'Cmd+K', 'darwin')).toBe(true)
    })

    it('matches CommandOrControl+K with meta on mac', () => {
      const input = buildInput({ key: 'k', meta: true })
      expect(inputMatchesAccelerator(input, 'CommandOrControl+K', 'darwin')).toBe(true)
    })

    it('does NOT match CommandOrControl+K with ctrl on mac', () => {
      const input = buildInput({ key: 'k', control: true })
      expect(inputMatchesAccelerator(input, 'CommandOrControl+K', 'darwin')).toBe(false)
    })

    it('matches uppercase K (shift+k case)', () => {
      const input = buildInput({ key: 'K', meta: true, shift: true })
      expect(inputMatchesAccelerator(input, 'Cmd+Shift+K', 'darwin')).toBe(true)
    })

    it('rejects extra modifier (cmd+shift+k against cmd+k)', () => {
      const input = buildInput({ key: 'k', meta: true, shift: true })
      expect(inputMatchesAccelerator(input, 'Cmd+K', 'darwin')).toBe(false)
    })
  })

  describe('win32 (windows)', () => {
    it('matches Ctrl+K when control+k pressed', () => {
      const input = buildInput({ key: 'k', control: true })
      expect(inputMatchesAccelerator(input, 'Ctrl+K', 'win32')).toBe(true)
    })

    it('matches CommandOrControl+K with ctrl on win32', () => {
      const input = buildInput({ key: 'k', control: true })
      expect(inputMatchesAccelerator(input, 'CommandOrControl+K', 'win32')).toBe(true)
    })

    it('does NOT match CommandOrControl+K with meta on win32', () => {
      const input = buildInput({ key: 'k', meta: true })
      expect(inputMatchesAccelerator(input, 'CommandOrControl+K', 'win32')).toBe(false)
    })

    it('rejects when only key pressed without modifier', () => {
      const input = buildInput({ key: 'k' })
      expect(inputMatchesAccelerator(input, 'Ctrl+K', 'win32')).toBe(false)
    })
  })

  describe('linux', () => {
    it('matches Ctrl+K with control', () => {
      const input = buildInput({ key: 'k', control: true })
      expect(inputMatchesAccelerator(input, 'Ctrl+K', 'linux')).toBe(true)
    })

    it('matches CommandOrControl+K with ctrl', () => {
      const input = buildInput({ key: 'k', control: true })
      expect(inputMatchesAccelerator(input, 'CommandOrControl+K', 'linux')).toBe(true)
    })
  })

  describe('special keys', () => {
    it('matches Escape key', () => {
      const input = buildInput({ key: 'Escape' })
      expect(inputMatchesAccelerator(input, 'Esc', 'win32')).toBe(true)
    })

    it('matches Enter key', () => {
      const input = buildInput({ key: 'Enter', control: true })
      expect(inputMatchesAccelerator(input, 'Ctrl+Enter', 'win32')).toBe(true)
    })

    it('matches F-keys', () => {
      const input = buildInput({ key: 'F12' })
      expect(inputMatchesAccelerator(input, 'F12', 'win32')).toBe(true)
    })
  })

  describe('keyUp is ignored', () => {
    it('rejects keyUp event', () => {
      const input = buildInput({ key: 'k', meta: true, type: 'keyUp' })
      expect(inputMatchesAccelerator(input, 'Cmd+K', 'darwin')).toBe(false)
    })
  })

  describe('case mismatch protection', () => {
    it('matches lowercase k against Cmd+K accelerator', () => {
      const input = buildInput({ key: 'k', meta: true })
      expect(inputMatchesAccelerator(input, 'Cmd+K', 'darwin')).toBe(true)
    })
  })
})

describe('normalizeAccelerator', () => {
  it('CommandOrControl on mac → cmd', () => {
    const result = normalizeAccelerator('CommandOrControl+K', 'darwin')
    expect(result.cmd).toBe(true)
    expect(result.ctrl).toBe(false)
    expect(result.key).toBe('K')
  })

  it('CommandOrControl on win32 → ctrl', () => {
    const result = normalizeAccelerator('CommandOrControl+K', 'win32')
    expect(result.cmd).toBe(false)
    expect(result.ctrl).toBe(true)
  })

  it('parses multiple modifiers', () => {
    const result = normalizeAccelerator('Ctrl+Shift+Alt+J', 'win32')
    expect(result.ctrl).toBe(true)
    expect(result.shift).toBe(true)
    expect(result.alt).toBe(true)
    expect(result.cmd).toBe(false)
    expect(result.key).toBe('J')
  })

  it('Option alias → alt', () => {
    const result = normalizeAccelerator('Option+K', 'darwin')
    expect(result.alt).toBe(true)
  })

  it('Esc alias → ESCAPE', () => {
    const result = normalizeAccelerator('Esc', 'win32')
    expect(result.key).toBe('ESCAPE')
  })
})
