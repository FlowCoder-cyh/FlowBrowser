/**
 * Sprint 017 M1 T07 — HighlightStore SQLite swap (Sprint 016 M4 T20 in-memory 후속).
 *
 * PRD §11.2.1 highlights — 노트 선택 영역 anchor 메타데이터 영속.
 *
 * G-013 2단계 → 3단계 — Sprint 017 M1 T06 (renderer UI overlay 박힘) 직후 SQLite backend swap.
 *   T06 IPC handler / NoteHighlight 컴포넌트는 본 swap 무관 (동일 interface 유지).
 *
 * 책임:
 *   1. add(input) — 신규 highlight 등록 (id 자체 발급)
 *   2. get(id) — 단일 조회
 *   3. listByPage({ workspaceId, pageId? | url? + contentHash? }) — 페이지 재방문 시 복원용
 *   4. listByNote(noteId) — 노트 패널 표시용 (1:N — 한 노트가 여러 highlight 가능)
 *   5. listByWorkspace(workspaceId) — 격리 확인용
 *   6. remove(id) — 삭제
 *   7. clear() — 단위 테스트 reset
 *
 * codex 사전 협의 019e4dd1 정합:
 *   - 생성자 `fb?: FlowbrowserDatabase` optional — fb 주입 시 SQLite-backed, 미주입 시 in-memory Map fallback
 *   - services.ts 는 bootstrap 성공 후 `new HighlightStore(fb)` 재할당 (영속 누락 차단)
 *   - bootstrap 실패 (인프라 미준비) 시 단독 instance — IPC handler graceful 동작
 *
 * codex 사전 협의 (Sprint 016 M4 T20, threadId 019e4a06):
 *   - id 는 highlight 자체 id (noteId 1:1 강제 X — 한 노트가 여러 highlight 가능)
 *   - listByPage 는 workspaceId + (pageId 또는 url+contentHash) 필터 — cross-page 노출 차단
 *   - contentHash 단독 list 금지 (collision 위험)
 *
 * Sprint 017 T02 정합 — storage 경계에서 `pageId='' or whitespace-only` 는 `null` 로 정규화.
 */

import { randomUUID } from 'node:crypto'

import type BetterSqliteNamespace from 'better-sqlite3'
import type { HighlightAnchor } from '../perception/highlightAnchor'
import type { FlowbrowserDatabase } from './Database'
import { normalizeOptionalId } from './idNormalize'

type Stmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

export interface HighlightRecord {
  /** highlight 자체 id (noteId 와 별개 — 한 노트가 여러 highlight 가능). */
  id: string
  /** 연결된 노트 id (필수 — highlight 는 항상 노트의 선택 영역 표현). */
  noteId: string
  /** 페이지 id (pages 테이블 FK 후보). nullable 허용 (PDF 등 pageId 미발급 시). */
  pageId: string | null
  /** 페이지 URL (drift fallback 시 page 식별용). */
  url: string
  /** anchor 시점 root.textContent 해시 — listByPage 필터 + drift 판단. */
  contentHash: string
  /** anchor 메타데이터 (W3C Range serialize 결과). */
  anchor: HighlightAnchor
  /** 워크스페이스 격리 — listByPage 의 강제 필터. */
  workspaceId: string
  /** epoch ms. */
  createdAt: number
}

export interface CreateHighlightInput {
  noteId: string
  pageId?: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchor
  workspaceId: string
  /** 명시 id (단위 테스트 / import 시) — 미지정 시 randomUUID. */
  id?: string
  /** 명시 createdAt (단위 테스트 / import 시) — 미지정 시 Date.now. */
  createdAt?: number
}

export interface ListByPageFilter {
  workspaceId: string
  /** pageId 또는 url + contentHash 중 하나 이상 필수 (cross-page 노출 차단). */
  pageId?: string | null
  url?: string
  contentHash?: string
}

/** SQLite row → HighlightRecord. anchor JSON 파싱. */
interface HighlightRowRaw {
  id: string
  note_id: string
  workspace_id: string
  page_id: string | null
  url: string
  content_hash: string
  anchor: string
  created_at: number
}

function rawToRecord(raw: HighlightRowRaw): HighlightRecord {
  return {
    id: raw.id,
    noteId: raw.note_id,
    pageId: raw.page_id,
    url: raw.url,
    contentHash: raw.content_hash,
    anchor: JSON.parse(raw.anchor) as HighlightAnchor,
    workspaceId: raw.workspace_id,
    createdAt: raw.created_at
  }
}

/**
 * Sprint 017 M1 T07 — SQLite-backed prepared statement 집합. 본 인스턴스가 fb 와 1:1.
 */
