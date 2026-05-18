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
    expect(fx.pageStore.countPages()).toBe(0)
    expect(fx.pageStore.countVisits()).toBe(0)
    expect(fx.embeddingQueue.stats().pending).toBe(0)
  })

  it('path glob 차단 (*.naver.com/mail/*) — Page 미생성', async () => {
    const r = await fx.service.indexPage({
      url: 'https://cafe.naver.com/mail/1',
      content: 'x',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.evaluation.blockReason).toBe('path')
  })

  it('password field 감지 시 차단', async () => {
    const r = await fx.service.indexPage({
      url: 'https://example.com/secure',
      content: 'x',
      hasPasswordField: true
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.evaluation.blockReason).toBe('password')
  })

  it('잘못된 URL 차단', async () => {
    const r = await fx.service.indexPage({
      url: 'not-a-url',
      content: 'x',
      hasPasswordField: false
    })
    expect(r.status).toBe('blocked')
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
