/**
 * Sprint 015 M3-1 — v0.4 통합 SQLite Database 진입점.
 *
 * 책임:
 *   - better-sqlite3 (Electron 39 ABI rebuild) 인스턴스 관리
 *   - sqlite-vec 0.1.9 extension 로드 (vec0 가상 모듈 등록)
 *   - schema/v04.sql 적용 (idempotent — IF NOT EXISTS DDL)
 *   - PRAGMA 설정: foreign_keys ON / journal_mode WAL (file mode 만)
 *   - 워크스페이스 기본 CRUD + ensureDefaultWorkspace("📥 기본")
 *   - schema_meta 키-값 영속 (마이그레이션 추적)
 *
 * 호출 순서 (정합):
 *   const db = await FlowbrowserDatabase.open({ path })
 *   db.applySchema()
 *   db.ensureDefaultWorkspace()
 *
 * 또는 (전체 부트):
 *   const db = await FlowbrowserDatabase.bootstrap({ path })
 *
 * 후속 PR 의존:
 *   - M3-2 VectorIndex: db.getDb() 로 vec_pages / vec_notes 접근
 *   - M3-3 IndexedPageStore SQLite 확장: db.getDb() 로 pages / visits 접근 (JSON 영속 흡수)
 *   - M3-4 NoteStore / AiChatHistoryStore / TagStore: db.getDb() 활용
 *   - M3-6 migrations/v03_to_v04: 본 모듈로 dry-run → 실 적용 → revert
 *
 * 테스트 진입점:
 *   FlowbrowserDatabase.openInMemory()  — ':memory:' (file mode WAL skip)
 *
 * 의존 결정 박힘 (`.flowset/specs/m3-spike-decisions.md` §3):
 *   - better-sqlite3 12.x (11.x V8 ABI 비호환 차단)
 *   - sqlite-vec 0.1.9 (windows-x64 prebuilt 검증, macOS 미검증 KI 후보)
 *   - vec0 `partition key` (space 구분, underscore 아님)
 *   - float[1024] (PRD §04.3.8 정합)
 */

import Database, { Database as BetterDatabase } from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { randomUUID } from 'node:crypto'

// Sprint 017 M1 T07 — v05 canonical full schema (v04 + highlights).
//   bootstrap() / applySchema() 호출 시 v05.sql 이 적용 — fresh install + v04 idempotent 둘 다 안전.
//   v04 DB 가 있는 사용자 경로 (services.ts) 는 `open` + `migrateV04ToV05` (백업 + schema 적용 + sentinel) +
//   `ensureDefaultWorkspace` 로 분해하여 G-014 정합 (codex 019e4dd1 BLOCKING).
import schemaSQL from './schema/v05.sql?raw'

/**
 * 기본 워크스페이스 메타. PRD §02 시나리오 + A3 §A4 정합.
 */
export const DEFAULT_WORKSPACE_NAME = '기본'
export const DEFAULT_WORKSPACE_ICON = '📥'

/**
 * v0.4 schema 버전. Sprint 015 M3 마이그레이션 시점에 schema_meta.version 으로 박힘.
 */
export const V04_SCHEMA_VERSION = 1

/**
 * Sprint 017 M1 T07 — v0.5 schema 버전. applySchema 가 schema_meta.version 으로 박음.
 * v04 → v05 transition: highlights 테이블 + 4종 인덱스 추가 (PRD §11.2.1 노트 anchor 영속).
 */
export const V05_SCHEMA_VERSION = 2

/**
 * Sprint 018 M2 T17a — v0.6 schema 버전. `migrateV05ToV06` 가 transition 완료 시 schema_meta.version 으로 박음.
 * v05 → v06 transition: workspaces.embedding_model 컬럼 + dimension 별 vec0 테이블 분리
 * (vec_pages_1024/vec_pages_768/vec_notes_1024/vec_notes_768) + 트리거 갱신 (Schema v06 spec §3).
 *
 * applySchema 는 v05.sql 을 유지 (version=2) — v06 transition 은 명시 마이그레이션 함수 소유 (codex 019e6574 권고 A).
 * v06 wiring (services.ts 체인 + VectorIndex/SearchService dimension 분기) 은 T17b.
 */
export const V06_SCHEMA_VERSION = 3

export type LevelPreference = 'novice' | 'intermediate' | 'advanced' | null

export interface WorkspaceRow {
  id: string
  name: string
  icon: string
  created_at: number
  level_preference: LevelPreference
}

export interface CreateWorkspaceInput {
  name: string
  icon: string
  level_preference?: LevelPreference
  /** 명시 시 지정된 id 로 INSERT (테스트 / 마이그레이션 용). 미주입 시 crypto.randomUUID() */
  id?: string
}

export interface SchemaMetaRow {
  key: string
  value: string
  updated_at: number
}

export interface FlowbrowserDatabaseOptions {
  /** ':memory:' 또는 절대 파일 경로 */
  path: string
  /** 테스트용 — sqlite-vec.load 를 직접 주입 (가짜 구현). 미주입 시 sqlite-vec 모듈 사용 */
  sqliteVecLoader?: (db: BetterDatabase) => void
  /** 디폴트 true. false 면 WAL 미설정 (in-memory / 테스트 격리 용) */
  enableWal?: boolean
  /** 디폴트 true. false 면 외래키 제약 미적용 (테스트 격리 용) */
  enableForeignKeys?: boolean
}

