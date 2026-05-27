/**
 * Sprint 015 M3-2 — VectorIndex 단위 테스트.
 *   Sprint 018 M2 T17b — v06 dimension 분기 (vec_pages_1024/768 + vec_notes_1024/768) 전환.
 *
 * cover:
 *   - embeddingToBuffer / bufferToEmbedding 라운드트립 + 차원 검증 (1024 + 768)
 *   - selectVecPagesTable / selectVecNotesTable allowlist (지원 dim / 미지원 throw)
 *   - upsertPageEmbedding / upsertNoteEmbedding INSERT + dim 별 테이블 격리
 *   - UPSERT 시멘틱 (같은 id 두 번째 호출 → 교체, 카운트 동일)
 *   - searchPages / searchNotes top-k + workspace 격리 + dim 별 테이블
 *   - dimension 분기: 1024 워크스페이스 ↔ 768 워크스페이스 테이블 격리 + dim mismatch throw
 *   - deletePageEmbedding / deleteNoteEmbedding 단일 제거 (dimension-agnostic)
 *   - deleteByWorkspace 일괄 제거 (4 테이블)
 *   - schema 트리거: pages DELETE → _1024+_768 자동 제거 / notes DELETE → 동일
 *   - workspace CASCADE 시 pages CASCADE → trigger → vec 정리 (다층 cascade)
 *   - 차원 mismatch / k=0 / 잘못된 k 처리
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import {
  VectorIndex,
  EMBEDDING_DIMENSIONS,
  embeddingToBuffer,
  bufferToEmbedding,
  selectVecPagesTable,
  selectVecNotesTable
} from '../../../src/storage/VectorIndex'
import { applyV06Schema } from '../../helpers/v06Schema'

/** seed + dim 기반 결정적 임베딩 (디폴트 1024). */
function makeEmbedding(seed: number, dim: number = EMBEDDING_DIMENSIONS): Float32Array {
  const arr = new Float32Array(dim)
  for (let i = 0; i < dim; i++) arr[i] = Math.sin(seed + i * 0.01)
  return arr
}

interface Fixture {
  fb: FlowbrowserDatabase
  vec: VectorIndex
  wsA: string
  wsB: string
  pageInWs: (wsId: string) => string
  noteInWs: (wsId: string) => string
}

