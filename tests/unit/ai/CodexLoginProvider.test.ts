/**
 * Sprint 014 M1 / M3-6 — CodexLoginProvider 단위 테스트.
 *
 * M3-6 변경: chatgpt.com/backend-api/codex/responses endpoint + Responses API +
 * ChatGPT-Account-Id 헤더 + OAI-Product-Sku.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CodexLoginProvider,
  type CodexTokenAccess
} from '../../../src/ai/providers/CodexLoginProvider'
import { DeviceCodeFlow, type TokenBundle } from '../../../src/ai/codex/DeviceCodeFlow'
import { ProviderError } from '../../../src/ai/ProviderAdapter'
import type { TranslationInput } from '../../../src/ai/types'

/**
 * `https://api.openai.com/auth.chatgpt_account_id` 가 들어간 가짜 JWT 생성.
 * header.payload.signature 형식.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function bundleWithAccount(accountId = 'acct_test_123', overrides: Partial<TokenBundle> = {}): TokenBundle {
  const now = Date.now()
  const jwt = makeJwt({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    exp: Math.floor((now + 3600 * 1000) / 1000)
  })
  return {
    idToken: 'id_test',
    accessToken: jwt,
    refreshToken: 'ref_test',
    issuedAt: now,
    expiresAt: now + 3600 * 1000,
    ...overrides
  }
}

function makeTokenAccess(initial: TokenBundle): {
  access: CodexTokenAccess
  current: () => TokenBundle
  updates: TokenBundle[]
} {
  let stored = initial
  const updates: TokenBundle[] = []
  return {
    access: {
      get: () => stored,
      update: (b) => {
        stored = b
        updates.push(b)
      }
    },
    current: () => stored,
    updates
  }
}

function responsesJson(text: string, model = 'gpt-5.5'): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_x',
      model,
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text }]
        }
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function responsesJsonNewFormat(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_y',
      model: 'gpt-5.5',
      output_text: text,
      usage: { input_tokens: 8, output_tokens: 3 }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function emptyResp(status: number): Response {
  return new Response('', { status })
}

const baseInput: TranslationInput = {
  sourceText: 'Hello',
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  requestType: 'selection'
}

describe('CodexLoginProvider (M3-6 responses API)', () => {
  it('정상 호출 — endpoint + 헤더 + body 정합', async () => {
    const { access } = makeTokenAccess(bundleWithAccount('acct_abc'))
    const fetchImpl = vi.fn().mockResolvedValueOnce(responsesJson('안녕'))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    const out = await provider.translate(baseInput)
    expect(out.translatedText).toBe('안녕')
    expect(out.estimatedCostUsd).toBe(0)
    expect(out.inputTokens).toBe(10)

    const [url, opts] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(opts.headers.Authorization).toMatch(/^Bearer /)
    expect(opts.headers['ChatGPT-Account-Id']).toBe('acct_abc')
    expect(opts.headers['OAI-Product-Sku']).toBe('codex')
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('gpt-5.5')
    // Sprint 014 M3-8/9: instructions(system prompt) + input(list, Responses API 표준)
    expect(typeof body.instructions).toBe('string')
    expect(body.instructions.length).toBeGreaterThan(0)
    expect(Array.isArray(body.input)).toBe(true)
    expect(body.input[0].type).toBe('message')
    expect(body.input[0].role).toBe('user')
    expect(body.input[0].content[0].type).toBe('input_text')
    expect(typeof body.input[0].content[0].text).toBe('string')
    expect(body.stream).toBe(false)
  })

  it('신규 형식 (output_text) 응답 파싱', async () => {
    const { access } = makeTokenAccess(bundleWithAccount())
    const fetchImpl = vi.fn().mockResolvedValueOnce(responsesJsonNewFormat('Hi-text'))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    const out = await provider.translate(baseInput)
    expect(out.translatedText).toBe('Hi-text')
  })

  it('JWT에 account_id 없으면 ProviderError', async () => {
    const noAccountJwt = makeJwt({ 'https://api.openai.com/auth': {} })
    const now = Date.now()
    const { access } = makeTokenAccess({
      idToken: 'i',
      accessToken: noAccountJwt,
      refreshToken: 'r',
      issuedAt: now,
      expiresAt: now + 3600 * 1000
    })
    const fetchImpl = vi.fn()
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    await expect(provider.translate(baseInput)).rejects.toMatchObject({ code: 'auth_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('만료 60초 이내 → 자동 refresh 후 호출', async () => {
    const expiring = bundleWithAccount('acct_old', {
      issuedAt: Date.now() - 3500 * 1000,
      expiresAt: Date.now() + 30 * 1000
    })
    const { access, updates } = makeTokenAccess(expiring)
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(bundleWithAccount('acct_new'))
    const fetchImpl = vi.fn().mockResolvedValueOnce(responsesJson('OK'))
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    await provider.translate(baseInput)
    expect(updates.length).toBe(1)
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers['ChatGPT-Account-Id']).toBe('acct_new')
  })

  it('401 → refresh 후 재시도 성공', async () => {
    const { access, updates } = makeTokenAccess(bundleWithAccount())
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(bundleWithAccount('acct_new'))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(emptyResp(401))
      .mockResolvedValueOnce(responsesJson('OK'))
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    const out = await provider.translate(baseInput)
    expect(out.translatedText).toBe('OK')
    expect(updates.length).toBe(1)
    expect(fetchImpl.mock.calls.length).toBe(2)
  })

  it('401 → refresh 실패 → ProviderError auth_invalid', async () => {
    const { access } = makeTokenAccess(bundleWithAccount())
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockRejectedValue(new Error('refresh 401'))
    const fetchImpl = vi.fn().mockResolvedValue(emptyResp(401))
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    try {
      await provider.translate(baseInput)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code).toBe('auth_invalid')
    }
  })

  it('429 → ProviderError rate_limit (한국어 메시지)', async () => {
    const { access } = makeTokenAccess(bundleWithAccount())
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResp(429))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    try {
      await provider.translate(baseInput)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as ProviderError).code).toBe('rate_limit')
      expect((err as ProviderError).message).toContain('ChatGPT')
    }
  })

  it('500 → ProviderError server_error', async () => {
    const { access } = makeTokenAccess(bundleWithAccount())
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResp(500))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    await expect(provider.translate(baseInput)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('info — providerType + Experimental + 모델 카탈로그', () => {
    const { access } = makeTokenAccess(bundleWithAccount())
    const provider = new CodexLoginProvider({ tokenAccess: access })
    expect(provider.info.providerType).toBe('codex')
    expect(provider.info.displayName).toContain('Experimental')
    expect(provider.info.defaultModel).toBe('gpt-5.5')
  })
})
