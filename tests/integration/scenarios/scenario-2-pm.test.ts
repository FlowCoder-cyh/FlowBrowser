/**
 * Sprint 016 M1 T07 — 시나리오 2 (PM 경쟁 분석) 회귀 테스트.
 *
 * 입력: `.flowset/specs/v04-test-classification.md` §E1 시나리오 2 (5 케이스 S2-C1 ~ S2-C5)
 * Sprint 016 contract AC-2 핵심. 본 회귀 셋 5/5 통과 시 시나리오 2 P1 cover 100%.
 * v04-direction §11 가치 명제 cover 90% (Notion 외부 전송은 Phase 3 위임).
 *
 * 통합 모듈:
 *   - FlowbrowserDatabase + VectorIndex (vec_pages cosine partition)
 *   - IndexedPageStoreSqlite (recordVisit + lookup + listVisits)
 *   - AutoTagger + TagStore (Tag.kind 6종: topic/entity/metric/sentiment/domain/freeform)
 *   - AiChatHistoryStore (chat_meta 비교 표 + retrieved_items)
 *   - SearchService (top-K + 시간 + 의미 결합) + TimeRangeParser (자연어 시간)
 *   - accuracyHelpers (KI-018 top-10 hit rate)
 *
 * 외부 provider 호출은 StubProvider — schema JSON 응답 deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { AiChatHistoryStore } from '../../../src/storage/AiChatHistoryStore'
import { TagStore } from '../../../src/storage/TagStore'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { SearchService } from '../../../src/main/SearchService'
import { AutoTagger } from '../../../src/ai/tagging/AutoTagger'
import { parseTimeRange } from '../../../src/main/TimeRangeParser'
import {
  isValidChatMetaTable,
  type ChatMetaTableData,
  type ChatMetaSource
} from '../../../src/renderer/src/chat/chatMetaTableSchema'
import type { ProviderAdapter } from '../../../src/ai/ProviderAdapter'
import type { ChatRequest, ChatResponse, ProviderInfo } from '../../../src/ai/types'
import { topKHitRate, TOP_K_HIT_RATE_THRESHOLD } from './accuracyHelpers'
import type { RetrievalPair } from './accuracyHelpers'

const DAY = 86_400_000

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

/** schema 정형 응답 (5종 + freeform 1 = 6) StubProvider. AutoTagger.test.ts 동일 패턴 정합. */
function makeChatStub(responseText: string): ProviderAdapter {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'StubOpenAI',
    supportedRequestTypes: ['selection'],
    defaultModel: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini'],
    supportsChat: true,
    supportsEmbed: false
  }
  return {
    info,
    async chat(_request: ChatRequest): Promise<ChatResponse> {
      return {
        text: responseText,
        modelUsed: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.0001,
        durationMs: 250
      }
    },
    async translate() {
      throw new Error('not used')
    },
    async validate() {
      return { ok: true }
    }
  } as unknown as ProviderAdapter
}

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  chatStore: AiChatHistoryStore
  tagStore: TagStore
  search: SearchService
  wsId: string
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const ws = fb.ensureDefaultWorkspace()
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const noteStore = new NoteStore(fb)
  const chatStore = new AiChatHistoryStore(fb)
  const tagStore = new TagStore(fb)
  const search = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  return { fb, vec, pageStore, noteStore, chatStore, tagStore, search, wsId: ws.id }
}

