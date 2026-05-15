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
}

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
 */
export async function summarizeChunks(
  chunkTexts: string[],
  summarize: (text: string) => Promise<string>
): Promise<SummarizeResult> {
  if (chunkTexts.length === 0) {
    return { summary: '', chunkSummaries: [], combined: false }
  }
  const chunkSummaries: string[] = []
  for (const text of chunkTexts) {
    chunkSummaries.push(await summarize(text))
  }
  if (chunkSummaries.length === 1) {
    return { summary: chunkSummaries[0], chunkSummaries, combined: false }
  }
  const combined = await summarize(chunkSummaries.join('\n\n'))
  return { summary: combined, chunkSummaries, combined: true }
}
