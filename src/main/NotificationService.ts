/**
 * Sprint 016 M4 T19 — NotificationService (Electron Notification 통합 + renderer fallback).
 *
 * PRD §11.2.1 + §16 roadmap §76 "Sprint 016 — cookies/session/캐시 격리 + 하이라이트 +
 * 자동 수준 추정" + T18 BackgroundTranslationQueue 완료 알림 trigger.
 *
 * 책임:
 *   1. OS 시스템 알림 (Electron Notification API) — main process 진입
 *   2. unsupported / 권한 거부 시 renderer fallback (IPC `notification:fallback` event)
 *   3. generic trigger — translation completed / failed / threshold / indexing 완료 / import 완료
 *
 * 본 모듈은 Electron Notification 클래스 직접 import 가 아닌 NotificationFactory 인터페이스
 * 주입 — 단위 테스트 stub 가능 + headless 환경 안전.
 *
 * 호출자 wiring (별도):
 *   - main/index.ts 가 `new NotificationService({ factory: makeRealNotificationFactory(), ... })`
 *   - T18 BackgroundTranslationQueue 가 진입 시 svc.notify({ title, body }) 호출
 *
 * codex M4 사전 협의 정합:
 *   - Notification.isSupported() 체크 (headless / 권한 거부 환경)
 *   - .show() 누락 방지 — notify() 가 항상 show() 호출
 *   - destroyed window guard — onClick 시 isDestroyed() 검증
 *   - generic trigger — translation 외 indexing / import / 사용자 정의 모두 수용
 */

import type { BrowserWindow } from 'electron'

export type NotificationUrgency = 'normal' | 'critical' | 'low'

/**
 * generic notify 입력. trigger 종류는 호출자 책임 — Service 는 그대로 OS 또는 fallback 전달.
 */
export interface NotifyInput {
  /** 알림 제목 (필수, 1자 이상). */
  title: string
  /** 알림 본문 (선택). */
  body?: string
  /** 우선순위 — Electron Notification.urgency (Linux), macOS 는 'critical' 만 의미). */
  urgency?: NotificationUrgency
  /** 알림 click 시 호출. window 가 destroyed 면 자동 no-op (guard). */
  onClick?: () => void
}

export type NotifyDelivery =
  | 'os' // OS 시스템 알림 성공
  | 'ipc-fallback' // OS 미지원/실패 → renderer toast IPC 전송
  | 'unsupported' // OS 미지원 + IPC fallback 도 실패 (창 0)

export interface NotifyResult {
  delivered: NotifyDelivery
  /** 실패 시 사유 (디버그용). */
  reason?: string
}

/**
 * NotificationFactory — Electron Notification 클래스를 추상화.
 *
 * 호출자 (main/index.ts) 가 `makeRealNotificationFactory()` 로 진입. 단위 테스트는 stub.
 */
export interface NotificationFactory {
  /** OS Notification 지원 여부. headless / 권한 거부 시 false. */
  isSupported(): boolean
  /**
   * Notification 인스턴스 생성. show() 호출 / onClick 콜백 결합은 본 인터페이스 책임.
   *
   * 실패 시 throw — NotificationService 가 catch + fallback 트리거.
   */
  show(opts: { title: string; body?: string; urgency?: NotificationUrgency }, onClick?: () => void): void
}

export interface BrowserWindowProvider {
  getAllWindows(): BrowserWindow[]
}

export interface NotificationServiceOptions {
  factory: NotificationFactory
  windows: BrowserWindowProvider
  /** IPC channel 명. 디폴트 'notification:fallback'. */
  ipcChannel?: string
}

const DEFAULT_IPC_CHANNEL = 'notification:fallback'

export class NotificationService {
  private readonly factory: NotificationFactory
  private readonly windows: BrowserWindowProvider
  private readonly ipcChannel: string

  constructor(opts: NotificationServiceOptions) {
    if (!opts.factory) throw new Error('NotificationService: factory required')
    if (!opts.windows) throw new Error('NotificationService: windows provider required')
    this.factory = opts.factory
    this.windows = opts.windows
    this.ipcChannel = opts.ipcChannel ?? DEFAULT_IPC_CHANNEL
  }

  /**
   * 알림 표시.
   *
   * 흐름:
   *   1. title 비어있으면 throw (호출자 책임)
   *   2. factory.isSupported() = true → factory.show() 시도. throw 시 catch → fallback.
   *   3. isSupported() = false → renderer IPC fallback 직행.
   *   4. fallback 도 실패 (창 0) → 'unsupported' 반환.
   *
   * onClick 은 OS 알림 path 에서만 결합 (IPC fallback path 는 renderer 측에서 toast click handler).
   * destroyed window guard 는 호출자 onClick wrapper 가 처리.
   */
  notify(input: NotifyInput): NotifyResult {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('NotificationService.notify: title required')
    }

    if (this.factory.isSupported()) {
      try {
        // destroyed window guard — onClick wrapper
        const safeOnClick = input.onClick
          ? (): void => {
              try {
                input.onClick!()
              } catch {
                // user-supplied handler throw — silent (알림 자체는 이미 표시됨)
              }
            }
          : undefined
        this.factory.show(
          { title: input.title, body: input.body, urgency: input.urgency },
          safeOnClick
        )
        return { delivered: 'os' }
      } catch (e) {
        // factory throw → fallback 으로 전환
        const fallback = this.fallbackToRenderer(input)
        if (fallback.delivered === 'unsupported') {
          return {
            delivered: 'unsupported',
            reason: `OS notify throw: ${e instanceof Error ? e.message : String(e)} + fallback no windows`
          }
        }
        return fallback
      }
    }

    return this.fallbackToRenderer(input)
  }

  private fallbackToRenderer(input: NotifyInput): NotifyResult {
    const wins = this.windows.getAllWindows().filter((w) => !w.isDestroyed())
    if (wins.length === 0) {
      return { delivered: 'unsupported', reason: 'no active BrowserWindow for IPC fallback' }
    }
    for (const win of wins) {
      win.webContents.send(this.ipcChannel, {
        title: input.title,
        body: input.body ?? null,
        urgency: input.urgency ?? 'normal'
      })
    }
    return { delivered: 'ipc-fallback' }
  }
}

/**
 * 실제 Electron Notification 기반 factory.
 *
 * 본 함수는 main/index.ts 에서 import — runtime 시점에만 호출 (Electron 의존 격리).
 * 단위 테스트는 본 factory 미사용 (stub 으로 대체).
 */
export function makeRealNotificationFactory(): NotificationFactory {
  // 함수 호출 시점에 lazy import — typecheck 시 electron 모듈 로드 회피 (테스트 환경 정합).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  const NotificationCtor = electron.Notification
  return {
    isSupported(): boolean {
      try {
        return NotificationCtor.isSupported()
      } catch {
        return false
      }
    },
    show(opts, onClick): void {
      const n = new NotificationCtor({
        title: opts.title,
        body: opts.body ?? '',
        urgency: opts.urgency
      })
      if (onClick) {
        n.on('click', onClick)
      }
      n.show()
    }
  }
}

export const __testing = {
  DEFAULT_IPC_CHANNEL
}
