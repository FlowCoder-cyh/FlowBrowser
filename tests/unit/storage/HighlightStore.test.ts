import { describe, it, expect, beforeEach } from 'vitest'
import { HighlightStore } from '../../../src/storage/HighlightStore'
import type { HighlightAnchor } from '../../../src/perception/highlightAnchor'

/**
 * Sprint 016 M4 T20 — HighlightStore (in-memory) 단위 회귀.
 *
 * codex 사전 협의 (threadId 019e4a06) 정합:
 *   - id 는 highlight 자체 발급 (noteId 1:1 강제 X)
 *   - listByPage 는 workspaceId + (pageId 또는 url+contentHash) 강제 — cross-page 노출 차단
 *   - contentHash 단독 list 금지
 */

function makeAnchor(overrides: Partial<HighlightAnchor> = {}): HighlightAnchor {
  return {
    rootSelector: 'body',
    startPath: [0, 0],
    endPath: [0, 0],
    startOffset: 0,
    endOffset: 5,
    selectedText: 'quick',
    prefix: 'The ',
    suffix: ' brown fox',
    contentHash: 'a'.repeat(64),
    contextHash: 'b'.repeat(64),
    ...overrides
  }
}

describe('HighlightStore — add validation', () => {
  it('throws when workspaceId missing', () => {
    const store = new HighlightStore()
    expect(() =>
      store.add({
        noteId: 'n1',
        pageId: 'p1',
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor(),
        workspaceId: ''
      })
    ).toThrow(/workspaceId required/)
  })

  it('throws when noteId missing', () => {
    const store = new HighlightStore()
    expect(() =>
      store.add({
        noteId: '',
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor(),
        workspaceId: 'ws1'
      })
    ).toThrow(/noteId required/)
  })

  it('throws when url missing', () => {
    const store = new HighlightStore()
    expect(() =>
      store.add({
        noteId: 'n1',
        url: '',
        contentHash: 'h',
        anchor: makeAnchor(),
        workspaceId: 'ws1'
      })
    ).toThrow(/url required/)
  })

  it('throws when contentHash missing', () => {
    const store = new HighlightStore()
    expect(() =>
      store.add({
        noteId: 'n1',
        url: 'https://example.com',
        contentHash: '',
        anchor: makeAnchor(),
        workspaceId: 'ws1'
      })
    ).toThrow(/contentHash required/)
  })

  it('throws on duplicate id', () => {
    const store = new HighlightStore()
    const input = {
      id: 'fixed-id',
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    }
    store.add(input)
    expect(() => store.add(input)).toThrow(/duplicate id/)
  })
})

describe('HighlightStore — add success', () => {
  let store: HighlightStore
  beforeEach(() => {
    store = new HighlightStore()
  })

  it('auto-generates id when not provided', () => {
    const record = store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(record.id).toMatch(/^[0-9a-f-]+$/)
    expect(record.pageId).toBeNull()
    expect(record.createdAt).toBeGreaterThan(0)
  })

  it('honors explicit id + createdAt', () => {
    const record = store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: 'page1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1000
    })
    expect(record.id).toBe('h1')
    expect(record.pageId).toBe('page1')
    expect(record.createdAt).toBe(1000)
  })
})

describe('HighlightStore — get', () => {
  it('returns record when exists', () => {
    const store = new HighlightStore()
    const record = store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.get(record.id)).toEqual(record)
  })

  it('returns null when missing', () => {
    const store = new HighlightStore()
    expect(store.get('nonexistent')).toBeNull()
  })
})

