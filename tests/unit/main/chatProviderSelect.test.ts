/**
 * Sprint 017 M3 T16 — selectChatProviderIds 단위 회귀.
 *
 * cover (codex 019e502d 권고 매트릭스 정합):
 *   - allowedProviders 명시 시 그대로 사용 (BYOK 정합, KI-003)
 *   - allowedProviders 미명시 + defaultProviderId='local' → ['local']
 *   - allowedProviders 미명시 + defaultProviderId='openai' → ['openai']
 *   - defaultProviderId 알 수 없는 string → ['openai'] (KI-003 BYOK 디폴트 보존)
 *   - allowedProviders 빈 배열 → defaultProviderId 따름 (empty 무시)
 *   - defaultProviderId null/undefined → ['openai']
 */

import { describe, it, expect } from 'vitest'
import { selectChatProviderIds } from '../../../src/main/chatProviderSelect'

describe('selectChatProviderIds', () => {
  it('allowedProviders 명시 → 그대로 사용 (BYOK 정합)', () => {
    expect(selectChatProviderIds(['codex'], 'openai')).toEqual(['codex'])
    expect(selectChatProviderIds(['openai', 'codex'], 'local')).toEqual(['openai', 'codex'])
    expect(selectChatProviderIds(['local'], 'openai')).toEqual(['local'])
  })

  it('allowedProviders 미명시 + defaultProviderId=local → [local]', () => {
    expect(selectChatProviderIds(undefined, 'local')).toEqual(['local'])
  })

  it('allowedProviders 미명시 + defaultProviderId=openai → [openai]', () => {
    expect(selectChatProviderIds(undefined, 'openai')).toEqual(['openai'])
  })

  it('codex 019e502d Q6 — defaultProviderId=local 시 OpenAI fallback X (사용자 명시 존중)', () => {
    // 사용자가 local 선택 → Ollama 미실행이라도 OpenAI 자동 fallback 비권고.
    // 본 helper 는 ['local'] 만 반환. Chat IPC 가 provider 없으면 null → 사용자 error 표시.
    expect(selectChatProviderIds(undefined, 'local')).toEqual(['local'])
    expect(selectChatProviderIds(undefined, 'local')).not.toContain('openai')
  })

  it('defaultProviderId 알 수 없는 string → [openai] (KI-003 BYOK 디폴트 보존)', () => {
    expect(selectChatProviderIds(undefined, 'anthropic')).toEqual(['openai'])
    expect(selectChatProviderIds(undefined, 'mistral')).toEqual(['openai'])
    expect(selectChatProviderIds(undefined, '')).toEqual(['openai'])
  })

  it('allowedProviders 빈 배열 → defaultProviderId 따름 (empty 무시)', () => {
    expect(selectChatProviderIds([], 'local')).toEqual(['local'])
    expect(selectChatProviderIds([], 'openai')).toEqual(['openai'])
  })

  it('defaultProviderId null / undefined → [openai]', () => {
    expect(selectChatProviderIds(undefined, null)).toEqual(['openai'])
    expect(selectChatProviderIds(undefined, undefined)).toEqual(['openai'])
  })

  it('allowedProviders 명시 + defaultProviderId 무관', () => {
    // allowedProviders 가 있으면 defaultProviderId 의 영향 없음 (caller 명시 우선)
    expect(selectChatProviderIds(['codex'], 'local')).toEqual(['codex'])
    expect(selectChatProviderIds(['codex'], null)).toEqual(['codex'])
  })
})
