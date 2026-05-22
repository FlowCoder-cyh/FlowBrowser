/**
 * Sprint 017 M1 T06 — Highlight restore trigger.
 *
 * `did-finish-load` hook 시점에 호출. HighlightStore 에서 현재 페이지 URL 매칭 anchor 들을
 * 가져와 `webContents.executeJavaScript(buildRestoreScript(records))` 로 페이지 컨텍스트에 inject,
 * CSS Highlight API 로 시각 highlight 복원.
 *
 * 흐름:
 *   1. webContents 가 destroyed / non-http(s) URL 이면 graceful no-op
 *   2. HighlightStore.listByPage({workspaceId, url}) — pageId 미존재 단계 (T06 in-memory) 는 url 매칭 우선
 *   3. records 0개 면 no-op
 *   4. `webContents.insertCSS(buildHighlightCssForIds(...))` — `::highlight(<name>)` 룰 박음
 *   5. `webContents.executeJavaScript(buildRestoreScript(records))` — anchor 복원 + Highlight 등록
 *   6. result 받아서 단위 회귀 가능한 형태로 telemetry 콜백 호출 (없으면 console.warn)
 *
 * codex 사전 협의 (2026-05-22, threadId 019e4b75) 정합:
 *   - selection capture 는 context-menu + executeJavaScript (preload 부재 회피)
 *   - restore trigger 는 runHighlightRestore 헬퍼로 분리 — runPageIndexing 옆 배치
 *   - workspaceId + url 기준 (pageId 의존 회피 — T07 SQLite swap 후 강화)
 *
 * Hotfix 후보 (codex 5종 정합):
 *   1. injection 알고리즘 / highlightAnchor.ts divergence — 단위 회귀 cross-check
 *   2. preload 회귀 회피 — executeJavaScript 경로 고정
 *   3. unsupported_selection — RestoreResult.apiSupported=false 시 graceful no-op
 *   4. SPA re-render → T08 위임
 *   5. CSS Highlight registry 누수 — restore script 가 prefix clear 후 재등록 (highlightInjectionScript.ts)
 */

import type { WebContents } from 'electron'

import type { HighlightStore } from '../storage/HighlightStore'
import {
  buildRestoreScript,
  buildHighlightCssForIds,
  buildRemoveVisualScript,
  buildScrollToScript,
  type RestoreResult,
  type RemoveVisualResult,
  type ScrollToResult
} from '../perception/highlightInjectionScript'

export interface RunHighlightRestoreInput {
  workspaceId: string | null
  webContents: WebContents
}

export interface RunHighlightRestoreOptions {
  /** restore 시점 root selector. 기본 'body'. */
  rootSelector?: string
  /** 단위 테스트용 telemetry hook. result 받음. */
  onResult?: (result: RestoreResult) => void
  /**
   * Sprint 017 M2 T10 — SPA navigation 시 같은 document 의 stale CSS Highlight registry clear.
   * codex 019e4f40 BLOCKING — SPA 이동 후 records=0 일 때도 이전 url 의 highlight CSS Highlight
   * registry 가 같은 document 라 남음 (일반 reload 는 새 document 라 무관). true 일 때 records=0
   * 이라도 buildRestoreScript([]) inject — buildRestoreScript 내부 prefix clear path 만 동작.
   */
  clearWhenEmpty?: boolean
}

export interface RunHighlightRestoreDeps {
  getHighlightStore(): HighlightStore | null
}

/**
 * `did-finish-load` 시점에 호출. graceful — 어떤 throw 도 page UX 영향 없음.
 */
export async function runHighlightRestore(
  input: RunHighlightRestoreInput,
  deps: RunHighlightRestoreDeps,
  options: RunHighlightRestoreOptions = {}
): Promise<RestoreResult | null> {
  const wc = input.webContents
  if (wc.isDestroyed()) return null
  const url = wc.getURL()
  if (!url) return null
  // http/https 외 scheme 은 인덱싱 대상 외 — highlight 도 일관되게 skip.
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null
  const store = deps.getHighlightStore()
  if (!store) return null
  if (!input.workspaceId) return null
  let records
  try {
    records = store.listByPage({
      workspaceId: input.workspaceId,
      url
    })
  } catch {
    return null
  }
  if (records.length === 0 && !options.clearWhenEmpty) return null

  const rootSelector = options.rootSelector ?? 'body'
  const restorePayload = records.map((r) => ({ id: r.id, anchor: r.anchor }))

  // CSS Highlight name 별 룰 동적 박음. ::highlight(<name>) 는 wildcard 미지원.
  const css = buildHighlightCssForIds(records.map((r) => r.id))
  try {
    if (css.length > 0) {
      await wc.insertCSS(css)
    }
  } catch {
    // insertCSS 실패는 시각 highlight 만 막을 뿐 (등록은 안 영향) — graceful.
  }

  try {
    const script = buildRestoreScript(restorePayload, rootSelector)
    const result = (await wc.executeJavaScript(script, true)) as RestoreResult
    if (options.onResult && result) options.onResult(result)
    return result ?? null
  } catch {
    // executeJavaScript 실패 (about:blank navigate 등) — 다음 did-finish-load 재시도.
    return null
  }
}

/**
 * Sprint 017 M1 T08 — `highlight:remove` 성공 직후 page context visual delete.
 *
 * codex 019e4ec8 #2 — DB row 와 `CSS.highlights` registry 분리 상태. store DELETE 직후 본 helper 호출
 * 강제하여 시각 highlight 즉시 제거. 모든 throw graceful.
 */
export async function runHighlightRemoveVisual(
  webContents: WebContents,
  highlightId: string
): Promise<RemoveVisualResult | null> {
  if (webContents.isDestroyed()) return null
  const url = webContents.getURL()
  if (!url) return null
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null
  try {
    const script = buildRemoveVisualScript(highlightId)
    const result = (await webContents.executeJavaScript(script, true)) as RemoveVisualResult
    return result ?? null
  } catch {
    return null
  }
}

/**
 * Sprint 017 M1 T08 — `highlight:scroll-to` page context scrollIntoView.
 *
 * NoteHighlight list item click event → IPC → 본 helper. 활성 WebContentsView 에서 해당 highlight
 * 의 first range 위치로 smooth scroll. 모든 throw graceful.
 */
export async function runHighlightScrollTo(
  webContents: WebContents,
  highlightId: string
): Promise<ScrollToResult | null> {
  if (webContents.isDestroyed()) return null
  const url = webContents.getURL()
  if (!url) return null
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null
  try {
    const script = buildScrollToScript(highlightId)
    const result = (await webContents.executeJavaScript(script, true)) as ScrollToResult
    return result ?? null
  } catch {
    return null
  }
}
