import { describe, it, expect } from 'vitest'
import { ConsentGate } from '../../../src/privacy/ConsentGate'
import { DomainFilter } from '../../../src/privacy/DomainFilter'
import { evaluatePrivacy } from '../../../src/privacy/index'

function consented(): ConsentGate {
  const c = new ConsentGate()
  c.giveGlobalConsent()
  return c
}

function ctx(over: Partial<{ url: string; domain: string; hasPasswordField: boolean; hasCardField: boolean; manualApprovalToken: string }> = {}): Parameters<typeof evaluatePrivacy>[0]['context'] {
  return {
    url: over.url ?? 'https://www.example.com/page',
    domain: over.domain ?? 'www.example.com',
    hasPasswordField: over.hasPasswordField ?? false,
    hasCardField: over.hasCardField ?? false,
    manualApprovalToken: over.manualApprovalToken
  }
}

describe('evaluatePrivacy', () => {
  it('blocks when global consent missing', () => {
    const consent = new ConsentGate()
    const result = evaluatePrivacy({
      context: ctx(),
      text: 'hello',
      consent,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockedBy).toBe('consent_revoked')
  })

  it('blocks on password field without approval token', () => {
    const result = evaluatePrivacy({
      context: ctx({ hasPasswordField: true }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockedBy).toBe('password_field')
  })

  it('blocks on card field without approval token', () => {
    const result = evaluatePrivacy({
      context: ctx({ hasCardField: true }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockedBy).toBe('card_field')
  })

  it('blocks on card pattern in text regardless of token', () => {
    const c = consented()
    const token = c.issueApprovalToken('www.example.com')
    const result = evaluatePrivacy({
      context: ctx({ manualApprovalToken: token }),
      text: 'My card is 4242 4242 4242 4242',
      consent: c,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockedBy).toBe('card_field')
  })

  it('blocks on default blacklist domain without token', () => {
    const result = evaluatePrivacy({
      context: ctx({ url: 'https://mail.example.com/inbox', domain: 'mail.example.com' }),
      text: 'hello',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('blocked')
    expect(result.blockedBy).toBe('domain_blacklist')
  })

  it('allows ordinary domain + safe text', () => {
    const result = evaluatePrivacy({
      context: ctx(),
      text: 'translate this sentence',
      consent: consented(),
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('allowed')
  })

  it('user_approved when password field present but valid token supplied', () => {
    const c = consented()
    const token = c.issueApprovalToken('www.example.com')
    const result = evaluatePrivacy({
      context: ctx({ hasPasswordField: true, manualApprovalToken: token }),
      text: 'hello',
      consent: c,
      domains: new DomainFilter()
    })
    expect(result.decision).toBe('user_approved')
    // token should be consumed
    expect(c.validateApprovalToken(token, 'www.example.com')).toBe(false)
  })

  it('user whitelist can bypass default blacklist', () => {
    const domains = new DomainFilter({
      userRules: [{ pattern: 'mail.example.com', type: 'whitelist' }]
    })
    const result = evaluatePrivacy({
      context: ctx({ url: 'https://mail.example.com', domain: 'mail.example.com' }),
      text: 'hello',
      consent: consented(),
      domains
    })
    expect(result.decision).toBe('allowed')
  })
})
