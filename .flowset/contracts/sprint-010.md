# Sprint 010 — Phase 1 / 탭 UX 보강 + 잔여 P2 보강

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 009 종료 (PR #50~#55 머지)
- [x] 단위 테스트 229/229 PASS
- [x] Sprint 009 종합 evaluator Pass 11 / 0 / 0
- [x] PRD v0.3.7 발행
- [x] commit-check CI 4개 PR 모두 success (G-009 NNN 한 분절)

## 1. Sprint 목표

Sprint 009 evaluator §"Sprint 010 후보 권고" 중 **코드 자동 진행 가능한 묶음**.
외부 의존성(API 키 / OS 권한 / 사용자 직접 작업)이 있는 P0-1 Codex Spike / P0-2 사용자 QA / P1 Phase 2 Spike 정량화는 **Sprint 011+로 이연** (사용자 협의 후 환경 준비 단계 별도 처리).

1. **탭 UX 보강 1** — 탭 드래그/순서 변경 (P1)
2. **탭 UX 보강 2** — 탭 컨텍스트 메뉴 (닫기 옵션 + 복제) (P1)
3. **잔여 P2 보강** — cancel-on-switch UX 옵션 + `isCurrentTab` 순수 함수 추출 (S009 잔여)

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S010-T01 | `TabManager.reorder(tabId, newIndex)` 신규 API (활성/메타 보존, 경계값 clamp, no-op 시 emit skip) | `src/main/TabManager.ts` |
| S010-T02 | `tab:reorder` IPC + preload `tabApi.reorder` | `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` |
| S010-T03 | TabBar HTML5 DnD (`draggable` / `onDragStart` / `onDragOver` / `onDrop` / dragIndex 시각화) | `src/renderer/src/TabBar.tsx`, `src/renderer/src/styles.css` |
| S010-T04 | `TabManager.closeOthers(keepId)` + `TabManager.closeRight(fromId)` + `TabManager.duplicate(id)` 신규 API | `src/main/TabManager.ts` |
| S010-T05 | `tab:close-others` / `tab:close-right` / `tab:duplicate` IPC + preload 확장 | `src/main/index.ts`, `src/preload/index.ts` + `.d.ts` |
| S010-T06 | TabBar 우클릭 시 mainWindow context menu popup (4종 항목 + 활성 탭 제외 가능 분기) | TabBar.tsx + main/index.ts (`tab:show-context-menu`) |
| S010-T07 | `UserSettingState.cancelOnTabSwitch: boolean` 필드 추가 (기본 `false`) + load/update 검증 | `src/storage/UserSettingStore.ts` |
| S010-T08 | `isCurrentTab` 순수 함수 추출 (`src/renderer/src/translation/tabGuard.ts`) + TranslationPanel 사용 전환 | `src/renderer/src/translation/tabGuard.ts`, TranslationPanel.tsx |
| S010-T09 | cancel-on-switch 동작 — switch 시 cancelOnTabSwitch=true이면 진행 중 paragraphs/page abort + summary in-flight 무시 처리 | `src/main/index.ts` (switch handler 확장) |
| S010-T10 | General Panel UI에 `cancelOnTabSwitch` 토글 추가 | `src/renderer/src/settings/GeneralPanel.tsx` |
| S010-T11 | 단위 테스트 — TabManager.reorder / closeOthers / closeRight / duplicate / cancelOnTabSwitch 로드 + tabGuard.isCurrentTab | `tests/unit/main/TabManager.test.ts`, `tests/unit/storage/UserSettingStore.test.ts`, `tests/unit/renderer/tabGuard.test.ts` |
| S010-T12 | PRD v0.3.8 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 011+)

