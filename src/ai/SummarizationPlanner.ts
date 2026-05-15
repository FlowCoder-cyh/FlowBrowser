/**
 * Sprint 004 M3 / S004-T06 — 페이지 요약 청크 플래너.
 *
 * PageNodeBundle을 청크 단위 텍스트로 변환하고, 각 청크 요약 → 통합 요약 단계를
 * pure 함수로 분리한다. mock provider 단위 테스트를 위한 의존성 주입 구조.
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
}

export interface SummarizeOptions {
  /**
   * Sprint 005 M3 — 통합 단계 입력 길이 한계 (chars). 초과 시 재분할 또는 truncate.
   * 기본 8000.
   */
  combineCharLimit?: number
}

const DEFAULT_COMBINE_CHAR_LIMIT = 8000

/**
 * PageNodeBundle의 chunks 메타를 사용해 각 청크의 노드 텍스트를 합본.
 */
export function planChunks(bundle: PageNodeBundle): PlannedChunk[] {
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
 */
export async function summarizeChunks(
  chunkTexts: string[],
  summarize: (text: string) => Promise<string>,
  options: SummarizeOptions = {}
): Promise<SummarizeResult> {
  const combineCharLimit = options.combineCharLimit ?? DEFAULT_COMBINE_CHAR_LIMIT
  if (chunkTexts.length === 0) {
    return { summary: '', chunkSummaries: [], combined: false, combinedPath: 'single' }
  }
  const chunkSummaries: string[] = []
  for (const text of chunkTexts) {
    chunkSummaries.push(await summarize(text))
  }
  if (chunkSummaries.length === 1) {
    return {
      summary: chunkSummaries[0],
      chunkSummaries,
      combined: false,
      combinedPath: 'single'
    }
  }

  const combinedInput = chunkSummaries.join('\n\n')
  if (combinedInput.length <= combineCharLimit) {
    const combined = await summarize(combinedInput)
    return { summary: combined, chunkSummaries, combined: true, combinedPath: 'direct' }
  }

  // 1단계 재분할 — chunkSummaries를 limit 단위로 묶어 부분 통합 요약 만든 뒤 최종 통합.
  const groups = groupByCharLimit(chunkSummaries, combineCharLimit)
  const partialSummaries: string[] = []
  for (const group of groups) {
    partialSummaries.push(await summarize(group.join('\n\n')))
  }
  const finalInput = partialSummaries.join('\n\n')
  if (finalInput.length <= combineCharLimit) {
    const final = await summarize(finalInput)
    return { summary: final, chunkSummaries, combined: true, combinedPath: 'resplit' }
  }
  // 재분할 후에도 초과 → truncate 폴백 (한 번만 재분할 한다는 규약)
  const truncated = finalInput.slice(0, combineCharLimit)
  const final = await summarize(truncated)
  return { summary: final, chunkSummaries, combined: true, combinedPath: 'truncated' }
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
