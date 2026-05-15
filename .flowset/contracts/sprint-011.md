# Sprint 011 — Phase 1 / summary abort + 탭 UX 추가 보강

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 010 종료 (PR #56~#60 머지)
- [x] 단위 테스트 254/254 PASS
- [x] Sprint 010 종합 evaluator Pass 11 / 0 / 0
- [x] PRD v0.3.8 발행
- [x] commit-check CI 5 PR 모두 success (G-009 NNN 한 분절 4 Sprint 연속)

## 1. Sprint 목표

Sprint 010 evaluator §"Sprint 011 후보 권고" 중 **코드 자동 진행 가능 + 외부 spike 불필요** 묶음.
외부 의존성 (Codex Spike / 사용자 QA / Phase 2 Spike 정량화), capture API 의존(탭 미리보기), 영향도 큰 데이터 모델 변경(탭 그룹)은 모두 Sprint 012+ 이연.

1. **summary abort API** — Sprint 010 §리스크 3 잔여 (cancelOnTabSwitch 시 summary 결과 무시만, abort API 부재)
2. **탭 컬러 라벨** — 사용자 시각 분류 UX (영향도 작음, TabSession 필드 추가만)
3. **탭 핀(고정)** — 우선 좌측 정렬 + closeOthers/closeRight 자동 제외 (영향도 중, 기존 close API 결합)

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S011-T01 | `summarizeAborted` 플래그 + `translate:summarize-abort` IPC + summarizeChunks 콜백에 abort 검사 | `src/main/index.ts`, `src/ai/SummarizationPlanner.ts` |
| S011-T02 | `translate:summary-aborted` 이벤트 발송 (sourceTabId 포함) + preload 확장 | `src/main/index.ts`, `src/preload/index.ts` |
| S011-T03 | tab:switch cancelOnTabSwitch 분기에 `summarizeAborted = true` 추가 + TranslationPanel summary 모드 cancel 버튼 + 가드 | `src/main/index.ts`, `src/renderer/src/translation/TranslationPanel.tsx` |
| S011-T04 | `TabSession.color: string \| null` 필드 + `TabManager.setColor(id, color)` API (palette 검증) | `src/main/TabManager.ts` |
| S011-T05 | `tab:set-color` IPC + preload `tabApi.setColor` + 컨텍스트 메뉴에 "색상 변경" 서브메뉴 (7색 + 없음) | `src/main/index.ts`, `src/preload/index.ts` |
| S011-T06 | TabBar 항목에 컬러 표시 (border-top-color 우선, 활성 강조와 결합) + TabStateStore 영속 (policyVersion=1 호환, color 누락 시 null fallback) | `src/renderer/src/TabBar.tsx`, `src/renderer/src/styles.css`, `src/storage/TabStateStore.ts` |
| S011-T07 | `TabSession.pinned: boolean` 필드 + `TabManager.setPinned(id, pinned)` API — 핀 시 order의 핀 영역(좌측) 끝으로 이동, 핀 해제 시 비핀 영역 끝으로 이동 | `src/main/TabManager.ts` |
| S011-T08 | `tab:set-pinned` IPC + 컨텍스트 메뉴 "핀 고정 / 핀 해제" + closeOthers/closeRight에서 핀 자동 제외 | `src/main/index.ts`, `src/preload/index.ts` |
| S011-T09 | TabBar 핀 시각화 (📌 아이콘 또는 좁은 셀 + 닫기 X 숨김) + 영속 (정렬 정합 + 손상 fallback) | `src/renderer/src/TabBar.tsx`, `src/renderer/src/styles.css`, `src/storage/TabStateStore.ts` |
| S011-T10 | 단위 테스트 — TabManager.setColor / setPinned / closeOthers·closeRight 핀 제외 / TabStateStore color·pinned 라운드트립 / summarizeChunks abort | `tests/unit/main/TabManager.test.ts`, `tests/unit/storage/TabStateStore.test.ts`, `tests/unit/ai/SummarizationPlanner.test.ts` |
| S011-T11 | PRD v0.3.9 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 012+)

