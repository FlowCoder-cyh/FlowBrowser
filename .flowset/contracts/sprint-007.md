# Sprint 007 — Phase 1 / UserSetting 잔여 + 메타 수치 + 빌드 보강

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP 누적 정리)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주 (작은 정리)

## 0. 사전 조건

- [x] Sprint 006 종료 (PR #35~#39 머지)
- [x] 단위 테스트 192/192 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] Sprint 006 종합 evaluator Pass 8 / 0 / 0
- [x] PRD v0.3.4 발행

## 1. Sprint 목표

PRD §12.1 UserSetting 잔여 + 누적된 evaluator 후속 권고를 묶어 정리. 다중 탭은 Sprint 008 단독으로 분리.

1. **UserSetting 잔여 필드** (PRD §12.1) — `defaultLanguage` / `sourceLanguage` / `defaultProviderId` / `privacyFilterEnabled`
2. **요약 메타 수치 표시** (Sprint 005 M3 evaluator 권고) — 통합 입력 길이 / limit 표시
3. **PageResultStore 통계 패널** (Sprint 006 M3 후속) — Settings에 페이지 캐시 개수 / 삭제 UI
4. **tsconfig 보강** (Sprint 005 M1 evaluator §주의 2) — `tsconfig.node.json` include에 `tests/**` + `src/storage/**` 명시 포함
5. **빌드 chunk 경고 해소** (Sprint 006 M3 evaluator) — `PageResultStore` static + dynamic import 혼용 정리

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S007-T01 | UserSetting 확장 4 필드 | `src/storage/UserSettingStore.ts` 갱신 |
| S007-T02 | Settings UI 일반 설정 패널 (언어 / Provider / Privacy 토글) | `src/renderer/src/settings/GeneralPanel.tsx` |
| S007-T03 | defaultLanguage 적용 — paragraphs/page IPC가 args.targetLanguage 미지정 시 setting 사용 | main/index.ts + TranslationPanel 기본값 |
| S007-T04 | defaultProviderId 적용 — paragraphs/page/summarize-page/explain 흐름 기본 provider 결정 | main + TranslationPanel handler |
| S007-T05 | privacyFilterEnabled 적용 — false 시 evaluatePrivacy bypass (단, password/card 패턴은 항상 적용) | services.ts |
| S007-T06 | sourceLanguage 적용 — TranslationInput 기본값 보강 | main + UI |
| S007-T07 | 요약 메타 통합 입력 길이 표시 | SummarizationPlanner 반환 메타 + TranslationPanel UI |
| S007-T08 | PageResultStore 통계 패널 | `src/renderer/src/settings/PageCachePanel.tsx` |
| S007-T09 | tsconfig.node.json include 확장 + tsconfig.json 루트 (선택) | `tsconfig.node.json` |
| S007-T10 | 빌드 chunk 경고 해소 (PageResultStore 정적 import만 유지) | `src/main/index.ts` / `src/main/services.ts` |
| S007-T11 | 단위 테스트 보강 (UserSettingStore 확장 / SummarizationPlanner 메타) | `tests/unit/storage/UserSettingStore.test.ts` 등 |
| S007-T12 | PRD v0.3.5 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 008+)

- 다중 탭 / BrowserView (PRD §9.1 P2) — 영향도 크므로 단독 Sprint
- Codex Login Provider Spike (별도 spike 브랜치)
- 사용자 수동 QA 결과 반영 (사용자 직접)
- Phase 2 진입 (자막 / TTS / 싱크)
- UserSetting의 Phase 2~4 필드 (subtitleMode / ttsEnabled / syncMode) — 해당 Phase 진입 시 추가

## 3. 수용 기준

### AC-1 UserSetting 확장 (S007-T01)
- `UserSettingState` 인터페이스에 4 필드 추가:
  - `defaultLanguage: string` (기본 'ko')
  - `sourceLanguage: string` (기본 'auto')
  - `defaultProviderId: string` (기본 'openai')
  - `privacyFilterEnabled: boolean` (기본 true)
- 기존 `translationMode` 호환 유지
- 잘못된 값 거부 (예: 빈 문자열 → 기본값 fallback)
- 디스크 로드 시 누락 필드 기본값 적용

