/**
 * Sprint 015 M5-1 — ShortcutPanel.
 * PRD §7.4.7 ShortcutSettings — `shortcut:get-bindings` / `shortcut:set-binding` IPC.
 * 사용자가 SearchBar 단축키 (디폴트 Cmd/Ctrl+K) 를 변경 가능.
 * 사이트 자체 단축키 (Slack/Notion 등) 충돌 시 `Cmd+Shift+K` 등으로 변경 권장.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { buildAcceleratorFromEvent } from './acceleratorFromEvent'

type ShortcutBindingId = 'searchBar.focus'

interface ShortcutBindingPayload {
  id: ShortcutBindingId
  accelerator: string
}

const BINDING_LABELS: Record<ShortcutBindingId, string> = {
  'searchBar.focus': '검색 바 포커스'
}

const BINDING_DESCRIPTIONS: Record<ShortcutBindingId, string> = {
  'searchBar.focus':
    'SearchBar 를 포커스하는 단축키. 사이트의 자체 Cmd+K 핸들러 (Slack / Notion / Linear) 와 충돌 시 다른 조합으로 변경하세요.'
}

export default function ShortcutPanel(): JSX.Element {
  const [bindings, setBindings] = useState<ShortcutBindingPayload[]>([])
  const [recording, setRecording] = useState<ShortcutBindingId | null>(null)
  const [message, setMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(
    null
  )
  const recordingRef = useRef<ShortcutBindingId | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const list = await window.shortcutApi.getBindings()
    setBindings(list)
  }

  function startRecording(id: ShortcutBindingId): void {
    recordingRef.current = id
    setRecording(id)
    setMessage({ type: 'info', text: '원하는 단축키 조합을 누르세요 (취소: Esc)' })
  }

  function cancelRecording(): void {
    recordingRef.current = null
    setRecording(null)
    setMessage(null)
  }

  async function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): Promise<void> {
    const targetId = recordingRef.current
    if (!targetId) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      cancelRecording()
      return
    }
    // modifier-only 키는 무시 — 조합 완성 대기
    if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') {
      return
    }
    const accelerator = buildAcceleratorFromEvent({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey
    })
    if (!accelerator) {
      setMessage({ type: 'error', text: '유효한 단축키 조합이 아닙니다. 다시 시도하세요.' })
      return
    }
    const result = await window.shortcutApi.setBinding(targetId, accelerator)
    if (result.ok) {
      setMessage({ type: 'success', text: `${BINDING_LABELS[targetId]} → ${accelerator}` })
      recordingRef.current = null
      setRecording(null)
      await refresh()
    } else if (result.error === 'conflict') {
      const otherLabel = result.conflictsWith
        ? BINDING_LABELS[result.conflictsWith]
        : '다른 단축키'
      setMessage({
        type: 'error',
        text: `${accelerator} 는 이미 '${otherLabel}' 에 할당되어 있습니다.`
      })
    } else {
      setMessage({ type: 'error', text: `설정 실패: ${result.error}` })
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-title">단축키</h2>
      <p className="settings-muted">
        SearchBar (검색 바) 단축키. 사이트의 Cmd+K 핸들러와 충돌하면 다른 조합으로 변경하세요.
      </p>

      {message && <div className={`settings-message ${message.type}`}>{message.text}</div>}

      {bindings.map((b) => (
        <div
          key={b.id}
          className="settings-row"
          tabIndex={recording === b.id ? 0 : -1}
          onKeyDown={(e) => void handleKeyDown(e)}
          ref={recording === b.id ? (el) => el?.focus() : undefined}
        >
          <div className="settings-row-info">
            <div className="settings-row-label">{BINDING_LABELS[b.id]}</div>
            <div className="settings-muted">{BINDING_DESCRIPTIONS[b.id]}</div>
          </div>
          <div className="settings-row-control">
            {recording === b.id ? (
              <>
                <span className="settings-recording">…기다리는 중</span>
                <button
                  type="button"
                  className="settings-btn-link"
                  onClick={cancelRecording}
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <code className="settings-shortcut">{b.accelerator}</code>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => startRecording(b.id)}
                >
                  변경
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

