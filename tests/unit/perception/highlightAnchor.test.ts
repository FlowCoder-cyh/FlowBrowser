// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  serializeRange,
  deserializeAnchor,
  computeContentHash,
  computeContextHash,
  extractContext,
  CONTEXT_LEN,
  sha256Hex,
  type HighlightAnchor
} from '../../../src/perception/highlightAnchor'

/**
 * Sprint 016 M4 T20 — highlightAnchor 단위 회귀.
 *
 * codex 사전 협의 (threadId 019e4a06) 정합 — 11+ 케이스:
 *   - serialize: 단일 text node / nested element / start≠end text node / iframe 외부 throw
 *   - deserialize: path 정상 / path drift 후 fuzzy / offset drift 후 fuzzy /
 *                  repeated text context 유일 매칭 / ambiguous null
 *   - hash: contentHash deterministic / contextHash deterministic + collision 회피
 */

function makeRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

describe('highlightAnchor — sha256Hex / computeContentHash / computeContextHash', () => {
  it('sha256Hex deterministic', () => {
    expect(sha256Hex('foo')).toBe(sha256Hex('foo'))
    expect(sha256Hex('foo')).not.toBe(sha256Hex('bar'))
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('computeContentHash normalizes whitespace + CRLF', () => {
    document.body.innerHTML = '<p>hello   world</p>'
    const a = computeContentHash(document.body)
    document.body.innerHTML = '<p>hello world</p>'
    const b = computeContentHash(document.body)
    expect(a).toBe(b)
  })

  it('computeContextHash includes delimiter so prefix/suffix swap collision is avoided', () => {
    // prefix='ab', selected='cd', suffix='ef' vs prefix='abcd', selected='', suffix='ef' 같은 단순 concat 시 충돌
    const a = computeContextHash('ab', 'cd', 'ef')
    const b = computeContextHash('abcd', '', 'ef')
    expect(a).not.toBe(b)
  })

  it('extractContext returns left/right CONTEXT_LEN chars (Array.from surrogate-safe)', () => {
    const rootText = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhello worldBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const { prefix, suffix } = extractContext(rootText, 'hello world')
    expect(Array.from(prefix).length).toBeLessThanOrEqual(CONTEXT_LEN)
    expect(Array.from(suffix).length).toBeLessThanOrEqual(CONTEXT_LEN)
    expect(prefix.endsWith('AAAA')).toBe(true)
    expect(suffix.startsWith('BBBB')).toBe(true)
  })

  it('extractContext returns empty when selectedText not present', () => {
    const { prefix, suffix } = extractContext('hello', 'xyz')
    expect(prefix).toBe('')
    expect(suffix).toBe('')
  })
})

describe('highlightAnchor — serializeRange', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('serializes single text node selection', () => {
    document.body.innerHTML = '<p id="p1">The quick brown fox jumps over the lazy dog.</p>'
    const p = document.querySelector('#p1')!
    const textNode = p.firstChild as Text
    const range = makeRange(textNode, 4, textNode, 9) // "quick"

    const anchor = serializeRange(document.body, 'body', range)

    expect(anchor.rootSelector).toBe('body')
    expect(anchor.selectedText).toBe('quick')
    expect(anchor.startOffset).toBe(4)
    expect(anchor.endOffset).toBe(9)
    // body.childNodes[0] = <p> ; p.childNodes[0] = text node
    expect(anchor.startPath).toEqual([0, 0])
    expect(anchor.endPath).toEqual([0, 0])
    expect(anchor.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(anchor.contextHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('serializes nested element + start/end different text nodes', () => {
    document.body.innerHTML = '<div><p id="a">Hello </p><p id="b">world!</p></div>'
    const a = document.querySelector('#a')!.firstChild as Text
    const b = document.querySelector('#b')!.firstChild as Text
    // "Hello world" 전체 선택 — start=a:0, end=b:5
    const range = makeRange(a, 0, b, 5)

    const anchor = serializeRange(document.body, 'body', range)

    expect(anchor.selectedText).toBe('Hello world')
    // body.childNodes[0] = <div> ; div.childNodes[0] = <p#a> ; p#a.childNodes[0] = text
    expect(anchor.startPath).toEqual([0, 0, 0])
    // div.childNodes[1] = <p#b> ; p#b.childNodes[0] = text
    expect(anchor.endPath).toEqual([0, 1, 0])
    expect(anchor.startOffset).toBe(0)
    expect(anchor.endOffset).toBe(5)
  })

  it('throws on empty (collapsed) selection — codex dual review NB-4 hotfix', () => {
    document.body.innerHTML = '<p>hello</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const range = makeRange(text, 2, text, 2) // collapsed at offset 2
    expect(() => serializeRange(document.body, 'body', range)).toThrow(/empty selection/)
  })

  it('throws when range.startContainer is outside root', () => {
    document.body.innerHTML = '<p>inside</p>'
    // 별도 detached document fragment 만든 후 그 안의 text node 로 Range 박음
    const detached = document.createElement('div')
    detached.textContent = 'detached text'
    const detachedText = detached.firstChild as Text
    const range = document.createRange()
    range.setStart(detachedText, 0)
    range.setEnd(detachedText, 4)

    expect(() => serializeRange(document.body, 'body', range)).toThrow(/iframe\/Shadow DOM/)
  })

  it('records prefix/suffix from surrounding text', () => {
    document.body.innerHTML = '<p>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaTARGETbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const start = text.data.indexOf('TARGET')
    const range = makeRange(text, start, text, start + 'TARGET'.length)

    const anchor = serializeRange(document.body, 'body', range)

    expect(anchor.selectedText).toBe('TARGET')
    expect(anchor.prefix.endsWith('aaaa')).toBe(true)
    expect(anchor.suffix.startsWith('bbbb')).toBe(true)
    expect(Array.from(anchor.prefix).length).toBe(CONTEXT_LEN)
    expect(Array.from(anchor.suffix).length).toBe(CONTEXT_LEN)
  })
})

describe('highlightAnchor — deserializeAnchor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('restores via path fast path when contentHash matches', () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const range = makeRange(text, 4, text, 9) // "quick"
    const anchor = serializeRange(document.body, 'body', range)

    const result = deserializeAnchor(document.body, anchor)
    expect(result.strategy).toBe('path')
    expect(result.contentHashMatch).toBe(true)
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('quick')
  })

  it('falls back to context-fuzzy when DOM drifts (extra prepended node, contentHash changes)', () => {
    document.body.innerHTML = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. The quick brown fox jumps over the lazy dog.</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const start = text.data.indexOf('quick')
    const range = makeRange(text, start, text, start + 'quick'.length)
    const anchor = serializeRange(document.body, 'body', range)

    // drift — 같은 텍스트의 페이지 앞쪽에 새 문단 추가 (childNodes index 변경)
    document.body.innerHTML =
      '<p>ADDED PARAGRAPH BEFORE</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. The quick brown fox jumps over the lazy dog.</p>'

    const result = deserializeAnchor(document.body, anchor)
    expect(result.contentHashMatch).toBe(false)
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('quick')
  })

  it('returns null when fuzzy match is ambiguous (repeated text + empty prefix/suffix)', () => {
    // anchor 객체 직접 박음 — prefix/suffix 둘 다 빈 + selectedText 가 root 에 두 번 등장 →
    // locateUnique 가 secondIdx 발견 → ambiguous null
    document.body.innerHTML = '<p>AAA repeat-token BBB repeat-token CCC</p>'
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [999, 999],
      endPath: [999, 999],
      startOffset: 0,
      endOffset: 12,
      selectedText: 'repeat-token',
      prefix: '',
      suffix: '',
      contentHash: 'stale-hash-mismatch',
      contextHash: 'stale-context-hash'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.contentHashMatch).toBe(false)
    expect(result.range).toBeNull()
    expect(result.strategy).toBe('failed')
  })

  it('disambiguates repeated selectedText when prefix/suffix is unique', () => {
    document.body.innerHTML =
      '<p>before-uniqA hit after-x and before-uniqB hit after-y</p>'
    const text = document.querySelector('p')!.firstChild as Text
    // 두 번째 'hit' 선택 — prefix='uniqB ' suffix=' after-y'
    const start = text.data.indexOf('hit', text.data.indexOf('uniqB'))
    const range = makeRange(text, start, text, start + 'hit'.length)
    const anchor = serializeRange(document.body, 'body', range)

    // drift — 다른 문단 추가
    document.body.innerHTML =
      '<p>EXTRA</p><p>before-uniqA hit after-x and before-uniqB hit after-y</p>'

    const result = deserializeAnchor(document.body, anchor)
    expect(result.contentHashMatch).toBe(false)
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    // 두 번째 'hit' 만 prefix/suffix 일치
    const restored = result.range!
    expect(restored.toString()).toBe('hit')
    // 위치 검증 — restored.startOffset 가 두 번째 hit 의 character offset
    const restoredText = restored.startContainer.textContent ?? ''
    const expectedStart = restoredText.indexOf('hit', restoredText.indexOf('uniqB'))
    expect(restored.startOffset).toBe(expectedStart)
  })

  it('returns null when text is gone (no path + no fuzzy)', () => {
    document.body.innerHTML = '<p>The quick brown fox.</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const range = makeRange(text, 4, text, 9) // "quick"
    const anchor = serializeRange(document.body, 'body', range)

    document.body.innerHTML = '<p>Completely different content with no quick or fox.</p>'
    // 위 텍스트에 'quick' 가 포함되지 않도록 다시
    document.body.innerHTML = '<p>Lazy hounds sleep all afternoon under the sun.</p>'

    const result = deserializeAnchor(document.body, anchor)
    expect(result.range).toBeNull()
    expect(result.strategy).toBe('failed')
  })

  it('falls back to fuzzy when contentHash matches but path drifted to wrong text', () => {
    // contentHash 동일하면 path fast path 시도 — drift 시 selectedText 불일치 → fuzzy fallback
    document.body.innerHTML = '<p>The quick brown fox jumps.</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const start = text.data.indexOf('brown')
    const range = makeRange(text, start, text, start + 'brown'.length)
    const anchor = serializeRange(document.body, 'body', range)

    // offset drift — startOffset / endOffset 수동 변형 (path 는 정상이지만 텍스트는 다른 단어)
    const tampered: HighlightAnchor = {
      ...anchor,
      startOffset: 0,
      endOffset: 3 // 'The' — selectedText 와 불일치 → path fast path 실패 → fuzzy fallback
    }

    const result = deserializeAnchor(document.body, tampered)
    expect(result.contentHashMatch).toBe(true)
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('brown')
  })

  it('uniquely locates selectedText when prefix/suffix are both empty (fallback path)', () => {
    // root.textContent 가 selectedText 보다 짧아 prefix/suffix 둘 다 빈 케이스를 모사하기 어려우므로
    // anchor 객체를 직접 박아서 fallback path 검증
    document.body.innerHTML = '<p>The quick brown fox.</p>'
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [999, 999],
      endPath: [999, 999],
      startOffset: 0,
      endOffset: 5,
      selectedText: 'brown',
      prefix: '',
      suffix: '',
      contentHash: 'stale-hash-mismatch',
      contextHash: 'stale-context-hash'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.contentHashMatch).toBe(false)
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('brown')
  })

  it('returns null when prefix+selectedText+suffix not present anywhere', () => {
    document.body.innerHTML = '<p>The quick brown fox.</p>'
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [0, 0],
      endPath: [0, 0],
      startOffset: 0,
      endOffset: 5,
      selectedText: 'penguin',
      prefix: 'AAA',
      suffix: 'BBB',
      contentHash: 'stale-hash',
      contextHash: 'stale-context'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.range).toBeNull()
    expect(result.strategy).toBe('failed')
  })

  it('returns failed when ownerDocument is null (defensive) — evaluator NB hotfix', () => {
    // evaluator Partial NB 흡수 — 이전 placeholder (expect(true).toBe(true)) 는 실제 분기 cover 0.
    // 본 hotfix — minimal fake root 로 deserializeAnchor 의 ownerDocument === null 분기 실제 cover.
    const fakeRoot = {
      ownerDocument: null,
      textContent: ''
    } as unknown as Element
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [],
      endPath: [],
      startOffset: 0,
      endOffset: 0,
      selectedText: 'x',
      prefix: '',
      suffix: '',
      contentHash: '',
      contextHash: ''
    }
    const result = deserializeAnchor(fakeRoot, anchor)
    expect(result.range).toBeNull()
    expect(result.strategy).toBe('failed')
    expect(result.contentHashMatch).toBe(false)
  })
})

