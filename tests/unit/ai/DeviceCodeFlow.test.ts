/**
 * Sprint 014 M1 — DeviceCodeFlow 단위 테스트.
 * fetch 모킹으로 OpenAI device-code 흐름 매트릭스 검증.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  DeviceCodeFlow,
  DEFAULT_CODEX_CLIENT_ID,
  DEFAULT_CODEX_ISSUER
} from '../../../src/ai/codex/DeviceCodeFlow'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function emptyResponse(status: number): Response {
  return new Response('', { status })
}

describe('DeviceCodeFlow', () => {
  describe('requestUserCode', () => {
    it('정상 응답 파싱 + verification_url 조립', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            device_auth_id: 'dev_123',
            user_code: 'ABCD-EFGH',
            interval: 5
          })
        )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.requestUserCode()
      expect(result.deviceAuthId).toBe('dev_123')
      expect(result.userCode).toBe('ABCD-EFGH')
      expect(result.interval).toBe(5)
      expect(result.verificationUrl).toBe(`${DEFAULT_CODEX_ISSUER}/codex/device`)
      // 요청 body에 client_id 포함
      const [url, opts] = fetchImpl.mock.calls[0]
      expect(String(url)).toContain('/api/accounts/deviceauth/usercode')
      expect(JSON.parse(opts.body)).toEqual({ client_id: DEFAULT_CODEX_CLIENT_ID })
    })

    it('usercode alias (Codex CLI 호환)', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { device_auth_id: 'dev_x', usercode: 'XYZW', interval: '7' })
        )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.requestUserCode()
      expect(result.userCode).toBe('XYZW')
      expect(result.interval).toBe(7) // 문자열도 파싱
    })

    it('HTTP 오류 → throw', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(500))
      const flow = new DeviceCodeFlow({ fetchImpl })
      await expect(flow.requestUserCode()).rejects.toThrow('usercode 요청 실패')
    })

    it('응답 형식 오류 → throw', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { device_auth_id: 'x' }))
      const flow = new DeviceCodeFlow({ fetchImpl })
      await expect(flow.requestUserCode()).rejects.toThrow('응답 형식 오류')
    })
  })

  describe('pollOnce', () => {
    it('200 success → authorization_code + PKCE 반환', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            authorization_code: 'auth_abc',
            code_challenge: 'ch_xyz',
            code_verifier: 'ver_xyz'
          })
        )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('success')
      if (result.status === 'success') {
        expect(result.authorizationCode).toBe('auth_abc')
        expect(result.codeChallenge).toBe('ch_xyz')
        expect(result.codeVerifier).toBe('ver_xyz')
      }
    })

    it('403 → pending', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(403))
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('pending')
    })

    it('404 → pending', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(404))
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('pending')
    })

    it('500 → error', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(500))
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('error')
    })

    it('200이지만 형식 오류 → error', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, {}))
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('error')
    })

    it('fetch throw → error', async () => {
      const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('network down'))
      const flow = new DeviceCodeFlow({ fetchImpl })
      const result = await flow.pollOnce('dev_1', 'ABCD')
      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.reason).toContain('network down')
      }
    })
  })

  describe('exchangeTokens', () => {
    it('정상 응답 → TokenBundle 반환 (expiresAt 계산)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(200, {
          id_token: 'id_a',
          access_token: 'acc_a',
          refresh_token: 'ref_a',
          expires_in: 1800
        })
      )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const before = Date.now()
      const bundle = await flow.exchangeTokens({
        authorizationCode: 'auth_abc',
        codeVerifier: 'ver_xyz'
      })
      expect(bundle.idToken).toBe('id_a')
      expect(bundle.accessToken).toBe('acc_a')
      expect(bundle.refreshToken).toBe('ref_a')
      expect(bundle.expiresAt - bundle.issuedAt).toBe(1800 * 1000)
      expect(bundle.issuedAt).toBeGreaterThanOrEqual(before)
      // body는 form-urlencoded
      const [, opts] = fetchImpl.mock.calls[0]
      expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(String(opts.body)).toContain('grant_type=authorization_code')
      expect(String(opts.body)).toContain('code=auth_abc')
      expect(String(opts.body)).toContain('code_verifier=ver_xyz')
    })

    it('expires_in 누락 → 1시간 fallback', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(200, {
          id_token: 'i',
          access_token: 'a',
          refresh_token: 'r'
        })
      )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const bundle = await flow.exchangeTokens({
        authorizationCode: 'c',
        codeVerifier: 'v'
      })
      expect(bundle.expiresAt - bundle.issuedAt).toBe(3600 * 1000)
    })

    it('HTTP 오류 → throw', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(400))
      const flow = new DeviceCodeFlow({ fetchImpl })
      await expect(
        flow.exchangeTokens({ authorizationCode: 'c', codeVerifier: 'v' })
      ).rejects.toThrow('token 교환 실패')
    })
  })

  describe('refreshTokens', () => {
    it('정상 응답 — 새 refresh_token 반환 (회전)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(200, {
          id_token: 'id_new',
          access_token: 'acc_new',
          refresh_token: 'ref_new',
          expires_in: 1800
        })
      )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const bundle = await flow.refreshTokens('ref_old')
      expect(bundle.accessToken).toBe('acc_new')
      expect(bundle.refreshToken).toBe('ref_new') // 회전
      const [, opts] = fetchImpl.mock.calls[0]
      expect(String(opts.body)).toContain('grant_type=refresh_token')
      expect(String(opts.body)).toContain('refresh_token=ref_old')
    })

    it('refresh_token 미반환 시 기존 유지 (회전 안 함)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(200, {
          id_token: 'id_new',
          access_token: 'acc_new',
          expires_in: 1800
        })
      )
      const flow = new DeviceCodeFlow({ fetchImpl })
      const bundle = await flow.refreshTokens('ref_old')
      expect(bundle.refreshToken).toBe('ref_old')
    })

    it('401 → throw (refresh 실패)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(401))
      const flow = new DeviceCodeFlow({ fetchImpl })
      await expect(flow.refreshTokens('ref_old')).rejects.toThrow('refresh 실패')
    })
  })

  describe('issuer trailing slash 정규화', () => {
    it('issuer 끝 슬래시 제거', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { device_auth_id: 'd', user_code: 'u', interval: 5 })
        )
      const flow = new DeviceCodeFlow({
        issuer: 'https://auth.example.com/',
        fetchImpl
      })
      await flow.requestUserCode()
      const [url] = fetchImpl.mock.calls[0]
      expect(String(url)).toBe('https://auth.example.com/api/accounts/deviceauth/usercode')
    })
  })
})
