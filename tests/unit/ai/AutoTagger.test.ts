/**
 * Sprint 015 M4-2 — AutoTagger 단위 테스트.
 *
 * cover:
 *   - schema 정상 응답 — 6 kind 모두 파싱 + ensureTag + attachToPage
 *   - JSON 파싱 실패 → freeform fallback (단일 태그)
 *   - JSON 안에 잘못된 kind / 빈 name → 항목 단위 skip
 *   - 코드 펜스 (```json ... ```) strip
 *   - empty content / no_chat_support → skipped
 *   - provider.chat throw → failed
 *   - 중복 (kind+name lowercase) 제거
 *   - maxTags 초과 시 잘림
 *   - parseTagsResponse 단위 함수 직접 검증
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { TagStore } from '../../../src/storage/TagStore'
import { NoteStore } from '../../../src/storage/NoteStore'
import { AutoTagger, parseTagsResponse } from '../../../src/ai/tagging/AutoTagger'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type { ProviderInfo, ChatRequest, ChatResponse } from '../../../src/ai/types'

interface StubProvider extends ProviderAdapter {
  chatCalls: ChatRequest[]
}

function makeChatStub(responseText: string): StubProvider {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'StubOpenAI',
    supportedRequestTypes: ['selection'],
    defaultModel: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini'],
    supportsChat: true,
    supportsEmbed: false
  }
  const calls: ChatRequest[] = []
  return {
    info,
    chatCalls: calls,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request)
      return {
        text: responseText,
        modelUsed: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.0001,
        durationMs: 250
      }
    },
    async validate() {
      return { ok: true }
    }
  } as unknown as StubProvider
}

function makeChatThrowStub(error: Error): StubProvider {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'StubThrow',
    supportedRequestTypes: ['selection'],
    defaultModel: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini'],
    supportsChat: true
  }
  return {
    info,
    chatCalls: [],
    async chat(): Promise<ChatResponse> {
      throw error
    },
    async validate() {
      return { ok: true }
    }
  } as unknown as StubProvider
}

function makeNoChatStub(): ProviderAdapter {
  const info: ProviderInfo = {
    providerType: 'codex',
    displayName: 'CodexNoChat',
    supportedRequestTypes: ['selection'],
    defaultModel: 'foo',
    availableModels: ['foo'],
    supportsChat: false
  }
  return {
    info,
    async validate() {
      return { ok: true }
    }
  } as unknown as ProviderAdapter
}

interface Fx {
  fb: FlowbrowserDatabase
  tagStore: TagStore
  wsId: string
  pageId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const tagStore = new TagStore(fb)
  // Page 1건 직접 INSERT — AutoTagger 는 page 존재성 검증 안 하지만 attachToPage 가 외래키 위반 방지하려면 필요
  const pageId = '00000000-0000-0000-0000-000000000001'
  fb.getDb()
    .prepare(
      `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
       VALUES (?, ?, 'https://x.test/p', 'P', 'body', 'h', 'en', 1, ?, ?)`
    )
    .run(pageId, ws.id, Date.now(), Date.now())
  return { fb, tagStore, wsId: ws.id, pageId }
}

describe('AutoTagger.tagPage — schema 정상 응답', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('JSON schema 정확 응답 — 모든 태그 ensureTag + attachToPage', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'CAR-T 저항성' },
          { kind: 'entity', name: 'BioGen' },
          { kind: 'domain', name: 'medicine' }
        ]
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      title: 'Test',
      content: 'body content'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(true)
      expect(result.tags).toHaveLength(3)
      expect(result.tags.every((t) => t.ai_generated)).toBe(true)
    }
    expect(fx.tagStore.listPageTags(fx.pageId)).toHaveLength(3)
    expect(provider.chatCalls).toHaveLength(1)
    expect(provider.chatCalls[0].messages).toHaveLength(2)
    expect(provider.chatCalls[0].messages[0].role).toBe('system')
    expect(provider.chatCalls[0].messages[1].role).toBe('user')
    // Sprint 016 M0 T04 (KI-004) — responseFormat JSON 강제 wire-up 회귀
    expect(provider.chatCalls[0].responseFormat).toBe('json_object')
  })

  it('KI-004 — provider.chat 요청에 responseFormat=json_object 항상 전달', async () => {
    const provider = makeChatStub(JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] }))
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(provider.chatCalls[0].responseFormat).toBe('json_object')
  })

  it('6 kind 모두 매핑', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 't' },
          { kind: 'entity', name: 'e' },
          { kind: 'metric', name: 'm' },
          { kind: 'sentiment', name: 's' },
          { kind: 'domain', name: 'd' },
          { kind: 'freeform', name: 'f' }
        ]
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      const kinds = result.tags.map((t) => t.kind).sort()
      expect(kinds).toEqual(['domain', 'entity', 'freeform', 'metric', 'sentiment', 'topic'])
    }
  })

  it('잘못된 kind / 빈 name 항목 단위 skip', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'valid' },
          { kind: 'bogus', name: 'reject' }, // 잘못된 kind
          { kind: 'entity', name: '   ' }, // 빈 name
          { name: 'no-kind' }, // kind 누락
          { kind: 'metric' } // name 누락
        ]
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') expect(result.tags).toHaveLength(1)
  })

  it('동일 (kind, name lowercase) 중복 제거', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'AI' },
          { kind: 'topic', name: 'ai' }, // 중복 (소문자)
          { kind: 'entity', name: 'AI' } // 다른 kind 라 보존
        ]
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') expect(result.tags).toHaveLength(2)
  })

  it('maxTags 초과 시 잘림', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: Array.from({ length: 10 }, (_, i) => ({ kind: 'topic', name: `t${i}` }))
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore, maxTags: 3 })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') expect(result.tags).toHaveLength(3)
  })

  it('코드 펜스 ```json ... ``` strip (멀티 라인)', async () => {
    const provider = makeChatStub(
      '```json\n' +
        JSON.stringify({ tags: [{ kind: 'topic', name: 'fenced' }] }) +
        '\n```'
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(true)
      expect(result.tags[0].name).toBe('fenced')
    }
  })

  it('코드 펜스 단일 라인 ```json{...}``` strip (codex M4-2 hotfix NB-4)', async () => {
    const provider = makeChatStub(
      '```json' +
        JSON.stringify({ tags: [{ kind: 'topic', name: 'single-line-fence' }] }) +
        '```'
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(true)
      expect(result.tags[0].name).toBe('single-line-fence')
    }
  })

  it('코드 펜스 lang 미명시 단일 라인 ``` {...} ``` strip', async () => {
    const provider = makeChatStub(
      '``` ' +
        JSON.stringify({ tags: [{ kind: 'topic', name: 'no-lang' }] }) +
        ' ```'
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(true)
      expect(result.tags[0].name).toBe('no-lang')
    }
  })
})

describe('AutoTagger.tagPage — freeform fallback', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('JSON 파싱 실패 → freeform 단일 태그 fallback', async () => {
    const provider = makeChatStub('이건 JSON 이 아닙니다 — 자유 텍스트 응답')
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(false)
      expect(result.tags).toHaveLength(1)
      expect(result.tags[0].kind).toBe('freeform')
      expect(result.tags[0].name).toContain('JSON')
    }
  })

  it('KI-004 — responseFormat=json_object 지정해도 parse 실패 시 freeform fallback 유지', async () => {
    // provider 미지원 (Codex Login Responses API) 또는 모델이 자유 텍스트 반환 케이스.
    // AutoTagger 는 항상 json_object 지정하지만 parse 실패 시 freeform fallback path 유지.
    const provider = makeChatStub('JSON 보장 실패 응답')
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(provider.chatCalls[0].responseFormat).toBe('json_object')
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(false)
      expect(result.tags).toHaveLength(1)
      expect(result.tags[0].kind).toBe('freeform')
    }
  })

  it('빈 JSON tags=[] → freeform fallback', async () => {
    const provider = makeChatStub(JSON.stringify({ tags: [] }))
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(false)
      expect(result.tags[0].kind).toBe('freeform')
    }
  })

  it('freeform name 200자 truncate', async () => {
    const longText = 'a'.repeat(500)
    const provider = makeChatStub(longText)
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.tags[0].name.length).toBe(200)
    }
  })
})

describe('AutoTagger.tagPage — skipped / failed', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('empty content → skipped (chat 호출 안 함)', async () => {
    const provider = makeChatStub('{}')
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: '   \n\t '
    })
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') expect(result.reason).toBe('empty_content')
    expect(provider.chatCalls).toHaveLength(0)
  })

  it('provider.chat 미지원 (no_chat_support)', async () => {
    const provider = makeNoChatStub()
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') expect(result.reason).toBe('no_chat_support')
  })

  it('provider.chat throw → failed', async () => {
    const provider = makeChatThrowStub(new Error('rate limit'))
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.error).toBe('rate limit')
  })
})

describe('AutoTagger — ensureTag idempotent', () => {
  it('동일 (workspace, kind, name) 재호출 시 동일 tag id (DB 중복 X)', async () => {
    const fx = setup()
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'AI' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const r1 = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x'
    })
    const r2 = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'y'
    })
    if (r1.status === 'tagged' && r2.status === 'tagged') {
      expect(r1.tags[0].id).toBe(r2.tags[0].id)
    }
    expect(fx.tagStore.listByWorkspace(fx.wsId)).toHaveLength(1)
    fx.fb.close()
  })

  it('attachToPage 멱등 — 동일 (page, tag) 재첨부 시 SQL INSERT OR IGNORE', async () => {
    const fx = setup()
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'AI' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagPage({ pageId: fx.pageId, workspaceId: fx.wsId, content: 'x' })
    await tagger.tagPage({ pageId: fx.pageId, workspaceId: fx.wsId, content: 'x' })
    expect(fx.tagStore.listPageTags(fx.pageId)).toHaveLength(1)
    fx.fb.close()
  })
})

describe('AutoTagger.tagNote — Sprint 016 M4 T21 (KI-005 closed)', () => {
  interface NoteFx {
    fb: FlowbrowserDatabase
    tagStore: TagStore
    noteStore: NoteStore
    wsId: string
    noteId: string
    pageId: string
  }

  function setupNote(): NoteFx {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const tagStore = new TagStore(fb)
    const noteStore = new NoteStore(fb)
    // page 1건 — KI-005 회귀 (note 태깅 시 page_tags 미박힘 검증용)
    const pageId = '22222222-2222-2222-2222-222222222222'
    fb.getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, 'https://x.test/n', 'N', 'body', 'h', 'en', 1, ?, ?)`
      )
      .run(pageId, ws.id, Date.now(), Date.now())
    const note = noteStore.create({
      workspace_id: ws.id,
      selected_text: '핵심 인용',
      body: '메모'
    })
    return { fb, tagStore, noteStore, wsId: ws.id, noteId: note.id, pageId }
  }

  let fx: NoteFx
  beforeEach(() => {
    fx = setupNote()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('schema 정상 응답 — note_tags 박힘 + page_tags 미박힘 (KI-005 FK 회귀)', async () => {
    const provider = makeChatStub(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'CAR-T' },
          { kind: 'entity', name: 'BioGen' }
        ]
      })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'note 본문'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.tags).toHaveLength(2)
      expect(result.schemaParsed).toBe(true)
    }
    // note_tags 박힘
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(2)
    // page_tags 미박힘 (KI-005 FK 위반 회귀)
    expect(fx.tagStore.listPageTags(fx.pageId)).toHaveLength(0)
  })

  it('responseFormat=json_object 항상 전달 (KI-004 정합)', async () => {
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagNote({ noteId: fx.noteId, workspaceId: fx.wsId, content: 'x' })
    expect(provider.chatCalls[0].responseFormat).toBe('json_object')
  })

  it('maxOutputTokens 전달 (codex T21 사전 dual review NB hotfix 회귀)', async () => {
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'x',
      maxOutputTokens: 256
    })
    expect(provider.chatCalls[0].maxOutputTokens).toBe(256)
  })

  it('empty content → skipped + note_tags 0', async () => {
    const provider = makeChatStub('{}')
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: '   \n\t '
    })
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') expect(result.reason).toBe('empty_content')
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(0)
  })

  it('provider.chat 미지원 → skipped', async () => {
    const provider = makeNoChatStub()
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') expect(result.reason).toBe('no_chat_support')
  })

  it('provider.chat throw → failed + note_tags 0', async () => {
    const provider = makeChatThrowStub(new Error('rate limit'))
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.error).toBe('rate limit')
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(0)
  })

  it('JSON 파싱 실패 → freeform fallback (note_tags 단일)', async () => {
    const provider = makeChatStub('이건 JSON 이 아닙니다')
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    const result = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'body'
    })
    expect(result.status).toBe('tagged')
    if (result.status === 'tagged') {
      expect(result.schemaParsed).toBe(false)
      expect(result.tags).toHaveLength(1)
      expect(result.tags[0].kind).toBe('freeform')
    }
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(1)
  })

  it('attachToNote 멱등 — 동일 (note, tag) 재첨부 시 INSERT OR IGNORE', async () => {
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'dedupe' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagNote({ noteId: fx.noteId, workspaceId: fx.wsId, content: 'x' })
    await tagger.tagNote({ noteId: fx.noteId, workspaceId: fx.wsId, content: 'x' })
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(1)
  })

  it('tagPage 와 tagNote 동시 호출 — 동일 (ws, kind, name) tag 공유 + page/note 양쪽 attach', async () => {
    // ensureTag 가 (ws, kind, name) 단위 idempotent — page 와 note 가 같은 tag 공유.
    const sharedResponse = JSON.stringify({ tags: [{ kind: 'topic', name: 'shared' }] })
    const provider = makeChatStub(sharedResponse)
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })

    const pageResult = await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'page body'
    })
    const noteResult = await tagger.tagNote({
      noteId: fx.noteId,
      workspaceId: fx.wsId,
      content: 'note body'
    })
    expect(pageResult.status).toBe('tagged')
    expect(noteResult.status).toBe('tagged')
    if (pageResult.status === 'tagged' && noteResult.status === 'tagged') {
      // 동일 tag id 공유
      expect(pageResult.tags[0].id).toBe(noteResult.tags[0].id)
    }
    // 양쪽 attach 박힘
    expect(fx.tagStore.listPageTags(fx.pageId)).toHaveLength(1)
    expect(fx.tagStore.listNoteTags(fx.noteId)).toHaveLength(1)
    // ws 단위 tag 1개만
    expect(fx.tagStore.listByWorkspace(fx.wsId)).toHaveLength(1)
  })
})

describe('AutoTagger.tagPage — maxOutputTokens hotfix (codex T21 사전 dual review NB 회귀)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('TagPageInput.maxOutputTokens → ChatRequest.maxOutputTokens 전달', async () => {
    const provider = makeChatStub(
      JSON.stringify({ tags: [{ kind: 'topic', name: 'x' }] })
    )
    const tagger = new AutoTagger({ provider, tagStore: fx.tagStore })
    await tagger.tagPage({
      pageId: fx.pageId,
      workspaceId: fx.wsId,
      content: 'x',
      maxOutputTokens: 512
    })
    expect(provider.chatCalls[0].maxOutputTokens).toBe(512)
  })
})

describe('parseTagsResponse 단위', () => {
  it('빈 input → null', () => {
    expect(parseTagsResponse('', 6)).toBeNull()
    expect(parseTagsResponse('   ', 6)).toBeNull()
  })

  it('잘못된 JSON → null', () => {
    expect(parseTagsResponse('not json', 6)).toBeNull()
  })

  it('tags 필드 누락 → null', () => {
    expect(parseTagsResponse(JSON.stringify({ foo: 'bar' }), 6)).toBeNull()
  })

  it('tags 가 array 아님 → null', () => {
    expect(parseTagsResponse(JSON.stringify({ tags: 'string' }), 6)).toBeNull()
  })

  it('모든 항목 invalid → null', () => {
    expect(parseTagsResponse(JSON.stringify({ tags: [{ kind: 'bogus' }] }), 6)).toBeNull()
  })

  it('maxTags 강제', () => {
    const text = JSON.stringify({
      tags: Array.from({ length: 10 }, (_, i) => ({ kind: 'topic', name: `t${i}` }))
    })
    const r = parseTagsResponse(text, 3)
    expect(r).toHaveLength(3)
  })

  /**
   * Sprint 016 M5 T23 — parseTagsResponse 후속 edge case.
   */
  it('T23 — tags 빈 array → null (parseTagsResponse 산식 정합 — empty 시 freeform fallback path 결정은 호출자 책임)', () => {
    // codex 사전 dual review NB-3 정합 — `tags: []` 는 parseTagsResponse 자체는 null 반환,
    // 호출자 (AutoTagger.tagPage / tagNote) 는 본 null 을 freeform fallback path 진입 신호로 사용.
    expect(parseTagsResponse(JSON.stringify({ tags: [] }), 6)).toBeNull()
  })

  it('T23 — tag.name 누락 → invalid 처리, 나머지만 반환', () => {
    const text = JSON.stringify({
      tags: [
        { kind: 'topic' /* name 누락 */ },
        { kind: 'topic', name: 'valid' }
      ]
    })
    const r = parseTagsResponse(text, 6)
    expect(r).not.toBeNull()
    expect(r!).toHaveLength(1)
    expect(r![0].name).toBe('valid')
  })

  it('T23 — tag.kind 6 가지 모두 valid (topic/entity/metric/sentiment/domain/freeform)', () => {
    const kinds = ['topic', 'entity', 'metric', 'sentiment', 'domain', 'freeform']
    for (const kind of kinds) {
      const r = parseTagsResponse(JSON.stringify({ tags: [{ kind, name: 't' }] }), 6)
      expect(r).not.toBeNull()
      expect(r!).toHaveLength(1)
      expect(r![0].kind).toBe(kind)
    }
  })

  it('T23 — maxTags 작은 값 (=1) — 첫 valid 1개만 반환', () => {
    const r = parseTagsResponse(
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'first' },
          { kind: 'topic', name: 'second' },
          { kind: 'topic', name: 'third' }
        ]
      }),
      1
    )
    expect(r).not.toBeNull()
    expect(r!).toHaveLength(1)
    expect(r![0].name).toBe('first')
  })

  it('T23 — partially invalid (valid 1 + invalid kind) — valid 만 반환', () => {
    const text = JSON.stringify({
      tags: [
        { kind: 'topic', name: 'valid-1' },
        { kind: 'bogus-kind', name: 'rejected' }
      ]
    })
    const r = parseTagsResponse(text, 6)
    expect(r).not.toBeNull()
    expect(r!.map((t) => t.name)).toEqual(['valid-1'])
  })

  it('T23 — tag.name whitespace → invalid 처리', () => {
    const text = JSON.stringify({ tags: [{ kind: 'topic', name: '   ' }] })
    const r = parseTagsResponse(text, 6)
    expect(r).toBeNull()
  })

  it('vi spy + provider.chat 호출 카운트 — schema 응답', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const ws = fb.ensureDefaultWorkspace()
    const tagStore = new TagStore(fb)
    const provider = makeChatStub(JSON.stringify({ tags: [{ kind: 'topic', name: 'spy' }] }))
    // chatCalls 배열을 직접 검증 (stub provider 가 모든 chat 호출 capture). vi.spyOn 의 optional 타입 추론 회피.
    const tagger = new AutoTagger({ provider, tagStore })
    fb.getDb()
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
         VALUES (?, ?, 'https://x.test/p', 'P', 'body', 'h', 'en', 1, ?, ?)`
      )
      .run('11111111-1111-1111-1111-111111111111', ws.id, Date.now(), Date.now())
    await tagger.tagPage({
      pageId: '11111111-1111-1111-1111-111111111111',
      workspaceId: ws.id,
      content: 'body',
      modelHint: 'custom-model'
    })
    expect(provider.chatCalls).toHaveLength(1)
    expect(provider.chatCalls[0].modelHint).toBe('custom-model')
    fb.close()
  })
})
