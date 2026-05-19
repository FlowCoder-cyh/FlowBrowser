/**
 * Sprint 015 M6 T29 — memoryHandlers 단위 테스트.
 *
 * cover:
 *   - infra_unavailable (svc null) graceful 응답
 *   - no_active_workspace (workspaceId 미주입 + active null)
 *   - workspaceId 명시 시 우선 사용
 *   - active fallback
 */

import { describe, it, expect } from 'vitest'
import { handleMemoryStats } from '../../../src/main/memoryHandlers'
import type { MemoryService, MemoryStats } from '../../../src/main/MemoryService'

function makeStubSvc(stats: MemoryStats): MemoryService {
  return {
    getStats: (id: string): MemoryStats => ({ ...stats, workspaceId: id })
  } as unknown as MemoryService
}

describe('memoryHandlers', () => {
  it('returns infra_unavailable when svc null', () => {
    const r = handleMemoryStats(
      {},
      {
        getActiveWorkspaceId: () => 'ws-1',
        getMemoryService: () => null
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('infra_unavailable')
  })

  it('returns no_active_workspace when no id provided and active null', () => {
    const svc = makeStubSvc({
      workspaceId: '',
      pagesCount: 0,
      visitsCount: 0,
      notesCount: 0,
      chatMessagesCount: 0,
      lastIndexedAt: null
    })
    const r = handleMemoryStats(
      {},
      {
        getActiveWorkspaceId: () => null,
        getMemoryService: () => svc
      }
    )
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('no_active_workspace')
  })

  it('uses workspaceId arg when provided (ignores active)', () => {
    const svc = makeStubSvc({
      workspaceId: '',
      pagesCount: 5,
      visitsCount: 7,
      notesCount: 2,
      chatMessagesCount: 3,
      lastIndexedAt: 1000
    })
    const r = handleMemoryStats(
      { workspaceId: 'ws-arg' },
      {
        getActiveWorkspaceId: () => 'ws-active',
        getMemoryService: () => svc
      }
    )
    expect(r.ok).toBe(true)
    expect(r.stats?.workspaceId).toBe('ws-arg')
    expect(r.stats?.pagesCount).toBe(5)
  })

  it('falls back to active when arg missing', () => {
    const svc = makeStubSvc({
      workspaceId: '',
      pagesCount: 10,
      visitsCount: 10,
      notesCount: 1,
      chatMessagesCount: 1,
      lastIndexedAt: 2000
    })
    const r = handleMemoryStats(
      {},
      {
        getActiveWorkspaceId: () => 'ws-fallback',
        getMemoryService: () => svc
      }
    )
    expect(r.ok).toBe(true)
    expect(r.stats?.workspaceId).toBe('ws-fallback')
    expect(r.stats?.lastIndexedAt).toBe(2000)
  })
})
