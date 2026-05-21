/**
 * Sprint 017 M0 T01 — fake-timer 기반 단위 테스트 helper.
 *
 * `vi.useFakeTimers()` + manual fakeTime + scheduleTimer stub 패턴에서
 * dispatch 루프가 setTimeout(0) callback 과 microtask 를 chain 하는 경우
 * 호출자가 직접 `advance + Promise.resolve()` 를 반복해야 한다 — 본 helper 가 그 패턴을 캡슐화.
 *
 * codex 사전 협의 (Sprint 016 M5 T23 후속 위임) 정합 — drainUntil(step, predicate, max=20).
 *
 * 사용 예:
 *   await drainUntil(
 *     () => advance(fx, 0),
 *     () => fx.store.findById(j.id)?.status === 'completed',
 *     { description: 'job completed' }
 *   )
 *
 * 본 helper 는 의도적으로 production 코드와 분리 — `tests/**` 외부에서 import 금지.
 */

export interface DrainUntilOptions {
  /** 최대 반복 횟수. 도달 시 throw. 기본값 20. */
  maxIterations?: number
  /** throw 메시지에 포함될 설명 (디버깅 보조). */
  description?: string
}

/**
 * `step` 을 동기 실행 → microtask 1회 flush 반복.
 * `predicate` 가 true 가 되면 즉시 종료. 최대 `maxIterations` 회 후에도 false 면 throw.
 *
 * @param step       매 반복마다 동기 실행될 함수 (보통 `() => advance(fx, 0)`)
 * @param predicate  종료 조건 — true 반환 시 종료
 * @param options    maxIterations / description
 *
 * @throws Error  `maxIterations` 도달 후에도 predicate false 일 때
 */
export async function drainUntil(
  step: () => void,
  predicate: () => boolean,
  options?: DrainUntilOptions
): Promise<void> {
  const max = options?.maxIterations ?? 20
  if (max <= 0) {
    throw new Error(
      `drainUntil: maxIterations must be > 0 (got ${max})` +
        (options?.description ? ` (${options.description})` : '')
    )
  }
  // 진입 시점 이미 predicate true 면 step 호출 없이 즉시 종료.
  if (predicate()) return
  for (let i = 0; i < max; i++) {
    step()
    // microtask 1회 flush — processor await 체인이 다음 setTimeout 등록을 마칠 때까지.
    await Promise.resolve()
    if (predicate()) return
  }
  throw new Error(
    `drainUntil: predicate did not become true within ${max} iterations` +
      (options?.description ? ` (${options.description})` : '')
  )
}
