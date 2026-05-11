# Sprint 001 — Phase 1 / 웹 번역 MVP 기초

> **상태: 정의 완료, 착수 대기**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 사용자 승인 후
> 목표 기간: 2~3주

## 0. 사전 조건 (Pre-conditions)

- [x] Phase 0 1차 조사 완료 (5개 Spike + evaluator)
- [x] PRD v0.3 발행
- [x] G-011 가드레일 추가
- [x] FlowSet v4.0.4 셋업
- [ ] 사용자 승인 (본 Sprint 착수)

## 1. Sprint 목표

웹 번역 MVP의 **최소 기능 골격**을 작동하는 형태로 구현. 1차 우선순위:

1. **Electron 셸 + URL 입력 + 웹페이지 로드** — 본 앱이 일반 브라우저처럼 페이지를 표시
2. **Privacy Filter (P0 모듈)** — G-004 / PRD §9.6. 모든 외부 전송 게이트
3. **OpenAI API Key Provider** — BYOK. ProviderAdapter 인터페이스 + 1개 구현
4. **OS Keychain 위임** — `safeStorage` API로 API Key 저장 (G-005 / PRD §12.2)
5. **DOM 텍스트 추출 + 선택 영역 번역** — 선택 영역 드래그 → 번역 결과 표시

본 Sprint는 **Codex Login Provider 미포함** (Phase 1 PoC 별도 spike). 사용자가 OpenAI API Key 입력 후 사용.

## 2. 범위 (Scope)

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S001-T01 | Electron 프로젝트 셋업 (TypeScript, electron-vite 또는 electron-forge) | `package.json`, `electron-builder.json`, `tsconfig.json` |
| S001-T02 | Electron 메인 프로세스 + WebContentsView/BrowserView 구성 | `src/main/`, URL 표시 동작 |
| S001-T03 | URL 입력 바 + 뒤로/앞으로/새로고침 (PRD §9.1 P0~P1) | `src/renderer/UrlBar.tsx` |
| S001-T04 | **Privacy Layer 골격 (P0 게이트)** | `src/privacy/SensitiveFieldDetector.ts`, `DomainFilter.ts`, `ConsentGate.ts`, `TransmissionLogger.ts` |
| S001-T05 | 첫 실행 동의 화면 (PRD §8.0 / §10.3) | `src/renderer/onboarding/Consent.tsx` |
| S001-T06 | ProviderAdapter 인터페이스 + OpenAIApiKeyProvider 구현 | `src/ai/ProviderAdapter.ts`, `src/ai/providers/OpenAIApiKeyProvider.ts` |
| S001-T07 | OS Keychain 위임 (Electron `safeStorage`) — ProviderCredential 저장 | `src/storage/Credentials.ts` |
| S001-T08 | DOM Text Extractor — Renderer 내 선택 영역 추출 | `src/perception/SelectionExtractor.ts` |
| S001-T09 | Selection 번역 → 번역 결과 미니 팝업 표시 | `src/renderer/TranslationPopup.tsx` |
| S001-T10 | TranslationRequest / Privacy Filter 통합 (요청 → Filter → Provider → 결과) | `src/ai/TranslationEngine.ts` |
| S001-T11 | UsageLog 기본 (PRD §12.8) — 토큰 / 비용 / privacyDecision 기록 | `src/storage/UsageLog.ts` |
| S001-T12 | 단위 테스트 (privacy / provider / extractor) | `tests/unit/` |

### 제외 (이후 Sprint)

- 문단 단위 번역 → Sprint 002
- 페이지 전체 번역 → Sprint 002
- 번역 결과 캐시 → Sprint 003
- 우측 번역 패널 (지금은 미니 팝업만) → Sprint 002
- Codex Login Provider Experimental → 별도 spike
- 자막 / TTS / 싱크 → Phase 2~4
- 자동 업데이트 / 코드 사이닝 → 별도 운영 Sprint

## 3. 수용 기준 (Acceptance Criteria)

본 Sprint가 "완료"로 인정되는 조건. evaluator 채점 입력.

### AC-1: 기본 브라우저 동작
- URL 입력 → 페이지 로드 → 뒤로/앞으로/새로고침
- 페이지 표시는 정상 (Chromium 그대로)
- macOS 13+ / Windows 10+ 모두 동작

### AC-2: Privacy Filter
- 로그인 폼(`<input type="password">`) 있는 페이지에서 자동 번역 시도 시 차단
- 도메인 블랙리스트 (mail.* / accounts.* / banking.* / payment.* / login.* / signin.* / oauth.* / id.*) 페이지에서 자동 번역 차단
- 사용자가 명시 승인 시 1회 번역 허용 (세션 토큰)
- 차단 / 승인 모두 UsageLog 기록

### AC-3: API Key 등록
- 설정 화면에서 OpenAI API Key 등록
- Key는 OS Keychain (Electron `safeStorage`) 저장
- 앱 자체는 평문 Key 보관 안 함 (`keychainRef`만)
- 잘못된 Key 입력 시 검증 실패 안내

### AC-4: 선택 영역 번역
- 웹페이지에서 텍스트 드래그
- 미니 팝업 표시 (번역 / 쉬운 설명 / 요약 중 "번역" 동작)
- OpenAI gpt-4o-mini 또는 gpt-4o로 호출 (모델 선택 가능)
- 결과 표시 시간 ≤ 5초 (PRD §10.1 / §17.1 — 3초 목표지만 첫 Sprint는 5초로 완화)