describe('HighlightStore — listByPage', () => {
  let store: HighlightStore
  beforeEach(() => {
    store = new HighlightStore()
  })

  it('filters by pageId + workspaceId', () => {
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: 'pageA',
      url: 'https://a.com',
      contentHash: 'hA',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'n2',
      pageId: 'pageB',
      url: 'https://b.com',
      contentHash: 'hB',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 2
    })
    store.add({
      id: 'h3',
      noteId: 'n3',
      pageId: 'pageA',
      url: 'https://a.com',
      contentHash: 'hA',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 3
    })

    const result = store.listByPage({ workspaceId: 'ws1', pageId: 'pageA' })
    expect(result.map((r) => r.id)).toEqual(['h1', 'h3'])
  })

  it('filters by url + contentHash when pageId not provided', () => {
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: null,
      url: 'https://example.com/a',
      contentHash: 'hashA',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'n2',
      pageId: null,
      url: 'https://example.com/a',
      contentHash: 'hashB',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 2
    })

    const result = store.listByPage({
      workspaceId: 'ws1',
      url: 'https://example.com/a',
      contentHash: 'hashA'
    })
    expect(result.map((r) => r.id)).toEqual(['h1'])
  })

  it('filters by url alone (contentHash optional)', () => {
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: null,
      url: 'https://example.com/a',
      contentHash: 'hashA',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'n2',
      pageId: null,
      url: 'https://example.com/a',
      contentHash: 'hashB',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 2
    })

    const result = store.listByPage({ workspaceId: 'ws1', url: 'https://example.com/a' })
    expect(result).toHaveLength(2)
  })

  it('isolates by workspaceId', () => {
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: 'page1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'n2',
      pageId: 'page1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws2',
      createdAt: 2
    })

    const ws1Result = store.listByPage({ workspaceId: 'ws1', pageId: 'page1' })
    expect(ws1Result.map((r) => r.id)).toEqual(['h1'])
    const ws2Result = store.listByPage({ workspaceId: 'ws2', pageId: 'page1' })
    expect(ws2Result.map((r) => r.id)).toEqual(['h2'])
  })

  it('throws when workspaceId missing', () => {
    expect(() => store.listByPage({ workspaceId: '', pageId: 'p1' })).toThrow(/workspaceId required/)
  })

  it('throws when both pageId and url missing (cross-page exposure block)', () => {
    expect(() => store.listByPage({ workspaceId: 'ws1' })).toThrow(/pageId or url required/)
  })

  it('treats pageId:null as page-identity-missing and routes to url branch (codex dual review hotfix)', () => {
    // 이전 버전 — `filter.pageId !== undefined` 분기 — 가 pageId:null 명시 시 record.pageId===null
    // 매칭을 cross-URL 적용. 본 hotfix 후 pageId:null 은 url 분기 강제 → 다른 URL 노출 차단.
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: null,
      url: 'https://a.com',
      contentHash: 'hA',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'n2',
      pageId: null,
      url: 'https://b.com',
      contentHash: 'hB',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 2
    })

    const result = store.listByPage({
      workspaceId: 'ws1',
      pageId: null,
      url: 'https://a.com'
    })
    expect(result.map((r) => r.id)).toEqual(['h1'])
  })

  it('throws when pageId:null and url missing (codex dual review hotfix)', () => {
    expect(() => store.listByPage({ workspaceId: 'ws1', pageId: null })).toThrow(
      /pageId or url required/
    )
  })

  it('returns empty when nothing matches', () => {
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: 'page1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const result = store.listByPage({ workspaceId: 'ws1', pageId: 'pageX' })
    expect(result).toEqual([])
  })

  it('sorts by createdAt ascending', () => {
    store.add({
      id: 'late',
      noteId: 'n1',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 100
    })
    store.add({
      id: 'early',
      noteId: 'n2',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const result = store.listByPage({ workspaceId: 'ws1', pageId: 'p1' })
    expect(result.map((r) => r.id)).toEqual(['early', 'late'])
  })
})

describe('HighlightStore — listByNote (1:N)', () => {
  it('returns all highlights for a note (1:N supported)', () => {
    const store = new HighlightStore()
    store.add({
      id: 'h1',
      noteId: 'sameNote',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor({ selectedText: 'first' }),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'h2',
      noteId: 'sameNote',
      pageId: 'p2',
      url: 'https://b.com',
      contentHash: 'h2',
      anchor: makeAnchor({ selectedText: 'second' }),
      workspaceId: 'ws1',
      createdAt: 2
    })
    store.add({
      id: 'h3',
      noteId: 'otherNote',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 3
    })

    const result = store.listByNote('sameNote')
    expect(result.map((r) => r.id)).toEqual(['h1', 'h2'])
  })

  it('returns empty when noteId not present', () => {
    const store = new HighlightStore()
    expect(store.listByNote('nonexistent')).toEqual([])
  })
})

describe('HighlightStore — listByWorkspace', () => {
  it('returns workspace highlights sorted by createdAt asc', () => {
    const store = new HighlightStore()
    store.add({
      id: 'a',
      noteId: 'n1',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 5
    })
    store.add({
      id: 'b',
      noteId: 'n2',
      pageId: 'p2',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    store.add({
      id: 'c',
      noteId: 'n3',
      pageId: 'p3',
      url: 'https://c.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws2',
      createdAt: 2
    })

    const result = store.listByWorkspace('ws1')
    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('HighlightStore — remove / clear / size', () => {
  it('remove returns true when present, false when absent', () => {
    const store = new HighlightStore()
    const record = store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.remove(record.id)).toBe(true)
    expect(store.remove(record.id)).toBe(false)
    expect(store.get(record.id)).toBeNull()
  })

  it('clear empties everything', () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    store.add({
      noteId: 'n2',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.size()).toBe(2)
    store.clear()
    expect(store.size()).toBe(0)
  })
})
