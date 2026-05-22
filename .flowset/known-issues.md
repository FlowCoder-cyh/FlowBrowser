# FlowBrowser AI — Known Issues 누적

> Sprint·Phase 종료 evaluator에서 발견된 약점 / 시나리오 cover 부족 / 정량 임계 미달 / 회귀 가능성 항목을 KI-NNN 형식으로 누적.
> 가드레일(`guardrails.md`)과 같은 단일 파일 패턴. 절대 삭제하지 않음 (해소 시 상태만 `closed`로 변경).

## 등록 정책 (Sprint 015 진입 시 활성)

### KI 번호 규칙
- 형식: `KI-NNN` (NNN = 3자리 0-pad 숫자, 등록 순서)
- 첫 등록부터 순차 (KI-001, KI-002, ...)

### Severity 정의

| Severity | 정의 | 처리 시점 |
|---|---|---|
| **HIGH** | 핵심 시나리오 불가능 / 보안·프라이버시 위협 / 데이터 손실 위험 | **즉시 다음 Sprint M1**에 처리 (별도 작업 우선) |
| **MEDIUM** | 시나리오 동작하지만 UX 불편 / 정량 임계 미달 / 성능 저하 | **5개 누적 또는 Phase 종료 시 batch** (다음 Sprint M1~M2에 흡수) |
| **LOW** | 정성적 개선 / 마이너 버그 / 코드 정리 | **Phase 3 종료 후 MVP 직전 정리** |

### 등록 형식

각 KI는 다음 메타를 가짐:

```
### KI-NNN [status] 한 줄 제목

- **Severity**: HIGH / MEDIUM / LOW
- **Phase**: 1 / 2 / 3
- **Sprint**: 015 / 016 / ...
- **Component**: 파일 또는 모듈 경로 (예: `src/storage/IndexedPageStore.ts`)
- **영향**: 어떤 시나리오·사용자 흐름에 영향
- **발견 출처**: evaluator 보고서 인용 또는 사용자 보고
- **재현 절차**: (선택, HIGH/MEDIUM은 필수)
- **권고 해소 방향**: (선택)
- **처리 예정 Sprint**: NNN (또는 "Phase X batch")
- **상태**: `open` / `in-progress` / `closed`
```

### 상태 표기

- `[open]` 등록만 됨, 아직 처리 시작 안 됨
- `[in-progress]` 처리 Sprint 진행 중
- `[closed]` 해소 완료 (해소 PR 번호 + Sprint 인용)

### 누적 정리 트리거

- **HIGH 즉시**: 발견 즉시 다음 Sprint M1 작업으로 격상
- **MEDIUM 5개**: MEDIUM 누적 5개 도달 시 다음 Sprint M1~M2 batch 처리
- **Phase 종료 batch**: 각 Phase 종료 evaluator 시점에 MEDIUM/LOW 누적분 정리 plan 수립
- **MVP 최종**: Phase 3 종료 후 남은 LOW까지 모두 정리

---

## KI 누적

