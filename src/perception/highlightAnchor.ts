/// <reference lib="dom" />
/**
 * Sprint 016 M4 T20 — NoteHighlight DOM anchor (pure W3C Range serialize/deserialize).
 *
 * PRD §11.2.1 highlights — 노트 선택 영역을 페이지 재방문 시 고정 위치에 복원.
 *
 * 책임 (G-013 1단계 — pure 모듈만):
 *   1. serializeRange(root, range) — DOM Range → HighlightAnchor 메타데이터
 *   2. deserializeAnchor(root, anchor) — HighlightAnchor → DOM Range (drift fallback 포함)
 *   3. computeContentHash(root) / computeContextHash(prefix+selected+suffix)
 *
 * 본 모듈은 pure — Electron 또는 SQLite 의존 0. happy-dom 단위 테스트 자동
 * (vitest environmentMatchGlobs `tests/unit/perception/**`).
 *
 * codex 사전 협의 (2026-05-21, threadId 019e4a06):
 *   - text node path = root.childNodes 자식 인덱스 배열 (element-only children 아님)
 *   - contentHash + contextHash 둘 다 보관 — hard gate 아니라 confidence/fallback 판단값
 *   - prefix/suffix 32 chars (Array.from 기준 surrogate 안전)
 *   - iframe / Shadow DOM / PDF viewer 명시 미지원 (range root 외부 시 throw)
 *
 * 5 위험 사전 박음:
 *   (a) DOM drift — path 실패 시 prefix/suffix fuzzy fallback (본 PR 포함)
 *   (b) iframe/Shadow DOM — range boundary root 외부 시 throw (본 PR 명시 차단)
 *   (c) PDF viewer — 본 PR 미지원 (호출자 책임 — 별도 KI 후속)
 *   (d) SPA navigate — store 가 url + pageId 보존 (HighlightStore 본문)
 *   (e) contentHash collision — listByPage 필터 url+contentHash+workspaceId (HighlightStore 본문)
 */

import { createHash } from 'node:crypto'

/** root.childNodes 기준 자식 인덱스 배열 — text node 까지 도달 가능. */
export type TextNodePath = number[]

export interface HighlightAnchor {
  /** root 요소 식별 selector — page document.body 기본 가정 시 'body'. */
  rootSelector: string
  /** root.childNodes 기준 자식 인덱스 배열 (start 위치). */
  startPath: TextNodePath
  /** root.childNodes 기준 자식 인덱스 배열 (end 위치). */
  endPath: TextNodePath
  /** start text node 내부 character offset (UTF-16 code unit). */
  startOffset: number
  /** end text node 내부 character offset (UTF-16 code unit). */
  endOffset: number
  /** 선택 텍스트 (drift 시 정합 검증). */
  selectedText: string
  /** 좌측 컨텍스트 — Array.from 기준 최대 32 chars. */
  prefix: string
  /** 우측 컨텍스트 — Array.from 기준 최대 32 chars. */
  suffix: string
  /** root.textContent normalized SHA-256 hex (drift 시 confidence 판단). */
  contentHash: string
  /** prefix + selectedText + suffix SHA-256 hex (drift 시 fuzzy 우선순위). */
  contextHash: string
}

export const CONTEXT_LEN = 32

/**
 * SHA-256 hex digest. node:crypto 사용 (happy-dom 환경에서도 동작).
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * root 의 textContent 를 normalize 후 SHA-256. drift 비교 기준.
 * normalize: \r\n / \r → \n, 연속 whitespace → 단일 space, trim.
 */
