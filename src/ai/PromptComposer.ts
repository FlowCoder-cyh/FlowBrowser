/**
 * Sprint 015 M5-5 — PromptComposer.
 *
 * PRD §10.1 채팅 파이프라인 — 워크스페이스 메모리 retrieval + 사용자 수준 분기 system prompt 빌더.
 *
 * 책임:
 *   1. 사용자 수준 분기 (`workspaces.level_preference` ∈ {'novice', 'intermediate', 'advanced', null})
 *   2. retrieved page / note context 결합 (M5-6 ChatPanel 호출 시 SearchService 결과 주입)
 *   3. 추가 system 지시 결합 (customSystemPrompt — 사용자 워크스페이스 settings)
 *
 * pure 함수 — DB / Provider 호출 없음. ChatService 가 결과 system prompt 를 chat 호출에 박음.
 */

import type { LevelPreference } from '../storage/Database'

export interface PromptComposeOptions {
  /** 워크스페이스 수준 설정. null/undefined = 기본 (수준 분기 없음). */
  levelPreference?: LevelPreference
  /** SearchService.search 결과 page hits 의 본문 (M5-6 ChatPanel 호출자 책임). */
  retrievedPages?: Array<{
    title: string
    url: string
    content: string
  }>
  /** SearchService.search 결과 note hits (M5-6). */
  retrievedNotes?: Array<{
    selectedText: string
    body: string | null
  }>
  /** 워크스페이스 설정 등에서 박힌 추가 system 지시. */
  customSystemPrompt?: string
  /** retrieval 본문 최대 자수 (호출자 cost guard). 디폴트 1500. */
  maxRetrievalChars?: number
}

const DEFAULT_MAX_RETRIEVAL_CHARS = 1500

/**
 * 시스템 프롬프트 합성. 다음 단락 순서:
 *   1. 베이스 (한국어 AI 어시스턴트 + 워크스페이스 메모리)
 *   2. 사용자 수준 (있으면)
 *   3. 추가 지시 (customSystemPrompt)
 *   4. retrieved context (있으면, maxRetrievalChars 까지 합산 truncate)
 */
export function composeSystemPrompt(opts: PromptComposeOptions = {}): string {
  const sections: string[] = []

  sections.push(
    '당신은 사용자의 워크스페이스 메모리를 활용해 정확하고 출처가 명확한 답변을 제공하는 한국어 AI 어시스턴트입니다.'
  )

  const levelDirective = levelDirectiveFor(opts.levelPreference)
  if (levelDirective) sections.push(levelDirective)

  if (opts.customSystemPrompt && opts.customSystemPrompt.trim().length > 0) {
    sections.push(opts.customSystemPrompt.trim())
  }

  const retrievalBlock = composeRetrievalBlock(
    opts.retrievedPages ?? [],
    opts.retrievedNotes ?? [],
    opts.maxRetrievalChars ?? DEFAULT_MAX_RETRIEVAL_CHARS
  )
  if (retrievalBlock) sections.push(retrievalBlock)

  return sections.join('\n\n')
}

function levelDirectiveFor(level: LevelPreference | undefined): string | null {
  switch (level) {
    case 'novice':
      return '사용자는 해당 주제에 처음 입문한 초보자입니다. 전문 용어 사용 시 즉시 풀어서 설명하고, 비유로 직관을 잡아주세요.'
    case 'intermediate':
      return '사용자는 해당 주제의 기본은 이해하는 중급자입니다. 핵심 개념은 전제하되, 깊은 디테일은 짧은 정의로 짚어주세요.'
    case 'advanced':
      return '사용자는 해당 주제의 전문가입니다. 기본 정의 반복은 생략하고, 미묘한 차이 / trade-off / 실측에 집중하세요.'
    default:
      return null
  }
}

function composeRetrievalBlock(
  pages: NonNullable<PromptComposeOptions['retrievedPages']>,
  notes: NonNullable<PromptComposeOptions['retrievedNotes']>,
  maxChars: number
): string | null {
  if (pages.length === 0 && notes.length === 0) return null

  const out: string[] = ['## 워크스페이스 메모리 (출처)']
  let charBudget = maxChars

  pages.forEach((p, idx) => {
    if (charBudget <= 0) return
    const body = p.content.slice(0, Math.min(charBudget, 500))
    out.push(
      `### [page-${idx + 1}] ${p.title || '(제목 없음)'}\nURL: ${p.url}\n${body}`
    )
    charBudget -= body.length
  })

  notes.forEach((n, idx) => {
    if (charBudget <= 0) return
    const noteText = [n.selectedText.trim(), n.body?.trim()].filter(Boolean).join('\n')
    const body = noteText.slice(0, Math.min(charBudget, 300))
    out.push(`### [note-${idx + 1}]\n${body}`)
    charBudget -= body.length
  })

  out.push(
    '응답 시 위 메모리에서 인용한 부분은 `[page-N]` 또는 `[note-N]` 형식으로 출처를 명시하세요. 메모리 외 추측은 명확히 구분하세요.'
  )
  return out.join('\n\n')
}
