/**
 * Sprint 016 M4 T22 — UserLevelEstimator (deterministic mock) 단위 회귀.
 *
 * cover:
 *   - 디폴트 estimate — level='intermediate' / confidence=0.5 / source='mock'
 *   - defaultLevel override — 'novice' / 'intermediate' / 'advanced'
 *   - defaultConfidence override — 0 / 0.5 / 1
 *   - 잘못된 defaultLevel → throw (constructor)
 *   - 잘못된 defaultConfidence (음수 / 1 초과 / NaN / Infinity / 비-숫자) → throw (constructor)
 *   - workspaceId 빈 문자열 / whitespace-only → throw (estimate)
 *   - deterministic — 동일 입력 시 동일 결과 (3회 반복)
 *   - input hint (pageCount / noteCount / chatTurnCount / tagDistribution) 모두 무시 — 디폴트 그대로
 *   - mutation 0 검증 — 동일 인스턴스 결과 동일성
 *   - AI 호출 0 검증 — provider / DB 의존성 없음 (생성자 옵션에 provider 항목 없음)
 */

import { describe, it, expect } from 'vitest'

import { UserLevelEstimator, __testing } from '../../../src/main/UserLevelEstimator'

describe('UserLevelEstimator — 디폴트 mock', () => {
  it('디폴트 estimate — intermediate / 0.5 / mock', () => {
    const e = new UserLevelEstimator()
    const r = e.estimate({ workspaceId: 'ws-1' })
    expect(r.level).toBe('intermediate')
    expect(r.confidence).toBe(0.5)
    expect(r.source).toBe('mock')
  })

  it('__testing DEFAULT 상수 노출', () => {
    expect(__testing.DEFAULT_LEVEL).toBe('intermediate')
    expect(__testing.DEFAULT_CONFIDENCE).toBe(0.5)
  })
})

describe('UserLevelEstimator — defaultLevel override', () => {
  it('novice', () => {
    const e = new UserLevelEstimator({ defaultLevel: 'novice' })
    expect(e.estimate({ workspaceId: 'ws-1' }).level).toBe('novice')
  })

  it('intermediate (디폴트 명시)', () => {
    const e = new UserLevelEstimator({ defaultLevel: 'intermediate' })
    expect(e.estimate({ workspaceId: 'ws-1' }).level).toBe('intermediate')
  })

  it('advanced', () => {
    const e = new UserLevelEstimator({ defaultLevel: 'advanced' })
    expect(e.estimate({ workspaceId: 'ws-1' }).level).toBe('advanced')
  })
})

describe('UserLevelEstimator — defaultConfidence override', () => {
  it('0 (최저)', () => {
    const e = new UserLevelEstimator({ defaultConfidence: 0 })
    expect(e.estimate({ workspaceId: 'ws-1' }).confidence).toBe(0)
  })

  it('1 (최고)', () => {
    const e = new UserLevelEstimator({ defaultConfidence: 1 })
    expect(e.estimate({ workspaceId: 'ws-1' }).confidence).toBe(1)
  })

  it('0.75', () => {
    const e = new UserLevelEstimator({ defaultConfidence: 0.75 })
    expect(e.estimate({ workspaceId: 'ws-1' }).confidence).toBe(0.75)
  })
})

describe('UserLevelEstimator — constructor 입력 검증', () => {
  it('잘못된 defaultLevel → throw', () => {
    expect(() => new UserLevelEstimator({ defaultLevel: 'expert' as never })).toThrow(/defaultLevel/)
    expect(() => new UserLevelEstimator({ defaultLevel: '' as never })).toThrow(/defaultLevel/)
    expect(() => new UserLevelEstimator({ defaultLevel: null as never })).toThrow(/defaultLevel/)
  })

  it('잘못된 defaultConfidence — 음수 → throw', () => {
    expect(() => new UserLevelEstimator({ defaultConfidence: -0.1 })).toThrow(/defaultConfidence/)
  })

  it('잘못된 defaultConfidence — 1 초과 → throw', () => {
    expect(() => new UserLevelEstimator({ defaultConfidence: 1.1 })).toThrow(/defaultConfidence/)
  })

  it('잘못된 defaultConfidence — NaN → throw', () => {
    expect(() => new UserLevelEstimator({ defaultConfidence: Number.NaN })).toThrow(/defaultConfidence/)
  })

  it('잘못된 defaultConfidence — Infinity → throw', () => {
    expect(() => new UserLevelEstimator({ defaultConfidence: Number.POSITIVE_INFINITY })).toThrow(
      /defaultConfidence/
    )
  })

  it('잘못된 defaultConfidence — 비-숫자 → throw', () => {
    expect(() => new UserLevelEstimator({ defaultConfidence: '0.5' as never })).toThrow(
      /defaultConfidence/
    )
  })

  it('옵션 미주입 (빈 객체 또는 undefined) → 디폴트 적용', () => {
    expect(new UserLevelEstimator().estimate({ workspaceId: 'ws-1' }).level).toBe('intermediate')
    expect(new UserLevelEstimator({}).estimate({ workspaceId: 'ws-1' }).confidence).toBe(0.5)
  })
})

