/**
 * Sprint 015 M6 T28 — WorkspaceSidebar preset 12종 + 사용자 이모지 검증.
 *
 * main WorkspaceService 의 WORKSPACE_PRESET_ICONS 와 정합 (renderer 별도 import 미지원 — main / renderer 코드 분리 정책).
 * 정합 검증은 단위 테스트 (`tests/unit/renderer/workspacePresets.test.ts`) 에서 강제.
 *
 * `isValidUserEmoji` 는 renderer 측 사전 검증 — main 측 `validateWorkspaceIcon` 이 SSOT.
 * UX 우선 (즉시 피드백) 이라 본 함수 추가. main 측 결과가 다르면 main 측 errorCode='invalid_input' 으로 fallback.
 */

export const WORKSPACE_ICON_PRESETS = [
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
] as const

export type WorkspaceIconPreset = (typeof WORKSPACE_ICON_PRESETS)[number]

/**
 * 이모지 1 grapheme 검증.
 * Intl.Segmenter 가 있으면 grapheme 단위 1개 + emoji 코드포인트 검사.
 * 없으면 코드포인트 1~4개 fallback.
 */
export function isValidUserEmoji(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return false
  if ((WORKSPACE_ICON_PRESETS as readonly string[]).includes(trimmed)) return true

  let grapheme: string | null = null
  let count = 0
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const part of seg.segment(trimmed)) {
      grapheme = part.segment
      count++
      if (count > 1) return false
    }
    if (count !== 1 || grapheme === null) return false
  } else {
    const cps = Array.from(trimmed)
    if (cps.length === 0 || cps.length > 4) return false
    grapheme = trimmed
  }

  let hasEmojiCp = false
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)!
    if (
      (cp >= 0x1f000 && cp <= 0x1ffff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2300 && cp <= 0x23ff) ||
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff)
    ) {
      hasEmojiCp = true
    }
  }
  return hasEmojiCp
}
