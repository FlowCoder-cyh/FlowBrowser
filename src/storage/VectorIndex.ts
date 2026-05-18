/**
 * Sprint 015 M3-2 — VectorIndex (sqlite-vec wrapper).
 *
 * 책임:
 *   - vec_pages / vec_notes 가상 테이블 CRUD wrapper
 *   - workspace_id partition 강제 (top-k 검색 시 다른 워크스페이스 누설 차단)
 *   - Float32Array ↔ Buffer 변환 + 차원 검증 (EMBEDDING_DIMENSIONS=1024)
 *   - upsert 시멘틱 (DELETE + INSERT 단일 TX) — sqlite-vec 는 native UPSERT 미지원
 *   - 비-vec 테이블 (pages / notes) 와의 cascade 정합 → schema/v04.sql AFTER DELETE 트리거 활용 (M3-2 진입 시 추가)
 *
 * 입력 결정:
 *   - 차원 1024 (PRD §04.3.8 + OpenAI text-embedding-3-small dimensions=1024 축소)
 *   - partition key: TEXT workspace_id (m3-spike-decisions §3.3 — `partition key` space 구분)
 *   - distance: cosine (vec0 디폴트, EmbeddingClient (M3-5) 가 정규화 강제 권고)
 *
 * 후속 PR 의존:
 *   - M3-5 EmbeddingClient — 본 모듈로 임베딩 영속 (upsertPageEmbedding 호출)
 *   - M3-4 NoteStore / TagStore — note 임베딩 영속 (upsertNoteEmbedding)
 *   - M4 IndexingService — did-finish-load → ParagraphExtractor → EmbeddingClient → VectorIndex
 *   - M5 SearchService — searchPages / searchNotes 호출 + 시간 가중 정렬
 */

import type BetterSqliteNamespace from 'better-sqlite3'
import type { Database as BetterDatabase } from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'

// better-sqlite3 12.x types: Statement<BindParameters extends unknown[], Result>.
// 본 모듈은 다양한 arg 시그니처를 위해 BindParameters=unknown[] 기본형으로 박힘.
type VectorStmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

/** 임베딩 차원 — PRD §04.3.8 + OpenAI text-embedding-3-small `dimensions=1024` 정합. */
export const EMBEDDING_DIMENSIONS = 1024

/** vec_pages / vec_notes 검색 결과. */
export interface VectorSearchResult {
  id: string // page_id 또는 note_id
  workspaceId: string
  distance: number // cosine distance (낮을수록 유사)
}

/** 임베딩 데이터 — Float32Array 또는 number[] 둘 다 허용. */
export type EmbeddingInput = Float32Array | number[]

/**
 * Float32Array (또는 number[]) → Buffer 변환. 차원 검증 동반.
 * 호출자는 항상 EMBEDDING_DIMENSIONS 차원 벡터 주입.
 */
export function embeddingToBuffer(embedding: EmbeddingInput): Buffer {
  const arr = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding)
  if (arr.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `VectorIndex: embedding dimension mismatch (expected ${EMBEDDING_DIMENSIONS}, got ${arr.length})`
    )
  }
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/**
 * Buffer → Float32Array 변환 (역방향). 차원 검증 없음 (호출자가 검증된 영속 데이터 가정).
 */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  // Buffer.buffer 는 underlying ArrayBuffer 재사용 — 슬라이스 복사로 안전한 사본 반환
  const copy = new ArrayBuffer(buf.byteLength)
  new Uint8Array(copy).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  return new Float32Array(copy)
}

/**
 * VectorIndex — sqlite-vec wrapper.
 *
 * 사용:
 *   const db = FlowbrowserDatabase.bootstrap({ path })
 *   const vec = new VectorIndex(db)
 *   vec.upsertPageEmbedding(pageId, workspaceId, embedding)
 *   const results = vec.searchPages(workspaceId, queryEmbedding, 5)
 */
export class VectorIndex {
  private readonly db: BetterDatabase