- **Codex Login Provider Spike** (Phase 1 PoC 4종 — 비용/차단/모델/refresh) — OpenAI API 키 + Codex Login 사용자 협의 + 환경 준비 필요
- **사용자 수동 QA 결과 반영** — 사용자 직접 작업 의존
- **Phase 2 진입 (자막/TTS/싱크)** — Spike 2/3/4 PoC 임계 정량화 우선
- **탭 미리보기 (hover thumbnail)** — WebContentsView capture API 의존, 별도 spike 필요
- **탭 그룹 / 컬러** — 데이터 모델 + UI 영향 큼, 단독 Sprint
- **evaluator 보고서 후속 추적 섹션** — `.claude/agents/evaluator.md` 정의 변경, 사용자 합의 후 별도 처리

## 3. 수용 기준

### AC-1 탭 드래그/순서 변경 (S010-T01 ~ T03)

- `TabManager.reorder(tabId, newIndex)` — 존재하지 않는 id면 false, 같은 위치면 no-op (emit skip), newIndex가 음수면 0, length 초과면 length-1로 clamp
- 순서 변경 후 활성 탭 / 메타데이터(url/title/timestamps) 보존
- `tab:reorder` IPC가 boolean 반환
- TabBar 항목이 HTML5 DnD로 드래그 가능, drop 시 `tabApi.reorder` 호출
- 드래그 중 시각화 (dragging / drop-target 클래스)
- close 버튼 클릭은 드래그 영향 없음 (`onDragStart` stopPropagation 또는 close 버튼 draggable=false)

### AC-2 탭 컨텍스트 메뉴 (S010-T04 ~ T06)

- `TabManager.closeOthers(keepId)` — keepId 외 모든 탭 close, keepId가 활성 탭이 되며 빈 탭 자동 open 시나리오 발동 안 함 (keepId 존재 보장)
- `TabManager.closeRight(fromId)` — fromId 오른쪽(order index >) 탭들만 close, fromId 활성 유지
- `TabManager.duplicate(id)` — 동일 url로 새 탭 생성 후 그 탭 활성화
- TabBar 우클릭 시 main process popup menu (4종: 탭 닫기 / 다른 탭 닫기 / 오른쪽 탭 모두 닫기 / 탭 복제)
- 탭이 1개일 때 "다른 탭 닫기" / "오른쪽 탭 닫기"는 disabled (활성/비활성 표시)
- 가장 오른쪽 탭일 때 "오른쪽 탭 닫기"는 disabled

### AC-3 cancel-on-switch + isCurrentTab 추출 (S010-T07 ~ T10)

- `UserSettingState.cancelOnTabSwitch: boolean` 필드 추가, 기본 `false` (기존 사용자 호환)
- `cancelOnTabSwitch=true` + 진행 중 paragraphs/page 작업 존재 + tab:switch 발생 → 자동으로 `paragraphsAborted` / `pageTranslateAborted` 플래그 set + aborted 이벤트 정상 발송
- `cancelOnTabSwitch=false` (기본) → 백그라운드 계속, sourceTabId 가드(S009 M2)가 UI 차단
- summary in-flight도 cancel-on-switch=true 시 결과 무시 정책 (sourceTabId 가드로 이미 보장됨, 추가 abort 불필요 — abort API 없으므로 별도 변경 없음, 단 PRD에 명시)
- `isCurrentTab(activeTabId, sourceTabId)` 순수 함수 — `tabGuard.ts`에 추출, sourceTabId가 null/undefined면 true (하위 호환), 두 값이 일치하면 true, 그 외 false
- TranslationPanel이 inline 로직 대신 `isCurrentTab` import 사용
- GeneralPanel에 "탭 전환 시 진행 작업 자동 취소" 토글 (`cancelOnTabSwitch`)

### AC-4 단위 테스트 (S010-T11)

- `TabManager.reorder` 6 케이스 (정상 이동 / 같은 위치 no-op / 음수 clamp / 초과 clamp / 존재하지 않는 id / 활성 탭 보존)
- `TabManager.closeOthers` 3 케이스 (기본 / keepId 없음 / 단일 탭)
- `TabManager.closeRight` 3 케이스 (오른쪽 다수 close / 가장 오른쪽 fromId / 존재하지 않는 fromId)
- `TabManager.duplicate` 3 케이스 (url 복제 / 활성 탭 전환 / 빈 url about:blank)
- `UserSettingStore` cancelOnTabSwitch load default / update / invalid 3 케이스
- `tabGuard.isCurrentTab` 4 케이스 (일치 / 불일치 / null sourceTabId / null activeTabId)
- **누적 단위 테스트 ≥ 250** (Sprint 009 229 + 21)

