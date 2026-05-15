/**
 * Privacy Filter 공통 타입.
 * PRD §9.6 / G-004 P0 기능 모듈.
 */

export type PrivacyDecision = 'allowed' | 'blocked' | 'user_approved'

/**
 * 차단 사유 enum. Sprint 003 M1에서 reason 문자열 매칭 → enum 비교로 전환.
 * - `none`: 차단 아님 (allowed / user_approved 시)
 * - `consent`: 전역 동의 미보유
 * - `password`: password input 필드 존재 (수동 승인 없음)
 * - `card_field`: 카드 입력 필드 존재 (수동 승인 없음)
 * - `card_pattern`: 본문 텍스트에 카드 번호 패턴 (수동 승인 무력)
 * - `domain`: 도메인 블랙리스트 매치 (수동 승인 없음)
 */
export type BlockReason =
  | 'none'
  | 'consent'
  | 'password'
  | 'card_field'
  | 'card_pattern'
  | 'domain'

export interface PrivacyContext {
  url: string
  domain: string
  hasPasswordField: boolean
  hasCardField: boolean
  manualApprovalToken?: string
}

export interface PrivacyEvaluation {
  decision: PrivacyDecision
  reason: string
  /**
   * Sprint 003 M1에서 추가. 차단 사유 enum (단일 값, 첫 트리거 사유).
   * `decision === 'allowed' | 'user_approved'` 시 `'none'`.
   */
  blockReason: BlockReason
  /**
   * Sprint 003 M1에서 추가. 차단 시 페이지 전체 차단인지 (true) 부분 차단인지 (false).
   * - `consent / password / card_field / card_pattern / domain`: 모두 true
   *   (사용자가 명시 차단 가능한 모든 사유는 page-wide로 통일)
   * - `decision === 'allowed' | 'user_approved'` 시 false
   */
  pageWideBlock: boolean
  /**
   * 기존 (Sprint 001~002) 호환 필드. enum 도입 후에도 외부 호출자(테스트/이벤트)
   * 호환을 위해 유지. 신규 코드는 `blockReason` 사용 권장.
   */
  blockedBy?: 'password_field' | 'card_field' | 'domain_blacklist' | 'consent_revoked'
}

export interface TransmissionLogEntry {
  timestamp: number
  url: string
  domain: string
  decision: PrivacyDecision
  feature: 'translation' | 'summary' | 'tts' | 'stt' | 'explanation'
  providerId?: string
  reason?: string
}
