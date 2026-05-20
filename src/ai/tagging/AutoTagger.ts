/**
 * Sprint 015 M4-2 — AutoTagger.
 *
 * SSOT: `.flowset/contracts/sprint-015.md` §2 T18 + §3 AC-5 (Tag.kind 6종 / BYOK 디폴트).
 * PRD §8.8 — Tag.kind 6종 (topic / entity / metric / sentiment / domain / freeform) 자동 태깅.
 *
 * 흐름:
 *   1. ProviderAdapter.chat({ messages: [system schema + user content] })
 *   2. JSON 응답 파싱 — `{ tags: [{kind, name}, ...] }`
 *   3. 파싱 실패 → freeform fallback (단일 kind='freeform', name=응답 전체 text)
 *   4. TagStore.ensureTag (idempotent) + TagStore.attachToPage
 *
 * BYOK 디폴트 (G-003 강화) — Codex OAuth 호출은 사용자 명시 동의 시에만.
 * 본 모듈 자체는 호출자가 어떤 provider 를 주입했는지 모름 — 호출자(IndexingService wiring, M4-5)가 BYOK 정책 강제.
 *
 * 본 PR (M4-2) 범위: AutoTagger 모듈 + 단위 테스트.
 * wiring (IndexingService → AutoTagger 호출, EmbeddingQueue 와 독립 큐 vs 재활용 결정) 은 M4-5 또는 후속.
 *
 * 외부 호출은 DB TX 외부 (PRD §5.4.2 정합) — ensureTag/attachToPage 는 본 메서드 내 sync,
 * provider.chat 은 비동기 외부 호출이라 ensureTag 호출 전에 await 종료.
 */

import type { ProviderAdapter } from '../ProviderAdapter'
import type { ChatMessage, ChatRequest } from '../types'
import type { TagStore, TagRow } from '../../storage/TagStore'
import type { TagKind } from '../../storage/TagStore'
import { TAG_KINDS } from '../../storage/TagStore'

const SYSTEM_PROMPT_KO = `당신은 페이지 콘텐츠에서 6가지 종류의 태그를 추출하는 분류기입니다.

응답은 반드시 다음 JSON schema 만 출력하세요. 다른 설명·코드 펜스·전후 텍스트 금지:

{
  "tags": [
    {"kind": "<kind>", "name": "<짧은 한국어 또는 영문 명사구>"}
  ]
}

kind 허용값 (정확히 하나만):
- topic: 주제 (예: "CAR-T 저항성", "마이크로서비스")
- entity: 고유명사·사람·회사·제품 (예: "Linear", "BioGen")
- metric: 수치·지표 (예: "10x faster", "ICU 입원율")
- sentiment: 감정·평가 (예: "긍정", "부정", "중립")
- domain: 도메인 (예: "medicine", "engineering")
- freeform: 위 5종 어디에도 속하지 않는 자유 태그

규칙:
- 태그 1~6개 사이 (페이지가 짧으면 적게).
- name 은 짧게 (1~5 단어).
- 동일 kind 중복 name 금지.
- JSON 외 그 어떤 출력도 금지.`

export interface TagPageInput {
  pageId: string
  workspaceId: string
  title?: string
  content: string
  /** model hint (provider 가 사용). 미주입 시 provider default. */
  modelHint?: string
  /**
   * 최대 응답 토큰. `ChatRequest.maxOutputTokens` 에 그대로 전달 (현재 본 모듈은 미사용 —
   * 후속 spec 결정 시 provider.chat 호출에 전달 예정). evaluator NB-1 정합 정정.
   */
  maxOutputTokens?: number
}

export type AutoTagResult =
  | {
      status: 'tagged'
      tags: TagRow[]
      /** 모델이 schema JSON 을 정확히 반환했는지. false 면 freeform fallback 적용. */
      schemaParsed: boolean
      /** provider 응답 raw — 디버그/감사용. */
      rawText: string
    }
  | {
      status: 'skipped'
      reason: 'empty_content' | 'no_chat_support'
    }
  | {
      status: 'failed'
      error: string
      rawText?: string
    }

export interface AutoTaggerOptions {
  provider: ProviderAdapter
  tagStore: TagStore
  /** 최대 태그 수 — 모델 응답 초과분은 잘림 (디폴트 6). */
  maxTags?: number
  /** chat 시스템 프롬프트 override (테스트 / 다국어 확장 용). */
  systemPrompt?: string
}

const DEFAULT_MAX_TAGS = 6

export class AutoTagger {
  private readonly provider: ProviderAdapter
  private readonly tagStore: TagStore
  private readonly maxTags: number
  private readonly systemPrompt: string

