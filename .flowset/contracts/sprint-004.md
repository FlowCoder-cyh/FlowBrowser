# Sprint 004 — Phase 1 / 쉬운 설명 + 요약 + IPC 정리

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP 확장)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 003 종료 (PR #20~#24 머지)
- [x] 단위 테스트 115/115 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] Sprint 003 종합 evaluator Pass 17 / 0 / 0
- [x] PRD v0.3.1 발행 (Sprint 002/003 실측 반영)

## 1. Sprint 목표

Sprint 003 evaluator 후속 (IPC 정리) + Phase 1 MVP P1 잔여 기능 (쉬운 설명 + 요약).

1. **IPC 채널 정리** (M2 evaluator Partial 해소) — `translate:page-aborted` / `translate:page-error` 별도 이벤트 분리
2. **paragraph abort 일관성** — 문단 번역에도 abort IPC 추가
3. **쉬운 설명** (PRD §9.2 P1) — 선택 영역을 쉬운 한국어로 풀어 설명
4. **요약** (PRD §9.2 P1) — 선택 영역 또는 페이지 요약

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S004-T01 | `translate:page-aborted` / `translate:page-error` 이벤트 분리 | `src/main/index.ts`, `src/preload/index.ts`, `TranslationPanel.tsx` |
| S004-T02 | `translate:paragraphs-abort` IPC + abort 흐름 | `src/main/index.ts` paragraphs 핸들러에 abort flag 추가 |
| S004-T03 | requestType 'explanation' 추가 + system prompt 분기 | `src/ai/types.ts`, `src/ai/providers/OpenAIApiKeyProvider.ts` |
| S004-T04 | `ai:explain` IPC + 결과 popup | `src/main/services.ts` (executeExplainRequest), `src/main/index.ts` (컨텍스트 메뉴), preload |
| S004-T05 | TranslationPopup에 "쉽게 설명" 토글 / 메뉴 | `src/renderer/src/translation/TranslationPopup.tsx`, 컨텍스트 메뉴 항목 추가 |
| S004-T06 | requestType 'summary' 추가 + system prompt 분기 | `src/ai/types.ts`, `OpenAIApiKeyProvider.ts` |
| S004-T07 | `ai:summarize-selection` / `ai:summarize-page` IPC | services.ts + main/index.ts |
| S004-T08 | 요약 결과 표시 — TranslationPanel 요약 모드 또는 별도 영역 | TranslationPanel 확장 |
| S004-T09 | UsageLog feature 'summary' / 'explanation' 분류 | services.ts, UsagePanel 표시 |
| S004-T10 | 단위 테스트 (system prompt 분기 / abort 흐름 / requestType 매트릭스) | tests/unit/ai/SystemPrompt.test.ts 등 |
| S004-T11 | PRD v0.3.2 패치 + Sprint 종합 evaluator + handoff | `docs/prd/04_requirements.md`, change history, state |

### 제외 (Sprint 005+)

- 용어집 (PRD §9.2 P2)
- Codex Login Provider Spike (별도 spike 브랜치)
- 자막 / TTS / 싱크 (Phase 2~4)
- 도메인 정책 가져오기 자동 동기화

## 3. 수용 기준

### AC-1 IPC 채널 분리 (S004-T01)
- `translate:page-aborted` 이벤트가 abort 시 별도 송신 (`stoppedReason='aborted'`)
- `translate:page-error` 이벤트가 페이지 전체 실패 (예: 노드 없음, browser 미준비) 시 송신
- 기존 `translate:page-done`는 정상 완료 시점만 송신
- TranslationPanel이 3종 모두 처리 (UI 분기)

### AC-2 paragraph abort (S004-T02)
- `translate:paragraphs-abort` IPC가 호출되면 현재 청크 완료 후 정지
- `translate:paragraphs-done` 페이로드에 `stoppedReason: 'aborted' | 'page_wide_block' | null` 필드 추가
- TranslationPanel 문단 모드에서도 취소 버튼 노출

