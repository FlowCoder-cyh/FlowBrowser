/**
 * Sprint 015 M2-7 — ProviderAdapter v0.4 확장 (chat / embed) 단위 테스트.
 *
 * 검증:
 *   - OpenAIApiKeyProvider.chat() — chat completions API 호출 / 응답 파싱 / 비용 계산
 *   - OpenAIApiKeyProvider.embed() — embeddings API 호출 / 벡터 정렬 / 비용 계산 / 1024 차원
 *   - CodexLoginProvider.chat() — Responses API + multi-turn input 변환 / system → instructions 분리
 *   - CodexLoginProvider.embed() — unsupported throw
 *   - 에러 매핑 (401/429/5xx → ProviderError code)
 *   - ProviderInfo.supportsChat / supportsEmbed flag 정합
 */

import { describe, it, expect, vi } from 'vitest'
import { OpenAIApiKeyProvider } from '../../../src/ai/providers/OpenAIApiKeyProvider'
import {
  CodexLoginProvider,
  type CodexTokenAccess
} from '../../../src/ai/providers/CodexLoginProvider'
import { DeviceCodeFlow, type TokenBundle } from '../../../src/ai/codex/DeviceCodeFlow'
import { ProviderError } from '../../../src/ai/ProviderAdapter'

// Helper: chat completions API mock 응답
function chatResponseBody(text: string, model = 'gpt-4o-mini') {
  return {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    model
  }
}

// Helper: embeddings API mock 응답 (vectors[i] 길이 = dimensions)
function embedResponseBody(
  vectors: number[][],
  model = 'text-embedding-3-small',
  inputTokens = 200
) {
  return {
    data: vectors.map((embedding, index) => ({ embedding, index })),
    model,
    usage: { prompt_tokens: inputTokens, total_tokens: inputTokens }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('OpenAIApiKeyProvider — chat (M2-7)', () => {
  it('ProviderInfo.supportsChat / supportsEmbed 모두 true', () => {
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    expect(p.info.supportsChat).toBe(true)
    expect(p.info.supportsEmbed).toBe(true)
  })

  it('chat 호출 시 chat/completions endpoint + messages payload 전달 + 응답 파싱', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('hello world')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    const res = await p.chat!({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' }
      ],
      temperature: 0.5,
      maxOutputTokens: 256
    })
    expect(res.text).toBe('hello world')
    expect(res.inputTokens).toBe(100)
    expect(res.outputTokens).toBe(50)
    expect(res.modelUsed).toBe('gpt-4o-mini')
    expect(res.estimatedCostUsd).toBeGreaterThan(0)
    // payload 검증
    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toContain('/chat/completions')
    const body = JSON.parse(String((call[1] as RequestInit)?.body))
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toHaveLength(2)
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(256)
    expect(body.stream).toBe(false)
    // Sprint 016 M0 T04 (KI-004) — responseFormat 미주입 시 response_format 미설정
    expect(body.response_format).toBeUndefined()
    fetchSpy.mockRestore()
  })

  it('KI-004 — responseFormat=json_object 시 body 에 response_format: { type: json_object } 전달', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('{"tags":[]}')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await p.chat!({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: 'json_object'
    })
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit)?.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    fetchSpy.mockRestore()
  })

  it('KI-004 — responseFormat=text 시 body 에 response_format 미설정 (기본 free text)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('plain text')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await p.chat!({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: 'text'
    })
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit)?.body))
    expect(body.response_format).toBeUndefined()
    fetchSpy.mockRestore()
  })

  it('chat 호출 시 빈 messages 는 ProviderError(bad_request) throw', async () => {
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.chat!({ messages: [] })).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'bad_request'
    })
  })

  it('chat 401 → ProviderError(auth_invalid)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.chat!({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'auth_invalid'
    })
    fetchSpy.mockRestore()
  })

  it('chat 429 → ProviderError(rate_limit) + retryable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    try {
      await p.chat!({ messages: [{ role: 'user', content: 'hi' }] })
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code).toBe('rate_limit')
      expect((err as ProviderError).retryable).toBe(true)
    }
    fetchSpy.mockRestore()
  })

  it('chat 500 → ProviderError(server_error)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'oops' }, 500))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.chat!({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'server_error'
    })
    fetchSpy.mockRestore()
  })

  it('chat 빈 응답 텍스트 → ProviderError(server_error)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('   ')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.chat!({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'server_error'
    })
    fetchSpy.mockRestore()
  })

  it('chat modelHint 가 AVAILABLE_MODELS 일치 시 모델 전달, 미일치 시 디폴트 fallback', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('ok', 'gpt-4o')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await p.chat!({ modelHint: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).model).toBe('gpt-4o')

    fetchSpy.mockResolvedValueOnce(jsonResponse(chatResponseBody('ok')))
    await p.chat!({ modelHint: 'unknown-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body)).model).toBe(
      'gpt-4o-mini'
    )
    fetchSpy.mockRestore()
  })
})