interface SqlitePrepared {
  insert: Stmt
  findById: Stmt<HighlightRowRaw>
  listByPageId: Stmt<HighlightRowRaw>
  listByUrl: Stmt<HighlightRowRaw>
  listByUrlAndHash: Stmt<HighlightRowRaw>
  listByNote: Stmt<HighlightRowRaw>
  listByWorkspace: Stmt<HighlightRowRaw>
  remove: Stmt
  clear: Stmt
  size: Stmt<{ c: number }>
}

function prepare(fb: FlowbrowserDatabase): SqlitePrepared {
  const db = fb.getDb()
  return {
    insert: db.prepare(
      `INSERT INTO highlights(id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    findById: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE id = ?`
    ),
    // listByPage — pageId 분기 (workspace_id + page_id, ORDER BY created_at ASC)
    //   `idx_highlight_workspace_page_time` 인덱스 직접 매칭.
    listByPageId: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE workspace_id = ? AND page_id = ?
       ORDER BY created_at ASC`
    ),
    // listByPage — url 분기 (contentHash 미명시), workspace_id + url
    listByUrl: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE workspace_id = ? AND url = ?
       ORDER BY created_at ASC`
    ),
    // listByPage — url+contentHash 분기 — `idx_highlight_workspace_url_hash_time` 인덱스 직접 매칭.
    listByUrlAndHash: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE workspace_id = ? AND url = ? AND content_hash = ?
       ORDER BY created_at ASC`
    ),
    // listByNote — `idx_highlight_note` 인덱스 매칭.
    listByNote: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE note_id = ?
       ORDER BY created_at ASC`
    ),
    // listByWorkspace — `idx_highlight_workspace_time` 인덱스 매칭.
    listByWorkspace: db.prepare(
      `SELECT id, note_id, workspace_id, page_id, url, content_hash, anchor, created_at
       FROM highlights WHERE workspace_id = ?
       ORDER BY created_at ASC`
    ),
    remove: db.prepare('DELETE FROM highlights WHERE id = ?'),
    clear: db.prepare('DELETE FROM highlights'),
    size: db.prepare('SELECT COUNT(*) AS c FROM highlights')
  }
}

export class HighlightStore {
  /** in-memory fallback (fb 미주입 시). codex 019e4dd1 #4: SQLite native 로드 실패 시 graceful. */
  private readonly memoryMap: Map<string, HighlightRecord> | null
  private readonly sqlite: SqlitePrepared | null

  /**
   * Sprint 017 M1 T07 — `fb` optional 생성자.
   *
   * - fb 주입 시: SQLite-backed (`highlights` 테이블 prepared statements)
   * - fb 미주입 시: in-memory Map fallback (Sprint 016 M4 T20 동작 정합 + 단위 테스트 호환)
   *
   * 사용 정책 (codex 019e4e82 NOTABLE #5):
   *   - Production main 진입점은 반드시 `new HighlightStore(flowbrowserDb)` (SQLite 영속) 또는
   *     bootstrap 실패 시 `HighlightStore.inMemoryForFallback()` 명시 factory 사용.
   *   - `new HighlightStore()` (no-arg) 는 단위 테스트 / silent in-memory 경로. production 권장 X.
   */
  constructor(fb?: FlowbrowserDatabase) {
    if (fb) {
      this.memoryMap = null
      this.sqlite = prepare(fb)
    } else {
      this.memoryMap = new Map()
      this.sqlite = null
    }
  }

  /**
   * Sprint 017 M1 T07 (codex 019e4e82 NOTABLE #5) — bootstrap 실패 시 명시 fallback factory.
   *
   * services.ts 가 SQLite 인프라 미준비 (sqlite-vec native 로드 실패 등) 시 본 factory 호출.
   * 호출자 의도를 코드 시점에 명시 — `new HighlightStore()` 의 production footgun 차단.
   */
  static inMemoryForFallback(): HighlightStore {
    return new HighlightStore()
  }

  /**
   * 신규 highlight 등록. workspaceId / noteId / url / anchor / contentHash 필수.
   * id 미지정 시 randomUUID 발급. createdAt 미지정 시 Date.now.
   */
  add(input: CreateHighlightInput): HighlightRecord {
    if (!input.workspaceId) throw new Error('HighlightStore.add: workspaceId required')
    if (!input.noteId) throw new Error('HighlightStore.add: noteId required')
    if (!input.url) throw new Error('HighlightStore.add: url required')
    if (!input.contentHash) throw new Error('HighlightStore.add: contentHash required')
    if (!input.anchor) throw new Error('HighlightStore.add: anchor required')

    // storage 경계 normalize — `'' or whitespace-only → null` (Sprint 017 T02).
    const record: HighlightRecord = {
      id: input.id ?? randomUUID(),
      noteId: input.noteId,
      pageId: normalizeOptionalId(input.pageId),
      url: input.url,
      contentHash: input.contentHash,
      anchor: input.anchor,
      workspaceId: input.workspaceId,
      createdAt: input.createdAt ?? Date.now()
    }

    if (this.sqlite) {
      // duplicate id 검사 — SQLite UNIQUE constraint 가 throw 하지만 명시적 메시지로 통일.
      const exists = this.sqlite.findById.get(record.id)
      if (exists) {
        throw new Error(`HighlightStore.add: duplicate id=${record.id}`)
      }
      this.sqlite.insert.run(
        record.id,
        record.noteId,
        record.workspaceId,
        record.pageId,
        record.url,
        record.contentHash,
        JSON.stringify(record.anchor),
        record.createdAt
      )
      return record
    }

    // in-memory fallback
    if (this.memoryMap!.has(record.id)) {
      throw new Error(`HighlightStore.add: duplicate id=${record.id}`)
    }
    this.memoryMap!.set(record.id, record)
    return record
  }

