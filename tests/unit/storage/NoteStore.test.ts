/**
 * Sprint 015 M3-4 — NoteStore 단위 테스트.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'

interface Fx {
  fb: FlowbrowserDatabase
  store: NoteStore
  wsId: string
  otherWsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsId = fb.ensureDefaultWorkspace().id
  const otherWsId = fb.createWorkspace({ name: 'O', icon: '🅾' }).id
  return { fb, store: new NoteStore(fb), wsId, otherWsId }
}

describe('NoteStore', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('create 정상 — id/page_id null/visit_id null/created_by user 디폴트', () => {
    const n = fx.store.create({ workspace_id: fx.wsId, selected_text: 'hello' })
    expect(n.id).toMatch(/[0-9a-f-]{36}/)
    expect(n.page_id).toBeNull()
    expect(n.visit_id).toBeNull()
    expect(n.workspace_id).toBe(fx.wsId)
    expect(n.selected_text).toBe('hello')
    expect(n.body).toBeNull()
    expect(n.ai_tags).toBeNull()
    expect(n.created_by).toBe('user')
  })

  it('create with 3중 anchor (page+visit+workspace)', () => {
    const pageId = randomUUID()
    const visitId = randomUUID()
    fx.fb
      .getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(pageId, fx.wsId, 'https://x.test/a', Date.now(), Date.now())
    fx.fb
      .getDb()
      .prepare(`INSERT INTO visits(id, page_id, workspace_id, visited_at) VALUES (?, ?, ?, ?)`)
      .run(visitId, pageId, fx.wsId, Date.now())
    const n = fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'sel',
      page_id: pageId,
      visit_id: visitId
    })
    expect(n.page_id).toBe(pageId)
    expect(n.visit_id).toBe(visitId)
  })

  it('create ai_tags JSON 라운드트립', () => {
    const n = fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'sel',
      ai_tags: ['glossary', 'topic:CAR-T', 'domain:medicine']
    })
    const reread = fx.store.findById(n.id)
    expect(reread?.ai_tags).toEqual(['glossary', 'topic:CAR-T', 'domain:medicine'])
  })

  it("create 'migration' created_by", () => {
    const n = fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'glossary term',
      created_by: 'migration',
      ai_tags: ['glossary']
    })
    expect(n.created_by).toBe('migration')
  })

  it('create 빈 workspace_id / selected_text → throw', () => {
    expect(() => fx.store.create({ workspace_id: '', selected_text: 's' })).toThrow(
      /workspace_id required/
    )
    expect(() => fx.store.create({ workspace_id: fx.wsId, selected_text: '' })).toThrow(
      /selected_text required/
    )
  })

  it('listByWorkspace DESC + workspace 격리', () => {
    fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'a',
      created_at: 1000
    })
    fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'b',
      created_at: 2000
    })
    fx.store.create({
      workspace_id: fx.otherWsId,
      selected_text: 'c',
      created_at: 1500
    })
    const list = fx.store.listByWorkspace(fx.wsId)
    expect(list.map((n) => n.selected_text)).toEqual(['b', 'a'])
    expect(fx.store.listByWorkspace(fx.otherWsId).map((n) => n.selected_text)).toEqual(['c'])
  })

  it('update body / ai_tags 부분 갱신', () => {
    const n = fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 'sel',
      body: 'old',
      ai_tags: ['oldtag']
    })
    const u1 = fx.store.update({ id: n.id, body: 'new' })
    expect(u1.body).toBe('new')
    expect(u1.ai_tags).toEqual(['oldtag']) // unchanged
    const u2 = fx.store.update({ id: n.id, ai_tags: ['newtag'] })
    expect(u2.body).toBe('new') // unchanged
    expect(u2.ai_tags).toEqual(['newtag'])
  })

  it('update 없는 id → throw', () => {
    expect(() => fx.store.update({ id: randomUUID(), body: 'x' })).toThrow(/not found/)
  })

  it('delete + countByWorkspace', () => {
    const n1 = fx.store.create({ workspace_id: fx.wsId, selected_text: 'a' })
    fx.store.create({ workspace_id: fx.wsId, selected_text: 'b' })
    expect(fx.store.countByWorkspace(fx.wsId)).toBe(2)
    expect(fx.store.delete(n1.id)).toBe(true)
    expect(fx.store.delete(randomUUID())).toBe(false)
    expect(fx.store.countByWorkspace(fx.wsId)).toBe(1)
  })

  it('listByPage 페이지 anchor 노트 조회', () => {
    const pageId = randomUUID()
    fx.fb
      .getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(pageId, fx.wsId, 'https://x.test/a', Date.now(), Date.now())
    fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 's1',
      page_id: pageId,
      created_at: 100
    })
    fx.store.create({
      workspace_id: fx.wsId,
      selected_text: 's2',
      page_id: pageId,
      created_at: 200
    })
    fx.store.create({ workspace_id: fx.wsId, selected_text: 'unrelated' })
    const list = fx.store.listByPage(pageId)
    expect(list.map((n) => n.selected_text)).toEqual(['s1', 's2'])
  })
})
