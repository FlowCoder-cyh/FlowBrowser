/**
 * Sprint 015 M4-4 — IndexingGate.
 *
 * PRD §8.6 / §13.2.2 / §13.5 — 자동 인덱싱 경로 Privacy 차단.
 * Privacy Filter 5단계(외부 호출 차단, `evaluatePrivacy`)와 별도 게이트 —
 * 인덱싱은 외부 호출이 아니지만 페이지 본문 + 임베딩 + Visit 누적 자체가 Privacy 결정.
 *
 * 차단 정책 (우선순위):
 *   1. 사용자 명시 차단 (UserSetting.privacyExclusions[].type === 'block')
 *   2. 사용자 명시 허용 (UserSetting.privacyExclusions[].type === 'allow') → 즉시 통과
 *   3. 디폴트 도메인 차단 list (DomainFilter `defaultBlacklistPatterns` 재활용 + icloud 1종)
 *   4. 디폴트 path glob 차단 (`*.naver.com/mail/*` 등)
 *   5. `<input type="password">` 감지 (SensitiveFieldDetector 재활용)
 *   6. 사용자 1회 override token → 통과
 *
 * 통과 = allowed=true, 차단 = allowed=false + blockReason / matchedPattern.
 * override 결정은 영속 X (재방문 시 다시 차단) — Phase 2+ "이 도메인 항상 인덱싱" 옵션 검토.
 */

import { randomUUID } from 'node:crypto'
import { defaultBlacklistPatterns } from './DomainFilter'
import type {
  IndexingContext,
  IndexingEvaluation,
  PrivacyExclusionRule
} from './types'

/**
 * DomainFilter 기본 13패턴 외 IndexingGate 전용 추가 도메인 패턴.
 * PRD §8.6.1 11 카테고리 중 `*.icloud.com` 은 외부 호출 차단(DomainFilter) 대상이 아니라
 * 인덱싱 차단 전용 — DomainFilter 본체에 추가하면 외부 Provider 호출 흐름까지 영향.
 */
const INDEXING_EXTRA_DOMAIN_PATTERNS: readonly RegExp[] = [/\bicloud\.com$/i]

interface PathGlobPattern {
  /** 사람 가독 원본 패턴 — 매칭 결과 반환용. */
  source: string
  domain: RegExp
  path: RegExp
}

/**
 * 디폴트 path glob 차단 패턴.
 * PRD §8.6.1: `*.naver.com/mail/*` (네이버 메일 — 도메인만으로는 차단 X, path 매칭 필요).
 */
const DEFAULT_BLOCK_PATH_PATTERNS: readonly PathGlobPattern[] = [
  {
    source: '*.naver.com/mail/*',
    domain: /(^|\.)naver\.com$/i,
    path: /^\/mail(\/|$)/i
  }
]

interface OverrideToken {
  token: string
  url: string
  createdAt: number
  expiresAt: number
}

export interface IndexingGateOptions {
  /** UserSetting.privacyExclusions[] 제공자 — 변경 시점에 호출. */
  getUserExclusions?: () => readonly PrivacyExclusionRule[]
  /** override token TTL (디폴트 5분 — 컨텍스트 메뉴 클릭 후 인덱싱 완료까지 시간). */
  overrideTtlMs?: number
}

const DEFAULT_OVERRIDE_TTL_MS = 5 * 60 * 1000

export class IndexingGate {
  private readonly overrideTokens = new Map<string, OverrideToken>()
  private readonly getUserExclusions: () => readonly PrivacyExclusionRule[]
  private readonly overrideTtlMs: number

  constructor(options: IndexingGateOptions = {}) {
    this.getUserExclusions = options.getUserExclusions ?? (() => [])
    this.overrideTtlMs = options.overrideTtlMs ?? DEFAULT_OVERRIDE_TTL_MS
  }