### AC-5 통과 기준

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T03 탭 드래그/순서 변경 + 단위 테스트 일부 | 1~2일 |
| M2 | T04~T06 탭 컨텍스트 메뉴 + 단위 테스트 일부 | 1~2일 |
| M3 | T07~T10 cancel-on-switch + isCurrentTab 추출 + 단위 테스트 일부 | 1~2일 |
| M4 | T12 PRD v0.3.8 + Sprint 종합 (T11 잔여 단위 테스트는 M1~M3에 분산) | 1일 |

총 4~7일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 탭 P2 / §12.1 UserSetting)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S010-docs ...` / `WI-S010M1-feat ...` / `WI-S010M2-feat ...` / `WI-S010M3-feat ...` / `WI-S010M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

**핫픽스 마일스톤 예외 명시** (Sprint 009 retrospective §1 권고 반영): M이 1줄 fix + 회귀 테스트 N건 규모의 핫픽스라 채점 단위 자연 부족할 경우 evaluator 호출 생략 가능. 단 회귀 회피 10회 반복 PASS 직접 검증을 종합 evaluator 입력으로 기록. Sprint 010 4개 M은 모두 일반 마일스톤 규모라 본 예외 비적용.

## 7. 리스크 / 미지수

1. **HTML5 DnD on Electron** — Electron renderer는 기본 HTML5 DnD 지원. 단 WebContentsView 위 드래그는 영역 분리(TabBar는 main BrowserWindow 영역, view는 별도)로 비충돌. 별도 검증 없이 진행 가능.
2. **mainWindow.popup() vs renderer 자체 메뉴** — `Menu.buildFromTemplate` + `menu.popup({ window })` 권장. 컨텍스트 메뉴는 mainWindow에 popup하므로 renderer가 좌표만 보내고 main이 메뉴 표시. 이 방식이 OS 네이티브 룩 + 키보드 접근성 일관성.
3. **cancel-on-switch + summary** — summary는 abort API 없음 (Sprint 004 M3). cancelOnTabSwitch=true라도 summary in-flight는 sourceTabId 가드로만 UI 차단. PRD §9.2에 한계 명시 + Sprint 011+ summary abort 후보로 등록.
4. **duplicate 시 URL 미로드 케이스** — 원본 탭이 about:blank이면 새 탭도 about:blank. 정상 URL이면 loadURL 시도. 로드 실패는 사용자가 재입력 가능 (기존 createTabView와 동일 동작).
5. **closeOthers 시 빈 탭 자동 open 회피** — TabManager.close 시 마지막 탭이 사라지면 main/index.ts에서 빈 탭 자동 open하는 패턴(Sprint 008 M3). closeOthers는 keepId가 1개 남으므로 자동 open 발동 안 함.

## 8. Sprint 종료 후 다음 (Sprint 011 후보)

1. **Codex Login Provider Spike** (Phase 1 PoC 4종 — 환경 준비 + 사용자 협의 후)
2. **사용자 수동 QA 결과 반영** (사용자 작업 진행 후)
3. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화
4. 탭 미리보기 (hover thumbnail) — WebContentsView capture API
5. 탭 그룹 / 컬러
6. summary abort API
7. evaluator 보고서 후속 추적 섹션

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭) / §12.1 UserSetting (탭 UX 확장)
- PRD: `docs/prd/06_data_model.md` §12.1 UserSetting / §11 TabManager
- Sprint 009 종합: `.flowset/eval-results/sprint-009-2026-05-15.md` §"Sprint 010 후보 권고"
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 010 정의 작성 (탭 UX 보강 + S009 잔여 P2 묶음)