export function computeContentHash(root: Element | Document): string {
  const text = (root.textContent ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
  return sha256Hex(text)
}

/**
 * prefix + delimiter + selectedText + delimiter + suffix → SHA-256.
 * delimiter 는 입력에 거의 안 나타날 U+241F (INFORMATION SEPARATOR ONE) 사용.
 */
export function computeContextHash(prefix: string, selectedText: string, suffix: string): string {
  return sha256Hex(`${prefix}␟${selectedText}␟${suffix}`)
}

/**
 * Array.from 기준 좌측/우측 chars 추출 (surrogate pair 안전).
 */
function takeRight(text: string, n: number): string {
  const arr = Array.from(text)
  return arr.slice(Math.max(0, arr.length - n)).join('')
}

function takeLeft(text: string, n: number): string {
  const arr = Array.from(text)
  return arr.slice(0, n).join('')
}

/**
 * root 의 textContent 에서 selectedText 의 첫 occurrence 기준 좌/우 컨텍스트 추출 (utility).
 *
 * 주의: serializeRange 는 본 함수가 아니라 characterOffsetInRoot 로 Range 의 실제 위치를 사용한다.
 * 동일 selectedText 가 여러 번 등장 시 첫 occurrence 기준이라 호출자는 fuzzy 분기 필요.
 *
 * selectedText 가 root.textContent 에 없으면 prefix/suffix 모두 빈 문자열.
 */
export function extractContext(
  rootText: string,
  selectedText: string
): { prefix: string; suffix: string } {
  if (!selectedText) return { prefix: '', suffix: '' }
  const idx = rootText.indexOf(selectedText)
  if (idx < 0) return { prefix: '', suffix: '' }
  const leftText = rootText.substring(0, idx)
  const rightText = rootText.substring(idx + selectedText.length)
  return {
    prefix: takeRight(leftText, CONTEXT_LEN),
    suffix: takeLeft(rightText, CONTEXT_LEN)
  }
}

/**
 * root 의 descendant text node 들을 document order 로 수집 (TreeWalker 대신 수동 재귀 — happy-dom 의
 * NodeFilter.SHOW_TEXT 동작이 불안정한 케이스 회피).
 */
function collectTextNodes(root: Node): Text[] {
  const result: Text[] = []
  const visit = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      result.push(n as Text)
      return
    }
    const children = n.childNodes
    for (let i = 0; i < children.length; i++) {
      visit(children[i])
    }
  }
  visit(root)
  return result
}

/**
 * Range boundary (container + offset) 가 root 의 textContent 안에서 어느 character 위치에
 * 해당하는지 계산. container 가 text node 이면 누적 + offset. element 이면 그 시점까지의 누적.
 *
 * 실패 시 -1.
 */
function characterOffsetInRoot(root: Node, container: Node, offset: number): number {
  let acc = 0
  let result = -1
  let done = false

  const visit = (n: Node): void => {
    if (done) return
    if (n === container) {
      if (n.nodeType === Node.TEXT_NODE) {
        result = acc + offset
      } else {
        // element container — offset 은 children index. 그 이전 children 까지의 text 누적.
        const limit = Math.min(offset, n.childNodes.length)
        for (let i = 0; i < limit; i++) {
          visit(n.childNodes[i])
          if (done) return
        }
        result = acc
      }
      done = true
      return
    }
    if (n.nodeType === Node.TEXT_NODE) {
      acc += (n as Text).data.length
      return
    }
    const children = n.childNodes
    for (let i = 0; i < children.length; i++) {
      visit(children[i])
      if (done) return
    }
  }
  visit(root)
  return result
}

/**
 * root 부터 target 까지 childNodes 인덱스 path 계산.
 * target 이 root 내부가 아니면 null.
 */
function computeChildNodesPath(root: Node, target: Node): TextNodePath | null {
  if (target === root) return []
  const path: number[] = []
  let current: Node | null = target
  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) return null
    const siblings: NodeListOf<ChildNode> = parent.childNodes
    let idx = -1
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === current) {
        idx = i
        break
      }
    }
    if (idx < 0) return null
    path.unshift(idx)
    current = parent
  }
  if (current !== root) return null
  return path
}

/**
 * root.childNodes 인덱스 path 를 따라가 node 반환. 실패 시 null.
 */
function resolveChildNodesPath(root: Node, path: TextNodePath): Node | null {
  let current: Node | null = root
  for (const idx of path) {
    if (!current) return null
    const children: NodeListOf<ChildNode> = current.childNodes
    if (idx < 0 || idx >= children.length) return null
    current = children.item(idx)
  }
  return current
}

/**
 * Range 의 boundary container 가 root 내부인지 검증.
 * iframe / Shadow DOM cross-boundary range 는 root.contains() 가 false → throw.
 */
function assertWithinRoot(root: Node, node: Node): void {
  if (node === root) return
  if (!root.contains(node)) {
    throw new Error('serializeRange: range boundary outside root (iframe/Shadow DOM unsupported)')
  }
}

/**
 * DOM Range → HighlightAnchor 직렬화.
 *
 * rootSelector 는 metadata — 본 모듈의 deserializeAnchor 는 root: Element 를 직접 받으므로
 * selector 를 사용하지 않는다. 호출자 (renderer overlay 또는 후속 SQLite swap path) 가 anchor.rootSelector
 * 로 root 를 다시 querySelector 하는 책임 모델. 본 metadata 가 비어 있어도 deserialize 동작에는 영향 없음.
 *
 * @param root         anchor 기준 root (보통 document.body)
 * @param rootSelector root 를 다시 찾기 위한 selector — metadata 보존만 (예: 'body' / 'main#content')
 * @param range        선택된 W3C Range — collapsed/empty selection 차단
 * @throws iframe/Shadow DOM cross-boundary range 또는 range 가 root 외부 또는 empty selection
 */
