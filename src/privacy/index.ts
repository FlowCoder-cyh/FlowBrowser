/**
 * Privacy Layer 진입점.
 * PRD §9.6 / §11.1 Privacy Layer.
 * G-004: 본 모듈은 외부 Provider 호출 경로의 게이트.
 */

export { ConsentGate } from './ConsentGate'
export type { ConsentState } from './ConsentGate'

export { DomainFilter, defaultBlacklistPatterns } from './DomainFilter'
export type { DomainFilterRule, DomainFilterState } from './DomainFilter'

export {
  detectSensitiveFields,
  detectSensitiveFieldsScript,
  detectCardPatternInText,
  matchesCardHint
} from './SensitiveFieldDetector'

export { TransmissionLogger, defaultLogFilePath } from './TransmissionLogger'
export type { BlockedCounter } from './TransmissionLogger'

export type {
  PrivacyContext,
  PrivacyDecision,
  PrivacyEvaluation,
  TransmissionLogEntry
} from './types'

import { ConsentGate } from './ConsentGate'
import { DomainFilter } from './DomainFilter'
import { detectCardPatternInText } from './SensitiveFieldDetector'
import type { PrivacyContext, PrivacyEvaluation } from './types'

/**
 * 종합 평가: 주어진 컨텍스트에 대해 외부 Provider 전송 허용/차단 결정.
 *
 * 평가 순서 (블록 우선):
 * 1) consent (전역 동의 없음 → blocked)
 * 2) password field 존재 → 수동 승인 토큰 없으면 blocked
 * 3) card field 존재 → 수동 승인 토큰 없으면 blocked
 * 4) text 내 카드 번호 패턴 (간단 자료 보호)
 * 5) 도메인 필터
 * 통과 → allowed (수동 승인 토큰 검증 시 user_approved)
 */
export function evaluatePrivacy(args: {
  context: PrivacyContext
  text?: string
  consent: ConsentGate
  domains: DomainFilter
}): PrivacyEvaluation {
  const { context, text, consent, domains } = args

  if (!consent.isGloballyConsented()) {
    return {
      decision: 'blocked',
      reason: '전역 동의가 없습니다. 첫 실행 동의 화면에서 동의해 주세요.',
      blockedBy: 'consent_revoked'
    }
  }

  const hasApproval =
    context.manualApprovalToken !== undefined &&
    consent.validateApprovalToken(context.manualApprovalToken, context.domain)

  if (context.hasPasswordField && !hasApproval) {
    return {
      decision: 'blocked',
      reason: '비밀번호 입력 필드가 있는 페이지입니다. 명시적 승인 후 전송됩니다.',
      blockedBy: 'password_field'
    }
  }

  if (context.hasCardField && !hasApproval) {
    return {
      decision: 'blocked',
      reason: '결제 정보 입력 필드가 감지된 페이지입니다. 명시적 승인 후 전송됩니다.',
      blockedBy: 'card_field'
    }
  }

  if (text && detectCardPatternInText(text)) {
    return {
      decision: 'blocked',
      reason: '전송 요청 본문에 카드 번호로 보이는 패턴이 포함되었습니다.',
      blockedBy: 'card_field'
    }
  }

  const domainResult = domains.evaluate(context.domain)
  if (domainResult.blocked && !hasApproval) {
    return {
      decision: 'blocked',
      reason: `도메인 차단 목록 (${domainResult.matchedBy ?? 'unknown'})에 해당합니다.`,
      blockedBy: 'domain_blacklist'
    }
  }

  if (hasApproval && context.manualApprovalToken) {
    consent.consumeApprovalToken(context.manualApprovalToken)
    return { decision: 'user_approved', reason: '사용자 명시 승인 토큰 사용.' }
  }

  return { decision: 'allowed', reason: 'Privacy Filter 통과.' }
}
