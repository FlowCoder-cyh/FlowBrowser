import { describe, it, expect, beforeEach } from 'vitest'
import { ConsentGate } from '../../../src/privacy/ConsentGate'

describe('ConsentGate', () => {
  let gate: ConsentGate

  beforeEach(() => {
    gate = new ConsentGate()
  })

  describe('global consent', () => {
    it('is not consented by default', () => {
      expect(gate.isGloballyConsented()).toBe(false)
    })

    it('giveGlobalConsent sets consented true with timestamp', () => {
      const before = Date.now()
      gate.giveGlobalConsent()
      const state = gate.getState()
      expect(state.globalConsented).toBe(true)
      expect(state.globalConsentedAt).toBeGreaterThanOrEqual(before)
      expect(gate.isGloballyConsented()).toBe(true)
    })

    it('revokeGlobalConsent clears state and tokens', () => {
      gate.giveGlobalConsent()
      gate.issueApprovalToken('example.com')
      gate.revokeGlobalConsent()
      const state = gate.getState()
      expect(state.globalConsented).toBe(false)
      expect(state.globalConsentedAt).toBeNull()
    })

    it('policy version mismatch revokes consent effectively', () => {
      const g = new ConsentGate(
        { globalConsented: true, globalConsentedAt: 1, policyVersion: 1 },
        2
      )
      expect(g.isGloballyConsented()).toBe(false)
    })
  })

  describe('approval tokens', () => {
    it('issues a token bound to domain', () => {
      const token = gate.issueApprovalToken('paid.example.com')
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(8)
      expect(gate.validateApprovalToken(token, 'paid.example.com')).toBe(true)
    })

    it('token domain mismatch fails', () => {
      const token = gate.issueApprovalToken('paid.example.com')
      expect(gate.validateApprovalToken(token, 'other.example.com')).toBe(false)
    })

    it('consumed token cannot be reused', () => {
      const token = gate.issueApprovalToken('paid.example.com')
      gate.consumeApprovalToken(token)
      expect(gate.validateApprovalToken(token, 'paid.example.com')).toBe(false)
    })

    it('expired token is rejected', () => {
      const token = gate.issueApprovalToken('paid.example.com', -1)
      expect(gate.validateApprovalToken(token, 'paid.example.com')).toBe(false)
    })

    it('clearAllTokens invalidates outstanding tokens', () => {
      const t1 = gate.issueApprovalToken('a.example.com')
      const t2 = gate.issueApprovalToken('b.example.com')
      gate.clearAllTokens()
      expect(gate.validateApprovalToken(t1, 'a.example.com')).toBe(false)
      expect(gate.validateApprovalToken(t2, 'b.example.com')).toBe(false)
    })

    it('domain matching is case-insensitive', () => {
      const token = gate.issueApprovalToken('Mixed.Case.Example.com')
      expect(gate.validateApprovalToken(token, 'mixed.case.example.com')).toBe(true)
    })
  })
})
