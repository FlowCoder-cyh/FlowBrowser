/**
 * Sprint 015 M2-2 — PageResultStore 어댑터 모드 회귀.
 *
 * 검증:
 *   - backend 미주입: 기존 v0.3 JSON 동작 100% 보존 (기존 PageResultStore.test 그대로 PASS)
 *   - backend 주입: store() 시 IndexedPageStore 에 Page + Visit side-write
 *   - instructions / nodesSignature / selectorPreset 은 v0.3 JSON 그대로 (어댑터 영향 X)
 *   - workspace_id 미주입 시 DEFAULT_WORKSPACE_ID ('default') 사용
 *   - backend side-write 실패는 v0.3 결과에 영향 X
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PageResultStore } from '../../../src/storage/PageResultStore'
import {
  IndexedPageStore,
  DEFAULT_WORKSPACE_ID
} from '../../../src/storage/IndexedPageStore'

describe('PageResultStore (adapter mode, backend = IndexedPageStore)', () => {
  let legacyPath: string
  let backendPath: string

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    legacyPath = join(tmpdir(), `prs-adapter-legacy-${suffix}.json`)
    backendPath = join(tmpdir(), `prs-adapter-backend-${suffix}.json`)
  })

  afterEach(async () => {
    for (const p of [legacyPath, backendPath]) {
      try {
        await fs.unlink(p)
      } catch {
        // ignore
      }
    }
  })

  async function makeAdapter(workspaceId?: string) {
    const backend = new IndexedPageStore(backendPath)
    await backend.load()
    const prs = new PageResultStore(legacyPath, {
      indexedPageStoreBackend: backend,
      defaultWorkspaceId: workspaceId
    })
    await prs.load()
    return { prs, backend }
  }

  it('isAdapterMode() returns true only when backend is injected', async () => {
    const prsLegacy = new PageResultStore(legacyPath)
    await prsLegacy.load()
    expect(prsLegacy.isAdapterMode()).toBe(false)

    const { prs } = await makeAdapter()
    expect(prs.isAdapterMode()).toBe(true)
  })

  it('store() side-writes Page + Visit to IndexedPageStore (default workspace)', async () => {
    const { prs, backend } = await makeAdapter()
    await prs.store({
      url: 'https://example.com/a?x=1',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig-1',
      selectorPreset: 'page',
      instructions: [{ id: 'n1', translatedText: '안녕' }],
      pageTitle: 'A',
      pageContent: 'hello',
      pageLang: 'en'
    })
    expect(backend.countPages()).toBe(1)
    expect(backend.countVisits()).toBe(1)
    const page = backend.lookupPage(DEFAULT_WORKSPACE_ID, 'https://example.com/a')
    expect(page?.title).toBe('A')
    expect(page?.content).toBe('hello')
    expect(page?.lang).toBe('en')
    expect(page?.visited_count).toBe(1)
  })

  it('store() uses explicit workspaceId when provided', async () => {
    const { prs, backend } = await makeAdapter()
    await prs.store({
      workspaceId: 'ws-1',
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: []
    })
    expect(backend.countPages('ws-1')).toBe(1)
    expect(backend.countPages(DEFAULT_WORKSPACE_ID)).toBe(0)
  })

  it('multiple store() calls accumulate Visits (visited_count++) on same URL', async () => {
    const { prs, backend } = await makeAdapter()
    for (let i = 0; i < 3; i++) {
      await prs.store({
        url: 'https://example.com/a',
        targetLanguage: 'ko',
        providerType: 'openai',
        nodesSignature: 'sig',
        selectorPreset: 'page',
        instructions: [],
        pageContent: 'same body' // 동일 content → unchanged
      })
    }
    expect(backend.countPages()).toBe(1)
    expect(backend.countVisits()).toBe(3)
    const page = backend.lookupPage(DEFAULT_WORKSPACE_ID, 'https://example.com/a')
    expect(page?.visited_count).toBe(3)
  })

  it('content change triggers Page update (updated_changed)', async () => {
    const { prs, backend } = await makeAdapter()
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [],
      pageContent: 'v1'
    })
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [],
      pageContent: 'v2'
    })
    const page = backend.lookupPage(DEFAULT_WORKSPACE_ID, 'https://example.com/a')
    expect(page?.content).toBe('v2')
    expect(page?.visited_count).toBe(2)
  })

  it('lookup() still returns v0.3 entry (instructions preserved) regardless of backend', async () => {
    const { prs } = await makeAdapter()
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [{ id: 'n1', translatedText: '안녕' }],
      pageContent: 'hello'
    })
    const hit = await prs.lookup({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig'
    })
    expect(hit?.instructions).toEqual([{ id: 'n1', translatedText: '안녕' }])
  })

  it('backend side-write failure does not propagate to v0.3 store() result + increments sideWriteFailureCount', async () => {
    const { prs, backend } = await makeAdapter()
    // M2-2 codex 핫픽스: recordVisit 가 실패하도록 강제 (sideWrite 가 recordVisit 사용)
    const recordSpy = vi.spyOn(backend, 'recordVisit').mockRejectedValueOnce(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(prs.sideWriteFailureCount()).toBe(0)
    const entry = await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [{ id: 'n', translatedText: 't' }],
      pageContent: 'v'
    })
    expect(entry.instructions).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
    expect(prs.sideWriteFailureCount()).toBe(1)
    recordSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('side-write uses recordVisit (PRD §05.4.1 단일 TX) — atomic Page UPSERT + Visit INSERT', async () => {
    const { prs, backend } = await makeAdapter()
    const recordSpy = vi.spyOn(backend, 'recordVisit')
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [],
      pageTitle: 'T',
      pageContent: 'C',
      pageLang: 'en'
    })
    expect(recordSpy).toHaveBeenCalledTimes(1)
    const callArg = recordSpy.mock.calls[0][0]
    expect(callArg.url).toBe('https://example.com/a')
    expect(callArg.title).toBe('T')
    expect(callArg.content).toBe('C')
    expect(callArg.lang).toBe('en')
    // Page + Visit 둘 다 생성 (단일 TX)
    expect(backend.countPages()).toBe(1)
    expect(backend.countVisits()).toBe(1)
    recordSpy.mockRestore()
  })

  it('store() with no backend (v0.3 mode) does NOT touch IndexedPageStore', async () => {
    const prsLegacy = new PageResultStore(legacyPath)
    await prsLegacy.load()
    await prsLegacy.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: []
    })
    // backendPath 는 미생성
    await expect(fs.readFile(backendPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clearAll() in adapter mode does NOT clear IndexedPageStore (v0.3 격리)', async () => {
    const { prs, backend } = await makeAdapter()
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [],
      pageContent: 'v'
    })
    await prs.clearAll()
    expect(prs.size()).toBe(0)
    // backend 는 그대로 유지 — 어댑터 모드의 clear 는 v0.3 JSON 만
    expect(backend.countPages()).toBe(1)
  })

  it('defaultWorkspaceId option overrides DEFAULT_WORKSPACE_ID for side-write', async () => {
    const { prs, backend } = await makeAdapter('📥 기본')
    await prs.store({
      url: 'https://example.com/a',
      targetLanguage: 'ko',
      providerType: 'openai',
      nodesSignature: 'sig',
      selectorPreset: 'page',
      instructions: [],
      pageContent: 'v'
    })
    expect(backend.countPages('📥 기본')).toBe(1)
    expect(backend.countPages(DEFAULT_WORKSPACE_ID)).toBe(0)
  })
})
