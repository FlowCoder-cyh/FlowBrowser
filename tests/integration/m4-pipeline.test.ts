/**
 * Sprint 015 M4-5 — M4 통합 파이프라인 회귀 테스트.
 *
 * 시나리오 회귀 (PRD §02.2 시나리오 1~4 / contract sprint-015 §3 AC-5 / AC-8 회귀 셋):
 *   - 시나리오 1: 학술 페이지 자동 인덱싱 + 임베딩 큐 + 자동 태깅
 *   - 시나리오 3: 재방문 본문 동일 → Visit 누적, 임베딩 재사용
 *   - 시나리오 3 변형: 재방문 본문 변경 → 임베딩 재생성 + Visit 누적
 *   - DwellTracker: 페이지 진입 → focus 잃음 → 복귀 → 종료 → Visit.dwell_ms UPDATE
 *
 * 본 통합 테스트는 IndexingService + IndexingGate + IndexedPageStoreSqlite + EmbeddingQueue +
 * AutoTagger + TagStore + DwellTracker 7 모듈을 end-to-end 로 검증.
 *
 * 외부 의존 (provider.chat) 은 stub 으로 격리 — 실측 정확도 (PRD §8.8.4 ≥80%) 는 별도 Phase 1
 * 종료 evaluator 시점 실제 OpenAI 호출로 측정 (KI 후보).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { EmbeddingQueue } from '../../src/storage/EmbeddingQueue'
import { TagStore } from '../../src/storage/TagStore'
import { IndexingGate } from '../../src/privacy/IndexingGate'
import { IndexingService } from '../../src/main/IndexingService'
import { DwellTracker } from '../../src/main/DwellTracker'
import { AutoTagger } from '../../src/ai/tagging/AutoTagger'
import type { ProviderAdapter } from '../../src/ai/ProviderAdapter'
import type { ProviderInfo, ChatRequest, ChatResponse } from '../../src/ai/types'

interface Pipeline {
  fb: FlowbrowserDatabase
  pageStore: IndexedPageStoreSqlite
  embeddingQueue: EmbeddingQueue
  tagStore: TagStore
  gate: IndexingGate
  service: IndexingService
  dwell: DwellTracker
  tagger: AutoTagger
  provider: StubProvider
  defaultWsId: string
}

interface StubProvider extends ProviderAdapter {
  chatCalls: ChatRequest[]
  scriptedResponses: string[]
}

function makeProvider(scriptedResponses: string[]): StubProvider {
  const info: ProviderInfo = {
    providerType: 'openai',
    displayName: 'StubOpenAI',
    supportedRequestTypes: ['selection'],
    defaultModel: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini'],
    supportsChat: true,
    supportsEmbed: true
  }
  const calls: ChatRequest[] = []
  return {
    info,
    chatCalls: calls,
    scriptedResponses,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request)
      const idx = calls.length - 1
      const text = scriptedResponses[idx] ?? scriptedResponses[scriptedResponses.length - 1]
      return {
        text,
        modelUsed: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.0001,
        durationMs: 250
      }
    },
    async translate() {
      throw new Error('not used in M4 pipeline')
    },
    async validate() {
      return { ok: true }
    }
  } as unknown as StubProvider
}

function setup(scriptedTagResponses: string[] = []): Pipeline {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  const embeddingQueue = new EmbeddingQueue(fb)
  const tagStore = new TagStore(fb)
  const gate = new IndexingGate()
  const service = new IndexingService({ gate, pageStore, embeddingQueue })
  const dwell = new DwellTracker({
    onStop: (p) => {
      pageStore.updateVisitDwell(p.visitId, p.dwellMs)
    }
  })
  const provider = makeProvider(scriptedTagResponses)
  const tagger = new AutoTagger({ provider, tagStore })
  return {
    fb,
    pageStore,
    embeddingQueue,
    tagStore,
    gate,
    service,
    dwell,
    tagger,
    provider,
    defaultWsId: defaultWs.id
  }
}

describe('M4 통합 — 시나리오 1: 학술 페이지 자동 인덱싱 + 자동 태깅', () => {
  let p: Pipeline
  beforeEach(() => {
    p = setup([
      JSON.stringify({
        tags: [
          { kind: 'topic', name: 'CAR-T 저항성' },
          { kind: 'entity', name: 'BioGen' },
          { kind: 'domain', name: 'medicine' }
        ]
      })
    ])
  })
  afterEach(() => {
    p.fb.close()
  })

  it('end-to-end: indexPage → recordVisit → EmbeddingQueue.enqueue → AutoTagger.tagPage → TagStore', async () => {
    const indexResult = await p.service.indexPage({
      url: 'https://nature.com/paper/car-t',
      title: 'CAR-T resistance mechanism',
      content: 'Article body about CAR-T resistance in patients...',
      hasPasswordField: false,
      isActiveTab: true
    })
    expect(indexResult.status).toBe('indexed')
    if (indexResult.status !== 'indexed') return

    expect(indexResult.action).toBe('created')
    expect(indexResult.embeddingJobId).toBeTruthy()
    expect(p.pageStore.countPages()).toBe(1)
    expect(p.pageStore.countVisits()).toBe(1)
    expect(p.embeddingQueue.stats().pending).toBe(1)

    // 임베딩 priority 활성 탭 = 10
    const job = p.embeddingQueue.findById(indexResult.embeddingJobId!)
    expect(job!.priority).toBe(10)
    expect(job!.target_type).toBe('page')
    expect(job!.target_id).toBe(indexResult.pageId)

    // 자동 태깅 (BYOK 디폴트, M4-5 wiring 시점은 호출자 책임 — 본 통합은 서비스 호출 후 즉시 태깅)
    const tagResult = await p.tagger.tagPage({
      pageId: indexResult.pageId,
      workspaceId: p.defaultWsId,
      title: 'CAR-T resistance mechanism',
      content: 'Article body about CAR-T resistance in patients...'
    })
    expect(tagResult.status).toBe('tagged')
    if (tagResult.status !== 'tagged') return

    expect(tagResult.schemaParsed).toBe(true)
    expect(tagResult.tags).toHaveLength(3)
    expect(tagResult.tags.map((t) => t.kind).sort()).toEqual(['domain', 'entity', 'topic'])
    expect(p.tagStore.listPageTags(indexResult.pageId)).toHaveLength(3)
    expect(p.tagStore.listByWorkspace(p.defaultWsId)).toHaveLength(3)
  })
})

describe('M4 통합 — 시나리오 3: 재방문 본문 동일 (Visit 누적, 임베딩 재사용)', () => {
  let p: Pipeline
  beforeEach(() => {
    p = setup()
  })
  afterEach(() => {
    p.fb.close()
  })

  it('동일 본문 3회 indexPage → pages=1, visits=3, embeddingQueue=1', async () => {
    const baseInput = {
      url: 'https://blog.example.com/post-1',
      title: 'Same body',
      content: 'Unchanged body content for revisit scenario.',
      hasPasswordField: false
    }
    const r1 = await p.service.indexPage(baseInput)
    const r2 = await p.service.indexPage(baseInput)
    const r3 = await p.service.indexPage(baseInput)

    expect(r1.status).toBe('indexed')
    expect(r2.status).toBe('indexed')
    expect(r3.status).toBe('indexed')

    if (r1.status !== 'indexed' || r2.status !== 'indexed' || r3.status !== 'indexed') return

    expect(r1.action).toBe('created')
    expect(r2.action).toBe('unchanged')
    expect(r3.action).toBe('unchanged')
    expect(r1.embeddingJobId).toBeTruthy()
    expect(r2.embeddingJobId).toBeUndefined() // 재사용
    expect(r3.embeddingJobId).toBeUndefined()
    expect(r2.embeddingSkipReason).toBe('unchanged')

    expect(p.pageStore.countPages()).toBe(1)
    expect(p.pageStore.countVisits()).toBe(3)
    expect(p.embeddingQueue.stats().pending).toBe(1)

    // Page.visited_count 누적 검증 (denormalized, PRD b6.1 정정)
    const page = p.pageStore.getPage(r1.pageId)
    expect(page!.visited_count).toBe(3)
  })

  it('재방문 본문 변경 → action=updated_changed + 임베딩 재등록 + visited_count++', async () => {
    const r1 = await p.service.indexPage({
      url: 'https://news.example.com/article',
      content: 'First version of the article',
      hasPasswordField: false
    })
    const r2 = await p.service.indexPage({
      url: 'https://news.example.com/article',
      content: 'Second updated version with new info',
      hasPasswordField: false
    })

    if (r1.status !== 'indexed' || r2.status !== 'indexed') return

    expect(r2.action).toBe('updated_changed')
    expect(r2.embeddingJobId).toBeTruthy()
    expect(r2.embeddingJobId).not.toBe(r1.embeddingJobId)
    expect(p.embeddingQueue.stats().pending).toBe(2)

    const page = p.pageStore.getPage(r2.pageId)
    expect(page!.visited_count).toBe(2)
    expect(page!.content).toBe('Second updated version with new info')
  })
})

describe('M4 통합 — DwellTracker: 페이지 진입 → blur → focus → close', () => {
  let p: Pipeline
  beforeEach(() => {
    p = setup()
  })
  afterEach(() => {
    p.fb.close()
  })

  it('전체 흐름 + Visit.dwell_ms 영속 (PRD §8.5)', async () => {
    const indexResult = await p.service.indexPage({
      url: 'https://example.com/page',
      content: 'page body',
      hasPasswordField: false,
      isActiveTab: true
    })
    if (indexResult.status !== 'indexed') return

    // 페이지 진입 (탭 활성 + focus) — t=0
    p.dwell.start({
      visitId: indexResult.visitId,
      pageId: indexResult.pageId,
      workspaceId: p.defaultWsId,
      now: 0
    })
    expect(p.dwell.get(indexResult.visitId)!.status).toBe('active')

    // t=5000 — 사용자 5초 머묾, 윈도우 focus 잃음 (blur)
    p.dwell.pauseAll(5000)
    expect(p.dwell.get(indexResult.visitId)!.status).toBe('paused')
    expect(p.dwell.get(indexResult.visitId)!.accumulatedMs).toBe(5000)

    // t=10000 — 윈도우 focus 복귀
    p.dwell.resume(indexResult.visitId, 10000)
    expect(p.dwell.get(indexResult.visitId)!.status).toBe('active')

    // t=15000 — 5초 더 머묾, 탭 닫기/페이지 navigate
    const stopped = p.dwell.stop(indexResult.visitId, 15000)
    expect(stopped!.dwellMs).toBe(10000) // 5000 + 5000

    // Visit.dwell_ms 영속 검증 (onStop 콜백)
    const visit = p.pageStore.getVisit(indexResult.visitId)
    expect(visit!.dwell_ms).toBe(10000)
  })

  it('차단된 페이지는 dwell 추적 없음 (시나리오: 시작 X)', async () => {
    const result = await p.service.indexPage({
      url: 'https://gmail.com/inbox', // 차단 도메인
      content: 'inbox body',
      hasPasswordField: false
    })
    expect(result.status).toBe('blocked')
    // dwell.start 호출자가 IndexingService.indexPage 결과 status 검증 후만 호출 — 차단 시 start 안 함
    // (본 PR 은 wiring 미통합 — 호출자 책임. 통합 회귀에서 contract 만 검증)
    expect(p.dwell.size()).toBe(0)
  })
})

describe('M4 통합 — Privacy 차단 시 다중 모듈 모두 미생성 (KI-1 자연 해소 재확인)', () => {
  let p: Pipeline
  beforeEach(() => {
    p = setup()
  })
  afterEach(() => {
    p.fb.close()
  })

  it('차단 도메인 → Page/Visit/Embedding/Tag/Dwell 모두 미생성', async () => {
    const blockedDomains = [
      'https://gmail.com/inbox',
      'https://accounts.google.com/signin',
      'https://signin.aws.amazon.com/console',
      'https://cafe.naver.com/mail/folder/1'
    ]
    for (const url of blockedDomains) {
      const r = await p.service.indexPage({ url, content: 'body', hasPasswordField: false })
      expect(r.status, url).toBe('blocked')
    }
    expect(p.pageStore.countPages()).toBe(0)
    expect(p.pageStore.countVisits()).toBe(0)
    expect(p.embeddingQueue.stats().pending).toBe(0)
    expect(p.tagStore.listByWorkspace(p.defaultWsId)).toHaveLength(0)
  })

  it('password 필드 감지 → 차단 (다른 모듈도 미생성)', async () => {
    const r = await p.service.indexPage({
      url: 'https://example.com/login',
      content: 'login form body',
      hasPasswordField: true
    })
    expect(r.status).toBe('blocked')
    expect(p.pageStore.countPages()).toBe(0)
    expect(p.embeddingQueue.stats().pending).toBe(0)
  })

  it('user_block 영속 → 매 호출 차단', async () => {
    // 신규 gate 인스턴스 (privacyExclusions 주입)
    const gate2 = new IndexingGate({
      getUserExclusions: () => [{ pattern: 'github.com', type: 'block' }]
    })
    const service2 = new IndexingService({
      gate: gate2,
      pageStore: p.pageStore,
      embeddingQueue: p.embeddingQueue
    })
    const r = await service2.indexPage({
      url: 'https://github.com/repo',
      content: 'body',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') {
      expect(r.evaluation.blockReason).toBe('user_block')
    }
  })
})

describe('M4 통합 — AutoTagger freeform fallback + 멱등', () => {
  it('JSON 파싱 실패 → freeform 단일 태그', async () => {
    const p = setup(['자유 텍스트 응답 (JSON 아님)'])
    const indexResult = await p.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false
    })
    if (indexResult.status !== 'indexed') {
      p.fb.close()
      return
    }
    const tagResult = await p.tagger.tagPage({
      pageId: indexResult.pageId,
      workspaceId: p.defaultWsId,
      content: 'body'
    })
    expect(tagResult.status).toBe('tagged')
    if (tagResult.status === 'tagged') {
      expect(tagResult.schemaParsed).toBe(false)
      expect(tagResult.tags).toHaveLength(1)
      expect(tagResult.tags[0].kind).toBe('freeform')
    }
    p.fb.close()
  })

  it('동일 페이지 재 태깅 → 동일 tag id 재사용 (ensureTag 멱등) + attachToPage IGNORE', async () => {
    const responseScript = JSON.stringify({ tags: [{ kind: 'topic', name: 'AI' }] })
    const p = setup([responseScript, responseScript])
    const r1 = await p.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false
    })
    if (r1.status !== 'indexed') {
      p.fb.close()
      return
    }
    const t1 = await p.tagger.tagPage({
      pageId: r1.pageId,
      workspaceId: p.defaultWsId,
      content: 'body'
    })
    const t2 = await p.tagger.tagPage({
      pageId: r1.pageId,
      workspaceId: p.defaultWsId,
      content: 'body'
    })
    if (t1.status === 'tagged' && t2.status === 'tagged') {
      expect(t1.tags[0].id).toBe(t2.tags[0].id)
    }
    expect(p.tagStore.listByWorkspace(p.defaultWsId)).toHaveLength(1)
    expect(p.tagStore.listPageTags(r1.pageId)).toHaveLength(1)
    p.fb.close()
  })
})
