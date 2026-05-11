import { describe, it, expect } from 'vitest'
import {
  matchesCardHint,
  detectCardPatternInText,
  detectSensitiveFieldsScript
} from '../../../src/privacy/SensitiveFieldDetector'

describe('SensitiveFieldDetector', () => {
  describe('matchesCardHint', () => {
    it('matches common card field hints', () => {
      expect(matchesCardHint('cc-num')).toBe(true)
      expect(matchesCardHint('card-number')).toBe(true)
      expect(matchesCardHint('card_num')).toBe(true)
      expect(matchesCardHint('cvv')).toBe(true)
      expect(matchesCardHint('cvc')).toBe(true)
      expect(matchesCardHint('expiry-date')).toBe(true)
      expect(matchesCardHint('exp_month')).toBe(true)
      expect(matchesCardHint('expiry_year')).toBe(true)
      expect(matchesCardHint('payment-input')).toBe(true)
      expect(matchesCardHint('credit-card')).toBe(true)
    })

    it('does not match unrelated names', () => {
      expect(matchesCardHint('username')).toBe(false)
      expect(matchesCardHint('email')).toBe(false)
      expect(matchesCardHint('zip-code')).toBe(false)
    })

    it('is case-insensitive', () => {
      expect(matchesCardHint('CC-NUM')).toBe(true)
      expect(matchesCardHint('Card-Number')).toBe(true)
    })
  })

  describe('detectCardPatternInText', () => {
    it('detects 16-digit card-like numbers with spaces', () => {
      expect(detectCardPatternInText('4242 4242 4242 4242')).toBe(true)
    })

    it('detects 16-digit card-like numbers with dashes', () => {
      expect(detectCardPatternInText('4242-4242-4242-4242')).toBe(true)
    })

    it('detects 13-19 digit pure number string', () => {
      expect(detectCardPatternInText('4242424242424242')).toBe(true)
    })

    it('does not flag short numbers', () => {
      expect(detectCardPatternInText('1234')).toBe(false)
      expect(detectCardPatternInText('phone 010-1234-5678')).toBe(false)
    })

    it('does not flag plain text', () => {
      expect(detectCardPatternInText('hello world')).toBe(false)
      expect(detectCardPatternInText('translate this sentence to Korean')).toBe(false)
    })
  })

  describe('detectSensitiveFieldsScript', () => {
    it('returns an immediately-invoked function expression string', () => {
      const script = detectSensitiveFieldsScript()
      expect(typeof script).toBe('string')
      expect(script.startsWith('(')).toBe(true)
      expect(script.endsWith(')()')).toBe(true)
      expect(script).toContain('input[type="password"]')
    })
  })
})
