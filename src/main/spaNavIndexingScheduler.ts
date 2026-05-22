/**
 * Sprint 017 M2 T10 (KI-020) — SPA `did-navigate-in-page` 자동 인덱싱 debounce scheduler.
 *
 * 흐름:
 *   1. `did-navigate-in-page` (isMainFrame=true) 시점 호출자가 `schedule(tabId, opts)`
 *   2. 본 helper 가 module-level Map<tabId, timer> 로 debounce. 같은 tabId 의 직전 timer 가
 *      대기 중이면 clear → 마지막 안정 URL 만 fire.
 *   3. fire 직전 `isDestroyed()` + `getCurrentUrl() === scheduledUrl` 비교 (codex T10 사전 협의
 *      019e4f40 HIGH — full navigation 시작 시 새 URL 을 stale DOM 으로 인덱싱하는 race 차단).
 *   4. `destroyTabView` 호출자는 본 helper 의 `cancel(tabId)` 로 leak 차단.
 *
 * 본 helper 는 Electron 의존성 0 — `WebContents` 는 호출자 closure 안에 캡처. 단위 회귀 가능.
 *
 * 디폴트 debounce 1000ms (codex Q1 권고) — Notion 류 다단 pushState + async DOM settle 고려.
 */

export const SPA_INDEX_DEBOUNCE_MS = 1000

export interface SpaNavIndexingDeps {
  /** schedule 호출 시점에 캡처한 URL. fire 직전 currentUrl 과 비교. */
  scheduledUrl: string
  /** fire 시점 호출. async 가능. throw 는 본 helper 가 swallow (graceful). */
  runIndex(scheduledUrl: string): Promise<void> | void
  /** fire 직전 현재 URL. webContents.getURL() 권고. */
  getCurrentUrl(): string
  /** fire 직전 webContents 살아있는지. */
  isDestroyed(): boolean
}

export interface SpaNavScheduler {
  schedule(tabId: string, deps: SpaNavIndexingDeps): void
  cancel(tabId: string): void
  cancelAll(): void
  /** 테스트용. 현재 대기 중 timer 개수. */
  pending(): number
}

export interface SpaNavSchedulerOptions {
  /** debounce ms. 기본 1000. */
  debounceMs?: number
  /** 테스트 주입용 setTimeout. */
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** 테스트 주입용 clearTimeout. */
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * SPA navigation URL 비교용 정규화 — origin + pathname + search (hash 제외).
 *
 * codex 019e4f51 dual review BLOCKING #2 hotfix —
 *   hash-only `did-navigate-in-page` (e.g. `#section1` → `#section2`) 시점은 같은 페이지의
 *   anchor 점프일 뿐. 인덱싱 / highlight 양쪽 모두 무관 (같은 콘텐츠). 이 경우 schedule 자체 skip
 *   하여 `runHighlightRestore` 의 stale clear (records=[] + clearWhenEmpty=true) 차단.
 *
 * search 만 변경 (e.g. `?tab=2`) 은 다른 데이터 — schedule 정상 진행 (별도 후속 KI 로 highlight URL
 * 매칭 정책 개선 위임 예정).
 *
 * 파싱 실패 시 원본 trim 반환 (graceful, 비교 시 미스매치 → schedule 진행).
 */
export function urlPathAndSearch(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}${u.search}`
  } catch {
    return url.trim()
  }
}

/**
 * 직전 SPA 인덱싱 path 와 현재 URL 비교 — hash 만 바뀐 경우 true.
 *
 * lastPath 가 null (첫 호출) 이면 false — schedule 진행.
 */
export function isHashOnlyNavigation(currentUrl: string, lastPath: string | null): boolean {
  if (lastPath === null) return false
  return urlPathAndSearch(currentUrl) === lastPath
}

export function createSpaNavScheduler(opts: SpaNavSchedulerOptions = {}): SpaNavScheduler {
  const debounceMs = opts.debounceMs ?? SPA_INDEX_DEBOUNCE_MS
  const _setTimeout =
    opts.setTimeout ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as ReturnType<typeof setTimeout>)
  const _clearTimeout =
    opts.clearTimeout ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle))
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return {
    schedule(tabId, deps) {
      const existing = timers.get(tabId)
      if (existing) _clearTimeout(existing)
      const handle = _setTimeout(() => {
        timers.delete(tabId)
        if (deps.isDestroyed()) return
        if (deps.getCurrentUrl() !== deps.scheduledUrl) return
        Promise.resolve()
          .then(() => deps.runIndex(deps.scheduledUrl))
          .catch(() => {
            // graceful — runIndex 호출자에서 try/catch 보장 권고. fallback swallow.
          })
      }, debounceMs)
      timers.set(tabId, handle)
    },
    cancel(tabId) {
      const handle = timers.get(tabId)
      if (handle) {
        _clearTimeout(handle)
        timers.delete(tabId)
      }
    },
    cancelAll() {
      for (const handle of timers.values()) _clearTimeout(handle)
      timers.clear()
    },
    pending() {
      return timers.size
    }
  }
}
