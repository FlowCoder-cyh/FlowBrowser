# Spike 1 — Codex/ChatGPT 인증 방식 검증

> **상태: 잠정 완료 (정책 조사 1차)**
> 담당: Claude (조사) + 사용자 (판정)
> 시작일: 2026-05-11
> 종료일: 2026-05-11 (1차 조사)
> 다음: Phase 1 PoC에서 실제 호출 검증

## 목표

정책 위반 없이 Codex/ChatGPT 로그인 기반 Provider를 구현할 수 있는지 확인.

## 가설

OpenAI가 공식적으로 허용하는 인증 흐름을 통해 ChatGPT/Codex 로그인 사용자가 본 앱에서 동일 계정으로 AI 기능을 쓸 수 있다.

## 검증 항목

- [x] 공식 인증 경로 존재 여부 (OAuth, API 파트너 프로그램)
- [x] 3rd-party 앱 사용 약관 검토
- [x] 토큰 저장/갱신 방식
- [x] 사용량 제한 정책 (1차 추정)
- [x] 다른 3rd-party 앱 사례 (OpenClaw, Roo Code)
- [ ] 실제 호출 시 비용 / 한도 처리 (Phase 1 PoC로 이관)

## 검증 방법

1. OpenAI 공식 문서 (developers.openai.com/codex/auth, /apps-sdk/build/auth) 정독
2. Codex GitHub 저장소 README + 인증 모듈 확인
3. OpenClaw 공식 docs + LumaDock 사용자 경험 분석
4. OpenAI Developer Community "Best practice for ClientID" 스레드 확인
5. Just Think AI / Stytch 등 3rd-party 분석 글 확인

## 결과

### 1. 공식 명시 상태

| 출처 | 명시 | 비고 |
|---|---|---|
| developers.openai.com/codex/auth | Codex 자체 도구 인증만 다룸 | 3rd-party 사용 가능성 명시 없음 |
| developers.openai.com/apps-sdk/build/auth | ChatGPT 내부 통합용 | 데스크톱 앱 미언급, M2M OAuth 명시 거부 |
| GitHub Issue openai/codex#10974 | "Sign in with ChatGPT" for 3rd-party apps | **Closed as not planned** |
| OpenAI Developer Community 스레드 | ClientID 재사용 best practice 질문 | OpenAI 직원 응답 없음, **unresolved** |

**결론**: OpenAI 측 공식 명시는 부재. 등록 경로도 미제공. 단, 명시적 차단도 없음.

### 2. 기술 인증 메커니즘 (Codex CLI 분석)

| 항목 | 값 |
|---|---|
| OAuth 흐름 | OAuth 2.0 device-code grant + PKCE (S256) |
| Public Client ID | `app_EMoamEEZ73f0CkXaXp7hrann` |
| Endpoint (사용자 코드 발급) | `POST /deviceauth/usercode` |
| Endpoint (토큰 폴링) | `POST /deviceauth/token` (15분 폴링 윈도우) |
| 발급 토큰 | `id_token` + `access_token` + `refresh_token` |
| 토큰 자동 갱신 | 만료 전 Codex가 자동 refresh 호출 |
| 소스 위치 | `codex-rs/login/src/device_code_auth.rs` (Rust 오픈소스) |
| 자격 증명 저장 | `$CODEX_HOME` 또는 system keyring (선택) |

**구조**: public client + PKCE = native app OAuth 표준 패턴 (Google/GitHub Sign-In과 동일).

### 3. 3rd-party 앱 사례

