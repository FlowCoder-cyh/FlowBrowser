/**
 * Sprint 015 M6 T28 — renderer workspace presets 단위 테스트.
 *
 * cover:
 *   - main WORKSPACE_PRESET_ICONS 와 renderer WORKSPACE_ICON_PRESETS 정합 (분리된 SSOT 동기 검증)
 *   - renderer isValidUserEmoji ↔ main validateWorkspaceIcon 정합
 */

import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_ICON_PRESETS,
  isValidUserEmoji
} from '../../../src/renderer/src/workspace/presets'
import {
  WORKSPACE_PRESET_ICONS,
  validateWorkspaceIcon,
  WorkspaceValidationError
} from '../../../src/main/WorkspaceService'

describe('renderer workspace presets', () => {
  it('matches main WORKSPACE_PRESET_ICONS verbatim (12종 SSOT 정합)', () => {
    expect(WORKSPACE_ICON_PRESETS).toEqual([...WORKSPACE_PRESET_ICONS])
  })

  it('isValidUserEmoji accepts all 12 presets', () => {
    for (const preset of WORKSPACE_ICON_PRESETS) {
      expect(isValidUserEmoji(preset)).toBe(true)
    }
  })

  it('isValidUserEmoji accepts custom emoji (🎮)', () => {
    expect(isValidUserEmoji('🎮')).toBe(true)
  })

  it('isValidUserEmoji rejects empty / 한글 / latin / digit', () => {
    expect(isValidUserEmoji('')).toBe(false)
    expect(isValidUserEmoji('   ')).toBe(false)
    expect(isValidUserEmoji('가')).toBe(false)
    expect(isValidUserEmoji('A')).toBe(false)
    expect(isValidUserEmoji('1')).toBe(false)
  })

  it('isValidUserEmoji rejects 2 grapheme clusters', () => {
    expect(isValidUserEmoji('📚💻')).toBe(false)
  })

  it('renderer isValidUserEmoji ↔ main validateWorkspaceIcon parity (positive)', () => {
    const positives = ['📚', '🎮', '🏠', '🎨', '✍️', '☺']
    for (const v of positives) {
      expect(isValidUserEmoji(v)).toBe(true)
      expect(validateWorkspaceIcon(v)).toBe(v)
    }
  })

  it('renderer isValidUserEmoji ↔ main validateWorkspaceIcon parity (negative)', () => {
    const negatives = ['', '   ', '가', 'A', '1', '📚📚']
    for (const v of negatives) {
      expect(isValidUserEmoji(v)).toBe(false)
      expect(() => validateWorkspaceIcon(v)).toThrow(WorkspaceValidationError)
    }
  })

  // 핫픽스 (codex NEEDS_CHANGES #2) — modifier-only 거부 정합
  // String.fromCodePoint 명시 — 파일 인코딩 안전성 확보 (invisible char 직접 표기 회피)
  it('rejects standalone modifier (FE0F / ZWJ / skin tone) on both sides', () => {
    const modifierOnly = [
      String.fromCodePoint(0xfe0f),
      String.fromCodePoint(0x200d),
      String.fromCodePoint(0x1f3fb)
    ]
    for (const v of modifierOnly) {
      expect(isValidUserEmoji(v)).toBe(false)
      expect(() => validateWorkspaceIcon(v)).toThrow(WorkspaceValidationError)
    }
  })

  it('accepts ZWJ family on both sides', () => {
    expect(isValidUserEmoji('👨‍👩‍👧')).toBe(true)
    expect(validateWorkspaceIcon('👨‍👩‍👧')).toBe('👨‍👩‍👧')
  })

  it('accepts skin tone modified base on both sides', () => {
    expect(isValidUserEmoji('👋🏻')).toBe(true)
    expect(validateWorkspaceIcon('👋🏻')).toBe('👋🏻')
  })
})