describe('시나리오 2 — PM 경쟁 분석 회귀 셋', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  /**
   * S2-C1 — 수집 모드: 10 페이지 자유 방문 + 자동 인덱싱.
   * 측정: N개 페이지 인덱싱 통과 (countPages == 10 + listVisits 누락 0).
   */
  it('S2-C1: 수집 모드 (10 페이지 자동 인덱싱 + countPages 정합)', async () => {
    const now = new Date('2026-05-19T10:00:00+09:00').getTime()
    const products = [
      { slug: 'linear-vs-jira', title: 'Linear vs Jira 비교 — PM 관점' },
      { slug: 'asana-pricing', title: 'Asana Pricing 2026' },
      { slug: 'monday-roadmap', title: 'Monday 로드맵 기능' },
      { slug: 'clickup-review', title: 'ClickUp 리뷰 — 단점' },
      { slug: 'notion-projects', title: 'Notion Projects 한계' },
      { slug: 'shortcut-vs-linear', title: 'Shortcut vs Linear' },
      { slug: 'jira-cloud-pricing', title: 'Jira Cloud Pricing 2026' },
      { slug: 'plane-oss', title: 'Plane OSS 대안' },
      { slug: 'trello-revival', title: 'Trello 부활?' },
      { slug: 'height-app', title: 'Height App 신규' }
    ]
    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      const visited = now - (products.length - i) * 60 * 60_000
      await fx.pageStore.recordVisit({
        workspace_id: fx.wsId,
        url: `https://pm.example/${p.slug}`,
        title: p.title,
        content: `${p.title} 본문 내용 — PM 도구 경쟁 분석용.`,
        visited_at: visited
      })
    }
    expect(fx.pageStore.countPages(fx.wsId)).toBe(10)
    expect(fx.pageStore.countVisits(fx.wsId)).toBe(10)
    // 각 페이지가 visit 1건씩 정확히 누적
    const stats = fx.pageStore.stats()
    expect(stats.perWorkspace[fx.wsId]).toEqual({ pages: 10, visits: 10 })
  })

  /**
   * S2-C2 — AI 자동 태깅 정형 5종 (topic/entity/metric/sentiment/domain) + freeform 1.
   * 측정: Tag.kind 6종 모두 추출 통과 (각 kind 최소 1건).
   */
  it('S2-C2: AI 자동 태깅 정형 5종 + freeform — Tag.kind 6종 모두 추출', async () => {
    const now = new Date('2026-05-19T11:00:00+09:00').getTime()
    const page = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://pm.example/linear-deep-dive',
      title: 'Linear vs Jira — 가격 + 속도 비교',
      content:
        'Linear 의 가격은 사용자당 $10, Jira 는 $7.5. 속도는 Linear 가 10x 빠르다는 사용자 평가가 많다.',
      visited_at: now - 60_000
    })
    // 정형 5 + freeform 1 = 6 태그 JSON 응답 (스키마 정합)
    const responseText = JSON.stringify({
      tags: [
        { kind: 'topic', name: 'PM 도구 경쟁' },
        { kind: 'entity', name: 'Linear' },
        { kind: 'metric', name: '10x 속도' },
        { kind: 'sentiment', name: '긍정' },
        { kind: 'domain', name: 'project-management' },
        { kind: 'freeform', name: '사용자당 $10 가격대' }
      ]
    })
    const stub = makeChatStub(responseText)
    const tagger = new AutoTagger({
      provider: stub,
      tagStore: fx.tagStore,
      maxTags: 6
    })
    const result = await tagger.tagPage({
      pageId: page.page.id,
      workspaceId: fx.wsId,
      title: page.page.title ?? undefined,
      content: page.page.content ?? ''
    })

    expect(result.status).toBe('tagged')
    if (result.status !== 'tagged') return // type narrowing
    expect(result.schemaParsed).toBe(true)
    expect(result.tags.length).toBe(6)
    // Tag.kind 6종 모두 cover
    const kinds = new Set(result.tags.map((t) => t.kind))
    expect(kinds.has('topic')).toBe(true)
    expect(kinds.has('entity')).toBe(true)
    expect(kinds.has('metric')).toBe(true)
    expect(kinds.has('sentiment')).toBe(true)
    expect(kinds.has('domain')).toBe(true)
    expect(kinds.has('freeform')).toBe(true)
    // page 와 attach 정합
    const attached = fx.tagStore.listPageTags(page.page.id)
    expect(attached.length).toBe(6)
    // ai_generated true (AutoTagger 자동 추출)
    expect(attached.every((t) => t.ai_generated)).toBe(true)
  })

  /**
   * S2-C3 — 비교 매트릭스 (3x4 표) + 셀별 출처 표시.
   *
   * chat_meta schema 정합 — `src/renderer/src/chat/chatMetaTableSchema.ts` (Sprint 015 M5-6 통일 형식):
   *   - cells: row-major **flat** ChatMetaTableCell[] (length === rows.length × columns.length)
   *   - sources: ChatMetaSource[] (`{ type, id, page_id?, visit_id? }` object 형식)
   *
   * 본 케이스는 isValidChatMetaTable() 통과 강제 (codex BLOCKING #1 흡수 — 2026-05-20).
   *
   * 측정 protocol: 표 schema + sources 배열 검증 + 12 셀별 출처 hallucination 0.
   */
  it('S2-C3: 비교 매트릭스 3x4 표 + 12 셀별 출처 (isValidChatMetaTable 정합)', () => {
    // 3 제품 페이지 (PageId 직접 INSERT — chat_meta sources 참조용)
    const productPageIds = ['linear-page', 'jira-page', 'asana-page']
    const now = Date.now()
    for (const pid of productPageIds) {
      fx.fb
        .getDb()
        .prepare(
          `INSERT INTO pages(id, workspace_id, url, title, content, content_hash, lang, visited_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ko', 1, ?, ?)`
        )
        .run(pid, fx.wsId, `https://pm.example/${pid}`, pid, 'body', `h-${pid}`, now, now)
    }

    // 3 행 (제품) × 4 열 (가격 / 속도 / 협업 / 무료 한계) — flat row-major (12 셀)
    const cells: ChatMetaTableData['cells'] = [
      // row 0 — Linear
      { value: '$10/user', sources: [{ type: 'page', id: 'linear-page', page_id: 'linear-page' }] },
      { value: '10x faster', sources: [{ type: 'page', id: 'linear-page', page_id: 'linear-page' }] },
      { value: 'real-time', sources: [{ type: 'page', id: 'linear-page', page_id: 'linear-page' }] },
      { value: '10명/팀', sources: [{ type: 'page', id: 'linear-page', page_id: 'linear-page' }] },
      // row 1 — Jira
      { value: '$7.5/user', sources: [{ type: 'page', id: 'jira-page', page_id: 'jira-page' }] },
      { value: 'medium', sources: [{ type: 'page', id: 'jira-page', page_id: 'jira-page' }] },
      { value: 'plugin 기반', sources: [{ type: 'page', id: 'jira-page', page_id: 'jira-page' }] },
      { value: '10명/팀', sources: [{ type: 'page', id: 'jira-page', page_id: 'jira-page' }] },
      // row 2 — Asana
      { value: '$13.49/user', sources: [{ type: 'page', id: 'asana-page', page_id: 'asana-page' }] },
      { value: 'medium', sources: [{ type: 'page', id: 'asana-page', page_id: 'asana-page' }] },
      { value: 'timeline', sources: [{ type: 'page', id: 'asana-page', page_id: 'asana-page' }] },
      { value: '15명/팀', sources: [{ type: 'page', id: 'asana-page', page_id: 'asana-page' }] }
    ]
    const chatMeta: ChatMetaTableData = {
      rows: ['Linear', 'Jira', 'Asana'],
      columns: ['가격', '속도', '협업', '무료 한계'],
      cells
    }

    // schema 정합 강제 — renderer 가 거부 안 함
    expect(isValidChatMetaTable(chatMeta)).toBe(true)

    const row = fx.chatStore.create({
      workspace_id: fx.wsId,
      role: 'assistant',
      content: 'Linear vs Jira vs Asana 비교표',
      retrieved_items: productPageIds.map((id) => ({ type: 'page', id })),
      chat_meta: chatMeta,
      status: 'ok'
    })

    const stored = fx.chatStore.findById(row.id)!
    expect(stored.chat_meta).toBeTruthy()
    // 영속 후에도 schema 정합 유지
    expect(isValidChatMetaTable(stored.chat_meta)).toBe(true)
    const meta = stored.chat_meta as ChatMetaTableData
    expect(meta.rows).toEqual(['Linear', 'Jira', 'Asana'])
    expect(meta.columns).toEqual(['가격', '속도', '협업', '무료 한계'])
    // 3x4 매트릭스 invariant (cells.length === rows.length × columns.length)
    expect(meta.cells.length).toBe(3 * 4)

    // 12 셀 모두 sources 비어있지 않음 + page id 가 retrieved_items 안에 속함 (KI-019 산식)
    const retrievedIds = new Set(productPageIds)
    let citedHits = 0
    let totalCitations = 0
    for (const cell of meta.cells) {
      expect(cell.sources.length).toBeGreaterThan(0)
      for (const src of cell.sources as ChatMetaSource[]) {
        totalCitations += 1
        // KI-019 산식 — source object 에서 page id normalize (page_id 우선, 없으면 id)
        const pageId = src.type === 'page' ? (src.page_id ?? src.id) : src.page_id
        if (pageId && retrievedIds.has(pageId)) citedHits += 1
      }
    }
    expect(totalCitations).toBe(12)
    // 모든 출처가 retrieved_items 안에 속함 (hallucination 0 — KI-019 본 케이스 산식)
    expect(citedHits).toBe(12)
  })

  /**
   * S2-C4 — 시간 + 의미 검색 (어제 본 Reddit 스레드 Linear 단점).
   * 측정: top-3 hit rate 단일 케이스 + accuracyHelpers.topKHitRate 5 페어 셋 (KI-018 ≥ 80%).
   *
   * NOTE (codex NEEDS_CHANGES #2 흡수 — 2026-05-20):
   * 본 5 페어 셋은 KI-018 산식 적용 example 자체. 노이즈 vector 가 정답과 분리된 dim
   * (100/101) 이라 hit rate 100% 가 자명 — 실 환경의 의미 충돌 페어 (제품 동의어 / 인접
   * domain) cover 부족. KI-018 closed 전환은 본 케이스 단독 근거 불충분 — Sprint 016
   * contract §6 매트릭스 #3 "회귀 셋 + 50 페어 자체 테스트 셋" 의 50 페어 자체 셋 별도
   * 구축 후 KI-018 closed 판단 (후속 hotfix 또는 Sprint 016 M5 T23 종합 시점).
   */
  it('S2-C4: 시간 + 의미 검색 → top-3 hit + topKHitRate ≥ 80% (KI-018 산식 적용 example)', async () => {
    const now = new Date('2026-05-19T15:00:00+09:00').getTime()
    // 5 페어 셋 — 모두 정답 페이지 1건 + 노이즈 페이지 2건 인덱싱
    const fixtures = [
      { topic: 'linear', queryDim: 0, days: 1 }, // 어제 본 Linear
      { topic: 'jira', queryDim: 1, days: 2 },
      { topic: 'asana', queryDim: 2, days: 3 },
      { topic: 'monday', queryDim: 3, days: 4 },
      { topic: 'clickup', queryDim: 4, days: 5 }
    ]
    const pairs: RetrievalPair[] = []
    for (const fx2 of fixtures) {
      const expected = await fx.pageStore.recordVisit({
        workspace_id: fx.wsId,
        url: `https://reddit.example/r/pm/${fx2.topic}-thread`,
        title: `${fx2.topic} 단점 토론`,
        content: `${fx2.topic} 의 약점 / 한계 / 단점 thread.`,
        visited_at: now - fx2.days * DAY
      })
      fx.vec.upsertPageEmbedding(
        expected.page.id,
        fx.wsId,
        makeVec({ [fx2.queryDim]: 1.0 })
      )
      // 노이즈 페이지 2건 (의미적으로 거리 큼)
      const noise1 = await fx.pageStore.recordVisit({
        workspace_id: fx.wsId,
        url: `https://news.example/${fx2.topic}-noise-${fx2.days}-1`,
        title: 'Unrelated news',
        content: 'unrelated body',
        visited_at: now - fx2.days * DAY - 60_000
      })
      const noise2 = await fx.pageStore.recordVisit({
        workspace_id: fx.wsId,
        url: `https://news.example/${fx2.topic}-noise-${fx2.days}-2`,
        title: 'Other news',
        content: 'other body',
        visited_at: now - fx2.days * DAY - 120_000
      })
      fx.vec.upsertPageEmbedding(noise1.page.id, fx.wsId, makeVec({ 100: 1.0 }))
      fx.vec.upsertPageEmbedding(noise2.page.id, fx.wsId, makeVec({ 101: 1.0 }))

      const hits = fx.search.search({
        workspaceId: fx.wsId,
        queryEmbedding: makeVec({ [fx2.queryDim]: 1.0 }),
        topK: 10,
        now
      })
      pairs.push({
        expected: [expected.page.id],
        returnedTopK: hits.map((h) => h.pageId!).filter((id): id is string => !!id)
      })
    }

    // 첫 페어 — 어제 본 Linear 케이스: top-3 안에 정답 포함
    const firstHits = pairs[0].returnedTopK.slice(0, 3)
    expect(firstHits).toContain(pairs[0].expected[0])

    // 시간 필터 결합 — "어제" 표현이 firstHits 페이지 visited_at 범위에 포함되는지 검증
    const range = parseTimeRange('어제', { now })
    expect(range.range).not.toBeNull()
    const filtered = fx.search.search({
      workspaceId: fx.wsId,
      queryEmbedding: makeVec({ 0: 1.0 }),
      topK: 10,
      timeRange: range.range,
      now
    })
    // 어제 본 Linear 페이지 포함 (1일 전 visited_at) — noise 노이즈는 어제 범위면 같이 포함되어도 됨, 정답이 있는지만 검증
    expect(filtered.find((h) => h.pageId === pairs[0].expected[0])).toBeDefined()

    // KI-018 — 5 페어 셋 top-10 hit rate ≥ 80%
    const hitRate = topKHitRate(pairs, 10)
    expect(hitRate).toBeGreaterThanOrEqual(TOP_K_HIT_RATE_THRESHOLD)
  })

  /**
   * S2-C5 — Export 데이터 생성 (Phase 3 외부 전송 위임).
   * 측정: JSON.stringify(payload) 직렬화 + parsed shape 필수 필드 보존.
   *
   * NOTE (codex NEEDS_CHANGES #1 흡수 — 2026-05-20):
   * 본 케이스는 시나리오 cover 목적 **minimal data bundle** — workspace + pages + visits +
   * notes + chats + tags 6 엔티티의 JSON 직렬화 가능성 + shape 정합만 검증. 실 export IPC
   * (`workspace:export-json` Sprint 016 M3 T17) 는 별도 PR — T17 시점에 page_tags /
   * note_tags M:N association + chat_meta 표 + ai_chat_history retrieved_items 등 PRD §11.5
   * "Workspace + Page + Visit + Note + AiChatHistory + Tag 전체 보존" 임계 cover 권고
   * (본 PR 의 ad-hoc payload 구조는 T17 schema base 아님).
   */
  it('S2-C5: Export 데이터 생성 (minimal data bundle 6 엔티티 JSON)', async () => {
    const now = new Date('2026-05-19T16:00:00+09:00').getTime()
    // 페이지 1건 + visit + 노트 + 채팅 + 태그
    const p = await fx.pageStore.recordVisit({
      workspace_id: fx.wsId,
      url: 'https://pm.example/linear-vs-jira-final',
      title: 'Linear vs Jira 최종 결론',
      content: 'Linear 가 작은 팀에 적합, Jira 는 엔터프라이즈.',
      visited_at: now - 30 * 60_000
    })
    const note = fx.noteStore.create({
      workspace_id: fx.wsId,
      page_id: p.page.id,
      visit_id: p.visit.id,
      selected_text: '작은 팀에 적합',
      body: '우리 PM 팀 사이즈와 정합',
      ai_tags: ['topic', 'decision'],
      created_by: 'user'
    })
    const chat = fx.chatStore.create({
      workspace_id: fx.wsId,
      page_id: p.page.id,
      visit_id: p.visit.id,
      role: 'assistant',
      content: '결론: 팀 사이즈 < 20이면 Linear 권고',
      retrieved_items: [{ type: 'page', id: p.page.id }],
      chat_meta: null,
      status: 'ok'
    })
    const tag = fx.tagStore.ensureTag({
      workspace_id: fx.wsId,
      kind: 'topic',
      name: 'PM 도구 선정',
      ai_generated: false
    })
    fx.tagStore.attachToPage(p.page.id, {
      workspace_id: fx.wsId,
      tag_id: tag.id,
      ai_generated: false
    })

    // Export payload 데이터 모음 — 실 T17 IPC schema 정합 base (workspace + 5 엔티티)
    const payload = {
      schemaVersion: 1,
      exportedAt: now,
      workspace: { id: fx.wsId },
      pages: [fx.pageStore.getPage(p.page.id)],
      visits: fx.pageStore.listVisits(p.page.id),
      notes: fx.noteStore.listByWorkspace(fx.wsId),
      chats: fx.chatStore.listByWorkspace(fx.wsId),
      tags: fx.tagStore.listByWorkspace(fx.wsId)
    }

    const serialized = JSON.stringify(payload)
    expect(serialized.length).toBeGreaterThan(0)
    const parsed = JSON.parse(serialized) as typeof payload

    // shape 필드 보존
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe(now)
    expect(parsed.workspace.id).toBe(fx.wsId)
    expect(parsed.pages.length).toBe(1)
    expect(parsed.pages[0]?.id).toBe(p.page.id)
    expect(parsed.pages[0]?.title).toBe('Linear vs Jira 최종 결론')
    expect(parsed.visits.length).toBe(1)
    expect(parsed.visits[0].id).toBe(p.visit.id)
    expect(parsed.notes.length).toBe(1)
    expect(parsed.notes[0].id).toBe(note.id)
    expect(parsed.notes[0].selected_text).toBe('작은 팀에 적합')
    expect(parsed.notes[0].ai_tags).toEqual(['topic', 'decision'])
    expect(parsed.chats.length).toBe(1)
    expect(parsed.chats[0].id).toBe(chat.id)
    expect(parsed.chats[0].retrieved_items).toEqual([{ type: 'page', id: p.page.id }])
    expect(parsed.tags.length).toBe(1)
    expect(parsed.tags[0].id).toBe(tag.id)
    expect(parsed.tags[0].kind).toBe('topic')
  })
})