/**
 * `FlowbrowserDatabase` — v0.4 통합 SQLite 진입점.
 *
 * 직접 인스턴스화 금지. `open()` / `openInMemory()` / `bootstrap()` 사용.
 */
export class FlowbrowserDatabase {
  private constructor(
    private readonly db: BetterDatabase,
    public readonly path: string
  ) {}

  /**
   * 일반 진입점 — DB 파일 열기 + sqlite-vec 로드. schema 적용은 별도 호출.
   *
   * @example
   *   const db = FlowbrowserDatabase.open({ path: '/path/to/flowbrowser.db' })
   *   db.applySchema()
   *   db.ensureDefaultWorkspace()
   */
  static open(opts: FlowbrowserDatabaseOptions): FlowbrowserDatabase {
    const { path, sqliteVecLoader, enableWal = true, enableForeignKeys = true } = opts
    const native = new Database(path)
    const inMemory = path === ':memory:'
    if (enableForeignKeys) native.pragma('foreign_keys = ON')
    if (enableWal && !inMemory) native.pragma('journal_mode = WAL')
    const loader = sqliteVecLoader ?? ((d: BetterDatabase) => sqliteVec.load(d))
    loader(native)
    return new FlowbrowserDatabase(native, path)
  }

  /**
   * In-memory DB (테스트 진입점). WAL 비활성 / FK 활성 / sqlite-vec 자동 로드.
   */
  static openInMemory(loader?: (db: BetterDatabase) => void): FlowbrowserDatabase {
    return FlowbrowserDatabase.open({
      path: ':memory:',
      sqliteVecLoader: loader,
      enableWal: false
    })
  }

  /**
   * 부트 (open + applySchema + ensureDefaultWorkspace) 한 번에. 일반 main 진입에 권장.
   */
  static bootstrap(opts: FlowbrowserDatabaseOptions): FlowbrowserDatabase {
    const inst = FlowbrowserDatabase.open(opts)
    inst.applySchema()
    inst.ensureDefaultWorkspace()
    return inst
  }

  /**
   * v04.sql 전체 적용 (idempotent — IF NOT EXISTS DDL).
   * 두 번 호출해도 안전. 적용 후 schema_meta.version 갱신.
   */
  applySchema(): void {
    this.db.exec(schemaSQL)
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO schema_meta(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    stmt.run('version', String(V05_SCHEMA_VERSION), now)
  }

  /**
   * "📥 기본" 워크스페이스 (이름 unique 가정). 이미 존재 시 그대로 반환.
   * 첫 install / 마이그레이션 시 workspace_id 안정 진입점.
   */
  ensureDefaultWorkspace(
    name: string = DEFAULT_WORKSPACE_NAME,
    icon: string = DEFAULT_WORKSPACE_ICON
  ): WorkspaceRow {
    const existing = this.findWorkspaceByName(name)
    if (existing) return existing
    return this.createWorkspace({ name, icon })
  }

  createWorkspace(input: CreateWorkspaceInput): WorkspaceRow {
    const id = input.id ?? randomUUID()
    const row: WorkspaceRow = {
      id,
      name: input.name,
      icon: input.icon,
      created_at: Date.now(),
      level_preference: input.level_preference ?? null
    }
    this.db
      .prepare(
        `INSERT INTO workspaces(id, name, icon, created_at, level_preference)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(row.id, row.name, row.icon, row.created_at, row.level_preference)
    return row
  }

  findWorkspaceById(id: string): WorkspaceRow | null {
    const row = this.db
      .prepare('SELECT id, name, icon, created_at, level_preference FROM workspaces WHERE id = ?')
      .get(id) as WorkspaceRow | undefined
    return row ?? null
  }

  findWorkspaceByName(name: string): WorkspaceRow | null {
    const row = this.db
      .prepare('SELECT id, name, icon, created_at, level_preference FROM workspaces WHERE name = ?')
      .get(name) as WorkspaceRow | undefined
    return row ?? null
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db
      .prepare(
        'SELECT id, name, icon, created_at, level_preference FROM workspaces ORDER BY created_at ASC'
      )
      .all() as WorkspaceRow[]
  }

  setSchemaMeta(key: string, value: string): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO schema_meta(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now)
  }

  getSchemaMeta(key: string): SchemaMetaRow | null {
    const row = this.db
      .prepare('SELECT key, value, updated_at FROM schema_meta WHERE key = ?')
      .get(key) as SchemaMetaRow | undefined
    return row ?? null
  }

  /**
   * better-sqlite3 인스턴스 직접 접근 (후속 PR 의 VectorIndex / IndexedPageStore SQLite 확장 등).
   * 호출자가 prepare / exec / transaction 직접 사용.
   */
  getDb(): BetterDatabase {
    return this.db
  }

  /** SQLite 본체 버전. */
  sqliteVersion(): string {
    return (this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
  }

  /** sqlite-vec extension 버전 (v0.1.9 등). */
  sqliteVecVersion(): string {
    return (this.db.prepare('SELECT vec_version() AS v').get() as { v: string }).v
  }

  close(): void {
    this.db.close()
  }
}
