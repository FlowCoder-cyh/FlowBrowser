import { useEffect, useRef, useState } from 'react'

interface DomainRule {
  pattern: string
  type: 'blacklist' | 'whitelist'
}

type ListKind = 'whitelist' | 'blacklist'

interface FieldState {
  value: string
  error: string | null
}

const ERROR_LABELS: Record<string, string> = {
  empty: '패턴을 입력해 주세요.',
  too_long: '패턴이 너무 깁니다 (최대 253자).',
  invalid_chars: '도메인 문자만 허용됩니다 (a-z, 0-9, -, .).',
  invalid_wildcard: '와일드카드는 선두 *. 만 지원합니다 (예: *.example.com).',
  invalid_type: '내부 오류: type 값이 잘못됐습니다.'
}

export default function DomainPolicyPanel(): JSX.Element {
  const [rules, setRules] = useState<DomainRule[]>([])
  const [whiteField, setWhiteField] = useState<FieldState>({ value: '', error: null })
  const [blackField, setBlackField] = useState<FieldState>({ value: '', error: null })
  const [busy, setBusy] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const state = await window.privacyApi.getRules()
    setRules(state.userRules)
  }

  async function handleAdd(kind: ListKind): Promise<void> {
    const field = kind === 'whitelist' ? whiteField : blackField
    const setField = kind === 'whitelist' ? setWhiteField : setBlackField
    const trimmed = field.value.trim()
    if (!trimmed) {
      setField({ value: field.value, error: ERROR_LABELS.empty })
      return
    }
    setBusy(true)
    const result = await window.privacyApi.addRule({ pattern: trimmed, type: kind })
    setBusy(false)
    if (!result.ok) {
      setField({ value: field.value, error: ERROR_LABELS[result.error ?? ''] ?? '추가 실패' })
      return
    }
    setField({ value: '', error: null })
    await refresh()
  }

  async function handleRemove(rule: DomainRule): Promise<void> {
    setBusy(true)
    await window.privacyApi.removeRule(rule)
    setBusy(false)
    await refresh()
  }

  async function handleExport(): Promise<void> {
    const data = await window.privacyApi.exportPolicy()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flowbrowser-domain-policy-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleImportClick(): void {
    fileInputRef.current?.click()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const result = await window.privacyApi.importPolicy(parsed)
      if (result.ok) {
        setImportResult(
          `가져오기 완료: ${result.accepted}건 적용, ${result.rejected}건 거절`
        )
        await refresh()
      } else {
        setImportResult(`가져오기 실패: ${result.error ?? '알 수 없음'}`)
      }
    } catch (err) {
      setImportResult(`JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function handleClear(): Promise<void> {
    if (!window.confirm('사용자 도메인 정책을 모두 삭제합니다. 진행할까요?')) return
    setBusy(true)
    await window.privacyApi.clearPolicy()
    setBusy(false)
    await refresh()
  }

  const whitelist = rules.filter((r) => r.type === 'whitelist')
  const blacklist = rules.filter((r) => r.type === 'blacklist')

  return (
    <section className="settings-section domain-policy-panel">
      <h2 className="settings-title">도메인 정책</h2>
      <p className="settings-muted">
        사용자 화이트리스트는 기본 블랙리스트보다 우선합니다. 와일드카드는 선두{' '}
        <code>*.example.com</code> 형식만 허용됩니다.
      </p>

      <div className="dp-grid">
        <div className="dp-col">
          <h3 className="dp-list-title">화이트리스트 (전송 허용)</h3>
          <div className="dp-input-row">
            <input
              type="text"
              placeholder="*.example.com 또는 docs.example.com"
              value={whiteField.value}
              onChange={(e) =>
                setWhiteField({ value: e.target.value, error: null })
              }
              disabled={busy}
              spellCheck={false}
            />
            <button
              type="button"
              className="settings-btn"
              onClick={() => void handleAdd('whitelist')}
              disabled={busy}
            >
              추가
            </button>
          </div>
          {whiteField.error && <div className="dp-error">{whiteField.error}</div>}
          <ul className="dp-list">
            {whitelist.length === 0 && <li className="dp-empty">없음</li>}
            {whitelist.map((r) => (
              <li key={`w-${r.pattern}`} className="dp-row">
                <span className="dp-pattern">{r.pattern}</span>
                <button
                  type="button"
                  className="settings-btn-link"
                  onClick={() => void handleRemove(r)}
                  disabled={busy}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="dp-col">
          <h3 className="dp-list-title">블랙리스트 (전송 차단)</h3>
          <div className="dp-input-row">
            <input
              type="text"
              placeholder="*.example.com 또는 mail.example.com"
              value={blackField.value}
              onChange={(e) =>
                setBlackField({ value: e.target.value, error: null })
              }
              disabled={busy}
              spellCheck={false}
            />
            <button
              type="button"
              className="settings-btn"
              onClick={() => void handleAdd('blacklist')}
              disabled={busy}
            >
              추가
            </button>
          </div>
          {blackField.error && <div className="dp-error">{blackField.error}</div>}
          <ul className="dp-list">
            {blacklist.length === 0 && <li className="dp-empty">없음</li>}
            {blacklist.map((r) => (
              <li key={`b-${r.pattern}`} className="dp-row">
                <span className="dp-pattern">{r.pattern}</span>
                <button
                  type="button"
                  className="settings-btn-link"
                  onClick={() => void handleRemove(r)}
                  disabled={busy}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="dp-actions">
        <button
          type="button"
          className="settings-btn"
          onClick={() => void handleExport()}
          disabled={busy}
        >
          JSON으로 내보내기
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={handleImportClick}
          disabled={busy}
        >
          JSON 가져오기…
        </button>
        <button
          type="button"
          className="settings-btn-danger"
          onClick={() => void handleClear()}
          disabled={busy}
        >
          모두 삭제
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => void handleImportFile(e)}
          style={{ display: 'none' }}
        />
      </div>

      {importResult && <div className="dp-import-result">{importResult}</div>}
    </section>
  )
}
