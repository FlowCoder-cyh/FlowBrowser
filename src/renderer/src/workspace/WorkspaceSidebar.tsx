/**
 * Sprint 015 M6 T28 — WorkspaceSidebar.
 *
 * 좌측 240px 패널. workspaceApi 와 통합.
 * - 워크스페이스 list + active 표시
 * - "+ 새 워크스페이스" 모달 (preset 12종 + 사용자 이모지 입력 + name + levelPreference)
 * - 클릭 시 workspace:switch + 페이지 새로고침 (간단 격리 — chat / note / search 가 새 workspace_id 로 동작)
 *
 * Phase 1 비포함 (Phase 2+):
 *   - 탭 그룹 stash/restore (TabManager workspace_id 통합 시점)
 *   - 우클릭 메뉴 (rename / delete / export) — 본 PR 은 inline 버튼만
 */

import { useEffect, useState, type ReactNode } from 'react'
import { WORKSPACE_ICON_PRESETS, isValidUserEmoji } from './presets'

type LevelPreference = 'novice' | 'intermediate' | 'advanced' | null

interface SerializedWorkspace {
  id: string
  name: string
  icon: string
  createdAt: number
  levelPreference: LevelPreference
}

interface WorkspaceSidebarProps {
  /** 활성 워크스페이스가 변경되면 호출 — 부모(App.tsx)가 chat/note/search 패널 재로드 책임. */
  onActiveChanged?: (id: string) => void
  /**
   * 핫픽스 (codex BLOCKING) — modal open 시 WebContentsView native layer 가 modal 을 가리므로
   * 부모(App.tsx)가 browser stage 인 동안 view 가시성 토글. 미주입 시 무조작 (테스트 / 비-browser stage).
   */
  onModalToggle?: (open: boolean) => void
  /**
   * T29 — 좌하단 슬롯 (MemoryStatsPanel 등). null 또는 미주입 시 footer 미렌더.
   */
  footer?: ReactNode
}

