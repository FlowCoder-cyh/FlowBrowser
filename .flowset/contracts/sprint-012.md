# Sprint 012 — Phase 1 / 탭 미리보기 + 키보드 단축키

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 011 종료 (PR #61~#65 머지)
- [x] 단위 테스트 273/273 PASS
- [x] Sprint 011 종합 evaluator Pass 11 / 0 / 0
- [x] PRD v0.3.9 발행
- [x] commit-check CI 5 PR 모두 success (G-009 NNN 한 분절 5 Sprint 연속)

## 1. Sprint 목표

Sprint 011 evaluator §"Sprint 012 후보 권고" 중 **코드 자동 진행 가능 + capture API 우회 가능** 묶음.

1. **탭 미리보기 (hover thumbnail)** — capture API spike 권고를 "활성 탭 전환 시 캡처 → ThumbnailStore 저장 → hover 시 표시" 패턴으로 우회
2. **키보드 단축키** — 표준 Electron Menu accelerator (영향도 작음)

탭 그룹은 단독 Sprint 권고 유지 → Sprint 013+. 외부 의존성 (Codex / QA / Phase 2) 모두 Sprint 013+.

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S012-T01 | `ThumbnailStore` 신규 — Map<tabId, { dataUrl: string; capturedAt: number; width: number; height: number }>, LRU 최대 N개 (예: 50), remove(tabId) | `src/main/ThumbnailStore.ts` |
| S012-T02 | `captureActiveTabThumbnail()` — setActiveTabView 호출 전 (즉 활성 변경 직전) 현재 active view를 `webContents.capturePage()` 호출 후 NativeImage.toDataURL → ThumbnailStore 저장 | `src/main/index.ts` |
| S012-T03 | `tab:get-thumbnail` IPC — tabId → dataUrl 또는 null + preload `tabApi.getThumbnail` | `src/main/index.ts`, `src/preload/index.ts` |
| S012-T04 | 탭 close 시 ThumbnailStore에서 자동 remove + mainWindow close 시 clearAll | `src/main/index.ts` |
| S012-T05 | TabBar 항목 onMouseEnter 600ms 지연 + onMouseLeave 즉시 취소 + 미리보기 div 절대 위치 (탭 셀 아래) | `src/renderer/src/TabBar.tsx` |
| S012-T06 | 미리보기 div — dataUrl 있으면 img 표시, 없으면 placeholder ("미리보기 없음") + 트랜지션 (opacity fade-in 150ms) + URL/title 텍스트 | `src/renderer/src/TabBar.tsx`, `src/renderer/src/styles.css` |
| S012-T07 | `KeyboardShortcuts` (Application Menu accelerator 등록) — Ctrl+T 신규 / Ctrl+W 활성 탭 닫기 / Ctrl+Tab 다음 탭 / Ctrl+Shift+Tab 이전 탭 | `src/main/index.ts` |
| S012-T08 | 단축키 동작 main process 함수 — `cycleTab(direction: 'next'\|'prev')` + `closeActiveTab()` + `openNewTab()` (기존 IPC 핸들러 재사용 가능) | `src/main/index.ts` |
| S012-T09 | 단위 테스트 — ThumbnailStore (set/get/lru/remove/clear 5) / TabManager `cycleActiveTabId(direction)` 순수 함수 추출 + 테스트 / Sprint 008/009/010/011 fixture에 영향 없도록 보강 | `src/main/ThumbnailStore.ts` 단위 테스트 + `src/main/TabManager.ts` cycleActiveTabId 추가 |
| S012-T10 | PRD v0.3.10 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 013+)

- **탭 그룹** — 데이터 모델 + UI + 영속 + closeOthers/Right 범위 큼, 단독 Sprint 권고 유지
- **Codex Login Provider Spike** — OpenAI API 키 + 사용자 협의
- **사용자 수동 QA 결과 반영** — 사용자 직접 작업
- **Phase 2 진입** — Spike 2/3/4 PoC 임계 정량화 우선
- **evaluator 보고서 후속 추적 섹션** — `.claude/agents/evaluator.md` 정의 변경, 사용자 합의
- **UserSetting Phase 2~4 필드** — Phase 2 진입 시 자연 추가
- **닫은 탭 복원 (closed history)** — 별도 모델 필요, Sprint 013+

## 3. 수용 기준

### AC-1 ThumbnailStore + capture hook (S012-T01 ~ T04)

- `ThumbnailStore.set(tabId, payload)` / `get(tabId)` / `remove(tabId)` / `clear()` 4 메서드
- LRU 최대 50개, 초과 시 가장 오래된 항목 제거 (set 시점 기준 last-touched 갱신)
- 활성 탭 변경 직전 `captureActiveTabThumbnail()` 호출 (직전 active view를 ThumbnailStore에 저장)
  - capture 실패는 silent (로그만), ThumbnailStore 변경 없음
- `tab:close` IPC 핸들러에서 destroyTabView 후 ThumbnailStore.remove(id) 호출
- `mainWindow.on('closed')`에서 ThumbnailStore.clear() 호출

