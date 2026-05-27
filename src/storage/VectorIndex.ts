/**
 * Sprint 015 M3-2 — VectorIndex (sqlite-vec wrapper).
 *   Sprint 018 M2 T17b — dimension 별 vec0 테이블 분기 (Schema v06 spec §3.2/§5).
 *
 * 책임:
 *   - vec_pages_{dim} / vec_notes_{dim} 가상 테이블 CRUD wrapper (v06: 1024 + 768 분리)
 *   - workspace_id partition 강제 (top-k 검색 시 다른 워크스페이스 누설 차단)
 *   - Float32Array ↔ Buffer 변환 + 차원 검증 (dim 별)
 *   - upsert 시멘틱 (DELETE + INSERT 단일 TX) — sqlite-vec 는 native UPSERT 미지원
 *   - 비-vec 테이블 (pages / notes) 와의 cascade 정합 → v06.sql AFTER DELETE 트리거(_1024+_768) 활용
 *
 * dimension 분기 (Schema v06 spec §5):
 *   - upsert / search 는 호출자(write/query path)가 워크스페이스 embedding_model 로 해소한 `dimensions` 전달.
 *     vec0 테이블 명은 prepared statement bind 불가(identifier) → `selectVecPagesTable` closed allowlist 강제.
 *   - has / delete / deleteByWorkspace / count 는 dimension-agnostic — 한 페이지/노트는 워크스페이스의 단일
 *     dimension 테이블에만 존재하므로 두 테이블 모두 대상으로 해도 안전 (호출자 dim 해소 불필요).
 *
 * 입력 결정:
 *   - 차원 1024 (OpenAI text-embedding-3-small) / 768 (Ollama nomic-embed-text) (PRD §04.3.8 + Schema v06 spec §2)
 *   - partition key: TEXT workspace_id (m3-spike-decisions §3.3)
 *   - distance: cosine (vec0 명시 — EmbeddingClient 가 정규화 강제 권고)
 */

import type BetterSqliteNamespace from 'better-sqlite3'
import type { Database as BetterDatabase } from 'better-sqlite3'
import type { FlowbrowserDatabase } from './Database'
import {
  SUPPORTED_EMBEDDING_DIMENSIONS,
  type SupportedEmbeddingDimension
} from './embeddingModel'

// better-sqlite3 12.x types: Statement<BindParameters extends unknown[], Result>.
// 본 모듈은 다양한 arg 시그니처를 위해 BindParameters=unknown[] 기본형으로 박힘.
type VectorStmt<R = unknown> = BetterSqliteNamespace.Statement<unknown[], R>

/**
 * 기본 임베딩 차원 — OpenAI text-embedding-3-small `dimensions=1024` 정합 (디폴트 모델).
 * 후방 호환: `embeddingToBuffer` 기본 인자 / SearchService 기본 dimension.
 * dimension 별 분기는 `SUPPORTED_EMBEDDING_DIMENSIONS` (embeddingModel.ts) 참조.
 */
export const EMBEDDING_DIMENSIONS = 1024

/** dimension → vec_pages_{dim} 테이블 명 (closed allowlist — SQL identifier injection 차단). */
const VEC_PAGES_TABLES: Record<number, 'vec_pages_1024' | 'vec_pages_768'> = {
  1024: 'vec_pages_1024',
  768: 'vec_pages_768'
}
/** dimension → vec_notes_{dim} 테이블 명 (closed allowlist). */
const VEC_NOTES_TABLES: Record<number, 'vec_notes_1024' | 'vec_notes_768'> = {
  1024: 'vec_notes_1024',
  768: 'vec_notes_768'
}

/**
 * dimension → vec_pages 테이블 명 (Schema v06 spec §5.1 closed allowlist).
 * vec0 테이블 명은 prepared statement bind 불가 (identifier) → 동적 사용 시 반드시 본 allowlist 경유.
 * `vec_pages_${userInput}` 직접 보간 절대 금지.
 */