function fixture(): Fixture {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb) // v06 schema — vec_pages_1024/768 + vec_notes_1024/768
  const wsA = fb.createWorkspace({ name: 'A', icon: '🅰' }).id
  const wsB = fb.createWorkspace({ name: 'B', icon: '🅱' }).id
  const vec = new VectorIndex(fb)
  const native = fb.getDb()
  const pageInWs = (wsId: string): string => {
    const id = randomUUID()
    native
      .prepare(
        `INSERT INTO pages(id, workspace_id, url, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, wsId, `https://x.test/${id}`, 'h', Date.now(), Date.now())
    return id
  }
  const noteInWs = (wsId: string): string => {
    const id = randomUUID()
    native
      .prepare(
        `INSERT INTO notes(id, workspace_id, selected_text, created_at, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, wsId, 'sel', Date.now(), 'user')
    return id
  }
  return { fb, vec, wsA, wsB, pageInWs, noteInWs }
}

describe('VectorIndex — helpers', () => {
  it('embeddingToBuffer + bufferToEmbedding 라운드트립 (1024 차원)', () => {
    const original = makeEmbedding(7)
    const buf = embeddingToBuffer(original)
    expect(buf.byteLength).toBe(EMBEDDING_DIMENSIONS * 4)
    const restored = bufferToEmbedding(buf)
    expect(restored.length).toBe(EMBEDDING_DIMENSIONS)
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 100) {
      expect(restored[i]).toBeCloseTo(original[i], 5)
    }
  })

  it('embeddingToBuffer 768 차원 (명시 dim)', () => {
    const buf = embeddingToBuffer(makeEmbedding(3, 768), 768)
    expect(buf.byteLength).toBe(768 * 4)
    expect(bufferToEmbedding(buf).length).toBe(768)
  })

  it('embeddingToBuffer accepts number[] (변환)', () => {
    const arr = new Array(EMBEDDING_DIMENSIONS).fill(0).map((_, i) => i / 1000)
    const buf = embeddingToBuffer(arr)
    expect(buf.byteLength).toBe(EMBEDDING_DIMENSIONS * 4)
  })

  it('embeddingToBuffer 차원 mismatch 시 throw (기본 1024)', () => {
    expect(() => embeddingToBuffer(new Float32Array(1023))).toThrow(/dimension mismatch/)
    expect(() => embeddingToBuffer(new Float32Array(1025))).toThrow(/dimension mismatch/)
    // 1024 벡터를 768 로 검증 요청 시 mismatch
    expect(() => embeddingToBuffer(makeEmbedding(1), 768)).toThrow(/dimension mismatch/)
  })

  it('selectVecPagesTable / selectVecNotesTable allowlist (지원 dim)', () => {
    expect(selectVecPagesTable(1024)).toBe('vec_pages_1024')
    expect(selectVecPagesTable(768)).toBe('vec_pages_768')
    expect(selectVecNotesTable(1024)).toBe('vec_notes_1024')
    expect(selectVecNotesTable(768)).toBe('vec_notes_768')
  })

  it('selectVec*Table 미지원 dim → throw (SQL identifier injection 차단)', () => {
    expect(() => selectVecPagesTable(1536)).toThrow(/Unsupported embedding dimension/)
    expect(() => selectVecNotesTable(512)).toThrow(/Unsupported embedding dimension/)
    expect(() => selectVecPagesTable(0)).toThrow(/Unsupported embedding dimension/)
  })
})

describe('VectorIndex — CRUD (1024)', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('upsertPageEmbedding 신규 INSERT', () => {
    const pageId = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(1), 1024)
    expect(f.vec.countPages(f.wsA)).toBe(1)
    expect(f.vec.countPages(f.wsB)).toBe(0)
  })

  it('upsertPageEmbedding UPSERT 시멘틱 (같은 id 두 번째 호출 시 교체)', () => {
    const pageId = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(2), 1024)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(3), 1024)
    expect(f.vec.countPages(f.wsA)).toBe(1)
    // 마지막 임베딩이 검색 시 매칭되어야 함 — seed=3 와 가까운 query 가 top-1
    const results = f.vec.searchPages(f.wsA, makeEmbedding(3.001), 1, 1024)
    expect(results[0].id).toBe(pageId)
  })

  it('upsertNoteEmbedding 신규 INSERT + UPSERT 시멘틱', () => {
    const noteId = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(noteId, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertNoteEmbedding(noteId, f.wsA, makeEmbedding(5), 1024)
    expect(f.vec.countNotes(f.wsA)).toBe(1)
  })

  it('deletePageEmbedding 단일 제거', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2), 1024)
    f.vec.deletePageEmbedding(p1)
    expect(f.vec.countPages(f.wsA)).toBe(1)
  })

  it('deletePageEmbedding 없는 id 호출 시 no-op', () => {
    expect(() => f.vec.deletePageEmbedding(randomUUID())).not.toThrow()
    expect(f.vec.countPages(f.wsA)).toBe(0)
  })

  it('deleteNoteEmbedding 단일 제거', () => {
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(1), 1024)
    f.vec.deleteNoteEmbedding(n1)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })

  it('deleteByWorkspace 일괄 제거', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const p3 = f.pageInWs(f.wsB)
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2), 1024)
    f.vec.upsertPageEmbedding(p3, f.wsB, makeEmbedding(3), 1024)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(4), 1024)
    const removed = f.vec.deleteByWorkspace(f.wsA)
    expect(removed).toEqual({ pages: 2, notes: 1 })
    expect(f.vec.countPages(f.wsA)).toBe(0)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
    expect(f.vec.countPages(f.wsB)).toBe(1) // ws-B 잔존
  })

  it('hasPageEmbedding — 존재 여부 (dimension-agnostic)', () => {
    const p1 = f.pageInWs(f.wsA)
    expect(f.vec.hasPageEmbedding(p1)).toBe(false)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    expect(f.vec.hasPageEmbedding(p1)).toBe(true)
  })
})

describe('VectorIndex — dimension 분기 (1024 ↔ 768)', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('768 upsert + search — 768 테이블 사용', () => {
    const p1 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1, 768), 768)
    expect(f.vec.countPages(f.wsA)).toBe(1) // dimension-agnostic count
    const results = f.vec.searchPages(f.wsA, makeEmbedding(1.001, 768), 5, 768)
    expect(results.map((r) => r.id)).toEqual([p1])
    // 1024 검색은 같은 워크스페이스라도 빈 결과 (테이블 격리)
    expect(f.vec.searchPages(f.wsA, makeEmbedding(1), 5, 1024)).toEqual([])
  })

  it('1024 와 768 테이블이 물리적으로 격리 (vec_pages_1024 / vec_pages_768)', () => {
    const p1024 = f.pageInWs(f.wsA)
    const p768 = f.pageInWs(f.wsB)
    f.vec.upsertPageEmbedding(p1024, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p768, f.wsB, makeEmbedding(1, 768), 768)
    const db = f.fb.getDb()
    expect((db.prepare('SELECT COUNT(*) AS c FROM vec_pages_1024').get() as { c: number }).c).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS c FROM vec_pages_768').get() as { c: number }).c).toBe(1)
  })

  it('upsert dim mismatch — 1024 벡터를 768 dim 으로 → throw', () => {
    const p1 = f.pageInWs(f.wsA)
    expect(() => f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 768)).toThrow(
      /dimension mismatch/
    )
    // 768 벡터를 1024 dim 으로도 throw
    expect(() => f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1, 768), 1024)).toThrow(
      /dimension mismatch/
    )
  })

  it('upsert 미지원 dim → throw (allowlist)', () => {
    const p1 = f.pageInWs(f.wsA)
    expect(() => f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1536)).toThrow(
      /unsupported embedding dimension/i
    )
  })

  it('768 노트 upsert + search', () => {
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(2, 768), 768)
    expect(f.vec.countNotes(f.wsA)).toBe(1)
    expect(f.vec.searchNotes(f.wsA, makeEmbedding(2.001, 768), 5, 768).map((r) => r.id)).toEqual([
      n1
    ])
  })

  it('cross-dim 전환: 1024 upsert → 768 재upsert → 1024 잔존 0 (upsert cross-dim cleanup)', () => {
    const p1 = f.pageInWs(f.wsA)
    const db = f.fb.getDb()
    const cnt = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE page_id = ?`).get(p1) as { c: number }).c

    // 먼저 1024 로 박음.
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    expect(cnt('vec_pages_1024')).toBe(1)
    expect(cnt('vec_pages_768')).toBe(0)

    // 같은 page_id 를 768 로 재upsert — upsert txn 이 모든 dim 테이블 DELETE 후 INSERT.
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1, 768), 768)
    expect(cnt('vec_pages_1024')).toBe(0) // 구 1024 행 cleanup (오염 차단)
    expect(cnt('vec_pages_768')).toBe(1)
    // 합산 count 도 1 (중복 아님).
    expect(f.vec.countPages(f.wsA)).toBe(1)
  })
})

