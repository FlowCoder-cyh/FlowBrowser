/**
 * Sprint 003 M3 / S003-T07 — DomainPolicyStore.
 * DomainFilter의 사용자 정책 영속 + import/export + 패턴 검증.
 *
 * PRD §9.6: 사용자 도메인 화이트/블랙리스트.
 * 사용자 화이트리스트가 기본/사용자 블랙리스트보다 우선 (DomainFilter.evaluate에서 처리).
 * JSON 영속 (encrypted 불필요 — 콘텐츠 아님 → G-005 적용 대상 외).
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DomainFilter, type DomainFilterRule, type DomainFilterState } from './DomainFilter'

export const POLICY_VERSION = 1

export interface DomainPolicyExport {
  policyVersion: number
  userRules: DomainFilterRule[]
}

export type PatternValidationError =
  | 'empty'
  | 'too_long'
  | 'invalid_chars'
  | 'invalid_wildcard'
  | 'invalid_type'

export interface PatternValidationResult {
  ok: boolean
  error?: PatternValidationError
  normalized?: string
}

const MAX_PATTERN_LENGTH = 253 // RFC 1035 도메인 최대 길이
const PATTERN_BODY = /^[a-z0-9.-]+$/

export function validatePattern(rawPattern: string, type: string): PatternValidationResult {
  if (type !== 'blacklist' && type !== 'whitelist') {
    return { ok: false, error: 'invalid_type' }
  }
  if (!rawPattern || !rawPattern.trim()) {
    return { ok: false, error: 'empty' }
  }
  const normalized = rawPattern.trim().toLowerCase()
  if (normalized.length > MAX_PATTERN_LENGTH) {
    return { ok: false, error: 'too_long' }
  }
  // 와일드카드는 선두 `*.`만 허용
  if (normalized.startsWith('*.')) {
    const body = normalized.slice(2)
    if (!body || !PATTERN_BODY.test(body)) {
      return { ok: false, error: 'invalid_wildcard' }
    }
    return { ok: true, normalized }
  }
  if (normalized.includes('*')) {
    return { ok: false, error: 'invalid_wildcard' }
  }
  if (!PATTERN_BODY.test(normalized)) {
    return { ok: false, error: 'invalid_chars' }
  }
  return { ok: true, normalized }
}

export class DomainPolicyStore {
  constructor(
    private filePath: string,
    private filter: DomainFilter
  ) {}

  /**
   * 디스크 로드. 파일 없으면 빈 정책. JSON 손상 시 빈 정책 + 경고 throw.
   */
  static async loadFromDisk(filePath: string): Promise<DomainFilterState> {
    try {
      const buf = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<DomainPolicyExport>
      const rules = Array.isArray(parsed.userRules)
        ? parsed.userRules.filter(
            (r): r is DomainFilterRule =>
              typeof r === 'object' &&
              r !== null &&
              typeof (r as DomainFilterRule).pattern === 'string' &&
              ((r as DomainFilterRule).type === 'blacklist' ||
                (r as DomainFilterRule).type === 'whitelist')
          )
        : []
      return { userRules: rules }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { userRules: [] }
      throw err
    }
  }

  /**
   * 단일 룰 추가 (패턴 검증 후). 중복은 무시 (idempotent).
   */
  async addRule(rule: DomainFilterRule): Promise<{ ok: boolean; error?: PatternValidationError }> {
    const v = validatePattern(rule.pattern, rule.type)
    if (!v.ok) return { ok: false, error: v.error }
    const normalized = v.normalized!
    const state = this.filter.getState()
    const exists = state.userRules.some((r) => r.pattern === normalized && r.type === rule.type)
    if (!exists) {
      this.filter.addUserRule({ pattern: normalized, type: rule.type })
      await this.persist()
    }
    return { ok: true }
  }

  async removeRule(rule: DomainFilterRule): Promise<void> {
    this.filter.removeUserRule(rule.pattern.trim().toLowerCase(), rule.type)
    await this.persist()
  }

  async setRules(rules: DomainFilterRule[]): Promise<{ accepted: number; rejected: number }> {
    const accepted: DomainFilterRule[] = []
    let rejected = 0
    const seen = new Set<string>()
    for (const r of rules) {
      const v = validatePattern(r.pattern, r.type)
      if (!v.ok || !v.normalized) {
        rejected++
        continue
      }
      const key = `${r.type}:${v.normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      accepted.push({ pattern: v.normalized, type: r.type })
    }
    this.filter.setUserRules(accepted)
    await this.persist()
    return { accepted: accepted.length, rejected }
  }

  /**
   * 외부 JSON으로 export. policyVersion 포함.
   */
  exportPolicy(): DomainPolicyExport {
    return {
      policyVersion: POLICY_VERSION,
      userRules: this.filter.getState().userRules
    }
  }

  /**
   * 외부 JSON 가져오기. 정책 전체 교체.
   * policyVersion 검증, 잘못된 룰은 reject 카운트.
   */
  async importPolicy(
    raw: unknown
  ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, accepted: 0, rejected: 0, error: 'invalid_root' }
    }
    const obj = raw as Partial<DomainPolicyExport>
    if (typeof obj.policyVersion !== 'number') {
      return { ok: false, accepted: 0, rejected: 0, error: 'missing_version' }
    }
    if (obj.policyVersion !== POLICY_VERSION) {
      return {
        ok: false,
        accepted: 0,
        rejected: 0,
        error: `unsupported_version_${obj.policyVersion}`
      }
    }
    if (!Array.isArray(obj.userRules)) {
      return { ok: false, accepted: 0, rejected: 0, error: 'invalid_userRules' }
    }
    const { accepted, rejected } = await this.setRules(obj.userRules)
    return { ok: true, accepted, rejected }
  }

  async clearAll(): Promise<void> {
    this.filter.setUserRules([])
    await this.persist()
  }

  /**
   * 현재 영속 상태 조회.
   */
  getState(): DomainFilterState {
    return this.filter.getState()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload: DomainPolicyExport = this.exportPolicy()
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }
}

export function defaultDomainPolicyPath(userDataDir: string): string {
  return join(userDataDir, 'domain-policy.json')
}