- **탭 미리보기 (hover thumbnail)** — WebContentsView capture API 동작 검증 spike 필요 (비활성 view paint 정지 문제)
- **탭 그룹** — 데이터 모델 + UI 영향 큼, 단독 Sprint 권고
- **Codex Login Provider Spike** (Phase 1 PoC 4종) — 외부 의존성
- **사용자 수동 QA 결과 반영** — 사용자 직접 작업
- **Phase 2 진입 (자막/TTS/싱크)** — Spike 2/3/4 PoC 임계 정량화 우선
- **evaluator 보고서 후속 추적 섹션** — `.claude/agents/evaluator.md` 정의 변경, 사용자 합의 후 별도 처리
- **UserSetting Phase 2~4 필드** — Phase 2 진입 시 자연 추가

## 3. 수용 기준

### AC-1 summary abort API (S011-T01 ~ T03)

- `summarizeAborted` 플래그 + `translate:summarize-abort` IPC가 ok:true 반환
- `summarizeChunks(texts, translate, options)`에 `signal` 또는 `abortCheck` 매개변수 추가, 각 청크 처리 전 검사 → aborted면 즉시 throw (혹은 sentinel) → main이 `translate:summary-aborted` 이벤트 발송 후 done 미발송
- summary-aborted 페이로드 = `{ chunks: number, sourceTabId: string | null }`
- `cancelOnTabSwitch=true` + 실제 탭 전환 시 `summarizeAborted = true` 자동 set
- TranslationPanel summary 모드에 "취소" 버튼 (summary.status === 'loading'일 때만)
- summary-aborted 이벤트 수신 시 sourceTabId 가드(tabGuard.isCurrentTab) 통과한 경우만 UI state 변경 (status='idle' + 메시지)

### AC-2 탭 컬러 라벨 (S011-T04 ~ T06)

- `TabSession.color: string | null` 필드 추가 (기본 null)
- `TabManager.setColor(id, color)` — palette ['red','orange','yellow','green','blue','purple','gray',null] 외 값 거부 (false 반환), 같은 색이면 no-op (true, emit skip), 존재하지 않는 id false
- `tab:set-color` IPC 보낸 후 영속 자동 (subscribe debounced 200ms)
- 컨텍스트 메뉴 "색상 변경 →" 서브메뉴에 7색 + "없음" 항목, 현재 색은 checked 표시
- TabBar 항목 border-top 색상이 활성/색상 결합 (활성=#4a9eff, 비활성+color=color, 비활성+null=transparent, 활성+color=color로 강조)
- TabStateStore 영속 — 기존 파일에 color 없으면 null로 로드 (policyVersion=1 호환)
- restore 시 color 보존

### AC-3 탭 핀(고정) (S011-T07 ~ T09)

- `TabSession.pinned: boolean` 필드 (기본 false)
- `TabManager.setPinned(id, pinned)` — 핀 시 order에서 제거 후 핀 영역 끝(첫 비핀 탭 직전)에 삽입. 핀 해제 시 order에서 제거 후 마지막에 삽입. 활성/메타 보존
- `tab:set-pinned` IPC, 컨텍스트 메뉴 "핀 고정" ↔ "핀 해제" 토글
- `TabManager.closeOthers(keepId)` — 핀 탭은 자동 보존 (closed에서 제외). keepId 자체도 보존 (이중 보장)
- `TabManager.closeRight(fromId)` — 핀 탭이 fromId 오른쪽에 있을 수 없음(핀은 좌측). 만약 fromId가 비핀이면 핀 탭은 오른쪽에 안 옴 → 기존 로직 그대로
- TabBar 핀 탭: 폭 줄이고 (예: min-width 40px, max-width 60px), 닫기 X 미표시, 📌 또는 별도 아이콘 표시
- TabStateStore 영속 (pinned 필드)
- restore 시 pinned 보존 + order 정합 (핀 탭이 좌측에 배치되도록)

### AC-4 단위 테스트 (S011-T10)

- TabManager.setColor 5 케이스 (palette 정상 / palette 외 거부 / null 허용 / 같은 색 no-op / 존재 X)
- TabManager.setPinned 5 케이스 (핀 → 좌측 끝 이동 / 핀 해제 → 비핀 끝 / 다중 핀 사이 순서 / 마지막 비핀 / 존재 X)
- TabManager.closeOthers 핀 제외 1 케이스
- TabManager.closeRight 핀 제외 1 케이스
- TabStateStore color/pinned 라운드트립 + 기존 파일 fallback 2 케이스
- summarizeChunks abort 2 케이스 (시작 직후 abort / 중간 abort)
- **누적 단위 테스트 ≥ 270** (Sprint 010 254 + 16)

### AC-5 통과 기준

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T03 summary abort + 단위 테스트 일부 | 1~2일 |
| M2 | T04~T06 탭 컬러 라벨 + 단위 테스트 일부 | 1~2일 |
| M3 | T07~T09 탭 핀 + 단위 테스트 일부 | 1~2일 |
| M4 | T11 PRD v0.3.9 + Sprint 종합 (T10 잔여는 M1~M3에 분산) | 1일 |

총 4~7일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 탭 / §9.2 요약 / §12.1)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S011-docs ...` / `WI-S011M1-feat ...` / `WI-S011M2-feat ...` / `WI-S011M3-feat ...` / `WI-S011M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

