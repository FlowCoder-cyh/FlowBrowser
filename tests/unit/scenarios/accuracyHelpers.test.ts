/**
 * Sprint 016 M0 T06 — 정확도 회귀 산식 헬퍼 단위 테스트.
 *
 * KI-018 top-10 hit rate / KI-019 AI 출처 정확도 산식 회귀 강제.
 * 실제 30 케이스 회귀는 Sprint 016 T07~T08 시점에 박힘 (시나리오 2·3 + 기존 1·4 + 추가 12).
 */

import { describe, it, expect } from 'vitest'

import {
  topKHitRate,
  aiSourcesPrecision,
  TOP_K_HIT_RATE_THRESHOLD,
  AI_SOURCES_PRECISION_THRESHOLD
} from '../../integration/scenarios/accuracyHelpers'

describe('topKHitRate 산식 (KI-018)', () => {
  it('빈 셋 → 0', () => {
    expect(topKHitRate([], 10)).toBe(0)
  })

  it('정답 모두 top-1 → 1.0', () => {
    const pairs = [
      { expected: ['p1'], returnedTopK: ['p1', 'p2', 'p3'] },
      { expected: ['p4'], returnedTopK: ['p4', 'p5'] }
    ]
    expect(topKHitRate(pairs, 10)).toBe(1)
  })

  it('정답 일부 누락 → 비율', () => {
    const pairs = [
      { expected: ['p1'], returnedTopK: ['p1'] }, // hit
      { expected: ['p2'], returnedTopK: ['p9'] }, // miss
      { expected: ['p3'], returnedTopK: ['p3'] } // hit
    ]
    expect(topKHitRate(pairs, 10)).toBeCloseTo(2 / 3, 5)
  })

  it('any-hit 의미 — expected 다중 중 하나라도 top-K 안에 있으면 hit', () => {
    const pairs = [{ expected: ['p1', 'p2'], returnedTopK: ['p99', 'p2', 'p3'] }]
    expect(topKHitRate(pairs, 10)).toBe(1)
  })

  it('k 제한 — top-2 만 → 더 엄격', () => {
    const pairs = [{ expected: ['p3'], returnedTopK: ['p1', 'p2', 'p3'] }]
    expect(topKHitRate(pairs, 2)).toBe(0)
    expect(topKHitRate(pairs, 10)).toBe(1)
  })

  it('임계 상수 — PRD §15.4 #3 = 0.8', () => {
    expect(TOP_K_HIT_RATE_THRESHOLD).toBe(0.8)
  })
})

describe('aiSourcesPrecision 산식 (KI-019)', () => {
  it('빈 셋 → 0', () => {
    expect(aiSourcesPrecision([])).toBe(0)
  })

  it('모든 sources 가 retrieved 안에 → 1.0', () => {
    const pairs = [
      { citedSources: ['p1', 'p2'], retrievedItems: ['p1', 'p2', 'p3'] },
      { citedSources: ['p4'], retrievedItems: ['p4'] }
    ]
    expect(aiSourcesPrecision(pairs)).toBe(1)
  })

  it('hallucination 케이스 — sources 가 retrieved 밖 → < 1', () => {
    const pairs = [
      { citedSources: ['p1', 'pX'], retrievedItems: ['p1', 'p2', 'p3'] } // 1/2 precision
    ]
    expect(aiSourcesPrecision(pairs)).toBe(0.5)
  })

  it('citedSources 0 케이스는 평균에서 제외', () => {
    const pairs = [
      { citedSources: [], retrievedItems: ['p1'] }, // 제외
      { citedSources: ['p2'], retrievedItems: ['p2'] } // 1.0
    ]
    expect(aiSourcesPrecision(pairs)).toBe(1)
  })

  it('모든 케이스 citedSources 0 → 0 (denom 0)', () => {
    const pairs = [
      { citedSources: [], retrievedItems: ['p1'] },
      { citedSources: [], retrievedItems: ['p2'] }
    ]
    expect(aiSourcesPrecision(pairs)).toBe(0)
  })

  it('임계 상수 — PRD §15.4 #6 = 0.9', () => {
    expect(AI_SOURCES_PRECISION_THRESHOLD).toBe(0.9)
  })
})
