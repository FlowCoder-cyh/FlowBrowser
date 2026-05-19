/**
 * Sprint 015 M5-6 — ChatMetaTable.
 *
 * PRD §10.3.2 chat_meta JSON 표 schema 렌더:
 *   {
 *     rows: number,
 *     columns: string[],
 *     cells: [{ value: string, sources: [page-N|note-N|...] }]
 *   }
 *
 * cells 는 row-major 1차원 배열 (length = rows × columns.length).
 * 출처 셀 클릭 → onSourceClick({ source, pageId }) — M5-6 ChatPanel 이 search:get-content 호출.
 *
 * Markdown 본문 렌더 (전체 응답) 는 별도 — 본 컴포넌트는 표 schema 만 책임.
 * pure 컴포넌트 — props 기반 렌더, 외부 호출 없음.
 */

import type { JSX } from 'react'

import {
  isValidChatMetaTable,
  type ChatMetaTableCell,
  type ChatMetaTableData
} from './chatMetaTableSchema'

export { isValidChatMetaTable, type ChatMetaTableCell, type ChatMetaTableData }

export interface ChatMetaTableProps {
  data: ChatMetaTableData
  /** 출처 셀 클릭 콜백. 미주입 시 출처 비활성 (표 보기 전용). */
  onSourceClick?: (source: string) => void
}

export function ChatMetaTable(props: ChatMetaTableProps): JSX.Element | null {
  const { data, onSourceClick } = props
  if (data.rows === 0 || data.columns.length === 0) return null
  const expectedCellCount = data.rows * data.columns.length
  const cells = data.cells.slice(0, expectedCellCount)
  // 부족 시 빈 cell 로 채움
  while (cells.length < expectedCellCount) {
    cells.push({ value: '', sources: [] })
  }

  return (
    <table className="chat-meta-table">
      <thead>
        <tr>
          {data.columns.map((col, idx) => (
            <th key={`col-${idx}`}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: data.rows }, (_, rowIdx) => (
          <tr key={`row-${rowIdx}`}>
            {data.columns.map((_, colIdx) => {
              const cell = cells[rowIdx * data.columns.length + colIdx]
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
                          title={`출처: ${s}`}
                        >
                          [{s}]
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
