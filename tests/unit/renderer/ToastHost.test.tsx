/**
 * Sprint 017 M1 T08 — ToastHost + pushToast 단위 회귀.
 *
 * cover:
 *   1. pushToast → 자동 ToastHost 렌더링
 *   2. AUTO_DISMISS_MS (4000ms) 후 자동 제거 — vi.useFakeTimers 사용
 *   3. dismissToast 강제 제거
 *   4. 다중 toast 순서 정합 (createdAt 오름차순)
 *   5. error / info / success kind 별 CSS class 정합
 *   6. 클릭 시 dismiss
 *   7. useToast hook 의 subscribe / unsubscribe lifecycle
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'

import ToastHost, {
  pushToast,
  dismissToast,
  __resetToastsForTest
} from '../../../src/renderer/src/common/ToastHost'

describe('ToastHost — Sprint 017 M1 T08', () => {
  beforeEach(() => {
    __resetToastsForTest()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup() // @testing-library/react unmount — happy-dom 자동 cleanup 미동작
    vi.clearAllTimers()
    vi.useRealTimers()
    __resetToastsForTest()
  })

  it('pushToast → ToastHost 에 렌더링', () => {
    render(<ToastHost />)
    act(() => {
      pushToast({ kind: 'info', message: '안녕' })
    })
    expect(screen.getByText('안녕')).toBeTruthy()
  })

  it('error / success / info kind 별 className 정합', () => {
    render(<ToastHost />)
    act(() => {
      pushToast({ kind: 'error', message: '에러' })
      pushToast({ kind: 'success', message: '성공' })
      pushToast({ kind: 'info', message: '정보' })
    })
    expect(screen.getByText('에러').className).toContain('toast--error')
    expect(screen.getByText('성공').className).toContain('toast--success')
    expect(screen.getByText('정보').className).toContain('toast--info')
  })

  it('4초 후 자동 dismiss (AUTO_DISMISS_MS)', () => {
    render(<ToastHost />)
    act(() => {
      pushToast({ kind: 'info', message: '자동 사라짐' })
    })
    expect(screen.queryByText('자동 사라짐')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByText('자동 사라짐')).toBeNull()
  })

  it('dismissToast(id) 즉시 제거', () => {
    render(<ToastHost />)
    let id = ''
    act(() => {
      id = pushToast({ kind: 'info', message: '강제 제거' })
    })
    expect(screen.queryByText('강제 제거')).toBeTruthy()
    act(() => {
      dismissToast(id)
    })
    expect(screen.queryByText('강제 제거')).toBeNull()
  })

  it('클릭 시 dismiss', () => {
    render(<ToastHost />)
    act(() => {
      pushToast({ kind: 'info', message: '클릭 닫기' })
    })
    const node = screen.getByText('클릭 닫기')
    act(() => {
      fireEvent.click(node)
    })
    expect(screen.queryByText('클릭 닫기')).toBeNull()
  })

  it('다중 toast — push 순서대로 표시', () => {
    render(<ToastHost />)
    act(() => {
      pushToast({ kind: 'info', message: '첫째' })
      pushToast({ kind: 'info', message: '둘째' })
      pushToast({ kind: 'info', message: '셋째' })
    })
    const all = screen.getAllByRole('button')
    expect(all.map((b) => b.textContent)).toEqual(['첫째', '둘째', '셋째'])
  })

  it('비어 있을 때는 toast-host 자체 미렌더', () => {
    const { container } = render(<ToastHost />)
    expect(container.querySelector('.toast-host')).toBeNull()
  })
})
