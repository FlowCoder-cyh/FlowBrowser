/**
 * Sprint 015 M4-4 — IndexingGate 단위 테스트.
 * PRD §8.6 / §13.2.2 / §13.5 정합.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { IndexingGate } from '../../../src/privacy/IndexingGate'
import type { PrivacyExclusionRule } from '../../../src/privacy/types'

describe('IndexingGate', () => {
  describe('디폴트 도메인 차단 (DomainFilter 13패턴 + icloud 1패턴)', () => {
    const gate = new IndexingGate()

    it('mail.* 차단', () => {
      const r = gate.evaluate({ url: 'https://mail.example.com/inbox', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('domain')
      expect(r.matchedBy).toBe('default_domain')
      expect(r.matchedPattern).toBeTruthy()
    })

    it('accounts.* / signin.* / login.* / oauth.* / id.* 차단', () => {
      for (const host of [
        'accounts.google.com',
        'signin.aws.amazon.com',
        'login.salesforce.com',
        'oauth.discord.com',
        'id.heroku.com'
      ]) {
        const r = gate.evaluate({ url: `https://${host}/`, hasPasswordField: false })
        expect(r.allowed, host).toBe(false)
        expect(r.blockReason, host).toBe('domain')
      }
    })

    it('payment.* / pay.* / checkout.* 차단', () => {
      for (const host of ['payment.example.com', 'pay.example.com', 'checkout.shopify.com']) {
        expect(gate.evaluate({ url: `https://${host}/`, hasPasswordField: false }).allowed).toBe(
          false
        )
      }
    })

    it('*.bank / gmail.com / paypal.com 차단', () => {
      expect(
        gate.evaluate({ url: 'https://something.bank/', hasPasswordField: false }).allowed
      ).toBe(false)
      expect(gate.evaluate({ url: 'https://gmail.com/', hasPasswordField: false }).allowed).toBe(
        false
      )
      expect(gate.evaluate({ url: 'https://paypal.com/', hasPasswordField: false }).allowed).toBe(
        false
      )
    })

    it('*.icloud.com 차단 (IndexingGate 전용 추가 패턴)', () => {
      const r = gate.evaluate({ url: 'https://www.icloud.com/', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('domain')
      expect(r.matchedBy).toBe('default_domain')
    })

    it('일반 도메인 통과', () => {
      for (const host of ['blog.medium.com', 'github.com', 'youtube.com']) {
        const r = gate.evaluate({ url: `https://${host}/`, hasPasswordField: false })
        expect(r.allowed, host).toBe(true)
        expect(r.blockReason, host).toBe('none')
      }
    })
  })

  describe('path glob 차단 (*.naver.com/mail/*)', () => {
    const gate = new IndexingGate()

    it('cafe.naver.com/mail/... 차단 (도메인 mail.* 패턴에 안 잡히는 hostname + /mail path)', () => {
      const r = gate.evaluate({
        url: 'https://cafe.naver.com/mail/folder/1',
        hasPasswordField: false
      })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('path')
      expect(r.matchedBy).toBe('default_path')
      expect(r.matchedPattern).toBe('*.naver.com/mail/*')
    })

    it('naver.com/mail 정확 매치 차단', () => {
      const r = gate.evaluate({ url: 'https://naver.com/mail', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('path')
    })

    it('naver.com/news 다른 path 통과', () => {
      const r = gate.evaluate({ url: 'https://news.naver.com/article/1', hasPasswordField: false })
      expect(r.allowed).toBe(true)
    })

    it('다른 도메인의 /mail path 통과', () => {
      const r = gate.evaluate({ url: 'https://example.com/mail/inbox', hasPasswordField: false })
      expect(r.allowed).toBe(true)
    })
  })

  describe('비밀번호 필드 감지', () => {
    const gate = new IndexingGate()

    it('hasPasswordField=true 차단', () => {
      const r = gate.evaluate({ url: 'https://example.com/login', hasPasswordField: true })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('password')
      expect(r.matchedBy).toBe('password_field')
    })

    it('도메인+패스워드 둘 다 매칭 시 도메인 우선', () => {
      const r = gate.evaluate({ url: 'https://login.example.com/', hasPasswordField: true })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('domain') // 도메인 우선
    })
  })

  describe('사용자 명시 차단/허용 (privacyExclusions)', () => {
    let exclusions: PrivacyExclusionRule[]
    let gate: IndexingGate

    beforeEach(() => {
      exclusions = []
      gate = new IndexingGate({ getUserExclusions: () => exclusions })
    })

    it('사용자 추가 차단 — 디폴트는 통과하지만 user_block', () => {
      exclusions = [{ pattern: 'github.com', type: 'block' }]
      const r = gate.evaluate({ url: 'https://github.com/repo', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('user_block')
      expect(r.matchedBy).toBe('user_block')
      expect(r.matchedPattern).toBe('github.com')
    })

    it('사용자 허용 — 디폴트 도메인 차단 해제', () => {
      exclusions = [{ pattern: 'gmail.com', type: 'allow' }]
      const r = gate.evaluate({ url: 'https://gmail.com/', hasPasswordField: false })
      expect(r.allowed).toBe(true)
      expect(r.blockReason).toBe('none')
    })

    it('와일드카드 패턴 (*.example.com) 차단 매칭', () => {
      exclusions = [{ pattern: '*.example.com', type: 'block' }]
      expect(
        gate.evaluate({ url: 'https://example.com/', hasPasswordField: false }).allowed
      ).toBe(false)
      expect(
        gate.evaluate({ url: 'https://sub.example.com/', hasPasswordField: false }).allowed
      ).toBe(false)
      expect(gate.evaluate({ url: 'https://other.com/', hasPasswordField: false }).allowed).toBe(
        true
      )
    })

    it('user_block 이 user_allow 보다 우선 (block 먼저 평가)', () => {
      exclusions = [
        { pattern: 'gmail.com', type: 'allow' },
        { pattern: 'gmail.com', type: 'block' }
      ]
      const r = gate.evaluate({ url: 'https://gmail.com/', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('user_block')
    })

    it('사용자 허용 시 password 필드 감지는 무력 (사용자 명시 신뢰)', () => {
      exclusions = [{ pattern: 'gmail.com', type: 'allow' }]
      const r = gate.evaluate({ url: 'https://gmail.com/', hasPasswordField: true })
      expect(r.allowed).toBe(true)
    })
  })

  describe('사용자 override token (1회 소비)', () => {
    let gate: IndexingGate

    beforeEach(() => {
      gate = new IndexingGate()
    })

    it('override token 발급 + 1회 소비 → allowed', () => {
      const url = 'https://gmail.com/inbox'
      const token = gate.issueOverrideToken(url)
      const r = gate.evaluate({ url, hasPasswordField: false, overrideToken: token })
      expect(r.allowed).toBe(true)
      expect(r.matchedBy).toBe('override')
    })

    it('동일 token 재사용 거부 (1회 소비)', () => {
      const url = 'https://gmail.com/inbox'
      const token = gate.issueOverrideToken(url)
      const r1 = gate.evaluate({ url, hasPasswordField: false, overrideToken: token })
      expect(r1.allowed).toBe(true)
      const r2 = gate.evaluate({ url, hasPasswordField: false, overrideToken: token })
      expect(r2.allowed).toBe(false) // 토큰 소비 후 → 디폴트 차단 복귀
      expect(r2.blockReason).toBe('domain')
    })

    it('token URL 불일치 → 거부', () => {
      const token = gate.issueOverrideToken('https://gmail.com/inbox')
      const r = gate.evaluate({
        url: 'https://gmail.com/different',
        hasPasswordField: false,
        overrideToken: token
      })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('domain')
    })

    it('TTL 만료 → 거부', () => {
      const shortGate = new IndexingGate({ overrideTtlMs: 1 })
      const url = 'https://gmail.com/inbox'
      const token = shortGate.issueOverrideToken(url)
      // 동기 대기 — 1ms 만료 보장 위해 busy loop
      const start = Date.now()
      while (Date.now() - start < 5) {
        // wait
      }
      const r = shortGate.evaluate({ url, hasPasswordField: false, overrideToken: token })
      expect(r.allowed).toBe(false)
      expect(shortGate.activeOverrideCount()).toBe(0)
    })

    it('사용자 명시 차단(user_block)은 override 보다 우선 (보안)', () => {
      const blockGate = new IndexingGate({
        getUserExclusions: () => [{ pattern: 'gmail.com', type: 'block' }]
      })
      const token = blockGate.issueOverrideToken('https://gmail.com/inbox')
      const r = blockGate.evaluate({
        url: 'https://gmail.com/inbox',
        hasPasswordField: false,
        overrideToken: token
      })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('user_block')
    })

    it('clearOverrideTokens / activeOverrideCount', () => {
      gate.issueOverrideToken('https://a.example.com/')
      gate.issueOverrideToken('https://b.example.com/')
      expect(gate.activeOverrideCount()).toBe(2)
      gate.clearOverrideTokens()
      expect(gate.activeOverrideCount()).toBe(0)
    })
  })

  describe('URL 파싱 엣지 케이스', () => {
    const gate = new IndexingGate()

    it('잘못된 URL 차단', () => {
      const r = gate.evaluate({ url: 'not-a-url', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.matchedPattern).toBe('<invalid-url>')
    })

    it('file:// 스킴 차단 (http/https 만 허용)', () => {
      const r = gate.evaluate({ url: 'file:///etc/passwd', hasPasswordField: false })
      expect(r.allowed).toBe(false)
    })

    it('hostname 대소문자 무시', () => {
      const r = gate.evaluate({ url: 'https://GMAIL.com/', hasPasswordField: false })
      expect(r.allowed).toBe(false)
      expect(r.blockReason).toBe('domain')
    })
  })
})
