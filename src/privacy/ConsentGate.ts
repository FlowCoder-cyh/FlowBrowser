/**
 * 사용자 동의 게이트.
 * - 첫 실행 동의 (전역)
 * - 민감 페이지 수동 승인 토큰 (세션 한정)
 *
 * PRD §8.0 / §10.3 / §9.6.
 */

import { randomUUID } from 'node:crypto'

export interface ConsentState {
  globalConsented: boolean
  globalConsentedAt: number | null
  policyVersion: number // 정책 변경 시 재동의 필요
}

interface ApprovalToken {
  token: string
  domain: string
  createdAt: number
  expiresAt: number // 세션 한정 (기본 1시간)
}

export class ConsentGate {
  private approvalTokens: Map<string, ApprovalToken> = new Map()

  constructor(
    private state: ConsentState = {
      globalConsented: false,
      globalConsentedAt: null,
      policyVersion: 1
    },
    private currentPolicyVersion = 1
  ) {}

  isGloballyConsented(): boolean {
    return this.state.globalConsented && this.state.policyVersion === this.currentPolicyVersion
  }

  giveGlobalConsent(): ConsentState {
    this.state = {
      globalConsented: true,
      globalConsentedAt: Date.now(),
      policyVersion: this.currentPolicyVersion
    }
    return { ...this.state }
  }

  revokeGlobalConsent(): void {
    this.state = {
      globalConsented: false,
      globalConsentedAt: null,
      policyVersion: this.currentPolicyVersion
    }
    this.approvalTokens.clear()
  }

  getState(): ConsentState {
    return { ...this.state }
  }

  /**
   * 민감 페이지에 대한 1회 수동 승인 토큰 발급.
   * 세션 한정 (TTL 기본 1시간).
   */
  issueApprovalToken(domain: string, ttlMs = 60 * 60 * 1000): string {
    const token = randomUUID()
    const now = Date.now()
    this.approvalTokens.set(token, {
      token,
      domain: domain.toLowerCase(),
      createdAt: now,
      expiresAt: now + ttlMs
    })
    this.purgeExpired()
    return token
  }

  /**
   * 토큰이 도메인에 대해 유효한지 확인.
   */
  validateApprovalToken(token: string, domain: string): boolean {
    this.purgeExpired()
    const entry = this.approvalTokens.get(token)
    if (!entry) return false
    if (entry.expiresAt < Date.now()) {
      this.approvalTokens.delete(token)
      return false
    }
    return entry.domain === domain.toLowerCase()
  }

  /**
   * 사용 후 즉시 폐기 (one-shot 토큰).
   */
  consumeApprovalToken(token: string): void {
    this.approvalTokens.delete(token)
  }

  clearAllTokens(): void {
    this.approvalTokens.clear()
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [token, entry] of this.approvalTokens.entries()) {
      if (entry.expiresAt < now) {
        this.approvalTokens.delete(token)
      }
    }
  }
}