describe('VectorIndex — search (workspace partition 격리)', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('searchPages workspace 격리 — 다른 워크스페이스 누설 차단', () => {
    const pA1 = f.pageInWs(f.wsA)
    const pA2 = f.pageInWs(f.wsA)
    const pB1 = f.pageInWs(f.wsB)
    const pB2 = f.pageInWs(f.wsB)
    f.vec.upsertPageEmbedding(pA1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(pA2, f.wsA, makeEmbedding(2), 1024)
    f.vec.upsertPageEmbedding(pB1, f.wsB, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(pB2, f.wsB, makeEmbedding(2), 1024)
    const results = f.vec.searchPages(f.wsA, makeEmbedding(1.001), 10, 1024)
    expect(results.length).toBe(2)
    expect(results.every((r) => r.workspaceId === f.wsA)).toBe(true)
    expect(results.map((r) => r.id).sort()).toEqual([pA1, pA2].sort())
  })

  it('searchPages distance ASC 정렬 (cosine, 가장 가까운 것이 top-1)', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const p3 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2), 1024)
    f.vec.upsertPageEmbedding(p3, f.wsA, makeEmbedding(3), 1024)
    const results = f.vec.searchPages(f.wsA, makeEmbedding(2.001), 3, 1024)
    expect(results[0].id).toBe(p2) // seed=2 와 가장 가까움
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance)
    expect(results[1].distance).toBeLessThanOrEqual(results[2].distance)
  })

  it('searchNotes workspace 격리', () => {
    const nA = f.noteInWs(f.wsA)
    const nB = f.noteInWs(f.wsB)
    f.vec.upsertNoteEmbedding(nA, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertNoteEmbedding(nB, f.wsB, makeEmbedding(1), 1024)
    const results = f.vec.searchNotes(f.wsA, makeEmbedding(1.001), 5, 1024)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe(nA)
  })

  it('searchPages 빈 워크스페이스 → 빈 배열', () => {
    expect(f.vec.searchPages(f.wsA, makeEmbedding(1), 5, 1024)).toEqual([])
  })

  it('searchPages k 음수 / 0 / 비정수 → throw', () => {
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), 0, 1024)).toThrow(/positive integer/)
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), -1, 1024)).toThrow(/positive integer/)
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), 1.5, 1024)).toThrow(/positive integer/)
  })

  it('searchPages 차원 mismatch query → throw', () => {
    expect(() => f.vec.searchPages(f.wsA, new Float32Array(512), 3, 1024)).toThrow(
      /dimension mismatch/
    )
  })
})

describe('VectorIndex — cascade trigger 정합 (PRD §04.6, v06 _1024+_768)', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('pages DELETE → vec_pages_1024 + _768 자동 정리 (AFTER DELETE trigger)', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2, 768), 768)
    expect(f.vec.countPages(f.wsA)).toBe(2) // 1024 + 768 합
    f.fb.getDb().prepare('DELETE FROM pages WHERE id = ?').run(p1)
    f.fb.getDb().prepare('DELETE FROM pages WHERE id = ?').run(p2)
    expect(f.vec.countPages(f.wsA)).toBe(0)
  })

  it('notes DELETE → vec_notes 자동 정리', () => {
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(1), 1024)
    expect(f.vec.countNotes(f.wsA)).toBe(1)
    f.fb.getDb().prepare('DELETE FROM notes WHERE id = ?').run(n1)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })

  it('workspace CASCADE → pages CASCADE → trigger → vec 정리 (다층)', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1), 1024)
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2), 1024)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(3), 1024)
    expect(f.vec.countPages(f.wsA)).toBe(2)
    expect(f.vec.countNotes(f.wsA)).toBe(1)
    f.fb.getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(f.wsA)
    expect(f.vec.countPages(f.wsA)).toBe(0)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })
})
