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
  nodes.forEach((node) => {
    const el = node as HTMLElement
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length < 8) return
    if (text.length > 5000) return
    if (seen.has(text)) return
    seen.add(text)
    const tag = el.tagName.toLowerCase()
    result.push({ id: `p${idCounter++}`, text, tag })
  })
  return result
}
