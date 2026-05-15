/**
 * Sprint 014 M3-11 — SSE (Server-Sent Events) 파서.
 *
 * ChatGPT Codex 백엔드 Responses API는 stream: true 필수.
 * 형식: 라인 단위 텍스트, 빈 줄로 이벤트 구분.
 *   event: response.output_text.delta
 *   data: {"type":"response.output_text.delta","delta":"안녕"}
 *
 *   event: response.completed
 *   data: {"type":"response.completed","response":{...}}
 *
 * 본 파서는 ReadableStream을 받아 이벤트 단위 비동기 generator로 변환.
 */

export interface SseEvent {
  /** event: 라인 값 (없으면 undefined) */
  event?: string
  /** data: 라인을 줄바꿈으로 합친 문자열 (JSON 또는 raw) */
  data: string
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent: string | undefined
  let currentData: string[] = []

  const flush = (): SseEvent | null => {
    if (currentData.length === 0 && currentEvent === undefined) return null
    const ev: SseEvent = { event: currentEvent, data: currentData.join('\n') }
    currentEvent = undefined
    currentData = []
    return ev
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        // 마지막 이벤트 flush
        if (buffer.length > 0) {
          for (const line of buffer.split(/\r?\n/)) {
            if (line.length === 0) {
              const ev = flush()
              if (ev) yield ev
            } else if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart())
            }
          }
          const ev = flush()
          if (ev) yield ev
        } else {
          const ev = flush()
          if (ev) yield ev
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })
      // 빈 줄 단위 이벤트 분리
      let nlIdx: number
      while ((nlIdx = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, nlIdx)
        buffer = buffer.slice(nlIdx + 1)
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (line.length === 0) {
          const ev = flush()
          if (ev) yield ev
        } else if (line.startsWith(':')) {
          // SSE comment — 무시
          continue
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          currentData.push(line.slice(5).trimStart())
        }
        // 그 외 (id:, retry: 등) 무시
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Codex Responses API SSE 이벤트에서 최종 텍스트 누적.
 * 알려진 이벤트:
 *   response.output_text.delta  — delta 누적
 *   response.completed          — 최종 response 객체 (output[].content[].text)
 *   response.created / response.in_progress  — 메타 (사용 안 함)
 *
 * 응답 형식 미상 부분은 raw delta가 도착하는 대로 누적 + 마지막에 completed에서
 * 최종 텍스트 비어 있으면 누적 사용.
 */
export interface AccumulatedResponse {
  text: string
  model?: string
  inputTokens?: number
  outputTokens?: number
}

export async function accumulateResponsesStream(
  stream: ReadableStream<Uint8Array>
): Promise<AccumulatedResponse> {
  let deltaText = ''
  let finalText = ''
  let model: string | undefined
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  for await (const ev of parseSseStream(stream)) {
    const data = ev.data.trim()
    if (!data || data === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : ev.event ?? ''

    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
      const delta = typeof obj.delta === 'string' ? obj.delta : ''
      deltaText += delta
    } else if (type === 'response.completed' || type === 'response.done') {
      const response = obj.response as Record<string, unknown> | undefined
      if (response) {
        if (typeof response.model === 'string') model = response.model
        // output[].content[].text 추출
        const output = response.output
        if (Array.isArray(output)) {
          const parts: string[] = []
          for (const item of output as Array<Record<string, unknown>>) {
            if (item.type && item.type !== 'message') continue
            const content = item.content
            if (!Array.isArray(content)) continue
            for (const c of content as Array<Record<string, unknown>>) {
              if (typeof c.text === 'string') parts.push(c.text)
            }
          }
          finalText = parts.join('')
        }
        if (typeof response.output_text === 'string' && !finalText) {
          finalText = response.output_text
        }
        const usage = response.usage as Record<string, unknown> | undefined
        if (usage) {
          if (typeof usage.input_tokens === 'number') inputTokens = usage.input_tokens
          if (typeof usage.output_tokens === 'number') outputTokens = usage.output_tokens
        }
      }
    }
  }
  return {
    text: finalText || deltaText,
    model,
    inputTokens,
    outputTokens
  }
}
