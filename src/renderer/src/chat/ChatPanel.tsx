/**
 * Sprint 015 M5-6 — ChatPanel.
 *
 * PRD §10.1 채팅 파이프라인 + §10.3 표 schema + §10.4 사용자 수준.
 *
 * 책임:
 *   - chat:list-history 로 현 워크스페이스 메시지 로드
 *   - 사용자 입력 → chat:request 호출 (loading 상태 / pending placeholder)
 *   - assistant 메시지 본문 + chat_meta 표 schema 렌더
 *   - 출처 셀 클릭 → search:get-content (페이지 본문 캐시 fetch)
 *
 * UI 단순화 (M5-6 본 PR 범위):
 *   - Markdown 라이브러리 미도입 (white-space pre-wrap)
 *   - 워크스페이스 ID = default (M6 워크스페이스 사이드바 도입 시 변경)
 *   - 사용자 수준 선택 UI 는 M6 WorkspaceSettings (T27) — 본 PR 미구현
 *
 * 본 PR 은 ChatPanel 신규 정의만 — App.tsx 마운트 0 (TranslationPanel 은 M2-6 시점 폐기 완료,
 * 현재 panel mount 자체 부재). M5-8 어댑터 일괄 제거 PR 에서 panel 마운트 결합.
 */

import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'

import {
  ChatMetaTable,
  isValidChatMetaTable,
  type ChatMetaSource
} from './ChatMetaTable'

interface ChatMessage {
  id: string
  workspaceId: string
  pageId: string | null
  visitId: string | null
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  retrievedItems: Array<{ type: 'page' | 'note'; id: string }> | null
  chatMeta: unknown | null
  status: 'ok' | 'pending' | 'failed' | 'aborted'
  createdAt: number
}

type Status = 'idle' | 'loading' | 'error'

export default function ChatPanel(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadHistory()
  }, [])

  useEffect(() => {
    // 새 메시지 도착 시 자동 스크롤 끝까지
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  async function loadHistory(): Promise<void> {
    try {
      const r = await window.chatApi.listHistory({})
      setMessages(r.messages as ChatMessage[])
    } catch {
      // history 로드 실패는 silent — 빈 상태 시작
    }
  }

  async function handleSubmit(): Promise<void> {
    const trimmed = input.trim()
    if (trimmed.length === 0 || status === 'loading') return
    setStatus('loading')
    setError(null)
    setInput('')
    try {
      const r = await window.chatApi.request({ userMessage: trimmed })
      if (r.status === 'error') {
        setError(r.error ?? '알 수 없는 오류')
        setStatus('error')
        if (r.messages) {
          setMessages((prev) => [...prev, ...(r.messages as ChatMessage[])])
        }
        return
      }
      if (r.messages) {
        setMessages((prev) => [...prev, ...(r.messages as ChatMessage[])])
      }
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  async function handleSourceClick(source: ChatMetaSource): Promise<void> {
    // PRD §10.3.2 통일 sources 형식 — type:'page' 는 source.id = page_id, type:'note' 는 anchor page_id.
    const targetPageId = source.type === 'page' ? source.id : source.page_id
    if (!targetPageId) {
      console.warn('[ChatPanel] source missing page anchor', source)
      return
    }
    try {
      const content = await window.searchApi.getContent({ pageId: targetPageId })
      if (content) {
        // 본문 캐시 fetch 성공 — UI 표시는 M5-7 (PreviewPane 또는 별도 본문 보기 패널) 결합 시점.
        console.log('[ChatPanel] source content fetched', content.title, content.url)
      }
    } catch (err) {
      console.warn('[ChatPanel] source fetch failed', err)
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            워크스페이스 메모리와 대화해 보세요.
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} onSourceClick={handleSourceClick} />
        ))}
        {status === 'loading' && (
          <div className="chat-panel__pending">AI 가 응답을 작성 중입니다...</div>
        )}
        {status === 'error' && error && (
          <div className="chat-panel__error">{error}</div>
        )}
      </div>
      <div className="chat-panel__input">
        <textarea
          className="chat-panel__textarea"
          placeholder="질문을 입력하세요 (Shift+Enter 줄바꿈)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          disabled={status === 'loading'}
        />
        <button
          type="button"
          className="chat-panel__send"
          onClick={() => void handleSubmit()}
          disabled={status === 'loading' || input.trim().length === 0}
        >
          전송
        </button>
      </div>
    </div>
  )
}

interface ChatBubbleProps {
  message: ChatMessage
  onSourceClick: (source: ChatMetaSource) => void
}

function ChatBubble({ message, onSourceClick }: ChatBubbleProps): JSX.Element {
  const roleClass = `chat-bubble chat-bubble--${message.role}${
    message.status === 'failed' ? ' chat-bubble--failed' : ''
  }`
  const tableData = isValidChatMetaTable(message.chatMeta) ? message.chatMeta : null
  return (
    <div className={roleClass}>
      <div className="chat-bubble__role">{roleLabel(message.role)}</div>
      <div className="chat-bubble__content">{message.content}</div>
      {tableData && <ChatMetaTable data={tableData} onSourceClick={onSourceClick} />}
    </div>
  )
}

function roleLabel(role: ChatMessage['role']): string {
  switch (role) {
    case 'user':
      return '나'
    case 'assistant':
      return 'AI'
    case 'system':
      return '시스템'
    case 'error':
      return '오류'
    default:
      return role
  }
}
