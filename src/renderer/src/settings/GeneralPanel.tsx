import { useEffect, useState } from 'react'

interface UserSettingPayload {
  translationMode: 'panel' | 'replace' | 'overlay'
  defaultLanguage: string
  sourceLanguage: string
  defaultProviderId: string
  privacyFilterEnabled: boolean
  cancelOnTabSwitch: boolean
}

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'ko', label: '한국어 (ko)' },
  { value: 'ja', label: '일본어 (ja)' },
  { value: 'en', label: '영어 (en)' },
  { value: 'zh', label: '중국어 (zh)' }
]

const SOURCE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '자동 감지' },
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'zh', label: '중국어' }
]

const PROVIDERS: Array<{ value: string; label: string }> = [
  { value: 'openai', label: 'OpenAI API Key' }
  // 향후 codex / anthropic / gemini 추가
]

export default function GeneralPanel(): JSX.Element {
  const [state, setState] = useState<UserSettingPayload | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const s = (await window.userSettingApi.get()) as UserSettingPayload
    setState(s)
  }

  async function update(patch: Partial<UserSettingPayload>): Promise<void> {
    setBusy(true)
    try {
      const next = (await window.userSettingApi.update(patch)) as UserSettingPayload
      setState(next)
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <section className="settings-section">로드 중…</section>

  return (
    <section className="settings-section general-panel">
      <h2 className="settings-title">일반 설정</h2>
      <p className="settings-muted">
        번역 요청의 기본값을 설정합니다. 변경 즉시 영속됩니다.
      </p>

      <div className="gp-row">
        <label htmlFor="gp-default-lang">기본 번역 대상 언어</label>
        <select
          id="gp-default-lang"
          value={state.defaultLanguage}
          onChange={(e) => void update({ defaultLanguage: e.target.value })}
          disabled={busy}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="gp-row">
        <label htmlFor="gp-source-lang">원문 언어</label>
        <select
          id="gp-source-lang"
          value={state.sourceLanguage}
          onChange={(e) => void update({ sourceLanguage: e.target.value })}
          disabled={busy}
        >
          {SOURCE_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="gp-row">
        <label htmlFor="gp-provider">기본 Provider</label>
        <select
          id="gp-provider"
          value={state.defaultProviderId}
          onChange={(e) => void update({ defaultProviderId: e.target.value })}
          disabled={busy}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="gp-row gp-toggle">
        <label>
          <input
            type="checkbox"
            checked={state.privacyFilterEnabled}
            onChange={(e) => void update({ privacyFilterEnabled: e.target.checked })}
            disabled={busy}
          />
          Privacy Filter 활성화 (도메인 차단)
        </label>
        <p className="settings-muted gp-toggle-note">
          비활성화해도 비밀번호/카드 패턴 본문 차단은 항상 적용됩니다 (안전 정책 무력화 불가).
        </p>
      </div>

      <div className="gp-row gp-toggle">
        <label>
          <input
            type="checkbox"
            checked={state.cancelOnTabSwitch}
            onChange={(e) => void update({ cancelOnTabSwitch: e.target.checked })}
            disabled={busy}
          />
          탭 전환 시 진행 작업 자동 취소
        </label>
        <p className="settings-muted gp-toggle-note">
          끄면(기본) 백그라운드 작업은 계속 진행되며 UI에만 반영되지 않습니다.
        </p>
      </div>
    </section>
  )
}
