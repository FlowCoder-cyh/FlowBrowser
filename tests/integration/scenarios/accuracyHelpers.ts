/**
 * Sprint 016 M0 T06 — 정확도 회귀 산식 헬퍼 (KI-018 top-10 hit rate / KI-019 AI 출처 정확도).
 *
 * 본 헬퍼는 시나리오 회귀 셋이 정확도 측정 시 일관된 산식을 사용하도록 강제.
 * Sprint 016 contract §6 매트릭스 #3 + #6 정합.
 *
 * 본 헬퍼는 산식 자체 (cover 30 시나리오 케이스 일부는 T07~T08 시점에 적용).
 */

/** 검색 결과 한 페어 — 정답 (expected) + retrieval 결과 (returnedTopK). */
export interface RetrievalPair {
  /** 정답 page id (들). 여러 개면 "any-hit" 으로 판정. */
  expected: string[]
  /** 검색 결과 (score 내림차순). page_id 만. */
  returnedTopK: string[]
}

/**
 * KI-018 top-10 hit rate — top-10 안에 정답이 포함된 비율.
 *
 * 산식:
 *   hit_rate = sum(any(expected ∈ returnedTopK[:k])) / N
 *
 * @param pairs — 회귀 셋 (각 케이스 expected + returnedTopK)
 * @param k — top-K (PRD §9.7 디폴트 10)
 * @returns hit rate [0, 1]
 */
export function topKHitRate(pairs: RetrievalPair[], k = 10): number {
  if (pairs.length === 0) return 0
  let hits = 0
  for (const p of pairs) {
    const slice = p.returnedTopK.slice(0, k)
    if (p.expected.some((e) => slice.includes(e))) hits += 1
  }
  return hits / pairs.length
}

/** AI 채팅 한 응답 — sources (chat_meta.cells.sources) + retrieved_items 의 page_id 집합. */
export interface AiSourcesPair {
  /** AI 응답 chat_meta.cells.sources — page_id 들 */
  citedSources: string[]
  /** retrieval 결과 page_id 들 (실제 컨텍스트 셋) */
  retrievedItems: string[]
}

/**
 * KI-019 AI 출처 정확도 — citedSources 가 retrievedItems 에 속하는 비율 (per source).
 *
 * 산식 (per response):
 *   precision = |citedSources ∩ retrievedItems| / |citedSources|
 *
 * 전체 (회귀 셋 평균):
 *   mean(precision_i)
 *
 * 본 산식은 hallucination 검출 — sources 가 retrieved 외 출처를 인용하면 hallucination.
 *
 * @param pairs — 회귀 셋
 * @returns mean precision [0, 1]. citedSources 0 케이스는 평균에서 제외 (응답에 sources 없는 케이스).
 */
export function aiSourcesPrecision(pairs: AiSourcesPair[]): number {
  if (pairs.length === 0) return 0
  let denom = 0
  let sum = 0
  for (const p of pairs) {
    if (p.citedSources.length === 0) continue
    const retSet = new Set(p.retrievedItems)
    const hit = p.citedSources.filter((c) => retSet.has(c)).length
    sum += hit / p.citedSources.length
    denom += 1
  }
  return denom === 0 ? 0 : sum / denom
}

/** KI-018 임계 (PRD §15.4 #3) */
export const TOP_K_HIT_RATE_THRESHOLD = 0.8

/** KI-019 임계 (PRD §15.4 #6) */
export const AI_SOURCES_PRECISION_THRESHOLD = 0.9
