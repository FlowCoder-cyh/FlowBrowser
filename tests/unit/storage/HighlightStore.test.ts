import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

  /**
   * Sprint 016 M5 T23 — HighlightStore 후속 edge case.
   * codex 사전 협의 권고 — T20 후속 안전망 (renderer overlay/SQLite swap 전제).
   */
  it('throws when adding duplicate explicit id', () => {
    const store = new HighlightStore()
    store.add({
      id: 'dup',
      noteId: 'n1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(() =>
      store.add({
        id: 'dup',
        noteId: 'n2',
        url: 'https://b.com',
        contentHash: 'h2',
        anchor: makeAnchor(),
        workspaceId: 'ws1'
      })
    ).toThrow(/duplicate id=dup/)
  })

  it('listByNote returns empty after removing the last highlight of that note', () => {
    const store = new HighlightStore()
    const r = store.add({
      noteId: 'noteX',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.listByNote('noteX')).toHaveLength(1)
    store.remove(r.id)
    expect(store.listByNote('noteX')).toEqual([])
  })

  it('listByPage no longer returns removed record', () => {
    const store = new HighlightStore()
    const a = store.add({
      noteId: 'n1',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    store.add({
      noteId: 'n2',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    store.remove(a.id)
    const remaining = store.listByPage({ workspaceId: 'ws1', pageId: 'p1' })
    expect(remaining.map((r) => r.noteId)).toEqual(['n2'])
  })

  it('listByWorkspace returns empty array when workspace has no highlights', () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.listByWorkspace('ws-empty')).toEqual([])
  })

  it('listByNote sorts by createdAt ascending across multi-page notes', () => {
    const store = new HighlightStore()
    store.add({
      id: 'late',
      noteId: 'multi',
      pageId: 'p2',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 999
    })
    store.add({
      id: 'mid',
      noteId: 'multi',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 50
    })
    store.add({
      id: 'early',
      noteId: 'multi',
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    expect(store.listByNote('multi').map((r) => r.id)).toEqual(['early', 'mid', 'late'])
  })

  it("listByPage with pageId='' normalize → null + url 분기 강제 (Sprint 017 T02 — 이전 '== null' 분기에서 변경)", () => {
    // Sprint 017 T02 normalize 적용 — `''` 와 whitespace-only 는 "pageId 미지정" 으로 강제.
    // add 시점에서 pageId='' → null normalize 되고, listByPage 도 filter.pageId='' → null normalize.
    // 결과: 'pageId or url required' throw (url 분기 강제).
    const store = new HighlightStore()
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: '', // add 경계에서 null 로 normalize 됨
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    // record.pageId 는 null. filter.pageId='' 도 null normalize → url 미지정 시 throw.
    expect(() => store.listByPage({ workspaceId: 'ws1', pageId: '' })).toThrow(
      /pageId or url required/
    )
    // url 동반 제공 시 정상 — pageId='' → null → url 분기.
    const result = store.listByPage({ workspaceId: 'ws1', pageId: '', url: 'https://a.com' })
    expect(result.map((r) => r.id)).toEqual(['h1'])
  })

  it('clear keeps the store usable for subsequent add', () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    store.clear()
    expect(store.size()).toBe(0)
    const r = store.add({
      noteId: 'n2',
      url: 'https://b.com',
      contentHash: 'h2',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(store.size()).toBe(1)
    expect(store.get(r.id)?.noteId).toBe('n2')
  })

  it('size 0 on a fresh store', () => {
    expect(new HighlightStore().size()).toBe(0)
  })

  it('listByPage workspaceId scope is strict — workspace match required even with same pageId', () => {
    const store = new HighlightStore()
    store.add({
      id: 'a',
      noteId: 'n1',
      pageId: 'shared',
      url: 'https://x.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws-a',
      createdAt: 1
    })
    store.add({
      id: 'b',
      noteId: 'n2',
      pageId: 'shared',
      url: 'https://x.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws-b',
      createdAt: 2
    })
    expect(store.listByPage({ workspaceId: 'ws-a', pageId: 'shared' }).map((r) => r.id)).toEqual([
      'a'
    ])
    expect(store.listByPage({ workspaceId: 'ws-b', pageId: 'shared' }).map((r) => r.id)).toEqual([
      'b'
    ])
  })

  it('add throws when anchor is null/undefined explicitly', () => {
    const store = new HighlightStore()
    expect(() =>
      store.add({
        noteId: 'n1',
        url: 'https://a.com',
        contentHash: 'h',
        anchor: null as unknown as ReturnType<typeof makeAnchor>,
        workspaceId: 'ws1'
      })
    ).toThrow(/anchor required/)
  })
})

// Sprint 017 T02 — storage 경계 normalize.
describe('HighlightStore — pageId normalize (Sprint 017 T02)', () => {
  it("add: pageId='' → record.pageId=null (storage 경계 normalize)", () => {
    const store = new HighlightStore()
    const record = store.add({
      noteId: 'n1',
      pageId: '',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(record.pageId).toBeNull()
  })

  it("add: pageId='  page-abc  ' → record.pageId='page-abc' (trim)", () => {
    const store = new HighlightStore()
    const record = store.add({
      noteId: 'n1',
      pageId: '  page-abc  ',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1'
    })
    expect(record.pageId).toBe('page-abc')
  })

  it("listByPage: filter.pageId='' → 'pageId or url required' throw (url 분기 강제)", () => {
    const store = new HighlightStore()
    expect(() => store.listByPage({ workspaceId: 'ws1', pageId: '' })).toThrow(
      /pageId or url required/
    )
  })

  it("listByPage: filter.pageId='   ' (whitespace) + url 제공 → url 분기 동작", () => {
    const store = new HighlightStore()
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: null,
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    // filter.pageId='   ' 가 normalize 되어 null → url 분기 호출됨.
    const result = store.listByPage({
      workspaceId: 'ws1',
      pageId: '   ',
      url: 'https://a.com'
    })
    expect(result.map((r) => r.id)).toEqual(['h1'])
  })

  it("listByPage: filter.pageId='  page-abc  ' → trim 적용 후 매칭", () => {
    const store = new HighlightStore()
    store.add({
      id: 'h1',
      noteId: 'n1',
      pageId: 'page-abc',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const result = store.listByPage({ workspaceId: 'ws1', pageId: '  page-abc  ' })
    expect(result.map((r) => r.id)).toEqual(['h1'])
  })
})

/**
 * Sprint 017 M1 T07 — HighlightStore SQLite-backed 단위 회귀.
 *
 * codex 019e4dd1 #4 정합 — fb 주입 시 SQLite backend, 미주입 시 in-memory fallback (기존 70+ 케이스 무변경).
 * 본 describe block 은 fb 주입 path 만 cover.
 *
 * cover 매트릭스:
 *   1. SQLite 영속 (insert → query) 정합
 *   2. anchor JSON round-trip (HighlightAnchor 모든 필드 보존)
 *   3. workspace_id FK CASCADE (워크스페이스 삭제 시 highlights 동반 삭제)
 *   4. note_id FK CASCADE (노트 삭제 시 동반 삭제)
 *   5. page_id FK SET NULL (페이지 삭제 시 pageId 만 null, record 유지)
 *   6. listByPage SQLite 세 분기 (pageId / url+contentHash / url 단독)
 *   7. duplicate id throw (SQLite UNIQUE constraint 메시지 통일)
 *   8. listByWorkspace / listByNote / remove / clear / size SQLite path
 */
describe('HighlightStore — SQLite-backed path (Sprint 017 M1 T07)', () => {
  // 실 SQLite 의존 — better-sqlite3 + sqlite-vec native 필요.
  // happy-dom 환경에서는 동작 X — 본 describe 는 node 환경 (vitest 기본) 에서만 실행.
  let fb: import('../../../src/storage/Database').FlowbrowserDatabase
  let wsId: string
  let noteId: string

  /** 단위 테스트 시 pages row 도 박힘 — page_id FK 위반 차단. id='page-1' / id='p1' / id='p2' 3종 사전 박음. */
  beforeEach(async () => {
    const { FlowbrowserDatabase } = await import('../../../src/storage/Database')
    fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    wsId = ws.id
    const db = fb.getDb()
    // note insert (FK 정합 위해)
    const noteUuid = `n_${Date.now()}`
    db.prepare(
      `INSERT INTO notes(id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, created_at, created_by)
       VALUES (?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`
    ).run(noteUuid, wsId, 'sel', 1000, 'user')
    noteId = noteUuid
    // pages row 박힘 — FK 정합 (highlight.page_id REFERENCES pages(id))
    for (const pid of ['page-1', 'p1', 'p2']) {
      db.prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, '', '', NULL, NULL, 1, ?, ?)`
      ).run(pid, wsId, `https://example.com/${pid}`, 1000, 1000)
    }
  })

  afterEach(() => {
    fb.close()
  })

  it('SQLite-backed: add → get → 영속 정합 (anchor JSON round-trip)', () => {
    const store = new HighlightStore(fb)
    const anchor = makeAnchor({
      startPath: [1, 2, 3],
      endPath: [1, 2, 4],
      selectedText: '한글 + emoji 🎯',
      prefix: '컨텍스트 좌측',
      suffix: 'right 우측'
    })
    const record = store.add({
      id: 'h-sqlite-1',
      noteId,
      pageId: 'page-1',
      url: 'https://example.com',
      contentHash: 'hash-1',
      anchor,
      workspaceId: wsId,
      createdAt: 5000
    })
    expect(record.id).toBe('h-sqlite-1')
    const fetched = store.get('h-sqlite-1')
    expect(fetched).not.toBeNull()
    expect(fetched!.anchor.startPath).toEqual([1, 2, 3])
    expect(fetched!.anchor.selectedText).toBe('한글 + emoji 🎯')
    expect(fetched!.anchor.prefix).toBe('컨텍스트 좌측')
    expect(fetched!.anchor.suffix).toBe('right 우측')
    expect(fetched!.pageId).toBe('page-1')
    expect(fetched!.createdAt).toBe(5000)
  })

  it('SQLite-backed: workspace_id FK CASCADE — 워크스페이스 삭제 시 highlights 동반 삭제', () => {
    const store = new HighlightStore(fb)
    store.add({
      id: 'h-cascade-ws',
      noteId,
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 1
    })
    expect(store.size()).toBe(1)
    fb.getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(wsId)
    expect(store.size()).toBe(0)
  })

  it('SQLite-backed: note_id FK CASCADE — 노트 삭제 시 highlights 동반 삭제', () => {
    const store = new HighlightStore(fb)
    store.add({
      id: 'h-cascade-note',
      noteId,
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 1
    })
    expect(store.size()).toBe(1)
    fb.getDb().prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    expect(store.size()).toBe(0)
  })

  it('SQLite-backed: page_id FK SET NULL — 페이지 삭제 시 highlight record 유지 + pageId 만 null', () => {
    // page-1 은 beforeEach 에서 박힘. 삭제 후 highlight.page_id 가 SET NULL 동작 검증.
    const store = new HighlightStore(fb)
    store.add({
      id: 'h-page',
      noteId,
      pageId: 'page-1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 1
    })
    fb.getDb().prepare('DELETE FROM pages WHERE id = ?').run('page-1')
    const fetched = store.get('h-page')
    expect(fetched).not.toBeNull()
    expect(fetched!.pageId).toBeNull()
    expect(fetched!.url).toBe('https://a.com')
  })

  it('SQLite-backed: listByPage 세 분기 (pageId / url+contentHash / url 단독) 모두 SQLite 쿼리 통과', () => {
    const store = new HighlightStore(fb)
    store.add({
      id: 'h-byPageId',
      noteId,
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'hA',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 1
    })
    store.add({
      id: 'h-byUrl',
      noteId,
      pageId: null,
      url: 'https://a.com',
      contentHash: 'hB',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 2
    })
    // pageId 분기
    expect(store.listByPage({ workspaceId: wsId, pageId: 'p1' }).map((r) => r.id)).toEqual([
      'h-byPageId'
    ])
    // url+contentHash 분기
    expect(
      store
        .listByPage({ workspaceId: wsId, url: 'https://a.com', contentHash: 'hB' })
        .map((r) => r.id)
    ).toEqual(['h-byUrl'])
    // url 단독 분기 — 두 record 모두 매칭
    expect(store.listByPage({ workspaceId: wsId, url: 'https://a.com' }).map((r) => r.id)).toEqual([
      'h-byPageId',
      'h-byUrl'
    ])
  })

  it('SQLite-backed: duplicate id throw (UNIQUE constraint 메시지 통일)', () => {
    const store = new HighlightStore(fb)
    store.add({
      id: 'dup-sqlite',
      noteId,
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId
    })
    expect(() =>
      store.add({
        id: 'dup-sqlite',
        noteId,
        url: 'https://a.com',
        contentHash: 'h',
        anchor: makeAnchor(),
        workspaceId: wsId
      })
    ).toThrow(/duplicate id=dup-sqlite/)
  })

  it('SQLite-backed: listByNote / listByWorkspace / remove / clear / size 동작', () => {
    const store = new HighlightStore(fb)
    store.add({
      id: 'h1',
      noteId,
      pageId: 'p1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 10
    })
    store.add({
      id: 'h2',
      noteId,
      pageId: 'p2',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId,
      createdAt: 5
    })
    expect(store.listByNote(noteId).map((r) => r.id)).toEqual(['h2', 'h1']) // createdAt 오름차순
    expect(store.listByWorkspace(wsId).map((r) => r.id)).toEqual(['h2', 'h1'])
    expect(store.size()).toBe(2)
    expect(store.remove('h2')).toBe(true)
    expect(store.remove('h2')).toBe(false)
    expect(store.size()).toBe(1)
    store.clear()
    expect(store.size()).toBe(0)
  })

  it('inMemoryForFallback factory — codex 019e4e82 NOTABLE #5: production footgun 차단 명시 path', () => {
    const fallback = HighlightStore.inMemoryForFallback()
    // factory 결과는 in-memory (fb 미주입) — add 후 SQLite 영속 X.
    expect(fallback.size()).toBe(0)
    fallback.add({
      noteId: 'fallback-n1',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws-fb'
    })
    expect(fallback.size()).toBe(1)
    // factory + 직접 new 둘 다 동일 in-memory 동작
    const direct = new HighlightStore()
    direct.add({
      noteId: 'direct-n1',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws-fb'
    })
    expect(direct.size()).toBe(1)
    // 격리 — 별개 인스턴스
    expect(fallback.listByNote('direct-n1')).toEqual([])
  })

  it('SQLite-backed: pageId normalize ("  ws  " → trim "ws", "" → null) SQLite 영속 정합', () => {
    // page-trim 박힘 (FK 정합)
    fb.getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, ?, '', '', NULL, NULL, 1, ?, ?)`
      )
      .run('page-trim', wsId, 'https://example.com/page-trim', 1000, 1000)
    const store = new HighlightStore(fb)
    const rec = store.add({
      id: 'h-norm',
      noteId,
      pageId: '  page-trim  ',
      url: 'https://a.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId
    })
    expect(rec.pageId).toBe('page-trim')
    const fetched = store.get('h-norm')
    expect(fetched!.pageId).toBe('page-trim')

    const rec2 = store.add({
      id: 'h-empty-page',
      noteId,
      pageId: '',
      url: 'https://b.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: wsId
    })
    expect(rec2.pageId).toBeNull()
  })
})
