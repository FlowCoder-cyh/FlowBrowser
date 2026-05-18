/**
 * Sprint 015 M3-2 — VectorIndex 단위 테스트.
 *
 * cover:
 *   - embeddingToBuffer / bufferToEmbedding 라운드트립 + 차원 검증
 *   - upsertPageEmbedding / upsertNoteEmbedding INSERT 동작
 *   - UPSERT 시멘틱 (같은 id 두 번째 호출 → 교체, 카운트 동일)
 *   - searchPages / searchNotes top-k + workspace 격리
 *   - deletePageEmbedding / deleteNoteEmbedding 단일 제거
 *   - deleteByWorkspace 일괄 제거
 *   - schema 트리거: pages DELETE → vec_pages 자동 제거 / notes DELETE → vec_notes 자동 제거
 *   - workspace CASCADE 시 pages CASCADE → trigger → vec_pages 정리 (다층 cascade)
 *   - 차원 mismatch / k=0 / 잘못된 k 처리
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import { FlowbrowserDatabase } from '../../../src/storage/Database'
import {
  VectorIndex,
  EMBEDDING_DIMENSIONS,
  embeddingToBuffer,
  bufferToEmbedding
} from '../../../src/storage/VectorIndex'

function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) arr[i] = Math.sin(seed + i * 0.01)
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
  fb.applySchema()
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

  it('embeddingToBuffer accepts number[] (변환)', () => {
    const arr = new Array(EMBEDDING_DIMENSIONS).fill(0).map((_, i) => i / 1000)
    const buf = embeddingToBuffer(arr)
    expect(buf.byteLength).toBe(EMBEDDING_DIMENSIONS * 4)
  })

  it('embeddingToBuffer 차원 mismatch 시 throw', () => {
    expect(() => embeddingToBuffer(new Float32Array(1023))).toThrow(/dimension mismatch/)
    expect(() => embeddingToBuffer(new Float32Array(1025))).toThrow(/dimension mismatch/)
  })
})

describe('VectorIndex — CRUD', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('upsertPageEmbedding 신규 INSERT', () => {
    const pageId = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(1))
    expect(f.vec.countPages(f.wsA)).toBe(1)
    expect(f.vec.countPages(f.wsB)).toBe(0)
  })

  it('upsertPageEmbedding UPSERT 시멘틱 (같은 id 두 번째 호출 시 교체)', () => {
    const pageId = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(2))
    f.vec.upsertPageEmbedding(pageId, f.wsA, makeEmbedding(3))
    expect(f.vec.countPages(f.wsA)).toBe(1)
    // 마지막 임베딩이 검색 시 매칭되어야 함 — seed=3 와 가까운 query 가 top-1
    const results = f.vec.searchPages(f.wsA, makeEmbedding(3.001), 1)
    expect(results[0].id).toBe(pageId)
  })

  it('upsertNoteEmbedding 신규 INSERT + UPSERT 시멘틱', () => {
    const noteId = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(noteId, f.wsA, makeEmbedding(1))
    f.vec.upsertNoteEmbedding(noteId, f.wsA, makeEmbedding(5))
    expect(f.vec.countNotes(f.wsA)).toBe(1)
  })

  it('deletePageEmbedding 단일 제거', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2))
    f.vec.deletePageEmbedding(p1)
    expect(f.vec.countPages(f.wsA)).toBe(1)
  })

  it('deletePageEmbedding 없는 id 호출 시 no-op', () => {
    expect(() => f.vec.deletePageEmbedding(randomUUID())).not.toThrow()
    expect(f.vec.countPages(f.wsA)).toBe(0)
  })

  it('deleteNoteEmbedding 단일 제거', () => {
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(1))
    f.vec.deleteNoteEmbedding(n1)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })

  it('deleteByWorkspace 일괄 제거', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const p3 = f.pageInWs(f.wsB)
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2))
    f.vec.upsertPageEmbedding(p3, f.wsB, makeEmbedding(3))
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(4))
    const removed = f.vec.deleteByWorkspace(f.wsA)
    expect(removed).toEqual({ pages: 2, notes: 1 })
    expect(f.vec.countPages(f.wsA)).toBe(0)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
    expect(f.vec.countPages(f.wsB)).toBe(1) // ws-B 잔존
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
    f.vec.upsertPageEmbedding(pA1, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(pA2, f.wsA, makeEmbedding(2))
    f.vec.upsertPageEmbedding(pB1, f.wsB, makeEmbedding(1))
    f.vec.upsertPageEmbedding(pB2, f.wsB, makeEmbedding(2))
    const results = f.vec.searchPages(f.wsA, makeEmbedding(1.001), 10)
    expect(results.length).toBe(2)
    expect(results.every((r) => r.workspaceId === f.wsA)).toBe(true)
    expect(results.map((r) => r.id).sort()).toEqual([pA1, pA2].sort())
  })

  it('searchPages distance ASC 정렬 (cosine, 가장 가까운 것이 top-1)', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const p3 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2))
    f.vec.upsertPageEmbedding(p3, f.wsA, makeEmbedding(3))
    const results = f.vec.searchPages(f.wsA, makeEmbedding(2.001), 3)
    expect(results[0].id).toBe(p2) // seed=2 와 가장 가까움
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance)
    expect(results[1].distance).toBeLessThanOrEqual(results[2].distance)
  })

  it('searchNotes workspace 격리', () => {
    const nA = f.noteInWs(f.wsA)
    const nB = f.noteInWs(f.wsB)
    f.vec.upsertNoteEmbedding(nA, f.wsA, makeEmbedding(1))
    f.vec.upsertNoteEmbedding(nB, f.wsB, makeEmbedding(1))
    const results = f.vec.searchNotes(f.wsA, makeEmbedding(1.001), 5)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe(nA)
  })

  it('searchPages 빈 워크스페이스 → 빈 배열', () => {
    expect(f.vec.searchPages(f.wsA, makeEmbedding(1), 5)).toEqual([])
  })

  it('searchPages k 음수 / 0 / 비정수 → throw', () => {
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), 0)).toThrow(/positive integer/)
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), -1)).toThrow(/positive integer/)
    expect(() => f.vec.searchPages(f.wsA, makeEmbedding(1), 1.5)).toThrow(/positive integer/)
  })

  it('searchPages 차원 mismatch query → throw', () => {
    expect(() => f.vec.searchPages(f.wsA, new Float32Array(512), 3)).toThrow(/dimension mismatch/)
  })
})

describe('VectorIndex — cascade trigger 정합 (PRD §04.6)', () => {
  let f: Fixture

  beforeEach(() => {
    f = fixture()
  })

  afterEach(() => {
    f.fb.close()
  })

  it('pages DELETE → vec_pages 자동 정리 (AFTER DELETE trigger)', () => {
    const p1 = f.pageInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1))
    expect(f.vec.countPages(f.wsA)).toBe(1)
    f.fb.getDb().prepare('DELETE FROM pages WHERE id = ?').run(p1)
    expect(f.vec.countPages(f.wsA)).toBe(0)
  })

  it('notes DELETE → vec_notes 자동 정리', () => {
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(1))
    expect(f.vec.countNotes(f.wsA)).toBe(1)
    f.fb.getDb().prepare('DELETE FROM notes WHERE id = ?').run(n1)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })

  it('workspace CASCADE → pages CASCADE → trigger → vec_pages 정리 (다층)', () => {
    const p1 = f.pageInWs(f.wsA)
    const p2 = f.pageInWs(f.wsA)
    const n1 = f.noteInWs(f.wsA)
    f.vec.upsertPageEmbedding(p1, f.wsA, makeEmbedding(1))
    f.vec.upsertPageEmbedding(p2, f.wsA, makeEmbedding(2))
    f.vec.upsertNoteEmbedding(n1, f.wsA, makeEmbedding(3))
    expect(f.vec.countPages(f.wsA)).toBe(2)
    expect(f.vec.countNotes(f.wsA)).toBe(1)
    f.fb.getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(f.wsA)
    expect(f.vec.countPages(f.wsA)).toBe(0)
    expect(f.vec.countNotes(f.wsA)).toBe(0)
  })
})
