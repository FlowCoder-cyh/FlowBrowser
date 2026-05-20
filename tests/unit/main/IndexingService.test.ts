/**
 * Sprint 015 M4-1 — IndexingService 단위 테스트.
 *
 * cover:
 *   - blocked (default domain / path / password / user_block / invalid URL)
 *   - indexed (created / unchanged / updated_changed action)
 *   - 임베딩 큐 등록 (priority active=10 / background=1)
 *   - 본문 빈값 → embedding skip ('empty_content')
 *   - 재방문 동일 본문 → embedding skip ('unchanged')
 *   - 재방문 본문 변경 → embedding 재등록
 *   - override token 통과 시 indexed
 *   - workspaceId 명시 vs 디폴트
 *   - onStatusChange 콜백 broadcast
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { EmbeddingQueue } from '../../../src/storage/EmbeddingQueue'
import { IndexingGate } from '../../../src/privacy/IndexingGate'
import { IndexingService } from '../../../src/main/IndexingService'
import type { IndexingStatusPayload } from '../../../src/main/IndexingService'

interface Fx {
  fb: FlowbrowserDatabase
  pageStore: IndexedPageStoreSqlite
  embeddingQueue: EmbeddingQueue
  gate: IndexingGate
  service: IndexingService
  defaultWsId: string
  events: IndexingStatusPayload[]
}

function setup(): Fx {
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  const embeddingQueue = new EmbeddingQueue(fb)
  const gate = new IndexingGate()
  const events: IndexingStatusPayload[] = []
  const service = new IndexingService({
    gate,
    pageStore,
    embeddingQueue,
    onStatusChange: (p) => events.push(p)
  })
  return { fb, pageStore, embeddingQueue, gate, service, defaultWsId: defaultWs.id, events }
}

/**
 * codex M4-1 hotfix NB-2 — blocked no-side-effect 매트릭스 helper.
 * 모든 blocked 케이스에서 Page/Visit/Embedding 미생성 정합 일괄 검증.
 */
function assertNoSideEffect(fx: Fx): void {
  expect(fx.pageStore.countPages()).toBe(0)
  expect(fx.pageStore.countVisits()).toBe(0)
  expect(fx.embeddingQueue.stats().pending).toBe(0)
}

