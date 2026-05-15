# Sprint 008 — Phase 1 / 다중 탭 (BrowserView)

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 007 종료 (PR #40~#44 머지)
- [x] 단위 테스트 200/200 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] Sprint 007 종합 evaluator Pass 17 / 0 / 0
- [x] PRD v0.3.5 발행
- [x] commit-check CI: Sprint 007 모든 PR success

## 1. Sprint 목표

PRD §9.1 탭 관리 P2 — 다중 탭 / BrowserView. evaluator 권고 A순위 단독 Sprint.

1. **TabManager 코어** — 탭 모델 + 다중 WebContentsView 관리
2. **탭바 UI** — 사용자 가시 탭 전환/추가/닫기
3. **탭별 격리** — paragraphs/page/summarize/restoreHint/Navigation 모두 활성 탭 기준

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S008-T01 | TabSession 모델 + TabManager 클래스 (open/close/switch/list/getActive) | `src/main/TabManager.ts` |
| S008-T02 | 다중 WebContentsView 통합 — 활성 탭만 mainWindow.contentView에 add | main/index.ts |
| S008-T03 | 탭 IPC — tab:open / tab:close / tab:switch / tab:list / tab:active | main/index.ts + preload |
| S008-T04 | tab:list-update broadcast 이벤트 (탭 변동 시) | main/index.ts |
| S008-T05 | TabBar 컴포넌트 (탭 리스트 + 활성 표시 + 닫기 X + 신규 + 버튼) | `src/renderer/src/TabBar.tsx` |
| S008-T06 | URL Bar 활성 탭 동기화 (탭 전환 시 URL 갱신, navigation 시 활성 탭만 broadcast) | UrlBar.tsx + main |
| S008-T07 | 컨텍스트 메뉴 활성 탭의 WebContents에만 등록 | main/index.ts |
| S008-T08 | paragraphs/page/summarize-page/render IPC가 활성 탭 view 사용 | main/index.ts |
| S008-T09 | PageResultStore restoreHint가 활성 탭 URL 기반 | TranslationPanel + main |
| S008-T10 | 단위 테스트 — TabManager 모델 (open/close/switch/list 매트릭스) | `tests/unit/main/TabManager.test.ts` |
| S008-T11 | PRD v0.3.6 패치 + Sprint 종합 evaluator | docs/prd, .flowset/* |

### 제외 (Sprint 009+)

- 탭 영속 (앱 재시작 후 탭 복원)
- 탭 드래그/순서 변경
- 탭 미리보기 / hover preview
- 탭 그룹 / 컬러
- Codex Login Spike / 사용자 수동 QA / Phase 2 진입

## 3. 수용 기준

### AC-1 TabManager 코어 (S008-T01)
- `TabSession` 인터페이스: id / url / title / createdAt / lastActiveAt
- 클래스 메서드: `open(url) → TabSession` / `close(id) → boolean` / `switch(id) → boolean` / `list() → TabSession[]` / `getActive() → TabSession | null` / `updateUrl(id, url)` / `updateTitle(id, title)`
- 마지막 탭 닫으면 활성 탭 null (또는 새 빈 탭 자동 open — 정책 선택)
- 단위 테스트 ≥ 8

### AC-2 다중 WebContentsView (S008-T02 / T03)
- 각 탭당 WebContentsView 인스턴스 1개, 사전 생성
- 활성 탭의 view만 `mainWindow.contentView.addChildView`, 비활성은 remove 또는 가시성 hide
- 탭 close 시 view의 webContents 메모리 해제
- 5종 IPC 정확히 동작 (open/close/switch/list/active)

### AC-3 broadcast (S008-T04)
- `tab:list-update` 이벤트로 탭 목록 + 활성 ID 변경 시 모든 renderer 통지
- TabBar / UrlBar가 이벤트 구독

### AC-4 TabBar UI (S008-T05)
- 가로 스크롤 가능 (탭 다수 시)
- 각 탭: 제목 (또는 URL fallback) + 닫기 X
- 활성 탭 시각적 강조
- 신규 탭 + 버튼

### AC-5 URL Bar 동기화 (S008-T06)
- 탭 전환 시 활성 탭 URL로 input 갱신
- canGoBack/canGoForward는 활성 탭 history 기준
- navigate IPC는 활성 탭 view에 적용

### AC-6 탭별 흐름 라우팅 (S008-T07 / T08 / T09)
- 컨텍스트 메뉴는 각 webContents가 자체 등록 (탭별)
- paragraphs / page / summarize-page / render 모두 활성 탭 view 기준
- PageResultStore restoreHint는 활성 탭 URL 기반 lookup
- Privacy 스캔 + UsageLog 도메인은 활성 탭 URL 도메인

### AC-7 단위 테스트 (S008-T10)
- TabManager 메서드 매트릭스 ≥ 8
- 누적 단위 테스트 ≥ 208 (Sprint 007 200 + 8)

### AC-8 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 엄수)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 TabManager 코어 + T02 다중 view 골격 + T03 IPC 5종 + T04 broadcast + T10 단위 테스트 (코어) | 3~5일 |
| M2 | T05 TabBar UI + T06 URL Bar 동기화 + T07 컨텍스트 메뉴 탭별 | 3~5일 |
| M3 | T08 paragraphs/page/summarize/render 활성 탭 라우팅 + T09 restoreHint 활성 탭 | 2~3일 |
| M4 | T11 PRD v0.3.6 + Sprint 종합 | 1~2일 |

총 9~15일.

## 5. 가드레일 적용

- G-001 PRD §9.1 정합
- G-004 Privacy Filter는 각 탭의 컨텍스트로 정확히 평가
- G-006 추측 금지 — 단위 테스트 + 실측
- G-007 main 직접 push 금지
- **G-009 커밋명 NNN 한 분절**: `WI-S008-docs ...` / `WI-S008M1-feat ...` / `WI-S008M2-feat ...` / `WI-S008M3-feat ...` / `WI-S008M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **WebContentsView 메모리 관리**: 탭 닫을 때 webContents destroy 필요. 누수 시 디버깅 어려움 → close 시 명시적 cleanup + WebContentsRegistry 동기화.
2. **활성 탭 view bounds**: 단일 view 시 updateBrowserViewBounds로 처리 → 활성 view만 동일 bounds로 setBounds.
3. **navigate IPC 호환**: 기존 navigate IPC가 단일 browserView 가정 → TabManager.getActive() 기반으로 라우팅. 기존 단위 테스트 회귀 없음.
4. **다중 탭에서 컨텍스트 메뉴 중복 등록**: 각 webContents 인스턴스에 자체 listener 등록 → 메모리 차원 안전.

## 8. Sprint 종료 후 다음 (Sprint 009 후보)

1. 탭 영속 (앱 재시작 후 복원)
2. Codex Login Provider Spike (Phase 1 PoC 4종)
3. 사용자 수동 QA 결과 반영
4. Phase 2 진입 (자막/TTS/싱크) — Spike 임계 정량화 우선

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭 관리 P2)
- PRD: `docs/prd/05_architecture.md` §11 (Browser Engine Layer)
- Sprint 007 종합: `.flowset/eval-results/sprint-007-2026-05-15.md`
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 008 정의 작성