describe('highlightAnchor — round-trip', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('serialize → deserialize 정합 (single text)', () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const range = makeRange(text, 4, text, 9)
    const anchor = serializeRange(document.body, 'body', range)

    const result = deserializeAnchor(document.body, anchor)
    expect(result.range!.toString()).toBe('quick')
    expect(result.range!.startContainer).toBe(text)
    expect(result.range!.startOffset).toBe(4)
  })

  it('serialize → deserialize 정합 (start/end different text nodes)', () => {
    document.body.innerHTML = '<div><p>Hello </p><p>world!</p></div>'
    const a = document.querySelectorAll('p')[0].firstChild as Text
    const b = document.querySelectorAll('p')[1].firstChild as Text
    const range = makeRange(a, 0, b, 5)
    const anchor = serializeRange(document.body, 'body', range)

    const result = deserializeAnchor(document.body, anchor)
    expect(result.strategy).toBe('path')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('Hello world')
  })
})

/**
 * Sprint 016 M5 T23 — highlightAnchor 후속 edge case (codex 권고 정합 — renderer overlay 전제 안전망).
 */
describe('highlightAnchor — T23 후속 edge case', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('computeContentHash CRLF → LF normalize 동일 hash', () => {
    document.body.innerHTML = '<p>a\r\nb</p>'
    const crlf = computeContentHash(document.body)
    document.body.innerHTML = '<p>a\nb</p>'
    const lf = computeContentHash(document.body)
    expect(crlf).toBe(lf)
  })

  it('computeContentHash 다중 whitespace + tab → 단일 space normalize', () => {
    document.body.innerHTML = '<p>foo\t\t   bar</p>'
    const tabbed = computeContentHash(document.body)
    document.body.innerHTML = '<p>foo bar</p>'
    const single = computeContentHash(document.body)
    expect(tabbed).toBe(single)
  })

  it('computeContextHash 빈 입력도 deterministic + 64 hex char', () => {
    const h = computeContextHash('', '', '')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(computeContextHash('', '', ''))
  })

  it('extractContext surrogate pair (emoji) 안전 — Array.from 기준 CONTEXT_LEN', () => {
    // U+1F600 (😀) = 2 UTF-16 code units, Array.from 기준 1 char
    const emoji = '😀'.repeat(40) // Array.from 기준 40 chars, UTF-16 기준 80 code units
    const rootText = `${emoji}TARGET${emoji}`
    const { prefix, suffix } = extractContext(rootText, 'TARGET')
    // Array.from(prefix).length ≤ CONTEXT_LEN, surrogate pair 분리 0
    expect(Array.from(prefix).length).toBeLessThanOrEqual(CONTEXT_LEN)
    expect(Array.from(suffix).length).toBeLessThanOrEqual(CONTEXT_LEN)
    // 모든 emoji 가 온전한 single char (surrogate 분리 시 lone surrogate 발생)
    for (const ch of Array.from(prefix)) {
      expect(ch).toBe('😀')
    }
    for (const ch of Array.from(suffix)) {
      expect(ch).toBe('😀')
    }
  })

  it('serializeRange 가 selectedText 전체가 root.textContent 일 때도 동작', () => {
    document.body.innerHTML = '<p>only-content</p>'
    const text = document.querySelector('p')!.firstChild as Text
    const range = makeRange(text, 0, text, text.data.length)
    const anchor = serializeRange(document.body, 'body', range)
    expect(anchor.selectedText).toBe('only-content')
    // prefix/suffix 둘 다 ''
    expect(anchor.prefix).toBe('')
    expect(anchor.suffix).toBe('')
  })

  it('serializeRange end container 만 root 외부 시 throw', () => {
    document.body.innerHTML = '<p id="p1">inside</p>'
    const insideText = document.querySelector('#p1')!.firstChild as Text
    const detached = document.createElement('div')
    detached.textContent = 'outside'
    const outsideText = detached.firstChild as Text
    const range = document.createRange()
    range.setStart(insideText, 0)
    range.setEnd(outsideText, 5)
    expect(() => serializeRange(document.body, 'body', range)).toThrow(/iframe\/Shadow DOM/)
  })

  it('deserializeAnchor 가 root.textContent 가 empty 일 때도 graceful (failed)', () => {
    document.body.innerHTML = ''
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [0],
      endPath: [0],
      startOffset: 0,
      endOffset: 5,
      selectedText: 'gone',
      prefix: '',
      suffix: '',
      contentHash: 'stale',
      contextHash: 'stale'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.range).toBeNull()
    expect(result.strategy).toBe('failed')
  })

  it('deserializeAnchor path 가 element node 종점일 때 path fast path 거부 → fuzzy fallback', () => {
    // path 가 element 까지만 가도록 (text node 아님). selectedText 가 root 에 있으면 fuzzy 로 복원.
    document.body.innerHTML = '<p>The brown fox.</p>'
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [0], // <p> element 종점 (text node 아님)
      endPath: [0],
      startOffset: 0,
      endOffset: 5,
      selectedText: 'brown',
      prefix: 'The ',
      suffix: ' fox.',
      contentHash: computeContentHash(document.body),
      contextHash: 'irrelevant'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.contentHashMatch).toBe(true)
    // path fast path 거부 (text node 아님) → fuzzy fallback
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('brown')
  })

  it('deserializeAnchor path index 범위 초과 시 fuzzy fallback', () => {
    document.body.innerHTML = '<p>The quick brown fox.</p>'
    const anchor: HighlightAnchor = {
      rootSelector: 'body',
      startPath: [0, 100], // children 1개만 있는데 100 — out of bound
      endPath: [0, 100],
      startOffset: 0,
      endOffset: 5,
      selectedText: 'quick',
      prefix: 'The ',
      suffix: ' brown',
      contentHash: computeContentHash(document.body),
      contextHash: 'irrelevant'
    }
    const result = deserializeAnchor(document.body, anchor)
    expect(result.strategy).toBe('context-fuzzy')
    expect(result.range).not.toBeNull()
    expect(result.range!.toString()).toBe('quick')
  })

  it('round-trip 정합 — 다층 nested 같은 root 내부 (3-level)', () => {
    document.body.innerHTML =
      '<section><article><p>Deeply nested selection target word here.</p></article></section>'
    const text = document.querySelector('p')!.firstChild as Text
    const start = text.data.indexOf('target')
    const range = makeRange(text, start, text, start + 'target'.length)
    const anchor = serializeRange(document.body, 'body', range)
    expect(anchor.startPath).toEqual([0, 0, 0, 0])
    expect(anchor.endPath).toEqual([0, 0, 0, 0])

    const result = deserializeAnchor(document.body, anchor)
    expect(result.strategy).toBe('path')
    expect(result.range!.toString()).toBe('target')
  })

  it('sha256Hex 가 UTF-8 multi-byte 입력도 처리 (한글)', () => {
    const ko = sha256Hex('한글 입력')
    const en = sha256Hex('hangul input')
    expect(ko).toMatch(/^[0-9a-f]{64}$/)
    expect(ko).not.toBe(en)
    expect(sha256Hex('한글 입력')).toBe(ko)
  })
})
