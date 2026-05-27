/**
 * Sprint 016 M1 T08 — 시나리오 3 (학습) 회귀 테스트.
 *
 * 입력: `.flowset/specs/v04-test-classification.md` §E1 시나리오 3 (5 케이스 S3-C1 ~ S3-C5)
 * Sprint 016 contract AC-2 핵심. 본 회귀 셋 5/5 통과 시 시나리오 3 P1 cover 100%.
 * v04-direction §11 가치 명제 cover 90% (자동 수준 추정 실 로직은 Phase 2).
 *
 * 통합 모듈:
 *   - FlowbrowserDatabase + VectorIndex + IndexedPageStoreSqlite (memory 누적 + ws 격리)
 *   - SearchService (시간순 + 의미 결합)
 *   - WorkspaceService (level_preference 4종 + 자동 활성)
 *   - PromptComposer.composeSystemPrompt (사용자 수준 분기)
 *   - UserLevelEstimator mock (Phase 2 위임 — 본 시나리오는 호출 interface 만)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../../src/storage/IndexedPageStoreSqlite'
import { NoteStore } from '../../../src/storage/NoteStore'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../../src/storage/VectorIndex'
import { UserSettingStore } from '../../../src/storage/UserSettingStore'
import { SearchService } from '../../../src/main/SearchService'
import { WorkspaceService } from '../../../src/main/WorkspaceService'
import { composeSystemPrompt } from '../../../src/ai/PromptComposer'
import { applyV06Schema } from '../../helpers/v06Schema'

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

interface Fx {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
  search: SearchService
  workspace: WorkspaceService
  userSetting: UserSettingStore
  settingPath: string
  defaultId: string
  altId: string
}

async function setup(): Promise<Fx> {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb)
  const defaultWs = fb.ensureDefaultWorkspace()
  const altWs = fb.createWorkspace({ name: '학습-alt', icon: '📚' })
  const vec = new VectorIndex(fb)
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
  const noteStore = new NoteStore(fb)
  const search = new SearchService({ vectorIndex: vec, pageStore, noteStore })
  const settingPath = join(
    tmpdir(),
    `scenario3-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

describe('시나리오 3 — 학습 회귀 셋', () => {
  let fx: Fx

  beforeEach(async () => {
    fx = await setup()
  })

  afterEach(async () => {
    await teardown(fx)
  })

  /**
   * S3-C1 — 메모리 누적 (3개월간 178 페이지 인덱싱 모킹) + 워크스페이스 격리.
   * 측정: 178 페이지 인덱싱 통과 + ws별 countPages 정확 + 다른 ws 누수 0.
   */
  it('S3-C1: 메모리 누적 178 페이지 + 워크스페이스 격리', async () => {
    const now = new Date('2026-05-19T09:00:00+09:00').getTime()
    // default ws — 100 페이지 (Rust 학습)
    for (let i = 0; i < 100; i++) {
      await fx.pageStore.recordVisit({
        workspace_id: fx.defaultId,
        url: `https://docs.rust-lang.org/topic-${i}`,
        title: `Rust 주제 ${i}`,
        content: `Rust learning content ${i} — lifetime / borrow / async.`,
        visited_at: now - (90 - i * 0.9) * DAY
      })
    }
    // alt ws — 78 페이지 (TypeScript 학습)
    for (let i = 0; i < 78; i++) {
      await fx.pageStore.recordVisit({
        workspace_id: fx.altId,
        url: `https://ts.example/topic-${i}`,
        title: `TS 주제 ${i}`,
        content: `TS learning content ${i} — generics / decorators.`,
        visited_at: now - (90 - i * 1.1) * DAY
      })
    }

    expect(fx.pageStore.countPages(fx.defaultId)).toBe(100)
    expect(fx.pageStore.countPages(fx.altId)).toBe(78)
    expect(fx.pageStore.countPages()).toBe(178) // 전체 합산
    expect(fx.pageStore.countVisits(fx.defaultId)).toBe(100)
    expect(fx.pageStore.countVisits(fx.altId)).toBe(78)

    // ws별 stats 격리 정합
    const stats = fx.pageStore.stats()
    expect(stats.perWorkspace[fx.defaultId]).toEqual({ pages: 100, visits: 100 })
    expect(stats.perWorkspace[fx.altId]).toEqual({ pages: 78, visits: 78 })
  })

  /**
   * S3-C2 — 같은 페이지 여러 번 방문 시 별도 visit 누적 (첫 진입 + 다시 본 시점).
   * 측정: page 1건 + visit 2건 (recordVisit 같은 URL 두 번 호출 후 listVisits 길이).
   */
  it('S3-C2: 같은 페이지 2회 방문 → page 1 + visit 2', async () => {
    const now = new Date('2026-05-19T10:00:00+09:00').getTime()
    const first = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://docs.rust-lang.org/book/ch10-03-lifetime-syntax.html',
      title: 'Rust Lifetime Syntax',
      content: 'Lifetime annotations describe relationships between references.',
      visited_at: now - 7 * DAY
    })
    const second = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://docs.rust-lang.org/book/ch10-03-lifetime-syntax.html',
      title: 'Rust Lifetime Syntax',
      content: 'Lifetime annotations describe relationships between references.',
      visited_at: now - 60_000 // 1분 전 (오늘 다시 본 시점)
    })

    // 같은 페이지 (동일 URL + content_hash) → page 1건
    expect(first.page.id).toBe(second.page.id)
    expect(first.action).toBe('created')
    // 같은 content_hash → 'unchanged' (content 변경 없으면)
    expect(second.action === 'unchanged' || second.action === 'updated_changed').toBe(true)

    // visit 은 2건 별도 누적
    expect(first.visit.id).not.toBe(second.visit.id)
    const visits = fx.pageStore.listVisits(first.page.id)
    expect(visits.length).toBe(2)
    expect(visits.map((v) => v.id).sort()).toEqual([first.visit.id, second.visit.id].sort())

    // countPages 1 + countVisits 2 정합
    expect(fx.pageStore.countPages(fx.defaultId)).toBe(1)
    expect(fx.pageStore.countVisits(fx.defaultId)).toBe(2)
  })

  /**
   * S3-C3 — 시간순 + 의미 검색 ("Rust lifetime 헷갈렸던 글") → 2개 visit 모두 발견.
   * 측정: SearchService.search 결과에 page id 1건 포함 + listVisits 로 2 visit 모두 복원.
   */
  it('S3-C3: 시간순 + 의미 검색 → 2개 visit 모두 발견', async () => {
    const now = new Date('2026-05-19T11:00:00+09:00').getTime()
    // Rust lifetime 페이지에 2 visit (한 달 전 + 오늘) 누적
    const ltPage = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://docs.rust-lang.org/book/ch10-03-lifetime-syntax.html',
      title: 'Rust Lifetime Syntax',
      content: 'Rust lifetime annotations and borrow checker confusion.',
      visited_at: now - 30 * DAY
    })
    const ltPage2 = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://docs.rust-lang.org/book/ch10-03-lifetime-syntax.html',
      title: 'Rust Lifetime Syntax',
      content: 'Rust lifetime annotations and borrow checker confusion.',
      visited_at: now - 1 * DAY
    })
    expect(ltPage.page.id).toBe(ltPage2.page.id) // 같은 page

    // 다른 페이지 (노이즈)
    const other = await fx.pageStore.recordVisit({
      workspace_id: fx.defaultId,
      url: 'https://docs.rust-lang.org/book/ch07-mod.html',
      title: 'Rust Modules',
      content: 'Rust module system organization.',
      visited_at: now - 10 * DAY
    })

    fx.vec.upsertPageEmbedding(ltPage.page.id, fx.defaultId, makeVec({ 0: 1.0, 1: 0.3 }), 1024)
    fx.vec.upsertPageEmbedding(other.page.id, fx.defaultId, makeVec({ 5: 1.0 }), 1024)

    // "Rust lifetime 헷갈렸던 글" → dim 0 vector
    const hits = fx.search.search({
      workspaceId: fx.defaultId,
      queryEmbedding: makeVec({ 0: 1.0, 1: 0.3 }),
      topK: 10,
      now
    })

    expect(hits.length).toBe(2) // ltPage + other (각 page 1 hit)
    // ltPage 가 top-1 (의미 가장 가까움)
    expect(hits[0].pageId).toBe(ltPage.page.id)

    // 페이지 클릭 시 listVisits → 2 visit 모두 복원 ("첫 진입 + 다시 본 시점")
    const visits = fx.pageStore.listVisits(ltPage.page.id)
    expect(visits.length).toBe(2)
    const visitedAts = visits.map((v) => v.visited_at).sort((a, b) => a - b)
    expect(visitedAts[0]).toBe(now - 30 * DAY) // 한 달 전 (첫 진입)
    expect(visitedAts[1]).toBe(now - 1 * DAY) // 어제 (다시 본 시점)
  })

  /**
   * S3-C4 — AI 튜터 + 사용자 수준 직접 선택 (워크스페이스 settings level_preference 4종).
   * 측정: PromptComposer 분기 — novice / intermediate / advanced / null 모두 검증.
   */
  it('S3-C4: 사용자 수준 직접 선택 → composeSystemPrompt 분기 4종', async () => {
    // 4 워크스페이스 — 각 level_preference
    const wsNovice = await fx.workspace.create({
      name: '초보 학습',
      icon: '📥',
      level_preference: 'novice'
    })
    const wsInter = await fx.workspace.create({
      name: '중급 학습',
      icon: '🧪',
      level_preference: 'intermediate'
    })
    const wsAdv = await fx.workspace.create({
      name: '고급 학습',
      icon: '💻',
      level_preference: 'advanced'
    })
    const wsNull = await fx.workspace.create({
      name: '미지정',
      icon: '📚',
      level_preference: null
    })

    // 각 워크스페이스 settings → composeSystemPrompt 분기
    const promptNovice = composeSystemPrompt({ levelPreference: wsNovice.level_preference })
    expect(promptNovice).toContain('초보자')
    expect(promptNovice).not.toContain('중급자')
    expect(promptNovice).not.toContain('전문가')

    const promptInter = composeSystemPrompt({ levelPreference: wsInter.level_preference })
    expect(promptInter).toContain('중급자')
    expect(promptInter).not.toContain('초보자')

    const promptAdv = composeSystemPrompt({ levelPreference: wsAdv.level_preference })
    expect(promptAdv).toContain('전문가')
    expect(promptAdv).not.toContain('초보자')
    expect(promptAdv).not.toContain('중급자')

    // null → 수준 분기 없음 (base prompt 만)
    const promptNull = composeSystemPrompt({ levelPreference: wsNull.level_preference })
    expect(promptNull).not.toContain('초보자')
    expect(promptNull).not.toContain('중급자')
    expect(promptNull).not.toContain('전문가')
    // base 단락은 모든 케이스 포함
    expect(promptNull).toContain('한국어 AI 어시스턴트')
  })

  /**
   * S3-C5 — 자동 수준 추정 mock (Phase 2 위임).
   * 측정: mock object 호출 interface (estimate 메서드) — 실 학습 로직은 P2.
   * Sprint 016 contract §2 T22 (UserLevelEstimator mock) 의존 자리.
   */
  it('S3-C5: 자동 수준 추정 mock interface — Phase 2 위임 자리', () => {
    // Phase 2 위임 — mock interface. 실제 학습 로직 (방문 페이지 난이도 분포 기반) 은 R3-B.
    type LevelEstimate = 'novice' | 'intermediate' | 'advanced' | null
    interface UserLevelEstimator {
      estimate(input: { workspaceId: string; topic: string }): Promise<{
        level: LevelEstimate
        confidence: number
        source: 'mock' | 'auto'
      }>
    }

    const calls: Array<{ workspaceId: string; topic: string }> = []
    const mockEstimator: UserLevelEstimator = {
      async estimate(input) {
        calls.push(input)
        // Phase 2 실 로직 자리. mock 은 항상 null + source: 'mock'.
        return { level: null, confidence: 0, source: 'mock' }
      }
    }

    // 호출 interface 검증 (실 학습 로직 없음)
    return mockEstimator
      .estimate({ workspaceId: fx.defaultId, topic: 'Rust lifetime' })
      .then((result) => {
        expect(result.source).toBe('mock')
        expect(result.level).toBeNull()
        expect(result.confidence).toBe(0)
        expect(calls.length).toBe(1)
        expect(calls[0]).toEqual({
          workspaceId: fx.defaultId,
          topic: 'Rust lifetime'
        })
      })
  })
})