describe('IndexingService — blocked paths', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('default domain 차단 시 status=blocked, Page/Visit 미생성', async () => {
    const r = await fx.service.indexPage({
      url: 'https://gmail.com/inbox',
      content: 'inbox body',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') {
      expect(r.evaluation.blockReason).toBe('domain')
    }
    assertNoSideEffect(fx)
  })

  it('path glob 차단 (*.naver.com/mail/*) — Page 미생성', async () => {
    const r = await fx.service.indexPage({
      url: 'https://cafe.naver.com/mail/1',
      content: 'x',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.evaluation.blockReason).toBe('path')
    assertNoSideEffect(fx)
  })

  it('password field 감지 시 차단', async () => {
    const r = await fx.service.indexPage({
      url: 'https://example.com/secure',
      content: 'x',
      hasPasswordField: true
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.evaluation.blockReason).toBe('password')
    assertNoSideEffect(fx)
  })

  it('잘못된 URL 차단', async () => {
    const r = await fx.service.indexPage({
      url: 'not-a-url',
      content: 'x',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    assertNoSideEffect(fx)
  })

  it('user_block 차단 (codex M4-1 hotfix NB-2) — privacyExclusions[type=block]', async () => {
    // user_block 정합: gate 에 직접 exclusions 주입한 신규 인스턴스로 검증
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const defaultWs = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
    const embeddingQueue = new EmbeddingQueue(fb)
    const gate = new IndexingGate({
      getUserExclusions: () => [{ pattern: 'example.com', type: 'block' }]
    })
    const service = new IndexingService({ gate, pageStore, embeddingQueue })
    const r = await service.indexPage({
      url: 'https://example.com/page',
      content: 'body',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') {
      expect(r.evaluation.blockReason).toBe('user_block')
    }
    expect(pageStore.countPages()).toBe(0)
    expect(pageStore.countVisits()).toBe(0)
    expect(embeddingQueue.stats().pending).toBe(0)
    fb.close()
  })

  it('blocked 시 onStatusChange broadcast 발생', async () => {
    await fx.service.indexPage({
      url: 'https://gmail.com/inbox',
      content: 'x',
      hasPasswordField: false
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('blocked')
    expect(fx.events[0].url).toBe('https://gmail.com/inbox')
  })
})

describe('IndexingService — indexed paths', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('첫 방문 — action=created + Page/Visit C + 임베딩 큐 등록', async () => {
    const r = await fx.service.indexPage({
      url: 'https://example.com/article',
      title: 'Article',
      content: 'Hello world body content.',
      lang: 'en',
      hasPasswordField: false,
      isActiveTab: true
    })
    expect(r.status).toBe('indexed')
    if (r.status === 'indexed') {
      expect(r.action).toBe('created')
      expect(r.pageId).toMatch(/[0-9a-f-]{36}/)
      expect(r.visitId).toMatch(/[0-9a-f-]{36}/)
      expect(r.embeddingJobId).toBeTruthy()
      expect(r.embeddingSkipReason).toBeUndefined()
    }
    expect(fx.pageStore.countPages()).toBe(1)
    expect(fx.pageStore.countVisits()).toBe(1)
    expect(fx.embeddingQueue.stats().pending).toBe(1)
  })

  it('재방문 + 본문 동일 — action=unchanged + Visit 만 누적, 임베딩 skip', async () => {
    const baseInput = {
      url: 'https://example.com/article',
      title: 'Article',
      content: 'Hello world body content.',
      hasPasswordField: false
    }
    await fx.service.indexPage(baseInput)
    const r2 = await fx.service.indexPage(baseInput)
    expect(r2.status).toBe('indexed')
    if (r2.status === 'indexed') {
      expect(r2.action).toBe('unchanged')
      expect(r2.embeddingJobId).toBeUndefined()
      expect(r2.embeddingSkipReason).toBe('unchanged')
    }
    expect(fx.pageStore.countPages()).toBe(1)
    expect(fx.pageStore.countVisits()).toBe(2)
    expect(fx.embeddingQueue.stats().pending).toBe(1) // 첫 방문 임베딩만
  })

  it('재방문 + 본문 변경 — action=updated_changed + 임베딩 재등록', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/article',
      content: 'first version',
      hasPasswordField: false
    })
    const r2 = await fx.service.indexPage({
      url: 'https://example.com/article',
      content: 'updated version after edit',
      hasPasswordField: false
    })
    expect(r2.status).toBe('indexed')
    if (r2.status === 'indexed') {
      expect(r2.action).toBe('updated_changed')
      expect(r2.embeddingJobId).toBeTruthy()
      expect(r2.embeddingSkipReason).toBeUndefined()
    }
    expect(fx.embeddingQueue.stats().pending).toBe(2)
  })

  it('본문 빈값 — embedding skip (empty_content)', async () => {
    const r = await fx.service.indexPage({
      url: 'https://example.com/canvas',
      content: '   ',
      hasPasswordField: false
    })
    expect(r.status).toBe('indexed')
    if (r.status === 'indexed') {
      expect(r.embeddingJobId).toBeUndefined()
      expect(r.embeddingSkipReason).toBe('empty_content')
    }
    expect(fx.embeddingQueue.stats().pending).toBe(0)
  })

  it('whitespace-only 본문 — content_hash=NULL 저장 정합 (codex M4-1 hotfix NB-1, PRD §8.4)', async () => {
    // PRD §8.4 "content 없음 → content_hash=NULL + embedding skip" 정합 검증.
    // 이전엔 raw '   ' 가 그대로 저장되어 hash 가 비-NULL 이 되는 SSOT 미정합 (codex NB-1).
    const r = await fx.service.indexPage({
      url: 'https://example.com/canvas',
      content: '   \n\t ',
      hasPasswordField: false
    })
    expect(r.status).toBe('indexed')
    if (r.status === 'indexed') {
      const page = fx.pageStore.getPage(r.pageId)
      expect(page).toBeTruthy()
      expect(page!.content).toBe('') // normalize 후 빈 문자열로 영속
      expect(page!.content_hash).toBeNull() // contentHashOf('') === null
      expect(r.embeddingSkipReason).toBe('empty_content')
    }
  })

  it('whitespace-only 재방문 — action=unchanged (content_hash NULL 두 번)', async () => {
    // 빈 본문 재방문 시 hash 가 동일 (NULL === NULL) → unchanged 분기 (codex NB-1 정합 검증)
    const baseInput = {
      url: 'https://example.com/canvas',
      content: '   ',
      hasPasswordField: false
    }
    const r1 = await fx.service.indexPage(baseInput)
    expect(r1.status).toBe('indexed')
    if (r1.status === 'indexed') expect(r1.action).toBe('created')
    const r2 = await fx.service.indexPage(baseInput)
    expect(r2.status).toBe('indexed')
    if (r2.status === 'indexed') {
      expect(r2.action).toBe('unchanged')
      expect(r2.embeddingSkipReason).toBe('empty_content') // empty 가 unchanged 보다 먼저 평가
    }
    expect(fx.pageStore.countVisits()).toBe(2)
  })

  it('isActiveTab=true → priority 10', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/active',
      content: 'body',
      hasPasswordField: false,
      isActiveTab: true
    })
    const job = fx.embeddingQueue.claimNext()
    expect(job).toBeTruthy()
    expect(job!.priority).toBe(10)
  })

  it('isActiveTab 미주입 → priority 1 (백그라운드)', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/bg',
      content: 'body',
      hasPasswordField: false
    })
    const job = fx.embeddingQueue.claimNext()
    expect(job).toBeTruthy()
    expect(job!.priority).toBe(1)
  })

  it('워크스페이스 미주입 시 default workspace 사용', async () => {
    const r = await fx.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false
    })
    expect(r.status).toBe('indexed')
    if (r.status === 'indexed') {
      const page = fx.pageStore.getPage(r.pageId)
      expect(page!.workspace_id).toBe(fx.defaultWsId)
    }
  })

  it('워크스페이스 명시 시 해당 ws_id 적용', async () => {
    const other = fx.fb.createWorkspace({ name: 'Other', icon: '🌶' })
    const r = await fx.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false,
      workspaceId: other.id
    })
    expect(r.status).toBe('indexed')
    if (r.status === 'indexed') {
      const page = fx.pageStore.getPage(r.pageId)
      expect(page!.workspace_id).toBe(other.id)
    }
  })

  it('indexed 시 onStatusChange broadcast 발생', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('indexed')
    if (fx.events[0].result.status === 'indexed') {
      expect(fx.events[0].result.pageId).toBeTruthy()
    }
  })
})

