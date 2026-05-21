/**
 * Sprint 015 M5-7 — noteHandlers 단위 테스트.
 *
 * cover:
 *   - handleNoteCreate — graceful error (selectedText empty / workspace null / service null) + 성공
 *   - handleNoteList — workspace 별 / null 인프라
 *   - handleNoteDelete — id 있음/없음 + service null
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { NoteService } from '../../../src/main/NoteService'
import {
  handleNoteCreate,
  handleNoteList,
  handleNoteDelete
} from '../../../src/main/noteHandlers'

interface Fx {
  fb: FlowbrowserDatabase
  service: NoteService
  workspaceId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const service = new NoteService({
    noteStore: new NoteStore(fb),
    embeddingQueue: new EmbeddingQueue(fb)
  })
  return { fb, service, workspaceId: ws.id }
}

describe('handleNoteCreate — graceful error', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('selectedText empty → errorCode=invalid_input', async () => {
    const r = await handleNoteCreate(
      { selectedText: '   ' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })

  it('workspace null → errorCode=invalid_input', async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x' },
      {
        getActiveWorkspaceId: () => null,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
    expect(r.error).toMatch(/워크스페이스/)
  })

  it('service null → errorCode=infra_unavailable', async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => null
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('infra_unavailable')
  })
})

describe('handleNoteCreate — 성공 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('SerializedNoteRow camelCase 매핑', async () => {
    const r = await handleNoteCreate(
      { selectedText: '인용', body: '메모' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(true)
    expect(r.note).toBeDefined()
    expect(r.note!.selectedText).toBe('인용')
    expect(r.note!.body).toBe('메모')
    expect(r.note!.workspaceId).toBe(fx.workspaceId)
    expect(r.note!.createdBy).toBe('user')
    expect(typeof r.note!.createdAt).toBe('number')
    expect(r.embeddingJobId).toBeDefined()
  })

  it('args.workspaceId 우선', async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', workspaceId: fx.workspaceId },
      {
        getActiveWorkspaceId: () => null, // null 이지만 args 사용
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(true)
  })

  it('initialTags 전달 → SerializedNoteRow.aiTags', async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', initialTags: ['glossary'] },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.note!.aiTags).toEqual(['glossary'])
  })

  // Sprint 017 T02 — IPC 경계 pageId / visitId normalize.
  it("pageId='' → SerializedNoteRow.pageId=null (IPC 경계 normalize)", async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', pageId: '' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(true)
    expect(r.note!.pageId).toBeNull()
  })

  it("pageId='   ' (whitespace) → SerializedNoteRow.pageId=null", async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', pageId: '   ' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.note!.pageId).toBeNull()
  })

  it("visitId='' (whitespace 포함) → SerializedNoteRow.visitId=null", async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', visitId: ' \t ' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.note!.visitId).toBeNull()
  })

  it('pageId null + visitId null → 그대로 null (regression)', async () => {
    const r = await handleNoteCreate(
      { selectedText: 'x', pageId: null, visitId: null },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.note!.pageId).toBeNull()
    expect(r.note!.visitId).toBeNull()
  })
})

describe('handleNoteList', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('workspace 별 SerializedNoteRow 반환', async () => {
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'a' })
    await fx.service.createNote({ workspaceId: fx.workspaceId, selectedText: 'b' })
    const r = handleNoteList(
      {},
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.notes).toHaveLength(2)
    expect(r.notes[0]).toHaveProperty('selectedText')
  })

  it('service null → 빈 결과', () => {
    const r = handleNoteList(
      {},
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => null
      }
    )
    expect(r.notes).toEqual([])
  })

  it('workspace null → 빈 결과', () => {
    const r = handleNoteList(
      {},
      {
        getActiveWorkspaceId: () => null,
        getNoteService: () => fx.service
      }
    )
    expect(r.notes).toEqual([])
  })
})

describe('handleNoteDelete', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('존재 시 ok=true', async () => {
    const created = await fx.service.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'x'
    })
    const r = handleNoteDelete(
      { id: created.note.id },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(true)
  })

  it('미존재 시 ok=false', () => {
    const r = handleNoteDelete(
      { id: 'nonexistent' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(false)
  })

  it('빈 id → ok=false', () => {
    const r = handleNoteDelete(
      { id: '' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => fx.service
      }
    )
    expect(r.ok).toBe(false)
  })

  it('service null → ok=false', () => {
    const r = handleNoteDelete(
      { id: 'x' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getNoteService: () => null
      }
    )
    expect(r.ok).toBe(false)
  })
})
