/**
 * Sprint 015 M5-6 — ChatMetaTable isValidChatMetaTable 단위 테스트.
 *
 * codex + evaluator M5-6 PR #158 BLOCKING 정정 — PRD §10.3.2 정합 schema 회귀.
 *
 * cover:
 *   - 정합 데이터 (rows/columns/cells string + row-major invariant + sources 통일 형식)
 *   - 빈 표 (rows=[] / columns=[])
 *   - cells.length invariant 위반 (row-major 깨짐)
 *   - rows / columns / cells 타입 위반
 *   - sources ChatMetaSource 타입 검증 (type / id / page_id? / visit_id?)
 *   - 음성: rows: number / sources: string[] (이전 schema) 거부
 */

import { describe, it, expect } from 'vitest'

import { isValidChatMetaTable } from '../../../src/renderer/src/chat/chatMetaTableSchema'

describe('isValidChatMetaTable — 정합 데이터', () => {
  it('PRD §10.3.2 정확 형식 → true', () => {
    expect(
      isValidChatMetaTable({
        rows: ['가격', '주요기능'],
        columns: ['Linear', 'Notion'],
        cells: [
          {
            value: '월 $8',
            sources: [
              { type: 'page', id: 'page-uuid-1', page_id: 'page-uuid-1', visit_id: 'visit-uuid' }
            ]
          },
          {
            value: '월 $10',
            sources: [{ type: 'page', id: 'page-uuid-2', page_id: 'page-uuid-2' }]
          },
          {
            value: '이슈 트래킹',
            sources: [{ type: 'note', id: 'note-uuid', page_id: 'page-uuid-1' }]
          },
          {
            value: '문서 강함',
            sources: []
          }
        ]
      })
    ).toBe(true)
  })

  it('빈 표 (rows / columns 둘 다 빈 배열, cells 빈 배열) → true', () => {
    expect(
      isValidChatMetaTable({ rows: [], columns: [], cells: [] })
    ).toBe(true)
  })

  it('단일 셀 (rows=1, columns=1) → true', () => {
    expect(
      isValidChatMetaTable({
        rows: ['단일'],
        columns: ['값'],
        cells: [{ value: 'x', sources: [] }]
      })
    ).toBe(true)
  })
})

describe('isValidChatMetaTable — 정합 위반', () => {
  it('rows: number (이전 schema) → false', () => {
    expect(
      isValidChatMetaTable({ rows: 2, columns: [], cells: [] })
    ).toBe(false)
  })

  it('rows 에 비-string → false', () => {
    expect(
      isValidChatMetaTable({ rows: ['a', 1], columns: [], cells: [] })
    ).toBe(false)
  })

  it('columns 에 비-string → false', () => {
    expect(
      isValidChatMetaTable({ rows: [], columns: ['a', 1], cells: [] })
    ).toBe(false)
  })

  it('cells.length invariant 위반 (rows×columns 와 다름) → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r1', 'r2'],
        columns: ['c1', 'c2'],
        // 기대 4, 실제 3
        cells: [
          { value: 'a', sources: [] },
          { value: 'b', sources: [] },
          { value: 'c', sources: [] }
        ]
      })
    ).toBe(false)
  })

  it('cell.value 비-string → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r'],
        columns: ['c'],
        cells: [{ value: 123, sources: [] }]
      })
    ).toBe(false)
  })

  it('sources 가 string[] (이전 schema) → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r'],
        columns: ['c'],
        cells: [{ value: 'x', sources: ['page-1'] }]
      })
    ).toBe(false)
  })

  it('source.type 잘못된 값 → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r'],
        columns: ['c'],
        cells: [{ value: 'x', sources: [{ type: 'invalid', id: 'x' }] }]
      })
    ).toBe(false)
  })

  it('source.id 누락 → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r'],
        columns: ['c'],
        cells: [{ value: 'x', sources: [{ type: 'page' }] }]
      })
    ).toBe(false)
  })

  it('source.page_id 잘못된 타입 → false', () => {
    expect(
      isValidChatMetaTable({
        rows: ['r'],
        columns: ['c'],
        cells: [{ value: 'x', sources: [{ type: 'page', id: 'x', page_id: 123 }] }]
      })
    ).toBe(false)
  })

  it('null / undefined → false', () => {
    expect(isValidChatMetaTable(null)).toBe(false)
    expect(isValidChatMetaTable(undefined)).toBe(false)
  })

  it('plain object 가 아닌 입력 → false', () => {
    expect(isValidChatMetaTable('string')).toBe(false)
    expect(isValidChatMetaTable(123)).toBe(false)
    expect(isValidChatMetaTable([])).toBe(false)
  })

  it('cells 가 array 아님 → false', () => {
    expect(
      isValidChatMetaTable({ rows: ['r'], columns: ['c'], cells: 'not array' })
    ).toBe(false)
  })
})