describe('IndexingService — override token', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('override token 통과 시 default domain 차단 무력', async () => {
    const url = 'https://gmail.com/special'
    const token = fx.gate.issueOverrideToken(url)
    const r = await fx.service.indexPage({
      url,
      content: 'body',
      hasPasswordField: false,
      overrideToken: token
    })
    expect(r.status).toBe('indexed')
    expect(fx.pageStore.countPages()).toBe(1)
  })

  it('override token 1회 소비 — 동일 token 재사용 시 차단', async () => {
    const url = 'https://gmail.com/special'
    const token = fx.gate.issueOverrideToken(url)
    await fx.service.indexPage({
      url,
      content: 'body',
      hasPasswordField: false,
      overrideToken: token
    })
    const r2 = await fx.service.indexPage({
      url,
      content: 'body2',
      hasPasswordField: false,
      overrideToken: token
    })
    expect(r2.status).toBe('blocked')
  })
})

describe('IndexingService — onStatusChange optional', () => {
  it('onStatusChange 미주입 시 정상 동작 (broadcast 콜백 안전)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const defaultWs = fb.ensureDefaultWorkspace()
    const service = new IndexingService({
      gate: new IndexingGate(),
      pageStore: new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id }),
      embeddingQueue: new EmbeddingQueue(fb)
    })
    const r = await service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: false
    })
    expect(r.status).toBe('indexed')
    fb.close()
  })
})

