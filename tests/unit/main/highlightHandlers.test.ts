/**
 * Sprint 017 M1 T06 — highlightHandlers 단위 회귀.
 *
 * cover:
 *   - handleHighlightCreate — graceful error (url/contentHash/anchor 누락 / workspaceId null /
 *     store null / NoteService null at composite branch / 신규 노트 + highlight composite 성공 /
 *     noteId 명시 시 노트 생성 skip + highlight 만 add / pageId='' normalize)
 *   - handleHighlightListByPage — workspaceId + url + contentHash 필터 / store null
 *   - handleHighlightListByNote / handleHighlightRemove
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { NoteStore } from '../../../src/storage/NoteStore'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { HighlightStore } from '../../../src/storage/HighlightStore'
import { NoteService } from '../../../src/main/NoteService'
import {
  handleHighlightCreate,
  handleHighlightListByPage,
  handleHighlightListByNote,
  handleHighlightRemove
} from '../../../src/main/highlightHandlers'
import type { HighlightAnchor } from '../../../src/perception/highlightAnchor'

interface Fx {
  fb: FlowbrowserDatabase
  noteService: NoteService
  highlightStore: HighlightStore
  workspaceId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const noteService = new NoteService({
    noteStore: new NoteStore(fb),
    embeddingQueue: new EmbeddingQueue(fb)
  })
  const highlightStore = new HighlightStore()
  return { fb, noteService, highlightStore, workspaceId: ws.id }
}

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

describe('handleHighlightCreate — graceful error', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('url 누락 → errorCode=invalid_input', async () => {
    const r = await handleHighlightCreate(
      {
        url: '',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })

  it('contentHash 누락 → errorCode=invalid_input', async () => {
    const r = await handleHighlightCreate(
      { url: 'https://example.com', contentHash: '', anchor: makeAnchor() },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })

  it('anchor 누락 → errorCode=invalid_input', async () => {
    const r = await handleHighlightCreate(
      {
        url: 'https://example.com',
        contentHash: 'h',
        anchor: undefined as unknown as HighlightAnchor
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })

  it('workspaceId null → errorCode=invalid_input', async () => {
    const r = await handleHighlightCreate(
      { url: 'https://example.com', contentHash: 'h', anchor: makeAnchor() },
      {
        getActiveWorkspaceId: () => null,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })

  it('store null → errorCode=infra_unavailable', async () => {
    const r = await handleHighlightCreate(
      { url: 'https://example.com', contentHash: 'h', anchor: makeAnchor() },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => null,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('infra_unavailable')
  })

  it('composite 분기 + NoteService null → errorCode=infra_unavailable', async () => {
    const r = await handleHighlightCreate(
      { url: 'https://example.com', contentHash: 'h', anchor: makeAnchor() },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => null
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('infra_unavailable')
  })

  it('composite 분기 + selectedText 빈 → errorCode=invalid_input', async () => {
    const r = await handleHighlightCreate(
      {
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor({ selectedText: '' }),
        selectedText: '   '
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_input')
  })
})

describe('handleHighlightCreate — codex Finding 4 (noteId 명시 분기 무결성)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('noteId 명시 + 미존재 → errorCode=note_not_found', async () => {
    const r = await handleHighlightCreate(
      {
        noteId: 'nonexistent-id',
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('note_not_found')
  })

  it('noteId 명시 + cross-workspace → errorCode=note_not_found (격리)', async () => {
    // ws1 에서 노트 생성. ws2 활성 컨텍스트에서 ws1 노트 id 로 highlight 시도.
    const otherNote = await fx.noteService.createNote({
      workspaceId: fx.workspaceId,
      selectedText: 'ws1 의 노트'
    })
    const r = await handleHighlightCreate(
      {
        workspaceId: 'ws2-different',
        noteId: otherNote.note.id,
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => 'ws2-different',
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('note_not_found')
    expect(r.error).toMatch(/워크스페이스가 일치하지 않습니다/)
  })

  it('noteId 명시 + NoteService null → errorCode=infra_unavailable', async () => {
    const r = await handleHighlightCreate(
      {
        noteId: 'any-id',
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => null
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('infra_unavailable')
  })

  it('noteId 명시 + 존재 + 동일 workspace → ok=true (regression)', async () => {
    const existing = await fx.noteService.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '기존 노트'
    })
    const r = await handleHighlightCreate(
      {
        noteId: existing.note.id,
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
    expect(r.highlight!.noteId).toBe(existing.note.id)
    expect(r.note).toBeUndefined()
  })
})

describe('handleHighlightCreate — 성공 path', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('composite (신규 노트 + highlight) — note + highlight 동반 반환', async () => {
    const r = await handleHighlightCreate(
      {
        url: 'https://example.com',
        contentHash: 'hash-1',
        anchor: makeAnchor({ selectedText: '인용' })
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
    expect(r.note).toBeDefined()
    expect(r.note!.selectedText).toBe('인용')
    expect(r.note!.workspaceId).toBe(fx.workspaceId)
    expect(r.highlight).toBeDefined()
    expect(r.highlight!.noteId).toBe(r.note!.id)
    expect(r.highlight!.url).toBe('https://example.com')
    expect(r.highlight!.contentHash).toBe('hash-1')
    expect(r.highlight!.workspaceId).toBe(fx.workspaceId)
  })

  it('noteId 명시 → 노트 생성 skip + highlight 만 add (note 미반환)', async () => {
    // 기존 노트 미리 생성
    const created = await fx.noteService.createNote({
      workspaceId: fx.workspaceId,
      selectedText: '기존'
    })
    const r = await handleHighlightCreate(
      {
        noteId: created.note.id,
        url: 'https://example.com',
        contentHash: 'hash-2',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
    expect(r.highlight!.noteId).toBe(created.note.id)
    expect(r.note).toBeUndefined()
  })

  it("pageId='' → SerializedHighlightRecord.pageId=null (IPC 경계 normalize)", async () => {
    const r = await handleHighlightCreate(
      {
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor(),
        pageId: ''
      },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
    expect(r.highlight!.pageId).toBeNull()
  })

  it('args.workspaceId 우선 (active null 이어도 args 사용)', async () => {
    const r = await handleHighlightCreate(
      {
        workspaceId: fx.workspaceId,
        url: 'https://example.com',
        contentHash: 'h',
        anchor: makeAnchor()
      },
      {
        getActiveWorkspaceId: () => null,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
  })
})

describe('handleHighlightListByPage', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('store null → 빈 결과', () => {
    const r = handleHighlightListByPage(
      { workspaceId: fx.workspaceId, url: 'https://example.com' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => null,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toEqual([])
  })

  it('workspaceId null → 빈 결과', () => {
    const r = handleHighlightListByPage(
      { url: 'https://example.com' },
      {
        getActiveWorkspaceId: () => null,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toEqual([])
  })

  it('pageId / url 둘 다 누락 → 빈 결과 (cross-page 방어선 — handler 가 throw 차단)', () => {
    const r = handleHighlightListByPage(
      { workspaceId: fx.workspaceId },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toEqual([])
  })

  it('url 매칭 → 동일 url 만 반환 (createdAt 오름차순)', () => {
    fx.highlightStore.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 1
    })
    fx.highlightStore.add({
      noteId: 'n2',
      url: 'https://other.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 2
    })
    fx.highlightStore.add({
      noteId: 'n3',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 3
    })
    const r = handleHighlightListByPage(
      { workspaceId: fx.workspaceId, url: 'https://example.com' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toHaveLength(2)
    expect(r.highlights[0].noteId).toBe('n1')
    expect(r.highlights[1].noteId).toBe('n3')
  })
})

describe('handleHighlightListByNote', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('noteId 빈 → 빈 결과', () => {
    const r = handleHighlightListByNote(
      { noteId: '' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toEqual([])
  })

  it('단일 노트의 1:N highlight 반환', () => {
    fx.highlightStore.add({
      noteId: 'n-share',
      url: 'https://a.com',
      contentHash: 'h1',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 1
    })
    fx.highlightStore.add({
      noteId: 'n-share',
      url: 'https://b.com',
      contentHash: 'h2',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 2
    })
    fx.highlightStore.add({
      noteId: 'n-other',
      url: 'https://c.com',
      contentHash: 'h3',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 3
    })
    const r = handleHighlightListByNote(
      { noteId: 'n-share' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.highlights).toHaveLength(2)
  })
})

describe('handleHighlightRemove', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('빈 id → ok=false', () => {
    const r = handleHighlightRemove(
      { id: '' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
  })

  it('store null → ok=false', () => {
    const r = handleHighlightRemove(
      { id: 'h-1' },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => null,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(false)
  })

  it('존재 시 ok=true + 후속 list 에서 미포함', () => {
    const record = fx.highlightStore.add({
      noteId: 'n1',
      url: 'https://example.com',
      contentHash: 'h',
      anchor: makeAnchor(),
      workspaceId: fx.workspaceId,
      createdAt: 1
    })
    const r = handleHighlightRemove(
      { id: record.id },
      {
        getActiveWorkspaceId: () => fx.workspaceId,
        getHighlightStore: () => fx.highlightStore,
        getNoteService: () => fx.noteService
      }
    )
    expect(r.ok).toBe(true)
    expect(fx.highlightStore.size()).toBe(0)
  })
})

/**
 * Sprint 017 M1 T07 hotfix (codex 019e4e82 NEEDS_CHANGES #1) — composite branch FK error boundary.
 *
 * SQLite swap 후 `noteService.createNote` 가 FK violation (workspace_id / page_id stale) 시 throw 가능 →
 * IPC handler 가 reject 되지 않고 `{ ok:false, errorCode }` graceful 응답으로 감싸야 함.
 */
describe('handleHighlightCreate — composite branch FK error boundary (codex 019e4e82 #1)', () => {
  it('noteService.createNote throw → graceful ok=false + errorCode=invalid_input', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    // noteService throw stub — createNote 호출 시 FK violation 메시지 throw
    const throwingNoteService = {
      createNote: async () => {
        throw new Error('FOREIGN KEY constraint failed')
      },
      getNote: () => null
    } as unknown as NoteService
    const highlightStore = new HighlightStore()
    try {
      const r = await handleHighlightCreate(
        {
          url: 'https://example.com',
          contentHash: 'h',
          anchor: makeAnchor(),
          selectedText: 'test selection'
          // noteId 미명시 → composite branch (noteService.createNote 호출)
        },
        {
          getActiveWorkspaceId: () => ws.id,
          getHighlightStore: () => highlightStore,
          getNoteService: () => throwingNoteService
        }
      )
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errorCode).toBe('invalid_input')
        expect(r.error).toMatch(/FOREIGN KEY/)
      }
    } finally {
      fb.close()
    }
  })
})