  /** 단일 조회. 없으면 null. */
  get(id: string): HighlightRecord | null {
    if (this.sqlite) {
      const raw = this.sqlite.findById.get(id)
      return raw ? rawToRecord(raw) : null
    }
    return this.memoryMap!.get(id) ?? null
  }

  /**
   * 페이지 재방문 시 복원용 — workspaceId 강제 + (실 pageId 또는 url+contentHash) 필터.
   *
   * 필터 우선순위 (Sprint 016 M4 T20 codex 019e4a16 hotfix 정합):
   *   1. 실 pageId 지정 (string + non-null): workspaceId + record.pageId === filter.pageId 일치
   *   2. pageId 가 null 또는 undefined: url 분기 — workspaceId + record.url === filter.url 일치
   *      (contentHash 지정 시 동반 일치 강제)
   *   3. pageId 가 null/undefined 인데 url 도 없으면: throw (cross-page 노출 차단)
   *
   * 결과는 createdAt 오름차순 정렬.
   */
  listByPage(filter: ListByPageFilter): HighlightRecord[] {
    if (!filter.workspaceId) {
      throw new Error('HighlightStore.listByPage: workspaceId required')
    }
    // filter normalize — `''` 또는 whitespace-only 는 "pageId 미지정" 으로 강제 (Sprint 017 T02).
    const normalizedPageId = normalizeOptionalId(filter.pageId)
    const hasRealPageId = normalizedPageId !== null
    if (!hasRealPageId && !filter.url) {
      throw new Error('HighlightStore.listByPage: pageId or url required')
    }

    if (this.sqlite) {
      if (hasRealPageId) {
        return this.sqlite.listByPageId.all(filter.workspaceId, normalizedPageId).map(rawToRecord)
      }
      // url 분기
      if (filter.contentHash) {
        return this.sqlite.listByUrlAndHash
          .all(filter.workspaceId, filter.url!, filter.contentHash)
          .map(rawToRecord)
      }
      return this.sqlite.listByUrl.all(filter.workspaceId, filter.url!).map(rawToRecord)
    }

    // in-memory fallback (Sprint 016 M4 T20 동작 정합)
    const result: HighlightRecord[] = []
    for (const record of this.memoryMap!.values()) {
      if (record.workspaceId !== filter.workspaceId) continue
      if (hasRealPageId) {
        if (record.pageId !== normalizedPageId) continue
      } else {
        if (record.url !== filter.url) continue
        if (filter.contentHash && record.contentHash !== filter.contentHash) continue
      }
      result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 노트 패널 표시용 — 한 노트의 모든 highlight (1:N). createdAt 오름차순. */
  listByNote(noteId: string): HighlightRecord[] {
    if (this.sqlite) {
      return this.sqlite.listByNote.all(noteId).map(rawToRecord)
    }
    const result: HighlightRecord[] = []
    for (const record of this.memoryMap!.values()) {
      if (record.noteId === noteId) result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 워크스페이스 격리 확인 — 전체 list. createdAt 오름차순. */
  listByWorkspace(workspaceId: string): HighlightRecord[] {
    if (this.sqlite) {
      return this.sqlite.listByWorkspace.all(workspaceId).map(rawToRecord)
    }
    const result: HighlightRecord[] = []
    for (const record of this.memoryMap!.values()) {
      if (record.workspaceId === workspaceId) result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 삭제. 존재 시 true, 없으면 false. */
  remove(id: string): boolean {
    if (this.sqlite) {
      return this.sqlite.remove.run(id).changes > 0
    }
    return this.memoryMap!.delete(id)
  }

  /** 단위 테스트 reset. 운영 사용 금지. */
  clear(): void {
    if (this.sqlite) {
      this.sqlite.clear.run()
      return
    }
    this.memoryMap!.clear()
  }

  /** 단위 테스트용 — 현 보관 row 수. */
  size(): number {
    if (this.sqlite) {
      return this.sqlite.size.get()!.c
    }
    return this.memoryMap!.size
  }
}
