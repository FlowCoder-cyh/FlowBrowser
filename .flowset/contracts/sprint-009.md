# Sprint 009 — Phase 1 / 안정화 묶음 (Glossary flaky + sourceTabId + 탭 영속)

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 008 종료 (PR #45~#49 머지)
- [x] 단위 테스트 217/217 PASS (단 GlossaryStore "remove deletes and bumps version" flaky)
- [x] Sprint 008 종합 evaluator Pass 17 / 0 / 0
- [x] PRD v0.3.6 발행

## 1. Sprint 목표

Sprint 008 evaluator A순위 묶음 (안정화 + 탭 영속).

1. **Glossary version flaky 핫픽스** — bumpVersion에 counter 추가
2. **sourceTabId 가드** — paragraphs/page/summarize 진행 중 탭 전환 시 잘못된 patch 방지
3. **탭 영속** — 앱 재시작 후 탭 복원

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S009-T01 | GlossaryStore.bumpVersion에 단조 증가 counter 추가 — 같은 ms 내 mutation 시 항상 다른 version 보장 | `src/storage/GlossaryStore.ts` |
| S009-T02 | flaky 재발 방지 회귀 테스트 (같은 ms 동시 mutation 매트릭스) | `tests/unit/storage/GlossaryStore.test.ts` |
| S009-T03 | paragraphs/page/summarize 시작 시 sourceTabId 캡처 + start/progress/done 이벤트에 sourceTabId 포함 | `src/main/index.ts` + preload |
| S009-T04 | TranslationPanel이 sourceTabId와 현재 활성 탭 비교 — 불일치 시 UI 업데이트 무시 | `src/renderer/src/translation/TranslationPanel.tsx` |
| S009-T05 | restoreHint lookup도 sourceTabId 가드 | TranslationPanel |
| S009-T06 | TabStateStore — TabSession[] + activeId 영속 (`tabs.json`) | `src/storage/TabStateStore.ts` |
| S009-T07 | 시작 시 복원 — initServices 또는 createMainWindow에서 TabStateStore.load + TabManager.restore | main/index.ts |
| S009-T08 | TabManager.restore(state) — 외부 상태 import + emit 1회 | `src/main/TabManager.ts` |
| S009-T09 | TabStateStore 변경 시 영속 — TabManager.subscribe + debounce | main/index.ts |
| S009-T10 | 단위 테스트 — TabStateStore + TabManager.restore | `tests/unit/storage/TabStateStore.test.ts`, TabManager 보강 |
| S009-T11 | PRD v0.3.7 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 010+)

- 탭 드래그/순서 변경 / 미리보기 / 그룹 / 컬러
- Codex Login Provider Spike (별도)
- 사용자 수동 QA 결과 반영
- Phase 2 진입 (자막/TTS/싱크) — Spike 임계 정량화 우선
- 진행 중 작업의 cancel-on-switch (옵션, UX 결정 필요)

## 3. 수용 기준

### AC-1 Glossary flaky 핫픽스 (S009-T01, T02)
- bumpVersion이 같은 ms 내 호출되어도 항상 다른 version 반환
- 기존 단위 테스트 100회 반복 PASS (회귀 회피)
- 같은 ms 매트릭스 회귀 테스트 ≥ 2 추가

### AC-2 sourceTabId 가드 (S009-T03 ~ T05)
- paragraphs/page/summarize 시작 IPC가 진입 시점 활성 탭 ID 캡처
- 모든 진행 이벤트(start/progress/done/aborted/error) 페이로드에 `sourceTabId` 포함
- TranslationPanel이 현재 활성 탭 ID와 비교 → 다르면 row/패널 업데이트 무시
- restoreHint lookup도 sourceTabId 기준

### AC-3 탭 영속 (S009-T06 ~ T09)
- 탭 변동 시 `tabs.json`에 자동 저장 (debounced 200ms)
- 앱 재시작 시 저장된 탭 목록 + activeId 복원
- 복원 후 TabManager.subscribe 즉시 broadcast → TabBar 렌더
- 저장 형식: `{ policyVersion: 1, tabs: TabSession[], activeId: string | null }`
- 손상 파일 fallback → 새 빈 탭 시작

### AC-4 단위 테스트 (S009-T10)
- bumpVersion 회귀 ≥ 2 (M1)
- TabStateStore CRUD + 손상 fallback ≥ 5
- TabManager.restore ≥ 2
- 누적 단위 테스트 ≥ 225 (Sprint 008 217 + 8)

### AC-5 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 Glossary 핫픽스 + T02 회귀 테스트 | 1일 |
| M2 | T03~T05 sourceTabId 가드 | 2~3일 |
| M3 | T06~T09 탭 영속 + T10 단위 테스트 | 3~5일 |
| M4 | T11 PRD v0.3.7 + Sprint 종합 | 1일 |

총 7~10일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 / §12.7)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S009-docs ...` / `WI-S009M1-fix ...` / `WI-S009M2-feat ...` / `WI-S009M3-feat ...` / `WI-S009M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **sourceTabId 추가 시 기존 이벤트 페이로드 호환**: TypeScript optional 필드로 추가 → 기존 listener 무관. UI 분기는 sourceTabId 있을 때만 적용.
2. **TabStateStore 시작 복원 시 view 인스턴스 재생성**: 복원된 TabSession 각각에 createTabView 호출. 단 lastActiveAt이 가장 큰 탭을 activeId로 사용 (저장된 activeId 우선).
3. **debounce 영속 — 빠른 close→open 시점 누락**: 200ms debounce 적정 (UX 부담 없음). 강제 flush는 mainWindow.on('close') 직전 한 번.
4. **진행 중 작업의 자동 abort**: M2 범위 외. 비활성 탭의 작업은 background 계속, UI만 무시. Sprint 010+에서 옵션 결정.

## 8. Sprint 종료 후 다음 (Sprint 010 후보)

1. 탭 UX 보강 (드래그/순서, 미리보기, 그룹)
2. Codex Login Provider Spike (Phase 1 PoC 4종)
3. 사용자 수동 QA 결과 반영
4. Phase 2 진입 (자막/TTS/싱크) — Spike 2/3/4 PoC 임계 정량화 우선
5. cancel-on-switch UX 옵션

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭) / §9.2 (번역)
- PRD: `docs/prd/06_data_model.md` §12.7 (GlossaryTerm)
- Sprint 008 종합: `.flowset/eval-results/sprint-008-2026-05-15.md`
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 009 정의 작성
