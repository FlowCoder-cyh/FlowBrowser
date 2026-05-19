/**
 * Sprint 016 M0 T06 — KI-015 임베딩 비용 산식 헬퍼.
 *
 * PRD §15.2 — OpenAI text-embedding-3-small 단가 $0.00002 / 1K tokens.
 * 본 헬퍼는 .bench / .test 양쪽에서 import. 회귀 강제는 tests/unit/perf/embeddingCost.test.ts 가 expect.
 */

export const OPENAI_TEXT_EMBEDDING_3_SMALL_USD_PER_1K_TOKENS = 0.00002 // PRD §15.2
export const ASSUMED_TOKENS_PER_PAGE = 1000 // PRD §15.2 (4KB 본문 / 4 chars-per-token)
export const TARGET_MONTHLY_PAGES = 10_000
export const MONTHLY_COST_THRESHOLD_USD = 3 // KI-015 임계

export function estimateMonthlyCostUsd(pagesPerMonth: number, tokensPerPage: number): number {
  return (pagesPerMonth * tokensPerPage * OPENAI_TEXT_EMBEDDING_3_SMALL_USD_PER_1K_TOKENS) / 1000
}
