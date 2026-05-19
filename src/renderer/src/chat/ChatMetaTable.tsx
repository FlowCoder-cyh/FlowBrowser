/**
 * Sprint 015 M5-6 — ChatMetaTable.
 *
 * PRD §10.3.2 chat_meta JSON 표 schema 렌더:
 *   {
 *     rows: string[],         // 행 header 라벨
 *     columns: string[],      // 열 header 라벨
 *     cells: ChatMetaTableCell[]  // row-major, length = rows.length × columns.length
 *   }
 *   ChatMetaTableCell:
 *     value: string
 *     sources: ChatMetaSource[]   // 통일 형식 (PRD §10.3.2)
 *
 * 출처 셀 클릭 → onSourceClick(source) — ChatPanel 이 search:get-content 호출.
 *
 * Markdown 본문 렌더 (전체 응답) 는 별도 — 본 컴포넌트는 표 schema 만 책임.
 * pure 컴포넌트 — props 기반 렌더, 외부 호출 없음.
 *
 * codex + evaluator M5-6 PR #158 BLOCKING 정정 — rows: number → string[], sources: string[] → ChatMetaSource[].
 */

import type { JSX } from 'react'

import {
  isValidChatMetaTable,
  type ChatMetaSource,
  type ChatMetaTableCell,
  type ChatMetaTableData
} from './chatMetaTableSchema'

export {
  isValidChatMetaTable,
  type ChatMetaSource,
  type ChatMetaTableCell,
  type ChatMetaTableData
}

export interface ChatMetaTableProps {
  data: ChatMetaTableData
  /** 출처 셀 클릭 콜백. 미주입 시 출처 비활성 (표 보기 전용). */
  onSourceClick?: (source: ChatMetaSource) => void
}

export function ChatMetaTable(props: ChatMetaTableProps): JSX.Element | null {
  const { data, onSourceClick } = props
  if (data.rows.length === 0 || data.columns.length === 0) return null
  // validator 가 cells.length === rows.length × columns.length 보장 — 본 컴포넌트는 그대로 신뢰

  return (
    <table className="chat-meta-table">
      <thead>
        <tr>
          {/* 행 헤더 자리 — 좌상단 빈 칸 */}
          <th aria-label="행 헤더" />
          {data.columns.map((col, idx) => (
            <th key={`col-${idx}`}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((rowLabel, rowIdx) => (
          <tr key={`row-${rowIdx}`}>
            <th scope="row">{rowLabel}</th>
            {data.columns.map((_, colIdx) => {
              const cell = data.cells[rowIdx * data.columns.length + colIdx]
              return (
                <td key={`cell-${rowIdx}-${colIdx}`}>
                  <span className="chat-meta-table__value">{cell.value}</span>
                  {cell.sources.length > 0 && (
                    <span className="chat-meta-table__sources">
                      {cell.sources.map((s, sIdx) => (
                        <button
                          key={`src-${rowIdx}-${colIdx}-${sIdx}`}
                          type="button"
                          className="chat-meta-table__source-link"
                          onClick={() => onSourceClick?.(s)}
                          disabled={!onSourceClick}
                          title={`출처 ${s.type} ${s.id}`}
                        >
                          [{s.type}]
                        </button>
                      ))}
                    </span>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
