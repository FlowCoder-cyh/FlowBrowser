/**
 * Sprint 017 M1 T06 — NoteHighlight renderer 컴포넌트 단위 회귀.
 *
 * cover:
 *   1. workspaceId / url null → "워크스페이스 또는 페이지가 없습니다" placeholder + listByPage 미호출
 *   2. workspaceId + url 정상 + 응답 0건 → "이 페이지에 저장된 하이라이트가 없습니다" placeholder
 *   3. 응답 다건 → 모든 selectedText 표시 (data-testid + remove 버튼 정합)
 *   4. remove 클릭 → highlightApi.remove 호출 + list 갱신 (해당 item 사라짐)
 *   5. url 변경 → listByPage 재호출
 *   6. refreshKey 변경 → listByPage 재호출
 *   7. listByPage throw → error 메시지 표시 + items 빈 결과
 *
 * happy-dom 환경 (vitest.config.ts environmentMatchGlobs `tests/unit/renderer/**`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

import NoteHighlight from '../../../src/renderer/src/note/NoteHighlight'

interface HighlightAnchorPayload {
  rootSelector: string
  startPath: number[]
  endPath: number[]
  startOffset: number
  endOffset: number
  selectedText: string
  prefix: string
  suffix: string
  contentHash: string
  contextHash: string
}

interface SerializedHighlightRecordPayload {
  id: string
  noteId: string
  pageId: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchorPayload
  workspaceId: string
  createdAt: number
}

interface HighlightApi {
  listByPage: (args: {
    workspaceId?: string
    url?: string
    pageId?: string | null
    contentHash?: string
  }) => Promise<{ highlights: SerializedHighlightRecordPayload[] }>
  remove: (id: string) => Promise<{ ok: boolean }>
  create: (args: unknown) => Promise<unknown>
  listByNote: (noteId: string) => Promise<{ highlights: SerializedHighlightRecordPayload[] }>
  // Sprint 017 M1 T08 추가
  scrollTo?: (id: string) => Promise<{ ok: boolean; scrolled: boolean }>
  onToast?: (handler: unknown) => () => void
}

declare global {
  var highlightApi: HighlightApi
}

function makeRecord(overrides: Partial<SerializedHighlightRecordPayload> = {}): SerializedHighlightRecordPayload {
  return {
    id: overrides.id ?? 'h-1',
    noteId: overrides.noteId ?? 'n-1',
    pageId: overrides.pageId ?? null,
    url: overrides.url ?? 'https://example.com',
    contentHash: overrides.contentHash ?? 'hash',
    anchor: overrides.anchor ?? {
      rootSelector: 'body',
      startPath: [0, 0],
      endPath: [0, 0],
      startOffset: 0,
      endOffset: 5,
      selectedText: '인용 문구',
      prefix: '',
      suffix: '',
      contentHash: 'hash',
      contextHash: 'cx'
    },
    workspaceId: overrides.workspaceId ?? 'ws-1',
    createdAt: overrides.createdAt ?? 1
  }
}

interface Fx {
  listSpy: ReturnType<typeof vi.fn>
  removeSpy: ReturnType<typeof vi.fn>
  scrollToSpy: ReturnType<typeof vi.fn>
}

function setupFx(): Fx {
  const fx: Fx = {
    listSpy: vi.fn(),
    removeSpy: vi.fn(),
    scrollToSpy: vi.fn()
  }
  ;(window as unknown as { highlightApi: HighlightApi }).highlightApi = {
    listByPage: fx.listSpy as HighlightApi['listByPage'],
    remove: fx.removeSpy as HighlightApi['remove'],
    create: vi.fn(),
    listByNote: vi.fn(),
    // Sprint 017 M1 T08 — 디폴트 ok=true, scrolled=true (필요 시 mockResolvedValueOnce 로 override).
    scrollTo: fx.scrollToSpy.mockResolvedValue({ ok: true, scrolled: true })
  }
  return fx
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('NoteHighlight — placeholder 분기', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('workspaceId null → placeholder + listByPage 미호출', async () => {
    render(<NoteHighlight workspaceId={null} url={'https://example.com'} />)
    await flush()
    expect(screen.getByText(/활성 워크스페이스 또는 페이지가 없습니다/)).toBeTruthy()
    expect(fx.listSpy).not.toHaveBeenCalled()
  })

  it('url null → placeholder + listByPage 미호출', async () => {
    render(<NoteHighlight workspaceId={'ws-1'} url={null} />)
    await flush()
    expect(screen.getByText(/활성 워크스페이스 또는 페이지가 없습니다/)).toBeTruthy()
    expect(fx.listSpy).not.toHaveBeenCalled()
  })
})

describe('NoteHighlight — list 표시', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('응답 0건 → "이 페이지에 저장된 하이라이트가 없습니다" placeholder', async () => {
    fx.listSpy.mockResolvedValue({ highlights: [] })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    expect(fx.listSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/이 페이지에 저장된 하이라이트가 없습니다/)).toBeTruthy()
  })

  it('응답 다건 → 모든 selectedText 표시', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [
        makeRecord({ id: 'h-1', anchor: { ...makeRecord().anchor, selectedText: 'AAA' } }),
        makeRecord({ id: 'h-2', anchor: { ...makeRecord().anchor, selectedText: 'BBB' } })
      ]
    })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    expect(screen.getByText('AAA')).toBeTruthy()
    expect(screen.getByText('BBB')).toBeTruthy()
    expect(screen.getByTestId('note-highlight')).toBeTruthy()
  })

  it('listByPage throw → error 메시지 표시 + items 빈 결과', async () => {
    fx.listSpy.mockRejectedValue(new Error('boom'))
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })
})

describe('NoteHighlight — remove + 재로드', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('remove 클릭 → highlightApi.remove + list 갱신', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [
        makeRecord({ id: 'h-1', anchor: { ...makeRecord().anchor, selectedText: '삭제대상' } })
      ]
    })
    fx.removeSpy.mockResolvedValue({ ok: true })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    expect(screen.getByText('삭제대상')).toBeTruthy()
    const btn = screen.getByLabelText(/하이라이트 삭제: 삭제대상/)
    fireEvent.click(btn)
    await flush()
    // codex 019e4eda NEEDS_CHANGES #3 — expectedUrl 동반 payload (두 번째 인자).
    expect(fx.removeSpy).toHaveBeenCalledWith('h-1', 'https://example.com')
    expect(screen.queryByText('삭제대상')).toBeNull()
  })

  it('url 변경 → listByPage 재호출', async () => {
    fx.listSpy.mockResolvedValue({ highlights: [] })
    const { rerender } = render(
      <NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />
    )
    await flush()
    expect(fx.listSpy).toHaveBeenCalledTimes(1)
    rerender(<NoteHighlight workspaceId={'ws-1'} url={'https://other.com'} />)
    await flush()
    expect(fx.listSpy).toHaveBeenCalledTimes(2)
    expect(fx.listSpy.mock.calls[1][0]).toMatchObject({ url: 'https://other.com' })
  })

  it('refreshKey 변경 → listByPage 재호출 (외부 invalidation)', async () => {
    fx.listSpy.mockResolvedValue({ highlights: [] })
    const { rerender } = render(
      <NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} refreshKey={0} />
    )
    await flush()
    expect(fx.listSpy).toHaveBeenCalledTimes(1)
    rerender(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} refreshKey={1} />)
    await flush()
    expect(fx.listSpy).toHaveBeenCalledTimes(2)
  })
})

/**
 * Sprint 017 M1 T08 — 클릭 / scrollTo / selected state / toast 신규 회귀.
 *
 * codex 사전 협의 019e4ec8 권고:
 *   - list item 클릭 시 highlightApi.scrollTo 호출 + selected state 갱신
 *   - selected 시 className + aria-pressed 정합
 *   - selected highlight remove 시 selected null 로 cleanup
 *   - remove 클릭 event.stopPropagation — 본 li 의 scrollTo 동시 트리거 차단
 */
