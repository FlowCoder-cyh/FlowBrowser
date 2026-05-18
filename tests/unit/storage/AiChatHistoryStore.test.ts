/**
 * Sprint 015 M3-4 — AiChatHistoryStore 단위 테스트.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'

interface Fx {
  fb: FlowbrowserDatabase
  store: AiChatHistoryStore
  wsId: string
  otherWsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const wsId = fb.ensureDefaultWorkspace().id
  const otherWsId = fb.createWorkspace({ name: 'O', icon: '🅾' }).id
  return { fb, store: new AiChatHistoryStore(fb), wsId, otherWsId }
}

describe('AiChatHistoryStore', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('create user/assistant/system/error 4 role', () => {
    for (const role of ['user', 'assistant', 'system', 'error'] as const) {
      const row = fx.store.create({
        workspace_id: fx.wsId,
        role,
        content: `${role} msg`
      })
      expect(row.role).toBe(role)
    }
    expect(fx.store.countByWorkspace(fx.wsId)).toBe(4)
  })

  it('create status 디폴트 ok + 명시 pending', () => {
    const a = fx.store.create({ workspace_id: fx.wsId, role: 'user', content: 'hi' })
    expect(a.status).toBe('ok')
    const b = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: '...',
      status: 'pending'
    })
    expect(b.status).toBe('pending')
  })

  it('retrieved_items JSON 라운드트립', () => {
    const items = [
      { type: 'page' as const, id: 'p1', page_id: 'p1', visit_id: 'v1' },
      { type: 'note' as const, id: 'n1' }
    ]
    const row = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: 'a',
      retrieved_items: items
    })
    expect(fx.store.findById(row.id)?.retrieved_items).toEqual(items)
  })

  it('chat_meta JSON 라운드트립 (표 schema)', () => {
    const meta = {
      rows: 2,
      columns: ['col1', 'col2'],
      cells: [
        { value: 'a', sources: [{ type: 'page', id: 'p1' }] },
        { value: 'b', sources: [] }
      ]
    }
    const row = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: 'table',
      chat_meta: meta
    })
    expect(fx.store.findById(row.id)?.chat_meta).toEqual(meta)
  })

  it('빈 workspace_id / content → throw', () => {
    expect(() => fx.store.create({ workspace_id: '', role: 'user', content: 'x' })).toThrow(
      /workspace_id required/
    )
    expect(() => fx.store.create({ workspace_id: fx.wsId, role: 'user', content: '' })).toThrow(
      /content required/
    )
  })

  it('listByWorkspace ASC + workspace 격리', () => {
    fx.store.create({ workspace_id: fx.wsId, role: 'user', content: 'a', created_at: 100 })
    fx.store.create({ workspace_id: fx.wsId, role: 'assistant', content: 'b', created_at: 200 })
    fx.store.create({ workspace_id: fx.otherWsId, role: 'user', content: 'c', created_at: 150 })
    const list = fx.store.listByWorkspace(fx.wsId)
    expect(list.map((r) => r.content)).toEqual(['a', 'b'])
    expect(fx.store.listByWorkspace(fx.otherWsId).map((r) => r.content)).toEqual(['c'])
  })

  it('updateStatus pending → ok + chat_meta 갱신', () => {
    const a = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: '...',
      status: 'pending'
    })
    const updated = fx.store.updateStatus({
      id: a.id,
      status: 'ok',
      content: 'final answer',
      chat_meta: { rows: 1 }
    })
    expect(updated.status).toBe('ok')
    expect(updated.content).toBe('final answer')
    expect(updated.chat_meta).toEqual({ rows: 1 })
  })

  it('updateStatus → failed 에러 메시지 저장', () => {
    const a = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: '...',
      status: 'pending'
    })
    const updated = fx.store.updateStatus({
      id: a.id,
      status: 'failed',
      content: 'Network error'
    })
    expect(updated.status).toBe('failed')
    expect(updated.content).toBe('Network error')
  })

  it("updateStatus → aborted (사용자 abort)", () => {
    const a = fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: '...',
      status: 'pending'
    })
    const updated = fx.store.updateStatus({ id: a.id, status: 'aborted' })
    expect(updated.status).toBe('aborted')
  })

  it('updateStatus 없는 id → throw', () => {
    expect(() =>
      fx.store.updateStatus({ id: randomUUID(), status: 'ok' })
    ).toThrow(/not found/)
  })

  it('listByPage 페이지 anchor 채팅 조회', () => {
    const pageId = randomUUID()
    fx.fb
      .getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(pageId, fx.wsId, 'https://x.test/a', Date.now(), Date.now())
    fx.store.create({
      workspace_id: fx.wsId,
      role: 'user',
      content: 'q',
      page_id: pageId,
      created_at: 100
    })
    fx.store.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: 'a',
      page_id: pageId,
      created_at: 200
    })
    fx.store.create({ workspace_id: fx.wsId, role: 'user', content: 'other' })
    expect(fx.store.listByPage(pageId).map((r) => r.content)).toEqual(['q', 'a'])
  })

  it('delete + countByWorkspace', () => {
    const a = fx.store.create({ workspace_id: fx.wsId, role: 'user', content: 'a' })
    expect(fx.store.delete(a.id)).toBe(true)
    expect(fx.store.delete(randomUUID())).toBe(false)
    expect(fx.store.countByWorkspace(fx.wsId)).toBe(0)
  })
})
