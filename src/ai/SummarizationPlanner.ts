/**
 * Sprint 004 M3 / S004-T06 — 페이지 요약 청크 플래너.
 *
 * PageNodeBundle을 청크 단위 텍스트로 변환하고, 각 청크 요약 → 통합 요약 단계를
 * pure 함수로 분리한다. mock provider 단위 테스트를 위한 의존성 주입 구조.
 *
 * @deprecated Sprint 015 M2-3 — v0.4 방향 전환 (PRD §00 §0.2 / §01 §1.2.1 폐기된 패러다임) 결정.
 *   페이지 요약 use case 자체 폐기. 대체:
 *     - Phase 1 (Sprint 015 M5+): ChatPanel + RAG retrieval (`docs/prd/10_ai_chat.md` §10.1 채팅 파이프라인)
 *     - Phase 2 (Sprint 016+): 백그라운드 장시간 처리 (`docs/prd/14_translation_background.md`)
 *
 *   본 모듈 실제 코드 + IPC handler (`translate:summarize-page` / `translate:summarize-abort`)
 *   + preload API (`summarizePage` / `abortSummarize`) + 단위 테스트 18개는 **M2-4 PR 에서 제거**.
 *   UI 분기 (`TranslationPanel.tsx` mode='summary') 는 **M5 ChatPanel 전환 시 제거**.
 *
 *   본 M2-3 PR 은 마킹 단계 — 호출 시 console.warn 1회 (모듈 단위 flag, 호출 폭주 방지) + JSDoc @deprecated 표시.
 *   코드 동작은 v0.3 모드 100% 보존.
 */

import type {
  PageNodeBundle,
  PageNodeChunkMeta,
  PageNodeInfo
} from '../perception/PageNodeExtractor'

export interface PlannedChunk {
  index: number
  meta: PageNodeChunkMeta
  text: string
}

export interface SummarizeResult {
  summary: string
  chunkSummaries: string[]
  combined: boolean
  /**
   * Sprint 005 M3 — 폭주 보호 경로 표시.
   * - 'single': 청크 1개 → 통합 단계 없음
   * - 'direct': 통합 단계 입력이 limit 이하 → 단일 통합 호출
   * - 'resplit': 통합 입력이 limit 초과 → 부분 통합 → 최종 통합 (1단계 재분할)
   * - 'truncated': 재분할 후에도 limit 초과 → 마지막 통합은 truncated 입력
   */
  combinedPath: 'single' | 'direct' | 'resplit' | 'truncated'
  /**
   * Sprint 007 M2 — 통합 단계에 실제로 들어간 입력 길이 (chars).
   * truncated 경로면 limit 값과 같음. UI에서 limit과 함께 노출하여 사용자가 보호 동작 가시화.
   */
  combinedInputChars: number
  /**
   * Sprint 007 M2 — 적용된 combineCharLimit (기본 8000).
   */
  combineCharLimit: number
}

export interface SummarizeOptions {
  /**
   * Sprint 005 M3 — 통합 단계 입력 길이 한계 (chars). 초과 시 재분할 또는 truncate.
   * 기본 8000.
   */
  combineCharLimit?: number
  /**
   * Sprint 011 M1 — abort 검사 콜백. true 반환 시 즉시 SUMMARIZATION_ABORTED 에러 throw.
   * 각 summarize 호출 직전에 검사 (청크 / 통합 / 부분 / 최종 모두).
   */
  abortCheck?: () => boolean
}

export class SummarizationAbortedError extends Error {
  constructor() {
    super('summarization-aborted')
    this.name = 'SummarizationAbortedError'
  }
}

const DEFAULT_COMBINE_CHAR_LIMIT = 8000

// M2-3 deprecate — 호출 시 main process stderr 에 모듈 lifetime 1회 warn (호출 폭주 방지 모듈 flag).
// production 포함 — Electron main process stderr 는 사용자 노출 X, 디버깅/로그 수집에만 가시.
let deprecationWarned = false
function warnDeprecatedOnce(): void {
  if (deprecationWarned) return
  deprecationWarned = true
  console.warn(
    '[FlowBrowser] SummarizationPlanner is deprecated (Sprint 015 M2-3). ' +
      'Removal in M2-4 (IPC handler + module) + M5 (UI 분기). ' +
      'See docs/prd/19_migration_v03_v04.md §19.5.1.'
  )
}

/**
 * PageNodeBundle의 chunks 메타를 사용해 각 청크의 노드 텍스트를 합본.
 *
 * @deprecated Sprint 015 M2-3 — 페이지 요약 use case 폐기 (PRD §00 §0.2). M2-4 PR 에서 본 함수 + 모듈 제거.
 *   대체: ChatPanel + RAG retrieval (Sprint 015 M5+, `docs/prd/10_ai_chat.md` §10.1).
 */
