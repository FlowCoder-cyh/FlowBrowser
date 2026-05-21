/**
 * Sprint 016 M4 T22 — UserLevelEstimator (deterministic mock).
 *
 * PRD §16 roadmap §76 "Sprint 016 — cookies/session/캐시 격리 + 하이라이트 + 자동 수준 추정" +
 * PRD §16.66~70 R3-A (사용자 수동 선택) vs R3-B (자동 수준 추정).
 *
 * Phase 2 진입 자리 — Phase 3 R&D 메타 학습 도입 시점에 본 메서드 교체.
 *
 * 본 mock 의 강제 제약 (codex M4 사전 협의 정합):
 *   1. AI 호출 0 — provider 주입 없음, network 호출 0
 *   2. 저장소 mutation 0 — DB 의존성 0, read-only signature
 *   3. `workspaces.level_preference` override 0 — 사용자 수동 선택 (R3-A) 가 항상 우선
 *      (본 모듈은 read-only estimate, PromptComposer 가 활성 선택 결정)
 *   4. deterministic — 동일 입력 시 동일 결과 (테스트 안정성)
 *
 * 호출자 책임:
 *   - 본 메서드 결과 `level` 을 직접 `workspaces.level_preference` 컬럼에 INSERT/UPDATE 금지
 *   - PromptComposer 등 다운스트림에서 사용 시 사용자 수동 선택이 null 일 때만 fallback 으로
 *     본 estimate.level 활용 — confidence 가 임계 (Phase 3 정의 예정) 이상일 때
 *
 * 후속 (Phase 3 R&D):
 *   - 메타 학습 — page tag distribution / note 길이 분포 / chat turn 깊이 등 입력 학습
 *   - confidence 산출 — beta distribution / logistic regression 등
 *   - source='learned' 추가
 */

import type { LevelPreference } from '../storage/Database'

/**
 * estimate 결과 — Exclude<LevelPreference, null> 보장 (mock 은 항상 1 level 출력).
 * 본 결과는 read-only — 호출자가 활성 level 결정 (사용자 수동 선택 우선).
 */
export interface UserLevelEstimate {
  /** 'novice' | 'intermediate' | 'advanced' — null 출력 안 함 (mock 은 항상 디폴트 반환). */
  level: Exclude<LevelPreference, null>
  /** 0~1 — Phase 2 mock 은 단일 디폴트, Phase 3 학습 도입 시 산출. */
  confidence: number
  /** 본 결과의 출처. Phase 2 = 'mock' / Phase 3 = 'learned' 추가 예정. */
  source: 'mock'
}

export interface UserLevelEstimatorOptions {
  /** mock 의 디폴트 level. 미주입 시 'intermediate' (가장 안전한 중립). */
  defaultLevel?: Exclude<LevelPreference, null>
  /** mock 의 디폴트 confidence. 미주입 시 0.5 (중간 — 신뢰 낮음 의미). */
  defaultConfidence?: number
}

/**
 * estimate 입력 — Phase 3 R&D 학습 도입 시 본 필드들 가중. 현 mock 은 workspaceId 만 검증 + 모두 무시.
 */
export interface EstimateInput {
  /** 워크스페이스 id — 필수 (mock 도 검증). */
  workspaceId: string
  /** Phase 3 학습 hint. 현 mock 무시. */
  pageCount?: number
  /** Phase 3 학습 hint. 현 mock 무시. */
  noteCount?: number
  /** Phase 3 학습 hint. 현 mock 무시. */
  chatTurnCount?: number
  /** Phase 3 학습 hint — kind 별 tag 분포. 현 mock 무시. */
  tagDistribution?: Record<string, number>
}

const DEFAULT_LEVEL: Exclude<LevelPreference, null> = 'intermediate'
const DEFAULT_CONFIDENCE = 0.5

/**
 * Phase 2 진입 자리 — deterministic mock.
 *
 * 본 mock 은 입력 hint 를 모두 무시하고 디폴트 (level / confidence) 만 반환.
 * Phase 3 R&D 진입 시점에 실 학습 로직으로 교체.
 *
 * 호출자가 `estimate()` 결과를 `level_preference` 컬럼에 직접 INSERT 금지 — 사용자 수동 선택 (R3-A) 우선 정책.
 * 다운스트림 (PromptComposer 등) 에서 fallback 활용 시 confidence 임계 (Phase 3 정의) 검토.
 */
export class UserLevelEstimator {
  private readonly defaultLevel: Exclude<LevelPreference, null>
  private readonly defaultConfidence: number

  constructor(opts: UserLevelEstimatorOptions = {}) {
    const level = opts.defaultLevel
    if (level !== undefined && !isValidLevel(level)) {
      throw new Error(
        `UserLevelEstimator: invalid defaultLevel=${String(level)} (allowed: novice / intermediate / advanced)`
      )
    }
    const confidence = opts.defaultConfidence
    if (confidence !== undefined && !isValidConfidence(confidence)) {
      throw new Error(
        `UserLevelEstimator: invalid defaultConfidence=${String(confidence)} (allowed: 0 <= n <= 1)`
      )
    }
    this.defaultLevel = level ?? DEFAULT_LEVEL
    this.defaultConfidence = confidence ?? DEFAULT_CONFIDENCE
  }

  /**
   * Deterministic mock estimate.
   *
   * 입력 (page/note/chat/tag) 은 Phase 3 학습 hint — 현 mock 은 workspaceId 만 검증 후 디폴트 반환.
   * 동일 인스턴스의 동일 입력은 항상 동일 결과 (테스트 안정성 + level_preference override 0).
   */
  estimate(input: EstimateInput): UserLevelEstimate {
    // codex T22 사전 dual review NB-HF 흡수 — input 자체가 null/undefined 또는
    // workspaceId 가 non-string 인 케이스 의도된 'workspaceId required' throw 로 통일.
    // (이전: TypeError 가 나서 메시지 일관성 깨짐. 내부 typed API 라 NEEDS_CHANGES 는 아니나 작은 hotfix.)
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.workspaceId !== 'string' ||
      input.workspaceId.trim().length === 0
    ) {
      throw new Error('UserLevelEstimator.estimate: workspaceId required')
    }
    return {
      level: this.defaultLevel,
      confidence: this.defaultConfidence,
      source: 'mock'
    }
  }
}

function isValidLevel(v: unknown): v is Exclude<LevelPreference, null> {
  return v === 'novice' || v === 'intermediate' || v === 'advanced'
}

function isValidConfidence(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

export const __testing = {
  DEFAULT_LEVEL,
  DEFAULT_CONFIDENCE,
  isValidLevel,
  isValidConfidence
}