export default function WorkspaceSidebar({
  onActiveChanged,
  onModalToggle,
  footer
}: WorkspaceSidebarProps): JSX.Element {
  const [workspaces, setWorkspaces] = useState<SerializedWorkspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpenRaw] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  function setCreateOpen(next: boolean): void {
    setCreateOpenRaw(next)
    onModalToggle?.(next)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const res = await window.workspaceApi.list()
      setWorkspaces(res.workspaces)
      setActiveId(res.activeId)
    } finally {
      setLoading(false)
    }
  }

  async function handleSwitch(id: string): Promise<void> {
    if (id === activeId) return
    setPending(id)
    try {
      const res = await window.workspaceApi.switch(id)
      if (res.ok && res.active) {
        setActiveId(res.active.id)
        onActiveChanged?.(res.active.id)
      }
    } finally {
      setPending(null)
    }
  }

  async function handleCreated(): Promise<void> {
    setCreateOpen(false)
    await refresh()
  }

  async function handleDelete(id: string): Promise<void> {
    const ws = workspaces.find((w) => w.id === id)
    if (!ws) return
    const confirmed = window.confirm(
      `워크스페이스 '${ws.name}' 을 삭제하시겠습니까?\n페이지·노트·AI 대화가 모두 삭제됩니다. 복구 불가.`
    )
    if (!confirmed) return
    setPending(id)
    try {
      const res = await window.workspaceApi.delete(id)
      if (res.ok) {
        await refresh()
        if (res.newActiveId && res.newActiveId !== activeId) {
          onActiveChanged?.(res.newActiveId)
        }
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <aside className="workspace-sidebar" aria-label="워크스페이스">
      <header className="workspace-sidebar__header">
        <h2 className="workspace-sidebar__title">워크스페이스</h2>
        <button
          type="button"
          className="workspace-sidebar__create-btn"
          onClick={() => setCreateOpen(true)}
          aria-label="새 워크스페이스"
        >
          + 새 워크스페이스
        </button>
      </header>
      {loading ? (
        <div className="workspace-sidebar__loading">불러오는 중…</div>
      ) : (
        <ul className="workspace-sidebar__list" role="list">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId
            const isPending = ws.id === pending
            return (
              <li
                key={ws.id}
                className={`workspace-item${isActive ? ' workspace-item--active' : ''}`}
              >
                <button
                  type="button"
                  className="workspace-item__main"
                  onClick={() => void handleSwitch(ws.id)}
                  aria-current={isActive ? 'true' : 'false'}
                  disabled={isPending}
                >
                  <span className="workspace-item__icon" aria-hidden="true">
                    {ws.icon}
                  </span>
                  <span className="workspace-item__name">{ws.name}</span>
                </button>
                {/* 삭제 버튼은 active 만 보호하지 않음 (마지막 1개 삭제 시 자동 "📥 기본" 재생성). */}
                {workspaces.length > 1 && (
                  <button
                    type="button"
                    className="workspace-item__delete"
                    onClick={() => void handleDelete(ws.id)}
                    aria-label={`'${ws.name}' 삭제`}
                    disabled={isPending}
                  >
                    ×
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {footer && <div className="workspace-sidebar__footer">{footer}</div>}
      {createOpen && (
        <CreateWorkspaceModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </aside>
  )
}

interface CreateWorkspaceModalProps {
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function CreateWorkspaceModal({ onClose, onCreated }: CreateWorkspaceModalProps): JSX.Element {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string>(WORKSPACE_ICON_PRESETS[0])
  const [customIcon, setCustomIcon] = useState('')
  const [level, setLevel] = useState<LevelPreference>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    setError(null)
    const finalIcon = customIcon.trim().length > 0 ? customIcon.trim() : icon
    if (customIcon.trim().length > 0 && !isValidUserEmoji(customIcon.trim())) {
      setError('이모지 1자만 입력 가능합니다.')
      return
    }
    if (name.trim().length === 0) {
      setError('워크스페이스 이름을 입력해 주세요.')
      return
    }
    if (Array.from(name.trim()).length > 50) {
      setError('이름은 50자까지 입력 가능합니다.')
      return
    }
    setSubmitting(true)
    try {
      const res = await window.workspaceApi.create({
        name: name.trim(),
        icon: finalIcon,
        levelPreference: level
      })
      if (res.ok) {
        await onCreated()
      } else {
        setError(workspaceErrorMessage(res.errorCode, res.error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="workspace-modal-backdrop" onClick={onClose}>
      <div
        className="workspace-modal"
        role="dialog"
        aria-labelledby="workspace-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="workspace-modal-title" className="workspace-modal__title">
          새 워크스페이스
        </h3>
        <label className="workspace-modal__label">
          이름
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="예: GraphQL 학습"
            autoFocus
            className="workspace-modal__name-input"
          />
        </label>
        <div className="workspace-modal__label">
          <span>아이콘 (preset 또는 이모지 1자)</span>
          <div className="workspace-modal__icons" role="radiogroup" aria-label="아이콘 preset">
            {WORKSPACE_ICON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={icon === preset && customIcon === ''}
                className={`workspace-modal__icon-btn${
                  icon === preset && customIcon === '' ? ' workspace-modal__icon-btn--active' : ''
                }`}
                onClick={() => {
                  setIcon(preset)
                  setCustomIcon('')
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={customIcon}
            onChange={(e) => setCustomIcon(e.target.value)}
            placeholder="또는 이모지 직접 입력 (예: 🎮)"
            className="workspace-modal__custom-icon"
          />
        </div>
        <label className="workspace-modal__label">
          내 수준 (선택)
          <select
            value={level ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setLevel(v === '' ? null : (v as LevelPreference))
            }}
            className="workspace-modal__level"
          >
            <option value="">미설정 (균형 톤)</option>
            <option value="novice">초보 — 어려운 용어 풀어 설명, 비유</option>
            <option value="intermediate">중급 — 핵심만 간결</option>
            <option value="advanced">고급 — 세부 기술, 한계, trade-off</option>
          </select>
        </label>
        {error && <div className="workspace-modal__error">{error}</div>}
        <div className="workspace-modal__actions">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="workspace-modal__cancel"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || name.trim().length === 0}
            className="workspace-modal__submit"
          >
            {submitting ? '생성 중…' : '생성'}
          </button>
        </div>
      </div>
    </div>
  )
}

function workspaceErrorMessage(code: string | undefined, fallback: string | undefined): string {
  if (code === 'infra_unavailable') return '워크스페이스 인프라가 비활성 상태입니다.'
  if (code === 'invalid_input') return '입력값이 올바르지 않습니다.'
  if (code === 'not_found') return '워크스페이스를 찾을 수 없습니다.'
  if (code === 'no_change') return '변경 사항이 없습니다.'
  return fallback ?? '알 수 없는 오류가 발생했습니다.'
}
