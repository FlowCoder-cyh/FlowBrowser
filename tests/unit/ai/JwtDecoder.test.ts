/**
 * Sprint 014 M3-6 — JwtDecoder 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import { resolveCodexAuthIdentity } from '../../../src/ai/codex/JwtDecoder'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('resolveCodexAuthIdentity', () => {
  it('정상 JWT에서 account_id + plan + email 추출', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_abc',
        chatgpt_plan_type: 'plus'
      },
      'https://api.openai.com/profile': { email: 'user@example.com' },
      exp: 9999999999
    })
    const id = resolveCodexAuthIdentity(token)
    expect(id.accountId).toBe('acct_abc')
    expect(id.chatgptPlanType).toBe('plus')
    expect(id.email).toBe('user@example.com')
    expect(id.expiresAtMs).toBe(9999999999 * 1000)
  })

  it('JWT가 아닌 문자열 → 빈 객체', () => {
    expect(resolveCodexAuthIdentity('not-a-jwt')).toEqual({})
  })

  it('파트 2개만 있는 JWT → 빈 객체', () => {
    expect(resolveCodexAuthIdentity('a.b')).toEqual({})
  })

  it('base64 손상 → 빈 객체 (try/catch fallback)', () => {
    expect(resolveCodexAuthIdentity('a.@@@@.c')).toEqual({})
  })

  it('payload에 auth 객체 없음 → 빈 필드', () => {
    const token = makeJwt({ exp: 1000 })
    const id = resolveCodexAuthIdentity(token)
    expect(id.accountId).toBeUndefined()
    expect(id.expiresAtMs).toBe(1000 * 1000)
  })

  it('exp가 문자열 숫자 → 정상 파싱', () => {
    const token = makeJwt({ exp: '1234567890' })
    expect(resolveCodexAuthIdentity(token).expiresAtMs).toBe(1234567890 * 1000)
  })

  it('account_id가 빈 문자열 → undefined', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: '   ' }
    })
    expect(resolveCodexAuthIdentity(token).accountId).toBeUndefined()
  })

  it('exp 0 또는 음수 → undefined', () => {
    expect(resolveCodexAuthIdentity(makeJwt({ exp: 0 })).expiresAtMs).toBeUndefined()
    expect(resolveCodexAuthIdentity(makeJwt({ exp: -100 })).expiresAtMs).toBeUndefined()
  })
})
