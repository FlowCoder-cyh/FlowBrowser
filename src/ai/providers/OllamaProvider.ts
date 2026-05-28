/**
 * Sprint 017 M3 T14 (KI 없음, Phase 3 spike) — Ollama 로컬 LLM provider adapter.
 *   Sprint 018 M2 T17c — 로컬 임베딩 통합 (`/api/embed` + `nomic-embed-text` 768-dim + supportsEmbed=true).
 *
 * 책임:
 *   - Ollama REST API (디폴트 http://localhost:11434) 의 `/api/chat` + `/api/embed` endpoint 호출
 *   - ProviderAdapter 인터페이스 정합 (chat / embed / validate / dispose)
 *   - providerType='local' — UserSetting.providerPreference 분기에 사용 (M3 T16 통합)
 *
 * 임베딩 (Sprint 018 M2 T17c — Schema v06 dimension 분기 위에서 활성화):
 *   - T14 spike 시점엔 supportsEmbed=false 였음 — 768(nomic) vs 1024(OpenAI) dimension mismatch +
 *     semantic space 차이로 같은 vec_pages 에 박을 수 없었던 게 이유. Schema v06(T17a/T17b)이 vec0 테이블을
 *     `vec_pages_{dim}`/`vec_notes_{dim}` 으로 분리 → 768 전용 테이블 확보. 따라서 본 PR 부터 embed 활성.
 *   - 디폴트 임베딩 모델 `nomic-embed-text` (768 dim 고정 — OpenAI 처럼 dimensions 축소 파라미터 없음).
 *     `EmbedRequest.dimensions` 는 무시(요청 body 미포함) — 실제 차원 검증은 호출자(`EmbeddingClient.toFloat32`)
 *     가 워크스페이스 embedding_model 의 dim(768) 과 대조해 강제 (silent corruption 차단).
 *
 * 비책임:
 *   - chatStream — Ollama 가 NDJSON streaming 지원하나 본 spike scope 외 (codex Q8 권고).
 *   - 사용자 인증 — Ollama 는 localhost 신뢰 모델 (API key 없음). OS Keychain 위임 (G-005) 무관.
 *   - 모델 설치 — `ollama pull <model>` 은 사용자 책임. validate() 가 server 도달성 + 모델 목록만 확인.
 *     임베딩 모델 미설치 시 `/api/embed` 가 404 → 본 PR 이 `ollama pull nomic-embed-text` 안내.
 *
 * dependency:
 *   - 본 PR 은 `ollama` npm package 미사용 — raw fetch + fetchImpl 주입 패턴 (codex Q1 권고 정합,
 *     기존 OpenAIApiKeyProvider / CodexLoginProvider 와 일치). 향후 streaming 도입 시 공식 패키지
 *     도입 재검토.
 *
 * codex 사전 협의 019e500b (T14) / 019e6e00 (T17c) 정합:
 *   - Q1 raw fetch (npm 의존성 회피)
 *   - Q2 connection refused → ProviderError('network') / validate reason wording
 *   - Q3 defaultModel='llama3.2:3b' (작고 빠름)
 *   - T17c — supportsEmbed=true + `/api/embed` (batch input) + dimensions 무시 + length 검증 caller 위임
 *   - Q6 estimatedCostUsd=0 + tokens = prompt_eval_count (+ eval_count, chat 한정)
 *   - Q7 fetchImpl 주입 mock
 *   - Q8 chatStream defer
 *   - Q9 BYOK 무관 (localhost)
 */

import { ProviderError, type ProviderAdapter } from '../ProviderAdapter'
import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderInfo
} from '../types'

/** Ollama REST 디폴트 endpoint. 사용자가 OLLAMA_HOST 등으로 override 가능. */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'

const DEFAULT_MODEL = 'llama3.2:3b'
const AVAILABLE_MODELS: ReadonlyArray<string> = [
  'llama3.2:3b',
  'llama3.1:8b',
  'qwen2.5:7b',
  'mistral:7b'
]

/**
 * Sprint 018 M2 T17c — 디폴트 임베딩 모델. `embeddingModel.ts` 의 `ollama:nomic-embed-text:768` 과 정합
 * (registry ↔ CHECK ↔ vec0 테이블 ↔ credential 4자 일치). 768 dim 고정.
 */
