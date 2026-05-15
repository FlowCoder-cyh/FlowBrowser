# Sprint 013 — Phase 1 / 닫은 탭 복원 + 디스크 영속 + 미리보기 보정

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 1~2주

## 0. 사전 조건

- [x] Sprint 012 종료 (PR #66~#70 머지)
- [x] 단위 테스트 287/287 PASS
- [x] Sprint 012 종합 evaluator Pass 12 / 0 / 0
- [x] PRD v0.3.10 발행
- [x] commit-check CI 6 PR 모두 success (G-009 NNN 한 분절 6 Sprint 연속 + 서브넘버링 S012M1-1 첫 실증)

## 1. Sprint 목표

Sprint 012 evaluator §"Sprint 013 후보 권고" 중 **코드 자동 진행 가능한 보강 묶음**.
탭 그룹은 evaluator가 명시적으로 "단독 Sprint 권고" → Sprint 014로 분리.

1. **닫은 탭 복원 (Ctrl+Shift+T)** — Sprint 012 키보드 단축키 자연 확장 + ClosedTabHistory 모델
2. **ThumbnailStore 디스크 영속** — 메모리 안정성 보강 (앱 재시작 시 미리보기 복원)
3. **우측 끝 미리보기 viewport 보정** — Sprint 012 M2 evaluator 권고 직접 해소

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S013-T01 | `ClosedTabHistory` 신규 — 최근 N개(20) 닫은 탭의 `{ id, url, title, color, pinned, closedAt }` push/pop LIFO + 한계 초과 시 가장 오래된 제거 + clear | `src/main/ClosedTabHistory.ts` |
| S013-T02 | `tab:close` IPC + tab:close-others + tab:close-right 시 ClosedTabHistory.push 자동. 단 `about:blank` 빈 새 탭은 제외 (UX 우선) | `src/main/index.ts` |
| S013-T03 | `tab:reopen` IPC + preload `tabApi.reopen` — ClosedTabHistory.pop 후 신규 탭 open (원 url 복원). 비어 있으면 null | `src/main/index.ts`, `src/preload/index.ts` |
| S013-T04 | Application Menu에 Ctrl+Shift+T (Reopen Closed Tab) 추가. tabHistory가 비면 disabled | `src/main/index.ts` |
| S013-T05 | `ThumbnailDiskStore` — `thumbnails.json` policyVersion=1. ThumbnailEntry 배열 (id + dataUrl + capturedAt + width + height) + load + save + clear + 손상 fallback. 메모리 LRU 동일 최대 50, write-through 자동 영속 | `src/main/ThumbnailStore.ts` 확장 또는 `src/storage/ThumbnailDiskStore.ts` |
| S013-T06 | 앱 시작 시 ThumbnailDiskStore.load → 메모리 ThumbnailStore.bulkLoad. mainWindow.closed 시 디스크 클리어 (옵션) 대신 유지 (재시작 후 복원) | `src/main/index.ts` |
| S013-T07 | TabBar hover 미리보기 viewport 보정 — `anchorLeft + 320 > window.innerWidth`이면 우측 경계에 맞춰 `anchorLeft = innerWidth - 320 - margin` | `src/renderer/src/TabBar.tsx` |
| S013-T08 | TabBar 통합 시나리오 단위 테스트 — formatTabLabel 순수 함수 추출 + 단위 테스트 (Sprint 008 M2부터 inline) | `src/renderer/src/translation/tabLabel.ts` (또는 같은 파일) + `tests/unit/renderer/tabLabel.test.ts` |
| S013-T09 | 단위 테스트 — ClosedTabHistory 5 (push/pop/한계/clear/존재) + ThumbnailDiskStore 4 (round-trip/누락 fallback/손상/clear) + formatTabLabel 4 | tests/unit/* |
| S013-T10 | PRD v0.3.11 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 014+)

- **탭 그룹** — 단독 Sprint 권고 (TabGroup 모델 + groupId + collapse + 컨텍스트 메뉴 + 영속)
- **Codex Login Provider Spike** — 외부 의존성
- **사용자 수동 QA 결과 반영** — 사용자 직접 작업
- **Phase 2 진입 (자막/TTS/싱크)** — Spike 2/3/4 PoC 임계 정량화 우선
- **evaluator 보고서 후속 추적 섹션** — `.claude/agents/evaluator.md` 변경, 사용자 합의
- **UserSetting Phase 2~4 필드** — Phase 2 진입 시 자연 추가

## 3. 수용 기준

### AC-1 닫은 탭 복원 (S013-T01 ~ T04)

- `ClosedTabHistory.push(entry)` / `pop(): entry | null` / `peek(): entry | null` / `clear()` / `size()` 5 메서드
- 최대 N=20 항목, push 시 한계 초과면 가장 오래된 항목(`shift`) 제거
- `closedAt` (number, Date.now()) 포함
- `tab:close` / `tab:close-others` / `tab:close-right` 핸들러에서 닫는 탭마다 push (단 `about:blank` 빈 탭은 push 제외)
- `tab:reopen` IPC: pop된 entry로 신규 탭 open (원 url + color + pinned 복원). 비어 있으면 null 반환
- Application Menu "Reopen Closed Tab" Ctrl+Shift+T accelerator. 동작은 mainWindow에서 tab:reopen과 동일 흐름

### AC-2 ThumbnailStore 디스크 영속 (S013-T05 ~ T06)

- `ThumbnailDiskStore` 신규 `src/main/ThumbnailDiskStore.ts` (또는 `src/storage/ThumbnailDiskStore.ts`)
  - `load(): Promise<Array<{ tabId: string; entry: ThumbnailEntry }>>` — 손상/누락 시 빈 배열 fallback
  - `save(items: Array<{ tabId: string; entry: ThumbnailEntry }>): Promise<void>` — atomic write (tempfile → rename) 또는 직접 writeFile
  - `clear(): Promise<void>`
  - `defaultThumbnailsPath(userDataDir): string` — `thumbnails.json` (policyVersion=1)
- `ThumbnailStore.set` 시점에 debounced 500ms 디스크 write-through (TabStateStore 패턴 재사용 정신)
- 앱 시작 시 ThumbnailDiskStore.load → ThumbnailStore에 bulkLoad (또는 set 반복). 메모리 LRU 한계 50 적용
- mainWindow.closed 시 강제 flush
- 옵션: `tab:close` 시 disk에서도 제거 (메모리 remove + 디스크 동기)

### AC-3 미리보기 viewport 보정 + 통합 단위 테스트 (S013-T07 ~ T08)

- `handleMouseEnter` 또는 미리보기 div 마운트 시 `anchorLeft + 미리보기 폭(320) + margin(8) > window.innerWidth`이면 `anchorLeft = max(8, window.innerWidth - 320 - margin)`로 clamp
- 좌측 안전 margin: `anchorLeft = max(8, anchorLeft)`
- `formatTabLabel` 순수 함수 추출 → `src/renderer/src/translation/tabLabel.ts` 신규 (또는 TabBar.tsx 내부 export). 단위 테스트 4 케이스 (title 있음 / 빈 url about:blank / 정상 url hostname / 잘못된 url 원본 반환)

### AC-4 단위 테스트 (S013-T09)

- ClosedTabHistory 5 (push/pop / pop 빈 → null / peek / 한계 초과 가장 오래된 제거 / clear)
- ThumbnailDiskStore 4 (save→load round-trip / 누락 빈 배열 / 손상 JSON 빈 배열 / clear)
- formatTabLabel 4 (title 있음 / about:blank / 정상 URL hostname / 잘못된 URL)
- **누적 단위 테스트 ≥ 300** (Sprint 012 287 + 13)

### AC-5 통과 기준

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 7 Sprint 연속)

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T04 닫은 탭 복원 + 단위 테스트 일부 | 1~2일 |
| M2 | T05~T06 ThumbnailStore 디스크 영속 + 단위 테스트 일부 | 1~2일 |
| M3 | T07~T08 viewport 보정 + formatTabLabel 추출/테스트 | 1일 |
| M4 | T10 PRD v0.3.11 + Sprint 종합 (T09 잔여는 M1~M3에 분산) | 1일 |

총 4~6일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 탭 / §11 TabManager 확장)
- G-006 추측 금지 — 단위 테스트
- G-007 main 직접 push 금지
- **G-009 커밋명**: `WI-S013-docs ...` / `WI-S013M1-feat ...` / `WI-S013M2-feat ...` / `WI-S013M3-feat ...` / `WI-S013M4-docs ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **about:blank 닫기 push 제외** — `tab:close` 진입 시점에 close 대상 url이 `about:blank`이면 push 스킵. 단 사용자가 의도적으로 `about:blank`만 잠시 열어두는 경우는 손실. 단순 정책 우선.
2. **ThumbnailDiskStore 크기** — 50개 dataURL × 평균 30~80KB (resize 300px PNG base64) = 1.5~4MB. atomic write 성능 충분.
3. **ThumbnailDiskStore atomic write** — `fs.promises.writeFile` 자체로 충분 (단일 호출 atomic). 단 동시 set 빠르면 마지막 호출만 반영. debounce로 통합.
4. **bulkLoad LRU 한계** — 디스크에 50개 초과 (구버전 50, 신규 50 등) 있을 수 있으나 load 시 ThumbnailStore.set 순회 → 자동 한계 적용 (마지막 50개 유지). 영속 파일은 다음 save에서 정리.
5. **viewport 보정 SSR/test** — `window.innerWidth` 환경 의존. fallback `1280` (기본 width). 단위 테스트는 formatTabLabel만 (viewport는 통합 영역).
6. **닫은 탭 복원 시 view 재생성** — `tab:reopen`은 신규 탭 open이므로 createTabView + setActiveTabView 동일 흐름. 원 webContentsId/lastActiveAt 등은 복원 못 함 (신규).

## 8. Sprint 종료 후 다음 (Sprint 014 후보)

1. **탭 그룹** — 단독 Sprint (TabGroup 모델 + groupId + collapse + 컨텍스트 메뉴 + 영속 + closeOthers 그룹 동작 정의)
2. **Codex Login Provider Spike** — 외부 의존성
3. **사용자 수동 QA 결과 반영** — 사용자 작업
4. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화
5. evaluator 보고서 후속 추적 섹션 (사용자 합의)
6. UserSetting Phase 2~4 필드

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (탭) / §11 TabManager
- Sprint 012 종합: `.flowset/eval-results/sprint-012-2026-05-15.md` §"Sprint 013 후보 권고"
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 013 정의 작성 (닫은 탭 복원 + 디스크 영속 + 미리보기 보정)
