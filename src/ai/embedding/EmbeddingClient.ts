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

import { ProviderError, type ProviderAdapter } from '../ProviderAdapter'
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
import type { ProviderType as CredentialProviderType } from '../../storage/Credentials'
import {
  resolveEmbeddingModel,
  embeddingProviderToCredentialProvider
} from '../../storage/embeddingModel'

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Sprint 018 M2 write-path wiring — "현재 처리 불가(환경)" 와 "영구 실패(데이터/계약)" 분리 (codex 019e6ea0 Q3).
 *
 * 다음 환경 문제에서만 throw — write-path worker 가 markFailed(영구) 대신 queue.release(→pending) 후 backoff:
 *   - provider 미등록 (providers Map 에 해당 credential type 없음 — API key 미설정 등)
 *   - provider.info.supportsEmbed=false 또는 embed 미구현
 *   - embed() 런타임이 ProviderError code ∈ {auth_invalid, network, rate_limit} (키 무효 / Ollama 미실행 / rate limit)
 *
 * 미지원 모델 id / orphan target / dimension mismatch / bad_request(예: Ollama 모델 미설치) / server_error 는
 * 본 에러가 아니라 일반 throw → markFailed (영구 실패). Ollama 모델 미설치 자동회복은 본 PR scope 밖 (codex C1).
 */
export class EmbeddingProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EmbeddingProviderUnavailableError'
  }
}

/** ProviderError.code 중 "사용자가 환경을 고치면 회복 가능" 한 것 (영구 실패 아님). */
const PROVIDER_UNAVAILABLE_CODES: ReadonlySet<ProviderError['code']> = new Set([
  'auth_invalid',
  'network',
  'rate_limit'
])

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
        `EmbeddingClient: provider ${this.provider.info.providerType} does not support embed ` +
          `(임베딩 지원 provider: OpenAIApiKeyProvider / OllamaProvider — Sprint 018 M2 T17c)`
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
    // ProviderError 중 환경 문제(키 무효 / 네트워크 / rate limit)는 EmbeddingProviderUnavailableError 로 래핑 —
    //   write-path worker 가 영구 failed 가 아니라 release(→pending) + backoff 로 자동 회복 (codex 019e6ea0 Q3/C1).
    //   query path 는 일반 Error 로 받아 동일하게 에러 메시지만 노출 (래핑이 message 보존 → 거동 불변).
    let resp: EmbedResponse
    try {
      resp = await this.provider.embed(req)
    } catch (err) {
      if (err instanceof ProviderError && PROVIDER_UNAVAILABLE_CODES.has(err.code)) {
        throw new EmbeddingProviderUnavailableError(err.message, { cause: err })
      }
      throw err
    }
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
    const source = parts.join('\n\n').trim()
    // embedPage 대칭 — whitespace-only selected_text + 빈 body 면 빈 문자열 임베딩 요청 차단.
    //   NoteStore.create 는 빈 문자열만 막고 whitespace('   ')는 통과시키므로(truthy), 여기서 방어
    //   (Sprint 018 M3 T22 gap-fill — embedPage 는 가드 있고 embedNote 는 부재하던 비대칭 해소).
    if (!source) {
      throw new Error(`EmbeddingClient.embedNote: empty selected_text + body (note_id=${note.id})`)
    }
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

export interface ResolvedEmbeddingClient {
  client: EmbeddingClient
  dimensions: number
}

/**
 * Sprint 018 M2 write-path wiring — 워크스페이스 embedding_model → EmbeddingClient + 차원 해소 (순수 함수).
 *
 * query path(searchHandlers.ts)와 동일 체인을 write-path 용으로 추출:
 *   1. resolveEmbeddingModel(modelId) — 미지원 id 는 throw (→ 영구 failed, silent fallback 금지)
 *   2. embeddingProviderToCredentialProvider(spec.provider) — namespace('openai'|'ollama') → credential type('openai'|'local')
 *   3. getProvider(credType) — 미등록(null) 또는 supportsEmbed=false → EmbeddingProviderUnavailableError (→ release/backoff)
 *   4. modelHint/dimensions 를 EmbeddingClient 에 주입 (임베딩이 워크스페이스 차원으로 생성, codex 019e6898 BLOCKING 정합)
 *
 * write-path worker(processNextEmbeddingJob)의 resolveEmbeddingClient deps 로 wiring (services.ts).
 * query path 는 graceful 에러 응답을 위해 별도 인라인 유지 (제어 흐름 차이 — 의도적 비대칭, G-013).
 */