describe('IndexingService — workspaceId broadcast payload (Sprint 016 M0 T05, KI-010)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setup()
  })
  afterEach(() => {
    fx.fb.close()
  })

  it('indexed 시 payload.workspaceId === default workspace_id (input 미주입)', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/article',
      content: 'body',
      hasPasswordField: false
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('indexed')
    expect(fx.events[0].workspaceId).toBe(fx.defaultWsId)
  })

  it('indexed 시 payload.workspaceId === input.workspaceId (명시 주입)', async () => {
    const other = fx.fb.createWorkspace({ name: 'Other', icon: '🌶' })
    await fx.service.indexPage({
      url: 'https://example.com/article',
      content: 'body',
      hasPasswordField: false,
      workspaceId: other.id
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].workspaceId).toBe(other.id)
  })

  it('blocked (default domain) payload.workspaceId === undefined', async () => {
    await fx.service.indexPage({
      url: 'https://gmail.com/inbox',
      content: 'body',
      hasPasswordField: false
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('blocked')
    expect(fx.events[0].workspaceId).toBeUndefined()
  })

  it('blocked (password field) payload.workspaceId === undefined', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/secure',
      content: 'body',
      hasPasswordField: true,
      // 호출자가 workspaceId 를 명시해도, 차단된 경우엔 페이로드에 박지 않음
      // (page 미생성 — workspace 컨텍스트 부재. broadcast 측에서 skip 분기 필요).
      workspaceId: fx.defaultWsId
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('blocked')
    expect(fx.events[0].workspaceId).toBeUndefined()
  })

  it('blocked (invalid url) payload.workspaceId === undefined', async () => {
    await fx.service.indexPage({
      url: 'not-a-url',
      content: 'body',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    expect(fx.events).toHaveLength(1)
    expect(fx.events[0].result.status).toBe('blocked')
    expect(fx.events[0].workspaceId).toBeUndefined()
  })

  it('empty_content 시점에도 payload.workspaceId 정상 채움 (indexed 분기)', async () => {
    await fx.service.indexPage({
      url: 'https://example.com/canvas',
      content: '   ',
      hasPasswordField: false
    })
    expect(fx.events).toHaveLength(1)
    if (fx.events[0].result.status === 'indexed') {
      expect(fx.events[0].result.embeddingSkipReason).toBe('empty_content')
    }
    expect(fx.events[0].workspaceId).toBe(fx.defaultWsId)
  })

  it('재방문 unchanged 분기 payload.workspaceId 정상 (broadcast 호출자 측 skip 결정 X — 모두 indexed 로 흘러옴)', async () => {
    // 재방문 unchanged 의 broadcast 정합: NoteStore/AiChatHistoryStore 의 동등 정책 — INSERT 가 일어났으니
    // payload.workspaceId 는 동일. broadcast 호출자가 unchanged 시 skip 할지 여부는 services.ts 정책.
    // 본 단위 테스트는 IndexingService 의 payload 정확성만 검증 (broadcast 호출 자체는 services.ts wiring 책임).
    const baseInput = {
      url: 'https://example.com/article',
      content: 'body',
      hasPasswordField: false
    }
    await fx.service.indexPage(baseInput)
    await fx.service.indexPage(baseInput)
    expect(fx.events).toHaveLength(2)
    expect(fx.events[0].workspaceId).toBe(fx.defaultWsId)
    expect(fx.events[1].workspaceId).toBe(fx.defaultWsId)
    if (fx.events[1].result.status === 'indexed') {
      expect(fx.events[1].result.action).toBe('unchanged')
    }
  })
})

describe('IndexingService — gate stub 격리', () => {
  it('IndexingGate 호출지점 검증 (overrideToken 정확 전달)', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const defaultWs = fb.ensureDefaultWorkspace()
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
    const embeddingQueue = new EmbeddingQueue(fb)
    const gate = new IndexingGate()
    const spy = vi.spyOn(gate, 'evaluate')
    const service = new IndexingService({ gate, pageStore, embeddingQueue })
    await service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: true,
      overrideToken: 'tok-abc'
    })
    expect(spy).toHaveBeenCalledWith({
      url: 'https://example.com/p',
      hasPasswordField: true,
      overrideToken: 'tok-abc'
    })
    fb.close()
  })
})