  constructor(opts: AutoTaggerOptions) {
    this.provider = opts.provider
    this.tagStore = opts.tagStore
    this.maxTags = opts.maxTags ?? DEFAULT_MAX_TAGS
    this.systemPrompt = opts.systemPrompt ?? SYSTEM_PROMPT_KO
  }

  async tagPage(input: TagPageInput): Promise<AutoTagResult> {
    const trimmed = input.content.trim()
    if (trimmed.length === 0) {
      return { status: 'skipped', reason: 'empty_content' }
    }
    if (!this.provider.chat) {
      return { status: 'skipped', reason: 'no_chat_support' }
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: composeUserMessage({ title: input.title, content: trimmed })
      }
    ]
    // Sprint 016 M0 T04 (KI-004) — response_format JSON 강제 (API-level).
    // OpenAI Chat Completions response_format: { type: 'json_object' } → freeform fallback 의존성 축소.
    // Codex Login Provider 는 미지원 (Responses API 는 instructions 로 우회 — silent ignore).
    const request: ChatRequest = {
      messages,
      modelHint: input.modelHint,
      responseFormat: 'json_object'
    }

    let rawText: string
    try {
      const response = await this.provider.chat(request)
      rawText = response.text
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
    }

    const parsed = parseTagsResponse(rawText, this.maxTags)
    const isFreeformFallback = parsed === null

    const items: Array<{ kind: TagKind; name: string }> = isFreeformFallback
      ? [{ kind: 'freeform', name: truncate(rawText, 200) }]
      : parsed!

    const tags: TagRow[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const key = `${item.kind}:${item.name.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const tag = this.tagStore.ensureTag({
        workspace_id: input.workspaceId,
        kind: item.kind,
        name: item.name,
        ai_generated: true
      })
      this.tagStore.attachToPage(input.pageId, {
        workspace_id: input.workspaceId,
        tag_id: tag.id,
        ai_generated: true
      })
      tags.push(tag)
    }

    return {
      status: 'tagged',
      tags,
      schemaParsed: !isFreeformFallback,
      rawText
    }
  }
}

function composeUserMessage(args: { title?: string; content: string }): string {
  const title = (args.title ?? '').trim()
  // 모델 입력 4000자 truncate — 비용 제어 + 정확도 향상 정합.
  // PRD §8.8.4 (회귀 셋 태그 추출 성공률 ≥ 80%) + §8.2.3 (전체 본문 1개 임베딩, 8192 tokens 한계와는 별개).
  // 본 임계는 codex NB-5 / Phase 1 base 결정 — 정확도 측정 후 조정 가능 (KI 후보, M4-5 또는 Phase 1 종료).
  const body = truncate(args.content, 4000)
  return title ? `제목: ${title}\n\n본문:\n${body}` : `본문:\n${body}`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n)
}

/**
 * provider 응답 text → `[{kind, name}, ...]` 정규화.
 * 파싱 실패 시 null → 호출자가 freeform fallback 결정.
 *
 * 허용 입력 변형:
 *   - pure JSON (`{ "tags": [...] }`)
 *   - JSON 앞뒤 whitespace
 *   - 코드 펜스 (```json ... ```) — strip 후 시도
 *
 * 유효성:
 *   - kind 가 TAG_KINDS 6 중 하나
 *   - name 이 non-empty string (trim 후)
 *   - 최대 maxTags 까지만 (초과는 잘림)
 */
export function parseTagsResponse(
  raw: string,
  maxTags: number
): Array<{ kind: TagKind; name: string }> | null {
  if (!raw || raw.trim().length === 0) return null
  const text = stripCodeFence(raw.trim())
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const tagsField = (obj as { tags?: unknown }).tags
  if (!Array.isArray(tagsField)) return null
  const result: Array<{ kind: TagKind; name: string }> = []
  for (const item of tagsField) {
    if (typeof item !== 'object' || item === null) continue
    const kind = (item as { kind?: unknown }).kind
    const name = (item as { name?: unknown }).name
    if (typeof kind !== 'string' || typeof name !== 'string') continue
    if (!TAG_KINDS.includes(kind as TagKind)) continue
    const trimmedName = name.trim()
    if (!trimmedName) continue
    result.push({ kind: kind as TagKind, name: trimmedName })
    if (result.length >= maxTags) break
  }
  return result.length > 0 ? result : null
}

function stripCodeFence(s: string): string {
  // 단일 라인: ```json{...}``` 또는 ```{...}```
  // 멀티 라인: ```json\n...\n```
  // codex NB-4 정합 — 두 형식 모두 strip 지원.
  const multiline = s.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n?```\s*$/)
  if (multiline) return multiline[1].trim()
  const single = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/)
  if (single) return single[1].trim()
  return s
}

export const __testing = {
  parseTagsResponse,
  stripCodeFence,
  composeUserMessage,
  truncate,
  DEFAULT_MAX_TAGS,
  SYSTEM_PROMPT_KO
}
