/**
 * Sprint 017 M0 T02 — nullable identifier 정규화.
 *
 * IPC / 사용자 입력 경계 또는 storage 경계에서 빈 문자열 / whitespace-only
 * 값을 `null` 로 정규화. `pageId` / `visitId` 등 SQLite NULL-able 컬럼의
 * "미지정" 의미를 단일 표현 (`null`) 으로 강제 — `''` 와 `null` 혼동 회피.
 *
 * 호출 경계 (Sprint 017 T02):
 *   - `noteHandlers.handleNoteCreate` (IPC 경계, 1차)
 *   - `NoteService.createNote` (내부 호출자 방어선, 2차)
 *   - `HighlightStore.add` / `HighlightStore.listByPage` filter (storage 경계, 3차)
 *
 * `'' or whitespace-only → null` / `'page-abc' → 'page-abc'` (trim 적용).
 */
export function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
