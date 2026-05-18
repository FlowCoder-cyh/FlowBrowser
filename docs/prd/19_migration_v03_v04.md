# 19. v0.3 → v0.4 마이그레이션 (Migration)

> [← PRD 목차](./README.md)

본 섹션은 v0.3 → v0.4 전환 종합 매핑 — 모듈 분류 (A1) + 데이터 마이그레이션 (A3) + 회귀 셋 (A2) + 단계별 PR (A4). M0 사전 분석 4종 산출물을 본 PRD 발행 시점에 통합 인용.

## 19.1 M0 사전 분석 4종 (Sprint 015 M0 완료, PR #99~#102)

| # | 산출물 | 파일 |
|---|---|---|
| A1 | 폐기 코드 식별 매트릭스 | [`.flowset/specs/v04-migration-matrix.md`](../../.flowset/specs/v04-migration-matrix.md) |
| A2 | 단위 테스트 분류 + 시나리오 회귀 셋 | [`.flowset/specs/v04-test-classification.md`](../../.flowset/specs/v04-test-classification.md) |
| A3 | 데이터 마이그레이션 분석 | [`.flowset/specs/v04-data-migration.md`](../../.flowset/specs/v04-data-migration.md) |
| A4 | 의존 그래프 분석 | [`.flowset/specs/v04-dependency-graph.md`](../../.flowset/specs/v04-dependency-graph.md) |

본 §19 는 4 산출물을 PRD 본문에 통합 인용 — PRD v0.4 SSOT 단일 진입점.

## 19.2 모듈 매핑 (A1 §A~§E 인용)

### 19.2.1 DEPRECATE (6 모듈)

| 모듈 | 사유 | 일정 |
|---|---|---|
| `src/perception/TranslationRenderer.ts` | replace/overlay displayMode 폐기 | M5 (호출지점 ChatPanel 도입 후) |
| `src/ai/SummarizationPlanner.ts` | 페이지 요약 use case 폐기 | M2 (즉시) |
| `src/renderer/src/settings/DisplayModePanel.tsx` | translationMode 옵션 폐기 (b4.1 정정) | M5 |
| `src/renderer/src/settings/GlossaryPanel.tsx` | Glossary → Note 마이그레이션 후 폐기 | M5 |
| `src/renderer/src/translation/TranslationPanel.tsx` | ChatPanel 대체 | M5 |
| `src/renderer/src/translation/TranslationPopup.tsx` | NotePanel + 컨텍스트 메뉴 대체 | M5 |

### 19.2.2 GENERALIZE (4 모듈, b7.1 정정 포함)

| 기존 | 신규 | 일정 |
|---|---|---|
| `src/storage/TranslationCache.ts` | `src/storage/AIResponseCache.ts` (kind: translation/embedding/ai_response/tag) | M2 어댑터 → M5 제거 |
| `src/storage/PageResultStore.ts` | `src/storage/IndexedPageStore.ts` (Page+Visit + 본문 캐시) | M2 어댑터 → M5 제거 |
| `src/ai/ProviderAdapter.ts` (PR b7.1 정정) | translate() → chat/embed/chatStream 메서드 분리 (M2~M5 점진) | M2~M5 |
| `src/storage/UsageLog.ts` (PR b7.1 정정) | feature enum 변경 + workspaceId/model/durationMs 컬럼 추가 | M3 schema 마이그레이션 |

### 19.2.3 KEEP (25 모듈, 변경 없음)

