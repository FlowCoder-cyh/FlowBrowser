/**
 * Sprint 016 M0 T05 (KI-010) — createIndexingBroadcastHandler 단위 테스트.
 *
 * codex T05 사전 dual review NEEDS_CHANGES #7 해소 — services.ts 의 broadcast closure 가
 * status='indexed' 시점에만 broadcaster 호출 정합 직접 검증. BrowserWindow / IPC 의존 없이 순수 함수 단위.
 *
 * cover:
 *   - status='indexed' + workspaceId 명시 → broadcaster(workspaceId) 호출
 *   - status='indexed' + workspaceId 미명시 → broadcaster(null) 호출 (services 측 null guard 흡수)
 *   - status='blocked' + workspaceId undefined → broadcaster 미호출
 *   - status='blocked' + workspaceId 명시 (IndexingService 가 절대 박지 않으나 방어) → broadcaster 미호출
 *   - 다회 호출 분기 (indexed 2회 / blocked 1회 / indexed 1회) → broadcaster 정확히 3회
 */

import { describe, it, expect, vi } from 'vitest'

import { createIndexingBroadcastHandler } from '../../../src/main/services'
import type { IndexingStatusPayload } from '../../../src/main/IndexingService'

function indexedPayload(workspaceId?: string): IndexingStatusPayload {
  return {
    url: 'https://example.com/p',
    workspaceId,
    timestamp: 1,
    result: {
      status: 'indexed',
      pageId: 'page-uuid',
      visitId: 'visit-uuid',
      action: 'created'
    }
  }
}

function blockedPayload(workspaceIdOverride?: string): IndexingStatusPayload {
  return {
    url: 'https://gmail.com/inbox',
    workspaceId: workspaceIdOverride,
    timestamp: 1,
    result: {
      status: 'blocked',
      evaluation: {
        allowed: false,
        blockReason: 'domain',
        matchedBy: 'default_domain',
        matchedPattern: 'gmail.com'
      }
    }
  }
}

describe('createIndexingBroadcastHandler', () => {
  it('status="indexed" + workspaceId 명시 → broadcaster(workspaceId) 호출', () => {
    const broadcaster = vi.fn<(ws: string | null) => void>()
    const handler = createIndexingBroadcastHandler(broadcaster)
    handler(indexedPayload('ws-abc'))
    expect(broadcaster).toHaveBeenCalledTimes(1)
    expect(broadcaster).toHaveBeenCalledWith('ws-abc')
  })

  it('status="indexed" + workspaceId 미명시 → broadcaster(null) 호출 (services 측 null guard 흡수)', () => {
    const broadcaster = vi.fn<(ws: string | null) => void>()
    const handler = createIndexingBroadcastHandler(broadcaster)
    handler(indexedPayload(undefined))
    expect(broadcaster).toHaveBeenCalledTimes(1)
    expect(broadcaster).toHaveBeenCalledWith(null)
  })

  it('status="blocked" + workspaceId undefined → broadcaster 미호출', () => {
    const broadcaster = vi.fn<(ws: string | null) => void>()
    const handler = createIndexingBroadcastHandler(broadcaster)
    handler(blockedPayload(undefined))
    expect(broadcaster).not.toHaveBeenCalled()
  })

  it('status="blocked" + workspaceId override (방어) → broadcaster 미호출', () => {
    // IndexingService 자체는 blocked 시 workspaceId 를 absolute undefined 로 박지만,
    // 방어적으로 핸들러 자체가 blocked status 자체에서 차단하는지 검증.
    const broadcaster = vi.fn<(ws: string | null) => void>()
    const handler = createIndexingBroadcastHandler(broadcaster)
    handler(blockedPayload('ws-malformed'))
    expect(broadcaster).not.toHaveBeenCalled()
  })

  it('indexed 2회 + blocked 1회 + indexed 1회 → broadcaster 정확히 3회 (blocked 만 skip)', () => {
    const broadcaster = vi.fn<(ws: string | null) => void>()
    const handler = createIndexingBroadcastHandler(broadcaster)
    handler(indexedPayload('ws-a'))
    handler(indexedPayload('ws-b'))
    handler(blockedPayload())
    handler(indexedPayload('ws-a'))
    expect(broadcaster).toHaveBeenCalledTimes(3)
    expect(broadcaster.mock.calls).toEqual([['ws-a'], ['ws-b'], ['ws-a']])
  })
})
