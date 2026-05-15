/**
 * Sprint 014 M1 — Codex OAuth Device Code Flow.
 *
 * Codex CLI (openai/codex `codex-rs/login/`) 흐름 직접 구현. RFC 8628 표준이 아니라
 * OpenAI 자체 device-code 변형 (PKCE 코드를 서버가 생성).
 *
 * 흐름:
 *  1. requestUserCode(client_id) → { device_auth_id, user_code, interval, verification_url }
 *  2. 사용자: verification_url 방문 + user_code 입력
 *  3. pollOnce(device_auth_id, user_code) 반복 (interval 초 간격) → 200 시 authorization_code + PKCE 반환
 *  4. exchangeTokens(authorization_code, code_verifier) → { id_token, access_token, refresh_token }
 *  5. refreshTokens(refresh_token) 만료 전 갱신
 *
 * G-011 회색지대 허용 + Spike 1 조건 5개 정합.
 * 공개 클라이언트 ID 재사용. 자체 OAuth 등록 안 함.
 */

export const DEFAULT_CODEX_ISSUER = 'https://auth.openai.com'
export const DEFAULT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const DEVICE_CODE_POLL_TIMEOUT_MS = 15 * 60 * 1000

export interface UserCodeResult {
  deviceAuthId: string
  userCode: string
  /** 폴링 간격(초) */
  interval: number
  /** 사용자가 user_code를 입력할 URL */
  verificationUrl: string
}

export type PollStatus = 'pending' | 'success' | 'timeout' | 'denied' | 'error'

export interface PollSuccess {
  status: 'success'
  authorizationCode: string
  codeChallenge: string
  codeVerifier: string
}

export interface PollPending {
  status: 'pending'
}

export interface PollFailure {
  status: 'timeout' | 'denied' | 'error'
  reason?: string
}

export type PollResult = PollSuccess | PollPending | PollFailure

export interface TokenBundle {
  idToken: string
  accessToken: string
  refreshToken: string
  /** 발급 epoch ms */
  issuedAt: number
  /** 만료 epoch ms (issuedAt + expires_in*1000). expires_in 미반환 시 issuedAt + 1h fallback */
  expiresAt: number
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
}

export interface DeviceCodeFlowOptions {
  issuer?: string
  clientId?: string
  fetchImpl?: typeof fetch
}

/**
 * 모든 메서드는 stateless. caller가 흐름을 조립.
 */
export class DeviceCodeFlow {
  private readonly issuer: string
  private readonly clientId: string
  private readonly fetchImpl: typeof fetch

  constructor(options: DeviceCodeFlowOptions = {}) {
    this.issuer = (options.issuer ?? DEFAULT_CODEX_ISSUER).replace(/\/$/, '')
    this.clientId = options.clientId ?? DEFAULT_CODEX_CLIENT_ID
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * 1단계: usercode 발급.
   * POST {issuer}/api/accounts/deviceauth/usercode body { client_id }
   */
  async requestUserCode(): Promise<UserCodeResult> {
    const url = `${this.issuer}/api/accounts/deviceauth/usercode`
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId })
    })
    if (!res.ok) {
      throw new Error(`usercode 요청 실패: HTTP ${res.status}`)
    }
    const data = (await res.json()) as {
      device_auth_id: string
      user_code?: string
      usercode?: string
      interval?: number | string
    }
    const userCode = data.user_code ?? data.usercode
    if (!data.device_auth_id || !userCode) {
      throw new Error('usercode 응답 형식 오류')
    }
    const intervalRaw = data.interval
    const interval =
      typeof intervalRaw === 'number'
        ? intervalRaw
        : typeof intervalRaw === 'string'
          ? Number.parseInt(intervalRaw.trim(), 10) || 5
          : 5
    return {
      deviceAuthId: data.device_auth_id,
      userCode,
      interval,
      verificationUrl: `${this.issuer}/codex/device`
    }
  }

  /**
   * 2단계: 토큰 폴링 1회 시도.
   * POST {issuer}/api/accounts/deviceauth/token body { device_auth_id, user_code }
   * - 200: authorization_code + code_challenge + code_verifier 반환 (PKCE는 서버 생성)
   * - 403 / 404: 사용자 아직 미입력 → pending
   * - 그 외: 오류
   */
  async pollOnce(deviceAuthId: string, userCode: string): Promise<PollResult> {
    const url = `${this.issuer}/api/accounts/deviceauth/token`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode })
      })
    } catch (err) {
      return { status: 'error', reason: err instanceof Error ? err.message : String(err) }
    }
    if (res.ok) {
      const data = (await res.json()) as {
        authorization_code?: string
        code_challenge?: string
        code_verifier?: string
      }
      if (!data.authorization_code || !data.code_challenge || !data.code_verifier) {
        return { status: 'error', reason: 'token 응답 형식 오류' }
      }
      return {
        status: 'success',
        authorizationCode: data.authorization_code,
        codeChallenge: data.code_challenge,
        codeVerifier: data.code_verifier
      }
    }
    if (res.status === 403 || res.status === 404) {
      return { status: 'pending' }
    }
    return { status: 'error', reason: `폴링 실패: HTTP ${res.status}` }
  }

  /**
   * 3단계: authorization_code + PKCE로 토큰 묶음 교환.
   * POST {issuer}/oauth/token (표준 OAuth)
   * redirect_uri = {issuer}/deviceauth/callback
   */
  async exchangeTokens(args: {
    authorizationCode: string
    codeVerifier: string
  }): Promise<TokenBundle> {
    const url = `${this.issuer}/oauth/token`
    const redirectUri = `${this.issuer}/deviceauth/callback`
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code: args.authorizationCode,
      code_verifier: args.codeVerifier,
      redirect_uri: redirectUri
    })
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    if (!res.ok) {
      throw new Error(`token 교환 실패: HTTP ${res.status}`)
    }
    const data = (await res.json()) as TokenResponse
    return this.bundleFromResponse(data)
  }

  /**
   * 4단계: refresh_token으로 토큰 갱신.
   * 일부 provider는 refresh 시 새 refresh_token 발급(회전). 응답에 refresh_token이 있으면 갱신,
   * 없으면 기존 유지.
   */
  async refreshTokens(refreshToken: string): Promise<TokenBundle> {
    const url = `${this.issuer}/oauth/token`
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: refreshToken
    })
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    if (!res.ok) {
      throw new Error(`refresh 실패: HTTP ${res.status}`)
    }
    const data = (await res.json()) as TokenResponse
    // refresh_token 회전 미반환 시 기존 유지
    if (!data.refresh_token) {
      data.refresh_token = refreshToken
    }
    return this.bundleFromResponse(data)
  }

  private bundleFromResponse(data: TokenResponse): TokenBundle {
    const issuedAt = Date.now()
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
    return {
      idToken: data.id_token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      issuedAt,
      expiresAt: issuedAt + expiresIn * 1000
    }
  }
}