export function buildEmbeddingClientForModel(
  modelId: string | null | undefined,
  getProvider: (credType: CredentialProviderType) => ProviderAdapter | null
): ResolvedEmbeddingClient {
  const spec = resolveEmbeddingModel(modelId)
  const credType = embeddingProviderToCredentialProvider(spec.provider)
  const provider = getProvider(credType)
  if (!provider) {
    throw new EmbeddingProviderUnavailableError(
      credType === 'openai'
        ? 'OpenAI API Key 가 등록되지 않아 임베딩을 생성할 수 없습니다. 설정에서 등록해 주세요.'
        : `로컬 임베딩 provider(${credType}) 가 초기화되지 않았습니다. Ollama 가 실행 중인지 확인해 주세요.`
    )
  }
  // ProviderAdapter 계약 — supportsEmbed=false 인데 embed() 가 throw 만 하는 구현 방어 (searchHandlers 정합).
  if (!provider.info.supportsEmbed || !provider.embed) {
    throw new EmbeddingProviderUnavailableError(
      `Provider ${provider.info.providerType} 는 임베딩을 지원하지 않습니다 ` +
        `(워크스페이스 임베딩 모델: ${spec.provider}:${spec.model}).`
    )
  }
  return {
    client: new EmbeddingClient({
      provider,
      modelHint: spec.model,
      dimensions: spec.dimensions
    }),
    dimensions: spec.dimensions
  }
}

export interface ProcessJobDeps {
  /**
   * Sprint 018 M2 T17b — 워크스페이스별 EmbeddingClient + dimension 해소 (Schema v06 spec §5.1).
   *
   * upsert write path 가 임베딩 생성 _전_에 워크스페이스 embedding_model 을 해소해 (codex 019e6898 BLOCKING):
   *   - `client` 는 해당 모델의 modelHint/dimensions 로 구성 (임베딩이 올바른 차원으로 생성)
   *   - `dimensions` 는 VectorIndex 테이블 선택 + 검증 기준 (client 와 동일 값)
   *
   * provider 어댑터 매핑(openai vs ollama)은 T17c 위임 — T17b 는 modelHint/dimensions threading 까지.
   * 생성된 vector 의 length 가 dimensions 와 불일치 시 VectorIndex 가 throw (silent corruption 차단 → markFailed).
   */
  resolveEmbeddingClient(workspaceId: string): { client: EmbeddingClient; dimensions: number }
  queue: EmbeddingQueue
  vectorIndex: VectorIndex
  pageStore: IndexedPageStoreSqlite
  noteStore: NoteStore
}

export interface ProcessJobResult {
  /**
   * - `idle`: 큐 비어 있음
   * - `succeeded`: 임베딩 생성 + upsert 성공
   * - `failed`: 영구 실패 (embed bad_request/server_error 등) — markFailed
   * - `orphan`: target(page/note) 미존재 — markFailed
   * - `provider_unavailable`: provider 환경 문제 (키 미설정 / Ollama 미실행 / rate limit) — release(→pending),
   *   markFailed 안 함. 호출자(worker)는 backoff 후 재시도 (codex 019e6ea0 Q3). queue status 가 아니라 처리 결과 분류.
   */
  status: 'idle' | 'succeeded' | 'failed' | 'orphan' | 'provider_unavailable'
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
      // 워크스페이스 embedding_model 을 임베딩 _전_에 해소 — client(modelHint/dimensions) + dim 동일 값.
      const { client, dimensions } = deps.resolveEmbeddingClient(page.workspace_id)
      const vector = await client.embedPage(page)
      deps.vectorIndex.upsertPageEmbedding(page.id, page.workspace_id, vector, dimensions)
    } else {
      const note = deps.noteStore.findById(job.target_id)
      if (!note) {
        const err = `note not found (id=${job.target_id})`
        deps.queue.markFailed(job.id, err)
        return { status: 'orphan', job, error: err }
      }
      const { client, dimensions } = deps.resolveEmbeddingClient(note.workspace_id)
      const vector = await client.embedNote(note)
      deps.vectorIndex.upsertNoteEmbedding(note.id, note.workspace_id, vector, dimensions)
    }
    deps.queue.markSucceeded(job.id)
    return { status: 'succeeded', job }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // provider 환경 문제(키 미설정 / Ollama 미실행 / rate limit) — 영구 failed 대신 pending 복귀 + backoff (codex 019e6ea0 Q3).
    //   사용자가 환경을 고치면 다음 drain 에서 자동 회복. release 는 in_progress 가드 — 이미 markFailed(orphan) 된 잡엔 no-op.
    if (err instanceof EmbeddingProviderUnavailableError) {
      deps.queue.release(job.id)
      return { status: 'provider_unavailable', job, error: message }
    }
    deps.queue.markFailed(job.id, message)
    return { status: 'failed', job, error: message }
  }
}
