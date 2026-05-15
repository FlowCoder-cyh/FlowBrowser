/**
 * Sprint 004 M3 / S004-T06 — SummarizationPlanner 단위 테스트.
 * 청크 분할 → 통합 요약 흐름을 mock provider로 검증.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  planChunks,
  summarizeChunks,
  SummarizationAbortedError
} from '../../../src/ai/SummarizationPlanner'
import type { PageNodeBundle } from '../../../src/perception/PageNodeExtractor'

function bundle(nodes: Array<[string, string]>, chunks: Array<[number, string, string]>): PageNodeBundle {
  return {
    nodes: nodes.map(([id, text]) => ({ id, text, tag: 'p' })),
    chunks: chunks.map(([index, startNodeId, endNodeId]) => {
      const startIdx = nodes.findIndex(([nid]) => nid === startNodeId)
      const endIdx = nodes.findIndex(([nid]) => nid === endNodeId)
      const size = endIdx - startIdx + 1
      const charCount = nodes
        .slice(startIdx, endIdx + 1)
        .reduce((sum, [, t]) => sum + t.length, 0)
      return { index, startNodeId, endNodeId, size, charCount }
    })
  }
}

describe('planChunks', () => {
  it('각 chunk를 startNodeId~endNodeId 범위로 합본', () => {
    const b = bundle(
      [
        ['n0', '첫 문단'],
        ['n1', '둘째 문단'],
        ['n2', '셋째 문단']
      ],
      [
        [0, 'n0', 'n1'],
        [1, 'n2', 'n2']
      ]
    )
    const planned = planChunks(b)
    expect(planned.length).toBe(2)
    expect(planned[0].text).toBe('첫 문단\n\n둘째 문단')
    expect(planned[1].text).toBe('셋째 문단')
    expect(planned[0].meta.index).toBe(0)
  })

  it('단일 청크 노드 단일이면 단일 텍스트', () => {
    const b = bundle([['n0', '유일한 문단입니다.']], [[0, 'n0', 'n0']])
    const planned = planChunks(b)
    expect(planned.length).toBe(1)
    expect(planned[0].text).toBe('유일한 문단입니다.')
  })

  it('빈 nodes / chunks이면 빈 배열 반환', () => {
    const b: PageNodeBundle = { nodes: [], chunks: [] }
    expect(planChunks(b).length).toBe(0)
  })

  it('chunks에 존재하지 않는 nodeId는 스킵', () => {
    const b: PageNodeBundle = {
      nodes: [{ id: 'n0', text: '문단', tag: 'p' }],
      chunks: [
        { index: 0, startNodeId: 'n0', endNodeId: 'n0', size: 1, charCount: 2 },
        { index: 1, startNodeId: 'missing', endNodeId: 'missing', size: 0, charCount: 0 }
      ]
    }
    const planned = planChunks(b)
    expect(planned.length).toBe(1)
    expect(planned[0].text).toBe('문단')
  })
})

describe('summarizeChunks', () => {
  it('빈 배열은 빈 결과', async () => {
    const result = await summarizeChunks([], async () => 'never')
    expect(result.summary).toBe('')
    expect(result.chunkSummaries).toEqual([])
    expect(result.combined).toBe(false)
  })

  it('청크 1개면 통합 단계 스킵 (combined=false, 1회 호출)', async () => {
    const summarize = vi.fn(async (text: string) => `요약: ${text}`)
    const result = await summarizeChunks(['원문 1'], summarize)
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(result.summary).toBe('요약: 원문 1')
    expect(result.chunkSummaries).toEqual(['요약: 원문 1'])
    expect(result.combined).toBe(false)
  })

  it('청크 N개면 각 청크 + 통합 (N+1회 호출, combined=true)', async () => {
    const summarize = vi.fn(async (text: string) => `S(${text.slice(0, 4)})`)
    const result = await summarizeChunks(['원문1AAA', '원문2BBB', '원문3CCC'], summarize)
    expect(summarize).toHaveBeenCalledTimes(4)
    expect(result.chunkSummaries.length).toBe(3)
    expect(result.combined).toBe(true)
    // 통합 호출은 청크 요약들의 join('\n\n')을 입력으로 받음
    const lastCall = summarize.mock.calls[3][0] as string
    expect(lastCall).toContain('\n\n')
    expect(lastCall).toContain(result.chunkSummaries[0])
    expect(lastCall).toContain(result.chunkSummaries[2])
  })

  it('summarize가 throw하면 호출자에게 전파', async () => {
    const summarize = vi.fn(async () => {
      throw new Error('rate-limit')
    })
    await expect(summarizeChunks(['원문'], summarize)).rejects.toThrow('rate-limit')
  })

  it('combinedPath: single (청크 1개)', async () => {
    const result = await summarizeChunks(['단일'], async (t) => `S(${t})`)
    expect(result.combinedPath).toBe('single')
    expect(result.combined).toBe(false)
  })

  it('combinedPath: direct (limit 이하)', async () => {
    const result = await summarizeChunks(
      ['a', 'b', 'c'],
      async (t) => `S(${t})`,
      { combineCharLimit: 100 }
    )
    expect(result.combinedPath).toBe('direct')
    expect(result.combined).toBe(true)
  })

  it('combinedPath: resplit (limit 초과 → 부분 통합 → 최종 통합)', async () => {
    const longChunk = 'X'.repeat(60)
    const summarize = vi.fn(async (t: string) => t.slice(0, 30))
    const result = await summarizeChunks(
      [longChunk, longChunk, longChunk, longChunk],
      summarize,
      { combineCharLimit: 100 }
    )
    expect(result.combinedPath).toBe('resplit')
    // 4 청크 요약 + 부분 통합 N개 + 최종 통합 1개
    expect(summarize.mock.calls.length).toBeGreaterThan(4 + 1)
  })

  it('combinedInputChars 메타 반환 — single 경로 (Sprint 007 M2)', async () => {
    const result = await summarizeChunks(['원문 25자만'], async (t) => `S(${t})`, {
      combineCharLimit: 100
    })
    expect(result.combinedPath).toBe('single')
    expect(result.combinedInputChars).toBe('원문 25자만'.length)
    expect(result.combineCharLimit).toBe(100)
  })

  it('combinedInputChars 메타 반환 — truncated 경로면 limit과 같음', async () => {
    const summarize = vi.fn(async (t: string) => `${t}|tail`)
    const longChunk = 'X'.repeat(80)
    const result = await summarizeChunks(
      [longChunk, longChunk, longChunk, longChunk, longChunk, longChunk],
      summarize,
      { combineCharLimit: 100 }
    )
    expect(result.combinedPath).toBe('truncated')
    expect(result.combinedInputChars).toBe(100)
    expect(result.combineCharLimit).toBe(100)
  })

  it('combinedPath: truncated (재분할 후에도 limit 초과 → truncate 폴백)', async () => {
    // summarize가 입력 길이를 거의 유지 (truncate 안 됨) → 재분할 후에도 큰 입력 유지
    const summarize = vi.fn(async (t: string) => `${t}|tail`)
    const longChunk = 'X'.repeat(80)
    const result = await summarizeChunks(
      [longChunk, longChunk, longChunk, longChunk, longChunk, longChunk],
      summarize,
      { combineCharLimit: 100 }
    )
    expect(result.combinedPath).toBe('truncated')
    // 마지막 호출의 입력 길이는 정확히 100
    const lastInput = summarize.mock.calls[summarize.mock.calls.length - 1][0] as string
    expect(lastInput.length).toBe(100)
  })

  it('순차 호출 (병렬 아님) — 각 청크 결과 보존', async () => {
    const order: string[] = []
    const summarize = async (text: string): Promise<string> => {
      order.push(`start-${text}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end-${text}`)
      return `S(${text})`
    }
    await summarizeChunks(['A', 'B', 'C'], summarize)
    // start-A → end-A → start-B → end-B → start-C → end-C → start-S(A)\n\nS(B)\n\nS(C) → end
    expect(order[0]).toBe('start-A')
    expect(order[1]).toBe('end-A')
    expect(order[2]).toBe('start-B')
    expect(order[3]).toBe('end-B')
    expect(order[4]).toBe('start-C')
    expect(order[5]).toBe('end-C')
  })

  // Sprint 011 M1 — abort
  describe('abort (Sprint 011 M1)', () => {
    it('시작 직후 abort — 어떤 청크도 처리되지 않음', async () => {
      const summarize = vi.fn().mockResolvedValue('S')
      let aborted = true // 시작부터 true
      await expect(
        summarizeChunks(['A', 'B', 'C'], summarize, { abortCheck: () => aborted })
      ).rejects.toThrow(SummarizationAbortedError)
      expect(summarize).not.toHaveBeenCalled()
      // suppress unused warning
      aborted = false
    })

    it('중간 abort — 일부 청크 처리 후 throw', async () => {
      const summarize = vi.fn().mockResolvedValue('S')
      let aborted = false
      let calls = 0
      const result = summarizeChunks(['A', 'B', 'C'], summarize, {
        abortCheck: () => {
          calls++
          if (calls === 3) aborted = true
          return aborted
        }
      })
      await expect(result).rejects.toThrow(SummarizationAbortedError)
      expect(summarize).toHaveBeenCalledTimes(2)
    })

    it('abortCheck 없이 정상 흐름 회귀', async () => {
      const summarize = vi.fn().mockResolvedValue('S')
      const r = await summarizeChunks(['A'], summarize) // options 미전달 정상 동작
      expect(r.summary).toBe('S')
    })
  })
})
