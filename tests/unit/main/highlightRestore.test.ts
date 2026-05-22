/**
 * Sprint 017 M1 T06 — runHighlightRestore 단위 회귀.
 *
 * cover:
 *   - destroyed webContents → null (graceful)
 *   - URL 빈 → null
 *   - non-http(s) scheme (file:, about:) → null
 *   - store null → null
 *   - workspaceId null → null
 *   - records 0개 → null (executeJavaScript 미호출)
 *   - records 1개 + insertCSS + executeJavaScript 호출 + onResult 콜백 호출
 *   - insertCSS throw → executeJavaScript 그대로 호출 (graceful)
 *   - executeJavaScript throw → null (graceful, no throw propagate)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { HighlightStore } from '../../../src/storage/HighlightStore'
import { runHighlightRestore } from '../../../src/main/highlightRestore'
import type { HighlightAnchor } from '../../../src/perception/highlightAnchor'

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

interface WebContentsStub {
  isDestroyed: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
  insertCSS: ReturnType<typeof vi.fn>
  executeJavaScript: ReturnType<typeof vi.fn>
}

function makeWebContents(opts: {
  destroyed?: boolean
  url?: string
  insertCssImpl?: () => Promise<string>
  execImpl?: () => Promise<unknown>
}): WebContentsStub {
  return {
    isDestroyed: vi.fn(() => opts.destroyed ?? false),
    getURL: vi.fn(() => opts.url ?? 'https://example.com'),
    insertCSS: vi.fn(opts.insertCssImpl ?? (() => Promise.resolve('key'))),
    executeJavaScript: vi.fn(
      opts.execImpl ?? (() => Promise.resolve({ ok: true, registered: 1, apiSupported: true, details: [] }))
    )
  }
}

describe('runHighlightRestore — graceful no-op', () => {
  let store: HighlightStore
  beforeEach(() => {
    store = new HighlightStore()
  })

  it('destroyed webContents → null + executeJavaScript 미호출', async () => {
    const wc = makeWebContents({ destroyed: true })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('빈 URL → null', async () => {
    const wc = makeWebContents({ url: '' })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('file:// scheme → null', async () => {
    const wc = makeWebContents({ url: 'file:///tmp/test.html' })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('store null → null', async () => {
    const wc = makeWebContents({})
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => null }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('workspaceId null → null', async () => {
    const wc = makeWebContents({})
    const result = await runHighlightRestore(
       
      { workspaceId: null, webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('records 0개 → null + executeJavaScript 미호출', async () => {
    const wc = makeWebContents({ url: 'https://example.com' })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('runHighlightRestore — 정상 path', () => {
  it('records 1개 → insertCSS + executeJavaScript 호출 + onResult 콜백', async () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const wc = makeWebContents({ url: 'https://example.com' })
    const onResult = vi.fn()
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store },
      { onResult }
    )
    expect(wc.insertCSS).toHaveBeenCalledTimes(1)
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('insertCSS throw → executeJavaScript 그대로 호출 (graceful)', async () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const wc = makeWebContents({
      url: 'https://example.com',
      insertCssImpl: () => Promise.reject(new Error('boom'))
    })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  it('executeJavaScript throw → null (graceful, throw propagate 차단)', async () => {
    const store = new HighlightStore()
    store.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: 'ws1',
      createdAt: 1
    })
    const wc = makeWebContents({
      url: 'https://example.com',
      execImpl: () => Promise.reject(new Error('exec failed'))
    })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
  })

  it('Sprint 017 M2 T10 — clearWhenEmpty=true + records=0 → buildRestoreScript([]) inject (SPA stale clear path)', async () => {
    const store = new HighlightStore()
    const wc = makeWebContents({ url: 'https://example.com' })
    const result = await runHighlightRestore(

      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store },
      { clearWhenEmpty: true }
    )
    // records=0 이라도 inject 강제 — buildRestoreScript 내부 prefix clear path 동작.
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1)
    // CSS 룰은 빈 ids → buildHighlightCssForIds 결과 빈 string → insertCSS 미호출.
    expect(wc.insertCSS).not.toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('Sprint 017 M2 T10 — clearWhenEmpty=false (default) + records=0 → 기존대로 early null', async () => {
    const store = new HighlightStore()
    const wc = makeWebContents({ url: 'https://example.com' })
    const result = await runHighlightRestore(

      { workspaceId: 'ws1', webContents: wc as any },
      { getHighlightStore: () => store }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })

  it('listByPage throw (HighlightStore inconsistent) → null (graceful)', async () => {
    // store.listByPage 자체가 throw 하도록 stub.
    const stubStore = {
      listByPage: vi.fn(() => {
        throw new Error('store inconsistent')
      })
    }
    const wc = makeWebContents({ url: 'https://example.com' })
    const result = await runHighlightRestore(
       
      { workspaceId: 'ws1', webContents: wc as any },
       
      { getHighlightStore: () => stubStore as any }
    )
    expect(result).toBeNull()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
})