describe('NoteHighlight — Sprint 017 M1 T08 클릭/포커스/scrollTo', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('list item 클릭 → highlightApi.scrollTo 호출', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [
        makeRecord({ id: 'h-target', anchor: { ...makeRecord().anchor, selectedText: 'TARGET' } })
      ]
    })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    const btn = screen.getByLabelText(/이동:.*TARGET/)
    fireEvent.click(btn)
    await flush()
    expect(fx.scrollToSpy).toHaveBeenCalledWith('h-target', 'https://example.com')
  })

  it('클릭 후 selected state — aria-pressed=true + selected class', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-sel', anchor: { ...makeRecord().anchor, selectedText: 'SEL' } })]
    })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    const btn = screen.getByLabelText(/이동:.*SEL/)
    fireEvent.click(btn)
    await flush()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.closest('li')?.className).toContain('note-highlight__item--selected')
  })

  it('selected highlight remove → selected state null cleanup', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-x', anchor: { ...makeRecord().anchor, selectedText: 'XYZ' } })]
    })
    fx.removeSpy.mockResolvedValue({ ok: true })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    const clickBtn = screen.getByLabelText(/이동:.*XYZ/)
    fireEvent.click(clickBtn)
    await flush()
    expect(clickBtn.getAttribute('aria-pressed')).toBe('true')
    // remove
    fireEvent.click(screen.getByLabelText(/하이라이트 삭제: XYZ/))
    await flush()
    expect(screen.queryByText('XYZ')).toBeNull()
    // remove 후 list 갱신 — selected state 도 null (item 자체 사라짐).
  })

  it('remove 클릭 event.stopPropagation — scrollTo 미호출', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-stop', anchor: { ...makeRecord().anchor, selectedText: 'STOP' } })]
    })
    fx.removeSpy.mockResolvedValue({ ok: true })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    fireEvent.click(screen.getByLabelText(/하이라이트 삭제: STOP/))
    await flush()
    expect(fx.removeSpy).toHaveBeenCalledWith('h-stop', 'https://example.com')
    expect(fx.scrollToSpy).not.toHaveBeenCalled()
  })

  it('scrollTo result.ok=false / scrolled=false 모두 graceful (throw 없음)', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-graceful', anchor: { ...makeRecord().anchor, selectedText: 'G' } })]
    })
    fx.scrollToSpy.mockResolvedValueOnce({ ok: false, scrolled: false })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    // throw 없이 정상 진행
    fireEvent.click(screen.getByLabelText(/이동:.*G/))
    await flush()
    expect(fx.scrollToSpy).toHaveBeenCalledWith('h-graceful', 'https://example.com')
  })

  it('selected state 미선택 시 default — aria-pressed=false', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-1', anchor: { ...makeRecord().anchor, selectedText: 'A' } })]
    })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://example.com'} />)
    await flush()
    const btn = screen.getByLabelText(/이동:.*A/)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })
})

