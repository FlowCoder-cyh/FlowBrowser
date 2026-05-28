/**
 * Sprint 018 M2 T17b — embeddingModel 레지스트리 SSOT 단위 테스트.
 *
 * 레지스트리 ↔ v06.sql workspaces.embedding_model CHECK allowlist ↔ vec0 테이블 3자 일치 검증.
 */

import { describe, it, expect } from 'vitest'

import {
  EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_MODEL_ID,
  SUPPORTED_EMBEDDING_DIMENSIONS,
  isSupportedEmbeddingModel,
  parseEmbeddingModel,
  resolveEmbeddingDimensions,
  embeddingProviderToCredentialProvider
} from '../../../src/storage/embeddingModel'
import { selectVecPagesTable, selectVecNotesTable } from '../../../src/storage/VectorIndex'

describe('embeddingModel 레지스트리', () => {
  it('디폴트 모델 = OpenAI 1024 (v06.sql workspaces DEFAULT 와 일치)', () => {
    expect(DEFAULT_EMBEDDING_MODEL_ID).toBe('openai:text-embedding-3-small:1024')
    expect(EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID].dimensions).toBe(1024)
    expect(EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID].provider).toBe('openai')
  })

  it('지원 범위 = 1024 / 768 (CHECK allowlist 2종)', () => {
    expect(Object.keys(EMBEDDING_MODELS).sort()).toEqual([
      'ollama:nomic-embed-text:768',
      'openai:text-embedding-3-small:1024'
    ])
    expect([...SUPPORTED_EMBEDDING_DIMENSIONS].sort((a, b) => a - b)).toEqual([768, 1024])
  })

  it('레지스트리 각 모델의 dimension 이 vec0 테이블 allowlist 와 정합 (3자 일치)', () => {
    for (const [, spec] of Object.entries(EMBEDDING_MODELS)) {
      // 각 모델 차원이 SUPPORTED 에 포함 + selectVec*Table 가 throw 없이 매핑.
      expect(SUPPORTED_EMBEDDING_DIMENSIONS).toContain(spec.dimensions)
      expect(selectVecPagesTable(spec.dimensions)).toBe(`vec_pages_${spec.dimensions}`)
      expect(selectVecNotesTable(spec.dimensions)).toBe(`vec_notes_${spec.dimensions}`)
    }
  })

  it('parseEmbeddingModel — 지원 id 파싱', () => {
    expect(parseEmbeddingModel('ollama:nomic-embed-text:768')).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768
    })
  })

  it('parseEmbeddingModel — 미지원 id throw (silent fallback 금지)', () => {
    expect(() => parseEmbeddingModel('openai:text-embedding-3-large:3072')).toThrow(
      /Unsupported embedding model/
    )
    expect(() => parseEmbeddingModel('')).toThrow(/Unsupported embedding model/)
  })

  it('isSupportedEmbeddingModel — type guard', () => {
    expect(isSupportedEmbeddingModel('openai:text-embedding-3-small:1024')).toBe(true)
    expect(isSupportedEmbeddingModel('foo:bar:1')).toBe(false)
  })

  it('resolveEmbeddingDimensions — null/undefined → 디폴트 1024 (v05 컬럼 부재 호환)', () => {
    expect(resolveEmbeddingDimensions(null)).toBe(1024)
    expect(resolveEmbeddingDimensions(undefined)).toBe(1024)
    expect(resolveEmbeddingDimensions('')).toBe(1024)
  })

  it('resolveEmbeddingDimensions — 지원 id → 해당 차원 / 미지원 → throw', () => {
    expect(resolveEmbeddingDimensions('openai:text-embedding-3-small:1024')).toBe(1024)
    expect(resolveEmbeddingDimensions('ollama:nomic-embed-text:768')).toBe(768)
    expect(() => resolveEmbeddingDimensions('mystery:model:512')).toThrow(
      /Unsupported embedding model/
    )
  })
})

describe('Sprint 018 M2 T17c — embeddingProviderToCredentialProvider', () => {
  it("'openai' namespace → 'openai' credential type", () => {
    expect(embeddingProviderToCredentialProvider('openai')).toBe('openai')
  })

  it("'ollama' namespace → 'local' credential type (OllamaProvider 가 providers.set('local'))", () => {
    expect(embeddingProviderToCredentialProvider('ollama')).toBe('local')
  })

  it('레지스트리 모든 모델의 provider namespace 가 매핑 가능 (4자 일치 — registry ↔ credential)', () => {
    for (const [, spec] of Object.entries(EMBEDDING_MODELS)) {
      const credential = embeddingProviderToCredentialProvider(spec.provider)
      expect(['openai', 'local']).toContain(credential)
    }
  })
})
