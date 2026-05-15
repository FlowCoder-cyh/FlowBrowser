/// <reference lib="dom" />
/**
 * Sprint 006 M1 — 외부 페이지 안에서 번역문을 DOM에 적용.
 *
 * 두 가지 모드 지원 (M2에서 overlay 추가):
 * - replace: textContent를 번역문으로 교체, 원문은 data-fbai-orig 속성에 백업
 * - restore: 모든 백업을 원문으로 복원
 *
 * 입력은 `{ id, translatedText, mode, selectorPreset }` 배열을 받는다.
 * id는 PageNodeExtractor/ParagraphExtractor가 부여한 'p0','p1',...,'n0','n1',...
 * 외부 페이지 컨텍스트에서 실행되므로 외부 식별자 사용 금지.
 */

export type RendererMode = 'replace' | 'overlay'
export type SelectorPreset = 'paragraph' | 'page'

export interface RenderInstruction {
  id: string
  translatedText: string
}

export interface RenderPayload {
  mode: RendererMode
  selectorPreset: SelectorPreset
  instructions: RenderInstruction[]
}

const PARAGRAPH_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd'
const PAGE_SELECTORS =
  'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd, dt, figcaption, caption, summary, td, th'

const MIN_TEXT_LENGTH = 8
const MAX_TEXT_LENGTH = 5000

/**
 * IIFE 스크립트 직렬화. main 프로세스가 webContents.executeJavaScript로 주입.
 */
export function renderTranslationsScript(payload: RenderPayload): string {
  const serialized = JSON.stringify(payload)
  return `(${renderTranslationsBrowser.toString()})(${serialized})`
}

export function restoreOriginalsScript(): string {
  return `(${restoreOriginalsBrowser.toString()})()`
}

/**
 * 외부 페이지 컨텍스트에서 실행. 외부 식별자 사용 금지 — 본 함수는 IIFE로 주입된다.
 */
export function renderTranslationsBrowser(payload: {
  mode: 'replace' | 'overlay'
  selectorPreset: 'paragraph' | 'page'
  instructions: Array<{ id: string; translatedText: string }>
}): { applied: number; missing: number } {
  const PARAGRAPH = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd'
  const PAGE_FULL =
    'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd, dt, figcaption, caption, summary, td, th'
  const selectors = payload.selectorPreset === 'page' ? PAGE_FULL : PARAGRAPH
  const idPrefix = payload.selectorPreset === 'page' ? 'n' : 'p'

  const nodes = document.querySelectorAll(selectors)
  const idToNode = new Map<string, HTMLElement>()
  const seen = new Set<string>()
  let idCounter = 0
  nodes.forEach((node) => {
    const el = node as HTMLElement
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length < 8) return
    if (text.length > 5000) return
    if (seen.has(text)) return
    seen.add(text)
    idToNode.set(`${idPrefix}${idCounter++}`, el)
  })

  let applied = 0
  let missing = 0
  for (const inst of payload.instructions) {
    const node = idToNode.get(inst.id)
    if (!node) {
      missing++
      continue
    }
    if (payload.mode === 'replace') {
      if (!node.hasAttribute('data-fbai-orig')) {
        node.setAttribute('data-fbai-orig', node.textContent ?? '')
      }
      node.textContent = inst.translatedText
      applied++
    } else {
      // overlay: 인접 sibling div 부착 (이미 있으면 갱신)
      const existing = node.nextElementSibling
      if (
        existing &&
        existing.classList.contains('fbai-overlay') &&
        existing.getAttribute('data-fbai-for') === inst.id
      ) {
        existing.textContent = inst.translatedText
      } else {
        const overlay = document.createElement('div')
        overlay.className = 'fbai-overlay'
        overlay.setAttribute('data-fbai-for', inst.id)
        overlay.style.cssText =
          'border-left: 3px solid #4a9eff; padding: 6px 10px; margin: 4px 0; background: #f0f7ff; color: #222; font-size: 0.95em; line-height: 1.5;'
        overlay.textContent = inst.translatedText
        node.insertAdjacentElement('afterend', overlay)
      }
      applied++
    }
  }
  return { applied, missing }
}

export function restoreOriginalsBrowser(): { restored: number; overlays: number } {
  let restored = 0
  let overlays = 0
  // replace 복원
  document.querySelectorAll('[data-fbai-orig]').forEach((node) => {
    const el = node as HTMLElement
    const orig = el.getAttribute('data-fbai-orig') ?? ''
    el.textContent = orig
    el.removeAttribute('data-fbai-orig')
    restored++
  })
  // overlay 제거
  document.querySelectorAll('.fbai-overlay').forEach((node) => {
    node.remove()
    overlays++
  })
  return { restored, overlays }
}

export const TRANSLATION_RENDERER_CONFIG = {
  PARAGRAPH_SELECTORS,
  PAGE_SELECTORS,
  MIN_TEXT_LENGTH,
  MAX_TEXT_LENGTH
} as const