### KI-001 [in-progress] sqlite-vec macOS native 빌드 미검증

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M3-6 codex/evaluator 핫픽스 시점 등록) → 016 M0 T01 PoC 진입 (PR #168)
- **Component**: `package.json` (sqlite-vec optional dep) + `src/storage/Database.ts` (sqlite-vec 로드 호출) + `.github/workflows/ci.yml` (macos-poc job)
- **영향**: macOS 사용자 install 시 `sqlite-vec-darwin-x64` / `sqlite-vec-darwin-arm64` prebuilt 동작 미검증. `better-sqlite3@12.10` Electron 39 macOS ABI rebuild 도 PoC 부재. M4 인덱싱 hook 시점에 macOS 사용자에서 sqlite-vec load 실패 시 인덱싱 전체 차단 가능. `src/storage/Database.ts` L113 `sqliteVec.load(d)` 호출 fail시 throw — **fallback 미구현** (Sprint 016 contract §7 #1 "임시 in-memory cosine fallback" 차후 도입).
- **발견 출처**: M3-spike (`.flowset/specs/m3-spike-decisions.md` §1 "macOS 검증: 본 세션 환경 한정 → 미검증") + 핸드오프 2026-05-18 §13.8 + 2026-05-18 M3 종합 evaluator §3 KI 후보 1 권고
- **재현 절차**: macOS x64 또는 arm64 환경에서 `npm install` + `npx electron-rebuild -f -w better-sqlite3 -v 39.x.x` 실행 후 `spike/m3-poc/electron-main.cjs` 동일 PoC 재실행. 또는 본 PR #168 머지 후 GitHub Actions `macos-poc` job 실행 결과 확인.
- **1차 PoC 실측 (2026-05-19, PR #168 `cf5fe0d` 머지본 CI run [26093981003](https://github.com/FlowCoder-cyh/FlowBrowser/actions/runs/26093981003))**: arm64 / darwin / sqlite_version 3.53.1 / vec_version v0.1.9 — **SUCCESS** (probe + typecheck + 1068 PASS). 상세: [`.flowset/eval-results/ki-001-macos-poc-2026-05-19.md`](./eval-results/ki-001-macos-poc-2026-05-19.md)
- **권고 해소 방향**: (1) **PR #168 진행**: macOS CI runner 추가 (`.github/workflows/ci.yml` 에 `macos-poc` job — `continue-on-error: true` PoC) — **검증 범위: sqlite-vec-darwin-arm64 + Node 20 ABI load 만**. darwin-x64 (Intel) 및 Electron 39 native ABI rebuild 는 별도 PR. (2) 1차 PoC (arm64 + Node ABI) 통과 → **부분 closed 불가, 다음 단계 진행**: (2a) windows-latest + macos-intel matrix 통합 PR → required check 승격 (2b) Electron 39 native ABI rebuild PoC (`electron-rebuild -f -w better-sqlite3 -v 39.x.x` + Electron 런타임 sqlite-vec 재load) — T05 IndexingService wiring 동반 또는 별도 T (3) PoC 실패 시 fallback (`src/storage/Database.ts` try/catch + in-memory cosine 비-벡터 검색 모드)
- **처리 예정 Sprint**: 016 M0 T01 (PoC 진행) → 결과 후 closed 또는 fallback 도입
- **상태**: `in-progress`

### KI-002 [closed] PageCachePanel PARTIAL — v0.3 어댑터 의존 잔존

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M3-7 PARTIAL 적용 + codex/evaluator 핫픽스 시점 등록) → 016 M2 T12 closed
- **Component**: `src/renderer/src/settings/PageCachePanel.tsx` + `src/storage/PageResultStore.ts` 어댑터
- **영향**: 본 패널은 M3-7 에서 copy 만 "페이지 본문 캐시" 로 갱신되었으나 컴포넌트 자체는 v0.3 `pageResultApi` 의존. Sprint 016 M2 T12 시점 어댑터 통째 폐기 + MemoryStatsPanel (M6 T29) 가 통계 흡수.
- **발견 출처**: PR #138 본문 + 2026-05-18 M3 종합 evaluator §3 KI 후보 2 권고
- **권고 해소 방향**: M5-8 ChatService 도입 시점에 `pageResultApi` + `PageResultStore` 어댑터 + 본 패널 동시 제거 + 신규 `MemoryStatsPanel` (M6) 으로 흡수
- **처리 예정 Sprint**: 015 M5-8 (정합 contract) 또는 Phase 3 종료 후 MVP 직전 정리
- **상태**: `closed` (PR T12 머지 시점 — Sprint 016 M2)
- **해소 PR**: Sprint 016 M2 T12 — `src/storage/PageResultStore.ts` + `src/renderer/src/settings/PageCachePanel.tsx` + `tests/unit/storage/PageResultStore.adapter.test.ts` 통째 삭제 / `pageResult:*` IPC 2 폐기 / preload `pageResultApi` 제거 / SettingsPage import 제거 / styles.css `.page-cache-panel.*` 제거 / IndexedPageStore 주석 갱신 (normalizeIndexedUrl 단일 source)
- **사전 dual review hotfix 흡수** (학습 #18 정합): codex BLOCKING #1 — `migrations/v03_to_v04.ts` 가 `{ entries?: V03PageResultEntry[] }` wrapper 가정인데 실제 PageResultStore.persistOnce 는 raw array `PageResultEntry[]` 영속. 실 사용자 page-results.json 손실 위험. **본 PR hotfix**: `dryRunSimulate` + `migratePageResults` 양쪽 shape 허용 + test case 4b/4c 추가 (단위 1152 → 1154).

### KI-003 [closed] AutoTagger G-003 BYOK provider 검증 wiring 필요

- **Severity**: HIGH
- **Phase**: 1
- **Sprint**: 015 (M4-2 codex 핫픽스 시점 등록) → 016 M5 T25 status `open` → `closed` 자가 전환 (Sprint 015 M5-5 BYOK wiring 완료, M5-7 NoteService autoTagger 미주입 safety 정합)
- **Component**: `src/main/IndexingService.ts` (M4-5 wiring 시점) + `src/ai/tagging/AutoTagger.ts` (호출자 책임 명시)
- **영향**: AutoTagger 자체는 호출자가 어떤 provider 주입했는지 모름 — Codex OAuth 가 주입되면 자동 백그라운드 호출이 ChatGPT 한도를 묵시 소진. G-003 강화 (BYOK 디폴트, 자동 호출은 OpenAI API Key 만) 가 wiring 단계에서 강제되지 않으면 사용자 동의 없이 ChatGPT 할당 소비 가능 — 보안·UX 위협.
- **발견 출처**: M4-2 PR #146 codex 정밀 검토 KI 후보 1 (Severity HIGH)
- **재현 절차**: IndexingService 가 AutoTagger 호출 시 provider = CodexLoginProvider 주입 → 자동 인덱싱마다 ChatGPT 호출 발생
- **권고 해소 방향**: M4-5 wiring 또는 후속 단계에서 `IndexingService.tagPage` 호출 시 `UserSetting.defaultProviderId === 'openai-key'` 또는 사용자 명시 동의 검증. AutoTagger.constructor 에 BYOK 가드 add (`opts.provider.info.providerType === 'openai'` 또는 옵션 `enforceByokOnly: true`)
- **처리 예정 Sprint**: 015 M4-5 또는 M5 (wiring 시점)
- **상태**: `closed`
- **해소 PR**: Sprint 015 M5-5 PR #157 ChatService 도입 시점에 BYOK wiring 완료 (`allowedProviders ['openai']` 디폴트) + M5-7 PR #159 NoteService.opts.autoTagger 미주입 safety 디폴트. Sprint 016 M5 T25 시점 자가 status 전환 (Sprint 015 진행 중 wiring 박힘, 본 T25 시점 명시).

### KI-006 [open] Workspace 전환 시 진행 작업 abort 정책 미배선

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator + codex KI 후보 #1)
- **Component**: `src/main/workspaceHandlers.ts` (`handleWorkspaceSwitch`) + `src/main/IndexingService.ts` (abort API 신규 노출) + `src/storage/EmbeddingQueue.ts` (clear API 신규) + `src/main/ChatService.ts` (abortStreaming API 신규)
- **영향**: 사용자 워크스페이스 전환 시 이전 ws 의 인덱싱 진행 / 임베딩 큐 / 채팅 streaming 이 그대로 진행되어 GPT 호출이 새 ws 에 연결되지 않은 ws_id 로 계속 발생. 비용 묵시 소진 + 노이즈 데이터 INSERT 가능. PRD §11.3.1 명시 abort 4-step 흐름 미구현.
- **재현 절차**: 워크스페이스 A 에서 페이지 인덱싱 중 워크스페이스 B 로 전환 → A 의 임베딩 큐 / Visit INSERT 가 A 워크스페이스로 계속 기록
- **권고 해소 방향**: `WorkspaceHandlerDeps` 에 abort callback 3종 (`abortIndexing` / `clearEmbeddingQueue` / `abortChatStreaming`) 주입 → `handleWorkspaceSwitch` 진입 시 호출. main `setActive` 후 broadcast `workspace:switched` 활용.
- **처리 예정 Sprint**: 016 (M0 또는 M1)
- **상태**: `open`

### KI-007 [closed] TabManager workspace_id 메타 + 탭 그룹 stash/restore 미구현

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator KI 후보 #2)
- **Component**: `src/main/TabManager.ts` (workspace_id 필드 신규) + `src/storage/TabStateStore.ts` (영속 schema 확장) + `src/main/workspaceHandlers.ts` (stash/restore 트리거)
- **영향**: PRD §11.2.1 의 탭 격리 PARTIAL 라 본 PR (T28) 단계에서 허용 범위이나, contract AC-7 명시 "탭 전부 교체" 미달. 워크스페이스 전환해도 동일 탭 그룹 유지 → 시나리오 1·2·3 격리 검증 어려움.
- **재현 절차**: ws A 에서 GitHub 탭 5개 → ws B 전환 → 여전히 GitHub 탭 5개 그대로
- **권고 해소 방향**: TabState schema 확장 (`workspace_id` NOT NULL) + TabManager filter by activeWorkspaceId + setActiveTabView 시 stash/restore. Phase 2 cookies partition (WorkspacePartitionManager) 와 동반 처리.
- **처리 예정 Sprint**: 016 (Phase 2 cookies partition 동반)
- **상태**: `closed` (Sprint 016 M0 T03 분할 옵션 A 3편 — T03a PR #171 schema + V1→V2 마이그레이션 / T03b PR #172 TabLabel workspaceContext props / T03c PR #173 `TabManager.setActiveWorkspaceFilter` + `activeTabByWorkspace` stash map + `backfillUnassignedWorkspaceId` + `workspaceHandlers.handleWorkspaceSwitch` `onWorkspaceSwitched` callback path + `services.setWorkspaceSwitchHook` + `tab:open` 시 active ws 자동 박힘 + `initializeTabs` backfill + TabBar workspace context 주입 + `workspaceApi.onSwitched` broadcast. PR #173 회귀 +7 (TabManager activeWorkspaceFilter describe 4 case / workspaceHandlers onWorkspaceSwitched 3 case). nullable workspace_id 유지 (V1 호환 + fresh install 안전 fallback) — KI-007 본문 "NOT NULL" 권고는 main process backfill + IndexingService partition 검증으로 실효 충족.)

### KI-008 [closed] Workspace JSON Export/Import 미구현

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator KI 후보 #3) → 016 M3 T17 closed
- **Component**: `src/main/WorkspaceExportImportService.ts` (신규) + `src/main/workspaceHandlers.ts` (handleWorkspaceExportJson / handleWorkspaceImportJson) + `src/preload/index.ts` (workspaceApi.exportJson / importJson)
- **영향**: PRD §11.5.6 "Phase 1, M6" 명시 산출물이나 contract T28 산출물 목록에 포함 0. 사용자 워크스페이스 삭제 직전 안전망 부재 (현재 cascade DELETE 후 복구 불가).
- **권고 해소 방향**: IPC 2종 (`workspace:export-json` / `workspace:import-json`) + UI 우클릭 메뉴 추가. v0.4 자체 schema (Workspace + Page + Visit + Note + AiChatHistory + Tag 전체).
- **처리 예정 Sprint**: 016 M3 T17
- **상태**: `closed` (Sprint 016 M3 T17 — `WorkspaceExportImportService` 신규 + IPC 2종 + preload 노출 + ID remap path: 항상 새 workspace id 발급 + 모든 child id 새 발급 + retrieved_items/chat_meta 안의 page_id/visit_id/note_id + RetrievedItem.id (type='page'/'note') 참조 rewrite + 단일 TX rollback. 단위 회귀 17 케이스. UI 우클릭 메뉴는 후속 hotfix.)
- **잔여 후속 (KI-022 신규)**: import 후 vec_pages / vec_notes 재계산 (`embedding_queue` 재 enqueue) — 본 PR 미포함.

### KI-009 [closed] MemoryStatsPanel React 컴포넌트 단위 테스트 0

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 evaluator NB-7) → 017 M0 T03 closed
- **Component**: `src/renderer/src/memory/MemoryStatsPanel.tsx`
- **영향**: 폴링 동작 / workspaceId prop 변경 시 즉시 재로드 / error fallback UI / loading state / broadcast onInvalidated 구독 — React component 단위 미검증. pure logic 17 cover 완전 + 시나리오 통합 회귀로 부분 cover.
- **권고 해소 방향**: vitest + @testing-library/react + IPC mock 으로 4 케이스 (mount / workspaceId 변경 / 폴링 / error). renderer 환경 happy-dom 활성 필요.
- **처리 예정 Sprint**: 017 M0 T03
- **상태**: `closed` (Sprint 017 M0 T03 — `@testing-library/react` + `@testing-library/dom` dev dep 추가 + vitest config renderer happy-dom 매트릭스 + `tests/**/*.test.tsx` include + esbuild `jsx: 'automatic'` + `MemoryStatsPanel.test.tsx` 10 케이스 (mount / workspaceId 변경 / 폴링 / 3 error variant / null + onInvalidated 격리 2 + unmount cleanup). 회귀 +10.)

### KI-010 [closed] MemoryStatsPanel 인덱싱 완료 broadcast 미구현 (잔여 1종)

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 hotfix 부분 cover) → 016 M0 T05 closed (PR #176)
- **Component**: `src/main/IndexingService.ts` (wiring 시점에 broadcast 추가) + `src/renderer/src/memory/MemoryStatsPanel.tsx` (이미 onInvalidated 구독 중)
- **영향**: PRD §07.4.2 broadcast 3종 (인덱싱 / 노트 / AI 채팅) 중 노트 + AI 채팅 2종은 T29 hotfix 로 cover. 인덱싱 완료 broadcast 는 IndexingService 가 main process 에 wiring 안 됨 (Sprint 015 M4-5 자체는 인스턴스 정의만, services.ts wiring 0).
- **권고 해소 방향**: IndexingService 가 services.ts 에서 인스턴스화 + did-finish-load 핸들러 결합 시점에 recordVisit 후 `broadcastMemoryInvalidated(workspaceId)` 호출. KI-006 abort 정책과 동반 처리 가능.
- **처리 예정 Sprint**: 016 M0 또는 M1 (IndexingService wiring 시점)
- **상태**: `closed` (Sprint 016 M0 T05 PR #176 `cae365e` — services.ts `IndexingGate` (UserSetting.privacyExclusions getter wiring) + `IndexingService` 인스턴스화 + `createIndexingBroadcastHandler` factory 함수로 onStatusChange wiring 추출 — status='indexed' 시 `broadcastMemoryInvalidated(payload.workspaceId)` 호출. main/index.ts `createTabView` did-finish-load 에 `runPageIndexing` 헬퍼 — scanWebContentsFields + ParagraphExtractor.executeJavaScript + tryIndexPage. http/https allowlist 선필터 + graceful try/catch + IndexingStatusPayload.workspaceId 추가. 회귀 +12 (IndexingService.test.ts +7 workspaceId payload + indexingBroadcast.test.ts +5 broadcast wiring). dual review evaluator Pass 8/8 / codex NEEDS_CHANGES 1 + NB-5 본 PR hotfix 흡수. NB-1 (SPA did-navigate-in-page 인덱싱 누락) 후속 KI-020 신규 등록.)

### KI-011 [closed] MemoryStats 카운트 < 20ms 정량 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 evaluator 항목 3 Partial)
- **Component**: `src/main/MemoryService.ts` (`getStats` 5개 prepared SELECT)
- **영향**: PRD §11.3.2 임계 측정 데이터 부재. 실측 < 20ms 정량 검증 필요 (10K page workspace 기준). 단위 테스트는 in-memory SQLite — 실디스크 WAL mode + 인덱스 활용 시 차이 가능성.
- **권고 해소 방향**: T31 종합 evaluator 또는 Sprint 016 M0 에 stopwatch 측정 셋 추가 (1K / 10K 페이지 시 getStats 실측 ms). 임계 초과 시 denormalized 카운트 컬럼 (workspaces 테이블에 신규) 도입 권고.
- **처리 예정 Sprint**: 016 M0
- **상태**: `closed` (Sprint 016 M0 T06 perf bench infra — `tests/perf/memoryStats.bench.ts` 박음 + perf-baseline 실측 1K=0.046ms / 10K=0.447ms PASS — 임계 < 20ms 의 44.7× 마진. 보고서: `.flowset/eval-results/sprint-016-perf-bench.md` §2.1. Sprint 016 M5 T25 시점 status `open` → `closed` 전환. **Sprint 017 M0 T05 audit (2026-05-22)**: 1K=0.046ms / 10K=0.453ms 재측정 PASS, +0.006ms 노이즈 (회귀 0) — handoff 2026-05-22.md §5 + 보고서 §6.)

### KI-005 [closed] AutoTagger.tagPage(pageId=note.id) page_tags FK 위반 — note 자동 태깅 차단

- **Severity**: LOW (현 시점 wiring 미활성 — NoteService.opts.autoTagger 미주입 + 통합 자체 제거)
- **Phase**: 1
- **Sprint**: 015 (M5-7 PR #159 codex 정밀 검토 발견) → 016 M4 T21 closed
- **Component**: `src/ai/tagging/AutoTagger.ts` (tagPage / tagNote 분리 + private tagContent helper) + `src/main/NoteService.ts` (opts.autoTagger optional + enableAutoTagging path 활성)
- **영향**: AutoTagger.tagPage 가 내부에서 `tagStore.attachToPage(input.pageId, ...)` 호출 — schema `page_tags.page_id REFERENCES pages(id) ON DELETE CASCADE` FK 제약. NoteService 가 note.id 를 pageId 자리에 주입 시 SQLite FOREIGN KEY constraint 실패. 현 NoteService 는 autoTagger 호출 자체 차단으로 안전.
- **발견 출처**: M5-7 PR #159 codex 정밀 검토 N-001 + evaluator KI 후보 1 (Sprint 015 M5 종료 핸드오프 §10.5)
- **재현 절차**: 향후 NoteService 에 AutoTagger 인스턴스 주입 + createNote({enableAutoTagging: true}) 호출 시 — schema FK 검사에서 throw
- **권고 해소 방향**: AutoTagger.tagNote 신규 메서드 도입 — `tagStore.attachToNote` 호출 path. 또는 AutoTagger 가 attach 호출 자체 호출자에게 분리 (provider.chat 결과 tag rows 만 반환).
- **처리 예정 Sprint**: 016 (note 자동 태깅 UI 도입 시점)
- **상태**: `closed` (Sprint 016 M4 T21 — `AutoTagger.tagNote(input: TagNoteInput)` 신규 메서드 + private `tagContent(input, attach)` helper 추출 (DRY). `tagNote` 는 `tagStore.attachToNote` 호출 — page_tags FK 회피. `NoteService.opts.autoTagger?` optional 주입 + `createNote({enableAutoTagging: true})` + autoTagger 주입 시 tagNote 호출, 그 외 'not_called' safety 디폴트. 회귀 +20: AutoTagger.test.ts tagNote 8 케이스 + maxOutputTokens hotfix 회귀 (TagPageInput maxOutputTokens 가 ChatRequest 로 미전달 잔존 Sprint 015 M4-2 NB-1 정정) + NoteService.test.ts enableAutoTagging path 7 + autoTagger 미주입 safety 3 + codex NEEDS_CHANGES #1 흡수 (try/catch autoTagger throw 격리) 1.)
- **사전 dual review hotfix 흡수** (학습 #18 정합): codex NEEDS_CHANGES #1 — `await this.autoTagger.tagNote(...)` 가 attach 단계 DB/FK throw 시 createNote 자체 throw 위험. NoteService.createNote 에 try/catch 격리 추가 + autoTaggingStatus='failed' 반환 + 회귀 1 케이스 (throwing tagger stub).

### KI-004 [open] ChatRequest.response_format JSON 강제 API-level 미구현

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M4-2 codex 핫픽스 시점 등록)
- **Component**: `src/ai/types.ts` (ChatRequest) + `src/ai/providers/OpenAIApiKeyProvider.ts` (chat 호출)
- **영향**: PRD §8.8.3 "OpenAI Provider 응답을 JSON 강제" — 현재는 system prompt 의존 (모델이 schema 따르도록 지시만). OpenAI API 의 `response_format: { type: 'json_object' }` 또는 `json_schema` 미사용 → 모델이 JSON 외 출력 시 freeform fallback 트리거되어 정확도 저하 가능.
- **발견 출처**: M4-2 PR #146 codex 정밀 검토 NB-3 / KI 후보 2 (Severity MEDIUM)
- **권고 해소 방향**: (1) `ChatRequest` 에 `responseFormat?: 'text' | 'json_object'` 추가 (2) OpenAIApiKeyProvider body 에 `response_format` 전달 (3) AutoTagger 가 `responseFormat: 'json_object'` 지정. M5 ChatService 도입 시점에 본 contract 함께 처리.
- **처리 예정 Sprint**: 015 M5-5 (ChatService 도입) 또는 Sprint 016 정확도 측정 시점
- **상태**: `open`

### KI-012 [closed] 인덱싱 속도 < 500ms / 페이지 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T31 종합 evaluator NB 후 Sprint 016 M0 hotfix 등록) → 016 M0 T06 PASS → M5 T25 status `closed` 전환
- **Component**: `src/main/IndexingService.ts` (recordVisit 진입 ~ 완료 broadcast 까지)
- **영향**: PRD §11.3.2 + Sprint 016 contract §6 정량 임계. 시나리오 1·2 (대량 인덱싱) 사용자 체감 직결. 단위 테스트는 in-memory SQLite — 실디스크 WAL + EmbeddingClient 호출 시 차이 미측정.
- **권고 해소 방향**: Sprint 016 M0 perf bench 셋 (`tests/perf/indexing.bench.ts` 신규) — recordVisit 진입 → recordVisit 완료 ms 측정. 임계 초과 시 EmbeddingQueue 비동기 우선 (인덱싱 본체는 즉시 반환 + 임베딩 백그라운드) 정책 강화.
- **처리 예정 Sprint**: 016 M0
- **상태**: `closed` (Sprint 016 M0 T06 — `tests/perf/indexing.bench.ts` 박음 + perf-baseline 실측 100 iter mean 0.027ms PASS — 임계 < 500ms 의 18,500× 마진. 보고서 §2.2. **Sprint 017 M0 T05 audit (2026-05-22)**: 0.027ms 재측정 동일 PASS (회귀 0) — handoff §5 + 보고서 §6.)

### KI-013 [closed] 검색 응답 < 200ms (top-10 표시까지) 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T31 종합 evaluator NB 후 Sprint 016 M0 hotfix 등록 — PR #167 정식화에서 PRD §9.7 b6.1 정정 정합 "top-5 retrieval" → "top-10 표시까지") → 016 M0 T06 PASS → M5 T25 status `closed` 전환
- **Component**: `src/main/SearchService.ts` (search:query 진입 ~ results 반환)
- **영향**: PRD §15.4 #2 + §9.7 + Sprint 016 contract §6 정량 임계. 시나리오 1·4 (Cmd+K 즉시 검색) 사용자 체감 직결. Query 임베딩 비용 (~100~300ms 평균) + vec0 JOIN top-k=20 + 정렬 후 top-10 표시 시간 미측정. PRD §9.7 정의: 1000 페이지 + retrieval × 100회 평균, 본문 캐시 fetch 제외.
- **권고 해소 방향**: Sprint 016 M0 perf bench (`tests/perf/search.bench.ts` 신규) — embed 호출 mock + vec0 JOIN ms 측정. AIResponseCache TTL 30일 hit 시 < 50ms 검증.
- **처리 예정 Sprint**: 016 M0 T06
- **상태**: `closed` (Sprint 016 M0 T06 — `tests/perf/search.bench.ts` 박음 + perf-baseline 실측 1000 pages + 임베딩 50 iter mean 1.404ms PASS — 임계 < 200ms 의 142× 마진. 보고서 §2.3. **Sprint 017 M0 T05 audit (2026-05-22)**: 1.447ms 재측정 PASS, +0.043ms 노이즈 (회귀 0) — handoff §5 + 보고서 §6.)

### KI-014 [closed] 워크스페이스 전환 < 1초 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T31 종합 evaluator NB 후 Sprint 016 M0 hotfix 등록) → 016 M0 T06 1차 측정 + KI-006 wiring 후 재측정 → M5 T25 status `closed` 전환
- **Component**: `src/main/workspaceHandlers.ts` (`handleWorkspaceSwitch`) + `src/main/WorkspaceService.ts`
- **영향**: PRD §11.3.2 + Sprint 016 contract §6 정량 임계. 워크스페이스 사이드바 클릭 ~ active ws 전환 완료 broadcast 까지. KI-006 abort 정책 (Sprint 016 T02) + KI-007 TabManager stash/restore (T03) 적용 후 측정.
- **권고 해소 방향**: Sprint 016 M3 (cookies/storage partition 도입) 시점에 e2e timer 측정. KI-006 + KI-007 closed 직후 1차 측정 권고.
- **처리 예정 Sprint**: 016 M0 (1차 baseline) + M3 (partition 도입 후 재측정)
- **상태**: `closed` (Sprint 016 M0 T06 — `tests/perf/workspaceSwitch.bench.ts` 박음 + perf-baseline 실측 10 ws × 10 tabs 50 iter mean 0.283ms PASS — 임계 < 1000ms 의 3,500× 마진. KI-006 abort wiring 후 재측정 0.581ms 정합. 보고서 §2.4. **Sprint 017 M0 T05 audit (2026-05-22)**: 0.339ms 재측정 PASS (T02 abort baseline 0.581ms 대비 -0.242ms 개선 / T06 baseline 0.283ms 대비 +0.056ms 노이즈, 회귀 0) — handoff §5 + 보고서 §6.)

### KI-015 [closed] 임베딩 비용 < $3/월 (1만 페이지) 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T31 종합 evaluator NB 후 Sprint 016 M0 hotfix 등록) → 016 M0 T06 PASS → M5 T25 status `closed` 전환
- **Component**: `src/ai/embedding/EmbeddingClient.ts` (OpenAI text-embedding-3-small 호출 횟수 + 토큰 합산)
- **영향**: PRD §9.7 + Sprint 016 contract §6 정량 임계. 1만 페이지 / 월 사용자 시나리오 — 비용 임계 초과 시 BYOK 디폴트 모델 변경 (3-small → 3-large 보류) 권고.
- **권고 해소 방향**: Sprint 016 M0 EmbeddingClient 호출 횟수 + 평균 token usage 측정 셋 (Mock OpenAI API + token counter). AIResponseCache TTL 7일 dedup hit rate 측정 동반.
- **처리 예정 Sprint**: 016 M0
- **상태**: `closed` (Sprint 016 M0 T06 — `tests/perf/embeddingCost.bench.ts` + `embeddingCostHelpers.ts` 박음 + 산식 estimateMonthlyCostUsd(1만, 1000 tokens) = $0.2000/월 PASS — 임계 < $3 의 15× 마진. 보고서 §2.5. **Sprint 017 M0 T05 audit (2026-05-22)**: $0.20/월 재측정 동일 PASS (회귀 0) — handoff §5 + 보고서 §6.)

### KI-016 [closed] 저장 용량 < 200MB / 만 페이지 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T31 종합 evaluator NB 후 Sprint 016 M0 hotfix 등록) → 016 M0 T06 PASS → M5 T25 status `closed` 전환
- **Component**: `src/storage/IndexedPageStore.ts` + `src/storage/schema/v04.sql` (page content + visit + vec0 embedding row 합산)
- **영향**: PRD §11.3.2 + Sprint 016 contract §6 정량 임계. 사용자 디스크 SSD 용량 — 1만 페이지 시 200MB 임계 초과 시 본문 캐시 압축 (zstd) + vec0 row dimension 축소 (text-embedding-3-small 512 dim → 384 dim quantize) 권고.
- **권고 해소 방향**: Sprint 016 M0 DB 용량 측정 (1K + 1만 페이지 모킹 시 .sqlite 파일 크기). 임계 초과 시 본문 캐시 zstd 압축 도입 검토.
- **처리 예정 Sprint**: 016 M0
- **상태**: `closed` (Sprint 016 M0 T06 — `tests/perf/storageSize.bench.ts` 박음 + perf-baseline 실측 10K pages + 임베딩 1024차원 + WAL = 90.32MB PASS — 임계 < 200MB 의 2.2× 마진. 보고서 §2.6. 5만 페이지 스케일링 시 ~450MB 후속 검토 (PRD §15.3). **Sprint 017 M0 T05 audit (2026-05-22)**: 90.32MB 재측정 동일 PASS (회귀 0) — handoff §5 + 보고서 §6.)

### KI-018 [closed] top-10 hit rate ≥ 80% 정확도 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (PR #167 contract 정식화 시점 codex BLOCKING #1 — PRD §15.4 #3 누락 발견) → 016 M0 T06 산식 헬퍼 + M5 T23 30 케이스 산식 cover 완성 → M5 T25 status `closed` 전환
- **Component**: `src/main/SearchService.ts` (vec0 top-k=20 retrieval 정렬 + top-10 표시) + 회귀 셋 (`tests/integration/scenarios/*` + 50 페어 자체 테스트 셋)
- **영향**: PRD §15.4 #3 + §9.7 정량 임계. 검색 결과가 사용자 의도와 맞는지 — 정답 페이지가 top-10 안에 포함되는 비율. 측정 부재 시 시나리오 1·4 cover 100% 통과해도 retrieval 품질 불명. PRD 정의: 회귀 셋 + 50 페어 자체 테스트 셋 (positive/negative 쌍).
- **권고 해소 방향**: Sprint 016 M0 T06 — (1) 50 페어 자체 테스트 셋 (`tests/integration/searchHitRate.test.ts`) 신규: 각 페어는 모킹 검색 쿼리 + 정답 페이지 ID + retrieval 후 top-10 안 포함 여부 검증. (2) 시나리오 1·2·3·4 회귀 셋의 검색 단계에 hit rate 누적 측정 + 종합 보고서 (`.flowset/eval-results/sprint-016-perf-bench.md`) 박힘.
- **처리 예정 Sprint**: 016 M0 T06
- **상태**: `closed` (Sprint 016 M0 T06 산식 헬퍼 `topKHitRate` + `TOP_K_HIT_RATE_THRESHOLD=0.8` 박음. Sprint 016 M5 T23 PR #217 `tests/integration/scenarios/scenario-accuracy.test.ts` 신규 — 시나리오 1·3·4 각 5/5/3 페어 셋 + 종합 13 페어 셋 hit rate 100% PASS — 임계 ≥ 80% 충족. 시나리오 2 기존 S2-C4 5 페어 동반 = 총 18 페어 회귀 + 12 케이스 산식 보강 = 30 케이스 cover 완성. **Sprint 017 M0 T04 audit (2026-05-22)**: scenario-accuracy 12 + accuracyHelpers 17 = 29 PASS 재실행 carryover regression 0 — handoff §4.)

### KI-019 [closed] AI 응답 출처 정확도 ≥ 90% 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (PR #167 contract 정식화 시점 codex BLOCKING #2 — PRD §15.4 #6 측정 산식 부재 발견) → 016 M0 T06 산식 헬퍼 + M5 T23 30 케이스 산식 cover 완성 → M5 T25 status `closed` 전환
- **Component**: `src/main/ChatService.ts` (chat_meta.cells.sources 출력) + 회귀 셋 (`tests/integration/scenarios/*` 30 케이스 — 시나리오 1 S1-C3 + 시나리오 2 비교 매트릭스 등 chat_meta 출력 케이스)
- **영향**: PRD §15.4 #6 + §10.8 정량 임계. AI 응답이 retrieval 결과 (top-k page_id) 와 일치하는 비율 — `chat_meta.cells.sources` 각 page_id 가 실제 `retrieved_items` 내에 존재 비율. 측정 부재 시 시나리오 cover 통과해도 출처 hallucination 가능. 현 `scenario-1-academic.test.ts` S1-C3는 `chat_meta.cells.sources` schema 만 확인 — 일치 비율 산식 부재.
- **권고 해소 방향**: Sprint 016 M0 T06 — (1) 시나리오 회귀 셋 30 케이스 (Sprint 015 T30 S1+S4 = 8 케이스 + Sprint 016 T07~T08 S2+S3 = 10 케이스 + 추가 12 케이스 = 30) 각각에 chat_meta.cells.sources ∈ retrieved_items 검증 (`expect(sources.every(s => retrievedItems.has(s))).toBe(true)`) + 정확도 카운터 ≥ 27/30 (90%). (2) 종합 보고서 (`.flowset/eval-results/sprint-016-perf-bench.md`).
- **처리 예정 Sprint**: 016 M0 T06
- **상태**: `closed` (Sprint 016 M0 T06 산식 헬퍼 `aiSourcesPrecision` + `AI_SOURCES_PRECISION_THRESHOLD=0.9` 박음. Sprint 016 M5 T23 PR #217 scenario-accuracy 종합 30 케이스 산식 cover (27 perfect 1.0 + 3 hallucinated 0.5 → mean 0.95 PASS — `expect(precision).toBeCloseTo(0.95, 5)` exact assertion) — 임계 ≥ 90% 충족. **Sprint 017 M0 T04 audit (2026-05-22)**: scenario-accuracy 12 + accuracyHelpers 17 = 29 PASS 재실행 carryover regression 0 — handoff §4.)

### KI-020 [open] SPA `did-navigate-in-page` 자동 인덱싱 누락

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M0 T05 사전 dual review codex NB-1)
- **Component**: `src/main/index.ts` (`createTabView` did-finish-load hook — 본 PR 에 박힘) + 잠재적 `did-navigate-in-page` 별도 hook 필요
- **영향**: Sprint 016 M0 T05 PR #176 의 자동 페이지 인덱싱 hook 은 `did-finish-load` 1종만 결합. SPA (React/Vue Single-Page App) 의 history.pushState 기반 in-page 네비게이션 (`did-navigate-in-page`) 시점에는 인덱싱 trigger 0 — 사용자가 SPA 내 URL 변경으로 콘텐츠 탐색해도 IndexedPageStore 에 누적 안 됨. 예: GitHub 의 issue → pull request 전환, Notion 의 페이지 전환.
- **재현 절차**: GitHub repository 페이지에서 issue 클릭 → URL 변경되나 페이지 reload 없음 → IndexedPageStoreSqlite.countPages() 증가 0
- **권고 해소 방향**: (1) `createTabView` 에 `did-navigate-in-page` hook 추가 + `runPageIndexing` 재호출 (debounce 500ms~1s, SPA 가 단기간 여러 번 navigate 가능 — 마지막 안정 URL 만 인덱싱). (2) `did-finish-load` 와 동일 path 재사용 가능 — IndexingService 의 recordVisit UPSERT + content_hash 매칭이 중복 차단. (3) iframe nav 는 무시 (sender frame === mainFrame check).
- **처리 예정 Sprint**: 016 M1 (시나리오 2 PM 경쟁 — GitHub/공식 docs SPA 흐름 cover 필요 시점) 또는 후속 hotfix
- **상태**: `open`

### KI-017 [closed] tabLabel.test.ts +2 워크스페이스 컨텍스트 회귀 누락

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T28 본 hotfix 시점 발견 — `v04-test-classification.md` §D PARTIAL 매트릭스 일정 "M6" 미이행)
- **Component**: `tests/unit/renderer/tabLabel.test.ts` (현 5 케이스 → 7) + `src/renderer/src/translation/tabLabel.ts` (워크스페이스 아이콘 prefix props)
- **영향**: PRD §11.2.1 워크스페이스 컨텍스트 (탭 라벨에 워크스페이스 아이콘 prefix 표시 — 이름은 `WorkspaceSidebar` 별도 표시) 시각 회귀 cover 부재. 시나리오 1·5 워크스페이스 격리 시각 검증 누락. KI-007 (TabManager workspace_id) 의존 — workspace_id prop 도입 후 +2 회귀.
- **재현 절차**: Sprint 016 M0 T03 진행 시 TabManager workspace_id 도입 직후 탭 라벨이 활성 워크스페이스 아이콘 prefix 표시. 본 회귀 셋 부재로 시각 미검증.
- **권고 해소 방향**: Sprint 016 T03 (KI-007 closed) 시점 동반 처리 — `tabLabel.test.ts`에 (1) workspace_id 매칭 시 **아이콘 prefix** 박힘 (2) workspace 미매칭/null/context 미주입 시 디폴트 라벨 fallback 2 케이스 추가. 라벨에 **이름은 박지 않음** (가독성 + 워크스페이스 사이드바 별도 표시로 중복 방지).
- **처리 예정 Sprint**: 016 T03 (KI-007 동반)
- **상태**: `closed` (Sprint 016 M0 T03b PR #172, 2026-05-19 — `formatTabLabel(t, workspaceContext?: { id, icon })` 시그니처 확장. 매칭 시 **아이콘 prefix 만** 표시 (이름은 `WorkspaceSidebar` 에서 별도 표시 — 가시성 정책 정합, codex PR #172 NEEDS_CHANGES 해소). 미매칭 / null / context 미주입 시 fallback 회귀 +2 (it 블록 2 + expect 5). UI wiring (TabBar 활성 ws 주입) 은 T03c 위임.)

### KI-021 [open] 워크스페이스 삭제 partition cleanup 실패 시 영구 잔존 reconcile path 부재

- **Severity**: LOW
- **Phase**: 2
- **Sprint**: 016 (M3 T16 사전 dual review codex NB-1)
- **Component**: `src/main/workspaceHandlers.ts` (`handleWorkspaceDelete` clearWorkspacePartition throw swallow path) + 잠재적 `WorkspacePartitionManager.reconcileOrphanPartitions()` 부재
- **영향**: DB cascade 성공 후 `partition.clearStorageData()` 실패 (디스크 IO / Electron session 비정상) 시 swallow + console.warn 처리. UX 차단 안 함 정책 (DB 삭제는 이미 성공) 은 정합이나, **다음 부팅 시점에 잔존 partition (cookies/storage/cache) 정리 reconcile path 부재** → 영구 잔존 위험. Privacy/storage usage 누적 가능.
- **재현 절차**: 워크스페이스 삭제 시점에 OS 디스크 full 또는 Electron session crash → `clearStorageData` throw → swallow → partition cleanup 누락. 재부팅 후 잔존 partition 확인 path 없음.
- **권고 해소 방향**: (1) `WorkspacePartitionManager.reconcileOrphanPartitions(activeWorkspaceIds: string[])` 신규 — DB 에 없는 partition 식별 + cleanup. (2) main process boot 시점 (initServices 후) 호출. (3) workspaces 테이블 vs `session.getStoragePath()` 결과 비교.
- **처리 예정 Sprint**: 016 종합 (T25) 또는 Phase 3 후속 hotfix
- **상태**: `open`

### KI-022 [open] Workspace Import 후 vec_pages / vec_notes 재계산 (embedding_queue 재 enqueue) 후속

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M3 T17 KI-008 closed 시점 분리 등록)
- **Component**: `src/main/WorkspaceExportImportService.ts` (`importWorkspace` 후 embedding_queue insert 미박힘) + `src/storage/EmbeddingQueue.ts` (재 enqueue path)
- **영향**: T17 Import 후 새 워크스페이스의 페이지/노트 본문이 모두 들어왔으나 **벡터 임베딩 (vec_pages / vec_notes) 은 export 대상 외** (derived data, model/dimension/sqlite-vec 버전 의존). 따라서 import 직후 시맨틱 검색 (검색바 Cmd+K) 이 import 된 페이지를 찾지 못함. 사용자 인지: 검색 결과 0건 + AutoIndex 미실행. 시나리오 4 (우연재발견) cover 감소.
- **재현 절차**: ws A export → ws B import → import 된 page A1 의 본문 키워드로 검색 → 결과 0건 (vec0 row 부재)
- **권고 해소 방향**: (1) `importWorkspace` 트랜잭션 안에서 모든 import 된 page/note 에 대해 `embeddingQueue.enqueue({type:'page', target_id: newPageId, workspace_id: newWorkspaceId, priority: 1})` 박음. (2) 또는 IPC handler 단에서 별도 step (보고: "임베딩 큐에 N 페이지 박음, 완료까지 약 N분"). (3) 사용자 동의 후 백그라운드 임베딩.
- **처리 예정 Sprint**: 016 종합 (T25) 또는 Phase 3 후속 hotfix
- **상태**: `open`

### KI-023 [open] HighlightStore PDF viewer 내부 selection DOM Range 캡처 미지원

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M4 T20 PR #215 evaluator KI 후보 1)
- **Component**: `src/perception/highlightAnchor.ts` (`serializeRange` / `deserializeAnchor`) + 호출자 (renderer overlay 후속 PR)
- **영향**: Chromium 내장 PDF viewer (`<embed>` / `<object>` plugin) 내부 selection 은 일반 DOM Range API 로 캡처 불가 — Range.startContainer 가 plugin 외부 element 또는 null. 본 PR `serializeRange` 가 `assertWithinRoot` 통해 throw 하지만 사용자 인지: PDF 페이지에서 하이라이트 기능 미동작. 시나리오 1 (논문 PDF 학습) 영향. 본 PR scope 명시 미지원 (commit body L24) — 호출자 책임. PDF 별도 path 필요.
- **재현 절차**: 사용자가 논문 PDF (`https://arxiv.org/pdf/XXX.pdf`) 열기 → 텍스트 선택 → 노트 하이라이트 trigger → serialize 시 throw 또는 anchor 부정확.
- **권고 해소 방향**: (1) UI 단 — PDF MIME 감지 시 하이라이트 버튼 비활성 + "PDF 는 지원 예정" 안내. (2) Phase 3 후속 R&D — PDF.js wrapper (pdfjs-dist) 기반 text layer 위에 별도 anchor schema (page_index + char_offset_in_page). (3) Chromium 내장 PDF viewer 의 selection API 노출 검토.
- **처리 예정 Sprint**: Phase 3 후속 R&D 또는 별도 PDF spike
- **상태**: `open`

### KI-024 [open] HighlightStore Shadow DOM cross-boundary range graceful fallback 부재

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M4 T20 PR #215 evaluator KI 후보 2)
- **Component**: `src/perception/highlightAnchor.ts` (`assertWithinRoot` L226-231 throw path)
- **영향**: Shadow DOM 안 (open / closed shadow root) 의 text 선택 시 Range.startContainer 가 root.contains() 외부 → `serializeRange` throw. 사용자 인지: 일부 사이트 (Notion / Slack web / 일부 SPA) 에서 하이라이트 미동작 + graceful fallback 없음. 본 PR throw 정책 정합이나 호출자 (renderer overlay) 가 사용자에게 안내 메시지 미전달 시 silent 실패.
- **재현 절차**: Shadow DOM 컴포넌트 (예: Notion 노트 본문) 안 텍스트 선택 → 하이라이트 trigger → console error 만, UI 무반응.
- **권고 해소 방향**: (1) renderer overlay 후속 PR 에서 try/catch + 사용자 toast "이 영역의 하이라이트는 미지원 — Shadow DOM" 표시. (2) Phase 3 후속 — open Shadow DOM 진입 path (root.shadowRoot.contains(node) 검사) + closed Shadow DOM 명시 미지원. (3) selection event listener 에서 사전 검사 + 버튼 비활성.
- **처리 예정 Sprint**: 016 후속 (renderer overlay PR) 또는 Phase 3
- **상태**: `open`

### KI-025 [open] HighlightStore contentHash 미일치 시 path 폐기 보수성 (사용자 데이터 회복률 영향)

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M4 T20 PR #215 evaluator KI 후보 3 + codex NB-1 / NB-3 / NB-5 통합 흡수)
- **Component**: `src/perception/highlightAnchor.ts` (`deserializeAnchor` L327-339 fallback 우선순위)
- **영향**: 현 `deserializeAnchor` — contentHash 일치 시 path fast path 시도, 불일치 시 path 완전 폐기 + fuzzy 만. 보수적 정책 (잘못된 path 복원 회피). 다만 사용자 입장 — 페이지 작은 변경 (오타 수정 1자, 광고 삽입) 시 contentHash 변경 → path 가 정답이어도 fuzzy 만 시도 → ambiguous 또는 prefix/suffix collision 시 복원 실패. 사용자 데이터 회복률 영향.
- **재현 절차**: ws A 에서 페이지 X 의 "quick brown fox" 선택 → 하이라이트 생성 → 페이지 X 다음 방문 시 새 광고 div 1개 추가 (contentHash 변경) → fuzzy 매칭 성공 시 OK, prefix/suffix 가 짧고 collision 시 실패.
- **권고 해소 방향**: (1) Phase 3 후속 — confidence score 노출 (high: contentHash + path / medium: path + selectedText / low: fuzzy / dropped: ambiguous). UI 에서 low/dropped 시 사용자에게 "위치 추정 — 검증 필요" 안내. (2) contentHash mismatch + path text 매칭 시 low-confidence 후보 유지 옵션. (3) codex NB-3 — element container path 의 canonicalize (start/end 모두 text node 우선) 가능. (4) codex NB-5 — `computeContextHash` delimiter U+241F 대신 `JSON.stringify([prefix, selectedText, suffix])` 또는 length-prefix 사용 시 collision 완전 차단.
- **처리 예정 Sprint**: Phase 3 후속 R&D
- **상태**: `open`

### KI-029 [open] migrateV04ToV05 의 sentinel-only idempotency — schema invariant self-healing 부재

- **Severity**: LOW
- **Phase**: 3
- **Sprint**: 017 (M1 T07 codex 019e4e82 NOTABLE #3)
- **Component**: `src/storage/migrations/v04_to_v05.ts:135~150`
- **영향**: `schema_meta.migration_v05_applied` sentinel 박힘 시 `already_migrated` skip 분기 — 단, sentinel 만 박혀 있고 `highlights` 테이블 또는 인덱스가 누락된 경우 (수동 DB 손상 / 부분 복구 / 향후 v06 transition 시 partial state) self-healing 없이 영구 skip. 정상 사용자 path 영향 X (sentinel + 마이그레이션 함수 단일 path 보장) — 다만 disaster recovery 시점 brittle.
- **재현 절차**: (1) v05 마이그레이션 완료 (`migration_v05_applied` 박힘) (2) 사용자가 DB 직접 편집 (`DROP TABLE highlights`) (3) 부팅 → `migrateV04ToV05` 가 `already_migrated` skip → highlights 테이블 영구 미생성.
- **권고 해소 방향**: (1) `already_migrated` 분기 진입 시점에 `sqlite_master.tbl_name='highlights'` + 4종 인덱스 존재 검사. (2) 불일치 시 sentinel 무시하고 마이그레이션 재진행 또는 `schema_invariant_failed` 상태 반환 + 사용자 알림. (3) 추가 회귀 — sentinel 박힘 + highlights 삭제 시나리오 cover.
- **처리 예정 Sprint**: Phase 3 M3 또는 후속 (MVP 직전 정리 batch)
- **상태**: `open`

### KI-028 [open] chatHandlers / ChatService / ai_chat_history 의 pageId/visitId nullable FK normalize 후속

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 017 (M0 T02 codex dual review threadId `019e4ade` Separate KI Candidate — 본 PR scope 확장 회피 + 별도 KI 등록 정합)
- **Component**: `src/main/chatHandlers.ts` L107 (`?? null` coalesce) + `src/main/ChatService.ts` L191 (동일) + `src/storage/schema/v04.sql` L86 (`ai_chat_history.page_id TEXT REFERENCES pages(id) ON DELETE SET NULL`)
- **영향**: KI-027 (note pageId/visitId normalize) 와 동일 구조 — chat 도 nullable FK 컬럼 `page_id` 사용. renderer 가 `chat:create` IPC 호출 시 `pageId: ''` 전달 시 KI-027 와 동일 위험 (FK 위반 회피 + cross-URL 조회 위험). Sprint 016 M5 시점 chat IPC 사용 빈도 (사용자가 페이지 컨텍스트로 채팅) 가 노트 대비 높을 가능성 — 우선순위 결정 필요.
- **재현 절차**: (1) renderer 가 `chatApi.create({ pageId: '' })` 호출 → ai_chat_history.page_id='' 저장. (2) `ChatService.listByPage(pageId='')` 시 record.page_id='' 매칭 → cross-page 노출 위험.
- **권고 해소 방향**: (1) `idNormalize.ts` 의 `normalizeOptionalId` helper 재활용 — chatHandlers + ChatService 양 site 적용 (KI-027 와 동일 패턴). (2) 단위 회귀 — `tests/unit/main/chatHandlers.test.ts` + `tests/unit/main/ChatService.test.ts` 에 normalize 회귀 추가. (3) Sprint 017 M0 또는 M2 (KI batch) 후속 PR.
- **처리 예정 Sprint**: 017 M0 후속 또는 M2
- **상태**: `open`

### KI-027 [closed] noteHandlers / NoteService / HighlightStore 의 pageId/visitId 빈 문자열 normalize 누락

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 017 (M0 T02 — Sprint 016 M5 T25 시점 신규 후보 박힘) → 017 M0 T02 본 PR 머지 시점 closed
- **Component**: `src/main/noteHandlers.ts` (IPC 경계) + `src/main/NoteService.ts` (서비스 경계) + `src/storage/HighlightStore.ts` (`add` / `listByPage`)
- **영향**: renderer / IPC caller / 직접 호출자가 `pageId: ''` / `visitId: ''` (또는 whitespace-only) 전달 시 `?? null` coalesce 만 적용되어 `''` 가 그대로 SQLite 컬럼에 저장 가능. `null` 과 `''` 의 의미 혼동 (둘 다 "미지정" 의도) + `HighlightStore.listByPage` 의 `filter.pageId != null` 분기가 `''` 를 "identity-present" 로 인정 → 잠재적 cross-URL 노출 (record.pageId='' 데이터와 매칭). 학습 데이터 기준 1431 단위 회귀 셋에서는 미발견 — 실 사용자 시나리오 (페이지 미발급 PDF / 빈 URL hash) 위험.
- **재현 절차**: (1) renderer 가 `noteApi.create({ pageId: '', visitId: '' })` 호출 → 이전: SQLite `notes.page_id=''` 저장. (2) `HighlightStore.add({ pageId: '' })` → record.pageId='' 저장. (3) `listByPage({ workspaceId, pageId: '' })` → record.pageId='' 매칭 → cross-page 노출 가능.
- **권고 해소 방향**: (1) **본 PR (Sprint 017 T02)** — `src/storage/idNormalize.ts` 신규 + `normalizeOptionalId(value): string | null` 호출 적용 (IPC 경계 → 서비스 경계 → storage 경계 3중 방어선). (2) 단위 회귀 — `tests/unit/storage/idNormalize.test.ts` (7 cover, 신규) + 기존 3 테스트 파일 (`noteHandlers` / `NoteService` / `HighlightStore`) 에 normalize 회귀 추가 (총 4 테스트 파일). (3) Sprint 016 M4 T20 codex hotfix 의 `!= null` 분기 후속 정합 (PR #215 cross-URL 노출 차단 보강).
- **처리 예정 Sprint**: 017 M0 T02
- **상태**: `closed` (Sprint 017 M0 T02 본 PR 머지 시점 — `idNormalize.ts` 신규 + 3 site 방어선 적용 + 회귀 +N)

### KI-026 [closed] Sprint 016 contract L62 "PRD §11.2.1 highlights" 표기 PRD 본문 불일치

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 016 (M4 T20 PR #215 evaluator KI 후보 4) → 016 M5 T24 옵션 B 채택 (`§11.11` 신설) → M5 T25 status `closed` 전환
- **Component**: `.flowset/contracts/sprint-016.md` L62 (S016-T20 산출물 표기) + 잠재적 `docs/prd/11_workspace.md` 본문 신규 섹션 (PR #215 머지 후 codex 사전 dual review threadId 019e4a3c NC #2 정합 — 실제 PRD §11 파일명 `11_workspace.md` + 기존 §11.5 워크스페이스 CRUD 박혀 있어 §11.5 신설 충돌)
- **영향**: contract L62 — "노트 하이라이트 (DOM anchor + 고정 위치 표시) — PRD §11.2.1 highlights". 실제 PRD §11.2.1 본문은 Phase 1 격리 (메타 단위) 표 (탭/페이지/AI/노트/태그) — highlight 본문 없음. PRD §4.3.4 Note.highlight_anchor 와 §16 roadmap 에는 박힘. contract 의 §11.2.1 표기 부정확 → 검증 시 PRD trace 어려움.
- **권고 해소 방향**: 옵션 (A) contract L62 표기를 "PRD §4.3.4 Note.highlight_anchor + §16 roadmap" 로 정정 (간단). 옵션 (B) `docs/prd/11_workspace.md` 의 **현 목차 기준 다음 빈 번호 (예: §11.11) 신설** — DOM anchor + UI overlay spec + W3C Range 시그니처 박음 (정합 강화). §11.5 는 이미 워크스페이스 CRUD 점유 → 충돌. 정확한 섹션 번호는 M5 T24 시점 PRD 목차 최종 확인 후 결정 (codex 권고 정합).
- **처리 예정 Sprint**: 016 M5 T24 (PRD v0.4.1 발행 시점 결정)
- **상태**: `closed` (Sprint 016 M5 T24 — 옵션 B 채택. `docs/prd/11_workspace.md` §11.11 Highlights 신설 7 sub-section (책임 / Anchor schema / HighlightRecord / deserialize 우선순위 / 미지원 KI-023~025 / Phase 별 구현 / SSOT 인용). contract L62 표기는 후속 contract patch PR 위임 (Sprint 017 정식화 시점).)

---

## 통계 (Phase 단위)

| Phase | HIGH 누적 | MEDIUM 누적 | LOW 누적 | 해소 | 잔여 |
|---|---|---|---|---|---|
| Phase 1 | 1 | 4 | 22 | **18** | **9** |
| Phase 2 | — | — | 1 | — | 1 |
| Phase 3 | — | — | 1 | — | 1 |

**Phase 1 closed 18 내역** (Sprint 017 M0 T03 시점 — KI-009 closed 반영 + T02 시점 LOW open carryover stale 정정):
- **HIGH closed 1**: KI-003 (Sprint 015 M5-5 BYOK wiring 완료, Sprint 016 M5 T25 status 자가 전환)
- **MEDIUM closed 1**: KI-007 (T03c #173)
- **LOW closed 16**: KI-002 (T12 #202) / KI-005 (T21 #210) / KI-008 (T17 #208) / **KI-009 (Sprint 017 M0 T03 — @testing-library/react + MemoryStatsPanel.test.tsx 10 케이스)** / KI-010 (T05 #176) / KI-011~016 (T06 perf bench, T25 — 6건) / KI-017 (T03b #172) / KI-018 / KI-019 (T23 #217 산식 cover, T25) / KI-026 (T24 §11.11 신설, T25) / KI-027 (Sprint 017 M0 T02 — `idNormalize.ts` 신규 + 3 site 방어선 적용)

**Phase 1 open 9 내역**:
- HIGH 0
- MEDIUM 3 (1 in-progress): KI-001 (in-progress, macOS PoC 1차 + 2차 matrix carryover) / KI-004 (response_format API-level, Sprint 017 M3 또는 carryover) / KI-006 (abort 정책 carryover)
- LOW 6: KI-020 (SPA did-navigate-in-page) / KI-022 (Import embedding_queue re-enqueue) / KI-023 (PDF viewer DOM range) / KI-024 (Shadow DOM cross-boundary) / KI-025 (contentHash 폐기 보수성, Phase 3 R&D) / KI-028 (chatHandlers/ChatService nullable FK normalize 후속, Sprint 017 M0 T02 codex separate KI candidate)

**Phase 2 잔여 1**: KI-021 (partition cleanup reconcile, Sprint 017 M2 T11 박음)

**Phase 3 잔여 1**: KI-029 (migrateV04ToV05 sentinel-only idempotency self-healing 부재, Sprint 017 M1 T07 codex 019e4e82 NOTABLE #3 — Phase 3 M3 또는 후속 batch)

**총 잔여 11** (Phase 1 9 + Phase 2 1 + Phase 3 1). Sprint 017 진행 누적 closed: T02 KI-027 + T03 KI-009 = **+2**. 신규 +2 (T02 KI-028 carryover + T07 KI-029 신규).

---

## 참조

- 가드레일: `.flowset/guardrails.md` (KI vs 가드레일 구분 — 가드레일 = 절대 규칙, KI = 일시적 약점)
- 검증 정책: `.flowset/specs/v04-direction.md` §12 (검증 흐름 + Severity 정의)
- Sprint 015 contract: `.flowset/contracts/sprint-015.md` §6 (evaluator 통과 기준)

## 변경 이력

- 2026-05-16: 등록 정책 + Severity 정의 + KI 형식 초기 등록 (Sprint 015 진입 시점, KI 0건)
- 2026-05-18 (M3 종료 핫픽스): KI-001 MEDIUM (sqlite-vec macOS 미검증) + KI-002 LOW (PageCachePanel PARTIAL) 등록. evaluator + codex 병렬 평가에서 추출. Sprint 015 누적 0건 → 2건 (KI 등록 정책 본격 발동).
- 2026-05-18 (M4-2 핫픽스): KI-003 HIGH (G-003 BYOK wiring 강제) + KI-004 MEDIUM (ChatRequest.response_format JSON 강제 API-level) 등록. M4-2 codex 정밀 검토 KI 후보 1/2 추출. Sprint 015 누적 2건 → 4건. HIGH 첫 등록 — M4-5 wiring 시점 즉시 처리 정책 적용.
- 2026-05-19 (M5-7 핫픽스): KI-005 LOW (AutoTagger.tagPage page_tags FK 위반 — NoteService note 자동 태깅 차단) 등록. PR #159 codex 정밀 검토 N-001 발견. NoteService 가 autoTagger 통합 자체 제거로 안전 차단. Sprint 015 누적 4건 → 5건. KI-003 HIGH wiring 완료 — M5-3b/M5-5/M5-6/M5-7 에 BYOK 검증 박힘 (status `in-progress` 갱신 후보, Sprint 016 또는 M5-8 분할 2편 시점 closed 권고).
- 2026-05-19 (M6 T28~T31 종합): KI-006 MEDIUM (Workspace 전환 abort 정책 미배선) + KI-007 MEDIUM (TabManager workspace_id stash/restore) + KI-008 LOW (Workspace JSON Export/Import) + KI-009 LOW (MemoryStatsPanel React unit 0) + KI-010 LOW (MemoryStats 인덱싱 broadcast 잔여 1종) + KI-011 LOW (MemoryStats < 20ms 미측정) 6건 등록. T28 + T29 evaluator + codex 병렬 평가에서 추출. Sprint 015 누적 5건 → 11건. MEDIUM 누적 4건 도달 (KI-001 + KI-004 + KI-006 + KI-007) — 5건 batch 임계 1건 부족. Sprint 016 M0 처리 권고.
- 2026-05-19 (Sprint 015 잔여 hotfix — `docs/WI-S016M0-docs-sprint-015-residual-hotfix`): KI-012 LOW (인덱싱 < 500ms 미측정) + KI-013 LOW (검색 < 200ms 미측정) + KI-014 LOW (워크스페이스 전환 < 1초 미측정) + KI-015 LOW (임베딩 비용 < $3/월 미측정) + KI-016 LOW (저장 용량 < 200MB/만 페이지 미측정) + KI-017 LOW (tabLabel.test.ts +2 워크스페이스 컨텍스트 회귀 누락) 6건 등록. Sprint 015 M6 T31 종합 evaluator NB ("정량 임계 5종 KI 미등록") + 본 hotfix `v04-test-classification.md` §D PARTIAL 매트릭스 회귀 누락 검증에서 추출. Sprint 015 누적 11건 → **17건** (HIGH 1 / MEDIUM 4 / LOW 12). 정량 임계 5종은 Sprint 016 M0 perf bench 셋 신규로 일괄 측정 권고. KI-017 은 KI-007 (Sprint 016 T03) 동반 해소.
- 2026-05-19 (PR #167 Sprint 016 contract 시안 → 정식 — `docs/WI-S016M0-docs-contract-formalize`): KI-018 LOW (top-10 hit rate ≥ 80% 정확도 미측정) + KI-019 LOW (AI 응답 출처 정확도 ≥ 90% 미측정) 2건 등록. codex BLOCKING #1+#2 — PRD §15.4 정량 임계 6종 중 #3 top-10 hit rate + #6 AI 출처 정확도 누락 발견. KI-013 본문 "top-5 retrieval" → "top-10 표시" PRD §9.7 b6.1 정합 정정 동반. Sprint 015 누적 17건 → **19건** (HIGH 1 / MEDIUM 4 / LOW 14). 본 2건은 Sprint 016 M0 T06 perf/회귀 infra (시나리오 30 케이스 chat_meta.cells.sources 산식 + 50 페어 자체 hit rate 셋) 일괄 측정.
- 2026-05-19 (Sprint 016 M0 T03b PR #172 — KI-017 closed): `formatTabLabel` 시그니처 확장 `(t, workspaceContext?: WorkspaceLabelContext | null)` + 매칭 시 `${icon} ${base}` prefix + 미매칭/null/context 미주입 시 fallback. tabLabel.test.ts +2 회귀 (매칭 + 미매칭 매트릭스 3 case). UI wiring (TabBar 활성 ws 주입) 은 T03c 위임. Phase 1 해소 0 → **1** / 잔여 19 → **18** (HIGH 1 / MEDIUM 4 / LOW 13).
- 2026-05-19 (Sprint 016 M0 T03c PR #173 — KI-007 closed): `TabManager.setActiveWorkspaceFilter` + `activeTabByWorkspace` stash map + `backfillUnassignedWorkspaceId` + `listAll` / `snapshotAll` + `handleWorkspaceSwitch` `onWorkspaceSwitched` callback path + `services.setWorkspaceSwitchHook` + `tab:open` 시 active ws 자동 박힘 + `initializeTabs` backfill + TabBar workspace context 주입 + `workspaceApi.onSwitched` broadcast. 회귀 +7 (TabManager 4 + workspaceHandlers 3). Phase 1 해소 1 → **2** / 잔여 18 → **17** (HIGH 1 / MEDIUM 3 / LOW 13). KI-007 분할 옵션 A 3편 (T03a #171 + T03b #172 + T03c #173) 모두 머지 후 closed.
- 2026-05-19 (Sprint 016 M0 T05 PR #176 — KI-010 closed + KI-020 신규): `IndexingGate` (UserSetting.privacyExclusions getter wiring) + `IndexingService` 인스턴스화 + `createIndexingBroadcastHandler` factory 함수로 onStatusChange wiring 추출 (status='indexed' 시 `broadcastMemoryInvalidated(payload.workspaceId)`) + `IndexingStatusPayload.workspaceId` 추가 + main/index.ts `createTabView` did-finish-load 에 `runPageIndexing` 헬퍼 (scanWebContentsFields + ParagraphExtractor.executeJavaScript + tryIndexPage, http/https allowlist 선필터, graceful try/catch) + tryIndexPage / getParagraphsExtractScript export. 회귀 +12 (IndexingService.test.ts +7 workspaceId payload + indexingBroadcast.test.ts +5 broadcast wiring). dual review evaluator Pass 8/8 / codex NEEDS_CHANGES 1 + NB-5 본 PR hotfix 흡수. NB-1 (SPA did-navigate-in-page 인덱싱 누락) **KI-020 LOW 신규 등록**. Phase 1 해소 2 → **3** / 잔여 17 → **17** (KI-010 closed -1 + KI-020 신규 +1 = 동수, HIGH 1 / MEDIUM 3 / LOW 13).
- 2026-05-21 (Sprint 016 M4 T21 — KI-005 closed): `AutoTagger.tagNote(input: TagNoteInput)` 신규 + private `tagContent(input, attach)` helper 추출 (DRY) + tagStore.attachToNote 호출 path. NoteService.opts.autoTagger optional + createNote(enableAutoTagging=true + autoTagger 주입 시) tagNote 호출, 그 외 'not_called'. 회귀 +20 (AutoTagger.test.ts +11: tagNote 9 케이스 + tagPage maxOutputTokens 회귀 1 + parseTagsResponse 1 / NoteService.test.ts +9: enableAutoTagging path 7 + autoTagger 미주입 safety 1 + codex NEEDS_CHANGES #1 try/catch autoTagger throw 격리 1). 부가 hotfix: TagInputBase.maxOutputTokens → ChatRequest.maxOutputTokens 실 전달 (Sprint 015 M4-2 NB-1 잔존 정정). dual review evaluator Pass 7/Partial 1 (G-018 PR body 산출물 표 net vs gross 정합 권고) / codex NEEDS_CHANGES 1 (autoTagger throw 시 createNote 자체 throw 위험 → try/catch 격리 + autoTaggingStatus='failed') + NB 다수 모두 본 PR hotfix 흡수. Phase 1 해소 3 → **4** / 잔여 17 → 16 (HIGH 1 / MEDIUM 3 / LOW 12) + Phase 2 잔여 누계 0 → 1 (KI-021 M3 T16 누락분 정합 흡수, HIGH 0 / MEDIUM 0 / LOW 1). 총 잔여 17건.
- 2026-05-21 (Sprint 016 M4 T20 — PR #215 머지 후 본 docs PR): KI-023 LOW (HighlightStore PDF viewer 미지원) + KI-024 LOW (Shadow DOM graceful fallback 부재) + KI-025 LOW (contentHash 미일치 시 path 폐기 보수성 — codex NB-1/NB-3/NB-5 통합 흡수) + KI-026 LOW (contract L62 표기 PRD §11.2.1 불일치) 4건 등록. T20 PR 머지 후 evaluator + codex 권고 batch — 본 feature PR 안 박지 않고 docs PR 에서 통합 등록 (codex 사후 협의 threadId 019e4a2b 권고 정합). 본 docs PR 내 사전 dual review hotfix 흡수 (codex threadId 019e4a3c NC #1 — KI 통계 산식 재집계): Phase 1 LOW 누적 14 → **20** (closed 5 + open 15 — 본 신규 4건 박음 후) + closed 4 → **6** (KI-007 MEDIUM closed M0 T03c + KI-010 LOW closed M0 T05 직전 누계 누락분 명시) / Phase 1 잔여 16 → **19** / Phase 2 잔여 1 유지 / 총 누적 22 → **26 (4 신규)** / 총 잔여 17 → **20**. KI-025 본문에 codex NB-1 (fallback ordering) + NB-3 (element container path canonicalize) + NB-5 (U+241F delimiter → JSON.stringify) sub-section 통합 흡수. KI-026 PRD 경로 `11_phase_1_isolation.md` → `11_workspace.md` 정정 + §11.5 신설 충돌 회피 (`§11.11` 또는 T24 시점 결정 위임).
- 2026-05-21 (Sprint 016 M5 T23 PR #217 머지 후 T24/T26/T25 본 docs PR — v0.4.1 발행 + Sprint 017 시안 + KI batch status 변동): **KI-018 / KI-019 closed 후보 status 변동** (Sprint 016 M5 T23 scenario-accuracy 신규 통합 회귀 30 케이스 산식 cover 완성 — `tests/integration/scenarios/scenario-accuracy.test.ts` +13 회귀 + `tests/unit/scenarios/accuracyHelpers.test.ts` +5 회귀). **KI-011/012/013/014/015/016 closed 후보 status 변동** (Sprint 016 M0 T06 perf bench infra 6/8 PASS + 2/8 DEFERRED 후 본 M5 시점 카르오버 정합 — `.flowset/eval-results/sprint-016-perf-bench.md` baseline 박음, KI-014 abort wiring 후 재측정 0.283ms → 0.581ms 정합). **KI-003 status `open` → `closed`** (Sprint 015 M5-5 BYOK wiring 완료 자가 status 전환). KI-026 PRD §11.11 Highlights 신설 (T24 시점 옵션 B 결정) → closed. **Phase 1 closed 6 → 15** (HIGH 0 → 1 + LOW closed 5 → 14, MEDIUM closed 1 유지). **Phase 1 잔여 19 → 10** (KI-001 in-progress / KI-004 / KI-006 / KI-009 / KI-020 / KI-022 / KI-023 / KI-024 / KI-025 / 신규 후보 — drainUntil helper / pageId='' validation / freeform fallback). 신규 후보 3건은 Sprint 017 M0 T01/T02/T13 박음 (시안). 총 잔여 20 → **11** (Phase 1 10 + Phase 2 1). 본 docs PR 내 evaluator + codex 병렬 dual review 강제.