const DEFAULT_EMBED_MODEL = 'nomic-embed-text'

interface OllamaChatResponse {
  model: string
  message: { role: string; content: string }
  done: boolean
  /** input tokens (Ollama 공식 명명). */
  prompt_eval_count?: number
  /** output tokens. */
  eval_count?: number
}

/**
 * Sprint 018 M2 T17c — `/api/embed` 응답 (batch). `embeddings` 는 input texts 와 1:1 매핑된 벡터 배열.
 * `prompt_eval_count` 는 input 토큰 수 (Ollama 공식 명명, 누락 시 0).
 */
interface OllamaEmbedResponse {
  model: string
  embeddings: number[][]
  prompt_eval_count?: number
}

export interface OllamaProviderOptions {
  /** REST endpoint. 미주입 시 `OLLAMA_DEFAULT_BASE_URL`. */
  baseUrl?: string
  /** 테스트용 fetch 주입 (codex Q7 권고). */
  fetchImpl?: typeof fetch
}

export class OllamaProvider implements ProviderAdapter {
  readonly info: ProviderInfo = {
    providerType: 'local',
    displayName: 'Ollama (Local)',
    supportedRequestTypes: [
      'selection',
      'paragraph',
      'page',
      'subtitle',
      'tts_script',
      'explanation',
      'summary'
    ],
    defaultModel: DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS,
    supportsChat: true,
    /**
     * Sprint 018 M2 T17c — Schema v06 dimension 분리(`vec_pages_768`) 위에서 로컬 임베딩 활성.
     * `nomic-embed-text` 768-dim. 호출자(EmbeddingClient)가 워크스페이스 embedding_model dim 과 대조 검증.
     */
    supportsEmbed: true
  }

  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Ollama server 도달성 + (선택) 모델 목록 조회.
   *
   * 정책 (codex Q2):
   *   - connection refused / network 오류 → `{ ok:false, reason:'Ollama server unreachable...' }` (auth_invalid 아님)
   *   - 200 OK 면 `{ ok:true }` (디폴트 모델 미설치라도 본 단계는 통과 — 호출 시점에 에러)
   *   - 본 PR 은 모델 설치 여부 자체는 강제 안 함 (사용자가 `ollama pull` 책임)
   */
  async validate(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`)
      if (!res.ok) {
        return { ok: false, reason: `Ollama 서버 응답 비정상: HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        reason: `Ollama 서버에 연결할 수 없습니다 (기본 ${this.baseUrl}). 실행 중인지 확인하세요. 상세: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /**
   * Ollama `/api/chat` 호출 (non-streaming).
   *
   * Request 매핑:
   *   - messages → messages (role 'system'|'user'|'assistant' 동일)
   *   - modelHint → model (미주입 시 DEFAULT_MODEL)
   *   - temperature → options.temperature
   *   - maxOutputTokens → options.num_predict
   *   - responseFormat='json_object' → format='json' (Ollama 의 JSON mode)
   *
   * Response 매핑:
   *   - message.content → text
   *   - prompt_eval_count → inputTokens
   *   - eval_count → outputTokens
   *   - estimatedCostUsd=0 (로컬, codex Q6)
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (request.messages.length === 0) {
      throw new ProviderError('Ollama chat: messages 가 비어 있습니다.', 'bad_request', false)
    }
    const startedAt = Date.now()
    const model = request.modelHint ?? DEFAULT_MODEL
    const options: Record<string, unknown> = {}
    if (request.temperature !== undefined) options.temperature = request.temperature
    if (request.maxOutputTokens !== undefined) options.num_predict = request.maxOutputTokens

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false
    }
    if (Object.keys(options).length > 0) body.options = options
    // Ollama 의 JSON mode — `format: 'json'`. responseFormat='json_object' 와 의미 정합.
    if (request.responseFormat === 'json_object') body.format = 'json'

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new ProviderError(
        `Ollama chat 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
        'network',
        true
      )
    }

    if (res.status === 404) {
      // 디폴트는 모델 미설치 시 Ollama 가 404 또는 500 반환. 사용자 인지 가능 메시지.
      const errBody = await safeText(res)
      throw new ProviderError(
        `Ollama chat: 모델 '${model}' 가 설치돼 있지 않습니다 (ollama pull ${model}). 상세: ${errBody}`,
        'bad_request',
        false
      )
    }
    if (res.status === 429) {
      throw new ProviderError(`Ollama chat: rate limit 발생`, 'rate_limit', true)
    }
    if (res.status >= 500) {
      throw new ProviderError(
        `Ollama chat 서버 오류: HTTP ${res.status}`,
        'server_error',
        true
      )
    }
    if (!res.ok) {
      const errBody = await safeText(res)
      throw new ProviderError(
        `Ollama chat 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    const data = (await res.json()) as OllamaChatResponse
    const text = data.message?.content?.trim() ?? ''
    if (!text) {
      throw new ProviderError('Ollama chat 응답에 결과가 없습니다.', 'server_error', true)
    }
    return {
      text,
      modelUsed: data.model ?? model,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      // codex Q6 — 로컬 실행이라 비용 0 고정. 향후 hardware utilisation 계측 도입 시 별도.
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
  }

  /**
   * Sprint 018 M2 T17c — Ollama `/api/embed` 호출 (batch).
   *
   * Request 매핑:
   *   - texts → input (string[] — `/api/embed` batch 지원)
   *   - modelHint → model (미주입 시 DEFAULT_EMBED_MODEL='nomic-embed-text')
   *   - dimensions 무시 — nomic-embed-text 는 768 고정 (OpenAI 처럼 축소 파라미터 없음, codex 019e6e00 Q4).
   *     실제 차원 검증은 호출자(EmbeddingClient.toFloat32)가 워크스페이스 dim 과 대조해 강제.
   *
   * Response 매핑:
   *   - embeddings → vectors (input 과 length 일치 검증)
   *   - prompt_eval_count → inputTokens (누락 시 0)
   *   - estimatedCostUsd=0 (로컬, codex Q6)
   *
   * 오류 (chat() 패턴 정합):
   *   - 빈 texts → bad_request
   *   - network throw → network(retryable)
   *   - 404 (모델 미설치) → bad_request + `ollama pull <model>` 안내
   *   - 429 → rate_limit(retryable) / 5xx → server_error(retryable) / 기타 4xx → bad_request
   *   - embeddings 길이 불일치 → server_error
   */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    if (request.texts.length === 0) {
      throw new ProviderError('Ollama embed: texts 가 비어 있습니다.', 'bad_request', false)
    }
    const startedAt = Date.now()
    const model = request.modelHint ?? DEFAULT_EMBED_MODEL
    // dimensions 는 의도적으로 미포함 — nomic-embed-text 768 고정 (codex 019e6e00 Q4).
    const body = {
      model,
      input: request.texts
    }

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new ProviderError(
        `Ollama embed 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
        'network',
        true
      )
    }

    if (res.status === 404) {
      const errBody = await safeText(res)
      throw new ProviderError(
        `Ollama embed: 임베딩 모델 '${model}' 가 설치돼 있지 않습니다 (ollama pull ${model}). 상세: ${errBody}`,
        'bad_request',
        false
      )
    }
    if (res.status === 429) {
      throw new ProviderError(`Ollama embed: rate limit 발생`, 'rate_limit', true)
    }
    if (res.status >= 500) {
      throw new ProviderError(`Ollama embed 서버 오류: HTTP ${res.status}`, 'server_error', true)
    }
    if (!res.ok) {
      const errBody = await safeText(res)
      throw new ProviderError(
        `Ollama embed 요청 실패: ${res.status} ${errBody}`,
        'bad_request',
        false
      )
    }

    const data = (await res.json()) as OllamaEmbedResponse
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== request.texts.length) {
      throw new ProviderError(
        `Ollama embed 응답 길이 불일치 (expected=${request.texts.length}, got=${data.embeddings?.length ?? 0})`,
        'server_error',
        true
      )
    }
    return {
      vectors: data.embeddings,
      modelUsed: data.model ?? model,
      inputTokens: data.prompt_eval_count ?? 0,
      // codex Q6 — 로컬 실행이라 비용 0 고정.
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