export function serializeRange(root: Element, rootSelector: string, range: Range): HighlightAnchor {
  assertWithinRoot(root, range.startContainer)
  assertWithinRoot(root, range.endContainer)

  const startPath = computeChildNodesPath(root, range.startContainer)
  const endPath = computeChildNodesPath(root, range.endContainer)
  if (!startPath || !endPath) {
    throw new Error('serializeRange: failed to compute childNodes path')
  }

  const selectedText = range.toString()
  // codex 사전 dual review NB-4 흡수 — empty selection 방어. UI 가 막아도 pure 모듈 자체 방어.
  if (selectedText.length === 0) {
    throw new Error('serializeRange: empty selection (collapsed range)')
  }
  const rootText = root.textContent ?? ''

  // Range 의 실제 character offset 기반 prefix/suffix 추출 — 동일 selectedText 가 여러 번
  // 등장해도 정확한 위치의 컨텍스트 박힘 (codex 사전 협의 정합 — 동일 텍스트 ambiguous 회피).
  const startCharOffset = characterOffsetInRoot(root, range.startContainer, range.startOffset)
  const endCharOffset = characterOffsetInRoot(root, range.endContainer, range.endOffset)

  let prefix = ''
  let suffix = ''
  if (startCharOffset >= 0 && endCharOffset >= startCharOffset) {
    prefix = takeRight(rootText.substring(0, startCharOffset), CONTEXT_LEN)
    suffix = takeLeft(rootText.substring(endCharOffset), CONTEXT_LEN)
  } else {
    // characterOffsetInRoot 실패 (방어적) — extractContext fallback (첫 occurrence 기준)
    const ctx = extractContext(rootText, selectedText)
    prefix = ctx.prefix
    suffix = ctx.suffix
  }

  const contentHash = computeContentHash(root)
  const contextHash = computeContextHash(prefix, selectedText, suffix)

  return {
    rootSelector,
    startPath,
    endPath,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    selectedText,
    prefix,
    suffix,
    contentHash,
    contextHash
  }
}

/**
 * deserialize 시도 단계. 호출자 디버깅용.
 */
export type DeserializeStrategy = 'path' | 'context-fuzzy' | 'failed'

export interface DeserializeResult {
  /** 복원된 Range 또는 null (실패). */
  range: Range | null
  /** 사용된 전략. */
  strategy: DeserializeStrategy
  /** contentHash 일치 여부 (드리프트 판단). */
  contentHashMatch: boolean
}

/**
 * HighlightAnchor → DOM Range 복원.
 *
 * 우선순위 (codex 사전 협의 정합):
 *   1. childNodes path fast path — startPath/endPath 따라가서 Range 박음
 *   2. path 또는 selectedText 정합 실패 시 prefix/suffix fuzzy 검색 (root.textContent 안)
 *   3. fuzzy 후보 0개 또는 복수 (ambiguous) 시 null
 *
 * contentHash 불일치 시 path fast path 결과를 신뢰하지 않고 fuzzy 만 시도.
 *
 * @param root   복원 대상 root (보통 document.body 또는 anchor.rootSelector 의 querySelector 결과)
 * @param anchor HighlightAnchor 메타데이터
 */
export function deserializeAnchor(root: Element, anchor: HighlightAnchor): DeserializeResult {
  const doc = root.ownerDocument
  if (!doc) {
    return { range: null, strategy: 'failed', contentHashMatch: false }
  }

  const currentContentHash = computeContentHash(root)
  const contentHashMatch = currentContentHash === anchor.contentHash

  // 1. childNodes path fast path — contentHash 일치 시 신뢰 가능
  if (contentHashMatch) {
    const pathRange = tryPathRestore(root, anchor, doc)
    if (pathRange) {
      return { range: pathRange, strategy: 'path', contentHashMatch }
    }
  }

  // 2. fuzzy — prefix/suffix 기반 root.textContent 내 검색
  const fuzzyRange = tryFuzzyRestore(root, anchor, doc)
  if (fuzzyRange) {
    return { range: fuzzyRange, strategy: 'context-fuzzy', contentHashMatch }
  }

  return { range: null, strategy: 'failed', contentHashMatch }
}

/**
 * 1단계 — childNodes path fast path.
 */
