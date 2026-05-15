// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractPageNodesBrowser,
  extractPageNodesScript,
  validatePageNodes,
  PAGE_NODE_CONFIG
} from '../../../src/perception/PageNodeExtractor'

describe('PageNodeExtractor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('extractPageNodesScript', () => {
    it('returns a callable IIFE string', () => {
      const script = extractPageNodesScript()
      expect(typeof script).toBe('string')
      expect(script.startsWith('(')).toBe(true)
      expect(script.endsWith(')()')).toBe(true)
    })
  })

  describe('extractPageNodesBrowser', () => {
    it('extracts paragraph + heading + list nodes', () => {
      document.body.innerHTML = `
        <h1>제목 영역입니다.</h1>
        <p>본문 첫 문단입니다.</p>
        <ul>
          <li>리스트 항목 1번입니다.</li>
          <li>리스트 항목 2번입니다.</li>
        </ul>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(4)
      const tags = result.nodes.map((n) => n.tag).sort()
      expect(tags).toEqual(['h1', 'li', 'li', 'p'])
    })

    it('extracts extended block nodes: dt, figcaption, caption, summary, td, th', () => {
      document.body.innerHTML = `
        <dl>
          <dt>용어 정의 시작</dt>
          <dd>그 용어의 설명입니다.</dd>
        </dl>
        <figure>
          <figcaption>그림 캡션 텍스트입니다.</figcaption>
        </figure>
        <table>
          <caption>표 제목 텍스트입니다.</caption>
          <tr><th>헤더 셀 텍스트</th><td>데이터 셀 텍스트</td></tr>
        </table>
        <details>
          <summary>요약 영역 텍스트</summary>
        </details>
      `
      const result = extractPageNodesBrowser()
      const tags = result.nodes.map((n) => n.tag)
      expect(tags).toContain('dt')
      expect(tags).toContain('dd')
      expect(tags).toContain('figcaption')
      expect(tags).toContain('caption')
      expect(tags).toContain('th')
      expect(tags).toContain('td')
      expect(tags).toContain('summary')
    })

    it('drops nodes shorter than minimum length', () => {
      document.body.innerHTML = '<p>짧음</p><p>충분히 긴 문장입니다.</p>'
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(1)
      expect(result.nodes[0].text).toBe('충분히 긴 문장입니다.')
    })

    it('drops nodes longer than maximum length', () => {
      const tooLong = 'x'.repeat(5001)
      document.body.innerHTML = `<p>${tooLong}</p><p>정상 길이 문단 텍스트.</p>`
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(1)
      expect(result.nodes[0].text).toBe('정상 길이 문단 텍스트.')
    })

    it('deduplicates identical normalized text', () => {
      document.body.innerHTML = `
        <p>중복 문단 텍스트입니다.</p>
        <p>중복 문단 텍스트입니다.</p>
        <p>고유 문단 텍스트입니다.</p>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(2)
    })

    it('handles deeply nested inline content via innerText', () => {
      document.body.innerHTML = `
        <p>This is <strong>bold</strong> and <em>italic <span>nested</span></em> content.</p>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(1)
      expect(result.nodes[0].text).toBe('This is bold and italic nested content.')
    })

    it('assigns sequential ids prefixed with n', () => {
      document.body.innerHTML = `
        <p>문단 A 텍스트입니다.</p>
        <p>문단 B 텍스트입니다.</p>
        <p>문단 C 텍스트입니다.</p>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])
    })

    it('splits nodes into chunks when char count exceeds CHUNK_LIMIT', () => {
      const longText = 'x'.repeat(2000)
      document.body.innerHTML = `
        <p>${longText}-A</p>
        <p>${longText}-B</p>
        <p>${longText}-C</p>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(3)
      // 2000 char × 3 = 6000 > 4000 → 적어도 2개 청크
      expect(result.chunks.length).toBeGreaterThanOrEqual(2)
      // 청크 메타 검증: index 0부터 연속
      expect(result.chunks[0].index).toBe(0)
      expect(result.chunks[0].startNodeId).toBe('n0')
    })

    it('produces single chunk when total chars below limit', () => {
      document.body.innerHTML = `
        <p>짧은 첫 문단입니다.</p>
        <p>짧은 둘째 문단입니다.</p>
      `
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(2)
      expect(result.chunks.length).toBe(1)
      expect(result.chunks[0].size).toBe(2)
    })

    it('returns empty arrays when no matching nodes', () => {
      document.body.innerHTML = '<div>div는 선택자 미포함이라 제외됨</div>'
      const result = extractPageNodesBrowser()
      expect(result.nodes.length).toBe(0)
      expect(result.chunks.length).toBe(0)
    })
  })

  describe('validatePageNodes', () => {
    it('accepts well-formed input', () => {
      const raw = {
        nodes: [{ id: 'n0', text: '유효한 문단 텍스트입니다.', tag: 'p' }],
        chunks: [
          { index: 0, startNodeId: 'n0', endNodeId: 'n0', size: 1, charCount: 14 }
        ]
      }
      const result = validatePageNodes(raw)
      expect(result.nodes.length).toBe(1)
      expect(result.chunks.length).toBe(1)
    })

    it('rejects malformed nodes (missing fields, wrong types)', () => {
      const raw = {
        nodes: [
          { id: 'n0', text: '정상 길이 텍스트', tag: 'p' },
          { id: 'n1', text: '짧음', tag: 'p' }, // < MIN_TEXT_LENGTH
          { id: 'n2' }, // 누락 필드
          'not-an-object'
        ],
        chunks: []
      }
      const result = validatePageNodes(raw)
      expect(result.nodes.length).toBe(1)
      expect(result.nodes[0].id).toBe('n0')
    })

    it('returns empty bundle for invalid root', () => {
      expect(validatePageNodes(null).nodes.length).toBe(0)
      expect(validatePageNodes('string').nodes.length).toBe(0)
      expect(validatePageNodes(42).nodes.length).toBe(0)
    })

    it('exposes configuration constants', () => {
      expect(PAGE_NODE_CONFIG.MIN_TEXT_LENGTH).toBe(8)
      expect(PAGE_NODE_CONFIG.MAX_TEXT_LENGTH).toBe(5000)
      expect(PAGE_NODE_CONFIG.CHUNK_CHAR_LIMIT).toBe(4000)
    })
  })
})
