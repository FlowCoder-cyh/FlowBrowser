/**
 * Sprint 017 M1 T06 — highlightInjectionScript builder 단위 회귀.
 *
 * 페이지 컨텍스트 실행 자체는 단위 테스트에서 evaluator 안에서 직접 검증하기 어렵다 (Electron
 * webContents 의 main world 인 만큼). 본 회귀는 script 가:
 *   - 적정한 IIFE 구조 (`(async () => { ... })()`)
 *   - 핵심 helper (SHA-256 / collectTextNodes / charOffsetsToRange) 모듈 임베드
 *   - records / rootSelector 등 입력 JSON 직렬화
 *   - HIGHLIGHT_NAME_PREFIX clear 코드 포함 (registry 누수 차단 — codex hotfix #5)
 *
 * 추가 cover:
 *   - buildHighlightCssForIds 가 ::highlight(prefix-id) 룰 ids 별 생성
 *   - 특수 char id 가 sanitize 되어 CSS 안전
 *
 * 또한 main 측 highlightAnchor.ts 의 sha256Hex / computeContentHash / computeContextHash 와 본
 * 모듈의 알고리즘이 동일 결과를 내는지 cross-check — main 측이 이미 단위 회귀 32 케이스 PASS 이므로
 * 본 script 의 알고리즘이 같은 식이면 divergence 0 (codex hotfix #1).
 */

import { describe, it, expect } from 'vitest'

import {
  buildSerializeScript,
  buildRestoreScript,
  buildHighlightCssForIds,
  HIGHLIGHT_NAME_PREFIX,
  CONTEXT_LEN
} from '../../../src/perception/highlightInjectionScript'
import { sha256Hex, computeContentHash, computeContextHash } from '../../../src/perception/highlightAnchor'

describe('buildSerializeScript', () => {
  it('IIFE async 구조 + rootSelector 임베드', () => {
    const code = buildSerializeScript('main#content')
    expect(code.startsWith('(async () => {')).toBe(true)
    expect(code.endsWith('})()')).toBe(true)
    expect(code).toContain(JSON.stringify('main#content'))
  })

  it('SHA-256 + crypto.subtle 사용 (browser-safe, node:crypto 미사용)', () => {
    const code = buildSerializeScript()
    expect(code).toContain('crypto.subtle.digest')
    expect(code).toContain("'SHA-256'")
    expect(code).not.toContain('require(')
    expect(code).not.toContain("from 'node:crypto'")
  })

  it('rootSelector 미지정 → body 기본', () => {
    const code = buildSerializeScript()
    expect(code).toContain(JSON.stringify('body'))
  })

  it('window.getSelection / Range API 사용 + collapsed/empty 가드', () => {
    const code = buildSerializeScript()
    expect(code).toContain('window.getSelection()')
    expect(code).toContain('rangeCount')
    expect(code).toContain('isCollapsed')
  })

  it('characterOffsetInRoot + computeChildNodesPath 임베드 (path fast path)', () => {
    const code = buildSerializeScript()
    expect(code).toContain('__fbCharacterOffsetInRoot')
    expect(code).toContain('__fbComputeChildNodesPath')
  })
})

describe('buildRestoreScript', () => {
  it('records JSON 임베드 + CSS Highlight API 사용', () => {
    const records = [
      {
        id: 'rec-1',
        anchor: {
          rootSelector: 'body',
          startPath: [0],
          endPath: [0],
          startOffset: 0,
          endOffset: 3,
          selectedText: 'abc',
          prefix: '',
          suffix: ' xyz',
          contentHash: 'h',
          contextHash: 'c'
        }
      }
    ]
    const code = buildRestoreScript(records)
    expect(code).toContain('CSS.highlights')
    expect(code).toContain('Highlight')
    expect(code).toContain(JSON.stringify(records))
  })

  it('HIGHLIGHT_NAME_PREFIX clear 코드 포함 (registry 누수 / 중복 차단 — codex hotfix #5)', () => {
    const code = buildRestoreScript([])
    expect(code).toContain(JSON.stringify(HIGHLIGHT_NAME_PREFIX))
    // 기존 highlight 삭제 로직
    expect(code).toContain('highlightsApi.delete')
  })

  it('apiSupported=false fallback (CSS Highlight API 미지원) graceful', () => {
    const code = buildRestoreScript([])
    expect(code).toContain('apiSupported: false')
    expect(code).toContain('apiSupported = true')
  })

  it('deserializeAnchor path fast + fuzzy fallback 임베드', () => {
    const code = buildRestoreScript([])
    expect(code).toContain('__fbDeserializeAnchor')
    expect(code).toContain('context-fuzzy')
  })
})