/**
 * Sprint 016 M0 T02-followup (KI-006) — workspace abort 정책 (race-safe generation 패턴).
 *
 * codex BLOCKING #1 흡수 — boolean Set 1회 suppress 의 race condition 해소:
 *   - generation counter: abort(ws) → +1
 *   - indexPage 시작 시 startGen 캡처, 종료 직전 currentGen 비교
 *   - startGen < currentGen 이면 suppress (abort 이전 in-flight 모두 차단)
 *   - abort 이후 새 indexPage 는 정상 (오탐 차단)
 */
describe('IndexingService — workspace abort (Sprint 016 M0 T02-followup, KI-006, generation 패턴)', () => {
  let fx: Fx

  beforeEach(() => {
    fx = setup()
  })

  afterEach(() => {
    fx.fb.close()
  })

  it('in-flight 시작 후 abort → Visit 영속 + emit suppress + skipReason=aborted', async () => {
    // generation 패턴: indexPage 시작 (startGen=0 캡처) → abort (gen=1) → 종료 시 suppress
    const p = fx.service.indexPage({
      url: 'https://example.com/aborted',
      content: 'body',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    fx.service.abort(fx.defaultWsId)
    expect(fx.service.getAbortGeneration(fx.defaultWsId)).toBe(1)
    const result = await p
    expect(result.status).toBe('indexed')
    if (result.status !== 'indexed') return
    expect(result.embeddingSkipReason).toBe('aborted')
    expect(result.embeddingJobId).toBeUndefined()
    // Visit 영속 — DB TX 완료 상태 유지
    expect(fx.pageStore.countPages(fx.defaultWsId)).toBe(1)
    expect(fx.pageStore.countVisits(fx.defaultWsId)).toBe(1)
    // 임베딩 큐 enqueue 차단
    expect(fx.embeddingQueue.stats().pending).toBe(0)
    // emit suppress
    expect(fx.events.length).toBe(0)
  })

  it('abort 이후 새 indexPage → 정상 처리 (오탐 차단)', async () => {
    fx.service.abort(fx.defaultWsId)
    // 이전에 시작된 in-flight 없으면 새 indexPage 는 currentGen 그대로 시작 → suppress 안 함
    const result = await fx.service.indexPage({
      url: 'https://example.com/post-abort',
      content: 'body',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    expect(result.status).toBe('indexed')
    if (result.status !== 'indexed') return
    // generation 캡처 = currentGen 1, 종료 시 currentGen 1 → 동일 → 정상
    expect(result.embeddingSkipReason).toBeUndefined()
    expect(result.embeddingJobId).toBeDefined()
    expect(fx.events.length).toBe(1)
    expect(fx.events[0].url).toBe('https://example.com/post-abort')
  })

  it('동시 in-flight 2건 + abort → 둘 다 suppress (race-safe, codex BLOCKING #1)', async () => {
    // 2건 indexPage 시작 (await 안 함 — Promise 보관)
    const p1 = fx.service.indexPage({
      url: 'https://example.com/race1',
      content: 'body1',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    const p2 = fx.service.indexPage({
      url: 'https://example.com/race2',
      content: 'body2',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    // 둘 다 시작된 직후 abort 호출
    fx.service.abort(fx.defaultWsId)
    const [r1, r2] = await Promise.all([p1, p2])
    // 둘 다 suppress
    expect(r1.status === 'indexed' && r1.embeddingSkipReason === 'aborted').toBe(true)
    expect(r2.status === 'indexed' && r2.embeddingSkipReason === 'aborted').toBe(true)
    // Visit 둘 다 영속
    expect(fx.pageStore.countVisits(fx.defaultWsId)).toBe(2)
    // 임베딩 큐 enqueue 0 (둘 다 suppress)
    expect(fx.embeddingQueue.stats().pending).toBe(0)
    // emit 0 (둘 다 suppress)
    expect(fx.events.length).toBe(0)
  })

  it('abort 다른 ws 영향 0 (ws 격리)', async () => {
    const altWs = fx.fb.createWorkspace({ name: 'Alt', icon: '🧪' })
    fx.service.abort(altWs.id)
    const result = await fx.service.indexPage({
      url: 'https://example.com/default-normal',
      content: 'body',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    expect(result.status).toBe('indexed')
    if (result.status !== 'indexed') return
    expect(result.embeddingSkipReason).toBeUndefined()
    expect(result.embeddingJobId).toBeDefined()
    expect(fx.events.length).toBe(1)
    expect(fx.events[0].workspaceId).toBe(fx.defaultWsId)
    // alt 의 abort generation 유지
    expect(fx.service.getAbortGeneration(altWs.id)).toBe(1)
    expect(fx.service.getAbortGeneration(fx.defaultWsId)).toBe(0)
  })

  it('abort + blocked (gate 차단) 흐름 — gate 차단이 우선 (Visit 미생성)', async () => {
    fx.service.abort(fx.defaultWsId)
    const result = await fx.service.indexPage({
      url: 'https://example.com/p',
      content: 'body',
      hasPasswordField: true,
      workspaceId: fx.defaultWsId
    })
    expect(result.status).toBe('blocked')
    expect(fx.pageStore.countPages()).toBe(0)
    // blocked emit 발생 (workspaceId undefined)
    expect(fx.events.length).toBe(1)
    expect(fx.events[0].workspaceId).toBeUndefined()
    expect(fx.events[0].result.status).toBe('blocked')
    // generation 은 indexed path 만 소비 — blocked 시 유지 (그대로 1)
    expect(fx.service.getAbortGeneration(fx.defaultWsId)).toBe(1)
  })

  it('abort 2회 호출 → generation 2 누적 (multiple abort 시퀀스)', async () => {
    fx.service.abort(fx.defaultWsId)
    fx.service.abort(fx.defaultWsId)
    expect(fx.service.getAbortGeneration(fx.defaultWsId)).toBe(2)
    // 이전 시작 in-flight 없으면 신규는 정상
    const result = await fx.service.indexPage({
      url: 'https://example.com/after-double-abort',
      content: 'body',
      hasPasswordField: false,
      workspaceId: fx.defaultWsId
    })
    expect(result.status === 'indexed' && result.embeddingSkipReason === undefined).toBe(true)
  })
})

/**
 * Sprint 016 M0 T02-followup (KI-006, codex BLOCKING #2) — unchanged 분기 vector 회복.
 *
 * VectorIndex 주입 시 unchanged 케이스에서 vector 미존재 감지 → enqueue 강제 (영구 누락 차단).
 * 이전 abort 또는 worker 실패로 embedding 미생성된 페이지 재방문 시 회복.
 */
describe('IndexingService — unchanged 분기 vector 회복 (Sprint 016 M0 T02-followup, KI-006)', () => {
  it('VectorIndex 주입 + vector 미존재 + unchanged → enqueue 회복', async () => {
    const { VectorIndex } = await import('../../../src/storage/VectorIndex')
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const wsId = fb.ensureDefaultWorkspace().id
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: wsId })
    const embeddingQueue = new EmbeddingQueue(fb)
    const vectorIndex = new VectorIndex(fb)
    const gate = new IndexingGate()
    const service = new IndexingService({ gate, pageStore, embeddingQueue, vectorIndex })

    // 첫 방문 — enqueue 1건
    const first = await service.indexPage({
      url: 'https://example.com/recover',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    expect(first.status === 'indexed' && first.embeddingJobId !== undefined).toBe(true)
    expect(embeddingQueue.stats().pending).toBe(1)

    // 재방문 + 동일 content — unchanged. vector 없으면 enqueue 회복.
    // (vector 미생성 상태 — embedding worker 가 처리 안 함)
    expect(vectorIndex.hasPageEmbedding((first as { pageId: string }).pageId)).toBe(false)

    const second = await service.indexPage({
      url: 'https://example.com/recover',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    expect(second.status).toBe('indexed')
    if (second.status !== 'indexed') return
    // 회복: embeddingJobId 있음, skipReason 없음 (unchanged 라도 vector 미존재라 re-enqueue)
    expect(second.embeddingJobId).toBeDefined()
    expect(second.embeddingSkipReason).toBeUndefined()
    expect(second.action).toBe('unchanged')
    // 큐 2건 누적
    expect(embeddingQueue.stats().pending).toBe(2)

    fb.close()
  })

  it('VectorIndex 주입 + vector 존재 + unchanged → enqueue skip (회복 안 함)', async () => {
    const { VectorIndex, EMBEDDING_DIMENSIONS } = await import('../../../src/storage/VectorIndex')
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const wsId = fb.ensureDefaultWorkspace().id
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: wsId })
    const embeddingQueue = new EmbeddingQueue(fb)
    const vectorIndex = new VectorIndex(fb)
    const gate = new IndexingGate()
    const service = new IndexingService({ gate, pageStore, embeddingQueue, vectorIndex })

    const first = await service.indexPage({
      url: 'https://example.com/done',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    if (first.status !== 'indexed') throw new Error('first must be indexed')
    // vector 영속 (worker 처리 완료 시뮬)
    const dummyVec = new Float32Array(EMBEDDING_DIMENSIONS)
    dummyVec[0] = 1.0
    vectorIndex.upsertPageEmbedding(first.pageId, wsId, dummyVec)
    expect(vectorIndex.hasPageEmbedding(first.pageId)).toBe(true)

    // 재방문 + 동일 content — vector 있음 → unchanged skip
    const second = await service.indexPage({
      url: 'https://example.com/done',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    expect(second.status === 'indexed' && second.embeddingSkipReason === 'unchanged').toBe(true)
    if (second.status !== 'indexed') return
    expect(second.embeddingJobId).toBeUndefined()
    // 큐 1건 유지 (회복 안 함)
    expect(embeddingQueue.stats().pending).toBe(1)

    fb.close()
  })

  it('VectorIndex 미주입 (이전 동작 호환) — unchanged 항상 skip', async () => {
    const fb = FlowbrowserDatabase.openInMemory()
    fb.applySchema()
    const wsId = fb.ensureDefaultWorkspace().id
    const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: wsId })
    const embeddingQueue = new EmbeddingQueue(fb)
    const gate = new IndexingGate()
    // vectorIndex 미주입
    const service = new IndexingService({ gate, pageStore, embeddingQueue })

    await service.indexPage({
      url: 'https://example.com/no-vec',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    const second = await service.indexPage({
      url: 'https://example.com/no-vec',
      content: 'body',
      hasPasswordField: false,
      workspaceId: wsId
    })
    // vectorIndex 미주입이라 unchanged 분기는 항상 skip (이전 동작 호환)
    expect(second.status === 'indexed' && second.embeddingSkipReason === 'unchanged').toBe(true)
    if (second.status !== 'indexed') return
    expect(second.embeddingJobId).toBeUndefined()

    fb.close()
  })
})
