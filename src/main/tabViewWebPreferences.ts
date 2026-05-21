/**
 * Sprint 016 M3 T15 (G-015) — TabView webPreferences 헬퍼.
 *
 * createTabView (main/index.ts) 가 호출하는 pure 헬퍼. WebContentsView 의 `webPreferences`
 * 객체를 박는 책임만. workspace partition 적용 정합 (T14 WorkspacePartitionManager 결과)
 * + 디폴트 보안 옵션 (contextIsolation / nodeIntegration / sandbox) 일관 유지.
 *
 * 책임:
 *   - 보안 디폴트 박음 (contextIsolation true / nodeIntegration false / sandbox true)
 *   - partition 옵션 conditional 박음 — undefined 시 partition key 자체 누락 (Electron default session)
 *
 * 비책임:
 *   - WorkspacePartitionManager 조회 (services.ts 가 별도 호출 후 partition 결과 주입)
 *   - WebContentsView 인스턴스화 (main/index.ts 책임)
 *
 * 단위 회귀: tests/unit/main/tabViewWebPreferences.test.ts
 */

import type { WebPreferences } from 'electron'

export interface BuildTabWebPreferencesOptions {
  /**
   * partition 이름 — `WorkspacePartitionManager.getPartitionName(workspaceId)` 결과.
   * undefined 면 Electron 디폴트 session 사용 (workspace 격리 미적용).
   */
  partition?: string
}

/**
 * WebContentsView webPreferences 박음.
 *
 * partition 미지정 시 partition key 자체 누락 — Electron `new WebContentsView({webPreferences})`
 * 가 partition undefined 받으면 Electron 디폴트 session 사용 (Electron 공식 문서 표현 정합).
 * partition: '' 빈 문자열은 Electron 가 잘못 해석할 위험 있으므로 conditional spread 로 key 자체 박지 않음.
 *
 * 보안 디폴트:
 *   - contextIsolation: true (renderer 와 main 격리)
 *   - nodeIntegration: false (renderer 에 Node API 노출 X)
 *   - sandbox: true (renderer 프로세스 sandbox 적용)
 *   - 본 세 값은 모든 워크스페이스 탭에 동일 (격리 정책 차이 없음, partition 만 ws 별 분리)
 */
export function buildTabWebPreferences(opts: BuildTabWebPreferencesOptions = {}): WebPreferences {
  const base: WebPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
  if (opts.partition !== undefined) {
    base.partition = opts.partition
  }
  return base
}
