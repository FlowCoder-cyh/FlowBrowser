/// <reference lib="dom" />
/**
 * DOM 문단 추출.
 * 외부 페이지(WebContentsView)에서 executeJavaScript로 실행.
 * Main 프로세스가 본 파일의 detectParagraphsScript() 결과를 호출한다.
 */

export interface ParagraphInfo {
  id: string
  text: string
  tag: string
}

/**
 * Renderer/Main에서 String 직렬화 후 executeJavaScript에 전달.
 */
export function extractParagraphsScript(): string {
  return `(${extractParagraphsBrowser.toString()})()`
}

/**
 * 외부 페이지 컨텍스트에서 실행. 외부 식별자 사용 금지.
 */
export function extractParagraphsBrowser(): Array<{ id: string; text: string; tag: string }> {
  const selectors = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd'
  const nodes = document.querySelectorAll(selectors)
  const result: Array<{ id: string; text: string; tag: string }> = []
  const seen = new Set<string>()
  let idCounter = 0
  // Sprint 014 M3-13: style/script/noscript/template 자식 제외 + CSS-like 텍스트 필터.
  const extractCleanText = (root: Element): string => {
    const parts: string[] = []
    const walk = (n: Node): void => {
      if (n.nodeType === 3) {
        parts.push(n.nodeValue || '')
        return
      }
      if (n.nodeType !== 1) return
      const tag = ((n as Element).tagName || '').toLowerCase()
      if (tag === 'style' || tag === 'script' || tag === 'noscript' || tag === 'template') return
      n.childNodes.forEach(walk)
    }
    root.childNodes.forEach(walk)
    return parts.join(' ')
  }
  const isCssLike = (text: string): boolean => {
    const braceCount = (text.match(/\{/g) || []).length
    const colonCount = (text.match(/:/g) || []).length
    return braceCount >= 2 || (braceCount >= 1 && colonCount >= 3)
  }
  nodes.forEach((node) => {
    const el = node as HTMLElement
    const text = extractCleanText(el).replace(/\s+/g, ' ').trim()
    if (text.length < 8) return
    if (text.length > 5000) return
    if (isCssLike(text)) return
    if (seen.has(text)) return
    seen.add(text)
    const tag = el.tagName.toLowerCase()
    result.push({ id: `p${idCounter++}`, text, tag })
  })
  return result
}