describe('UserLevelEstimator — estimate 입력 검증', () => {
  it('workspaceId 빈 문자열 → throw', () => {
    const e = new UserLevelEstimator()
    expect(() => e.estimate({ workspaceId: '' })).toThrow(/workspaceId/)
  })

  it('workspaceId whitespace-only → throw', () => {
    const e = new UserLevelEstimator()
    expect(() => e.estimate({ workspaceId: '   ' })).toThrow(/workspaceId/)
  })
})

describe('UserLevelEstimator — deterministic + mutation 0', () => {
  it('동일 입력 시 동일 결과 (3회 반복)', () => {
    const e = new UserLevelEstimator({ defaultLevel: 'advanced', defaultConfidence: 0.7 })
    const r1 = e.estimate({ workspaceId: 'ws-1' })
    const r2 = e.estimate({ workspaceId: 'ws-1' })
    const r3 = e.estimate({ workspaceId: 'ws-1' })
    expect(r1).toEqual(r2)
    expect(r2).toEqual(r3)
  })

  it('다른 workspaceId 도 디폴트 동일 (mock 은 ws 무시)', () => {
    const e = new UserLevelEstimator()
    const r1 = e.estimate({ workspaceId: 'ws-A' })
    const r2 = e.estimate({ workspaceId: 'ws-B' })
    expect(r1).toEqual(r2)
  })

  it('input hint (page/note/chat/tag) 변화에도 결과 동일 — Phase 3 학습 자리만', () => {
    const e = new UserLevelEstimator()
    const base = e.estimate({ workspaceId: 'ws-1' })
    const withHints = e.estimate({
      workspaceId: 'ws-1',
      pageCount: 1000,
      noteCount: 500,
      chatTurnCount: 200,
      tagDistribution: { topic: 50, entity: 30, freeform: 20 }
    })
    expect(withHints).toEqual(base)
  })
})

describe('UserLevelEstimator — codex 사전 협의 제약 (Phase 2 정합)', () => {
  it('AI 호출 0 — constructor 옵션에 provider / network 항목 없음', () => {
    // 생성자가 provider/db 인자 없이 동작 — DB / network 의존성 0
    const e = new UserLevelEstimator()
    expect(e).toBeInstanceOf(UserLevelEstimator)
    // 입력 hint 만으로 estimate 실행 (외부 호출 없음)
    const r = e.estimate({ workspaceId: 'ws-1' })
    expect(r.source).toBe('mock')
  })

  it('source 가 항상 mock (Phase 2) — Phase 3 = learned 추가 예정', () => {
    const e1 = new UserLevelEstimator()
    const e2 = new UserLevelEstimator({ defaultLevel: 'advanced', defaultConfidence: 1 })
    expect(e1.estimate({ workspaceId: 'x' }).source).toBe('mock')
    expect(e2.estimate({ workspaceId: 'x' }).source).toBe('mock')
  })

  it('level_preference override 0 — 본 모듈은 read-only estimate 만, 호출자가 활성 결정', () => {
    // 본 검증은 시그니처 보장 — estimate 결과 자체가 storage mutation API 없음.
    // estimate() 반환은 plain object — DB write side-effect 0.
    const e = new UserLevelEstimator()
    const result = e.estimate({ workspaceId: 'ws-1' })
    // result 는 plain object only — function / class 메서드 노출 안 됨 (DB write API 부재).
    expect(typeof result).toBe('object')
    expect(Object.keys(result).sort()).toEqual(['confidence', 'level', 'source'])
  })
})
