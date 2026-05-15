// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractParagraphsBrowser,
  extractParagraphsScript
} from '../../../src/perception/ParagraphExtractor'

describe('ParagraphExtractor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('extractParagraphsScript', () => {
    it('returns a callable IIFE string', () => {
      const script = extractParagraphsScript()
      expect(typeof script).toBe('string')
      expect(script.startsWith('(')).toBe(true)
      expect(script.endsWith(')()')).toBe(true)
    })
  })

  describe('extractParagraphsBrowser', () => {
    it('extracts <p> nodes meeting length filter', () => {
      document.body.innerHTML = `
        <p>이것은 의미 있는 한 문단입니다.</p>
        <p>또 다른 문단.</p>
      `
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(2)
      expect(result[0].tag).toBe('p')
      expect(result[0].id).toBe('p0')
      expect(result[1].id).toBe('p1')
    })

    it('drops paragraphs shorter than 8 characters', () => {
      document.body.innerHTML = '<p>짧음</p><p>충분히 긴 문단입니다.</p>'
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(1)
      expect(result[0].text).toBe('충분히 긴 문단입니다.')
    })

    it('drops paragraphs longer than 5000 characters', () => {
      const huge = 'A'.repeat(5001)
      document.body.innerHTML = `<p>${huge}</p><p>유효한 문단입니다.</p>`
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(1)
      expect(result[0].text).toBe('유효한 문단입니다.')
    })

    it('extracts heading tags h1-h6', () => {
      document.body.innerHTML = `
        <h1>제목 첫 번째입니다</h1>
        <h2>두 번째 제목입니다</h2>
        <h3>세 번째 제목입니다</h3>
      `
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(3)
      expect(result.map((r) => r.tag)).toEqual(['h1', 'h2', 'h3'])
    })

    it('extracts blockquote and list items', () => {
      document.body.innerHTML = `
        <blockquote>인용된 문단입니다.</blockquote>
        <ul>
          <li>리스트 항목 첫 번째.</li>
          <li>리스트 항목 두 번째.</li>
        </ul>
        <dl>
          <dd>정의 본문입니다.</dd>
        </dl>
      `
      const result = extractParagraphsBrowser()
      const tags = result.map((r) => r.tag)
      expect(tags).toContain('blockquote')
      expect(tags).toContain('li')
      expect(tags).toContain('dd')
    })

    it('deduplicates identical text', () => {
      document.body.innerHTML = `
        <p>동일한 문단 텍스트입니다.</p>
        <p>동일한 문단 텍스트입니다.</p>
        <p>다른 텍스트 문단입니다.</p>
      `
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(2)
    })

    it('normalizes whitespace', () => {
      document.body.innerHTML = `<p>여러   공백 \n 줄바꿈 \t 탭   문단입니다.</p>`
      const result = extractParagraphsBrowser()
      expect(result[0].text).toBe('여러 공백 줄바꿈 탭 문단입니다.')
    })

    it('returns empty array for empty document', () => {
      const result = extractParagraphsBrowser()
      expect(result).toEqual([])
    })

    it('returns sequential ids p0, p1, p2', () => {
      document.body.innerHTML = `
        <p>첫 번째 문단입니다.</p>
        <p>두 번째 문단입니다.</p>
        <p>세 번째 문단입니다.</p>
      `
      const result = extractParagraphsBrowser()
      expect(result.map((r) => r.id)).toEqual(['p0', 'p1', 'p2'])
    })

    // Sprint 014 M3-13: style/script 자식 + CSS-like 필터
    it('inline <style> 자식 텍스트 제외', () => {
      document.body.innerHTML =
        '<li>실제 본문 텍스트입니다<style>.cls{color:red;font-size:12px}</style></li>'
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(1)
      expect(result[0].text).toBe('실제 본문 텍스트입니다')
    })

    it('inline <script> 자식 텍스트 제외', () => {
      document.body.innerHTML =
        '<p>본문 시작<script>const x=1;alert(x);</script>본문 끝</p>'
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(1)
      expect(result[0].text).not.toContain('alert')
      expect(result[0].text).toContain('본문 시작')
    })

    it('CSS-like 텍스트(중괄호+콜론 다수) 필터', () => {
      document.body.innerHTML =
        '<p>.cls{color:red;font-size:12px;margin:10px}.other{padding:5px}</p>'
      const result = extractParagraphsBrowser()
      expect(result.length).toBe(0)
    })
  })
})
