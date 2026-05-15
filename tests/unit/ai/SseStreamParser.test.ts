/**
 * Sprint 014 M3-11 — SSE 파서 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSseStream,
  accumulateResponsesStream
} from '../../../src/ai/codex/SseStreamParser'

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(text))
      c.close()
    }
  })
}

function streamChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) {
        c.close()
        return
      }
      c.enqueue(encoder.encode(chunks[i++]))
    }
  })
}

describe('parseSseStream', () => {
  it('단일 이벤트 파싱', async () => {
    const text = `event: foo\ndata: {"a":1}\n\n`
    const events = []
    for await (const ev of parseSseStream(streamOf(text))) events.push(ev)
    expect(events).toEqual([{ event: 'foo', data: '{"a":1}' }])
  })

  it('연속 이벤트 + 멀티라인 data', async () => {
    const text = `event: e1\ndata: line1\ndata: line2\n\nevent: e2\ndata: bye\n\n`
    const events = []
    for await (const ev of parseSseStream(streamOf(text))) events.push(ev)
    expect(events).toEqual([
      { event: 'e1', data: 'line1\nline2' },
      { event: 'e2', data: 'bye' }
    ])
  })

  it('chunk 경계가 라인 중간이어도 정상 파싱', async () => {
    const events = []
    for await (const ev of parseSseStream(
      streamChunks(['event: e\nda', 'ta: hello', '\n\n'])
    )) {
      events.push(ev)
    }
    expect(events).toEqual([{ event: 'e', data: 'hello' }])
  })

  it('comment(:) 라인 무시', async () => {
    const text = `:keep-alive\nevent: e\ndata: x\n\n`
    const events = []
    for await (const ev of parseSseStream(streamOf(text))) events.push(ev)
    expect(events).toEqual([{ event: 'e', data: 'x' }])
  })

  it('CRLF 라인 종단 처리', async () => {
    const text = `event: e\r\ndata: y\r\n\r\n`
    const events = []
    for await (const ev of parseSseStream(streamOf(text))) events.push(ev)
    expect(events[0].data).toBe('y')
  })
})

describe('accumulateResponsesStream', () => {
  it('delta 누적 + completed 최종 텍스트 우선', async () => {
    const sse =
      `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"안녕"}\n\n` +
      `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":" 세상"}\n\n` +
      `event: response.completed\ndata: {"type":"response.completed","response":{"model":"gpt-5.5","output":[{"type":"message","content":[{"type":"output_text","text":"안녕 세상"}]}],"usage":{"input_tokens":3,"output_tokens":2}}}\n\n`
    const result = await accumulateResponsesStream(streamOf(sse))
    expect(result.text).toBe('안녕 세상')
    expect(result.model).toBe('gpt-5.5')
    expect(result.inputTokens).toBe(3)
    expect(result.outputTokens).toBe(2)
  })

  it('completed 없으면 delta 누적 fallback', async () => {
    const sse =
      `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"A"}\n\n` +
      `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"B"}\n\n`
    const result = await accumulateResponsesStream(streamOf(sse))
    expect(result.text).toBe('AB')
  })

  it('output_text 직접 형식 (delta 없음)', async () => {
    const sse =
      `event: response.completed\ndata: {"type":"response.completed","response":{"model":"gpt-5.5","output_text":"hello"}}\n\n`
    const result = await accumulateResponsesStream(streamOf(sse))
    expect(result.text).toBe('hello')
  })

  it('빈 스트림 → text 빈 문자열', async () => {
    const result = await accumulateResponsesStream(streamOf(''))
    expect(result.text).toBe('')
  })

  it('[DONE] sentinel 무시', async () => {
    const sse =
      `data: {"type":"response.output_text.delta","delta":"x"}\n\n` + `data: [DONE]\n\n`
    const result = await accumulateResponsesStream(streamOf(sse))
    expect(result.text).toBe('x')
  })
})
