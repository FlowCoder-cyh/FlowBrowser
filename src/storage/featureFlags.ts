/**
 * Sprint 015 M2 — Feature Flag helper.
 * PRD §19.5 / v04-direction §17 S3 — `flowbrowser.v04.enabled`.
 *
 * 우선순위:
 *   1) 환경변수 `FLOWBROWSER_V04` 명시 (개발 / 테스트 우회)
 *   2) UserSetting.v04Enabled (디폴트 false — Phase 1 마이그레이션 안전)
 *
 * 사용처:
 *   - M3 마이그레이션: v04Enabled true 진입 시 v03_to_v04 자동 실행 (M3-6)
 *
 * Sprint 016 M2 T11 — TranslationCache 어댑터 제거 후 본 helper 의 cache backend 분기 사용처 0.
 *   Sprint 016 M2 T9~T13 어댑터 일괄 제거 완료 후 본 helper 자체 정리 + UserSetting.v04Enabled 키 폐기 예정.
 */

export interface V04FlagSource {
  v04Enabled: boolean
}

export function isV04Enabled(setting: V04FlagSource): boolean {
  const envValue = process.env.FLOWBROWSER_V04
  if (envValue === '1' || envValue === 'true') return true
  if (envValue === '0' || envValue === 'false') return false
  return setting.v04Enabled === true
}
