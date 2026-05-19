/**
 * Sprint 015 M6 T30 — 시나리오 1 (학술 리서치) 회귀 테스트.
 *
 * 입력: `.flowset/specs/v04-test-classification.md` §E1 시나리오 1 (5 케이스 S1-C1 ~ S1-C5)
 * Phase 1 종료 evaluator AC-8 핵심 통과 기준. 본 회귀 셋 100% 통과 시 시나리오 1 P1 cover.
 *
 * 통합 모듈:
 *   - FlowbrowserDatabase + VectorIndex (vec_pages cosine partition)
 *   - IndexedPageStoreSqlite (recordVisit + lookup + listVisits)
 *   - NoteStore + AiChatHistoryStore
 *   - SearchService (Page + Note retrieval + 시간 가중 정렬)
 *   - WorkspaceService (활성 ws + 마지막 1개 보호)
 *
 * 외부 provider 호출은 stub — chat_meta JSON 응답 deterministic 시나리오.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'
import { SearchService } from '../../../src/main/SearchService'
import { WorkspaceService } from '../../../src/main/WorkspaceService'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 정규화된 sparse vector — cosine distance 결정성 보장. */
function makeVec(components: Record<number, number>): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
  for (const [idx, val] of Object.entries(components)) {
    v[Number(idx)] = val
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm
  }
  return v
}

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  chatStore: AiChatHistoryStore
  search: SearchService
  workspace: WorkspaceService
  userSetting: UserSettingStore
  settingPath: string
  defaultId: string
  altId: string
}

