/**
 * Sprint 015 M2-3 — SummarizationPlanner deprecation 마킹 회귀.
 *
 * 검증:
 *   - planChunks / summarizeChunks 호출 시 dev console.warn 1회 발생 (호출 폭주 방지)
 *   - 코드 동작 자체는 v0.3 모드 그대로 (기존 SummarizationPlanner.test.ts 18 테스트 PASS 보장)
 *
 * 본 deprecation 마킹은 M2-4 PR (IPC handler + 모듈 + 테스트 제거) 까지 유효.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PageNodeBundle } from '../../../src/perception/PageNodeExtractor'

function emptyBundle(): PageNodeBundle {
  return { nodes: [], chunks: [] }
}

describe('SummarizationPlanner deprecation (M2-3)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // M2-3 deprecate 는 모듈 단위 flag (deprecationWarned). 한 번 발생 후 더 이상 호출 X.
    // 본 테스트는 모듈 격리 위해 vi.resetModules + dynamic import 사용.
    vi.resetModules()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('planChunks 첫 호출 시 console.warn 1회 발생', async () => {
    const mod = await import('../../../src/ai/SummarizationPlanner')
    mod.planChunks(emptyBundle())
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/SummarizationPlanner is deprecated/)
    expect(warnSpy.mock.calls[0][0]).toMatch(/Sprint 015 M2-3/)
    expect(warnSpy.mock.calls[0][0]).toMatch(/M2-4/)
  })

  it('summarizeChunks 첫 호출 시 console.warn 1회 발생', async () => {
    const mod = await import('../../../src/ai/SummarizationPlanner')
    await mod.summarizeChunks(['a'], async (t: string) => `sum(${t})`)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('동일 모듈 인스턴스 내 반복 호출 시 추가 warn 없음 (호출 폭주 방지)', async () => {
    const mod = await import('../../../src/ai/SummarizationPlanner')
    mod.planChunks(emptyBundle())
    mod.planChunks(emptyBundle())
    await mod.summarizeChunks(['a'], async (t: string) => `sum(${t})`)
    await mod.summarizeChunks(['b'], async (t: string) => `sum(${t})`)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('deprecation 마킹 후에도 함수는 v0.3 동작 그대로 반환', async () => {
    const mod = await import('../../../src/ai/SummarizationPlanner')
    const result = await mod.summarizeChunks(['hello', 'world'], async (t: string) => `S(${t})`)
    expect(result.chunkSummaries).toEqual(['S(hello)', 'S(world)'])
    expect(result.combined).toBe(true)
    expect(result.combinedPath).toBe('direct')
  })
})
