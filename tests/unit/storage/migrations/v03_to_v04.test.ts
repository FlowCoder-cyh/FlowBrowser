/**
 * Sprint 015 M3-6 — v03→v04 마이그레이션 8 회귀 케이스.
 *
 * `.flowset/specs/v04-data-migration.md` §B5 정합:
 *   1. 빈 데이터 (fresh install)
 *   2. Glossary 3 → Note 3 (ai_tags 정확성)
 *   3. TranslationCache (translation kind, summary requestType skip)
 *   4. PageResults → Page+Visit (workspace_id 부여)
 *   5. UserSetting 폐기 키 제거 + 신규 키 디폴트
 *   6. TabStateStore 모든 탭 workspace_id 부여
 *   7. Dry-run 오류 → revert (flowbrowser.db 생성 X + 백업 보존)
 *   8. Idempotent (두 번째 실행 시 skip)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../../src/storage/Database'
import { NoteStore } from '../../../../src/storage/NoteStore'
import { IndexedPageStoreSqlite } from '../../../../src/storage/IndexedPageStoreSqlite'
import { EmbeddingQueue } from '../../../../src/storage/EmbeddingQueue'
import {
  migrateV03ToV04,
  MIGRATION_SCHEMA_META_KEY,
  V04_LOG_FILE
} from '../../../../src/storage/migrations/v03_to_v04'

interface Fx {
  userDataDir: string
  fb: FlowbrowserDatabase
  noteStore: NoteStore
  pageStore: IndexedPageStoreSqlite
  queue: EmbeddingQueue
  defaultWsId: string
}

async function setup(): Promise<Fx> {
  const userDataDir = join(tmpdir(), `fb-migr-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(userDataDir, { recursive: true })
  const fb = FlowbrowserDatabase.openInMemory()
  fb.applySchema()
  const defaultWs = fb.ensureDefaultWorkspace()
  return {
    userDataDir,
    fb,
    noteStore: new NoteStore(fb),
    pageStore: new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id }),
    queue: new EmbeddingQueue(fb),
    defaultWsId: defaultWs.id
  }
}

async function teardown(fx: Fx): Promise<void> {
  fx.fb.close()
  await fs.rm(fx.userDataDir, { recursive: true, force: true }).catch(() => {})
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 0), 'utf-8')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

describe('migrateV03ToV04 — 8 회귀 케이스', () => {
  let fx: Fx

  beforeEach(async () => {
    fx = await setup()
  })

  afterEach(async () => {
    await teardown(fx)
  })

  // 1. 빈 데이터 → fresh install
  it('case 1: 빈 데이터 → fresh_install (백업 없음, schema-only)', async () => {
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.status).toBe('fresh_install')
    expect(result.backup_path).toBeUndefined()
    expect(fx.noteStore.countByWorkspace(fx.defaultWsId)).toBe(0)
    expect(fx.pageStore.countPages()).toBe(0)
  })

  // 2. Glossary → Note
  it('case 2: Glossary 3 terms → Note 3 (ai_tags 정확성, glossary + domain prefix)', async () => {
    await writeJson(join(fx.userDataDir, 'glossary.json'), {
      policyVersion: 1,
      currentVersion: 'v1',
      terms: [
        {
          id: 't1',
          sourceTerm: 'CAR-T',
          targetTerm: '카티세포치료',
          description: '면역 치료',
          domain: 'medicine'
        },
        {
          id: 't2',
          sourceTerm: 'EBITDA',
          targetTerm: '에비타',
          description: '',
          domain: 'finance'
        },
        {
          id: 't3',
          sourceTerm: 'NoDomain',
          targetTerm: '도메인없음',
          description: '',
          domain: ''
        }
      ]
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.status).toBe('migrated')
    expect(result.counts.glossary_to_notes).toBe(3)
    expect(result.counts.glossary_terms_with_domain).toBe(2)
    const notes = fx.noteStore.listByWorkspace(fx.defaultWsId)
    expect(notes).toHaveLength(3)
    const t1 = notes.find((n) => n.selected_text === 'CAR-T')!
    expect(t1.ai_tags).toEqual(['glossary', 'domain:medicine'])
    expect(t1.body).toBe('카티세포치료\n\n면역 치료')
    expect(t1.created_by).toBe('migration')
    const t3 = notes.find((n) => n.selected_text === 'NoDomain')!
    expect(t3.ai_tags).toEqual(['glossary']) // 빈 domain → glossary 단독
  })

  // 3. TranslationCache → AIResponseCache kind:translation + summary skip
  it("case 3: TranslationCache 매핑 (translation kind, requestType='summary' skip)", async () => {
    await writeJson(join(fx.userDataDir, 'translation-cache.json'), {
      entries: {
        k1: { sourceText: 'a', targetText: '가', requestType: 'selection', createdAt: 100 },
        k2: { sourceText: 'b', targetText: '나', requestType: 'paragraph', createdAt: 200 },
        k3: { sourceText: 'c', targetText: '다', requestType: 'summary', createdAt: 300 }, // skip
        k4: { sourceText: 'd', targetText: '라', requestType: 'page', createdAt: 400 }
      },
      version: 1
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.counts.cache_entries_kept).toBe(3) // k1, k2, k4
    expect(result.counts.cache_entries_skipped).toBe(1) // k3 summary
    const aiCachePath = join(fx.userDataDir, 'ai-response-cache.json')
    expect(await exists(aiCachePath)).toBe(true)
    const parsed = JSON.parse(await fs.readFile(aiCachePath, 'utf-8'))
    expect(Object.keys(parsed.entries)).toHaveLength(3)
    for (const e of Object.values(parsed.entries) as Array<{ kind?: string }>) {
      expect(e.kind).toBe('translation')
    }
  })

  // 4. PageResults → Page + Visit (workspace_id 부여)
  it('case 4: PageResults → Page+Visit (workspace_id 부여 + 빈 content)', async () => {
    await writeJson(join(fx.userDataDir, 'page-results.json'), {
      entries: [
        { id: 'p1', url: 'https://x.test/a', createdAt: 1000 },
        { id: 'p2', url: 'https://x.test/b', createdAt: 2000 }
      ],
      version: 1
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.counts.pages).toBe(2)
    expect(result.counts.visits).toBe(2)
    const pageA = fx.pageStore.lookupPage(fx.defaultWsId, 'https://x.test/a')!
    expect(pageA.workspace_id).toBe(fx.defaultWsId)
    expect(pageA.content).toBe('') // v0.3에 본문 없음
    expect(pageA.content_hash).toBeNull()
    const visits = fx.pageStore.listVisits(pageA.id)
    expect(visits[0].visited_at).toBe(1000)
  })

  // 5. UserSetting 폐기 키 제거 + 신규 키 디폴트
  it("case 5: UserSetting translationMode/cancelOnTabSwitch 제거 + 신규 키 추가", async () => {
    await writeJson(join(fx.userDataDir, 'user-setting.json'), {
      translationMode: 'replace', // 폐기 대상
      cancelOnTabSwitch: true, // 폐기 대상
      defaultLanguage: 'ko', // 유지
      privacyFilterEnabled: true,
      onboardingShown: true
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.counts.user_setting_keys_removed).toBe(2)
    expect(result.counts.user_setting_keys_added).toBeGreaterThanOrEqual(4)
    // .deprecated 접미사 적용된 경로에서 검증 (rename 단계)
    const path = join(fx.userDataDir, 'user-setting.json.deprecated')
    const parsed = JSON.parse(await fs.readFile(path, 'utf-8'))
    expect('translationMode' in parsed).toBe(false)
    expect('cancelOnTabSwitch' in parsed).toBe(false)
    expect(parsed.defaultLanguage).toBe('ko') // 유지
    expect(parsed.workspaceDefault).toBe(fx.defaultWsId)
    expect(parsed.shortcutOverride).toEqual({ openSearch: 'Cmd+K' })
    expect(parsed.privacyExclusions).toEqual([])
    expect(parsed.userLevelPreference).toBeNull()
  })

  // 6. TabState 모든 탭 workspace_id 부여 (Sprint 016 M0 T03a — snake_case 정합, legacy camelCase 호환)
  it("case 6: TabState 모든 탭 workspace_id 부여 (legacy camelCase + snake_case 둘 다 보존)", async () => {
    const preexistingWs = 'preexisting-ws-id'
    const preexistingWs2 = 'preexisting-ws-id-2'
    await writeJson(join(fx.userDataDir, 'tabs.json'), {
      tabs: [
        { id: 't1', url: 'https://x.test/a', title: 'A' },
        { id: 't2', url: 'https://x.test/b', title: 'B' },
        // legacy camelCase 잔재 (v0.4-pre 산출물)
        { id: 't3', url: 'https://x.test/c', title: 'C', workspaceId: preexistingWs },
        // snake_case 신규 schema 직접 박힌 경우
        { id: 't4', url: 'https://x.test/d', title: 'D', workspace_id: preexistingWs2 }
      ],
      activeId: 't1'
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.counts.tabs_workspace_assigned).toBe(2)
    const parsed = JSON.parse(
      await fs.readFile(join(fx.userDataDir, 'tabs.json.deprecated'), 'utf-8')
    )
    // 신규 schema 는 snake_case workspace_id 키로 영속 (codex BLOCKING #2 해소)
    expect(parsed.tabs[0].workspace_id).toBe(fx.defaultWsId)
    expect(parsed.tabs[1].workspace_id).toBe(fx.defaultWsId)
    expect(parsed.tabs[2].workspace_id).toBe(preexistingWs) // legacy camelCase 정규화 + 보존
    expect(parsed.tabs[3].workspace_id).toBe(preexistingWs2) // snake_case 그대로 보존
    // legacy camelCase 키는 제거됨 (정규화 후 잔재 없음)
    expect('workspaceId' in parsed.tabs[2]).toBe(false)
  })

  // 7. Dry-run 오류 시 revert
  it('case 7: 마이그레이션 throw → revert (sentinel 미생성 + 백업 보존)', async () => {
    await writeJson(join(fx.userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'ok', targetTerm: '오케이', domain: 'general' }]
    })
    // throw 유발 — noteStore.create 가 빈 selected_text 거부함을 활용
    await writeJson(join(fx.userDataDir, 'page-results.json'), {
      entries: [{ id: 'p1', url: 'https://x.test/a', createdAt: 100 }]
    })
    const brokenPageStore: IndexedPageStoreSqlite = {
      ...fx.pageStore,
      recordVisit: async () => {
        throw new Error('simulated migration failure')
      }
    } as unknown as IndexedPageStoreSqlite
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: brokenPageStore
    })
    expect(result.status).toBe('reverted')
    expect(result.error).toMatch(/simulated migration failure/)
    // M3 핫픽스 — schema_meta sentinel 키 미박힘 검증
    expect(fx.fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)).toBeNull()
    // 백업 보존
    expect(result.backup_path).toBeDefined()
    expect(await exists(result.backup_path!)).toBe(true)
    // 원본 복구 — .deprecated 정리되고 .json 복원
    expect(await exists(join(fx.userDataDir, 'glossary.json'))).toBe(true)
    expect(
      await exists(join(fx.userDataDir, 'glossary.json.deprecated'))
    ).toBe(false)
  })

  // 8. Idempotent
  it('case 8: 두 번째 실행 시 already_migrated (sentinel 존재 → skip)', async () => {
    await writeJson(join(fx.userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'one', targetTerm: '하나' }]
    })
    const first = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(first.status).toBe('migrated')
    expect(first.counts.glossary_to_notes).toBe(1)
    // 두 번째 호출 — sentinel 존재 → skip
    const second = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(second.status).toBe('already_migrated')
    expect(second.counts.glossary_to_notes).toBe(0)
    // Note는 첫 번째 호출에서만 생성됨
    expect(fx.noteStore.countByWorkspace(fx.defaultWsId)).toBe(1)
  })

  // 추가: backup + log 산출 검증
  it('full migration 후 backup + log + schema_meta sentinel 박힘', async () => {
    await writeJson(join(fx.userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'x', targetTerm: 'ㅈ' }]
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore
    })
    expect(result.status).toBe('migrated')
    expect(result.backup_path).toBeDefined()
    expect(await exists(result.backup_path!)).toBe(true)
    expect(await exists(join(result.backup_path!, 'glossary.json'))).toBe(true)
    const log = await fs.readFile(join(fx.userDataDir, V04_LOG_FILE), 'utf-8')
    expect(log).toMatch(/\[backup\] glossary\.json/)
    expect(log).toMatch(/\[migrate\] glossary: 1 → notes/)
    expect(log).toMatch(/migration v03 → v04 complete/)
    // M3 핫픽스 — schema_meta sentinel key 박힘 (file sentinel 폐기)
    const sentinel = fx.fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)
    expect(sentinel).not.toBeNull()
    expect(sentinel!.value).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  // 추가: embedding queue enqueue 검증 (필수 의존성 옵션)
  it('embeddingQueue 주입 시 PageResults 본문 있는 경우만 enqueue', async () => {
    // 본 PR 의 page-results 매핑은 v0.3 본문 없음 → 빈 content → enqueue 0 (조건 page.content 비어 X 위배)
    await writeJson(join(fx.userDataDir, 'page-results.json'), {
      entries: [
        { id: 'p1', url: 'https://x.test/a', createdAt: 100 }
      ]
    })
    const result = await migrateV03ToV04({
      userDataDir: fx.userDataDir,
      fb: fx.fb,
      noteStore: fx.noteStore,
      pageStore: fx.pageStore,
      embeddingQueue: fx.queue
    })
    // v0.3 본문 없음 → enqueue 0 (M4 재방문 인덱싱 hook 시점에 enqueue 권고)
    expect(result.counts.embedding_jobs_enqueued).toBe(0)
    expect(fx.queue.stats().pending).toBe(0)
  })
})

// ============================================================
// M3 핫픽스 (2026-05-18 codex BLOCKING) — file-mode 회귀 케이스
// ============================================================
//
// 기존 8 회귀 케이스는 모두 openInMemory(). 그러나 실 v0.3 사용자의 부팅 경로는
// file-mode FlowbrowserDatabase.open(path) — better-sqlite3 가 빈 flowbrowser.db 파일을 먼저 생성.
// 기존 file-sentinel 방식에서는 sentinel 의미 상실 → 영구 skip → 데이터 손실.
// 본 회귀 케이스는 file-mode 부팅 경로에서 sentinel 이 schema_meta 키로 정상 동작함을 검증.
//
describe('migrateV03ToV04 — file-mode 회귀 (M3 핫픽스)', () => {
  let userDataDir: string
  let dbPath: string

  beforeEach(async () => {
    userDataDir = join(tmpdir(), `fb-migr-file-${Date.now()}-${randomUUID().slice(0, 8)}`)
    await fs.mkdir(userDataDir, { recursive: true })
    dbPath = join(userDataDir, 'flowbrowser.db')
  })

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('file-mode bootstrap 후 첫 migrate → migrated + schema_meta key 박힘', async () => {
    await writeJson(join(userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'CAR-T', targetTerm: '카티세포치료', domain: 'medicine' }]
    })
    const fb = FlowbrowserDatabase.bootstrap({ path: dbPath })
    try {
      // 빈 DB 파일 생성됨 (better-sqlite3 file mode), WAL 모드 활성, schema 적용 완료
      expect(await exists(dbPath)).toBe(true)
      // 그러나 schema_meta 에 마이그레이션 키 미박힘 → 마이그레이션 진입 가능
      expect(fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)).toBeNull()
      const defaultWs = fb.ensureDefaultWorkspace()
      const noteStore = new NoteStore(fb)
      const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
      const result = await migrateV03ToV04({
        userDataDir,
        fb,
        noteStore,
        pageStore
      })
      expect(result.status).toBe('migrated')
      expect(result.counts.glossary_to_notes).toBe(1)
      // 마이그레이션 후 schema_meta sentinel 박힘
      expect(fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)).not.toBeNull()
    } finally {
      fb.close()
    }
  })

  it('file-mode 두 번째 bootstrap → schema_meta sentinel 존재 → already_migrated (회귀 차단)', async () => {
    await writeJson(join(userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'one', targetTerm: '하나' }]
    })
    // 1차 부팅 — 마이그레이션 실행
    {
      const fb = FlowbrowserDatabase.bootstrap({ path: dbPath })
      try {
        const defaultWs = fb.ensureDefaultWorkspace()
        const noteStore = new NoteStore(fb)
        const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
        const first = await migrateV03ToV04({
          userDataDir,
          fb,
          noteStore,
          pageStore
        })
        expect(first.status).toBe('migrated')
      } finally {
        fb.close()
      }
    }
    // 2차 부팅 — DB 파일 존재 + schema_meta sentinel 존재 → already_migrated
    {
      const fb = FlowbrowserDatabase.bootstrap({ path: dbPath })
      try {
        const defaultWs = fb.ensureDefaultWorkspace()
        const noteStore = new NoteStore(fb)
        const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
        const second = await migrateV03ToV04({
          userDataDir,
          fb,
          noteStore,
          pageStore
        })
        expect(second.status).toBe('already_migrated')
        expect(second.counts.glossary_to_notes).toBe(0)
        // Note 는 1차 호출에서만 생성됨 (총 1개 — 영속 정합)
        expect(noteStore.countByWorkspace(defaultWs.id)).toBe(1)
      } finally {
        fb.close()
      }
    }
  })

  it('file-mode revert → schema_meta sentinel key 정리 → 재시도 시 다시 트리거', async () => {
    await writeJson(join(userDataDir, 'glossary.json'), {
      terms: [{ id: 't', sourceTerm: 'ok', targetTerm: '오케이' }]
    })
    await writeJson(join(userDataDir, 'page-results.json'), {
      entries: [{ id: 'p1', url: 'https://x.test/a', createdAt: 100 }]
    })
    const fb = FlowbrowserDatabase.bootstrap({ path: dbPath })
    try {
      const defaultWs = fb.ensureDefaultWorkspace()
      const noteStore = new NoteStore(fb)
      const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: defaultWs.id })
      const brokenPageStore: IndexedPageStoreSqlite = {
        ...pageStore,
        recordVisit: async () => {
          throw new Error('simulated failure')
        }
      } as unknown as IndexedPageStoreSqlite
      const failed = await migrateV03ToV04({
        userDataDir,
        fb,
        noteStore,
        pageStore: brokenPageStore
      })
      expect(failed.status).toBe('reverted')
      // schema_meta sentinel key 미박힘 (revert 가 정리)
      expect(fb.getSchemaMeta(MIGRATION_SCHEMA_META_KEY)).toBeNull()
      // 재시도 가능 — 정상 pageStore 로 다시 호출
      const retry = await migrateV03ToV04({
        userDataDir,
        fb,
        noteStore,
        pageStore
      })
      expect(retry.status).toBe('migrated')
      expect(retry.counts.glossary_to_notes).toBe(1)
    } finally {
      fb.close()
    }
  })
})
