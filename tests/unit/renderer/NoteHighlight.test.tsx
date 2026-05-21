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
}

function setupFx(): Fx {
  const fx: Fx = {
    listSpy: vi.fn(),
    removeSpy: vi.fn()
  }
  ;(window as unknown as { highlightApi: HighlightApi }).highlightApi = {
    listByPage: fx.listSpy as HighlightApi['listByPage'],
    remove: fx.removeSpy as HighlightApi['remove'],
    create: vi.fn(),
    listByNote: vi.fn()
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
    expect(fx.removeSpy).toHaveBeenCalledWith('h-1')
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
