/**
 * Sprint 017 M3 T14 — Ollama 로컬 LLM provider spike 단위 회귀.
 *   Sprint 018 M2 T17c — embed() 실 구현 회귀 추가 (supportsEmbed=true + `/api/embed`).
 *
 * cover (codex 019e500b T14 / 019e6e00 T17c 권고 매트릭스 정합):
 *   - info — providerType='local' + supportsChat=true + supportsEmbed=true + 디폴트 모델 llama3.2:3b
 *   - validate() — 200 OK / non-200 / fetch throw 3 path
 *   - chat() — 정상 응답 / 404 (모델 미설치) / 429 / 5xx / 4xx / network throw / 빈 messages / format=json
 *   - chat() — modelHint / temperature / maxOutputTokens 매핑 정합
 *   - chat() — token mapping (prompt_eval_count / eval_count) + estimatedCostUsd=0
 *   - embed() — 정상(batch) / endpoint=POST /api/embed / modelHint 디폴트 nomic-embed-text / dimensions 무시
 *               / 빈 texts / 404(모델 미설치) / network / count mismatch / prompt_eval_count fallback
 *   - baseUrl trailing slash strip + 주입 fetchImpl 사용
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OllamaProvider,
  OLLAMA_DEFAULT_BASE_URL
} from '../../../src/ai/providers/OllamaProvider'
import { ProviderError } from '../../../src/ai/ProviderAdapter'

interface FetchSpy {
  fn: ReturnType<typeof vi.fn>
  calls: Array<{ url: string; init?: RequestInit }>
}

function makeFetchSpy(impl: (url: string, init?: RequestInit) => Promise<Response>): FetchSpy {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return impl(url, init)
  })
  return { fn, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('OllamaProvider — info', () => {
  it('providerType=local + supportsChat=true + supportsEmbed=true + defaultModel=llama3.2:3b', () => {
    const p = new OllamaProvider()
    expect(p.info.providerType).toBe('local')
    expect(p.info.supportsChat).toBe(true)
    // Sprint 018 M2 T17c — Schema v06 dimension 분리 위에서 로컬 임베딩 활성.
    expect(p.info.supportsEmbed).toBe(true)
    expect(p.info.defaultModel).toBe('llama3.2:3b')
    expect(p.info.availableModels).toContain('llama3.2:3b')
    expect(p.info.displayName).toBe('Ollama (Local)')
  })

  it('OLLAMA_DEFAULT_BASE_URL = http://localhost:11434', () => {
    expect(OLLAMA_DEFAULT_BASE_URL).toBe('http://localhost:11434')
  })

  it('baseUrl trailing slash strip', () => {
    const spy = makeFetchSpy(async () => jsonResponse({ models: [] }))
    const p = new OllamaProvider({ baseUrl: 'http://x:11434/', fetchImpl: spy.fn })
    void p.validate()
    expect(spy.calls[0]?.url).toBe('http://x:11434/api/tags')
  })
})

describe('OllamaProvider — validate', () => {
  it('200 OK → { ok:true }', async () => {
    const spy = makeFetchSpy(async () => jsonResponse({ models: [{ name: 'llama3.2:3b' }] }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.validate()
    expect(result.ok).toBe(true)
    expect(spy.calls[0]?.url).toBe('http://localhost:11434/api/tags')
  })

  it('non-200 → { ok:false, reason }', async () => {
    const spy = makeFetchSpy(async () => new Response('Internal Server Error', { status: 500 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.validate()
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('fetch throw (connection refused) → { ok:false, reason } (auth_invalid 아님)', async () => {
    const spy = makeFetchSpy(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:11434')
    })
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.validate()
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('연결할 수 없습니다')
    expect(result.reason).toContain('ECONNREFUSED')
  })
})

describe('OllamaProvider — chat 정상 path', () => {
  let spy: FetchSpy
  beforeEach(() => {
    spy = makeFetchSpy(async () =>
      jsonResponse({
        model: 'llama3.2:3b',
        message: { role: 'assistant', content: '안녕하세요!' },
        done: true,
        prompt_eval_count: 12,
        eval_count: 5
      })
    )
  })

  it('정상 응답 — text + tokens + cost=0 매핑', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.chat({
      messages: [{ role: 'user', content: '안녕' }]
    })
    expect(result.text).toBe('안녕하세요!')
    expect(result.modelUsed).toBe('llama3.2:3b')
    expect(result.inputTokens).toBe(12)
    expect(result.outputTokens).toBe(5)
    expect(result.estimatedCostUsd).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('endpoint 정확 = POST /api/chat', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(spy.calls[0]?.url).toBe('http://localhost:11434/api/chat')
    expect(spy.calls[0]?.init?.method).toBe('POST')
  })

  it('request body — messages + model + stream:false 매핑', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' }
      ],
      modelHint: 'qwen2.5:7b'
    })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' }
    ])
    expect(body.stream).toBe(false)
  })

  it('temperature / maxOutputTokens → options.{temperature, num_predict} 매핑', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
      maxOutputTokens: 256
    })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.options).toEqual({ temperature: 0.7, num_predict: 256 })
  })

  it('responseFormat=json_object → format=json 매핑 (Ollama JSON mode)', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({
      messages: [{ role: 'user', content: 'x' }],
      responseFormat: 'json_object'
    })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.format).toBe('json')
  })

  it('options 비주입 시 body.options 미박힘', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({ messages: [{ role: 'user', content: 'x' }] })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.options).toBeUndefined()
  })

  it('modelHint 미주입 → DEFAULT_MODEL=llama3.2:3b', async () => {
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.chat({ messages: [{ role: 'user', content: 'x' }] })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.model).toBe('llama3.2:3b')
  })
})

describe('OllamaProvider — chat 오류 path', () => {
  it('빈 messages → ProviderError(bad_request)', async () => {
    const p = new OllamaProvider()
    await expect(p.chat({ messages: [] })).rejects.toThrow(ProviderError)
    await expect(p.chat({ messages: [] })).rejects.toThrow(/messages/)
  })

  it('404 (모델 미설치) → ProviderError(bad_request) + ollama pull 안내', async () => {
    const spy = makeFetchSpy(
      async () =>
        new Response('model not found', {
          status: 404
        })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.chat({
        messages: [{ role: 'user', content: 'x' }],
        modelHint: 'nonexistent:1b'
      })
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const pe = err as ProviderError
      expect(pe.code).toBe('bad_request')
      expect(pe.message).toContain('ollama pull nonexistent:1b')
    }
  })

  it('429 → ProviderError(rate_limit, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => new Response('rate limit', { status: 429 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.chat({ messages: [{ role: 'user', content: 'x' }] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('rate_limit')
      expect(pe.retryable).toBe(true)
    }
  })

  it('5xx → ProviderError(server_error, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => new Response('boom', { status: 503 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.chat({ messages: [{ role: 'user', content: 'x' }] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('server_error')
      expect(pe.retryable).toBe(true)
    }
  })

  it('기타 4xx → ProviderError(bad_request)', async () => {
    const spy = makeFetchSpy(async () => new Response('bad', { status: 400 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.chat({ messages: [{ role: 'user', content: 'x' }] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('bad_request')
    }
  })

  it('fetch throw (network) → ProviderError(network, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => {
      throw new Error('ECONNREFUSED')
    })
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.chat({ messages: [{ role: 'user', content: 'x' }] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('network')
      expect(pe.retryable).toBe(true)
    }
  })

  it('빈 message.content → ProviderError(server_error)', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({
        model: 'llama3.2:3b',
        message: { role: 'assistant', content: '' },
        done: true
      })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await expect(p.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      ProviderError
    )
  })

  it('prompt_eval_count / eval_count 누락 시 0 으로 fallback', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({
        model: 'llama3.2:3b',
        message: { role: 'assistant', content: '답' },
        done: true
      })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
    expect(result.estimatedCostUsd).toBe(0)
  })
})

describe('OllamaProvider — embed (Sprint 018 M2 T17c)', () => {
  /** 768-dim mock 벡터 (component 0 = 1). */
  function vec768(seed = 1): number[] {
    const v = new Array<number>(768).fill(0)
    v[0] = seed
    return v
  }

  it('정상 batch — vectors + inputTokens(prompt_eval_count) + cost=0 매핑', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({
        model: 'nomic-embed-text',
        embeddings: [vec768(1), vec768(2)],
        prompt_eval_count: 9
      })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.embed({ texts: ['a', 'b'] })
    expect(result.vectors).toHaveLength(2)
    expect(result.vectors[0]).toHaveLength(768)
    expect(result.modelUsed).toBe('nomic-embed-text')
    expect(result.inputTokens).toBe(9)
    expect(result.estimatedCostUsd).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('endpoint 정확 = POST /api/embed + body { model, input } (dimensions 미포함)', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({ model: 'nomic-embed-text', embeddings: [vec768()] })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    // dimensions=768 을 넘겨도 Ollama body 에는 포함되지 않아야 함 (nomic 768 고정).
    await p.embed({ texts: ['x'], dimensions: 768 })
    expect(spy.calls[0]?.url).toBe('http://localhost:11434/api/embed')
    expect(spy.calls[0]?.init?.method).toBe('POST')
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.model).toBe('nomic-embed-text')
    expect(body.input).toEqual(['x'])
    expect(body.dimensions).toBeUndefined()
  })

  it('modelHint 미주입 → DEFAULT_EMBED_MODEL=nomic-embed-text', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({ model: 'nomic-embed-text', embeddings: [vec768()] })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.embed({ texts: ['x'] })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.model).toBe('nomic-embed-text')
  })

  it('modelHint 주입 시 그대로 model 매핑', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({ model: 'mxbai-embed-large', embeddings: [vec768()] })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    await p.embed({ texts: ['x'], modelHint: 'mxbai-embed-large' })
    const body = JSON.parse(spy.calls[0]!.init!.body as string)
    expect(body.model).toBe('mxbai-embed-large')
  })

  it('빈 texts → ProviderError(bad_request)', async () => {
    const p = new OllamaProvider()
    await expect(p.embed({ texts: [] })).rejects.toThrow(ProviderError)
    await expect(p.embed({ texts: [] })).rejects.toThrow(/texts/)
  })

  it('404 (임베딩 모델 미설치) → ProviderError(bad_request) + ollama pull 안내', async () => {
    const spy = makeFetchSpy(async () => new Response('model not found', { status: 404 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.embed({ texts: ['x'] })
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const pe = err as ProviderError
      expect(pe.code).toBe('bad_request')
      expect(pe.message).toContain('ollama pull nomic-embed-text')
    }
  })

  it('429 → ProviderError(rate_limit, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => new Response('rate limit', { status: 429 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.embed({ texts: ['x'] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('rate_limit')
      expect(pe.retryable).toBe(true)
    }
  })

  it('5xx → ProviderError(server_error, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => new Response('boom', { status: 503 }))
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.embed({ texts: ['x'] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('server_error')
      expect(pe.retryable).toBe(true)
    }
  })

  it('fetch throw (network) → ProviderError(network, retryable=true)', async () => {
    const spy = makeFetchSpy(async () => {
      throw new Error('ECONNREFUSED')
    })
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.embed({ texts: ['x'] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('network')
      expect(pe.retryable).toBe(true)
    }
  })

  it('embeddings 길이 불일치 → ProviderError(server_error)', async () => {
    const spy = makeFetchSpy(async () =>
      // 2 texts 요청했는데 1 벡터만 반환.
      jsonResponse({ model: 'nomic-embed-text', embeddings: [vec768()] })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    try {
      await p.embed({ texts: ['a', 'b'] })
      throw new Error('should throw')
    } catch (err) {
      const pe = err as ProviderError
      expect(pe.code).toBe('server_error')
      expect(pe.message).toContain('불일치')
    }
  })

  it('prompt_eval_count 누락 시 inputTokens=0 fallback', async () => {
    const spy = makeFetchSpy(async () =>
      jsonResponse({ model: 'nomic-embed-text', embeddings: [vec768()] })
    )
    const p = new OllamaProvider({ fetchImpl: spy.fn })
    const result = await p.embed({ texts: ['x'] })
    expect(result.inputTokens).toBe(0)
  })
})
