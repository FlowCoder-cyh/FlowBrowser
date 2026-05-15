/**
 * Sprint 014 M1 — CodexLoginProvider 단위 테스트.
 * fetch + DeviceCodeFlow refresh 모킹으로 401 refresh 재시도 경로 검증.
 */
import { describe, it, expect, vi } from 'vitest'
import { CodexLoginProvider, type CodexTokenAccess } from '../../../src/ai/providers/CodexLoginProvider'
import { DeviceCodeFlow, type TokenBundle } from '../../../src/ai/codex/DeviceCodeFlow'
import { ProviderError } from '../../../src/ai/ProviderAdapter'
import type { TranslationInput } from '../../../src/ai/types'

function bundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  const now = Date.now()
  return {
    idToken: 'id_a',
    accessToken: 'acc_a',
    refreshToken: 'ref_a',
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

function chatJson(text: string, model = 'gpt-4o-mini'): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model
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

describe('CodexLoginProvider', () => {
  it('정상 호출 — translate 결과 반환 (estimatedCostUsd=0)', async () => {
    const { access } = makeTokenAccess(bundle())
    const fetchImpl = vi.fn().mockResolvedValueOnce(chatJson('안녕'))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    const out = await provider.translate(baseInput)
    expect(out.translatedText).toBe('안녕')
    expect(out.estimatedCostUsd).toBe(0) // Phase 1 PoC #1 측정 전까지 0
    expect(out.inputTokens).toBe(10)
  })

  it('만료 60초 이내 → 자동 refresh 후 호출', async () => {
    const expiring = bundle({
      issuedAt: Date.now() - 3500 * 1000,
      expiresAt: Date.now() + 30 * 1000 // 30초 후 만료 → refresh 트리거
    })
    const { access, updates } = makeTokenAccess(expiring)
    // refresh 시 새 토큰 반환
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(bundle({ accessToken: 'acc_new' }))
    const fetchImpl = vi.fn().mockResolvedValueOnce(chatJson('OK'))
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    await provider.translate(baseInput)
    // refresh 호출됨 + 새 토큰 저장
    expect(updates.length).toBe(1)
    expect(updates[0].accessToken).toBe('acc_new')
    // chat 호출은 새 토큰으로
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer acc_new')
  })

  it('401 → refresh 후 재시도 (1차 성공)', async () => {
    const { access, updates } = makeTokenAccess(bundle())
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(bundle({ accessToken: 'acc_new' }))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(emptyResp(401)) // 1차 401
      .mockResolvedValueOnce(chatJson('OK')) // 재시도 성공
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    const out = await provider.translate(baseInput)
    expect(out.translatedText).toBe('OK')
    expect(updates.length).toBe(1)
    expect(fetchImpl.mock.calls.length).toBe(2)
  })

  it('401 → refresh 실패 → ProviderError auth_invalid', async () => {
    const { access } = makeTokenAccess(bundle())
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

  it('401 → refresh 성공이지만 재시도도 401 → ProviderError', async () => {
    const { access } = makeTokenAccess(bundle())
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(bundle({ accessToken: 'acc_new' }))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(emptyResp(401))
      .mockResolvedValueOnce(emptyResp(401))
    const provider = new CodexLoginProvider({ tokenAccess: access, flow, fetchImpl })
    await expect(provider.translate(baseInput)).rejects.toMatchObject({
      code: 'auth_invalid'
    })
  })

  it('429 → ProviderError rate_limit', async () => {
    const { access } = makeTokenAccess(bundle())
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResp(429))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    await expect(provider.translate(baseInput)).rejects.toMatchObject({ code: 'rate_limit' })
  })

  it('500 → ProviderError server_error', async () => {
    const { access } = makeTokenAccess(bundle())
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResp(500))
    const provider = new CodexLoginProvider({ tokenAccess: access, fetchImpl })
    await expect(provider.translate(baseInput)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('info: providerType=codex + Experimental displayName', () => {
    const { access } = makeTokenAccess(bundle())
    const provider = new CodexLoginProvider({ tokenAccess: access })
    expect(provider.info.providerType).toBe('codex')
    expect(provider.info.displayName).toContain('Experimental')
  })
})