describe('buildHighlightCssForIds', () => {
  it('각 id 별 ::highlight() 룰 생성', () => {
    const css = buildHighlightCssForIds(['a', 'b'])
    expect(css).toContain(`::highlight(${HIGHLIGHT_NAME_PREFIX}a)`)
    expect(css).toContain(`::highlight(${HIGHLIGHT_NAME_PREFIX}b)`)
  })

  it('특수 char id 는 sanitize 적용 (CSS 안전)', () => {
    const css = buildHighlightCssForIds(['abc; { } /* drop tables */'])
    // 룰 본문 내부에 raw `{ }` / `drop tables` 가 남으면 CSS 주입 가능 (사용자 입력으로 룰 본문 깨짐).
    // sanitize 후 [^a-zA-Z0-9_-] → '_' — `;`, ` `, `{`, `}`, `/`, `*` 모두 `_` 로 치환.
    expect(css).not.toContain('drop tables')
    expect(css).toContain('abc_________drop_tables___')
    // CSS 룰 본문 자체에는 정상적인 `{ ... }` 한 쌍 존재 — selector 내부에만 raw `{ }` 없어야 함.
    expect(css).toMatch(/^::highlight\(flowbrowser-note-abc_________drop_tables___\) \{/)
  })

  it('빈 배열 → 빈 문자열', () => {
    expect(buildHighlightCssForIds([])).toBe('')
  })
})

describe('module 상수 + main 측 알고리즘 정합', () => {
  it('CONTEXT_LEN 은 32 (main 측과 동일)', () => {
    expect(CONTEXT_LEN).toBe(32)
  })

  it('HIGHLIGHT_NAME_PREFIX 는 flowbrowser-note- (main 측 restore script 매칭)', () => {
    expect(HIGHLIGHT_NAME_PREFIX).toBe('flowbrowser-note-')
  })

  /**
   * main 측 highlightAnchor.ts 의 sha256Hex 가 동일 input 에 동일 hex 를 낸다는 점은 이미 별도
   * 회귀가 cover. 본 case 는 normalize 정합 (\r\n → \n / [ \t]+ → 1 space / trim) 이
   * inject script 의 __fbNormalizeText 가 동일한지 main 측 computeContentHash 를 reference
   * 로 박는다 — script source 안에 normalize 로직이 동일 정규식인 것을 검증.
   */
  it('inject script 의 __fbNormalizeText 가 main computeContentHash 와 동일 정규식 (cross-check)', () => {
    const code = buildSerializeScript()
    expect(code).toContain('replace(/\\r\\n?/g')
    expect(code).toContain('replace(/[ \\t]+/g')
  })

  it('inject script contextHash 가 main computeContextHash 와 동일 delimiter (U+241F)', () => {
    const code = buildSerializeScript()
    expect(code).toContain('\\u241f')
    // main 측에서도 동일 delimiter 사용 — 결과 hex 가 동일하면 OK.
    expect(computeContextHash('a', 'b', 'c')).toBe(sha256Hex('a␟b␟c'))
    expect(computeContentHash({ textContent: '  foo\t bar\r\nbaz  ' } as unknown as Element)).toBe(
      sha256Hex('foo bar\nbaz')
    )
  })
})