### AC-2 Settings 일반 패널 (S007-T02)
- "일반 설정" 섹션 (DisplayModePanel 위)
- 입력 형식: 언어 텍스트 입력 / Provider 드롭다운 / Privacy 토글
- 변경 시 즉시 영속

### AC-3 흐름 적용 (S007-T03 ~ T06)
- TranslationPanel 기본 호출이 setting의 targetLanguage / sourceLanguage / providerType 사용
- privacyFilterEnabled false 시:
  - password/card 패턴 감지는 항상 적용 (안전 정책)
  - domain 블랙리스트 / 일반 차단은 bypass
- 컨텍스트 메뉴 흐름도 동일 setting 활용

### AC-4 요약 메타 수치 (S007-T07)
- `SummarizeResult`에 `combinedInputChars: number` 추가
- TranslationPanel 메타 라인에 "통합 입력 N자 / limit M자" 표시
- combinedPath: truncated일 때 시각적 강조

### AC-5 PageCachePanel (S007-T08)
- Settings에 "페이지 캐시" 섹션
- 현재 저장 개수 표시 (`pageResultApi.stats()`)
- "모두 삭제" 버튼 (confirm)

### AC-6 tsconfig 보강 (S007-T09)
- `tsconfig.node.json` include에 `tests/**/*` + `src/storage/**` 명시
- `npm run typecheck`에서 storage / tests 까지 모두 타입 검사
- 기존 PASS 결과 회귀 (실패 없어야 함)

### AC-7 빌드 경고 해소 (S007-T10)
- vite `(!) /node_modules/.../PageResultStore... static + dynamic` 경고 제거
- main/index.ts의 `await import('../storage/PageResultStore')` → 정적 import + 헬퍼 함수 호출
- chunk 분리 정리

### AC-8 단위 테스트 (S007-T11)
- UserSettingStore 확장 테스트 ≥ 5 (4 필드 + load fallback)
- SummarizationPlanner combinedInputChars 검증 ≥ 2
- 누적 단위 테스트 ≥ 200 (Sprint 006 192 + 8 이상)

### AC-9 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- **commit-check CI 모든 PR PASS** (Sprint 003~006 위반 반복 해소)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T06 UserSetting 잔여 + Settings UI + 흐름 적용 | 3~4일 |
| M2 | T07 요약 메타 수치 + T08 PageCachePanel | 1~2일 |
| M3 | T09 tsconfig + T10 빌드 경고 해소 + T11 단위 테스트 | 1~2일 |
| M4 | T12 PRD v0.3.5 + Sprint 종합 | 1일 |

총 6~9일 (작은 정리 Sprint).

## 5. 가드레일 적용

- G-001 PRD §12.1 정합
- G-004 privacyFilterEnabled false 시에도 password/card 패턴 차단 유지 (안전 정책 무력화 금지)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋 형식**: `WI-S007-docs ...` / `WI-S007M1-feat ...` / `WI-S007M2-feat ...` / `WI-S007M3-chore ...` / `WI-S007M4-docs ...` — NNN 한 분절 엄수 (Sprint 003~006 위반 패턴 재발 금지)
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **privacyFilterEnabled 안전 우회**: 사용자가 false로 설정해도 password/card 본문 패턴은 절대 우회 불가 (G-004 정신). 도메인 블랙리스트만 우회 허용.
2. **defaultLanguage 정합성**: TranslationPanel은 'ko' 하드코딩 → setting 사용으로 전환 시 기존 단위 테스트 영향 없음 (단위 테스트는 services 흐름만 검증).
3. **tsconfig include 확장 후 의존성 누락**: storage 모듈이 main만 사용한다 했지만 tsconfig 포함 후 미사용 import 발견 가능. 발견 시 즉시 정리.

## 8. Sprint 종료 후 다음 (Sprint 008 후보)

1. **다중 탭 / BrowserView** (PRD §9.1 P2) — 단독 Sprint
2. Codex Login Provider Spike (Phase 1 PoC 4종)
3. 사용자 수동 QA 결과 반영
4. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화 우선

## 9. 참조

- PRD: `docs/prd/06_data_model.md` §12.1 UserSetting
- Sprint 005 M1 evaluator §주의 2 (tsconfig 커버리지)
- Sprint 005 M3 evaluator (요약 메타 수치)
- Sprint 006 M3 evaluator (빌드 chunk 경고)
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 007 정의 작성
