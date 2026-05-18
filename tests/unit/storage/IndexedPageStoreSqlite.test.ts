/**
 * Sprint 015 M3-3 — IndexedPageStoreSqlite 단위 테스트.
 *
 * cover:
 *   - load (no-op)
 *   - upsertPage: created / unchanged / updated_changed
 *   - createVisit: 정상 + page 없음 throw + workspace mismatch throw
 *   - recordVisit 단일 TX (PRD §05.4.1) — Page UPSERT + Visit INSERT atomic
 *   - lookupPage / getPage / listVisits 시간순 정렬
 *   - countPages / countVisits (전체 + workspace 단위)
 *   - stats() 워크스페이스 단위 분리
 *   - deleteByWorkspace (visits CASCADE 동반)
 *   - clearAll
 *   - workspace_id 'default' string → defaultWorkspaceId UUID 매핑
 *   - 두 워크스페이스 격리 (격리 검증)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { DEFAULT_WORKSPACE_ID } from '../../../src/storage/IndexedPageStore'

interface Fx {
  fb: FlowbrowserDatabase
  store: IndexedPageStoreSqlite
  defaultWsId: string
  otherWsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  const other = fb.createWorkspace({ name: 'Other', icon: '🌶' })
  const store = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  return { fb, store, defaultWsId: defaultWs.id, otherWsId: other.id }
}

describe('IndexedPageStoreSqlite — construction', () => {
  it('throws when defaultWorkspaceId missing', () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    expect(
      () => new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: '' })
    ).toThrow(/defaultWorkspaceId required/)
    fb.close()
  })

  it('load() is no-op (idempotent + safe)', async () => {
    const fx = setup()
    await fx.store.load()
    await fx.store.load()
    fx.fb.close()
  })
})

describe('IndexedPageStoreSqlite — upsertPage', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('INSERT new page (action=created)', async () => {
    const { page, action } = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      title: 'A',
      content: 'hello world',
      lang: 'en'
    })
    expect(action).toBe('created')
    expect(page.id).toMatch(/[0-9a-f-]{36}/)
    expect(page.workspace_id).toBe(fx.defaultWsId)
    expect(page.url).toBe('https://x.test/a')
    expect(page.title).toBe('A')
    expect(page.content).toBe('hello world')
    expect(page.content_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(page.visited_count).toBe(1)
  })

  it('re-upsert same content → action=unchanged + visited_count++', async () => {
    const first = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      title: 'A',
      content: 'hello'
    })
    const second = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      title: 'A',
      content: 'hello'
    })
    expect(second.action).toBe('unchanged')
    expect(second.page.id).toBe(first.page.id)
    expect(second.page.visited_count).toBe(2)
    expect(second.page.updated_at).toBe(first.page.updated_at) // unchanged
  })

  it('re-upsert with different content → action=updated_changed + content_hash 갱신', async () => {
    const first = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'v1'
    })
    const second = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'v2 (changed)'
    })
    expect(second.action).toBe('updated_changed')
    expect(second.page.id).toBe(first.page.id)
    expect(second.page.content).toBe('v2 (changed)')
    expect(second.page.content_hash).not.toBe(first.page.content_hash)
    expect(second.page.visited_count).toBe(2)
  })

  it("workspace_id 'default' string → defaultWorkspaceId UUID 매핑", async () => {
    const { page } = await fx.store.upsertPage({
      workspace_id: DEFAULT_WORKSPACE_ID,
      url: 'https://x.test/a',
      content: 'c'
    })
    expect(page.workspace_id).toBe(fx.defaultWsId)
  })

  it('URL 정규화 (origin + pathname, query/fragment 제거)', async () => {
    const a = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a?q=1#frag',
      content: 'c'
    })
    const b = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    expect(b.action).toBe('unchanged') // 같은 정규화 URL → dedupe
    expect(b.page.id).toBe(a.page.id)
    expect(a.page.url).toBe('https://x.test/a')
  })

  it('빈 url → throw', async () => {
    await expect(
      fx.store.upsertPage({ workspace_id: fx.defaultWsId, url: '', content: 'c' })
    ).rejects.toThrow(/url required/)
  })
})

describe('IndexedPageStoreSqlite — recordVisit (단일 TX, PRD §05.4.1)', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('첫 방문 → action=created + page 1 + visit 1', async () => {
    const { page, visit, action } = await fx.store.recordVisit({
      url: 'https://x.test/a',
      content: 'c',
      workspace_id: fx.defaultWsId
    })
    expect(action).toBe('created')
    expect(page.visited_count).toBe(1)
    expect(visit.page_id).toBe(page.id)
    expect(visit.workspace_id).toBe(page.workspace_id)
    expect(fx.store.countPages()).toBe(1)
    expect(fx.store.countVisits()).toBe(1)
  })

  it('재방문 동일 본문 → action=unchanged + visited_count=2 + visits=2', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    const second = await fx.store.recordVisit({
      url: 'https://x.test/a',
      content: 'c',
      workspace_id: fx.defaultWsId
    })
    expect(second.action).toBe('unchanged')
    expect(second.page.visited_count).toBe(2)
    expect(fx.store.countVisits()).toBe(2)
  })

  it('재방문 본문 변경 → action=updated_changed + content/hash 갱신', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'v1', workspace_id: fx.defaultWsId })
    const second = await fx.store.recordVisit({
      url: 'https://x.test/a',
      content: 'v2',
      workspace_id: fx.defaultWsId
    })
    expect(second.action).toBe('updated_changed')
    expect(second.page.content).toBe('v2')
  })

  it('dwell_ms / visited_at 주입 정합', async () => {
    const ts = 1_700_000_000_000
    const { visit } = await fx.store.recordVisit({
      url: 'https://x.test/a',
      content: 'c',
      workspace_id: fx.defaultWsId,
      visited_at: ts,
      dwell_ms: 1234
    })
    expect(visit.visited_at).toBe(ts)
    expect(visit.dwell_ms).toBe(1234)
  })
})

describe('IndexedPageStoreSqlite — createVisit', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('없는 page_id → throw', async () => {
    await expect(
      fx.store.createVisit({ page_id: 'no-such-page', workspace_id: fx.defaultWsId })
    ).rejects.toThrow(/page not found/)
  })

  it('workspace mismatch → throw', async () => {
    const { page } = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    await expect(
      fx.store.createVisit({ page_id: page.id, workspace_id: fx.otherWsId })
    ).rejects.toThrow(/workspace mismatch/)
  })

  it('listVisits 시간순 정렬 (ASC)', async () => {
    const { page } = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    await fx.store.createVisit({
      page_id: page.id,
      workspace_id: fx.defaultWsId,
      visited_at: 3000
    })
    await fx.store.createVisit({
      page_id: page.id,
      workspace_id: fx.defaultWsId,
      visited_at: 1000
    })
    await fx.store.createVisit({
      page_id: page.id,
      workspace_id: fx.defaultWsId,
      visited_at: 2000
    })
    const visits = fx.store.listVisits(page.id)
    expect(visits.map((v) => v.visited_at)).toEqual([1000, 2000, 3000])
  })
})

describe('IndexedPageStoreSqlite — lookup / counts / stats', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('lookupPage hit + miss', async () => {
    const { page } = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    expect(fx.store.lookupPage(fx.defaultWsId, 'https://x.test/a')!.id).toBe(page.id)
    expect(fx.store.lookupPage(fx.defaultWsId, 'https://x.test/missing')).toBeNull()
  })

  it("lookupPage 'default' workspace 매핑", async () => {
    await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    expect(fx.store.lookupPage(DEFAULT_WORKSPACE_ID, 'https://x.test/a')).not.toBeNull()
  })

  it('getPage by id', async () => {
    const { page } = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'c'
    })
    expect(fx.store.getPage(page.id)?.id).toBe(page.id)
    expect(fx.store.getPage('no-such-id')).toBeNull()
  })

  it('countPages / countVisits 전체 + workspace 단위', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/b', content: 'c2', workspace_id: fx.otherWsId })
    expect(fx.store.countPages()).toBe(2)
    expect(fx.store.countVisits()).toBe(3)
    expect(fx.store.countPages(fx.defaultWsId)).toBe(1)
    expect(fx.store.countVisits(fx.defaultWsId)).toBe(2)
    expect(fx.store.countPages(fx.otherWsId)).toBe(1)
    expect(fx.store.countVisits(fx.otherWsId)).toBe(1)
  })

  it('stats() 워크스페이스 단위 분리', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/b', content: 'c', workspace_id: fx.otherWsId })
    await fx.store.recordVisit({ url: 'https://x.test/c', content: 'c', workspace_id: fx.otherWsId })
    const stats = fx.store.stats()
    expect(stats.pages).toBe(3)
    expect(stats.visits).toBe(3)
    expect(stats.perWorkspace[fx.defaultWsId]).toEqual({ pages: 1, visits: 1 })
    expect(stats.perWorkspace[fx.otherWsId]).toEqual({ pages: 2, visits: 2 })
  })
})

describe('IndexedPageStoreSqlite — delete', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('deleteByWorkspace 워크스페이스 단위 제거 (visits CASCADE)', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/b', content: 'c', workspace_id: fx.otherWsId })
    const removed = await fx.store.deleteByWorkspace(fx.defaultWsId)
    expect(removed).toEqual({ pages: 1, visits: 2 })
    expect(fx.store.countPages(fx.defaultWsId)).toBe(0)
    expect(fx.store.countVisits(fx.defaultWsId)).toBe(0)
    expect(fx.store.countPages(fx.otherWsId)).toBe(1) // 다른 워크스페이스 잔존
  })

  it('clearAll 전체 제거', async () => {
    await fx.store.recordVisit({ url: 'https://x.test/a', content: 'c', workspace_id: fx.defaultWsId })
    await fx.store.recordVisit({ url: 'https://x.test/b', content: 'c', workspace_id: fx.otherWsId })
    await fx.store.clearAll()
    expect(fx.store.countPages()).toBe(0)
    expect(fx.store.countVisits()).toBe(0)
  })

  it('flush no-op (sync 동작)', async () => {
    await fx.store.flush()
    await fx.store.flush()
  })
})

describe('IndexedPageStoreSqlite — workspace 격리', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('같은 URL 다른 워크스페이스 → 별도 page 행 (각 격리)', async () => {
    const a = await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/shared',
      content: 'A'
    })
    const b = await fx.store.upsertPage({
      workspace_id: fx.otherWsId,
      url: 'https://x.test/shared',
      content: 'B'
    })
    expect(a.page.id).not.toBe(b.page.id)
    expect(a.action).toBe('created')
    expect(b.action).toBe('created')
    expect(fx.store.countPages()).toBe(2)
  })

  it('lookupPage 워크스페이스 격리', async () => {
    await fx.store.upsertPage({
      workspace_id: fx.defaultWsId,
      url: 'https://x.test/a',
      content: 'A'
    })
    expect(fx.store.lookupPage(fx.defaultWsId, 'https://x.test/a')).not.toBeNull()
    expect(fx.store.lookupPage(fx.otherWsId, 'https://x.test/a')).toBeNull()
  })
})