Sprint 010 §6 핫픽스 예외 정책 유지 (본 Sprint 4 M은 일반 마일스톤 규모).

## 7. 리스크 / 미지수

1. **summarizeChunks abort 인터페이스** — 기존 시그니처 `summarizeChunks(texts, translate, options)`에 `abortCheck: () => boolean` 콜백 추가. throw 시 main에서 aborted 이벤트 발송. (signal 객체 대안도 가능하나 외부 의존 없는 쪽 선택.)
2. **TabStateStore policyVersion** — color/pinned 필드 추가 시 기존 파일은 누락. policyVersion=1 유지 + 누락 시 default(null/false) fallback. 추후 명시적 마이그레이션 필요 시 policyVersion=2 도입.
3. **핀 영역 / 비핀 영역 order 분리** — `TabManager.order` 단일 배열을 유지하되, 핀 탭이 항상 좌측에 모이도록 setPinned + restore에서 정렬. reorder API도 핀↔비핀 경계 넘기는 이동을 제한 (clamp 또는 거부, 결정: clamp).
4. **컨텍스트 메뉴 색상 / 핀 동시 표시** — Sprint 010 M2 4 항목 + 색상 서브메뉴 + 핀 토글 = 6 항목. UI 복잡도 허용 범위.
5. **summary-aborted UX** — 사용자가 명시적 cancel 클릭과 cancelOnTabSwitch 자동 abort를 같은 이벤트로 처리. 페이로드에 trigger 필드 추가 검토했으나 단순성 우선 (sourceTabId 가드만으로 충분).

## 8. Sprint 종료 후 다음 (Sprint 012 후보)

1. **탭 미리보기 (hover thumbnail)** — capture API 동작 검증 spike + 구현
2. **탭 그룹** — 단독 Sprint (데이터 모델 + UI 영향 큼)
3. **Codex Login Provider Spike** (Phase 1 PoC 4종) — 환경 준비 + 사용자 협의 후
4. **사용자 수동 QA 결과 반영** — 사용자 작업 진행 후
5. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화
6. evaluator 보고서 후속 추적 섹션 (`.claude/agents/evaluator.md` 정의 변경, 사용자 합의 후)

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭) / §9.2 (요약 abort)
- PRD: `docs/prd/06_data_model.md` §12.1 UserSetting / §11 TabManager
- Sprint 010 종합: `.flowset/eval-results/sprint-010-2026-05-15.md` §"Sprint 011 후보 권고"
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 011 정의 작성 (summary abort + 탭 UX 추가 보강)
