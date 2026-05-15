import { useEffect, useState } from 'react'

type TranslationMode = 'panel' | 'replace' | 'overlay'

const MODES: Array<{ value: TranslationMode; label: string; desc: string }> = [
  {
    value: 'panel',
    label: '우측 패널',
    desc: '페이지는 원문 그대로, 우측 패널에 번역을 나열합니다. 기본값.'
  },
  {
    value: 'replace',
    label: '원문 치환',
    desc: '페이지 본문 텍스트를 번역으로 직접 교체합니다. "원문으로" 토글로 복원 가능.'
  },
  {
    value: 'overlay',
    label: '인접 오버레이',
    desc: '각 문단 아래에 번역 박스를 부착합니다. 원문은 유지됩니다.'
  }
]

export default function DisplayModePanel(): JSX.Element {
  const [mode, setMode] = useState<TranslationMode>('panel')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    const state = await window.userSettingApi.get()
    setMode(state.translationMode)
  }

  async function handleChange(next: TranslationMode): Promise<void> {
    setBusy(true)
    const updated = await window.userSettingApi.update({ translationMode: next })
    setMode(updated.translationMode)
    setBusy(false)
  }

  return (
    <section className="settings-section display-mode-panel">
      <h2 className="settings-title">번역 표시 방식</h2>
      <p className="settings-muted">
        문단 / 페이지 번역 결과를 어떻게 보여줄지 선택합니다. 모드 변경은 다음 번역 호출부터 적용됩니다.
      </p>
      <ul className="display-mode-list">
        {MODES.map((m) => (
          <li key={m.value} className={`display-mode-row ${mode === m.value ? 'active' : ''}`}>
            <label>
              <input
                type="radio"
                name="translation-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => void handleChange(m.value)}
                disabled={busy}
              />
              <span className="display-mode-label">{m.label}</span>
            </label>
            <p className="display-mode-desc">{m.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
