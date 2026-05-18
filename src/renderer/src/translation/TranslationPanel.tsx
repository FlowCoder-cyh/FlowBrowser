/**
 * Sprint 015 M2-5 — TranslationPanel 이행 stub.
 *
 * 폐기 흐름:
 *   - M2-4: 페이지 요약 use case 분기 제거 (PRD §19.5.1 M2-4)
 *   - M2-5 (본 PR): legacy page-translation 분기 제거 — TranslationPanel UI/state/listener 거의 전체 제거
 *   - M2-6: render/restore 계열 IPC 폐기 동반 — 본 stub 완전 제거 가능
 *   - M5: ChatPanel 신규 작성 → App.tsx 에서 TranslationPanel → ChatPanel 교체
 *
 * 현 단계 = 이행 stub. open=true 일 때 단순 안내 패널 표시. 기능 동작 없음.
 * App.tsx 의 import 유지를 위한 빈 컴포넌트 (M5 ChatPanel 교체 시 파일 자체 삭제).
 */

interface Props {
  open: boolean
  onClose: () => void
}

export default function TranslationPanel({ open, onClose }: Props): JSX.Element | null {
  if (!open) return null
  return (
    <aside className="translation-panel" role="complementary" aria-label="번역 패널 (이행 중)">
      <div className="panel-header">
        <h2 className="panel-title">번역 패널</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <div className="panel-empty">
        <p>페이지 번역 기능은 v0.4 ChatPanel 로 전환 중입니다.</p>
        <p>(Sprint 015 M5 — AI 채팅 + RAG retrieval 신규 도입 예정)</p>
      </div>
    </aside>
  )
}
