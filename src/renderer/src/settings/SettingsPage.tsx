import { useEffect, useState } from 'react'
import UsagePanel from './UsagePanel'
import DomainPolicyPanel from './DomainPolicyPanel'
import GlossaryPanel from './GlossaryPanel'

interface CredentialRecord {
  id: string
  providerType: string
  displayName: string
  authType: 'oauth' | 'api_key' | 'local'
  status: 'active' | 'expired' | 'invalid' | 'disabled'
  lastValidatedAt: number | null
}

interface Props {
  onClose: () => void
}

export default function SettingsPage({ onClose }: Props): JSX.Element {
  const [credentials, setCredentials] = useState<CredentialRecord[]>([])
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(
    null
  )

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const list = await window.credentialApi.list()
    setCredentials(list)
  }

  async function handleSave(): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setMessage({ type: 'error', text: 'API Key를 입력해 주세요.' })
      return
    }
    if (!/^sk-/.test(trimmed)) {
      setMessage({ type: 'error', text: 'OpenAI API Key는 보통 sk-로 시작합니다.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await window.credentialApi.save({
        providerType: 'openai',
        displayName: 'OpenAI',
        secret: trimmed,
        authType: 'api_key'
      })
      setApiKey('')
      setMessage({ type: 'info', text: '저장 완료. 검증 중…' })
      const result = await window.credentialApi.validate('openai')
      if (result.ok) {
        setMessage({ type: 'success', text: 'OpenAI API Key 검증 성공.' })
      } else {
        setMessage({ type: 'error', text: `검증 실패: ${result.reason ?? '알 수 없음'}` })
      }
      await refresh()
    } catch (err) {
      setMessage({
        type: 'error',
        text: `저장 오류: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(providerType: string): Promise<void> {
    setBusy(true)
    try {
      await window.credentialApi.remove(providerType)
      await refresh()
      setMessage({ type: 'info', text: `${providerType} 자격증명 삭제됨.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <h1>설정</h1>
        <button type="button" className="settings-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>

      <section className="settings-section">
        <h2>AI Provider</h2>
        <p className="settings-muted">
          API Key는 OS Keychain (Electron safeStorage)에 위임 저장됩니다. 앱은 평문 Key를 보관하지 않습니다.
        </p>

        <div className="settings-row">
          <label className="settings-label" htmlFor="openai-key">
            OpenAI API Key
          </label>
          <input
            id="openai-key"
            type="password"
            className="settings-input"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="settings-btn"
            onClick={() => void handleSave()}
            disabled={busy || !apiKey.trim()}
          >
            {busy ? '저장 중…' : '저장 + 검증'}
          </button>
        </div>

        {message && <div className={`settings-message ${message.type}`}>{message.text}</div>}

        <h3 className="settings-subhead">등록된 자격증명</h3>
        {credentials.length === 0 ? (
          <p className="settings-muted">없음</p>
        ) : (
          <ul className="settings-cred-list">
            {credentials.map((c) => (
              <li key={c.id} className="settings-cred">
                <span className="settings-cred-name">{c.displayName}</span>
                <span className={`settings-cred-status status-${c.status}`}>{c.status}</span>
                <span className="settings-cred-type">{c.authType}</span>
                <button
                  type="button"
                  className="settings-btn-link"
                  onClick={() => void handleRemove(c.providerType)}
                  disabled={busy}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DomainPolicyPanel />
      <GlossaryPanel />
      <UsagePanel />
    </div>
  )
}