async function setup(): Promise<Fx> {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  const altWs = fb.createWorkspace({ name: 'Other', icon: '🔬' })
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  const noteStore = new NoteStore(fb)
  const chatStore = new AiChatHistoryStore(fb)
  const search = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  const settingPath = join(
    tmpdir(),
    `scenario1-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )
  const userSetting = new UserSettingStore(settingPath)
  await userSetting.load()
  const workspace = new WorkspaceService({
    db: fb,
    userSettingStore: userSetting,
    defaultWorkspace: defaultWs
  })
  return {
    fb,
    vec,
    pageStore,
    noteStore,
    chatStore,
    search,
    workspace,
    userSetting,
    settingPath,
    defaultId: defaultWs.id,
    altId: altWs.id
  }
}

async function teardown(fx: Fx): Promise<void> {
  fx.fb.close()
  try {
    await fs.unlink(fx.settingPath)
  } catch {
    // ignore
  }
}

describe('시나리오 1 — 학술 리서치 회귀 셋', () => {
  let fx: Fx

  beforeEach(async () => {
    fx = await setup()
  })

  afterEach(async () => {
    await teardown(fx)
  })

  /**
   * S1-C1 — 자동 인덱싱 후 시간축 검색 → top-3 에 정답 페이지 포함.
   * 측정: top-3 hit rate (binary). cosine 정렬 결정성 추가 검증 (codex NB-1).
   */
  it('S1-C1: 자동 인덱싱 + 의미 검색 → top-3 hit + 정렬 결정성', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime() // codex NB-4 정정 — fixed timestamp
    // 3 페이지 인덱싱 (IL-2 면역 / 단백질 구조 / 일반 뉴스)
    const il2 = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://academic.example/il2-tcell',
      title: 'IL-2 mediated T cell activation',
      content: 'IL-2 cytokine signaling drives T-cell proliferation in adaptive immunity.',
      visited_at: now - 3 * 86_400_000
    })
    const struct = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://academic.example/protein-fold',
      title: 'AlphaFold protein structure prediction',
      content: 'Deep learning predicts 3D protein folding from amino acid sequence.',
      visited_at: now - 5 * 86_400_000
    })
    const news = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://news.example/weather',
      title: 'Weather forecast today',
      content: 'Sunny with afternoon clouds in metropolitan area.',
      visited_at: now - 2 * 86_400_000
    })
    // 임베딩 — il2 ↔ query 가장 가까움 (dim 0 우세)
    fx.vec.upsertPageEmbedding(il2.page.id, fx.defaultId, makeVec({ 0: 1.0, 1: 0.2 }))
    fx.vec.upsertPageEmbedding(struct.page.id, fx.defaultId, makeVec({ 2: 1.0 }))
    fx.vec.upsertPageEmbedding(news.page.id, fx.defaultId, makeVec({ 3: 1.0 }))
    const query = makeVec({ 0: 1.0, 1: 0.3 })
    const hits = fx.search.search({
      workspaceId: fx.defaultId,
      queryEmbedding: query,
      topK: 20,
      now
    })
    expect(hits.length).toBe(3)
    // top-3 에 IL-2 페이지 포함 (정답)
    const top3 = hits.slice(0, 3).map((h) => h.pageId)
    expect(top3).toContain(il2.page.id)
    // 최상위는 IL-2 (의미 가장 가까움)
    expect(hits[0].pageId).toBe(il2.page.id)
    // codex NB-1 정정 — cosine 결정성: il2 cosineSim 가 다른 페이지보다 명시 높음
    const il2Hit = hits.find((h) => h.pageId === il2.page.id)!
    const structHit = hits.find((h) => h.pageId === struct.page.id)!
    const newsHit = hits.find((h) => h.pageId === news.page.id)!
    expect(il2Hit.cosineSim).toBeGreaterThan(structHit.cosineSim)
    expect(il2Hit.cosineSim).toBeGreaterThan(newsHit.cosineSim)
    // cosine metric 정합 검증 — distance = 1 - cosineSim (vec0 cosine 디폴트)
    expect(il2Hit.distance).toBeCloseTo(1 - il2Hit.cosineSim, 5)
  })

  /**
   * S1-C2 — 검색 결과 클릭 → 본문 캐시 + 노트 + AI 대화 모두 복원.
   */
  it('S1-C2: 검색 결과 클릭 시 본문 캐시 + 노트 + AI 대화 복원', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime() // codex NB-4 — fixed timestamp
    const page = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://academic.example/article',
      title: 'Article',
      content: 'Body content of article.',
      visited_at: now - 86_400_000
    })
    fx.vec.upsertPageEmbedding(page.page.id, fx.defaultId, makeVec({ 0: 1.0 }))

    // 해당 visit 에 노트 + AI 대화 추가
    fx.noteStore.create({
      workspace_id: fx.defaultId,
      page_id: page.page.id,
      visit_id: page.visit.id,
      selected_text: 'key insight here',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })
    fx.chatStore.create({
      workspace_id: fx.defaultId,
      page_id: page.page.id,
      visit_id: page.visit.id,
      role: 'user',
      content: 'Explain this concept',
      retrieved_items: null,
      chat_meta: null,
      status: 'ok'
    })
    fx.chatStore.create({
      workspace_id: fx.defaultId,
      page_id: page.page.id,
      visit_id: page.visit.id,
      role: 'assistant',
      content: 'The concept is...',
      retrieved_items: null,
      chat_meta: null,
      status: 'ok'
    })

    // 검색 → 클릭 시뮬레이션 — pageStore.getPage(pageId) + noteStore.listByPage + chatStore.listByPage
    const hit = fx.search.search({
      workspaceId: fx.defaultId,
      queryEmbedding: makeVec({ 0: 1.0 }),
      topK: 5,
      now
    })[0]
    expect(hit.pageId).toBe(page.page.id)

    const restoredPage = fx.pageStore.getPage(hit.pageId!)
    expect(restoredPage?.content).toBe('Body content of article.')

    const restoredNotes = fx.noteStore.listByPage(hit.pageId!)
    expect(restoredNotes.length).toBe(1)
    expect(restoredNotes[0].selected_text).toBe('key insight here')

    const restoredChats = fx.chatStore.listByPage(hit.pageId!)
    expect(restoredChats.length).toBe(2)
    expect(restoredChats.map((c) => c.role)).toEqual(['user', 'assistant'])
  })

  /**
   * S1-C3 — AI 채팅 비교 표 schema 검증 (Markdown + JSON 메타).
   * chat_meta 가 PRD §10.3.2 schema (rows/columns/cells[{value, sources?}]) 정합.
   */
  it('S1-C3: AI 채팅 chat_meta 표 schema (rows/columns/cells/sources)', () => {
    const chatMeta = {
      kind: 'table',
      rows: ['IL-2', 'IL-4'],
      columns: ['Function', 'Source'],
      cells: [
        [
          { value: 'T cell activation', sources: ['page-1'] },
          { value: 'cytokine', sources: ['page-1'] }
        ],
        [
          { value: 'B cell activation', sources: ['page-2'] },
          { value: 'cytokine', sources: ['page-2'] }
        ]
      ]
    }
    const row = fx.chatStore.create({
      workspace_id: fx.defaultId,
      role: 'assistant',
      content: 'IL-2 vs IL-4 비교표',
      retrieved_items: [
        { type: 'page', id: 'page-1' },
        { type: 'page', id: 'page-2' }
      ],
      chat_meta: chatMeta,
      status: 'ok'
    })
    const stored = fx.chatStore.findById(row.id)!
    expect(stored.chat_meta).toBeTruthy()
    const meta = stored.chat_meta as typeof chatMeta
    expect(meta.kind).toBe('table')
    expect(meta.rows).toEqual(['IL-2', 'IL-4'])
    expect(meta.columns).toEqual(['Function', 'Source'])
    expect(meta.cells.length).toBe(2)
    expect(meta.cells[0].length).toBe(2)
    // 출처 셀 정합 — page id 포함
    expect(meta.cells[0][0].sources).toEqual(['page-1'])
    expect(meta.cells[1][1].sources).toEqual(['page-2'])
  })

  /**
   * S1-C4 — 노트 추가 → DB 3중 anchor (page + visit + workspace).
   */
  it('S1-C4: 노트 추가 시 3중 anchor 정확성', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime() // codex NB-4 — fixed timestamp
    const page = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://academic.example/ref',
      title: 'Ref',
      content: 'reference body',
      visited_at: now
    })
    const note = fx.noteStore.create({
      workspace_id: fx.defaultId,
      page_id: page.page.id,
      visit_id: page.visit.id,
      selected_text: 'mechanism',
      body: 'My understanding: the mechanism is X',
      ai_tags: ['mechanism', 'biology'],
      created_by: 'user'
    })
    expect(note.workspace_id).toBe(fx.defaultId)
    expect(note.page_id).toBe(page.page.id)
    expect(note.visit_id).toBe(page.visit.id)
    expect(note.selected_text).toBe('mechanism')
    expect(note.ai_tags).toEqual(['mechanism', 'biology'])
    expect(note.created_by).toBe('user')

    // listByWorkspace 정합
    const list = fx.noteStore.listByWorkspace(fx.defaultId)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(note.id)
  })

  /**
   * S1-C5 — 워크스페이스 전환 → 다른 워크스페이스 retrieval 결과 0.
   */
  it('S1-C5: 워크스페이스 전환 시 retrieval 격리 (다른 ws 누설 0)', async () => {
    const now = new Date('2026-05-19T12:00:00+09:00').getTime() // codex NB-4 — fixed timestamp
    // Default ws 에 페이지 + 노트
    const pageDefault = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://default.example/p',
      title: 'Default page',
      content: 'default content',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(pageDefault.page.id, fx.defaultId, makeVec({ 0: 1.0 }))
    fx.noteStore.create({
      workspace_id: fx.defaultId,
      page_id: pageDefault.page.id,
      visit_id: pageDefault.visit.id,
      selected_text: 'default note',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })
    // Alt ws 에도 다른 페이지 + 노트
    const pageAlt = await fx.pageStore.recordVisit({
      workspace_id: fx.altId,
      url: 'https://alt.example/p',
      title: 'Alt page',
      content: 'alt content',
      visited_at: now
    })
    fx.vec.upsertPageEmbedding(pageAlt.page.id, fx.altId, makeVec({ 0: 1.0 }))
    fx.noteStore.create({
      workspace_id: fx.altId,
      page_id: pageAlt.page.id,
      visit_id: pageAlt.visit.id,
      selected_text: 'alt note',
      body: null,
      ai_tags: null,
      created_by: 'user'
    })

    // Default ws active — getActiveId() 결과를 직접 사용 (codex NB-2 정정)
    expect(fx.workspace.getActiveId()).toBe(fx.defaultId)
    const hitsDefault = fx.search.search({
      workspaceId: fx.workspace.getActiveId(),
      queryEmbedding: makeVec({ 0: 1.0 }),
      topK: 10,
      now
    })
    // codex NB-3 정정 — 자체 ws 결과 정확 1건 존재 검증 (빈 결과로 통과 회피)
    expect(hitsDefault.length).toBe(1)
    expect(hitsDefault[0].pageId).toBe(pageDefault.page.id)
    expect(hitsDefault[0].workspaceId).toBe(fx.defaultId)
    expect(hitsDefault.find((h) => h.pageId === pageAlt.page.id)).toBeUndefined()

    // Workspace 전환 (setActive) — UserSetting.activeWorkspaceId 갱신
    await fx.workspace.setActive(fx.altId)
    expect(fx.workspace.getActiveId()).toBe(fx.altId)

    // Alt ws 검색 — codex NB-2 정정: setActive 후 getActiveId() 그대로 활용 (명시 id 미주입)
    const hitsAlt = fx.search.search({
      workspaceId: fx.workspace.getActiveId(),
      queryEmbedding: makeVec({ 0: 1.0 }),
      topK: 10,
      now
    })
    expect(hitsAlt.length).toBe(1)
    expect(hitsAlt[0].pageId).toBe(pageAlt.page.id)
    expect(hitsAlt[0].workspaceId).toBe(fx.altId)
    expect(hitsAlt.find((h) => h.pageId === pageDefault.page.id)).toBeUndefined()

    // 노트도 ws 격리
    const notesDefault = fx.noteStore.listByWorkspace(fx.defaultId)
    const notesAlt = fx.noteStore.listByWorkspace(fx.altId)
    expect(notesDefault.length).toBe(1)
    expect(notesAlt.length).toBe(1)
    expect(notesDefault[0].selected_text).toBe('default note')
    expect(notesAlt[0].selected_text).toBe('alt note')
  })
})
