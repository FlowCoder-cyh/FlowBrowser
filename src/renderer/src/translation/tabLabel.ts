/**
 * Sprint 013 M3 — TabBar formatTabLabel 순수 함수 추출.
 * Sprint 008 M2부터 inline이던 라벨 포맷 로직.
 *
 * 우선순위: title > URL hostname > URL 원본 > '새 탭'
 *
 * Sprint 016 M0 T03b (KI-017) — 워크스페이스 컨텍스트 props 도입.
 * 탭 workspace_id 가 활성 워크스페이스와 매칭되면 아이콘 prefix 추가.
 * 미매칭 (다른 ws 의 탭, V1 마이그레이션 직후 null) 시 디폴트 라벨 fallback — 표시 단계 회귀 안전성 유지.
 * UI wiring (TabBar 가 활성 워크스페이스 정보 주입) 은 T03c 위임.
 */

export interface TabLabelInput {
  url: string
  title: string
  /** Sprint 016 M0 T03a — 탭 워크스페이스 메타. 미지정 시 null (V1 마이그레이션 직후 backfill 전). */
  workspace_id?: string | null
}

/**
 * Sprint 016 M0 T03b — 활성 워크스페이스 컨텍스트.
 * `id` 가 탭 workspace_id 와 매칭되면 라벨에 `icon` prefix 가 박힘.
 * null 또는 미매칭 시 라벨 변동 없음 (디폴트 fallback).
 *
 * 정책: 탭 라벨에는 **아이콘 prefix 만** 표시. 워크스페이스 이름은 사이드바 (`WorkspaceSidebar`) 에서
 * 별도 표시 — 탭 라벨에 이름까지 박으면 가시성 저하 + 동일 ws 내 N개 탭 가독성 떨어짐.
 * KI-017 closed 정합 (codex PR #172 NEEDS_CHANGES — 이름 필드 미사용 정리).
 */
export interface WorkspaceLabelContext {
  id: string
  icon: string
}

export function formatTabLabel(
  t: TabLabelInput,
  workspaceContext: WorkspaceLabelContext | null = null
): string {
  const base = formatTabLabelBase(t)
  // 워크스페이스 prefix — 탭 workspace_id 가 활성 ws 와 정확히 일치할 때만 박음
  if (workspaceContext && t.workspace_id && t.workspace_id === workspaceContext.id) {
    return `${workspaceContext.icon} ${base}`
  }
  return base
}

function formatTabLabelBase(t: TabLabelInput): string {
  if (t.title) return t.title
  if (!t.url || t.url === 'about:blank') return '새 탭'
  try {
    const u = new URL(t.url)
    return u.hostname || t.url
  } catch {
    return t.url
  }
}
