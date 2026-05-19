/**
 * Sprint 015 M6 T29 — MemoryService 단위 테스트.
 *
 * cover:
 *   - getStats(ws) — pages / visits / notes / chat / lastIndexedAt 정합
 *   - 빈 워크스페이스 (0 카운트, lastIndexedAt null)
 *   - workspace 격리 (다른 워크스페이스 카운트가 새지 않음)
 *   - empty workspaceId 거부
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'
import { MemoryService } from '../../../src/main/MemoryService'

interface Harness {
  db: FlowbrowserDatabase
  defaultId: string
  altId: string
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  chatStore: AiChatHistoryStore
  svc: MemoryService
}

function makeHarness(): Harness {
  const db = FlowbrowserDatabase.bootstrap({ path: ':memory:', enableWal: false })
  const defaultWs = db.ensureDefaultWorkspace()
  const alt = db.createWorkspace({ name: 'Alt', icon: '💻' })
  const pageStore = new IndexedPageStoreSqlite(db, { defaultWorkspaceId: defaultWs.id })
  const noteStore = new NoteStore(db)
  const chatStore = new AiChatHistoryStore(db)
  const svc = new MemoryService({ pageStore, noteStore, chatStore })
  return { db, defaultId: defaultWs.id, altId: alt.id, pageStore, noteStore, chatStore, svc }
}

describe('MemoryService', () => {
  let h: Harness

  beforeEach(() => {
    h = makeHarness()
  })

  afterEach(() => {
    h.db.close()
  })

  it('empty workspace returns all zero + null lastIndexedAt', () => {
    const s = h.svc.getStats(h.defaultId)
    expect(s.pagesCount).toBe(0)
    expect(s.visitsCount).toBe(0)
    expect(s.notesCount).toBe(0)
    expect(s.chatMessagesCount).toBe(0)
    expect(s.lastIndexedAt).toBeNull()
  })

  it('counts pages + visits + lastIndexedAt after recordVisit', async () => {
    const t1 = Date.now()
    await h.pageStore.recordVisit({
      workspace_id: h.defaultId,
      url: 'https://a.example/p1',
      title: 'A',
      content: 'aaa',
      visited_at: t1
    })
    const t2 = t1 + 60_000
    await h.pageStore.recordVisit({
      workspace_id: h.defaultId,
      url: 'https://a.example/p2',
      title: 'B',
      content: 'bbb',
      visited_at: t2
    })
    const s = h.svc.getStats(h.defaultId)
    expect(s.pagesCount).toBe(2)
    expect(s.visitsCount).toBe(2)
    expect(s.lastIndexedAt).toBe(t2)
  })

  it('counts notes by workspace', () => {
    h.noteStore.create({
      page_id: null,
      visit_id: null,
      workspace_id: h.defaultId,
      selected_text: 'note 1',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })
    h.noteStore.create({
      page_id: null,
      visit_id: null,
      workspace_id: h.defaultId,
      selected_text: 'note 2',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })
    const s = h.svc.getStats(h.defaultId)
    expect(s.notesCount).toBe(2)
  })

  it('counts chat messages by workspace', () => {
    h.chatStore.create({
      workspace_id: h.defaultId,
      page_id: null,
      visit_id: null,
      role: 'user',
      content: 'hi',
      retrieved_items: null,
      chat_meta: null,
      status: 'ok'
    })
    h.chatStore.create({
      workspace_id: h.defaultId,
      page_id: null,
      visit_id: null,
      role: 'assistant',
      content: 'hello',
      retrieved_items: null,
      chat_meta: null,
      status: 'ok'
    })
    const s = h.svc.getStats(h.defaultId)
    expect(s.chatMessagesCount).toBe(2)
  })

  it('isolates counts between workspaces', async () => {
    await h.pageStore.recordVisit({
      workspace_id: h.defaultId,
      url: 'https://a.example/p',
      title: 'A',
      content: 'x',
      visited_at: Date.now()
    })
    h.noteStore.create({
      page_id: null,
      visit_id: null,
      workspace_id: h.altId,
      selected_text: 'alt note',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })
    const sDefault = h.svc.getStats(h.defaultId)
    const sAlt = h.svc.getStats(h.altId)
    expect(sDefault.pagesCount).toBe(1)
    expect(sDefault.notesCount).toBe(0)
    expect(sAlt.pagesCount).toBe(0)
    expect(sAlt.notesCount).toBe(1)
  })

  it('rejects empty workspaceId', () => {
    expect(() => h.svc.getStats('')).toThrow(/workspaceId required/)
  })
})
