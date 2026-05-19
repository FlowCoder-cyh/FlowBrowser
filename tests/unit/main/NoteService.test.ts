/**
 * Sprint 015 M5-7 — NoteService 단위 테스트.
 *
 * in-memory FlowbrowserDatabase + NoteStore + EmbeddingQueue.
 *
 * codex M5-7 PR #159 NEEDS_CHANGES 정정 후 — AutoTagger 통합 자체 제거 (KI-005 후속).
 * AutoTagger.tagPage 가 page_tags FK 위반 (note.id 가 pages 외래키 충족 X) 발견 시점 차단.
 *
 * cover:
 *   - createNote — NoteStore.create + EmbeddingQueue.enqueue 정합
 *   - whitespace-only selectedText → throw (NoteService 자체 guard, codex 회귀)
 *   - workspaceId 빈 문자열 → throw
 *   - body / selectedText / initialTags / pageId+visitId anchor / priority
 *   - enableAutoTagging=true 시도 'not_called' 반환 (KI-005 안전 디폴트)
 *   - listNotes / deleteNote
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { NoteService } from '../../../src/main/NoteService'

interface Fx {
  fb: FlowbrowserDatabase
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
  workspaceId: string
  service: NoteService
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const noteStore = new NoteStore(fb)
  const embeddingQueue = new EmbeddingQueue(fb)
  const service = new NoteService({ noteStore, embeddingQueue })
  return { fb, noteStore, embeddingQueue, workspaceId: ws.id, service }
}

describe('NoteService — createNote 입력 검증 (codex PR #159 NEEDS_CHANGES 회귀)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText 빈 문자열 → throw', async () => {
    await expect(
      fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: '' })
    ).rejects.toThrow(/selectedText/)
  })

  it('selectedText whitespace-only → throw (NoteStore 통과 차단)', async () => {
    await expect(
      fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: '   ' })
    ).rejects.toThrow(/selectedText/)
  })

  it('workspaceId 빈 문자열 → throw', async () => {
    await expect(
      fx.service.createNote({ workspaceId: '', selectedText: 'x' })
    ).rejects.toThrow(/workspaceId/)
  })
})

describe('NoteService — createNote 정상 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText 만 — note 영속 + 임베딩 큐 등록 + autoTaggingStatus=not_called', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '핵심 인용'
    })
    expect(r.note.selected_text).toBe('핵심 인용')
    expect(r.note.workspace_id).toBe(fx.workspaceId)
    expect(r.note.created_by).toBe('user')
    expect(r.embeddingJobId).toBeDefined()
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('body + selectedText — 본문 결합 임베딩 큐 등록', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      body: '내 메모'
    })
    expect(r.note.body).toBe('내 메모')
    expect(r.embeddingJobId).toBeDefined()
    expect(fx.embeddingQueue.stats().pending).toBe(1)
  })

  it('initialTags 전달 — ai_tags 영속', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'CAR-T',
      initialTags: ['glossary', 'domain:medicine']
    })
    expect(r.note.ai_tags).toEqual(['glossary', 'domain:medicine'])
  })

  it('pageId / visitId anchor — note 영속에 박힘', async () => {
    const { IndexedPageStoreSqlite } = await import(
      '../../../src/storage/IndexedPageStoreSqlite'
    )
    const pageStore = new IndexedPageStoreSqlite(fx.fb, {
      defaultWorkspaceId: fx.workspaceId
    })
    const { page, visit } = await pageStore.recordVisit({
      workspace_id: fx.workspaceId,
      url: 'https://anchor.example',
      content: 'anchor body',
      visited_at: Date.now()
    })

    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      pageId: page.id,
      visitId: visit.id
    })
    expect(r.note.page_id).toBe(page.id)
    expect(r.note.visit_id).toBe(visit.id)
  })

  it('priority 디폴트 10 (활성 탭 우선)', async () => {
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용'
    })
    const claimed = fx.embeddingQueue.claimNext()
    expect(claimed).not.toBeNull()
    expect(claimed!.priority).toBe(10)
    expect(claimed!.target_type).toBe('note')
  })

  it('priority override (백그라운드 1)', async () => {
    await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      priority: 1
    })
    const claimed = fx.embeddingQueue.claimNext()
    expect(claimed!.priority).toBe(1)
  })
})

describe('NoteService — KI-005 안전 디폴트 (note 자동 태깅 미구현)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('enableAutoTagging=true → not_called', async () => {
    // codex M5-7 PR #159: AutoTagger.tagPage(pageId=note.id) 가 page_tags FK 위반 발견
    // → 안전 디폴트로 호출 자체 차단. AutoTagger.tagNote 도입 후 (Sprint 016+) 활성.
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('enableAutoTagging=false → not_called', async () => {
    const r = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x',
      enableAutoTagging: false
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })
})

describe('NoteService — list / delete', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('listNotes — workspace 별', async () => {
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'a' })
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'b' })
    const notes = fx.service.listNotes(fx.workspaceId)
    expect(notes).toHaveLength(2)
  })

  it('deleteNote — 존재 시 true', async () => {
    const r = await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'x' })
    expect(fx.service.deleteNote(r.note.id)).toBe(true)
    expect(fx.service.listNotes(fx.workspaceId)).toHaveLength(0)
  })

  it('deleteNote — 미존재 시 false', () => {
    expect(fx.service.deleteNote('nonexistent-uuid')).toBe(false)
  })
})