/**
 * Sprint 017 M1 T08 dual review hotfix (codex 019e4eda) — race guard + selectedId cleanup + expectedUrl payload.
 *
 * cover:
 *   1. workspaceId / url 변경 시 selectedId null cleanup (NOTABLE #5)
 *   2. scrollTo / remove 호출 시 expectedUrl payload 동반 (NEEDS_CHANGES #3)
 *   3. 사용자 클릭 후 URL 변경 발생해도 stale selectedId 가 stale page 의 잘못된 id 와 매칭되지 않음
 */
describe('NoteHighlight — Sprint 017 M1 T08 dual review hotfix (codex 019e4eda)', () => {
  let fx: Fx
  beforeEach(() => {
    fx = setupFx()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('NOTABLE #5 — workspaceId 변경 시 selectedId null cleanup', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-sel', anchor: { ...makeRecord().anchor, selectedText: 'SEL' } })]
    })
    const { rerender } = render(<NoteHighlight workspaceId={'ws-1'} url={'https://a.com'} />)
    await flush()
    // 클릭 → selected
    fireEvent.click(screen.getByLabelText(/이동:.*SEL/))
    await flush()
    expect(screen.getByLabelText(/이동:.*SEL/).getAttribute('aria-pressed')).toBe('true')
    // ws 변경 → selectedId cleanup
    rerender(<NoteHighlight workspaceId={'ws-2'} url={'https://a.com'} />)
    await flush()
    // 새 list 응답 (ws-2) 받은 후 — 동일 selectedText 'SEL' 가 있으면 aria-pressed false 여야 함
    const btn = screen.queryByLabelText(/이동:.*SEL/)
    if (btn) expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('NOTABLE #5 — url 변경 시 selectedId null cleanup', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-sel', anchor: { ...makeRecord().anchor, selectedText: 'SEL' } })]
    })
    const { rerender } = render(<NoteHighlight workspaceId={'ws-1'} url={'https://a.com'} />)
    await flush()
    fireEvent.click(screen.getByLabelText(/이동:.*SEL/))
    await flush()
    expect(screen.getByLabelText(/이동:.*SEL/).getAttribute('aria-pressed')).toBe('true')
    rerender(<NoteHighlight workspaceId={'ws-1'} url={'https://b.com'} />)
    await flush()
    const btn = screen.queryByLabelText(/이동:.*SEL/)
    if (btn) expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('NEEDS_CHANGES #3 — scrollTo 호출 시 expectedUrl payload 동반', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-1', anchor: { ...makeRecord().anchor, selectedText: 'TARGET' } })]
    })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://specific.com/path'} />)
    await flush()
    fireEvent.click(screen.getByLabelText(/이동:.*TARGET/))
    await flush()
    // expectedUrl 가 payload 에 박힘 (두 번째 인자)
    expect(fx.scrollToSpy).toHaveBeenCalledWith('h-1', 'https://specific.com/path')
  })

  it('NEEDS_CHANGES #3 — remove 호출 시 expectedUrl payload 동반', async () => {
    fx.listSpy.mockResolvedValue({
      highlights: [makeRecord({ id: 'h-1', anchor: { ...makeRecord().anchor, selectedText: 'RM' } })]
    })
    fx.removeSpy.mockResolvedValue({ ok: true })
    render(<NoteHighlight workspaceId={'ws-1'} url={'https://specific.com/path'} />)
    await flush()
    fireEvent.click(screen.getByLabelText(/하이라이트 삭제: RM/))
    await flush()
    expect(fx.removeSpy).toHaveBeenCalledWith('h-1', 'https://specific.com/path')
  })

  it('BLOCKING #1 — stale listByPage 응답 race guard (cleanup flag)', async () => {
    // 1차 응답 — 늦게 resolve. 2차 응답 — 먼저 resolve.
    let resolveFirst: (v: { highlights: unknown[] }) => void = () => {}
    const firstPromise = new Promise<{ highlights: unknown[] }>((res) => {
      resolveFirst = res
    })
    fx.listSpy.mockReturnValueOnce(firstPromise)
    fx.listSpy.mockResolvedValueOnce({
      highlights: [makeRecord({ id: 'h-new', anchor: { ...makeRecord().anchor, selectedText: 'NEW' } })]
    })

    const { rerender } = render(<NoteHighlight workspaceId={'ws-1'} url={'https://a.com'} />)
    // 첫 fetch 시작 (firstPromise pending)
    await flush()

    // url 변경 → 2차 fetch (즉시 resolve)
    rerender(<NoteHighlight workspaceId={'ws-1'} url={'https://b.com'} />)
    await flush()
    expect(screen.getByText('NEW')).toBeTruthy()

    // 1차 응답 늦게 도착 — stale 이라 setState 무시 (cleanup flag) → 'OLD' 표시 안 됨
    resolveFirst({
      highlights: [makeRecord({ id: 'h-old', anchor: { ...makeRecord().anchor, selectedText: 'OLD' } })]
    })
    await flush()
    // 2차 응답 NEW 가 그대로 표시
    expect(screen.queryByText('OLD')).toBeNull()
    expect(screen.getByText('NEW')).toBeTruthy()
  })
})
