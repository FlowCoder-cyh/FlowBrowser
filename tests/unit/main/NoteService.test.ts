/**
 * Sprint 015 M5-7 — NoteService 단위 테스트.
 *
 * in-memory FlowbrowserDatabase + NoteStore + EmbeddingQueue + TagStore.
 *
 * cover:
 *   - createNote — NoteStore.create + EmbeddingQueue.enqueue 정합
 *   - 빈 selectedText (whitespace) → 임베딩 큐 skip
 *   - body 없음 + selectedText 있음 → 임베딩 큐 등록
 *   - body 있음 + selectedText 있음 → 임베딩 큐 등록
 *   - listNotes — workspace 별 chronological
 *   - deleteNote — true/false
 *   - autoTagger 주입 — enableAutoTagging=true 시 tagPage 호출, tags attachToNote
 *   - autoTagger 미주입 + enableAutoTagging=true → not_called
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { TagStore } from '../../../src/storage/TagStore'
import { NoteService } from '../../../src/main/NoteService'
import type { AutoTaggerService } from '../../../src/main/NoteService'

function makeMockAutoTagger(opts: { fail?: boolean; tags?: Array<{ id: string; kind: string; name: string }> } = {}): AutoTaggerService {
  return {
    async tagPage(_input) {
      if (opts.fail) {
        return { status: 'failed', reason: 'mock_fail', rawText: '' } as never
      }
      const tags = opts.tags ?? [{ id: 'tag-1', kind: 'topic', name: 'mock' }]
      return {
        status: 'tagged',
        tags: tags as never[],
        schemaParsed: true,
        rawText: JSON.stringify({ tags })
      } as never
    }
  } as AutoTaggerService
}

interface Fx {
  fb: FlowbrowserDatabase
  noteStore: NoteStore
  embeddingQueue: EmbeddingQueue
  tagStore: TagStore
  workspaceId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  return {
    fb,
    noteStore: new NoteStore(fb),
    embeddingQueue: new EmbeddingQueue(fb),
    tagStore: new TagStore(fb),
    workspaceId: ws.id
  }
}

describe('NoteService — createNote', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText 만 — note 영속 + 임베딩 큐 등록 + autoTaggingStatus=not_called', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({
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
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      body: '내 메모'
    })
    expect(r.note.body).toBe('내 메모')
    expect(r.embeddingJobId).toBeDefined()
    expect(fx.embeddingQueue.stats().pending).toBe(1)
  })

  it('initialTags 전달 — ai_tags 영속', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'CAR-T',
      initialTags: ['glossary', 'domain:medicine']
    })
    expect(r.note.ai_tags).toEqual(['glossary', 'domain:medicine'])
  })

  it('pageId / visitId anchor — note 영속에 박힘 (FK 정합 위해 page+visit 미리 생성)', async () => {
    // FK 정합 — page + visit 미리 생성
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

    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      pageId: page.id,
      visitId: visit.id
    })
    expect(r.note.page_id).toBe(page.id)
    expect(r.note.visit_id).toBe(visit.id)
  })

  it('priority 디폴트 10 (활성 탭 우선) — EmbeddingQueue.enqueue 호출', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용'
    })
    const claimed = fx.embeddingQueue.claimNext()
    expect(claimed).not.toBeNull()
    expect(claimed!.priority).toBe(10)
    expect(claimed!.target_type).toBe('note')
  })
})

describe('NoteService — AutoTagger 통합', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('autoTagger 미주입 + enableAutoTagging=true → not_called', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '인용',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('not_called')
  })

  it('autoTagger 주입 + enableAutoTagging=true → tagged', async () => {
    // tagStore에 tag 미리 생성 (AutoTagger 가 return 한 tags 가 실제 row 가정)
    const tagRow = fx.tagStore.ensureTag({
      workspace_id: fx.workspaceId,
      kind: 'topic',
      name: 'mock'
    })
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore,
      autoTagger: makeMockAutoTagger({
        tags: [{ id: tagRow.id, kind: 'topic', name: 'mock' }]
      })
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '본문',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('tagged')
  })

  it('autoTagger throw → failed', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore,
      autoTagger: {
        async tagPage() {
          throw new Error('mock failure')
        }
      } as AutoTaggerService
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '본문',
      enableAutoTagging: true
    })
    expect(r.autoTaggingStatus).toBe('failed')
  })

  it('enableAutoTagging=false → autoTagger 미호출 (BYOK 안전 디폴트)', async () => {
    let called = false
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore,
      autoTagger: {
        async tagPage() {
          called = true
          return { status: 'skipped', reason: 'empty_content' } as never
        }
      } as AutoTaggerService
    })
    const r = await service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '본문',
      enableAutoTagging: false
    })
    expect(called).toBe(false)
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
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    await service.createNote({ workspaceId: fx.workspaceId, selectedText: 'a' })
    await service.createNote({ workspaceId: fx.workspaceId, selectedText: 'b' })
    const notes = service.listNotes(fx.workspaceId)
    expect(notes).toHaveLength(2)
  })

  it('deleteNote — 존재 시 true', async () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    const r = await service.createNote({ workspaceId: fx.workspaceId, selectedText: 'x' })
    expect(service.deleteNote(r.note.id)).toBe(true)
    expect(service.listNotes(fx.workspaceId)).toHaveLength(0)
  })

  it('deleteNote — 미존재 시 false', () => {
    const service = new NoteService({
      noteStore: fx.noteStore,
      embeddingQueue: fx.embeddingQueue,
      tagStore: fx.tagStore
    })
    expect(service.deleteNote('nonexistent-uuid')).toBe(false)
  })
})