  evaluate(context: IndexingContext): IndexingEvaluation {
    const parsed = parseUrl(context.url)
    if (!parsed) {
      return {
        allowed: false,
        blockReason: 'domain',
        matchedBy: 'default_domain',
        matchedPattern: '<invalid-url>'
      }
    }

    const { hostname, pathname } = parsed

    const userRules = this.getUserExclusions()

    for (const rule of userRules) {
      if (rule.type === 'block' && matchUserPattern(rule.pattern, hostname)) {
        return {
          allowed: false,
          blockReason: 'user_block',
          matchedBy: 'user_block',
          matchedPattern: rule.pattern
        }
      }
    }

    if (context.overrideToken && this.consumeOverrideToken(context.overrideToken, context.url)) {
      return {
        allowed: true,
        blockReason: 'none',
        matchedBy: 'override'
      }
    }

    for (const rule of userRules) {
      if (rule.type === 'allow' && matchUserPattern(rule.pattern, hostname)) {
        return {
          allowed: true,
          blockReason: 'none'
        }
      }
    }

    const domainMatch = matchDefaultDomain(hostname)
    if (domainMatch) {
      return {
        allowed: false,
        blockReason: 'domain',
        matchedBy: 'default_domain',
        matchedPattern: domainMatch
      }
    }

    const pathMatch = matchDefaultPath(hostname, pathname)
    if (pathMatch) {
      return {
        allowed: false,
        blockReason: 'path',
        matchedBy: 'default_path',
        matchedPattern: pathMatch
      }
    }

    if (context.hasPasswordField) {
      return {
        allowed: false,
        blockReason: 'password',
        matchedBy: 'password_field'
      }
    }

    return { allowed: true, blockReason: 'none' }
  }

  /**
   * 사용자 컨텍스트 메뉴 "이 페이지 인덱싱" 클릭 시 발급.
   * 1회 소비 (consumeOverrideToken). TTL 만료 시 자동 폐기.
   */
  issueOverrideToken(url: string): string {
    this.purgeExpired()
    const token = randomUUID()
    const now = Date.now()
    this.overrideTokens.set(token, {
      token,
      url,
      createdAt: now,
      expiresAt: now + this.overrideTtlMs
    })
    return token
  }

  /**
   * 토큰 유효성 검사 + 1회 소비. 통과 시 true.
   * URL이 발급 시점과 다르면 거부.
   */
  consumeOverrideToken(token: string, url: string): boolean {
    this.purgeExpired()
    const entry = this.overrideTokens.get(token)
    if (!entry) return false
    if (entry.url !== url) return false
    this.overrideTokens.delete(token)
    return true
  }

  /** 활성 override token 수 — 단위 테스트/메모리 통계용. */
  activeOverrideCount(): number {
    this.purgeExpired()
    return this.overrideTokens.size
  }

  clearOverrideTokens(): void {
    this.overrideTokens.clear()
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [token, entry] of this.overrideTokens) {
      if (entry.expiresAt < now) {
        this.overrideTokens.delete(token)
      }
    }
  }
}

function parseUrl(raw: string): { hostname: string; pathname: string } | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null
    }
    return {
      hostname: u.hostname.toLowerCase(),
      pathname: u.pathname || '/'
    }
  } catch {
    return null
  }
}

function matchDefaultDomain(hostname: string): string | null {
  for (const pattern of defaultBlacklistPatterns()) {
    if (pattern.test(hostname)) return pattern.source
  }
  for (const pattern of INDEXING_EXTRA_DOMAIN_PATTERNS) {
    if (pattern.test(hostname)) return pattern.source
  }
  return null
}

function matchDefaultPath(hostname: string, pathname: string): string | null {
  for (const rule of DEFAULT_BLOCK_PATH_PATTERNS) {
    if (rule.domain.test(hostname) && rule.path.test(pathname)) {
      return rule.source
    }
  }
  return null
}

/**
 * 사용자 입력 host 패턴 매칭. DomainFilter.matchUserPattern 와 동일 규약:
 * - `*.example.com` 와일드카드 — 자기 자신 또는 서브도메인 매칭
 * - 정확 매치 (예: `mail.example.com`)
 */
function matchUserPattern(pattern: string, hostname: string): boolean {
  const normalized = pattern.toLowerCase().trim()
  if (!normalized) return false
  if (normalized.startsWith('*.')) {
    const base = normalized.slice(2)
    return hostname === base || hostname.endsWith(`.${base}`)
  }
  return hostname === normalized
}

export const __testing = {
  matchDefaultDomain,
  matchDefaultPath,
  matchUserPattern,
  DEFAULT_BLOCK_PATH_PATTERNS,
  INDEXING_EXTRA_DOMAIN_PATTERNS
}

export type {
  IndexingBlockReason,
  IndexingContext,
  IndexingEvaluation,
  PrivacyExclusionRule
} from './types'