### AC-2 TabBar hover 미리보기 UI (S012-T05 ~ T06)

- 탭 항목 `onMouseEnter` → setTimeout 600ms 후 hoverTabId state set + `tab:get-thumbnail` 호출 → dataUrl state 보관
- 탭 항목 `onMouseLeave` → clearTimeout + hoverTabId null
- hoverTabId가 set되면 미리보기 div 렌더 (`position: absolute`, 탭 바로 아래)
- dataUrl 있으면 `<img src={dataUrl}>` + URL + title 표시, 없으면 "미리보기 없음" placeholder
- 트랜지션: opacity 0 → 1 (150ms ease-out)
- 드래그 중에는 미리보기 표시 안 함 (draggingId set 시 hover 시작 무시)

### AC-3 키보드 단축키 (S012-T07 ~ T08)

- Electron Menu가 mainWindow에 적용되어 accelerator 작동
  - Ctrl+T → 신규 탭 (about:blank)
  - Ctrl+W → 활성 탭 닫기 (마지막 탭이면 새 빈 탭 자동 생성 패턴 유지)
  - Ctrl+Tab → 다음 탭 (마지막이면 첫 탭으로 wrap)
  - Ctrl+Shift+Tab → 이전 탭 (첫 탭이면 마지막으로 wrap)
- `TabManager.cycleActiveTabId(direction: 'next' | 'prev'): string | null` 순수 함수 — 현재 active id + order로 다음/이전 id 반환, null이면 변경 없음
- 키보드 단축키 활성화는 mainWindow focus 시점부터 (전역 단축키 아님)

### AC-4 단위 테스트 (S012-T09)

- ThumbnailStore 5 케이스 (set/get / 갱신 / lru 한계 / remove / clear)
- TabManager.cycleActiveTabId 5 케이스 (next / prev / 마지막에서 next wrap / 첫에서 prev wrap / 단일 탭 / 활성 null 시 null)
- **누적 단위 테스트 ≥ 285** (Sprint 011 273 + 10)

### AC-5 통과 기준

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 6 Sprint 연속)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T04 ThumbnailStore + capture hook + 단위 테스트 일부 | 1~2일 |
| M2 | T05~T06 hover 미리보기 UI | 1~2일 |
| M3 | T07~T08 키보드 단축키 + cycleActiveTabId 추출 + 단위 테스트 일부 | 1일 |
| M4 | T10 PRD v0.3.10 + Sprint 종합 | 1일 |

총 4~6일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 탭 / §11 TabManager 확장)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S012-docs ...` / `WI-S012M1-feat ...` / `WI-S012M2-feat ...` / `WI-S012M3-feat ...` / `WI-S012M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **capturePage 비동기** — `webContents.capturePage()`는 Promise<NativeImage> 반환. setActiveTabView 호출 직전 호출하면 이전 view가 mainWindow에 add된 상태라 paint 정상. await 결과를 ThumbnailStore에 저장. await 실패는 silent.
2. **NativeImage 크기** — capturePage()는 전체 view 크기 (대형). LRU 50개 × ~수백 KB = 수십 MB 메모리. 압축 또는 resize 검토 필요. 1차 안전책: `nativeImage.resize({ width: 300 })` 후 dataURL → 메모리 절감.
3. **첫 탭 미리보기** — 앱 시작 시 active 탭은 아직 캡처 안 됨. hover 시 placeholder. 사용자가 한 번이라도 탭 전환하면 캡처 시작. 새 탭(open 후 비활성화 안 됨)도 placeholder.
4. **단축키 충돌** — Ctrl+Tab은 일부 OS/WM에서 시스템 단축키. mainWindow 영역에서만 동작 + WebContentsView 내부 페이지는 영향 받지 않음 (focus가 view에 있을 때도 Electron Menu accelerator 작동).
5. **cycleActiveTabId 핀↔비핀** — 별도 분리 없이 단순 order 기준 순환. 사용자 기대 부합.
6. **테스트 환경 capture 모킹** — capturePage는 실 Electron 환경 필요. 단위 테스트는 ThumbnailStore 자체와 cycleActiveTabId만 검증. capture 통합은 PR 머지 후 사용자 수동 확인.

## 8. Sprint 종료 후 다음 (Sprint 013 후보)

1. **탭 그룹** — 단독 Sprint (TabGroup 모델 + groupId + collapse + 컨텍스트 메뉴 + 영속)
2. **닫은 탭 복원** (Ctrl+Shift+T) — closed history 모델
3. **Codex Login Provider Spike** — 외부 의존성
4. **사용자 수동 QA 결과 반영** — 사용자 작업
5. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화
6. ThumbnailStore 디스크 영속 (메모리 LRU → 디스크 캐시) — 메모리 안정성

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭) / §11 TabManager
- Electron API: `webContents.capturePage(rect?)` (https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepageoptions)
- Sprint 011 종합: `.flowset/eval-results/sprint-011-2026-05-15.md` §"Sprint 012 후보 권고"
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 012 정의 작성 (탭 미리보기 + 키보드 단축키)
