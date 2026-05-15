/**
 * Sprint 014 M3-6 — Codex access_token JWT payload 디코더.
 *
 * OpenClaw `openai-codex-auth-identity.ts` 분석 결과:
 *  payload["https://api.openai.com/auth"]["chatgpt_account_id"] → ChatGPT-Account-Id 헤더
 *  payload["exp"] → 만료 epoch seconds
 *
 * JWT signature 검증은 본 클라이언트의 책임이 아님 (OpenAI 서버가 발급한 토큰을 그대로 사용).
 */

interface CodexJwtPayload {
  exp?: number | string
  iss?: string
  sub?: string
  'https://api.openai.com/profile'?: { email?: string }
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
    chatgpt_plan_type?: string
    chatgpt_account_user_id?: string
    chatgpt_user_id?: string
    user_id?: string
  }
}

export interface CodexAuthIdentity {
  accountId?: string
  chatgptPlanType?: string
  email?: string
  /** access_token 만료 epoch ms (이 페이로드의 exp는 자동 갱신용 참조) */
  expiresAtMs?: number
}

function base64urlDecode(input: string): string {
  // Node Buffer
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64url').toString('utf8')
  }
  // 브라우저 fallback (base64url → base64)
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (padded.length % 4)) % 4
  const b64 = padded + '='.repeat(padding)
  return decodeURIComponent(escape(atob(b64)))
}

function trimNonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function decodeCodexJwtPayload(accessToken: string): CodexJwtPayload | null {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null
  try {
    const decoded = base64urlDecode(parts[1])
    const parsed = JSON.parse(decoded) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as CodexJwtPayload) : null
  } catch {
    return null
  }
}

export function resolveCodexAuthIdentity(accessToken: string): CodexAuthIdentity {
  const payload = decodeCodexJwtPayload(accessToken)
  if (!payload) return {}
  const auth = payload['https://api.openai.com/auth']
  const accountId = trimNonEmpty(auth?.chatgpt_account_id)
  const chatgptPlanType = trimNonEmpty(auth?.chatgpt_plan_type)
  const email = trimNonEmpty(payload['https://api.openai.com/profile']?.email)
  const expRaw = payload.exp
  let expSeconds: number | undefined
  if (typeof expRaw === 'number' && Number.isFinite(expRaw) && expRaw > 0) {
    expSeconds = Math.trunc(expRaw)
  } else if (typeof expRaw === 'string' && /^\d+$/.test(expRaw.trim())) {
    expSeconds = Number.parseInt(expRaw.trim(), 10)
  }
  return {
    accountId,
    chatgptPlanType,
    email,
    expiresAtMs: expSeconds ? expSeconds * 1000 : undefined
  }
}
