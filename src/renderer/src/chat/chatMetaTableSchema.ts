/**
 * Sprint 015 M5-6 — ChatMetaTable 타입 + validator (pure .ts).
 *
 * PRD §10.3.2 chat_meta JSON 표 schema (정확 형식):
 *   {
 *     rows: string[],     // 행 header 라벨 (예: ["가격", "주요기능"])
 *     columns: string[],  // 열 header 라벨 (예: ["Linear", "Notion"])
 *     cells: ChatMetaCell[]  // row-major 순서, length === rows.length × columns.length
 *   }
 *
 *   ChatMetaCell:
 *     value: string
 *     sources: ChatMetaSource[]  // 통일 형식 (PRD §10.3.2 + §04 §4.3.5)
 *
 *   ChatMetaSource:
 *     type: 'page' | 'note'
 *     id: string
 *     page_id?: string  // type='page' 시 = id, type='note' 시 anchor page_id
 *     visit_id?: string  // optional anchor
 *
 * UI 렌더 (ChatMetaTable.tsx) 와 분리 — node tsconfig 의 tests 단위 테스트가 jsx 의존 없이
 * validator 만 import 할 수 있도록 pure .ts 모듈로 추출.
 *
 * codex + evaluator M5-6 PR #158 BLOCKING 정정 (2026-05-19):
 *   - rows: number → string[] (행 헤더 라벨)
 *   - sources: string[] → ChatMetaSource[] (통일 형식)
 *   - cells.length === rows.length × columns.length invariant 검증 추가
 */

export interface ChatMetaSource {
  type: 'page' | 'note'
  id: string
  page_id?: string
  visit_id?: string
}

export interface ChatMetaTableCell {
  value: string
  sources: ChatMetaSource[]
}

export interface ChatMetaTableData {
  rows: string[]
  columns: string[]
  cells: ChatMetaTableCell[]
}

/**
 * 표 schema 정합 검증. AssistantMessage.chat_meta 는 unknown — provider 응답 / 마이그레이션
 * 데이터 등 다양한 source 에서 옴. 본 validator 가 안전 fallback 결정.
 *
 * 검증 규칙 (PRD §10.3.2 정합):
 *   - rows / columns 가 string[] (모든 원소 string)
 *   - cells 가 array, 각 원소 { value: string, sources: ChatMetaSource[] }
 *   - cells.length === rows.length × columns.length (row-major invariant)
 *   - 각 source 가 { type ∈ {'page', 'note'}, id: string, page_id?: string, visit_id?: string }
 */
export function isValidChatMetaTable(value: unknown): value is ChatMetaTableData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>

  if (!Array.isArray(obj.rows)) return false
  if (!obj.rows.every((r) => typeof r === 'string')) return false

  if (!Array.isArray(obj.columns)) return false
  if (!obj.columns.every((c) => typeof c === 'string')) return false

  if (!Array.isArray(obj.cells)) return false
  if (obj.cells.length !== obj.rows.length * obj.columns.length) return false

  for (const c of obj.cells) {
    if (!c || typeof c !== 'object') return false
    const cell = c as Record<string, unknown>
    if (typeof cell.value !== 'string') return false
    if (!Array.isArray(cell.sources)) return false
    for (const s of cell.sources) {
      if (!isValidSource(s)) return false
    }
  }
  return true
}

function isValidSource(value: unknown): value is ChatMetaSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  if (obj.type !== 'page' && obj.type !== 'note') return false
  if (typeof obj.id !== 'string') return false
  if (obj.page_id !== undefined && typeof obj.page_id !== 'string') return false
  if (obj.visit_id !== undefined && typeof obj.visit_id !== 'string') return false
  return true
}
