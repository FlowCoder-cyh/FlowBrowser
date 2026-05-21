/**
 * Sprint 017 M0 T02 — normalizeOptionalId 단위 회귀.
 *
 * cover:
 *   1. 정상 string → trim 적용 후 반환
 *   2. 빈 문자열 '' → null
 *   3. whitespace-only ('  ', '\t', '\n') → null
 *   4. null → null
 *   5. undefined → null
 *   6. non-string (number / boolean / object) → null (방어선)
 *   7. trim 후 길이 유지 (앞뒤 공백만 제거, 내부 공백 보존)
 */

import { describe, it, expect } from 'vitest'

import { normalizeOptionalId } from '../../../src/storage/idNormalize'

describe('normalizeOptionalId', () => {
  it('정상 string → trim 적용 후 반환', () => {
    expect(normalizeOptionalId('page-abc')).toBe('page-abc')
    expect(normalizeOptionalId('  page-abc  ')).toBe('page-abc')
    expect(normalizeOptionalId('\tpage\n')).toBe('page')
  })

  it("빈 문자열 '' → null", () => {
    expect(normalizeOptionalId('')).toBeNull()
  })

  it('whitespace-only → null', () => {
    expect(normalizeOptionalId('   ')).toBeNull()
    expect(normalizeOptionalId('\t')).toBeNull()
    expect(normalizeOptionalId('\n')).toBeNull()
    expect(normalizeOptionalId('\r\n  \t')).toBeNull()
  })

  it('null → null', () => {
    expect(normalizeOptionalId(null)).toBeNull()
  })

  it('undefined → null', () => {
    expect(normalizeOptionalId(undefined)).toBeNull()
  })

  it('non-string (number / boolean / object) → null (방어선)', () => {
    // 타입 안전을 의도적으로 우회하여 런타임 방어선 검증.
    expect(normalizeOptionalId(0 as unknown as string)).toBeNull()
    expect(normalizeOptionalId(123 as unknown as string)).toBeNull()
    expect(normalizeOptionalId(false as unknown as string)).toBeNull()
    expect(normalizeOptionalId({} as unknown as string)).toBeNull()
    expect(normalizeOptionalId([] as unknown as string)).toBeNull()
  })

  it('trim 후 내부 공백 보존 ("hello world" 등)', () => {
    expect(normalizeOptionalId('  hello world  ')).toBe('hello world')
    expect(normalizeOptionalId('a b c')).toBe('a b c')
  })
})
