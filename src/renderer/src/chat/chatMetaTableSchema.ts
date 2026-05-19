/**
 * Sprint 015 M5-6 — ChatMetaTable 타입 + validator (pure .ts).
 *
 * PRD §10.3.2 chat_meta JSON 표 schema:
 *   {
 *     rows: number,
 *     columns: string[],
 *     cells: [{ value: string, sources: string[] }]
 *   }
 *
 * cells 는 row-major 1차원 배열 (length = rows × columns.length).
 * sources 는 출처 인덱스 array (`['page-1', 'note-2']` — PromptComposer 시스템 프롬프트 정합).
 *
 * UI 렌더 (ChatMetaTable.tsx) 와 분리 — node tsconfig 의 tests 단위 테스트가 jsx 의존 없이
 * validator 만 import 할 수 있도록 pure .ts 모듈로 추출.
 */

export interface ChatMetaTableCell {
  value: string
  sources: string[]
}

export interface ChatMetaTableData {
  rows: number
  columns: string[]
  cells: ChatMetaTableCell[]
}

/**
 * 표 schema 정합 검증. AssistantMessage.chat_meta 는 unknown — provider 응답 / 마이그레이션
 * 데이터 등 다양한 source 에서 옴. 본 validator 가 안전 fallback 결정.
 */
export function isValidChatMetaTable(value: unknown): value is ChatMetaTableData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.rows !== 'number' || !Number.isInteger(obj.rows) || obj.rows < 0) return false
  if (!Array.isArray(obj.columns)) return false
  if (!obj.columns.every((c) => typeof c === 'string')) return false
  if (!Array.isArray(obj.cells)) return false
  for (const c of obj.cells) {
    if (!c || typeof c !== 'object') return false
    const cell = c as Record<string, unknown>
    if (typeof cell.value !== 'string') return false
    if (!Array.isArray(cell.sources)) return false
    if (!cell.sources.every((s) => typeof s === 'string')) return false
  }
  return true
}
