/**
 * Sprint 017 M3 T14 (KI 없음, Phase 3 spike) — Ollama 로컬 LLM provider adapter.
 *
 * 책임:
 *   - Ollama REST API (디폴트 http://localhost:11434) 의 `/api/chat` endpoint 호출
 *   - ProviderAdapter 인터페이스 정합 (chat / validate / dispose)
 *   - providerType='local' — UserSetting.providerPreference 분기에 사용 (M3 T16 통합)
 *
 * 비책임:
 *   - 임베딩 (embed) — codex 019e500b Q4/Q5 권고: `supportsEmbed:false` 박음. Ollama 디폴트 임베딩
 *     모델 (`nomic-embed-text` 768 dim) 이 OpenAI text-embedding-3-small 의 1024 dim 과 mismatch +
 *     semantic space 가 달라 같은 vec_pages 에 박을 수 없음. 별도 vec_pages_local 테이블 / dimension
 *     별 분리 / embedding_space_id 도입은 T15 sentence-transformers spec 시 종합 결정.
 *   - chatStream — Ollama 가 NDJSON streaming 지원하나 본 spike scope 외 (codex Q8 권고).
 *   - 사용자 인증 — Ollama 는 localhost 신뢰 모델 (API key 없음). OS Keychain 위임 (G-005) 무관.
 *   - 모델 설치 — `ollama pull <model>` 은 사용자 책임. validate() 가 server 도달성 + 모델 목록만 확인.
 *
 * dependency:
 *   - 본 PR 은 `ollama` npm package 미사용 — raw fetch + fetchImpl 주입 패턴 (codex Q1 권고 정합,
 *     기존 OpenAIApiKeyProvider / CodexLoginProvider 와 일치). 향후 streaming 도입 시 공식 패키지
 *     도입 재검토.
 *
 * codex 사전 협의 019e500b 정합:
 *   - Q1 raw fetch (npm 의존성 회피)
 *   - Q2 connection refused → ProviderError('network') / validate reason wording
 *   - Q3 defaultModel='llama3.2:3b' (작고 빠름)
 *   - Q4/Q5 supportsEmbed=false + embed throw 'unsupported'
 *   - Q6 estimatedCostUsd=0 + tokens = prompt_eval_count + eval_count
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

interface OllamaChatResponse {
  model: string
  message: { role: string; content: string }
  done: boolean
  /** input tokens (Ollama 공식 명명). */
  prompt_eval_count?: number
  /** output tokens. */
  eval_count?: number
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
     * codex 019e500b Q4/Q5 — 768 dim vs vec_pages 1024 dim mismatch + semantic space 차이.
     * embed() 호출 시 ProviderError('unsupported') throw. T15 spec 시 vec_pages_local 또는
     * embedding_space_id 도입 종합 결정.
     */
    supportsEmbed: false
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
   * codex 019e500b Q4/Q5 권고 — T14 spike 에서는 embed 미지원.
   *
   * 이유:
   *   - Ollama 디폴트 임베딩 모델 `nomic-embed-text` (768 dim) 가 `vec_pages.embedding float[1024]` 와
   *     dimension mismatch. 같은 테이블에 박을 수 없음.
   *   - 차원이 같아도 OpenAI text-embedding-3-small 과 다른 semantic space — mixed 검색 품질 저하.
   *
   * 향후 T15 sentence-transformers spec 시점에 `vec_pages_local` / `embedding_space_id` /
   * dimension 별 분리 정책 종합 결정. 본 spike 는 `'unsupported'` throw 박음 (info.supportsEmbed=false
   * 와 정합).
   */
  async embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new ProviderError(
      'Ollama embed: 본 spike 에서는 미지원. T15 sentence-transformers spec 박힘 후 결정.',
      'unsupported',
      false
    )
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
