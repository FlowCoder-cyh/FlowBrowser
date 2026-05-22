/**
 * Sprint 017 M3 T16 — Chat IPC provider 선택 헬퍼.
 *
 * 책임: 호출자 (`registerChatIpc`) 가 `allowedProviders` (caller 명시) 와 `defaultProviderId`
 * (UserSetting) 둘 다 받아 실제 candidate list 결정. pure function — services.ts 의 `providers`
 * registry 와 분리되어 단위 회귀 가능 (codex 019e502d 권고 정합).
 *
 * 정책:
 *   - `allowedProviders` 가 명시되면 그대로 사용 (기존 BYOK 정합 유지 — KI-003)
 *   - 미명시 시 `defaultProviderId === 'local'` 이면 `['local']` 단일
 *   - 그 외 (`'openai'` / 그 외 알 수 없는 string 포함) 디폴트 `['openai']` — KI-003 BYOK 디폴트 보존
 *
 * codex Q6 — 사용자가 `defaultProviderId='local'` 박은 후 Ollama 미실행 시 OpenAI fallback 금지
 * (비용/프라이버시 surprise 회피). 본 helper 는 single candidate `['local']` 만 반환 — Chat IPC
 * 가 provider 없으면 `null` (사용자에게 error 표시).
 */

import type { ProviderType as CredentialProviderType } from '../storage/Credentials'

/**
 * Chat IPC 의 provider candidate list 결정.
 *
 * @param allowedProviders 호출자 (renderer) 가 명시한 candidate list. 미주입 시 user 디폴트 따름.
 * @param defaultProviderId UserSetting.defaultProviderId. 'local' 시 ['local'] 단일. 그 외 ['openai'].
 */
export function selectChatProviderIds(
  allowedProviders: ReadonlyArray<CredentialProviderType> | undefined,
  defaultProviderId: string | null | undefined
): ReadonlyArray<CredentialProviderType> {
  if (allowedProviders && allowedProviders.length > 0) return allowedProviders
  if (defaultProviderId === 'local') return ['local']
  return ['openai']
}
