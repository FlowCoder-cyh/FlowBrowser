/**
 * Privacy Filter 공통 타입.
 * PRD §9.6 / G-004 P0 기능 모듈.
 */

export type PrivacyDecision = 'allowed' | 'blocked' | 'user_approved'

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