  // prepared statement 캐시 (성능)
  private readonly stmtDeletePageById: VectorStmt
  private readonly stmtInsertPage: VectorStmt
  private readonly stmtDeleteNoteById: VectorStmt
  private readonly stmtInsertNote: VectorStmt
  private readonly stmtSearchPages: VectorStmt<VectorSearchResult>
  private readonly stmtSearchNotes: VectorStmt<VectorSearchResult>
  private readonly stmtCountPages: VectorStmt<{ c: number }>
  private readonly stmtCountNotes: VectorStmt<{ c: number }>
  private readonly stmtDeletePagesByWorkspace: VectorStmt
  private readonly stmtDeleteNotesByWorkspace: VectorStmt
  private readonly upsertPageTxn: (page_id: string, workspace_id: string, buf: Buffer) => void
  private readonly upsertNoteTxn: (note_id: string, workspace_id: string, buf: Buffer) => void

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    this.stmtDeletePageById = this.db.prepare('DELETE FROM vec_pages WHERE page_id = ?')
    this.stmtInsertPage = this.db.prepare(
      'INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)'
    )
    this.stmtDeleteNoteById = this.db.prepare('DELETE FROM vec_notes WHERE note_id = ?')
    this.stmtInsertNote = this.db.prepare(
      'INSERT INTO vec_notes(note_id, workspace_id, embedding) VALUES (?, ?, ?)'
    )
    this.stmtSearchPages = this.db.prepare(
      `SELECT page_id AS id, workspace_id AS workspaceId, distance
       FROM vec_pages
       WHERE workspace_id = ? AND embedding MATCH ? AND k = ?
       ORDER BY distance`
    )
    this.stmtSearchNotes = this.db.prepare(
      `SELECT note_id AS id, workspace_id AS workspaceId, distance
       FROM vec_notes
       WHERE workspace_id = ? AND embedding MATCH ? AND k = ?
       ORDER BY distance`
    )
    this.stmtCountPages = this.db.prepare(
      'SELECT COUNT(*) AS c FROM vec_pages WHERE workspace_id = ?'
    )
    this.stmtCountNotes = this.db.prepare(
      'SELECT COUNT(*) AS c FROM vec_notes WHERE workspace_id = ?'
    )
    this.stmtDeletePagesByWorkspace = this.db.prepare(
      'DELETE FROM vec_pages WHERE workspace_id = ?'
    )
    this.stmtDeleteNotesByWorkspace = this.db.prepare(
      'DELETE FROM vec_notes WHERE workspace_id = ?'
    )
    // sqlite-vec 는 UPSERT 미지원 → DELETE + INSERT 를 단일 TX 로 묶음 (재임베딩 시점 atomic 보장)
    this.upsertPageTxn = this.db.transaction(
      (page_id: string, workspace_id: string, buf: Buffer): void => {
        this.stmtDeletePageById.run(page_id)
        this.stmtInsertPage.run(page_id, workspace_id, buf)
      }
    )
    this.upsertNoteTxn = this.db.transaction(
      (note_id: string, workspace_id: string, buf: Buffer): void => {
        this.stmtDeleteNoteById.run(note_id)
        this.stmtInsertNote.run(note_id, workspace_id, buf)
      }
    )
  }

  /**
   * 페이지 임베딩 UPSERT. 기존 page_id 행이 있으면 교체 (재임베딩).
   * 단일 TX — DELETE + INSERT atomic.
   */
  upsertPageEmbedding(pageId: string, workspaceId: string, embedding: EmbeddingInput): void {
    const buf = embeddingToBuffer(embedding)
    this.upsertPageTxn(pageId, workspaceId, buf)
  }

  /**
   * 노트 임베딩 UPSERT. 기존 note_id 행이 있으면 교체.
   */
  upsertNoteEmbedding(noteId: string, workspaceId: string, embedding: EmbeddingInput): void {
    const buf = embeddingToBuffer(embedding)
    this.upsertNoteTxn(noteId, workspaceId, buf)
  }

  /**
   * 특정 페이지 임베딩 단일 제거. 없으면 no-op.
   * 일반적으로 pages 테이블 DELETE → trigger (`pages_after_delete_vec_pages`) 가 자동 호출이지만,
   * 명시적 cleanup 도 가능 (예: 본문 dedupe 후 임베딩만 제거).
   */
  deletePageEmbedding(pageId: string): void {
    this.stmtDeletePageById.run(pageId)
  }

  /**
   * 특정 노트 임베딩 단일 제거.
   */
  deleteNoteEmbedding(noteId: string): void {
    this.stmtDeleteNoteById.run(noteId)
  }

  /**
   * 워크스페이스 단위 일괄 제거 — 워크스페이스 삭제와 별개로 명시적 reset 가능.
   * 일반적으로 workspaces CASCADE DELETE → pages CASCADE DELETE → trigger → vec_pages 정리가 우선.
   */
  deleteByWorkspace(workspaceId: string): { pages: number; notes: number } {
    const pages = this.stmtDeletePagesByWorkspace.run(workspaceId).changes
    const notes = this.stmtDeleteNotesByWorkspace.run(workspaceId).changes
    return { pages, notes }
  }

  /**
   * 페이지 top-k 검색 — 단일 워크스페이스 격리.
   * @param workspaceId — 검색 대상 partition. 다른 워크스페이스 누설 차단.
   * @param queryEmbedding — 질의 벡터 (1024 차원).
   * @param k — top-k. 1 이상.
   * @returns distance ASC 정렬된 결과.
   */
  searchPages(
    workspaceId: string,
    queryEmbedding: EmbeddingInput,
    k: number
  ): VectorSearchResult[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new Error(`VectorIndex.searchPages: k must be positive integer (got ${k})`)
    }
    const buf = embeddingToBuffer(queryEmbedding)
    return this.stmtSearchPages.all(workspaceId, buf, k)
  }

  /**
   * 노트 top-k 검색 — 단일 워크스페이스 격리.
   */
  searchNotes(
    workspaceId: string,
    queryEmbedding: EmbeddingInput,
    k: number
  ): VectorSearchResult[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new Error(`VectorIndex.searchNotes: k must be positive integer (got ${k})`)
    }
    const buf = embeddingToBuffer(queryEmbedding)
    return this.stmtSearchNotes.all(workspaceId, buf, k)
  }

  /** 워크스페이스 페이지 임베딩 개수. */
  countPages(workspaceId: string): number {
    return this.stmtCountPages.get(workspaceId)!.c
  }

  /** 워크스페이스 노트 임베딩 개수. */
  countNotes(workspaceId: string): number {
    return this.stmtCountNotes.get(workspaceId)!.c
  }
}