describe('OpenAIApiKeyProvider — embed (M2-7)', () => {
  it('embed 호출 시 embeddings endpoint + texts + dimensions=1024 payload', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(embedResponseBody([Array(1024).fill(0.01), Array(1024).fill(0.02)]))
      )
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    const res = await p.embed!({ texts: ['hello', 'world'] })
    expect(res.vectors).toHaveLength(2)
    expect(res.vectors[0]).toHaveLength(1024)
    expect(res.modelUsed).toBe('text-embedding-3-small')
    expect(res.inputTokens).toBe(200)
    expect(res.estimatedCostUsd).toBeGreaterThan(0)
    // payload 검증
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('text-embedding-3-small')
    expect(body.input).toEqual(['hello', 'world'])
    expect(body.dimensions).toBe(1024)
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/embeddings')
    fetchSpy.mockRestore()
  })

  it('embed 응답이 index 순서가 뒤섞여도 정렬 후 반환', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        data: [
          { embedding: [3], index: 2 },
          { embedding: [1], index: 0 },
          { embedding: [2], index: 1 }
        ],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      })
    )
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    const res = await p.embed!({ texts: ['a', 'b', 'c'] })
    expect(res.vectors).toEqual([[1], [2], [3]])
    fetchSpy.mockRestore()
  })

  it('embed 응답 길이 불일치 → ProviderError(server_error)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(embedResponseBody([[0.1]]))) // 1개만 응답
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.embed!({ texts: ['a', 'b'] })).rejects.toMatchObject({
      code: 'server_error'
    })
    fetchSpy.mockRestore()
  })

  it('embed 빈 texts → ProviderError(bad_request)', async () => {
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.embed!({ texts: [] })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('embed 401 → ProviderError(auth_invalid)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await expect(p.embed!({ texts: ['a'] })).rejects.toMatchObject({ code: 'auth_invalid' })
    fetchSpy.mockRestore()
  })

  it('embed 비용 추정 — text-embedding-3-small $0.02/M (2026-05-16 공식)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(embedResponseBody([[0.1]], 'text-embedding-3-small', 1_000_000)))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    const res = await p.embed!({ texts: ['a'] })
    // 1M tokens × $0.02/M = $0.02
    expect(res.estimatedCostUsd).toBeCloseTo(0.02, 6)
    fetchSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function bundleWithAccount(accountId = 'acct_test_xyz'): TokenBundle {
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
    expiresAt: now + 3600 * 1000
  }
}

function tokenAccess(bundle: TokenBundle): CodexTokenAccess {
  let current = bundle
  return {
    get: () => current,
    update: (b) => {
      current = b
    }
  }
}

// SSE 응답 ReadableStream 생성 (accumulateResponsesStream 호환 형식 최소).
function makeSseStream(textChunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const t of textChunks) {
        const event = `data: ${JSON.stringify({
          type: 'response.output_text.delta',
          delta: t
        })}\n\n`
        controller.enqueue(encoder.encode(event))
      }
      const done = `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          model: 'gpt-5.5',
          usage: { input_tokens: 30, output_tokens: 10 }
        }
      })}\n\n`
      controller.enqueue(encoder.encode(done))
      controller.close()
    }
  })
}

