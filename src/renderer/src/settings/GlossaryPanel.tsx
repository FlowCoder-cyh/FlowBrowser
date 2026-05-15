import { useEffect, useRef, useState } from 'react'

interface GlossaryTerm {
  id: string
  sourceTerm: string
  targetTerm: string
  description: string
  domain: string
  isActive: boolean
  version: string
  createdAt: number
  updatedAt: number
}

interface FormState {
  sourceTerm: string
  targetTerm: string
  description: string
  domain: string
  error: string | null
}

const EMPTY_FORM: FormState = {
  sourceTerm: '',
  targetTerm: '',
  description: '',
  domain: '',
  error: null
}

const ERROR_LABELS: Record<string, string> = {
  empty_source: '원문 용어를 입력해 주세요.',
  empty_target: '번역 용어를 입력해 주세요.',
  too_long_source: '원문 용어가 너무 깁니다 (최대 200자).',
  too_long_target: '번역 용어가 너무 깁니다 (최대 200자).',
  duplicate: '같은 용어가 이미 존재합니다.'
}

export default function GlossaryPanel(): JSX.Element {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [domainFilter, setDomainFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [version, setVersion] = useState('default')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const [list, ver] = await Promise.all([
      window.glossaryApi.list(),
      window.glossaryApi.version()
    ])
    setTerms(list)
    setVersion(ver)
  }

  async function handleAdd(): Promise<void> {
    setBusy(true)
    const result = await window.glossaryApi.add({
      sourceTerm: form.sourceTerm,
      targetTerm: form.targetTerm,
      description: form.description,
      domain: form.domain,
      isActive: true
    })
    setBusy(false)
    if (!result.ok) {
      setForm({ ...form, error: ERROR_LABELS[result.error ?? ''] ?? '추가 실패' })
      return
    }
    setForm(EMPTY_FORM)
    await refresh()
  }

  async function handleToggle(term: GlossaryTerm): Promise<void> {
    setBusy(true)
    await window.glossaryApi.update({
      id: term.id,
      patch: { isActive: !term.isActive }
    })
    setBusy(false)
    await refresh()
  }

  async function handleRemove(term: GlossaryTerm): Promise<void> {
    setBusy(true)
    await window.glossaryApi.remove(term.id)
    setBusy(false)
    await refresh()
  }

  async function handleExport(): Promise<void> {
    const data = await window.glossaryApi.exportTerms()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flowbrowser-glossary-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const result = await window.glossaryApi.importTerms(parsed)
      if (result.ok) {
        setImportResult(`가져오기 완료: ${result.accepted}건 적용, ${result.rejected}건 거절`)
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
    if (!window.confirm('용어집을 모두 삭제합니다. 진행할까요?')) return
    setBusy(true)
    await window.glossaryApi.clear()
    setBusy(false)
    await refresh()
  }

  const filtered = domainFilter
    ? terms.filter((t) => t.domain === domainFilter || (!t.domain && !domainFilter))
    : terms
  const allDomains = Array.from(new Set(terms.map((t) => t.domain).filter(Boolean)))
  const activeCount = terms.filter((t) => t.isActive).length

  return (
    <section className="settings-section glossary-panel">
      <h2 className="settings-title">
        용어집{' '}
        <span className="glossary-meta">
          {activeCount} / {terms.length} 활성 · 버전 {version.slice(0, 8)}
        </span>
      </h2>
      <p className="settings-muted">
        활성 용어는 번역 prompt에 컨텍스트로 주입됩니다. <code>요약 / 쉽게 설명</code>은
        의역이라 적용되지 않습니다.
      </p>

      <div className="gloss-add">
        <input
          type="text"
          placeholder="원문 용어 (예: serverless)"
          value={form.sourceTerm}
          onChange={(e) => setForm({ ...form, sourceTerm: e.target.value, error: null })}
          disabled={busy}
        />
        <input
          type="text"
          placeholder="번역 용어 (예: 서버리스)"
          value={form.targetTerm}
          onChange={(e) => setForm({ ...form, targetTerm: e.target.value, error: null })}
          disabled={busy}
        />
        <input
          type="text"
          placeholder="도메인 (선택, 예: aws.amazon.com)"
          value={form.domain}
          onChange={(e) => setForm({ ...form, domain: e.target.value, error: null })}
          disabled={busy}
        />
        <input
          type="text"
          placeholder="설명 (선택)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value, error: null })}
          disabled={busy}
        />
        <button
          type="button"
          className="settings-btn"
          onClick={() => void handleAdd()}
          disabled={busy || !form.sourceTerm.trim() || !form.targetTerm.trim()}
        >
          추가
        </button>
      </div>
      {form.error && <div className="gloss-error">{form.error}</div>}

      {allDomains.length > 0 && (
        <div className="gloss-filter">
          <label htmlFor="gloss-domain-filter">도메인 필터:</label>
          <select
            id="gloss-domain-filter"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            disabled={busy}
          >
            <option value="">전체</option>
            {allDomains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul className="gloss-list">
        {filtered.length === 0 && <li className="gloss-empty">등록된 용어가 없습니다.</li>}
        {filtered.map((t) => (
          <li key={t.id} className={`gloss-row ${t.isActive ? '' : 'inactive'}`}>
            <label className="gloss-active">
              <input
                type="checkbox"
                checked={t.isActive}
                onChange={() => void handleToggle(t)}
                disabled={busy}
              />
            </label>
            <span className="gloss-source">{t.sourceTerm}</span>
            <span className="gloss-arrow">→</span>
            <span className="gloss-target">{t.targetTerm}</span>
            {t.domain && <span className="gloss-domain">{t.domain}</span>}
            {t.description && <span className="gloss-desc">{t.description}</span>}
            <button
              type="button"
              className="settings-btn-link"
              onClick={() => void handleRemove(t)}
              disabled={busy}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>

      <div className="gloss-actions">
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
          onClick={() => fileInputRef.current?.click()}
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

      {importResult && <div className="gloss-import-result">{importResult}</div>}
    </section>
  )
}
