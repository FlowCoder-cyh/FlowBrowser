/**
 * Sprint 003 M1 / S003-T02 — BlockReason enum + pageWideBlock 매트릭스 회귀 테스트.
 * Sprint 002 evaluator §3 후속 2 해소: reason 문자열 매칭 → enum 비교 전환.
 */
import { describe, it, expect } from 'vitest'
import { ConsentGate } from '../../../src/privacy/ConsentGate'
import { DomainFilter } from '../../../src/privacy/DomainFilter'
import { evaluatePrivacy } from '../../../src/privacy/index'

function consented(): ConsentGate {
  const c = new ConsentGate()
  c.giveGlobalConsent()
  return c
}

function ctx(over: Partial<{
  url: string
  domain: string
  hasPasswordField: boolean
  hasCardField: boolean
  manualApprovalToken: string
}> = {}): Parameters<typeof evaluatePrivacy>[0]['context'] {
  return {
    url: over.url ?? 'https://www.example.com/page',
    domain: over.domain ?? 'www.example.com',
    hasPasswordField: over.hasPasswordField ?? false,
    hasCardField: over.hasCardField ?? false,
    manualApprovalToken: over.manualApprovalToken
  }
}

describe('evaluatePrivacy — BlockReason enum + pageWideBlock (Sprint 003 M1 / AC-2)', () => {
  it('consent 차단: blockReason=consent, pageWideBlock=true', () => {
    const consent = new ConsentGate()
    const result = evaluatePrivacy({
      context: ctx(),
      text: 'hello',
      consent,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockReason).toBe('consent')
    expect(result.pageWideBlock).toBe(true)
  })

  it('password 차단: blockReason=password, pageWideBlock=true', () => {
    const result = evaluatePrivacy({
      context: ctx({ hasPasswordField: true }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.blockReason).toBe('password')
    expect(result.pageWideBlock).toBe(true)
  })

  it('card field 차단: blockReason=card_field, pageWideBlock=true', () => {
    const result = evaluatePrivacy({
      context: ctx({ hasCardField: true }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.blockReason).toBe('card_field')
    expect(result.pageWideBlock).toBe(true)
  })

  it('card 패턴 차단: blockReason=card_pattern, pageWideBlock=true, 승인 토큰 무력', () => {
    const c = consented()
    const token = c.issueApprovalToken('www.example.com')
    const result = evaluatePrivacy({
      context: ctx({ manualApprovalToken: token }),
      text: 'My card is 4242 4242 4242 4242',
      consent: c,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockReason).toBe('card_pattern')
    expect(result.pageWideBlock).toBe(true)
  })

  it('domain 차단: blockReason=domain, pageWideBlock=true', () => {
    const result = evaluatePrivacy({
      context: ctx({ url: 'https://mail.example.com/inbox', domain: 'mail.example.com' }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.blockReason).toBe('domain')
    expect(result.pageWideBlock).toBe(true)
  })

  it('allowed: blockReason=none, pageWideBlock=false', () => {
    const result = evaluatePrivacy({
      context: ctx(),
      text: 'translate this',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('allowed')
    expect(result.blockReason).toBe('none')
    expect(result.pageWideBlock).toBe(false)
  })

  it('user_approved: blockReason=none, pageWideBlock=false', () => {
    const c = consented()
    const token = c.issueApprovalToken('www.example.com')
    const result = evaluatePrivacy({
      context: ctx({ hasPasswordField: true, manualApprovalToken: token }),
      text: 'safe text',
      consent: c,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('user_approved')
    expect(result.blockReason).toBe('none')
    expect(result.pageWideBlock).toBe(false)
  })

  it('blockReason 우선순위: consent → password → card_field → card_pattern → domain', () => {
    // password + card 둘 다 true → password 우선
    const r1 = evaluatePrivacy({
      context: ctx({ hasPasswordField: true, hasCardField: true }),
      text: 'safe',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(r1.blockReason).toBe('password')

    // card_field + 도메인 매치 → card_field 우선
    const r2 = evaluatePrivacy({
      context: ctx({ url: 'https://pay.example.com', domain: 'pay.example.com', hasCardField: true }),
      text: 'safe',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(r2.blockReason).toBe('card_field')
  })
})