describe('CodexLoginProvider — chat (M2-7)', () => {
  it('ProviderInfo.supportsChat true / supportsEmbed false', () => {
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const p = new CodexLoginProvider({
      tokenAccess: tokenAccess(bundleWithAccount()),
      flow,
      fetchImpl: vi.fn()
    })
    expect(p.info.supportsChat).toBe(true)
    expect(p.info.supportsEmbed).toBe(false)
  })

  it('chat 호출 시 Responses API 호출 + system → instructions / user → input 분리', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(makeSseStream(['hi ', 'there']), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    )
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const p = new CodexLoginProvider({
      tokenAccess: tokenAccess(bundleWithAccount()),
      flow,
      fetchImpl
    })
    const res = await p.chat!({
      messages: [
        { role: 'system', content: 'sys1' },
        { role: 'system', content: 'sys2' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' }
      ]
    })
    expect(res.text).toBe('hi there')
    expect(res.modelUsed).toBe('gpt-5.5')
    expect(res.estimatedCostUsd).toBe(0) // 구독 한도 내 0
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expect(String(call[0])).toContain('/responses')
    const body = JSON.parse(String((call[1] as RequestInit).body))
    expect(body.instructions).toBe('sys1\n\nsys2')
    expect(body.input).toHaveLength(3) // user/assistant/user
    expect(body.input[0].role).toBe('user')
    expect(body.input[0].content[0].text).toBe('q1')
    expect(body.input[1].role).toBe('assistant')
    expect(body.input[1].content[0].type).toBe('output_text')
    expect(body.input[2].role).toBe('user')
    expect(body.input[2].content[0].text).toBe('q2')
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
  })

  it('chat 빈 messages → ProviderError(bad_request)', async () => {
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const p = new CodexLoginProvider({
      tokenAccess: tokenAccess(bundleWithAccount()),
      flow,
      fetchImpl: vi.fn()
    })
    await expect(p.chat!({ messages: [] })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('chat 429 → ProviderError(rate_limit) + retryable', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const p = new CodexLoginProvider({
      tokenAccess: tokenAccess(bundleWithAccount()),
      flow,
      fetchImpl
    })
    try {
      await p.chat!({ messages: [{ role: 'user', content: 'q' }] })
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code).toBe('rate_limit')
      expect((err as ProviderError).retryable).toBe(true)
    }
  })

  // M2-7 codex 핫픽스 — Codex chat 401 → refresh 1회 재시도 + 성공 path (translate 와 동일 패턴 정합)
  it('chat 401 → refresh 1회 재시도 + 성공 시 정상 응답 반환', async () => {
    const refreshed = bundleWithAccount('acct_refreshed_456')
    const access = tokenAccess(bundleWithAccount())
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const refreshSpy = vi.spyOn(flow, 'refreshTokens').mockResolvedValueOnce(refreshed)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(makeSseStream(['ok']), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        })
      )
    const p = new CodexLoginProvider({
      tokenAccess: access,
      flow,
      fetchImpl
    })
    const res = await p.chat!({ messages: [{ role: 'user', content: 'q' }] })
    expect(res.text).toBe('ok')
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // 두 번째 호출은 refresh 된 토큰 / account_id 로
    const secondCallHeaders = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(secondCallHeaders['ChatGPT-Account-Id']).toBe('acct_refreshed_456')
    expect(access.get().accessToken).toBe(refreshed.accessToken)
    refreshSpy.mockRestore()
  })
})

describe('CodexLoginProvider — embed (M2-7)', () => {
  it('embed 호출 시 항상 ProviderError(unsupported) throw — ChatGPT 백엔드 임베딩 미지원', async () => {
    const flow = new DeviceCodeFlow({ fetchImpl: vi.fn() })
    const p = new CodexLoginProvider({
      tokenAccess: tokenAccess(bundleWithAccount()),
      flow,
      fetchImpl: vi.fn()
    })
    await expect(p.embed!({ texts: ['hello'] })).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'unsupported'
    })
  })
})

// Sprint 016 M2 T13 — fetchImpl 통일. OpenAIApiKeyProvider 가 CodexLoginProvider 와 동일 패턴 (constructor 옵션 + default globalThis.fetch).
describe('OpenAIApiKeyProvider — fetchImpl 주입 (T13)', () => {
  it('constructor fetchImpl 미주입 시 globalThis.fetch 사용 (호환)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('hi')))
    const p = new OpenAIApiKeyProvider(() => 'sk-test')
    await p.chat!({ messages: [{ role: 'user', content: 'x' }] })
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockRestore()
  })

  it('constructor fetchImpl 주입 시 그것만 사용 (globalThis.fetch 미호출)', async () => {
    const injected = vi.fn().mockResolvedValueOnce(jsonResponse(chatResponseBody('hi')))
    const globalSpy = vi.spyOn(globalThis, 'fetch')
    const p = new OpenAIApiKeyProvider(() => 'sk-test', {
      fetchImpl: injected as unknown as typeof fetch
    })
    await p.chat!({ messages: [{ role: 'user', content: 'x' }] })
    expect(injected).toHaveBeenCalledOnce()
    expect(globalSpy).not.toHaveBeenCalled()
    globalSpy.mockRestore()
  })

  it('validate / chat / embed 모두 주입된 fetchImpl 사용 (3 endpoint 일관성, T09 후)', async () => {
    // Sprint 016 M2 T09 — translate() 메서드 폐기로 4 endpoint → 3 endpoint.
    const injected = vi
      .fn()
      // validate
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      // chat (selection 번역도 chat 으로 통합)
      .mockResolvedValueOnce(jsonResponse(chatResponseBody('대답')))
      // embed
      .mockResolvedValueOnce(jsonResponse(embedResponseBody([[0.1, 0.2]])))
    const p = new OpenAIApiKeyProvider(() => 'sk-test', {
      fetchImpl: injected as unknown as typeof fetch
    })
    await p.validate()
    await p.chat!({ messages: [{ role: 'user', content: 'hi' }] })
    await p.embed!({ texts: ['hi'], dimensions: 2 })
    expect(injected).toHaveBeenCalledTimes(3)
  })
})
