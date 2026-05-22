/**
 * Sprint 017 M1 T08 — 전역 Toast 컴포넌트 (KI-024 graceful fallback).
 *
 * codex 사전 협의 (019e4ec8 #4) 정합:
 *   - NoteHighlight 패널 mount 여부와 무관하게 사용자에게 표시되어야 함 (Shadow DOM 실패 등).
 *   - 따라서 컴포넌트 내부 self-contained 대신 App.tsx 전역 mount + 모듈 level subscribers.
 *
 * 사용:
 *   - `<ToastHost />` 를 App.tsx 에 한 번 mount.
 *   - 어디서든 `pushToast({ kind, message })` 호출 → 자동 자동 dismiss (4초).
 *   - `useToast()` hook 으로 subscribe — 컴포넌트 unmount 시 자동 cleanup.
 *
 * 본 모듈은 React Context 없이 module-level EventTarget — Provider 래핑 없이 사용 가능.
 */

import { useEffect, useState } from 'react'

export type ToastKind = 'error' | 'info' | 'success'

export interface Toast {
  /** 고유 id — push 시 자동 발급. */
  id: string
  kind: ToastKind
  message: string
}

export interface ToastInput {
  kind: ToastKind
  message: string
}

/** 자동 dismiss 시간 (ms). codex 사전 협의 정합 — 사용자가 읽을 시간 (긴 메시지) + 잔존 부담 회피. */
const AUTO_DISMISS_MS = 4000

type Listener = (toasts: Toast[]) => void
const listeners = new Set<Listener>()
let activeToasts: Toast[] = []
let nextId = 0

function emit(): void {
  for (const listener of listeners) {
    listener(activeToasts)
  }
}

/** Toast push — 어디서든 호출 가능 (handlers / hooks / event listener). */
export function pushToast(input: ToastInput): string {
  nextId += 1
  const id = `toast-${nextId}`
  const toast: Toast = { id, ...input }
  activeToasts = [...activeToasts, toast]
  emit()
  setTimeout(() => {
    activeToasts = activeToasts.filter((t) => t.id !== id)
    emit()
  }, AUTO_DISMISS_MS)
  return id
}

/** Toast 강제 dismiss (사용자 클릭). */
export function dismissToast(id: string): void {
  activeToasts = activeToasts.filter((t) => t.id !== id)
  emit()
}

/** subscriber 관리 hook — 컴포넌트 unmount 시 자동 unsubscribe. */
export function useToast(): Toast[] {
  const [toasts, setToasts] = useState<Toast[]>(activeToasts)
  useEffect(() => {
    listeners.add(setToasts)
    setToasts(activeToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])
  return toasts
}

/** ToastHost — App.tsx 전역 mount. fixed top-right 위치, 다중 toast stack. */
export default function ToastHost(): JSX.Element {
  const toasts = useToast()
  if (toasts.length === 0) return <></>
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast--${t.kind}`}
          onClick={() => dismissToast(t.id)}
          aria-label={`${t.kind === 'error' ? '오류' : t.kind === 'success' ? '성공' : '알림'}: ${t.message} — 클릭하여 닫기`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}

/** 단위 테스트 reset — 운영 사용 금지. */
export function __resetToastsForTest(): void {
  activeToasts = []
  listeners.clear()
  nextId = 0
}