| 앱 | 인증 방식 | 비고 |
|---|---|---|
| OpenClaw | `openai-codex` provider 활용 (browser/device-code/session reuse 3가지 모드) | OpenAI 공식 등록 파트너십 아님, OpenAI 차단도 없음 |
| Roo Code | 같은 클라이언트 ID 재사용 (`app_EMoa…`) | OpenAI Developer Community 스레드에서 확인 |
| anomalyco/opencode | Issue로 통합 시도 중 (#3281) | 진행 중 |

**결론**: 다수 사례 운영 중. OpenAI는 공식 인정도 차단도 안 함 = **사실상 묵인 / 회색지대**.

### 4. 비용 처리 (LumaDock·OpenClaw 추정)

| 항목 | 추정 |
|---|---|
| OpenAI 측 공식 안내 | **없음** |
| LumaDock 주장 | "ChatGPT Plus($20/월) / Pro($200/월) 구독으로 OpenClaw Codex 커버 + 5시간/주 한도" |
| OpenClaw 자체 docs | "구독이 직접 비용 처리 안 함" — direct OpenAI API 호출 시 (provider=openai 모드) |
| 실제 검증 | **Phase 1 PoC에서 측정 필요** |

해석: OpenClaw에는 두 모드가 있음 — `openai-codex` provider(구독 활용 가능 추정) vs 직접 `openai` API key(별도 비용). LumaDock이 보고하는 건 전자.

### 5. 정책 위반 가능성 평가

| 가드레일 | 위반? | 근거 |
|---|---|---|
| G-003 ChatGPT 웹 쿠키 재사용 | **No** | 표준 OAuth device-code grant 사용, 쿠키 미사용 |
| G-003 비공식 토큰 추출 | **No** | OpenAI가 발급하는 정상 access/refresh token |
| G-003 사용량 우회 | **No** | OpenAI가 사용자 한도(예: 5시간/주) 강제, 우리는 우회 안 함 |
| G-003 계정 프록시화 | **No** | 사용자가 본인 계정으로 로그인, 앱이 대리 로그인 안 함 |
| OpenAI ToS | **회색** | 명시적 위반 조항 발견 못함, 공식 등록 경로 없음 |

### 판정

| 항목 | 결과 |
|---|---|
| **종합 판정** | **Pass with conditions** |
| Codex Login Provider | 유지 (Experimental 라벨) |
| MVP 기본 Provider | OpenAI API Key (Codex Login은 Experimental 옵션) |
| 정책 변경 대비 폴백 | OpenAI API Key 모드 항상 유지 (PRD 11.3 기존 결정) |

### 조건

1. **"Experimental" 라벨 유지** — UI에 "OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드, OpenAI가 차단할 가능성 있음" 고지
2. **자체 OAuth 클라이언트 등록 시도 안 함** — 공개 Codex 클라이언트 ID(`app_EMoamEEZ73f0CkXaXp7hrann`) 재사용
3. **device-code flow + PKCE 직접 구현** — Codex CLI 설치 강제 없음
4. **토큰 저장은 OS Keychain 위임** (G-005 기존 결정 유지)
5. **정책 변경 감지 시 즉시 폴백** — OpenAI API Key 모드로 자동 전환 + 사용자 알림

## PRD 영향

다음 섹션을 PRD v0.3에서 갱신:

### PRD 11.3 Provider 전략 — "메인 (조건부)"
- 현재 표현 "Phase 0 Spike 1 검증을 통과한 경우에만 활성화" → "Spike 1 1차 조사 결과 Experimental 활성화. 단, 자체 OAuth 클라이언트 등록 안 함, 공개 Codex 클라이언트 재사용. Phase 1 PoC에서 실제 비용 처리 검증."
- 보강 추가:
  - "Codex Login Provider는 OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드. OpenAI가 차단할 가능성 있으므로 OpenAI API Key 폴백 항상 유지."

### PRD 15.2 Provider 전략표
- Codex Login: P0 (조건부) → **P0 (Experimental, 자체 OAuth 미등록)**
- "리스크: 정책 변경 가능성" → "리스크: 공식 등록 부재, OpenAI가 임의로 차단 가능"

### PRD 15.3 금지 전략
- 기존 항목 유지
- 추가 명시: "공개 Codex OAuth 클라이언트 재사용은 OpenClaw·Roo Code 등 사례에 따라 회색지대 허용. 단, 자체 OAuth 등록 / 사용자 쿠키 추출 / 한도 우회는 절대 금지."

### PRD 18.1 Codex 토큰 정책 리스크
- 기존 대응 항목 유지
- 추가: "공식 등록이 없으므로 OpenAI 측 단순 차단(클라이언트 ID 무효화)으로도 본 Provider 즉시 정지 가능. 폴백은 즉시 동작해야 함."

## 미해결 → Phase 1 PoC 이관

다음 항목은 실제 코드 호출 없이 검증 불가능. Phase 1 진입 시 sprint-001 또는 별도 spike-PoC에 포함:

1. **비용 / 한도 처리** — ChatGPT Plus 사용자가 본 앱에서 Codex Login 사용 시 어디로 청구되는지 (사용자 구독 한도 / 별도 / 거부)
2. **OpenAI 측 임의 차단 시그널** — 어떤 쿼리/패턴에서 차단 발생하는지
3. **모델 가용성 차이** — Codex Login 시 호출 가능한 모델 vs API Key 시 가능 모델
4. **Refresh token 만료 정책** — 장기 미사용 시 강제 재로그인 주기

## 평가 (evaluator 입력)

본 Spike 결과를 evaluator에게 제출 권장:
- 입력: 본 파일 + PRD 11.3 / 15.2 / 15.3 / 18.1
- 출력: `.flowset/eval-results/spike-01-2026-05-11.md`
- 채점 기준: 위 판정 기준 + 가드레일 정합성

## 참조 (Sources)

### OpenAI 공식
- [Authentication – Codex | OpenAI Developers](https://developers.openai.com/codex/auth)
- [Authentication – Apps SDK | OpenAI Developers](https://developers.openai.com/apps-sdk/build/auth)
- [GitHub: openai/codex](https://github.com/openai/codex)
- [Sign in with ChatGPT for third-party apps · Issue #10974 (Closed as not planned)](https://github.com/openai/codex/issues/10974)
- [Best practice for ClientID when using Codex OAuth — OpenAI Developer Community (unresolved)](https://community.openai.com/t/best-practice-for-clientid-when-using-codex-oauth/1371778)

### 3rd-party 분석
- [Codex CLI Authentication: How the Device-Code Flow Works with ChatGPT — Instagit](https://instagit.com/openai/codex/codex-cli-authentication-methods/)
- [Codex CLI Authentication: OAuth, Device Code, API Keys, and CI/CD — Daniel Vaughan](https://codex.danielvaughan.com/2026/04/01/codex-cli-authentication-flows-credential-management/)
- [Guide to authentication in OpenAI Apps SDK — Stytch](https://stytch.com/blog/guide-to-authentication-for-the-openai-apps-sdk/)
- [OpenAI's Game Changer: ChatGPT as Your Universal App Login — Just Think AI](https://www.justthink.ai/blog/openais-game-changer-chatgpt-as-your-universal-app-login)

### 3rd-party 앱 사례
- [OpenAI provider docs — OpenClaw](https://docs.openclaw.ai/providers/openai)
- [How to use OpenAI Codex on OpenClaw with a ChatGPT subscription — LumaDock](https://lumadock.com/tutorials/openclaw-openai-codex-chatgpt-subscription)
- [OpenClaw GitHub repository](https://github.com/openclaw/openclaw)

## 변경 이력

- 2026-05-11: placeholder 생성
- 2026-05-11: 1차 조사 완료, Pass with conditions 판정. Phase 1 PoC 이관 항목 4개 명시.
