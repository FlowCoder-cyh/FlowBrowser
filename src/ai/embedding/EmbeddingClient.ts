/**
 * Sprint 015 M3-5 — EmbeddingClient + Queue 처리 파이프라인.
 *
 * 책임:
 *   - ProviderAdapter.embed() wrapper — text-embedding-3-small 1024 차원 디폴트 (PRD §08 + §15)
 *   - BYOK 디폴트 (OpenAIApiKeyProvider) — Codex OAuth 임베딩 미지원 (M2-7 결정)
 *   - 차원 검증 (EMBEDDING_DIMENSIONS=1024) — silent corruption 차단
 *   - 비용 추정 통과 (provider 가 EmbedResponse.estimatedCostUsd 산정 — PRD §15 임계 측정 입력)
 *   - processQueueJob — Queue claim → 본문 조회 → embed → VectorIndex upsert → markSucceeded/Failed (단일 잡 파이프라인)
 *
 * 후속 PR 의존:
 *   - M3-6 migrations — Glossary → Note + 본 client 로 임베딩 일괄 enqueue
 *   - M4 IndexingService — 인덱싱 hook 에서 enqueue + 본 client 로 백그라운드 처리
 *   - M5 SearchService — 질의 임베딩 호출 (단발) + VectorIndex.searchPages
 */

import type { ProviderAdapter } from '../ProviderAdapter'
import type { EmbedRequest, EmbedResponse } from '../types'
import {
  EMBEDDING_DIMENSIONS,
  VectorIndex,
  type EmbeddingInput
} from '../../storage/VectorIndex'
import type { EmbeddingQueue, EmbeddingJobRow } from '../../storage/EmbeddingQueue'
import type { IndexedPageStoreSqlite } from '../../storage/IndexedPageStoreSqlite'
import type { NoteStore, NoteRow } from '../../storage/NoteStore'
import type { Page } from '../../storage/IndexedPageStore'

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

export interface EmbeddingClientOptions {
  provider: ProviderAdapter
  /** 디폴트 1024 (EMBEDDING_DIMENSIONS). provider 가 dimensions 변경 지원 시 override 가능. */
  dimensions?: number
  /** 디폴트 'text-embedding-3-small'. */
  modelHint?: string
}

export interface EmbedTextsResult {
  vectors: Float32Array[]
  modelUsed: string
  inputTokens: number
  estimatedCostUsd: number
  durationMs: number
}

export class EmbeddingClient {
  private readonly provider: ProviderAdapter
  private readonly dimensions: number
  private readonly modelHint: string

  constructor(opts: EmbeddingClientOptions) {
    this.provider = opts.provider
    this.dimensions = opts.dimensions ?? EMBEDDING_DIMENSIONS
    this.modelHint = opts.modelHint ?? DEFAULT_EMBEDDING_MODEL
  }

  /**
   * batch embed. provider.embed() 호출 → 차원 검증 → Float32Array 변환.
   */
  async embedTexts(texts: string[]): Promise<EmbedTextsResult> {
    if (!this.provider.embed) {
      throw new Error(
        `EmbeddingClient: provider ${this.provider.info.providerType} does not support embed (PRD §08 BYOK OpenAI 디폴트)`
      )
    }
    if (texts.length === 0) {
      throw new Error('EmbeddingClient.embedTexts: at least 1 text required')
    }
    const req: EmbedRequest = {
      texts,
      modelHint: this.modelHint,
      dimensions: this.dimensions
    }
    const resp: EmbedResponse = await this.provider.embed(req)
    if (resp.vectors.length !== texts.length) {
      throw new Error(
        `EmbeddingClient: provider returned ${resp.vectors.length} vectors for ${texts.length} texts`
      )
    }
    const vectors = resp.vectors.map((v, idx) => this.toFloat32(v, idx))
    return {
      vectors,
      modelUsed: resp.modelUsed,
      inputTokens: resp.inputTokens,
      estimatedCostUsd: resp.estimatedCostUsd,
      durationMs: resp.durationMs
    }
  }

  /** 단일 텍스트 편의 메서드. */
  async embedText(text: string): Promise<{ vector: Float32Array } & Omit<EmbedTextsResult, 'vectors'>> {
    const { vectors, ...rest } = await this.embedTexts([text])
    return { vector: vectors[0], ...rest }
  }

  /**
   * Page 임베딩 — 본문 (content) 우선, 빈 본문 시 title fallback.
   * 빈 입력은 fail (Queue 의 markFailed 로 잡 처리).
   */
  async embedPage(page: Page): Promise<EmbeddingInput> {
    const source = page.content?.trim() || page.title?.trim() || ''
    if (!source) {
      throw new Error(`EmbeddingClient.embedPage: empty content + title (page_id=${page.id})`)
    }
    const { vector } = await this.embedText(source)
    return vector
  }

  /**
   * Note 임베딩 — selected_text + body (있으면) 연결.
   */
  async embedNote(note: NoteRow): Promise<EmbeddingInput> {
    const parts = [note.selected_text.trim()]
    if (note.body && note.body.trim()) parts.push(note.body.trim())
    const source = parts.join('\n\n')
    const { vector } = await this.embedText(source)
    return vector
  }

  private toFloat32(v: number[], idx: number): Float32Array {
    if (!Array.isArray(v) || v.length !== this.dimensions) {
      throw new Error(
        `EmbeddingClient: vector ${idx} dimension mismatch (expected ${this.dimensions}, got ${v?.length})`
      )
    }
    return Float32Array.from(v)
  }
}

export interface ProcessJobDeps {
  client: EmbeddingClient
  queue: EmbeddingQueue
  vectorIndex: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
}

export interface ProcessJobResult {
  status: 'idle' | 'succeeded' | 'failed' | 'orphan'
  job?: EmbeddingJobRow
  error?: string
}

/**
 * Queue 의 다음 잡 1건 처리 — Queue claim → target 본문 조회 → embed → VectorIndex upsert → markSucceeded/Failed.
 *
 * 호출자 (M4 IndexingService / 백그라운드 워커) 는 본 함수를 반복 호출 (status='idle' 시 대기).
 *
 * 정책:
 *   - target 본문 미존재 (page/note 삭제됨) → markFailed + 'orphan' 반환 (호출자가 cancel 권고)
 *   - embed 호출 실패 → markFailed + 'failed' 반환 (호출자가 backoff/재 enqueue 결정)
 *   - 성공 → markSucceeded + 'succeeded'
 *   - 빈 큐 → 'idle'
 */
export async function processNextEmbeddingJob(deps: ProcessJobDeps): Promise<ProcessJobResult> {
  const job = deps.queue.claimNext()
  if (!job) return { status: 'idle' }
  try {
    if (job.target_type === 'page') {
      const page = deps.pageStore.getPage(job.target_id)
      if (!page) {
        const err = `page not found (id=${job.target_id})`
        deps.queue.markFailed(job.id, err)
        return { status: 'orphan', job, error: err }
      }
      const vector = await deps.client.embedPage(page)
      deps.vectorIndex.upsertPageEmbedding(page.id, page.workspace_id, vector)
    } else {
      const note = deps.noteStore.findById(job.target_id)
      if (!note) {
        const err = `note not found (id=${job.target_id})`
        deps.queue.markFailed(job.id, err)
        return { status: 'orphan', job, error: err }
      }
      const vector = await deps.client.embedNote(note)
      deps.vectorIndex.upsertNoteEmbedding(note.id, note.workspace_id, vector)
    }
    deps.queue.markSucceeded(job.id)
    return { status: 'succeeded', job }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.queue.markFailed(job.id, message)
    return { status: 'failed', job, error: message }
  }
}
