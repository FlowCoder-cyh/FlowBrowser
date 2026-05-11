/**
 * 도메인 기반 차단/허용 필터.
 * PRD §9.6 / §15.3.
 *
 * 기본 블랙리스트:
 * - mail.* / accounts.* / banking.* / payment.* / login.* / signin.* / oauth.* / id.*
 * - account.* / pay.* / checkout.* / *.bank
 *
 * 사용자가 화이트리스트 / 추가 블랙리스트를 명시할 수 있음.
 */

const DEFAULT_BLACKLIST_PATTERNS: RegExp[] = [
  /^mail\./i,
  /^accounts?\./i,
  /^banking\./i,
  /^payment\./i,
  /^pay\./i,
  /^checkout\./i,
  /^login\./i,
  /^signin\./i,
  /^oauth\./i,
  /^id\./i,
  /\.bank$/i,
  /\bgmail\.com$/i,
  /\bpaypal\.com$/i
]

export interface DomainFilterRule {
  pattern: string // 사용자 입력 (간단 문자열 매칭, *.example.com 같은 와일드카드 지원)
  type: 'blacklist' | 'whitelist'
}

export interface DomainFilterState {
  userRules: DomainFilterRule[]
}

export class DomainFilter {
  constructor(private state: DomainFilterState = { userRules: [] }) {}

  /**
   * 도메인이 차단되어야 하는지 평가.
   * 우선순위: userWhitelist > userBlacklist > defaultBlacklist.
   */
  evaluate(domain: string): { blocked: boolean; matchedBy?: 'whitelist' | 'user_blacklist' | 'default_blacklist' } {
    const normalized = domain.toLowerCase()

    for (const rule of this.state.userRules) {
      if (rule.type === 'whitelist' && this.matchUserPattern(rule.pattern, normalized)) {
        return { blocked: false, matchedBy: 'whitelist' }
      }
    }

    for (const rule of this.state.userRules) {
      if (rule.type === 'blacklist' && this.matchUserPattern(rule.pattern, normalized)) {
        return { blocked: true, matchedBy: 'user_blacklist' }
      }
    }

    for (const pattern of DEFAULT_BLACKLIST_PATTERNS) {
      if (pattern.test(normalized)) {
        return { blocked: true, matchedBy: 'default_blacklist' }
      }
    }

    return { blocked: false }
  }

  addUserRule(rule: DomainFilterRule): void {
    this.state.userRules.push(rule)
  }

  removeUserRule(pattern: string, type: 'blacklist' | 'whitelist'): void {
    this.state.userRules = this.state.userRules.filter(
      (r) => !(r.pattern === pattern && r.type === type)
    )
  }

  getState(): DomainFilterState {
    return { userRules: [...this.state.userRules] }
  }

  private matchUserPattern(pattern: string, domain: string): boolean {
    const normalized = pattern.toLowerCase().trim()
    if (!normalized) return false
    // 와일드카드 *.example.com 또는 정확 매치
    if (normalized.startsWith('*.')) {
      const base = normalized.slice(2)
      return domain === base || domain.endsWith(`.${base}`)
    }
    return domain === normalized
  }
}

export function defaultBlacklistPatterns(): readonly RegExp[] {
  return DEFAULT_BLACKLIST_PATTERNS
}
