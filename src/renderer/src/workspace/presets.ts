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
 * 이모지 1 grapheme 검증 — codex hotfix (NEEDS_CHANGES #2) 정합.
 *
 * main `validateWorkspaceIcon` 와 동일 정책:
 *   1. preset 그대로 통과
 *   2. Intl.Segmenter 로 grapheme 1개만 허용
 *   3. base codepoint 가 emoji-presentation codepoint 여야 함 (modifier / FE0F / ZWJ 단독 거부)
 *   4. 잔여 codepoint 는 FE0F / ZWJ / skin tone / 또 다른 base emoji 허용
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

  const baseCp = grapheme.codePointAt(0)!
  if (!isBaseEmojiCodepoint(baseCp)) return false
  let i = baseCp > 0xffff ? 2 : 1
  while (i < grapheme.length) {
    const cp = grapheme.codePointAt(i)!
    if (
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
      isBaseEmojiCodepoint(cp) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff)
    ) {
      i += cp > 0xffff ? 2 : 1
    } else {
      return false
    }
  }
  return true
}

function isBaseEmojiCodepoint(cp: number): boolean {
  // skin tone modifier 는 base 자격 X
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return false
  if (cp >= 0x1f300 && cp <= 0x1f5ff) return true
  if (cp >= 0x1f600 && cp <= 0x1f64f) return true
  if (cp >= 0x1f680 && cp <= 0x1f6ff) return true
  if (cp >= 0x1f700 && cp <= 0x1f77f) return true
  if (cp >= 0x1f780 && cp <= 0x1f7ff) return true
  if (cp >= 0x1f800 && cp <= 0x1f8ff) return true
  if (cp >= 0x1f900 && cp <= 0x1f9ff) return true
  if (cp >= 0x1fa00 && cp <= 0x1faff) return true
  if (cp >= 0x2600 && cp <= 0x26ff) return true
  if (cp >= 0x2700 && cp <= 0x27bf) return true
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true
  if (cp === 0x231a || cp === 0x231b) return true
  if (cp >= 0x23e9 && cp <= 0x23ec) return true
  if (cp === 0x23f0 || cp === 0x23f3) return true
  return false
}