### AC-5: 동의 흐름
- 첫 실행 시 데이터 처리 / AI 전송 동의 화면
- 동의 없이는 번역 기능 비활성
- Privacy Filter 기본 정책 안내 포함

### AC-6: UsageLog
- 모든 외부 전송 기록 (privacyDecision / token / 비용)
- 사용자가 설정에서 사용량 확인 가능

### AC-7: 코드 품질
- TypeScript strict 모드
- ESLint + Prettier 통과
- 단위 테스트 통과 (privacy / provider / extractor 핵심)

## 4. 검증 방법

### 4.1 자동 검증
- ESLint / Prettier (CI)
- TypeScript typecheck (CI)
- 단위 테스트 (Vitest / Jest) (CI)

### 4.2 수동 검증 (수동 QA)
- macOS 13+ / Windows 10+ 빌드 실행 후 7개 AC 시나리오 수행
- Privacy Filter 시나리오: gmail.com / accounts.google.com / paypal.com / 일반 블로그 (각각 차단 / 차단 / 차단 / 허용)
- API Key 등록 → OS Keychain Items.app(macOS) / `cmdkey /list`(Win)에서 확인

### 4.3 evaluator 검증
- Sprint 종료 시 evaluator 호출
- 입력: 본 sprint-001.md + PR diff + 테스트 결과
- 출력: `.flowset/eval-results/sprint-001-{date}.md`
- 채점: AC 7개 각각 Pass / Partial / Fail

## 5. 의존성 / 외부 도구

- **Electron** (≥ 39.0.0 권장, 40.1.0 회피 — PRD §19.6 v0.3)
- **TypeScript** 5.x
- **빌드 도구**: electron-vite (권장) 또는 electron-forge
- **OpenAI API** (모델: gpt-4o-mini-tts 사용 안 함, TTS는 Phase 3+)
- **OS Keychain**: macOS Keychain Services / Windows DPAPI (Electron `safeStorage`)
- 테스트: Vitest 또는 Jest

## 6. 가드레일 적용

본 Sprint에 특히 적용되는 가드레일:

- **G-002 Phase 0 게이트**: Phase 1 진입했으므로 게이트 통과. 본 Sprint부터 코드 작성 허용.
- **G-003 인증 금지선**: OpenAI API Key는 BYOK, Codex 비공식 우회 사용 안 함.
- **G-004 Privacy Filter는 P0 기능**: 본 Sprint AC-2 / 작업 S001-T04로 직접 구현.
- **G-005 OS Keychain 위임**: 본 Sprint AC-3 / 작업 S001-T07로 직접 구현.
- **G-006 추측 금지**: 단위 테스트 + 수동 QA 통과 전까지 "완료" 보고 안 함.
- **G-007 main 직접 push 금지**: 각 작업은 별도 PR 브랜치 (`feat/WI-S001-TNN-...`).
- **G-009 커밋 형식**: `WI-S001-TNN-[type] 한글 작업명`.
- **G-010 UTF-8 / LF**: 모든 텍스트 파일.
- **G-011 회색지대**: 본 Sprint에 적용 없음 (OpenAI API Key BYOK만 사용).

## 7. 마일스톤

| 마일스톤 | 산출물 | 예상 |
|---|---|---|
| M1: Electron 셸 작동 | S001-T01, T02, T03 | 3~5일 |
| M2: Privacy + Provider 골격 | S001-T04, T05, T06, T07 | 4~6일 |
| M3: 선택 영역 번역 흐름 | S001-T08, T09, T10, T11 | 3~5일 |
| M4: 테스트 + 마무리 | S001-T12 + 수동 QA + evaluator | 2~3일 |

총: 12~19일 (영업일 기준 2~3주).

## 8. 리스크 / 미지수

1. **Electron 버전 선택**: 39.0.0 vs 39.x 최신. 40.1.0 회귀 회피.
2. **OpenAI 모델 선택**: gpt-4o-mini (저비용) vs gpt-4o (고품질). 본 Sprint는 모델 선택 UI 제공.
3. **macOS 코드 사이닝**: 별도 작업. 본 Sprint는 unsigned dev 빌드만.
4. **Privacy Filter false positive**: 일반 블로그가 도메인 키워드에 걸리면 사용자 마찰. 사용자 화이트리스트 기능 (S001 범위 외, Sprint 002에서).

## 9. Sprint 종료 후 다음

- Sprint 002 후보: 문단 단위 번역 / 페이지 번역 / 우측 번역 패널 / 캐시 / 화이트리스트
- 평행 작업: Phase 1 PoC 4개 항목 (Spike 1 비용 / 차단 / 모델 / refresh) — 별도 spike 브랜치

## 10. 참조

- PRD: `docs/prd/03_mvp_and_scenarios.md` (§7.1 MVP 1)
- PRD: `docs/prd/04_requirements.md` (§9.1~9.6)
- PRD: `docs/prd/05_architecture.md` (§11.1 Privacy Layer)
- PRD: `docs/prd/06_data_model.md` (§12.2 ProviderCredential / §12.3 TranslationRequest / §12.8 UsageLog)
- PRD: `docs/prd/11_dev_tasks_and_ops.md` (§19.1~§19.6)
- 가드레일: `.flowset/guardrails.md`
- 온톨로지: `.flowset/ontology.md`
- Phase 0 종합 보고: `.flowset/specs/phase0-summary.md`

## 변경 이력

- 2026-05-11: Sprint 001 정의 작성 (Phase 1 활성화 PR B)