| 카테고리 | 모듈 |
|---|---|
| Codex OAuth (4) | `src/ai/codex/DeviceCodeFlow.ts` / `JwtDecoder.ts` / `SseStreamParser.ts` / `src/ai/providers/CodexLoginProvider.ts` |
| Provider 추상 (1) | `src/ai/providers/OpenAIApiKeyProvider.ts` (단 M3 embed 메서드 추가) |
| DOM 추출 (2) | `src/perception/ParagraphExtractor.ts` (M3-13 보존) / `src/perception/PageNodeExtractor.ts` |
| Tab UX (3) | `src/main/TabManager.ts` (M6 workspace_id 메타 추가 PARTIAL) / `src/main/ClosedTabHistory.ts` / `src/main/ThumbnailStore.ts` + `ThumbnailDiskStore.ts` |
| Privacy (7) | `src/privacy/*.ts` 7 모듈 ([§13 §13.2.1](./13_security_privacy.md#1321-실제-모듈-v03-keep-a1-c-정합)) |
| Storage KEEP (1) | `src/storage/Credentials.ts` (G-005 safeStorage) |
| UI shell (5) | `src/renderer/src/UrlBar.tsx` / `TabBar.tsx` / `App.tsx` (M5 PARTIAL — ChatPanel 교체) / `Consent.tsx` / `OnboardingTour.tsx` (M6 PARTIAL) |
| Settings (2) | `src/renderer/src/settings/SettingsPage.tsx` (M5 PARTIAL) / `GeneralPanel.tsx` (M5 PARTIAL — translationMode 옵션 제거) |

### 19.2.4 PARTIAL (21 모듈, 일부 변경)

[A1 §D](../../.flowset/specs/v04-migration-matrix.md) 정합. 주요:
- `src/main/index.ts` — IPC 폐기 9 + 신규 indexing/embedding/search/chat/note/workspace/shortcut/memory 추가
- `src/main/services.ts` — IPC 폐기 12 + 신규 ChatService/NoteService/WorkspaceService/IndexingService/SearchService/EmbeddingClient 연결
- `src/preload/index.ts` — API 폐기 4 묶음 + 신규 8 묶음
- `src/storage/TabStateStore.ts` — workspace_id 메타
- `src/renderer/src/translation/tabGuard.ts` → `src/main/TabGuard.ts` (위치 이동)
- (생략 — A1 §D 본문 참조)

### 19.2.5 NEW (30+ 모듈, A1 §E)

| 카테고리 | 모듈 |
|---|---|
| Storage (11) | IndexedPageStore / VectorIndex / PageContentCache / AIResponseCache / WorkspaceStore / NoteStore / AiChatHistoryStore / TagStore / EmbeddingQueue / migrations/v03_to_v04 / schema/v04.sql |
| AI (3) | embedding/EmbeddingClient / tagging/AutoTagger / PromptComposer |
| Main (7) | IndexingService / ChatService / SearchService / NoteService / WorkspaceService / DwellTracker / Shortcut |
| Privacy (1) | IndexingGate |
| Search (1) | TimeRangeParser |
| Renderer (9, PR b5.1 정정 — ShortcutSettings 추가) | SearchBar / SearchResultCard / PreviewPane / ChatPanel / NotePanel / WorkspaceSidebar / WorkspaceSettings / ShortcutSettings / MemoryStatsPanel |

**총 32 NEW 모듈**.

## 19.3 데이터 마이그레이션 (A3 §A 인용)

[`v04-data-migration.md §A`](../../.flowset/specs/v04-data-migration.md) — 5 영속 파일 매핑:

| v0.3 파일 | v0.4 매핑 | 키 정책 |
|---|---|---|
| `translation-cache.json` | AIResponseCache (`flowbrowser.db` 또는 `ai-response-cache.json`) | kind=translation 부여, 폐기 requestType skip |
| `page-results.json` | IndexedPageStore Page + Visit | workspace_id="📥 기본", content 빈값, 임베딩 큐 등록 |
| `glossary.json` | Note (P0-1) | ai_tags=["glossary", domain prefix], page_id·visit_id NULL, created_by='migration' |
| `user-setting.json` translationMode / cancelOnTabSwitch | 자동 제거 (P0-2) | translationMode·cancelOnTabSwitch 폐기 (b4.1 정정 정합) |
| `tabs.json` | TabState workspace_id 메타 추가 | 모든 탭에 "📥 기본" 부여 |

### 19.3.1 마이그레이션 5단계 (G-014, A3 §B 인용)

```
Step 1: 자동 백업
  mkdir -p <userDataDir>/backup/v03/<ISO_timestamp>/
  cp <userDataDir>/{translation-cache,page-results,glossary,user-setting,tabs}.json → backup/v03/<ts>/

Step 2: Dry-run (in-memory SQLite)
  매핑 시뮬레이션 + 통계 로그 + 오류 throw → revert

Step 3: 실제 마이그레이션 (단일 TX)
  flowbrowser.db 생성 + v04.sql schema 적용
  "📥 기본" Workspace INSERT
  Glossary N → Note N
  Cache M → AIResponseCache M (translation kind)
  PageResult K → Page K + Visit K + 임베딩 큐
  Setting 폐기 키 제거 + 신규 키 디폴트
  Tabs workspace_id 부여

Step 4: 원본 처리
  *.json → *.deprecated.json (30일 후 자동 삭제 검토)

Step 5: 로그 + 알림
  <userDataDir>/migration-v04.log 기록
  Notification "이전 데이터를 v0.4로 마이그레이션 완료 (N건)"
```

### 19.3.2 revert 절차 (실패 시)

```
오류 발생 시:
  - <userDataDir>/flowbrowser.db 삭제
  - .deprecated.json → .json 복원 (또는 backup/v03/<ts>/ 에서 복사)
  - migration-v04.log [error] + stack trace + revert 기록
  - 사용자 알림 "마이그레이션 실패, 이전 데이터 복구. log 참조"
  - 다음 앱 시작 시 idempotent 재시도
```

## 19.4 회귀 셋 (A2 §E1 인용)

[§18 §18.3](./18_evaluation.md#183-시나리오-회귀-셋-18-케이스) 본문 — 시나리오 4개 × 평균 4.5 케이스 = 18 케이스. 마이그레이션 회귀 케이스 8 추가 ([A3 §B5](../../.flowset/specs/v04-data-migration.md)):

| # | 마이그레이션 회귀 케이스 |
|---|---|
| 1 | 빈 데이터 (fresh install, 5 파일 모두 없음) → flowbrowser.db 생성 + "📥 기본" Workspace |
| 2 | GlossaryStore 3 terms → Note 3 (ai_tags 정확성) |
| 3 | TranslationCache 매핑 (translation kind 부여, 폐기 requestType skip) |
| 4 | PageResultStore 매핑 (Page + Visit 정확, workspace_id 부여) |
| 5 | UserSettingStore 폐기 키 제거 + 신규 키 디폴트 |
| 6 | TabStateStore 모든 탭 workspace_id 부여 |
| 7 | Dry-run 오류 시 revert (flowbrowser.db 생성 X + 백업 보존) |
| 8 | Idempotent (동일 마이그레이션 두 번 실행 시 두 번째 skip) |

`tests/unit/storage/migrations/v03_to_v04.test.ts` 위치.

## 19.5 단계별 PR (A4 §E 인용, 약 33 PR)

[A4 §E](../../.flowset/specs/v04-dependency-graph.md) 정합:

### 19.5.1 M2 폐기 + 일반화 (8 PR)

```
M2-1 ✅ AIResponseCache 신규 + TranslationCache 어댑터 + feature flag (PR #122 — UserSetting.v04Enabled + FLOWBROWSER_V04 env + AIResponseCache 4 kind / 17 테스트 + TC adapter 회귀 10 테스트 + featureFlags 7 테스트 + UserSetting v04 4 테스트 + codex 핫픽스 (peek/parseEntry/LRU 주석) 14 테스트, +52 단위 테스트)
M2-2 ✅ IndexedPageStore base 신규 + PageResultStore 어댑터 (PR #123) — Page + Visit 분리 + workspace_id (DEFAULT_WORKSPACE_ID='default') + content_hash dedupe + visited_count denormalized + cascade DELETE + side-write 어댑터 + **recordVisit() 단일 TX 원자 메서드 (PRD §05.4.1 정합, codex 핫픽스)** + parseEntry epoch-ms Integer 검증 + Visit↔Page workspace 동기화 검증 + sideWriteFailureCount 관측 가능성 (+49 단위 = 30 IndexedPageStore + 10 PRS.adapter + 9 codex 핫픽스)
M2-3 ✅ SummarizationPlanner DEPRECATE 마킹 (PR #124) — @deprecated JSDoc (모듈 헤더 + planChunks + summarizeChunks + main IPC handler 2개 (`translate:summarize-page` / `translate:summarize-abort`) + preload API 2개 (`summarizePage` / `abortSummarize`)) + 호출 시 main process stderr 에 모듈 lifetime 1회 warn (호출 폭주 방지 모듈 flag, production 포함 — Electron stderr 사용자 노출 X). 코드 동작 v0.3 100% 보존. 대체: ChatPanel + RAG retrieval (M5+, PRD §10.1 채팅 파이프라인). M2-4 에서 IPC handler + 모듈 + 단위 테스트 18개 제거 / M5 에서 UI 분기 (`TranslationPanel.tsx` mode='summary') 제거. (+4 신규 단위 = deprecation 회귀 4 케이스, 누적 459 → 463 / 35 모듈)
M2-4 ✅ translate:summarize-* IPC 폐기 + SummarizationPlanner 모듈 제거 + UI 분기 사전 정리 (PR #125) — 실제 제거 단계. (1) `src/ai/SummarizationPlanner.ts` 226 lines 모듈 삭제 + 단위 테스트 22 케이스 제거 (`SummarizationPlanner.test.ts` 18 + `.deprecate.test.ts` 4) / (2) `src/main/index.ts` IPC handler 2개 (`translate:summarize-page` / `translate:summarize-abort`) + import + `summarizeAborted` flag + send 4종 (`summary-start` / `summary-done` / `summary-error` / `summary-aborted`) 제거 / (3) `src/preload/index.ts` API 2개 (`summarizePage` / `abortSummarize`) + listener 4개 (`onSummary{Start,Done,Error,Aborted}`) + Payload 타입 4종 제거 / (4) `src/renderer/src/translation/TranslationPanel.tsx` summary 분기 사전 정리 (Mode 'summary' 제거 / SummaryState / handleStartSummary / "페이지 요약" 버튼 / UI 블록 제거, 잔여 mode='paragraph'|'page' 2종으로 축소) — M5 TranslationPanel→ChatPanel 전환 시 자연 흡수. (5) **codex/evaluator 핫픽스 (본 PR 내 정정)** — `src/renderer/src/styles.css` `.panel-summary*` / `.panel-chunk*` 13 스타일 dead style 제거 + 제거 마킹 주석 축약 (strict grep 오탐 해소). selection 요약 (popup `handleContextMenuSummarize` + RequestType 'summary' + PopupMode 'summary') 은 SummarizationPlanner 미사용이라 유지. (-22 단위 = 463 → 441 / 33 모듈, 회귀 0)
M2-5 ✅ translate:paragraphs / page IPC 폐기 (handler 4개) + TranslationPanel 이행 stub 화 + CSS dead style 정리 (PR #126) — 페이지 번역 use case 폐기. (1) `src/main/index.ts` IPC handler 4개 (`translate:paragraphs` / `paragraphs-abort` / `page` / `page-abort`) + `paragraphsAborted` / `pageTranslateAborted` flag 2종 + send 10종 (`paragraphs-{start,error,paragraph-progress,done,aborted}` 5 + `page-{start,progress,done,aborted,error}` 5, evaluator F 핫픽스 — 9→10 정정) 제거 / `cancelOnTabSwitch` 분기 + same-tab navigate abort 분기 제거 (M4 IndexingService 재정의 예정) / unused import (`extractWebContentsParagraphs` / `persistPageResult` / `getUserSetting`) 정리 / (2) `src/preload/index.ts` API 4개 (`paragraphs` / `abortParagraphs` / `page` / `abortPage`) + listener 10개 (`onParagraphsStart` / `onParagraphProgress` / `onParagraphsDone` / `onParagraphsAborted` / `onParagraphsError` 5 + `onPageStart` / `onPageProgress` / `onPageDone` / `onPageAborted` / `onPageError` 5, evaluator F 핫픽스 — 9→10 정정) + Payload 타입 11종 (`ParagraphsRequest` + `Paragraphs{Start,Progress,Done,Aborted,Error}Payload` 5 + `Page{Start,Progress,Done,Aborted,Error}Payload` 5) 제거 / (3) `src/renderer/src/translation/TranslationPanel.tsx` 549 lines → 36 lines 이행 stub 으로 완전 재작성 — open=true 시 단순 안내 표시 ("페이지 번역 → v0.4 ChatPanel 전환 중") + M2-6 render/renderRestore 제거 후 M5 ChatPanel 신규 시 파일 자체 삭제. selection 번역 (popup `handleContextMenuTranslate` + RequestType 'selection' + PopupMode 'translation') 은 본 IPC 미사용이라 유지. `tabGuard.ts` / `tabLabel.ts` 단위 테스트 + 모듈 보존 (M5 ChatPanel 에서 재활용 결정). 단위 테스트 441 유지 (paragraphs/page 모듈 단위 테스트 없었음) / JS bundle 323.67 → 307.30 kB (-16.37 kB / -5%)
M2-6 ✅ translate:render / render-restore / pageResult:restore-current IPC 폐기 (handler 3개) + TranslationRenderer 모듈 완전 폐기 + TranslationPanel 파일 자체 삭제 + App.tsx panelOpen state 제거 (PR #127) — (1) `src/main/index.ts` IPC handler 3개 (`translate:render` / `translate:render-restore` / `pageResult:restore-current`) 제거 + 관련 import (`renderTranslationsScript` / `restoreOriginalsScript` / `RenderPayload` / `nodesSignatureFromTexts` / `extractWebContentsPageNodes` / `pageResultLookup`) 정리 / (2) `src/preload/index.ts` API 3개 (`translateApi.render` / `translateApi.renderRestore` / `pageResultApi.restoreCurrent`) 제거 — `translateApi` 본체가 `request` 단일 메서드로 축소 / (3) `src/renderer/src/translation/TranslationPanel.tsx` 파일 자체 삭제 (M2-5 stub) / (4) `src/renderer/src/App.tsx` TranslationPanel import + `panelOpen` state + `setPanelOpen` helper + UrlBar `onTogglePanel` / `panelOpen` props 전달 모두 제거 (M5 ChatPanel 도입 시 동일 자리 추가) / (5) `src/perception/TranslationRenderer.ts` 모듈 완전 폐기 + 단위 테스트 (`tests/unit/perception/TranslationRenderer.test.ts` 12 케이스) 삭제 / (6) **codex 핫픽스 (본 PR 내 정정)** — `src/renderer/src/styles.css` `.translation-panel` / `.panel-header` / `.panel-title` / `.panel-close` / `.panel-empty` 5 dead style 제거 / (7) **evaluator D Partial 핫픽스** — 본 §19.5.1 M2-5 본문 누락 복원 + M2-6 placeholder 중복 제거. selection 번역 (popup) 은 본 IPC 미사용이라 유지. `panel:set-open` IPC handler + `browserApi.setPanelOpen` API 는 WebContentsView 가시성 토글 용도라 유지 (M5 ChatPanel 재사용). 단위 테스트 441 → 429 (-12) / 모듈 33 → 32 (-1) / JS bundle 307.30 → 305.80 kB (-1.5 kB), 회귀 0
M2-7 ✅ ai/index.ts + types.ts + ProviderAdapter PARTIAL (chat/embed 메서드 추가 시작) (PR #128) — (1) `src/ai/types.ts` 신규 타입 추가 — ChatMessage / ChatRequest / ChatResponse / EmbedRequest / EmbedResponse. ProviderInfo 에 supportsChat / supportsEmbed optional flag / (2) `src/ai/ProviderAdapter.ts` 인터페이스 확장 — chat / embed / chatStream optional 메서드 + translate @deprecated 마킹 (M5-8 시점 본문 자체 제거 contract 정합) / (3) `src/ai/providers/OpenAIApiKeyProvider.ts` chat (chat completions API, gpt-4o-mini 디폴트) + embed (text-embedding-3-small, 1024 차원 디폴트, $0.02/M 비용 추정 2026-05-16 공식) 구현 + HTTP status → ProviderError 매핑 helper (throwForHttpStatus) / (4) `src/ai/providers/CodexLoginProvider.ts` chat (Responses API, system → instructions 분리 + multi-turn input 직렬화 + assistant role 의 content type='output_text' 변환) 구현 + embed throw ProviderError(unsupported) (ChatGPT 백엔드 임베딩 미공개) + supportsChat: true / supportsEmbed: false / (5) `src/ai/index.ts` 신규 타입 5종 export / (6) **codex 통합 핫픽스 (본 PR 내 정정)** — Codex chat 401 refresh 1회 재시도 + 성공 path 테스트 추가 (codex 버킷 분배 정정 — Codex chat 3→4) / §19.5.4 M5-5 에 `executeTranslateRequest` → `ChatService.chat()` 마이그레이션 contract 추가 (codex E) + §19.5.4 M5-8 에 `ProviderAdapter.translate()` final 제거 + `fetchImpl` 주입 통일 contract 추가 (codex F). (+20 단위 = 429 → 449 / 모듈 33, ProviderAdapter.test.ts 20 케이스 — OpenAI chat 7 + OpenAI embed 6 + Codex chat 4 + Codex embed 1 + supportsChat/Embed flag 2)
M2-8 ✅ v0.3 단위 테스트 재작성 + services.ts dead export cleanup — M2 마지막 PR (PR #129) — (1) v0.3 단위 테스트 3 파일 제거 (`TranslationCache.test.ts` 15 + `TranslationCache.lru.test.ts` 3 + `PageResultStore.test.ts` 16) — v0.4 신규 테스트가 M2-1/M2-2 에서 이미 작성됨 (AIResponseCache.test 29 / TranslationCache.adapter.test 12 / IndexedPageStore.test 38 / PageResultStore.adapter.test 11 — 합계 90 케이스, evaluator D 핫픽스 — 본 PR 의뢰서 codex 핫픽스 추가 합산 표기 오류 정정) / (2) `src/main/services.ts` dead export cleanup — `persistPageResult` / `pageResultLookup` / `extractWebContentsPageNodes` / `extractWebContentsParagraphs` 4 helper 함수 제거 + `pageResult:lookup` / `pageResult:store` IPC handler 2개 제거 + `nodesSignatureFromTexts` / `extractParagraphsScript` / `extractPageNodesScript` / `validatePageNodes` / `PageNodeBundle` import 정리 / (3) `src/preload/index.ts` `pageResultApi.lookup` / `store` API 2개 + `PageResultLookupArgs` / `PageResultEntryPayload` 타입 2종 제거 / (4) `src/storage/PageResultStore.ts` `nodesSignatureFromTexts` 함수 자체 제거 + `src/storage/index.ts` export 정리 / (5) **codex 핫픽스 (자체 적용 완료)** — services / preload / storage 4 파일의 잔여 제거 마킹 주석에서 deprecated 심볼명 (`persistPageResult` / `pageResultLookup` / `extractWebContentsPageNodes` / `extractWebContentsParagraphs` / `nodesSignatureFromTexts` / `pageResultApi.lookup` / `pageResultApi.store` 7개) 제거 (strict grep 0 정합) / (6) **codex NB-F 핫픽스** — TranslationCache.adapter.test 에 legacy no-backend (v0.3 디폴트) 회귀 케이스 2건 추가 (persistence + TTL + LRU 최소 cover) — v0.3 테스트 제거로 인한 backend 미주입 path 회귀 검증 보완. 보존: `pageResult:stats` / `pageResult:clear` IPC + PageCachePanel (M5 어댑터 제거 시 함께 폐기) / `pageResultStore` 인스턴스 (legacy backend 미주입 JSON 모드, 어댑터 경로는 클래스 spec + .adapter.test 에 보존) / `perception/ParagraphExtractor` + `PageNodeExtractor` 모듈 (M3 IndexingService 활용 예정) / `scanWebContentsFields` (selection 번역 popup 사용). (-34 단위 + 2 codex NB-F = 449 → 417 / 모듈 33 → 30, 회귀 0)
```

### 19.5.2 M3 IndexedPageStore + 임베딩 + 마이그레이션 (7 PR + 진입 spike)

```
M3-spike ✅ sqlite-vec 30분 PoC (Windows) — better-sqlite3 12.10.0 + sqlite-vec 0.1.9 + Electron 39 ABI rebuild 6/6 PASS. in-memory fallback 미발동 결정 박힘. macOS 검증 보류 (KI 후보). `.flowset/specs/m3-spike-decisions.md` (PR #131)
M3-1 ✅ SQLite v04.sql schema + 통합 DB 진입점 (FlowbrowserDatabase 모듈) — PRD §04.3 9 entity (workspaces/pages/visits/notes/ai_chat_history/tags/page_tags/note_tags/schema_meta) + §04.5 인덱스 9개 + §04.3.8 vec_pages/vec_notes 2 vec0 virtual table + PRAGMA foreign_keys/journal_mode WAL + ensureDefaultWorkspace("📥 기본") + CHECK 제약 (role 4 / status 4 / created_by 2 / tag kind 6) + CASCADE DELETE 정합 + sqlite-vec partition isolation (workspace_id 격리 검증). 신규 의존: better-sqlite3@^12.10.0 / sqlite-vec@^0.1.9 / @electron/rebuild@^4.0.4 / @types/better-sqlite3@^7.6.13. `npm run rebuild` script 추가. PRD §04.3.8 partition_key → partition key 정정 (M3-spike 결과 인용). +25 단위 테스트 (417 → 442)
M3-2 sqlite-vec native module 빌드 검증 + VectorIndex (대안: in-memory fallback)
M3-3 IndexedPageStore 확장 (Page + Visit + 본문 캐시 content_hash dedupe)
M3-4 NoteStore / AiChatHistoryStore / TagStore / EmbeddingQueue
M3-5 EmbeddingClient (text-embedding-3-small 1024 차원, BYOK 디폴트)
M3-6 migrations/v03_to_v04.ts + dry-run + revert + 8 회귀 케이스
M3-7 UsageLog GENERALIZE schema 마이그레이션 + PageCachePanel PARTIAL
```

### 19.5.3 M4 인덱싱 hook + 자동 태깅 + Privacy + dwell (5 PR)

```
M4-1 IndexingService (did-finish-load hook + 재방문 정책)
M4-2 AutoTagger (Tag.kind 6종, BYOK 디폴트, JSON schema)
M4-3 DwellTracker (탭 활성 + focus)
M4-4 IndexingGate (Privacy 11 패턴 + 비밀번호 필드 + override)
M4-5 M4 회귀 테스트 (S1 자동 인덱싱 + S3 Visit 누적)
```

### 19.5.4 M5 검색 + 채팅 + 노트 + 어댑터 제거 (8 PR)

```
M5-1 Shortcut (Cmd+K 글로벌, 사용자 설정) + SearchBar UI
M5-2 TimeRangeParser (자연어 5종)
M5-3 SearchService (정렬 0.85 cosine + 0.15 exp(-days/180))
M5-4 SearchResultCard + PreviewPane (M5 후순위)
M5-5 PromptComposer (수준 분기) + ChatService (retrieval + 출처 인용) + **services.ts `executeTranslateRequest` 호출자 → `ChatService.chat()` 마이그레이션** (M2-7 codex E 권고: ProviderAdapter.translate() @deprecated 정합. M2-6 시점 services.ts 본인 export 잔존 분석 동반)
M5-6 ChatPanel (TranslationPanel 교체) + chat_meta 표 schema
M5-7 NoteService + NotePanel (선택 → AI 자동 태그 → 3중 anchor + 임베딩)
M5-8 TranslationRenderer / DisplayModePanel / GlossaryPanel / TranslationPanel / TranslationPopup 호출지점 모두 제거 + 어댑터 제거 + **ProviderAdapter.translate() 메서드 자체 제거** (M2-7 @deprecated → M5 종료 시 final 제거) + **fetchImpl 주입 통일** (OpenAIApiKeyProvider 가 현재 globalThis.fetch 직접 사용 — Codex 와 동일하게 constructor 옵션화, M2-7 codex F 권고)
```

### 19.5.5 M6 워크스페이스 + 메모리 통계 (5 PR)

```
M6-1 WorkspaceStore + WorkspaceService (CRUD + 전환)
M6-2 WorkspaceSidebar (좌측 패널, preset 12종 + 사용자 이모지)
M6-3 WorkspaceSettings (사용자 수준 R3-A) + GeneralPanel PARTIAL
M6-4 MemoryStatsPanel (좌하단) + TabManager / TabStateStore PARTIAL (workspace_id 메타)
M6-5 OnboardingTour PARTIAL (v0.4 카드 갱신) + Sprint 015 종합 핸드오프 + state/handoffs/known-issues 갱신 + PRD v0.4.0 정식 발행
```

**총 33 PR** (M2 8 + M3 7 + M4 5 + M5 8 + M6 5).

## 19.6 Sprint 015 진행 통계 (PR b10 시점)

| 단계 | PR 범위 | 누적 |
|---|---|---|
| Sprint 014 종료 | #76~#97 (Codex OAuth + 15 핫픽스) | 22 |
| Sprint 015 진입 | #98 | 23 |
| M0 사전 분석 | #99~#102 (A1~A4) | 27 |
| M0 evaluator 권고 | #103 | 28 |
| M1 PRD v0.4 작성 (현재) | #104~#119 (b1~b9 + 핫픽스 7회) | 44 |
| **M1 마지막 PR b10 (본 PR)** | #120 | **45** |
| M2~M6 (예정) | 약 33 PR | ~78 |

## 19.7 G-014 마이그레이션 안전망

본 마이그레이션은 G-014 가드레일 적용:
- **dry-run + 자동 백업** + revert 경로
- **5단계 절차** 명시 (§19.3.1)
- **idempotent** (재시도 안전)
- **회귀 테스트 8 케이스** (§19.4)

## 19.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §17 (마이그레이션 결정) + §19 (전환 종합)
- `.flowset/specs/v04-migration-matrix.md` (A1)
- `.flowset/specs/v04-test-classification.md` (A2)
- `.flowset/specs/v04-data-migration.md` (A3)
- `.flowset/specs/v04-dependency-graph.md` (A4)
- `.flowset/contracts/sprint-015.md` (M0~M6)
- [§04 §4.6 마이그레이션 매핑](./04_data_model.md#46-실패재시도-시나리오)
- [§17 KI 정책](./17_known_issues_policy.md) + [§18 §18.4 측정 protocol](./18_evaluation.md#184-측정-protocol)

본 §19 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 19.9 변경 이력

- 2026-05-16 (PR b10): stub → 본문 작성. M0 사전 분석 4 산출물 통합 인용 + 모듈 매핑 (DEPRECATE 6 / GENERALIZE 4 b7.1 정정 / KEEP 25 / PARTIAL 21 / NEW 32) + 데이터 마이그레이션 5단계 (G-014 안전망) + revert 절차 + 회귀 셋 8 케이스 + 단계별 PR 33개 (M2 8 / M3 7 / M4 5 / M5 8 / M6 5) + Sprint 015 진행 통계 (45 PR 누적).
