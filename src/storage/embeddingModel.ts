/**
 * Sprint 018 M2 T17b — 임베딩 모델 레지스트리 (SSOT).
 *
 * `workspaces.embedding_model` 컬럼 값(`'<provider>:<model>:<dim>'` full id)을 풀어
 * provider / model / dimensions 로 매핑하는 단일 출처. Schema v06 spec §2~§3 (B3+B2 결정) 정합.
 *
 * **불변식 (codex 019e653c BLOCKING)**: 본 레지스트리 키 ↔ `v06.sql` workspaces.embedding_model CHECK
 * allowlist ↔ `VectorIndex` vec0 테이블(`vec_pages_{dim}`/`vec_notes_{dim}`) 3자 일치 강제.
 * 신규 모델 추가 시: 본 레지스트리 + CHECK + vec0 테이블 + UX(T17d) 동반 변경 필수.
 *
 * dimension invariant 책임 경계 (codex 019e50ec NOTABLE #3): DB-level 강제는 불가 —
 * write path(`EmbeddingClient.processNextEmbeddingJob`) / query path(`searchHandlers`) / import / reindex /
 * 회귀 셋이 강제. 본 헬퍼는 그 write/query path 가 dim 을 해소하는 단일 진입점.
 */

/** v06 범위 = OpenAI 1024 / Ollama 768 고정 (codex 019e653c — DB CHECK ↔ vec0 테이블 ↔ UX 3자 일치). */
export interface EmbeddingModelSpec {
  /** 임베딩 provider 네임스페이스 (credential provider type 과 별개 — T17c 가 'ollama' → local provider 매핑). */
  provider: 'openai' | 'ollama'
  /** provider 별 모델 식별자 (EmbeddingClient.modelHint 로 전달). */
  model: string
  /** 임베딩 차원 (vec0 테이블 선택 + 벡터 검증 기준). */
  dimensions: 1024 | 768
}

/**
 * 지원 임베딩 모델 레지스트리. 키는 `workspaces.embedding_model` full id.
 * **v06.sql workspaces CHECK allowlist 와 정확히 일치해야 함** (drift 시 마이그레이션 회귀 drift-check 실패).
 */
export const EMBEDDING_MODELS = {
  'openai:text-embedding-3-small:1024': {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1024
  },
  'ollama:nomic-embed-text:768': {
    provider: 'ollama',
    model: 'nomic-embed-text',
    dimensions: 768
  }
} as const satisfies Record<string, EmbeddingModelSpec>

export type EmbeddingModelId = keyof typeof EMBEDDING_MODELS

/** 디폴트 임베딩 모델 id — workspaces.embedding_model DEFAULT 와 일치 (v06.sql §3.1). */
export const DEFAULT_EMBEDDING_MODEL_ID: EmbeddingModelId = 'openai:text-embedding-3-small:1024'

/** 지원 임베딩 차원 — vec0 테이블 분리 기준 (1024 = OpenAI / 768 = Ollama). */
export const SUPPORTED_EMBEDDING_DIMENSIONS = [1024, 768] as const
export type SupportedEmbeddingDimension = (typeof SUPPORTED_EMBEDDING_DIMENSIONS)[number]

/** full id 가 레지스트리에 존재하는 지원 모델인지. */
export function isSupportedEmbeddingModel(id: string): id is EmbeddingModelId {
  return Object.prototype.hasOwnProperty.call(EMBEDDING_MODELS, id)
}

/**
 * full id → {provider, model, dimensions}. 미지원 id 는 throw (조용한 fallback 금지 — silent corruption 차단).
 */
export function parseEmbeddingModel(id: string): EmbeddingModelSpec {
  if (!isSupportedEmbeddingModel(id)) {
    throw new Error(
      `Unsupported embedding model: ${id} (지원: ${Object.keys(EMBEDDING_MODELS).join(', ')})`
    )
  }
  return EMBEDDING_MODELS[id]
}

/**
 * 워크스페이스 embedding_model → 임베딩 spec (provider/model/dimensions).
 *
 * null/undefined (v05 호환 — 컬럼 부재 시 Database 접근자가 DEFAULT 채움) 시 디폴트 모델(OpenAI 1024) spec.
 * 비어 있지 않은 미지원 id 는 throw (외부 변형 / 미래 모델 — write/query path 에서 명시 실패).
 *
 * **호출 시점 (codex 019e6898 BLOCKING)**: query/upsert path 는 _임베딩 생성 전_에 본 함수로 spec 을 해소해
 * EmbeddingClient 의 `modelHint`/`dimensions` 와 VectorIndex 의 dim 에 **같은 값**을 넘겨야 한다.
 * 임베딩을 먼저 만든 뒤 dim 만 해소하면 (테이블 선택만 되고 임베딩 차원은 디폴트 1024 고정) 분기가 cosmetic 이 된다.
 */
export function resolveEmbeddingModel(modelId: string | null | undefined): EmbeddingModelSpec {
  if (!modelId) return EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID]
  return parseEmbeddingModel(modelId)
}

/**
 * 워크스페이스 embedding_model → 임베딩 차원 (`resolveEmbeddingModel(...).dimensions` 단축).
 */
export function resolveEmbeddingDimensions(modelId: string | null | undefined): SupportedEmbeddingDimension {
  return resolveEmbeddingModel(modelId).dimensions
}