export function planChunks(bundle: PageNodeBundle): PlannedChunk[] {
  warnDeprecatedOnce()
  const idIndex = new Map<string, number>()
  bundle.nodes.forEach((n, i) => idIndex.set(n.id, i))
  const planned: PlannedChunk[] = []
  for (const meta of bundle.chunks) {
    const startIdx = idIndex.get(meta.startNodeId)
    const endIdx = idIndex.get(meta.endNodeId)
    if (startIdx === undefined || endIdx === undefined) continue
    const nodes: PageNodeInfo[] = bundle.nodes.slice(startIdx, endIdx + 1)
    const text = nodes.map((n) => n.text).join('\n\n')
    planned.push({ index: meta.index, meta, text })
  }
  return planned
}

/**
 * 청크 요약 + 통합 요약 흐름.
 * - 청크가 1개면 통합 단계 스킵, 단일 요약 반환
 * - 청크가 N개면 각 청크 요약 후 합본을 다시 한 번 요약
 * - summarize 호출이 실패하면 throw 전파
 *
 * Sprint 005 M3 — 폭주 보호:
 * 통합 단계 입력이 `combineCharLimit` 초과 시 재분할 (부분 통합 → 최종 통합).
 * 재분할 후에도 초과 시 truncate 폴백 (무한 루프 방지, 한 번만 재분할).
 *
 * @deprecated Sprint 015 M2-3 — 페이지 요약 use case 폐기 (PRD §00 §0.2). M2-4 PR 에서 본 함수 + 모듈 제거.
 *   대체: ChatPanel + RAG retrieval (Sprint 015 M5+, `docs/prd/10_ai_chat.md` §10.1).
 */
export async function summarizeChunks(
  chunkTexts: string[],
  summarize: (text: string) => Promise<string>,
  options: SummarizeOptions = {}
): Promise<SummarizeResult> {
  warnDeprecatedOnce()
  const combineCharLimit = options.combineCharLimit ?? DEFAULT_COMBINE_CHAR_LIMIT
  const checkAbort = (): void => {
    if (options.abortCheck && options.abortCheck()) {
      throw new SummarizationAbortedError()
    }
  }
  if (chunkTexts.length === 0) {
    return {
      summary: '',
      chunkSummaries: [],
      combined: false,
      combinedPath: 'single',
      combinedInputChars: 0,
      combineCharLimit
    }
  }
  const chunkSummaries: string[] = []
  for (const text of chunkTexts) {
    checkAbort()
    chunkSummaries.push(await summarize(text))
  }
  if (chunkSummaries.length === 1) {
    return {
      summary: chunkSummaries[0],
      chunkSummaries,
      combined: false,
      combinedPath: 'single',
      combinedInputChars: chunkTexts[0]?.length ?? 0,
      combineCharLimit
    }
  }

  const combinedInput = chunkSummaries.join('\n\n')
  if (combinedInput.length <= combineCharLimit) {
    checkAbort()
    const combined = await summarize(combinedInput)
    return {
      summary: combined,
      chunkSummaries,
      combined: true,
      combinedPath: 'direct',
      combinedInputChars: combinedInput.length,
      combineCharLimit
    }
  }

  // 1단계 재분할 — chunkSummaries를 limit 단위로 묶어 부분 통합 요약 만든 뒤 최종 통합.
  const groups = groupByCharLimit(chunkSummaries, combineCharLimit)
  const partialSummaries: string[] = []
  for (const group of groups) {
    checkAbort()
    partialSummaries.push(await summarize(group.join('\n\n')))
  }
  const finalInput = partialSummaries.join('\n\n')
  if (finalInput.length <= combineCharLimit) {
    checkAbort()
    const final = await summarize(finalInput)
    return {
      summary: final,
      chunkSummaries,
      combined: true,
      combinedPath: 'resplit',
      combinedInputChars: finalInput.length,
      combineCharLimit
    }
  }
  // 재분할 후에도 초과 → truncate 폴백 (한 번만 재분할 한다는 규약)
  checkAbort()
  const truncated = finalInput.slice(0, combineCharLimit)
  const final = await summarize(truncated)
  return {
    summary: final,
    chunkSummaries,
    combined: true,
    combinedPath: 'truncated',
    combinedInputChars: truncated.length,
    combineCharLimit
  }
}

function groupByCharLimit(texts: string[], limit: number): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let currentChars = 0
  for (const t of texts) {
    if (currentChars > 0 && currentChars + t.length > limit) {
      groups.push(current)
      current = []
      currentChars = 0
    }
    current.push(t)
    currentChars += t.length
  }
  if (current.length > 0) groups.push(current)
  return groups
}
