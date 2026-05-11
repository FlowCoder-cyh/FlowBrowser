/// <reference lib="dom" />
/**
 * 페이지 내 민감 입력 필드 감지.
 * Renderer 컨텍스트에서 DOM을 검사하여 password / 카드 입력 필드 존재 여부를 반환.
 *
 * 본 검출기는 외부 페이지(WebContentsView) DOM에 직접 접근할 수 없으므로,
 * Main 프로세스가 WebContentsView.webContents.executeJavaScript()로 호출해야 한다.
 * 본 모듈은 그 코드 본문을 문자열로 제공한다.
 *
 * 단, `detectSensitiveFields` 함수는 외부 페이지 컨텍스트에서 실행되므로
 * 본 파일 상단에 `dom` lib reference를 명시한다 (tsconfig.node.json에는 dom 미포함).
 */

import type { PrivacyContext } from './types'

const CARD_FIELD_HINTS = [
  /\bcc[-_]?num/i,
  /\bcard[-_]?(number|num)/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bexp(iry)?[-_]?(date|month|year)/i,
  /\bpayment/i,
  /\bcredit[-_]?card/i
]

const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/

/**
 * Renderer 측에서 호출되는 검출 함수. 외부 페이지 DOM에 접근.
 * Main 프로세스가 executeJavaScript()로 본 함수의 문자열 본문을 실행해야 한다.
 */
export function detectSensitiveFieldsScript(): string {
  return `(${detectSensitiveFields.toString()})()`
}

/**
 * 외부 페이지 DOM에서 직접 실행될 코드.
 * 자기 자신을 직렬화해서 executeJavaScript에 전달하므로 어떤 외부 식별자도 사용 금지.
 */
export function detectSensitiveFields(): {
  hasPasswordField: boolean
  hasCardField: boolean
} {
  const hasPassword = document.querySelector('input[type="password"]') !== null

  const cardHintPatterns = [
    /\bcc[-_]?num/i,
    /\bcard[-_]?(number|num)/i,
    /\bcvv\b/i,
    /\bcvc\b/i,
    /\bexp(iry)?[-_]?(date|month|year)/i,
    /\bpayment/i,
    /\bcredit[-_]?card/i
  ]

  const inputs = document.querySelectorAll<HTMLInputElement>('input, [autocomplete]')
  let hasCard = false
  inputs.forEach((el) => {
    if (hasCard) return
    const haystack = [
      el.getAttribute('name') ?? '',
      el.getAttribute('id') ?? '',
      el.getAttribute('autocomplete') ?? '',
      el.getAttribute('placeholder') ?? ''
    ].join(' ')
    if (cardHintPatterns.some((p) => p.test(haystack))) hasCard = true
  })

  if (!hasCard) {
    const reqApi = 'PaymentRequest' in window
    hasCard = reqApi
  }

  return { hasPasswordField: hasPassword, hasCardField: hasCard }
}

/**
 * 텍스트 본문(예: 번역 요청 텍스트)에 카드 번호 패턴 포함 여부.
 * 외부 페이지 DOM 접근 없이 Renderer/Main 어디서나 호출 가능.
 */
export function detectCardPatternInText(text: string): boolean {
  return CARD_PATTERN.test(text)
}

/**
 * autocomplete 힌트 매처 (Main 프로세스 단위 테스트용).
 */
export function matchesCardHint(haystack: string): boolean {
  return CARD_FIELD_HINTS.some((p) => p.test(haystack))
}

export type { PrivacyContext }