function tryPathRestore(root: Element, anchor: HighlightAnchor, doc: Document): Range | null {
  const startNode = resolveChildNodesPath(root, anchor.startPath)
  const endNode = resolveChildNodesPath(root, anchor.endPath)
  if (!startNode || !endNode) return null

  // text node 우선 — element 일 시 offset 의미 변경되므로 거부 (정확성 우선)
  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    return null
  }
  const startLen = (startNode as Text).data.length
  const endLen = (endNode as Text).data.length
  if (anchor.startOffset < 0 || anchor.startOffset > startLen) return null
  if (anchor.endOffset < 0 || anchor.endOffset > endLen) return null

  let range: Range
  try {
    range = doc.createRange()
    range.setStart(startNode, anchor.startOffset)
    range.setEnd(endNode, anchor.endOffset)
  } catch {
    return null
  }

  // selectedText 정합 검증 — drift 발생 시 path 만 일치하고 텍스트 다를 수 있음
  if (range.toString() !== anchor.selectedText) {
    return null
  }
  return range
}

/**
 * 2단계 — prefix/suffix fuzzy. root.textContent 에서 prefix+selectedText+suffix 정확 매칭 후
 * text walker 로 해당 character offset → text node + offset 환산.
 *
 * ambiguous (복수 매칭) 시 null — 잘못 복원하느니 실패.
 */
function tryFuzzyRestore(root: Element, anchor: HighlightAnchor, doc: Document): Range | null {
  const rootText = root.textContent ?? ''
  const needle = `${anchor.prefix}${anchor.selectedText}${anchor.suffix}`
  if (!anchor.selectedText) return null

  // prefix/suffix 가 모두 빈 문자열일 때는 selectedText 단독 매칭 + 유일성 검증
  const searchKey = needle
  const firstIdx = rootText.indexOf(searchKey)
  if (firstIdx < 0) {
    // prefix/suffix 둘 다 비어 selectedText 만 검색 (호출자 입력이 짧을 때)
    if (!anchor.prefix && !anchor.suffix) {
      return locateUnique(root, doc, rootText, anchor.selectedText)
    }
    return null
  }
  const secondIdx = rootText.indexOf(searchKey, firstIdx + 1)
  if (secondIdx >= 0) {
    // ambiguous — 잘못 복원 차단
    return null
  }

  const selectedStartCharOffset = firstIdx + anchor.prefix.length
  const selectedEndCharOffset = selectedStartCharOffset + anchor.selectedText.length
  return charOffsetsToRange(root, doc, selectedStartCharOffset, selectedEndCharOffset)
}

/**
 * root.textContent 안에서 selectedText 가 정확히 1회만 등장하면 그 위치로 복원, 아니면 null.
 */
function locateUnique(
  root: Element,
  doc: Document,
  rootText: string,
  selectedText: string
): Range | null {
  const firstIdx = rootText.indexOf(selectedText)
  if (firstIdx < 0) return null
  const secondIdx = rootText.indexOf(selectedText, firstIdx + 1)
  if (secondIdx >= 0) return null
  return charOffsetsToRange(root, doc, firstIdx, firstIdx + selectedText.length)
}

/**
 * root.textContent 내 character offset (start/end) 을 text node + offset 으로 환산 후 Range 박음.
 * 수동 재귀로 text node 수집 — happy-dom TreeWalker.SHOW_TEXT 호환성 회피.
 *
 * startChar / endChar 가 정확히 text node 경계일 때 — 이전 node 끝과 다음 node 시작 둘 다
 * 매칭. 본 구현은 첫 매칭 (이전 node 끝) 우선 — 사용자가 보는 텍스트와 일관.
 */
function charOffsetsToRange(
  root: Element,
  doc: Document,
  startChar: number,
  endChar: number
): Range | null {
  if (startChar < 0 || endChar < startChar) return null
  const textNodes = collectTextNodes(root)
  let accumulated = 0
  let startNode: Text | null = null
  let startNodeOffset = 0
  let endNode: Text | null = null
  let endNodeOffset = 0

  for (const node of textNodes) {
    const nodeLen = node.data.length
    const nodeStart = accumulated
    const nodeEnd = accumulated + nodeLen

    if (!startNode && startChar >= nodeStart && startChar <= nodeEnd) {
      startNode = node
      startNodeOffset = startChar - nodeStart
    }
    if (!endNode && endChar >= nodeStart && endChar <= nodeEnd) {
      endNode = node
      endNodeOffset = endChar - nodeStart
    }
    if (startNode && endNode) break
    accumulated = nodeEnd
  }

  if (!startNode || !endNode) return null
  try {
    const range = doc.createRange()
    range.setStart(startNode, startNodeOffset)
    range.setEnd(endNode, endNodeOffset)
    return range
  } catch {
    return null
  }
}
