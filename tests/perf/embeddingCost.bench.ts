/**
 * Sprint 016 M0 T06 — perf bench (KI-015 임베딩 비용 < $3 / 월).
 *
 * PRD §15.4 #4 / §15.2 — 1만 페이지 / 월 임베딩 비용 산식 검증.
 *
 * 산식:
 *   페이지당 토큰 추정 × 1만 페이지 × OpenAI text-embedding-3-small 단가 ($0.00002 / 1K tokens)
 *
 * 페이지당 토큰 가정 (PRD §15.2):
 *   - 본문 평균 4KB / 페이지 (보수 추정)
 *   - 4 chars/token (OpenAI tokenizer 영문 기준)
 *   - = 1000 tokens / 페이지
 *
 * 1만 페이지 / 월 비용:
 *   10000 × 1000 / 1000 × $0.00002 = $0.20 / 월 (충분히 임계 내)
 *
 * 본 bench 는 산식 자체를 측정 (실제 OpenAI 호출 없음).
 * 임계: < $3 / 월. 회귀 회귀는 tests/unit/ 의 별도 unit test 가 expect 강제.
 * 미달 시: 단가 변동 또는 페이지 토큰 산식 재추정 필요 (KI-015 status `open` 유지).
 */

import { bench, describe } from 'vitest'

import { estimateMonthlyCostUsd } from './embeddingCostHelpers'

describe('KI-015 임베딩 비용 산식 (PRD §15.2 정합)', () => {
  bench('estimateMonthlyCostUsd — 1만 페이지 / 월', () => {
    const cost = estimateMonthlyCostUsd(10_000, 1000)
    if (cost >= 3) throw new Error(`임계 초과: $${cost.toFixed(4)} >= $3`)
    if (cost <= 0) throw new Error(`산식 오류: $${cost.toFixed(4)}`)
  })

  bench('estimateMonthlyCostUsd — 5만 페이지 / 월 (확장 시나리오)', () => {
    estimateMonthlyCostUsd(50_000, 1000)
  })
})
