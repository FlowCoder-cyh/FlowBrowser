# Sprint 014 — Phase 1 / Codex OAuth Login Provider 활성화 (사용자 테스트 진입)

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP — 사용자 테스트 진입 게이트)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 013 종료 (PR #71~#75 머지)
- [x] 단위 테스트 307/307 PASS
- [x] Sprint 013 종합 evaluator Pass 13 / 0 / 0
- [x] PRD v0.3.11 발행
- [x] Spike 1 결과: Pass w/ conditions — device-code grant + PKCE + 공개 클라이언트 ID `app_EMoamEEZ73f0CkXaXp7hrann` 재사용 합법
- [x] G-011 (공개 endpoint 회색지대 허용) 활성

## 1. Sprint 목표

**Phase 1 사용자 테스트 진입 게이트 = Codex OAuth Login Provider 활성화.**

사용자가 ChatGPT 구독 계정으로 본 앱에 로그인하여 별도 API Key 비용 없이 번역/요약/탭 등 모든 기능을 직접 테스트할 수 있는 상태를 만든다. BYOK(OpenAI API Key) 모드는 폴백으로 유지 (G-011 조건 5).

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S014-T01 | `DeviceCodeFlow` 순수 함수 (PKCE S256 challenge 생성, user_code/device_code 요청, token 폴링, refresh) — fetch 추상화 의존성 주입 가능 | `src/ai/codex/DeviceCodeFlow.ts` |
| S014-T02 | `CodexLoginProvider` (ProviderAdapter 구현) — access_token으로 OpenAI chat completions 호출. 401 시 refresh_token으로 갱신 후 1회 재시도. refresh 실패 시 expired 마킹 + OpenAI API Key 폴백 트리거 | `src/ai/providers/CodexLoginProvider.ts` |
| S014-T03 | CredentialsStore에 OAuth 토큰 묶음 저장 — providerType='codex', authType='oauth', secret=JSON `{ accessToken, refreshToken, idToken, expiresAt, issuedAt }` (safeStorage 암호화) | `src/storage/Credentials.ts` 확장 또는 별도 wrapper |
| S014-T04 | main process IPC: `codex:start-login` (user_code 발급), `codex:poll-login` (token 폴링), `codex:logout`, `codex:status` | `src/main/index.ts`, `src/main/services.ts` |
| S014-T05 | preload `codexApi` (startLogin / pollLogin / logout / status) + 단위 테스트 모킹 가능 구조 | `src/preload/index.ts` |
| S014-T06 | `CodexLoginPanel` Settings UI — Experimental 라벨 + 로그인 버튼 → user_code 카드 표시 ("https://chatgpt.com/deviceauth에 이 코드 입력") + 폴링 진행률 + 성공/실패 분기 + 로그아웃 | `src/renderer/src/settings/CodexLoginPanel.tsx`, SettingsPage 라우팅 |
| S014-T07 | ProviderRegistry 갱신 — `rebuildAllProviders()`에서 codex credential active 시 CodexLoginProvider 인스턴스 생성 + 401/refresh 실패 시 자동 폴백 (UserSetting.defaultProviderId 'openai'로 알림) | `src/main/services.ts` |
| S014-T08 | `OnboardingTour` (간소화 버전) — 첫 실행 Consent 후 Provider 미설정이면 "Codex Login 또는 OpenAI API Key" 안내 카드 + 추천 URL 3개 (영문 위키 / Hacker News / arXiv 등 안전 페이지) + UserSetting `onboardingShown` 플래그 | `src/renderer/src/onboarding/OnboardingTour.tsx`, `src/storage/UserSettingStore.ts`, App.tsx |
| S014-T09 | 사용자 테스트 가이드 — `docs/USAGE.md` 신규 (빌드 / 실행 / Codex Login 절차 / OpenAI API Key 절차 / 기능별 사용법 / FAQ / 알려진 한계). README.md에 진입 링크 | `README.md`, `docs/USAGE.md` |
| S014-T10 | 단위 테스트 — DeviceCodeFlow (PKCE S256 생성 / 토큰 폴링 상태 매트릭스 / refresh 401 경로) + CredentialsStore OAuth 토큰 묶음 round-trip + OnboardingTour 가시성 매트릭스 | `tests/unit/ai/DeviceCodeFlow.test.ts`, `tests/unit/storage/Credentials.test.ts` 보강, `tests/unit/renderer/OnboardingTour.test.ts` |
| S014-T11 | PRD v0.3.12 + Phase 1 §16 정합 매트릭스 + Sprint 종합 evaluator + handoff/state + Phase 1.5 트랙 정의 (Phase 1 PoC 4종 실측 후속) | docs/prd, .flowset/* |

### 제외 (Sprint 015+)

- **Phase 1 PoC 4종 실측 검증** (비용 / 차단 시그널 / 모델 가용성 / refresh 만료 정책) — 사용자가 실제 로그인 + 사용 후 측정. Phase 1.5 트랙.
- **탭 그룹** — UX 보강, Phase 1 명시 외, Sprint 015+
- **Phase 2 진입 (자막/TTS/싱크)** — Spike 2/3/4 PoC 임계 정량화 우선
- **사용자 수동 QA 결과 반영** — 사용자 작업 진행 후
- **evaluator 추적 섹션 / UserSetting Phase 2~4 필드** — 보류
- **자동 폴백 알림 정교화** (토스트 / 모달) — 1차는 콘솔 + UI status, 정교화는 후속

## 3. 수용 기준

### AC-1 DeviceCodeFlow + CodexLoginProvider 코어 (S014-T01 ~ T03, T07)

- `DeviceCodeFlow.generatePkce()` — code_verifier (43~128자 random) + code_challenge (S256 SHA-256 base64url) 반환 (RFC 7636)
- `DeviceCodeFlow.requestUserCode(client_id, code_challenge)` — `POST https://auth.openai.com/oauth/device/code` (또는 Spike 1에 명시된 endpoint) → `{ user_code, device_code, verification_uri, interval, expires_in }` 반환. HTTP 오류 시 throw
- `DeviceCodeFlow.pollToken(device_code, code_verifier, interval, expires_in)` — 주기적 `POST .../token` 호출. 응답 매트릭스:
  - `200 + access_token` → 성공 반환
  - `400 authorization_pending` → 다음 폴링
  - `400 slow_down` → interval += 5초
  - `400 expired_token` → 만료 throw
  - `400 access_denied` → 거부 throw
- `DeviceCodeFlow.refresh(refresh_token)` — `POST .../token` grant_type=refresh_token → 새 access_token + refresh_token (회전 시 새 값)
- `CodexLoginProvider.translate(input)` — access_token bearer로 `api.openai.com/v1/chat/completions` 호출. 401 시 refresh 1회 시도 후 재시도. 재시도도 실패면 throw → 폴백 트리거
- `CredentialsStore`가 OAuth 토큰 묶음 (JSON) safeStorage 암호화 저장 + decrypt 시 JSON 파싱 헬퍼

### AC-2 IPC + UI (S014-T04 ~ T06)

- IPC 4종: `codex:start-login` (user_code/verification_uri/expires_in 반환), `codex:poll-login` (status: pending/success/expired/denied/error + access_token 미반환 — main 내부 저장), `codex:logout` (credential 제거), `codex:status` (active/expired/none)
- preload `codexApi` 동일 API + 단위 테스트 가능 인터페이스
- `CodexLoginPanel` UI:
  - **Experimental 라벨** "OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드, OpenAI가 차단할 가능성 있음" 명시 (G-011 + Spike 1 조건 1)
  - 로그인 버튼 → user_code 카드 표시 (큰 폰트 + verification_uri 링크 + 폴링 진행 dots)
  - 성공 시 "로그인 완료" + 로그아웃 버튼
  - 만료/거부/오류 시 명확한 메시지 + 재시도 옵션
- SettingsPage 라우팅에 CodexLoginPanel 추가

### AC-3 Provider 통합 + 폴백 (S014-T07)

- `rebuildAllProviders()`에서 codex credential `status='active'` + 토큰 묶음 유효 시 CodexLoginProvider 인스턴스 등록 (providerType='codex')
- 401 + refresh 실패 시 credential `status='expired'` 마킹 + 다음 호출부터 OpenAI API Key 폴백 (UserSetting.defaultProviderId 자동 'openai' 갱신 + UI 알림 이벤트)
- 사용자가 다시 Codex Login 시 status='active'로 복귀
- `UserSetting.defaultProviderId`가 'codex'일 때 토큰 무효면 즉시 'openai'로 자동 전환 (BYOK 폴백 — G-011 조건 5)

### AC-4 OnboardingTour + 사용자 가이드 (S014-T08, T09)

- 첫 실행 후 (Consent 동의 후) `UserSetting.onboardingShown=false` + credential 미설정이면 OnboardingTour 표시
- 카드 2개: "Codex Login으로 시작" + "OpenAI API Key로 시작" — 각각 SettingsPage 해당 패널로 이동
- 추천 URL 3개 (영문 위키 / Hacker News / arXiv) — 클릭 시 활성 탭 navigate + 패널 close
- "다시 보지 않기" 토글 → UserSetting.onboardingShown=true 영속
- `docs/USAGE.md` 신규 7개 섹션 (빌드·실행·Codex Login·BYOK·기능별 사용법 (선택/문단/페이지/요약/탭 UX)·FAQ·알려진 한계)
- README.md 진입 링크 + 빠른 시작 3~5 줄

### AC-5 단위 테스트 (S014-T10)

- DeviceCodeFlow:
  - generatePkce: code_verifier 길이 43~128 + S256 challenge 형식 + 매 호출 다른 값 (2 케이스)
  - requestUserCode: 정상 응답 파싱 1 / HTTP 오류 throw 1
  - pollToken: success / authorization_pending / slow_down / expired_token / access_denied 5 매트릭스
  - refresh: 정상 / 401 throw 2
- CredentialsStore OAuth 토큰 묶음 round-trip + JSON 파싱 헬퍼 2
- OnboardingTour 가시성 매트릭스: consent 후 + credential 없음 + onboardingShown false → 표시 / onboardingShown true → 숨김 / credential 있음 → 숨김 3
- **누적 단위 테스트 ≥ 325** (Sprint 013 307 + 18)

### AC-6 통과 기준

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 8 Sprint 연속)
- **Spike 1 조건 5개 모두 충족**:
  1. Experimental 라벨 UI 노출 ✓ (T06)
  2. 자체 OAuth 클라이언트 미등록 (공개 Codex client ID 재사용) ✓ (T01)
  3. device-code + PKCE 직접 구현 ✓ (T01)
  4. OS Keychain 위임 (safeStorage) ✓ (T03)
  5. 정책 변경 감지 시 즉시 폴백 ✓ (T07)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T03, T07 일부 — DeviceCodeFlow + CodexLoginProvider + CredentialsStore OAuth 토큰 + 단위 테스트 일부 (12) | 2~3일 |
| M2 | T04~T06 — IPC + preload + CodexLoginPanel UI + 폴백 통합 (T07 마무리) | 2일 |
| M3 | T08, T09 + T10 잔여 — OnboardingTour + docs/USAGE.md + README + 단위 테스트 잔여 (6) | 1~2일 |
| M4 | T11 — PRD v0.3.12 + Phase 1 §16 정합 매트릭스 + Sprint 종합 + Phase 1.5 트랙 정의 | 1일 |

총 6~8일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§11.3 / §15.2 / §15.3 / §18.1 — Codex Login Experimental 활성화 반영)
- G-003 인증 금지선 — device-code + PKCE 직접 구현, ChatGPT 쿠키 재사용·비공식 토큰 추출·사용량 우회·계정 프록시화 절대 금지
- G-005 OS Keychain 위임 — 토큰 묶음 safeStorage 암호화
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S014-docs ...` / `WI-S014M1-feat ...` / `WI-S014M2-feat ...` / `WI-S014M3-feat ...` / `WI-S014M4-docs ...`
- G-010 UTF-8 / LF
- **G-011 공개 endpoint 회색지대 허용** — 공개 Codex 클라이언트 ID 재사용 정합, Experimental 라벨 + 폴백 유지

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **Endpoint URL 정확성** — Spike 1에서 명시한 endpoint 경로(`/deviceauth/usercode`, `/deviceauth/token`)는 Codex CLI 소스 기준. 실제 OpenAI 측 OAuth endpoint URL 정확성은 Codex CLI `codex-rs/login/src/device_code_auth.rs` 직접 참조하여 1:1 매핑. 잘못된 endpoint면 즉시 404로 식별 → M1 단위 테스트는 fetch 모킹이라 통합 검증은 M2 사용자 수동 시연 단계.
2. **OpenAI 측 임의 차단** — Phase 1 PoC #2. 본 Sprint는 폴백 메커니즘만 구현, 차단 시그널 측정은 Phase 1.5 트랙.
3. **모델 가용성 차이** — Phase 1 PoC #3. Codex Login으로 호출 가능한 모델이 API Key 모드와 다를 수 있음. 1차는 `gpt-4o-mini` 동일 가정, 차이 발견 시 Phase 1.5에서 매트릭스 갱신.
4. **refresh_token 회전** — 일부 OAuth provider는 refresh 호출 시 새 refresh_token 반환 (회전). DeviceCodeFlow.refresh가 응답의 refresh_token이 있으면 갱신, 없으면 기존 유지로 안전 처리.
5. **CredentialsStore.decryptSecret JSON 파싱** — 기존은 plain string secret. Codex는 JSON. helper로 분기 (authType='oauth' 시 JSON.parse).
6. **OnboardingTour viewport** — 첫 실행 흐름이라 단위 테스트는 가시성 매트릭스만. 통합은 사용자 수동.

## 8. Sprint 종료 후 다음 (Sprint 015 / Phase 1.5 후보)

1. **Phase 1 PoC 4종 실측** — 사용자 실제 사용 후 비용/차단/모델/refresh 측정. PRD §18.1 데이터 입력.
2. **탭 그룹** — 단독 Sprint 권고 유지
3. **Phase 2 진입 준비** — Spike 2/3/4 PoC 임계 정량화
4. **사용자 수동 QA 결과 반영** — 사용자 직접 사용 피드백 통합
5. atomic write tempfile→rename / before-quit flush (Sprint 013 M2 evaluator 권고)
6. evaluator 보고서 후속 추적 섹션 (사용자 합의)

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 / §10.x Provider / §12.2 ProviderCredential
- PRD: `docs/prd/08_auth_billing.md` §15.2 / §15.3 / §18.1 — Codex Login Experimental 활성화 반영 예정
- Spike 1: `.flowset/specs/spike-01-codex-auth.md` + `.flowset/eval-results/spike-01-2026-05-11.md`
- 가드레일: G-001 / G-003 / G-005 / G-006 / G-007 / G-009 / G-010 / **G-011**
- Codex CLI 오픈소스: `codex-rs/login/src/device_code_auth.rs` (https://github.com/openai/codex)
- 표준: RFC 8628 (Device Authorization Grant) + RFC 7636 (PKCE)

## 변경 이력

- 2026-05-15: Sprint 014 정의 작성 — Phase 1 사용자 테스트 진입 게이트 = Codex OAuth Login Provider 활성화. 사용자 직접 지적 "Codex OAuth가 돼야 직접 테스트 진입 가능" 반영. BYOK 폴백 유지 (G-011 조건 5).
