/**
 * Sprint 015 M5-6 — ChatMetaTable isValidChatMetaTable 단위 테스트.
 *
 * UI 컴포넌트 자체 렌더 테스트는 happy-dom 미설정으로 skip — pure validator 만 cover.
 *
 * cover:
 *   - 정합 데이터 → true
 *   - rows / columns / cells 누락 → false
 *   - 잘못된 타입 → false
 *   - sources 배열 검증
 */

import { describe, it, expect } from 'vitest'

import { isValidChatMetaTable } from '../../../src/renderer/src/chat/chatMetaTableSchema'

describe('isValidChatMetaTable', () => {
  it('정합 데이터 → true', () => {
    expect(
      isValidChatMetaTable({
        rows: 2,
        columns: ['이름', '값'],
        cells: [
          { value: 'a', sources: ['page-1'] },
          { value: '1', sources: [] },
          { value: 'b', sources: ['page-1', 'note-1'] },
          { value: '2', sources: [] }
        ]
      })
    ).toBe(true)
  })

  it('빈 표 (rows=0) → true (정합)', () => {
    expect(
      isValidChatMetaTable({
        rows: 0,
        columns: [],
        cells: []
      })
    ).toBe(true)
  })

  it('null → false', () => {
    expect(isValidChatMetaTable(null)).toBe(false)
  })

  it('undefined → false', () => {
    expect(isValidChatMetaTable(undefined)).toBe(false)
  })

  it('rows 비-정수 → false', () => {
    expect(
      isValidChatMetaTable({ rows: 1.5, columns: [], cells: [] })
    ).toBe(false)
  })

  it('rows 음수 → false', () => {
    expect(
      isValidChatMetaTable({ rows: -1, columns: [], cells: [] })
    ).toBe(false)
  })

  it('columns 배열 아님 → false', () => {
    expect(
      isValidChatMetaTable({ rows: 1, columns: 'col', cells: [] })
    ).toBe(false)
  })

  it('columns 에 비-string → false', () => {
    expect(
      isValidChatMetaTable({ rows: 1, columns: ['a', 1], cells: [] })
    ).toBe(false)
  })

  it('cells 에 잘못된 value 타입 → false', () => {
    expect(
      isValidChatMetaTable({
        rows: 1,
        columns: ['a'],
        cells: [{ value: 123, sources: [] }]
      })
    ).toBe(false)
  })

  it('cells 에 sources 누락 → false', () => {
    expect(
      isValidChatMetaTable({
        rows: 1,
        columns: ['a'],
        cells: [{ value: 'x' }]
      })
    ).toBe(false)
  })

  it('cells 에 sources 비-string → false', () => {
    expect(
      isValidChatMetaTable({
        rows: 1,
        columns: ['a'],
        cells: [{ value: 'x', sources: ['page-1', 2] }]
      })
    ).toBe(false)
  })

  it('plain object 가 아닌 입력 → false', () => {
    expect(isValidChatMetaTable('string')).toBe(false)
    expect(isValidChatMetaTable(123)).toBe(false)
    expect(isValidChatMetaTable([])).toBe(false)
  })
})
