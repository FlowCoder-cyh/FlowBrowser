/// <reference lib="dom" />
/**
 * 페이지 전체 노드 추출.
 * Sprint 003 M2 / S003-T04. PRD §9.2 페이지 전체 번역.
 *
 * ParagraphExtractor (`p, h1~h6, blockquote, li, dd`)의 확장. 더 광범위한 블록 노드까지
 * 포함하며 청크 그루핑 메타도 함께 반환한다.
 *
 * 외부 페이지(WebContentsView)에서 `executeJavaScript`로 실행되므로 외부 식별자 사용 금지.
 */

export interface PageNodeInfo {
  id: string
  text: string
  tag: string
}

export interface PageNodeChunkMeta {
  index: number
  startNodeId: string
  endNodeId: string
  size: number
  charCount: number
}

export interface PageNodeBundle {
  nodes: PageNodeInfo[]
  chunks: PageNodeChunkMeta[]
}

const MIN_TEXT_LENGTH = 8
const MAX_TEXT_LENGTH = 5000
const CHUNK_CHAR_LIMIT = 4000

/**
 * 직렬화 스크립트 — 외부 페이지 컨텍스트에서 실행할 IIFE.
 * Browser 함수는 외부 식별자(상수, type)을 사용할 수 없으므로 본문에서 직접 상수 인라인.
 */
export function extractPageNodesScript(): string {
  return `(${extractPageNodesBrowser.toString()})()`
}

/**
 * 외부 페이지 컨텍스트에서 실행. 외부 식별자 사용 금지.
 * 본 함수는 `toString()`되어 IIFE로 주입되므로 import / 외부 상수 참조 금지.
 */
export function extractPageNodesBrowser(): {
  nodes: Array<{ id: string; text: string; tag: string }>
  chunks: Array<{
    index: number
    startNodeId: string
    endNodeId: string
    size: number
    charCount: number
  }>
} {
  const selectors =
    'p, h1, h2, h3, h4, h5, h6, blockquote, li, dd, dt, figcaption, caption, summary, td, th'
  const nodes = document.querySelectorAll(selectors)
  const result: Array<{ id: string; text: string; tag: string }> = []
  const seen = new Set<string>()
  let idCounter = 0
  // Sprint 014 M3-13: style/script/noscript/template 자식 노드 제외하고 텍스트 추출.
  // 기존 (innerText || textContent)는 일부 페이지의 inline <style> 자식 CSS 텍스트를
  // 포함해 LLM에 CSS 코드가 전송되는 문제 발생.
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
  // CSS 규칙 패턴 (중괄호 + 콜론) 다수 포함 시 노이즈로 판단
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
    result.push({ id: `n${idCounter++}`, text, tag })
  })

  const chunks: Array<{
    index: number
    startNodeId: string
    endNodeId: string
    size: number
    charCount: number
  }> = []
  let currentSize = 0
  let currentChars = 0
  let currentStart = ''
  let currentEnd = ''
  let chunkIdx = 0
  const CHUNK_LIMIT = 4000

  const flushChunk = (): void => {
    if (currentSize === 0) return
    chunks.push({
      index: chunkIdx++,
      startNodeId: currentStart,
      endNodeId: currentEnd,
      size: currentSize,
      charCount: currentChars
    })
    currentSize = 0
    currentChars = 0
    currentStart = ''
    currentEnd = ''
  }

  for (const node of result) {
    if (currentSize > 0 && currentChars + node.text.length > CHUNK_LIMIT) {
      flushChunk()
    }
    if (currentSize === 0) currentStart = node.id
    currentEnd = node.id
    currentSize += 1
    currentChars += node.text.length
  }
  flushChunk()

  return { nodes: result, chunks }
}

/**
 * Main 프로세스 노드(타입 안전성 검증). 외부 페이지에서 실행되지 않음.
 */
export function validatePageNodes(raw: unknown): PageNodeBundle {
  if (!raw || typeof raw !== 'object') return { nodes: [], chunks: [] }
  const obj = raw as { nodes?: unknown; chunks?: unknown }
  const nodes: PageNodeInfo[] = Array.isArray(obj.nodes)
    ? obj.nodes.filter(
        (n): n is PageNodeInfo =>
          typeof n === 'object' &&
          n !== null &&
          typeof (n as PageNodeInfo).id === 'string' &&
          typeof (n as PageNodeInfo).text === 'string' &&
          typeof (n as PageNodeInfo).tag === 'string' &&
          (n as PageNodeInfo).text.length >= MIN_TEXT_LENGTH &&
          (n as PageNodeInfo).text.length <= MAX_TEXT_LENGTH
      )
    : []
  const chunks: PageNodeChunkMeta[] = Array.isArray(obj.chunks)
    ? obj.chunks.filter(
        (c): c is PageNodeChunkMeta =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as PageNodeChunkMeta).index === 'number' &&
          typeof (c as PageNodeChunkMeta).startNodeId === 'string' &&
          typeof (c as PageNodeChunkMeta).endNodeId === 'string' &&
          typeof (c as PageNodeChunkMeta).size === 'number' &&
          typeof (c as PageNodeChunkMeta).charCount === 'number'
      )
    : []
  return { nodes, chunks }
}

export const PAGE_NODE_CONFIG = {
  MIN_TEXT_LENGTH,
  MAX_TEXT_LENGTH,
  CHUNK_CHAR_LIMIT
} as const