export function selectVecPagesTable(dim: number): 'vec_pages_1024' | 'vec_pages_768' {
  const table = VEC_PAGES_TABLES[dim]
  if (!table) throw new Error(`Unsupported embedding dimension: ${dim} (지원: 1024, 768)`)
  return table
}

/** dimension → vec_notes 테이블 명 (검색/upsert 경로 공용 — Schema v06 spec §5.2). */
export function selectVecNotesTable(dim: number): 'vec_notes_1024' | 'vec_notes_768' {
  const table = VEC_NOTES_TABLES[dim]
  if (!table) throw new Error(`Unsupported embedding dimension: ${dim} (지원: 1024, 768)`)
  return table
}

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
 * @param dim 기대 차원 (디폴트 1024). 호출자가 워크스페이스 embedding_model 로 해소한 값 전달.
 */
export function embeddingToBuffer(
  embedding: EmbeddingInput,
  dim: number = EMBEDDING_DIMENSIONS
): Buffer {
  const arr = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding)
  if (arr.length !== dim) {
    throw new Error(
      `VectorIndex: embedding dimension mismatch (expected ${dim}, got ${arr.length})`
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
 * VectorIndex — sqlite-vec wrapper (v06 dimension 분기).
 *
 * 사용:
 *   const vec = new VectorIndex(db)  // db 는 v06 schema (vec_pages_1024/768 + vec_notes_1024/768)
 *   vec.upsertPageEmbedding(pageId, workspaceId, embedding, 1024)
 *   const results = vec.searchPages(workspaceId, queryEmbedding, 5, 1024)
 */
export class VectorIndex {
  private readonly db: BetterDatabase

  // dimension 별 prepared statement (성능 — 4 테이블 1024/768 × pages/notes).
  private readonly insertPageByDim: Record<number, VectorStmt> = {}
  private readonly deletePageByIdByDim: Record<number, VectorStmt> = {}
  private readonly searchPagesByDim: Record<number, VectorStmt<VectorSearchResult>> = {}
  private readonly countPagesByDim: Record<number, VectorStmt<{ c: number }>> = {}
  private readonly hasPageByDim: Record<number, VectorStmt<{ x: number }>> = {}
  private readonly deletePagesByWorkspaceByDim: Record<number, VectorStmt> = {}
  private readonly insertNoteByDim: Record<number, VectorStmt> = {}
  private readonly deleteNoteByIdByDim: Record<number, VectorStmt> = {}
  private readonly searchNotesByDim: Record<number, VectorStmt<VectorSearchResult>> = {}
  private readonly countNotesByDim: Record<number, VectorStmt<{ c: number }>> = {}
  private readonly deleteNotesByWorkspaceByDim: Record<number, VectorStmt> = {}
  private readonly upsertPageTxnByDim: Record<
    number,
    (page_id: string, workspace_id: string, buf: Buffer) => void
  > = {}
  private readonly upsertNoteTxnByDim: Record<
    number,
    (note_id: string, workspace_id: string, buf: Buffer) => void
  > = {}

  constructor(fb: FlowbrowserDatabase) {
    this.db = fb.getDb()
    // 모든 지원 dimension 테이블에 대해 prepared statement 컴파일.
    // 테이블 명은 closed allowlist(selectVec*Table) 산출 → identifier injection 무관.
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      const pt = selectVecPagesTable(dim)
      const nt = selectVecNotesTable(dim)
      this.insertPageByDim[dim] = this.db.prepare(
        `INSERT INTO ${pt}(page_id, workspace_id, embedding) VALUES (?, ?, ?)`
      )
      this.deletePageByIdByDim[dim] = this.db.prepare(`DELETE FROM ${pt} WHERE page_id = ?`)
      this.searchPagesByDim[dim] = this.db.prepare(
        `SELECT page_id AS id, workspace_id AS workspaceId, distance
         FROM ${pt}
         WHERE workspace_id = ? AND embedding MATCH ? AND k = ?
         ORDER BY distance`
      )
      this.countPagesByDim[dim] = this.db.prepare(
        `SELECT COUNT(*) AS c FROM ${pt} WHERE workspace_id = ?`
      )
      this.hasPageByDim[dim] = this.db.prepare(
        `SELECT 1 AS x FROM ${pt} WHERE page_id = ? LIMIT 1`
      )
      this.deletePagesByWorkspaceByDim[dim] = this.db.prepare(
        `DELETE FROM ${pt} WHERE workspace_id = ?`
      )
      this.insertNoteByDim[dim] = this.db.prepare(
        `INSERT INTO ${nt}(note_id, workspace_id, embedding) VALUES (?, ?, ?)`
      )
      this.deleteNoteByIdByDim[dim] = this.db.prepare(`DELETE FROM ${nt} WHERE note_id = ?`)
      this.searchNotesByDim[dim] = this.db.prepare(
        `SELECT note_id AS id, workspace_id AS workspaceId, distance
         FROM ${nt}
         WHERE workspace_id = ? AND embedding MATCH ? AND k = ?
         ORDER BY distance`
      )
      this.countNotesByDim[dim] = this.db.prepare(
        `SELECT COUNT(*) AS c FROM ${nt} WHERE workspace_id = ?`
      )
      this.deleteNotesByWorkspaceByDim[dim] = this.db.prepare(
        `DELETE FROM ${nt} WHERE workspace_id = ?`
      )
      // sqlite-vec 는 UPSERT 미지원 → DELETE + INSERT 단일 TX (재임베딩 atomic).
      //   codex 019e6898 NEEDS_CHANGES — DELETE 는 **모든 dimension 테이블** 대상 (cross-dim cleanup).
      //   같은 page_id 가 과거/수동/미래 reindex 로 1024·768 양쪽에 남는 오염을 upsert 가 정리 (write-path invariant).
      const insertPage = this.insertPageByDim[dim]
      this.upsertPageTxnByDim[dim] = this.db.transaction(
        (page_id: string, workspace_id: string, buf: Buffer): void => {
          for (const dd of SUPPORTED_EMBEDDING_DIMENSIONS) this.deletePageByIdByDim[dd].run(page_id)
          insertPage.run(page_id, workspace_id, buf)
        }
      )
      const insertNote = this.insertNoteByDim[dim]
      this.upsertNoteTxnByDim[dim] = this.db.transaction(
        (note_id: string, workspace_id: string, buf: Buffer): void => {
          for (const dd of SUPPORTED_EMBEDDING_DIMENSIONS) this.deleteNoteByIdByDim[dd].run(note_id)
          insertNote.run(note_id, workspace_id, buf)
        }
      )
    }
  }

  /** dim 이 지원 범위인지 검증 후 SupportedEmbeddingDimension narrow. */
  private assertDim(dim: number): SupportedEmbeddingDimension {
    if (!(dim in this.insertPageByDim)) {
      throw new Error(`VectorIndex: unsupported embedding dimension ${dim} (지원: 1024, 768)`)
    }
    return dim as SupportedEmbeddingDimension
  }

  /**
   * 페이지 임베딩 UPSERT (dimension 별 테이블). 기존 page_id 행이 있으면 교체 (재임베딩).
   * @param dim 워크스페이스 embedding_model 차원 — 호출자(EmbeddingClient.processNextEmbeddingJob)가 해소.
   */
  upsertPageEmbedding(
    pageId: string,
    workspaceId: string,
    embedding: EmbeddingInput,
    dim: number
  ): void {
    const d = this.assertDim(dim)
    const buf = embeddingToBuffer(embedding, d)
    this.upsertPageTxnByDim[d](pageId, workspaceId, buf)
  }

  /**
   * 노트 임베딩 UPSERT (dimension 별 테이블). 기존 note_id 행이 있으면 교체.
   */
  upsertNoteEmbedding(
    noteId: string,
    workspaceId: string,
    embedding: EmbeddingInput,
    dim: number
  ): void {
    const d = this.assertDim(dim)
    const buf = embeddingToBuffer(embedding, d)
    this.upsertNoteTxnByDim[d](noteId, workspaceId, buf)
  }

  /**
   * Sprint 016 M0 T02-followup (KI-006) — 페이지 vector 존재 여부 (dimension-agnostic).
   *
   * 한 페이지는 워크스페이스 단일 dimension 테이블에만 존재 → 두 테이블 모두 검사해도 정확.
   * IndexingService unchanged 분기의 임베딩 누락 회복 판단에 사용 (dim 해소 불필요 — branching owner 아님).
   */
  hasPageEmbedding(pageId: string): boolean {
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      if (this.hasPageByDim[dim].get(pageId) !== undefined) return true
    }
    return false
  }

  /**
   * 특정 페이지 임베딩 제거 (dimension-agnostic — 두 테이블 모두).
   * 일반적으로 pages 테이블 DELETE → 트리거(`pages_after_delete_vec_pages_v06`)가 자동 호출이나, 명시 cleanup 도 가능.
   */
  deletePageEmbedding(pageId: string): void {
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      this.deletePageByIdByDim[dim].run(pageId)
    }
  }

  /**
   * 특정 노트 임베딩 제거 (dimension-agnostic).
   */
  deleteNoteEmbedding(noteId: string): void {
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      this.deleteNoteByIdByDim[dim].run(noteId)
    }
  }

  /**
   * 워크스페이스 단위 일괄 제거 (dimension-agnostic — 4 테이블 전부).
   * 일반적으로 workspaces CASCADE → pages/notes CASCADE → 트리거 정리가 우선. 명시 reset 경로.
   */
  deleteByWorkspace(workspaceId: string): { pages: number; notes: number } {
    let pages = 0
    let notes = 0
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      pages += this.deletePagesByWorkspaceByDim[dim].run(workspaceId).changes
      notes += this.deleteNotesByWorkspaceByDim[dim].run(workspaceId).changes
    }
    return { pages, notes }
  }

  /**
   * 페이지 top-k 검색 — 단일 워크스페이스 격리 + dimension 별 테이블.
   * @param dim 워크스페이스 embedding_model 차원 — 호출자(searchHandlers → SearchService)가 해소.
   */
  searchPages(
    workspaceId: string,
    queryEmbedding: EmbeddingInput,
    k: number,
    dim: number
  ): VectorSearchResult[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new Error(`VectorIndex.searchPages: k must be positive integer (got ${k})`)
    }
    const d = this.assertDim(dim)
    const buf = embeddingToBuffer(queryEmbedding, d)
    return this.searchPagesByDim[d].all(workspaceId, buf, k)
  }

  /**
   * 노트 top-k 검색 — 단일 워크스페이스 격리 + dimension 별 테이블.
   */
  searchNotes(
    workspaceId: string,
    queryEmbedding: EmbeddingInput,
    k: number,
    dim: number
  ): VectorSearchResult[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new Error(`VectorIndex.searchNotes: k must be positive integer (got ${k})`)
    }
    const d = this.assertDim(dim)
    const buf = embeddingToBuffer(queryEmbedding, d)
    return this.searchNotesByDim[d].all(workspaceId, buf, k)
  }

  /** 워크스페이스 페이지 임베딩 개수 (dimension-agnostic — 두 테이블 합). */
  countPages(workspaceId: string): number {
    let c = 0
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      c += this.countPagesByDim[dim].get(workspaceId)!.c
    }
    return c
  }

  /** 워크스페이스 노트 임베딩 개수 (dimension-agnostic — 두 테이블 합). */
  countNotes(workspaceId: string): number {
    let c = 0
    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      c += this.countNotesByDim[dim].get(workspaceId)!.c
    }
    return c
  }
}
