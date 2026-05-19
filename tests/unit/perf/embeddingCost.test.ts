/**
 * Sprint 016 M0 T06 — KI-015 임베딩 비용 산식 회귀 단위 테스트.
 *
 * .bench 파일은 측정만 수행하므로 회귀 강제는 본 unit test 가 담당.
 */

import { describe, it, expect } from 'vitest'

import {
  estimateMonthlyCostUsd,
  ASSUMED_TOKENS_PER_PAGE,
  TARGET_MONTHLY_PAGES,
  MONTHLY_COST_THRESHOLD_USD,
  OPENAI_TEXT_EMBEDDING_3_SMALL_USD_PER_1K_TOKENS
} from '../../perf/embeddingCostHelpers'

describe('KI-015 임베딩 비용 산식 회귀', () => {
  it('1만 페이지 × 1000 tokens × $0.00002 / 1K = $0.20 / 월', () => {
    const cost = estimateMonthlyCostUsd(TARGET_MONTHLY_PAGES, ASSUMED_TOKENS_PER_PAGE)
    expect(cost).toBeCloseTo(0.2, 5)
  })

  it('임계 미만 강제 — $3 / 월', () => {
    const cost = estimateMonthlyCostUsd(TARGET_MONTHLY_PAGES, ASSUMED_TOKENS_PER_PAGE)
    expect(cost).toBeLessThan(MONTHLY_COST_THRESHOLD_USD)
  })

  it('단가 상수 정합 — PRD §15.2 OpenAI text-embedding-3-small', () => {
    expect(OPENAI_TEXT_EMBEDDING_3_SMALL_USD_PER_1K_TOKENS).toBe(0.00002)
  })

  it('5만 페이지 / 월 시나리오도 임계 내', () => {
    const cost = estimateMonthlyCostUsd(50_000, ASSUMED_TOKENS_PER_PAGE)
    expect(cost).toBeLessThan(MONTHLY_COST_THRESHOLD_USD) // $1.0 < $3
  })

  it('산식 선형성', () => {
    const a = estimateMonthlyCostUsd(10_000, 1000)
    const b = estimateMonthlyCostUsd(20_000, 1000)
    expect(b).toBeCloseTo(a * 2, 5)
  })
})
