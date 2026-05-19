/**
 * Sprint 015 M6 T29 — MemoryStatsPanel.
 *
 * WorkspaceSidebar 좌하단 fixed 통계 패널. 워크스페이스 단위 카운트:
 *   - 페이지 N건 인덱싱 + 마지막 N분 전
 *   - 노트 M개
 *   - AI 메모 K건 (chat messages)
 *
 * 자동 갱신:
 *   - 마운트 시 1회 + workspaceVersion 변화 시 즉시
 *   - 5초 폴링 (보수적, 백그라운드 인덱싱 / 노트 / 채팅 모두 INSERT 후 N초 내 반영)
 *
 * 폴링 빈도는 Phase 2+ 에서 IPC broadcast 로 전환 후보 (KI 권고).
 */

import { useEffect, useState, type JSX } from 'react'

import { formatRelativeMinutes } from './formatRelativeMinutes'

interface MemoryStatsPayload {
  workspaceId: string
  pagesCount: number
  visitsCount: number
  notesCount: number
  chatMessagesCount: number
  lastIndexedAt: number | null
}

interface MemoryStatsPanelProps {
  /** 활성 워크스페이스 id — 변경 시 즉시 재로드. null 이면 통계 호출 0 (인프라 부재 추정). */
  workspaceId: string | null
  /** 폴링 주기 ms. 디폴트 5000. 0 이면 폴링 비활성 (테스트 / 백그라운드 탭). */
  pollIntervalMs?: number
  /** 테스트 가능성 — Date.now() 주입. */
  now?: () => number
}

export default function MemoryStatsPanel({
  workspaceId,
  pollIntervalMs = 5000,
  now = Date.now
}: MemoryStatsPanelProps): JSX.Element {
  const [stats, setStats] = useState<MemoryStatsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setStats(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    async function refresh(): Promise<void> {
      try {
        const r = await window.memoryApi.stats({ workspaceId: workspaceId! })
        if (cancelled) return
        if (r.ok && r.stats) {
          setStats(r.stats)
          setError(null)
        } else if (r.errorCode === 'infra_unavailable') {
          setStats(null)
          setError('인프라 비활성')
        } else if (r.errorCode === 'no_active_workspace') {
          setStats(null)
          setError('워크스페이스 미선택')
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void refresh()
    if (pollIntervalMs > 0) {
      timer = setInterval(() => void refresh(), pollIntervalMs)
    }
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [workspaceId, pollIntervalMs])

  if (!workspaceId) {
    return (
      <section className="memory-stats" aria-label="메모리 통계">
        <div className="memory-stats__row memory-stats__row--muted">워크스페이스 미선택</div>
      </section>
    )
  }

  if (error && !stats) {
    return (
      <section className="memory-stats" aria-label="메모리 통계">
        <div className="memory-stats__row memory-stats__row--muted">{error}</div>
      </section>
    )
  }

  if (!stats) {
    return (
      <section className="memory-stats" aria-label="메모리 통계">
        <div className="memory-stats__row memory-stats__row--muted">통계 로딩…</div>
      </section>
    )
  }

  const relative = stats.lastIndexedAt
    ? formatRelativeMinutes(stats.lastIndexedAt, now())
    : '—'

  return (
    <section className="memory-stats" aria-label="메모리 통계">
      <div className="memory-stats__row">
        <span className="memory-stats__label">페이지</span>
        <span className="memory-stats__value">{stats.pagesCount.toLocaleString()}건</span>
      </div>
      <div className="memory-stats__row memory-stats__row--small">
        <span className="memory-stats__label">마지막 방문</span>
        <span className="memory-stats__value">{relative}</span>
      </div>
      <div className="memory-stats__row">
        <span className="memory-stats__label">노트</span>
        <span className="memory-stats__value">{stats.notesCount.toLocaleString()}개</span>
      </div>
      <div className="memory-stats__row">
        <span className="memory-stats__label">AI 메모</span>
        <span className="memory-stats__value">{stats.chatMessagesCount.toLocaleString()}건</span>
      </div>
    </section>
  )
}