### AC-3 쉬운 설명 (S004-T03 ~ T05)
- requestType `'explanation'` 추가 (TranslationInput.requestType 유니언)
- OpenAIApiKeyProvider system prompt: 쉬운 설명 모드 (한국어로 풀어 설명, 어려운 용어 풀어쓰기)
- `ai:explain` IPC — 선택 영역 텍스트 입력, 한국어 설명 출력
- 컨텍스트 메뉴 "쉽게 설명" 항목 추가 (번역 항목 옆)
- TranslationPopup에서 결과 표시 (선택 영역 번역과 동일 popup, mode='explanation' 표기)
- Privacy 1회 평가 통과 필수 (G-004 정합)
- UsageLog `feature='explanation'`으로 기록

### AC-4 요약 (S004-T06 ~ T08)
- requestType `'summary'` 추가
- OpenAIApiKeyProvider system prompt: 요약 모드 (3~5문장 한국어 요약)
- `ai:summarize-selection` IPC — 선택 영역 요약
- `ai:summarize-page` IPC — 페이지 전체 텍스트 (PageNodeExtractor 결과) 요약, 청크 크면 분할 요약 후 통합 요약
- TranslationPanel 요약 모드 또는 별도 영역에 결과 표시
- UsageLog `feature='summary'` 기록
- 페이지 요약은 Privacy 평가 + pageWideBlock 즉시 차단

### AC-5 UsageLog 분류 (S004-T09)
- UsagePanel에서 feature별 카운트가 translation / summary / explanation / tts / stt 5종 표시
- 합계 + Provider별 별도 표시 유지

### AC-6 단위 테스트 (S004-T10)
- system prompt 분기 검증 (translation / explanation / summary / subtitle / tts_script 5종)
- paragraph abort flag 동작 검증
- 요약 청크 분할 → 통합 흐름 검증 (mock provider)
- 누적 단위 테스트 ≥ 135 (Sprint 003 115 + 20 이상)

### AC-7 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8 (사용자 지시 유지)
- 자동 검증 lint / typecheck / test / build 모두 PASS

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 page 이벤트 분리 + T02 paragraph abort | 2~3일 |
| M2 | T03 explanation + T04 IPC + T05 Popup 통합 | 3~5일 |
| M3 | T06 summary + T07 IPC 2종 + T08 패널 표시 + T09 UsageLog | 4~6일 |
| M4 | T10 단위 테스트 + T11 PRD v0.3.2 + Sprint 종합 | 2~3일 |

총 11~17일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.2 explanation/summary P1)
- G-004 Privacy Filter — explanation/summary 모두 evaluatePrivacy 게이트 통과 필수
- G-006 추측 금지 — 단위 테스트 + 실측
- G-007 main 직접 push 금지
- G-009 커밋 형식 `WI-S004-Mn-feat ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M의 evaluator 호출 시 Pass 카운트 ≥ 8 이어야 머지 진행.**

## 7. 리스크 / 미지수

1. **요약 청크 분할 → 통합 시 길이 폭주**: 1단계 청크 요약 N개 → 2단계 통합 요약 1개. 통합 청크가 다시 4000자 초과하면 단순 truncate. 일관성보다 안정성 우선.
2. **explanation 결과 길이**: 원문보다 길어질 수 있음. Popup 크기 / 스크롤 처리 필요.
3. **컨텍스트 메뉴 다중 항목**: 번역 / 쉽게 설명 두 항목 동시 노출 시 UX 검토.
4. **IPC 이벤트 분리로 인한 deprecated 채널**: `translate:page-done`의 stoppedReason 필드는 유지 (호환), 새 이벤트는 추가 (병행).

## 8. Sprint 종료 후 다음 (Sprint 005 후보)

1. 용어집 (PRD §9.2 P2) + glossaryVersion 캐시 invalidation 실측 활용
2. Codex Login Provider Spike (Phase 1 PoC 4종)
3. 사용자 수동 QA 결과 반영
4. Phase 2 진입 (자막 / TTS / 싱크) — Spike 2/3/4 PoC 임계 정량화 우선

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.2 / §9.6
- PRD: `docs/prd/06_data_model.md` §12.3 (TranslationRequest.requestType)
- Sprint 003 종합: `.flowset/eval-results/sprint-003-2026-05-15.md`
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 004 정의 작성
