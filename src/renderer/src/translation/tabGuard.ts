/**
 * Sprint 010 M3 — TranslationPanel의 sourceTabId 가드 순수 함수 추출.
 * Sprint 009 M2 evaluator §G-006 Partial 후속 권고 해소.
 *
 * sourceTabId가 null/undefined인 이벤트(레거시 또는 가드 미적용)는 항상 현재 탭으로 간주 (true).
 * activeTabId가 null이면(앱 초기화 직후) sourceTabId 유무와 무관하게 true (보수적).
 * 두 값이 명시되어 일치하면 true, 그 외 false.
 */
export function isCurrentTab(
  activeTabId: string | null,
  sourceTabId: string | null | undefined
): boolean {
  if (sourceTabId === null || sourceTabId === undefined) return true
  if (activeTabId === null) return true
  return activeTabId === sourceTabId
}
