/**
 * Sprint 015 M3-4 — TagStore 단위 테스트.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { TagStore, TAG_KINDS } from '../../../src/storage/TagStore'

interface Fx {
  fb: FlowbrowserDatabase
  store: TagStore
  wsId: string
  otherWsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsId = fb.ensureDefaultWorkspace().id
  const otherWsId = fb.createWorkspace({ name: 'O', icon: '🅾' }).id
  return { fb, store: new TagStore(fb), wsId, otherWsId }
}

function insertPage(fb: FlowbrowserDatabase, wsId: string): string {
  const id = randomUUID()
  fb.getDb()
    .prepare(`INSERT INTO pages(id, workspace_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, wsId, `https://x.test/${id}`, Date.now(), Date.now())
  return id
}

function insertNote(fb: FlowbrowserDatabase, wsId: string): string {
  const id = randomUUID()
  fb.getDb()
    .prepare(
      `INSERT INTO notes(id, workspace_id, selected_text, created_at, created_by) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, wsId, 's', Date.now(), 'user')
  return id
}

describe('TagStore', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('TAG_KINDS 6종 정합', () => {
    expect(TAG_KINDS).toEqual([
      'topic',
      'entity',
      'metric',
      'sentiment',
      'domain',
      'freeform'
    ])
  })

  it('ensureTag 신규 생성 + 두 번째 호출 idempotent', () => {
    const a = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'CAR-T', kind: 'topic' })
    const b = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'CAR-T', kind: 'topic' })
    expect(a.id).toBe(b.id)
    expect(fx.store.listByWorkspace(fx.wsId)).toHaveLength(1)
  })

  it('ensureTag UNIQUE 격리 — 같은 name 다른 kind = 별도 row', () => {
    const a = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'X', kind: 'topic' })
    const b = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'X', kind: 'domain' })
    expect(a.id).not.toBe(b.id)
  })

  it('ensureTag workspace 격리 — 같은 (kind, name) 다른 워크스페이스 = 별도 row', () => {
    const a = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'X', kind: 'topic' })
    const b = fx.store.ensureTag({ workspace_id: fx.otherWsId, name: 'X', kind: 'topic' })
    expect(a.id).not.toBe(b.id)
  })

  it('ensureTag ai_generated boolean 라운드트립 (SQLite 0/1)', () => {
    const a = fx.store.ensureTag({
      workspace_id: fx.wsId,
      name: 'auto',
      kind: 'topic',
      ai_generated: true
    })
    expect(a.ai_generated).toBe(true)
    const reread = fx.store.findById(a.id)
    expect(reread?.ai_generated).toBe(true)
  })

  it('ensureTag 잘못된 kind → throw', () => {
    expect(() =>
      // @ts-expect-error 의도된 invalid kind 입력
      fx.store.ensureTag({ workspace_id: fx.wsId, name: 'x', kind: 'invalid' })
    ).toThrow(/invalid kind/)
  })

  it('ensureTag 빈 name → throw', () => {
    expect(() => fx.store.ensureTag({ workspace_id: fx.wsId, name: '', kind: 'topic' })).toThrow(
      /name required/
    )
  })

  it('listByWorkspace kind ASC + name ASC', () => {
    fx.store.ensureTag({ workspace_id: fx.wsId, name: 'b', kind: 'topic' })
    fx.store.ensureTag({ workspace_id: fx.wsId, name: 'a', kind: 'topic' })
    fx.store.ensureTag({ workspace_id: fx.wsId, name: 'x', kind: 'domain' })
    const list = fx.store.listByWorkspace(fx.wsId).map((t) => `${t.kind}:${t.name}`)
    expect(list).toEqual(['domain:x', 'topic:a', 'topic:b'])
  })

  it('attachToPage / listPageTags / detachFromPage', () => {
    const pageId = insertPage(fx.fb, fx.wsId)
    const t1 = fx.store.ensureTag({ workspace_id: fx.wsId, name: 't1', kind: 'topic' })
    const t2 = fx.store.ensureTag({ workspace_id: fx.wsId, name: 't2', kind: 'domain' })
    fx.store.attachToPage(pageId, { workspace_id: fx.wsId, tag_id: t1.id })
    fx.store.attachToPage(pageId, { workspace_id: fx.wsId, tag_id: t2.id, ai_generated: true })
    expect(fx.store.listPageTags(pageId).map((t) => t.name).sort()).toEqual(['t1', 't2'])
    expect(fx.store.detachFromPage(pageId, t1.id)).toBe(true)
    expect(fx.store.listPageTags(pageId).map((t) => t.name)).toEqual(['t2'])
  })

  it('attachToPage 중복 (page, tag) → INSERT OR IGNORE (idempotent)', () => {
    const pageId = insertPage(fx.fb, fx.wsId)
    const t = fx.store.ensureTag({ workspace_id: fx.wsId, name: 't', kind: 'topic' })
    fx.store.attachToPage(pageId, { workspace_id: fx.wsId, tag_id: t.id })
    fx.store.attachToPage(pageId, { workspace_id: fx.wsId, tag_id: t.id })
    expect(fx.store.listPageTags(pageId)).toHaveLength(1)
  })

  it('attachToNote / listNoteTags / detachFromNote', () => {
    const noteId = insertNote(fx.fb, fx.wsId)
    const t1 = fx.store.ensureTag({ workspace_id: fx.wsId, name: 'n1', kind: 'topic' })
    fx.store.attachToNote(noteId, { workspace_id: fx.wsId, tag_id: t1.id })
    expect(fx.store.listNoteTags(noteId).map((t) => t.name)).toEqual(['n1'])
    expect(fx.store.detachFromNote(noteId, t1.id)).toBe(true)
    expect(fx.store.listNoteTags(noteId)).toEqual([])
  })

  it('deleteTag → PageTag/NoteTag CASCADE 정리 (FK on delete cascade)', () => {
    const pageId = insertPage(fx.fb, fx.wsId)
    const noteId = insertNote(fx.fb, fx.wsId)
    const t = fx.store.ensureTag({ workspace_id: fx.wsId, name: 't', kind: 'topic' })
    fx.store.attachToPage(pageId, { workspace_id: fx.wsId, tag_id: t.id })
    fx.store.attachToNote(noteId, { workspace_id: fx.wsId, tag_id: t.id })
    expect(fx.store.deleteTag(t.id)).toBe(true)
    expect(fx.store.listPageTags(pageId)).toEqual([])
    expect(fx.store.listNoteTags(noteId)).toEqual([])
  })
})
