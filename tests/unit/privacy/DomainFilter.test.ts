import { describe, it, expect } from 'vitest'
import { DomainFilter, defaultBlacklistPatterns } from '../../../src/privacy/DomainFilter'

describe('DomainFilter', () => {
  describe('defaultBlacklistPatterns', () => {
    it('returns regex patterns', () => {
      const patterns = defaultBlacklistPatterns()
      expect(patterns.length).toBeGreaterThan(0)
      expect(patterns.every((p) => p instanceof RegExp)).toBe(true)
    })
  })

  describe('default blacklist', () => {
    const filter = new DomainFilter()

    it('blocks mail.* domains', () => {
      const result = filter.evaluate('mail.example.com')
      expect(result.blocked).toBe(true)
      expect(result.matchedBy).toBe('default_blacklist')
    })

    it('blocks accounts.* domains', () => {
      expect(filter.evaluate('accounts.google.com').blocked).toBe(true)
      expect(filter.evaluate('account.openai.com').blocked).toBe(true)
    })

    it('blocks payment.* / pay.* / checkout.*', () => {
      expect(filter.evaluate('payment.example.com').blocked).toBe(true)
      expect(filter.evaluate('pay.example.com').blocked).toBe(true)
      expect(filter.evaluate('checkout.shopify.com').blocked).toBe(true)
    })

    it('blocks login.* / signin.* / oauth.* / id.*', () => {
      expect(filter.evaluate('login.salesforce.com').blocked).toBe(true)
      expect(filter.evaluate('signin.aws.amazon.com').blocked).toBe(true)
      expect(filter.evaluate('oauth.discord.com').blocked).toBe(true)
      expect(filter.evaluate('id.heroku.com').blocked).toBe(true)
    })

    it('blocks specific *.bank / gmail.com / paypal.com', () => {
      expect(filter.evaluate('something.bank').blocked).toBe(true)
      expect(filter.evaluate('gmail.com').blocked).toBe(true)
      expect(filter.evaluate('paypal.com').blocked).toBe(true)
    })

    it('allows ordinary domains', () => {
      expect(filter.evaluate('www.example.com').blocked).toBe(false)
      expect(filter.evaluate('blog.medium.com').blocked).toBe(false)
      expect(filter.evaluate('youtube.com').blocked).toBe(false)
    })
  })

  describe('user rules', () => {
    it('user whitelist overrides default blacklist', () => {
      const filter = new DomainFilter({
        userRules: [{ pattern: 'mail.example.com', type: 'whitelist' }]
      })
      const result = filter.evaluate('mail.example.com')
      expect(result.blocked).toBe(false)
      expect(result.matchedBy).toBe('whitelist')
    })

    it('user blacklist blocks otherwise-safe domain', () => {
      const filter = new DomainFilter({
        userRules: [{ pattern: 'evil.example.com', type: 'blacklist' }]
      })
      const result = filter.evaluate('evil.example.com')
      expect(result.blocked).toBe(true)
      expect(result.matchedBy).toBe('user_blacklist')
    })

    it('wildcard *.domain matches subdomains and base', () => {
      const filter = new DomainFilter({
        userRules: [{ pattern: '*.internal.example.com', type: 'blacklist' }]
      })
      expect(filter.evaluate('internal.example.com').blocked).toBe(true)
      expect(filter.evaluate('app.internal.example.com').blocked).toBe(true)
      expect(filter.evaluate('external.example.com').blocked).toBe(false)
    })

    it('addUserRule / removeUserRule mutate state', () => {
      const filter = new DomainFilter()
      filter.addUserRule({ pattern: 'blocked.test', type: 'blacklist' })
      expect(filter.evaluate('blocked.test').blocked).toBe(true)
      filter.removeUserRule('blocked.test', 'blacklist')
      expect(filter.evaluate('blocked.test').blocked).toBe(false)
    })
  })
})
