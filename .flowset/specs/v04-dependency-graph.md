# A4 — 의존 그래프 분석 (v0.3 → v0.4)

> **M0 사전 분석 산출물 4/4**
> Sprint 015 contract `S015-T04` 산출물.
> 입력: A1 폐기 매트릭스 + A2 테스트 분류 + A3 데이터 마이그레이션
> 출력: PRD §06 (architecture) + Sprint 015 M2~M6 단계별 PR 순서 + IPC 채널 변경 영향 매트릭스

## 메타

- **작성일**: 2026-05-16
- **분석 범위**: IPC channels (main/index.ts + main/services.ts) + preload APIs + renderer 호출지점
- **결정 SSOT**: `.flowset/specs/v04-direction.md` §17 (박힌 결정) + `.flowset/specs/v04-migration-matrix.md` §F (단계별 PR 전략)

## 통계 요약

| 영역 | 폐기 | 일반화 (어댑터) | 유지 | 신규 |
|---|---|---|---|---|
| **IPC 채널 (main + services)** | 19 | 4 (cache/pageResult) | 47 | 20~25 |
| **preload API 묶음** | 4 (cacheApi / pageResultApi / glossaryApi / translateApi) | 0 | 약 10 | 8 (indexing/search/chat/note/workspace/shortcut/embedding/tagging) |
| **renderer 호출지점 (window.*Api)** | 약 60 | — | 약 80 | (신규 panel) |

→ Sprint 015 contract §3 AC-3 표현 "IPC 6개 폐기 + 15개+ 신규" → **정정: IPC 19개 폐기 + 20~25개 신규**.

---

## A. IPC 채널 폐기·일반화 매트릭스 (19개 폐기)

### A1. `src/main/index.ts` 폐기 (10개)

| 채널 | 라인 | 사유 | 신규 대체 | 일정 |
|---|---|---|---|---|
| `translate:render` | L778 | TranslationRenderer DEPRECATE | (없음, ChatPanel 출력은 React 렌더 직접) | M5 (ChatPanel 도입 후) |
| `pageResult:restore-current` | L799 | PageResultStore→IndexedPageStore, restore use case 폐기 | `search:retrieve` (신규) | M5 |
| `translate:render-restore` | L851 | TranslationRenderer DEPRECATE | — | M5 |
| `translate:paragraphs-abort` | L870 | paragraphs/page 작업 폐기 | `indexing:abort` (신규) | M2 (호출지점 stub) + M5 (완전 제거) |
| `translate:paragraphs` | L875 | 동상 | `indexing:enqueue` (자동 호출, IPC 노출 안 함) | M2 + M5 |
| `translate:page-abort` | L988 | 동상 | `indexing:abort` | M2 + M5 |
| `translate:page` | L993 | 동상 | (없음, 인덱싱 자동) | M2 + M5 |
| `translate:summarize-abort` | L1125 | SummarizationPlanner DEPRECATE | — | M2 |
| `translate:summarize-page` | L1135 | 동상 | — | M2 |

### A2. `src/main/services.ts` 폐기 (9개)

| 채널 | 사유 | 신규 대체 | 일정 |
|---|---|---|---|
| `cache:clear-all` | TranslationCache → AIResponseCache 일반화 | `ai-response-cache:clear-all` (어댑터 경유 후 신규) | M2 (어댑터) + M5 (신규 직접) |
| `cache:stats` | 동상 | `ai-response-cache:stats` | M2 + M5 |
| `pageResult:clear` | PageResultStore → IndexedPageStore | `indexed-page:clear` | M2 + M5 |
| `pageResult:stats` | 동상 | `indexed-page:stats` (메모리 통계 UI에 연결) | M2 + M5 |
| `glossary:list` | GlossaryStore DEPRECATE (Note로 마이그레이션) | `note:list` (신규) | M5 (마이그레이션 후) |
| `glossary:add` (services.ts L153 부근) | 동상 | `note:create` | M5 |
| `glossary:remove` | 동상 | `note:delete` | M5 |
| `glossary:update` | 동상 | `note:update` | M5 |
| `glossary:export` | 동상 | (Export = Phase 3) | M5 (제거) |
| `glossary:clear` | 동상 | `note:clear` | M5 |
| `glossary:version` | 동상 | (없음) | M5 |
| `translate:request` | 단발 번역 use case 폐기 | `chat:request` (신규, RAG retrieval 포함) | M5 |

소계: services.ts 12개 폐기 (위에 11개 + L242 부근 추가 분기). 정확 카운트는 M2 PR에서 정정.

### A3. 유지 (실측 코드 grep 56개, PR b4 §06 정확 매핑)

**카운트 출처**: PR b4 (2026-05-16) 실측 grep `ipcMain.handle(` 결과 — main/index.ts 33개 - 폐기 9개 = **24개**, services.ts 44개 - 폐기 12개 = **32개**. 합 56개.

PR b3.1 시점 "47개" 표기는 본 갱신으로 **56개** 정정 (G-012 SSOT 갱신).

#### `src/main/index.ts` (24개)
- `tab:list/open/close/switch/active/reorder/close-others/close-right/duplicate/set-color/set-pinned/get-thumbnail/reopen/reopen-size/show-context-menu` (15개) — PARTIAL: TabManager workspace_id 메타 (T28)
- `panel:set-open` / `app:set-view-visible` / `navigate/go-back/go-forward/reload/get-current-url/browser:get-view-id/browser:nav-state` (9개)

#### `src/main/services.ts` (32개)
- `codex:start-login/cancel-login/poll-status/logout/status` (5개)
- `consent:get/give/revoke` (3개)
- `credential:save/delete/list/validate` (4개)
- `privacy:add-rule/remove-rule/get-rules/approve/scan-page/blocked-stats/clear-policy` (7개)
- `usage:list/summary/clear-all/purge-older-than` (4개)
- `userSetting:get/update` (2개, PARTIAL — schema 변경)

#### 신규 IPC (20~25개, M3~M6)

```
M3:
  indexing:enqueue (internal, did-finish-load hook 자동 호출)
  indexing:status (워크스페이스별 진행 카운트)
  indexing:abort (탭 닫기 / 워크스페이스 전환 시)
  embedding:enqueue (internal)
  embedding:status

M4:
  tagging:apply (자동 태깅 + 사용자 수동 호출)

M5:
  search:query (자연어 시간 + 의미 + 워크스페이스 필터)
  search:get-content (본문 캐시 fetch)
  chat:request (워크스페이스 메모리 retrieval + Provider 호출)
  chat:history (워크스페이스별 AiChatHistory list)
  chat:clear (워크스페이스 단위 삭제)
  note:create / note:update / note:delete / note:list / note:get
  shortcut:get-bindings / shortcut:set-binding

M6:
  workspace:create / workspace:switch / workspace:delete / workspace:list / workspace:get-current
  memory:stats (워크스페이스별 N건 인덱싱 / 마지막 N분 / 노트 M개 / +AI 메모)
```

대략 21개 신규.

---

## B. preload API 매트릭스

### B1. 폐기 (4개 묶음, 약 50+ 메서드)

| 묶음 | 폐기 위치 | 대체 | 어댑터 |
|---|---|---|---|
| `cacheApi` (preload L175) | M5 | `aiResponseCacheApi` (신규) | M2 어댑터 (window.cacheApi → 내부 ai-response-cache:* 호출) |
| `pageResultApi` (preload L207) | M5 | `indexedPageApi` (신규) | M2 어댑터 |
| `glossaryApi` (preload L267) | M5 | `noteApi` (신규) | (어댑터 없음, 마이그레이션 후 호출지점 모두 제거) |
| `translateApi` (preload L418) | M5 | `chatApi` (신규, conversation 영속) | (어댑터 없음, ChatPanel로 완전 교체) |

### B2. 유지 (약 10개 묶음)

- `tabApi` / `navigateApi` / `panelApi` / `appApi` / `browserApi` / `codexApi` / `consentApi` / `credentialApi` / `privacyApi` / `usageApi` / `userSettingApi`

userSettingApi는 PARTIAL (schema 변경, M3 마이그레이션).

### B3. 신규 (8개 묶음, M3~M6)

```
M3:
  indexingApi (status, abort)
  embeddingApi (status)
  aiResponseCacheApi (stats, clear-all)
  indexedPageApi (stats, clear)

M4:
  taggingApi (apply)

M5:
  searchApi (query, get-content)
  chatApi (request, history, clear)
  noteApi (CRUD)
  shortcutApi (get-bindings, set-binding)

M6:
  workspaceApi (CRUD, switch, current)
  memoryApi (stats)
```

---

## C. renderer 호출지점 매트릭스 (약 60개 폐기 + 약 80개 유지)

### C1. 폐기 호출지점 (M5에서 모두 제거)

| 파일 | 라인 | 호출 | 영향 |
|---|---|---|---|
| `src/renderer/src/settings/GlossaryPanel.tsx` | L54~L135 | `window.glossaryApi.*` 8개 | 패널 전체 DEPRECATE (M5 SettingsPage 라우팅 제거) |
| `src/renderer/src/settings/PageCachePanel.tsx` | L13~L22 | `window.pageResultApi.stats/clear` | PARTIAL — `window.indexedPageApi`로 교체 또는 MemoryStatsPanel 통합 |
| `src/renderer/src/translation/TranslationPanel.tsx` | L128~L451+ | `window.translateApi.*` / `window.pageResultApi.*` 약 30개 | 파일 자체 DEPRECATE (ChatPanel로 교체, M5) |
| `src/renderer/src/translation/TranslationPopup.tsx` | (전체) | `window.translateApi.*` | DEPRECATE (선택 영역 번역 폐기, M5) |
| `src/renderer/src/settings/DisplayModePanel.tsx` | (전체) | `window.userSettingApi.update({translationMode})` | DEPRECATE (M5) |
| `src/renderer/src/App.tsx` | (TranslationPanel/Popup 진입점) | TranslationPanel import + 컨텍스트 메뉴 호출 | PARTIAL (M5 ChatPanel 교체) |
| `src/renderer/src/settings/SettingsPage.tsx` | (Glossary/DisplayMode 라우팅) | 라우팅 entry 2개 | PARTIAL (M5) |
| `src/renderer/src/settings/GeneralPanel.tsx` | (translationMode select) | `window.userSettingApi.update` | PARTIAL (M3 마이그레이션 + M5 신규 옵션) |

소계: 약 60개 호출지점 폐기 (TranslationPanel.tsx 단일에 약 30개 집중).

### C2. PARTIAL 호출지점 (M3 마이그레이션 시 보존)

| 파일 | 변경 | 일정 |
|---|---|---|
| `src/renderer/src/onboarding/OnboardingTour.tsx` | Glossary 카드 제거 + 워크스페이스 안내 카드 추가 | M6 |
| `src/renderer/src/settings/GeneralPanel.tsx` | translationMode 옵션 제거 + workspaceDefault / userLevelPreference / shortcutOverride 옵션 추가 | M3 마이그레이션 + M5 |
| `src/renderer/src/TabBar.tsx` | 워크스페이스 컨텍스트 (tabLabel 호출 시 workspace 메타 전달) | M6 |

### C3. 유지 호출지점 (약 80개)

대부분의 tab/navigate/panel/codex/consent/credential/privacy/usage 호출지점은 변경 없음.

---

## D. 마이그레이션 트리거 위치 (services.ts 진입)

A3 데이터 마이그레이션 트리거 코드 삽입 위치:

```typescript
// src/main/services.ts (현 라인 약 110)
export async function rebuildAllStores(userDataDir: string): Promise<void> {
  // ← v0.4 마이그레이션 트리거 (T15 신규)
  await checkAndRunMigration(userDataDir)  // M3 신규 hook

  // 어댑터 mode (v0.3 호환, M5 종료 시 제거)
  if (!isV04Enabled()) {  // feature flag (S3)
    translationCache = new TranslationCache(defaultTranslationCachePath(userDataDir))
    pageResultStore = new PageResultStore(defaultPageResultPath(userDataDir))
    // ...
  } else {
    // v0.4 신규 stores
    indexedPageStore = new IndexedPageStore(defaultDbPath(userDataDir))
    aiResponseCache = new AIResponseCache(...)
    workspaceStore = new WorkspaceStore(...)
    noteStore = new NoteStore(...)
    aiChatHistoryStore = new AiChatHistoryStore(...)
    tagStore = new TagStore(...)
    vectorIndex = new VectorIndex(...)
    pageContentCache = new PageContentCache(...)
    embeddingQueue = new EmbeddingQueue(...)
    // ...
  }

  // 기존 KEEP stores (변경 없음)
  glossaryStore = new GlossaryStore(...)  // M5 종료 시 제거 (마이그레이션 후 호출 0)
  userSettingStore = new UserSettingStore(...)  // PARTIAL schema
  tabStateStore = new TabStateStore(...)  // PARTIAL workspace_id 메타
}
```

---

## E. 단계별 PR 순서 (G-013 적용, A1 §F 갱신 + 의존 그래프 반영)

### M2 (8 PR)

| PR | 작업 | 핵심 |
|---|---|---|
| M2-1 | AIResponseCache 신규 + TranslationCache 어댑터 | feature flag |
| M2-2 | IndexedPageStore base 신규 + PageResultStore 어댑터 | feature flag |
| M2-3 | SummarizationPlanner DEPRECATE (test 18 제거) | services.ts 분기 제거 |
| M2-4 | translate:summarize-* IPC 폐기 (handler 2개 제거) | preload translateApi.summary* 폐기 |
| M2-5 | translate:paragraphs / page IPC 폐기 (handler 4개 제거) | preload translateApi.paragraphs/page* 폐기 (UI 호출지점은 stub 유지) |
| M2-6 | translate:render / render-restore / pageResult:restore IPC 폐기 (handler 3개 제거) | preload translateApi.render* / pageResultApi.restore* 폐기 |
| M2-7 | ai/index.ts + ai/types.ts PARTIAL (export 정리) | SummarizationPlanner export 제거 |
| M2-8 | TranslationCache.test → AIResponseCache.test 재작성 + PageResultStore.test → IndexedPageStore.test 재작성 base | (확장은 M3에서) |

### M3 (7 PR)

| PR | 작업 | 핵심 |
|---|---|---|
| M3-1 | SQLite v04.sql schema + 통합 DB 진입점 | flowbrowser.db 생성 |
| M3-2 | sqlite-vec native module 빌드 검증 + VectorIndex wrapper (R1 대안: in-memory fallback) | Windows/macOS 둘 다 |
| M3-3 | IndexedPageStore 확장 (Page + Visit + 본문 캐시) | content_hash dedupe |
| M3-4 | NoteStore / AiChatHistoryStore / TagStore / EmbeddingQueue | 모두 v04.sql 테이블 |
| M3-5 | EmbeddingClient (text-embedding-3-small, BYOK 디폴트) + 백그라운드 큐 (활성 탭 우선) | G-003 강화 |
| M3-6 | migrations/v03_to_v04.ts (Glossary→Note + Cache→AIResponseCache + PageResult→IndexedPage + settings 폐기 키 + tabs workspace_id + 자동 백업) | dry-run + revert + 8 회귀 케이스 |
| M3-7 | PageCachePanel / UserSettingStore PARTIAL (마이그레이션 케이스) | 신규 키 디폴트 |

### M4 (5 PR)

| PR | 작업 | 핵심 |
|---|---|---|
| M4-1 | IndexingService (did-finish-load hook + 재방문 정책) | content_hash 비교 |
| M4-2 | AutoTagger (Tag.kind 6종, BYOK 디폴트) | JSON 응답 파싱 + freeform fallback |
| M4-3 | DwellTracker (탭 활성 + focus) | focus 잃으면 일시정지 |
| M4-4 | IndexingGate (Privacy 인덱싱 차단 디폴트 list + 비밀번호 필드 감지) | G-004 강화 |
| M4-5 | M4 회귀 테스트 (시나리오 1 자동 인덱싱 + 시나리오 3 Visit 누적) | top-3 hit rate |

### M5 (8 PR)

| PR | 작업 | 핵심 |
|---|---|---|
| M5-1 | Shortcut (Cmd+K 글로벌, 사용자 설정) + SearchBar UI | shortcutApi 신규 |
| M5-2 | TimeRangeParser (자연어 5종) | tests 8 케이스 |
| M5-3 | SearchService (정렬 공식 0.85 × cosine + 0.15 × exp(-days/180)) + Page+Note retrieval (R1) | 시나리오 4 회귀 |
| M5-4 | SearchResultCard + PreviewPane (제목 + URL + 발췌 + 시간 시그널) | 클릭 시 본문 캐시 + 노트 + AI 대화 복원 |
| M5-5 | PromptComposer (수준 분기) + ChatService (retrieval + 출처 인용) | system prompt 분기 |
| M5-6 | ChatPanel (TranslationPanel 교체) + 표 schema (Markdown + JSON 메타) | App.tsx PARTIAL |
| M5-7 | NoteService + NotePanel (선택 → AI 자동 태그 → 3중 anchor + 임베딩) | 컨텍스트 메뉴 추가 |
| M5-8 | TranslationRenderer / DisplayModePanel / GlossaryPanel / TranslationPanel / TranslationPopup 호출지점 모두 제거 + 어댑터 (TranslationCache / PageResultStore) 제거 | 28 PR 중 가장 큰 정리 |

### M6 (5 PR)

| PR | 작업 | 핵심 |
|---|---|---|
| M6-1 | WorkspaceStore + WorkspaceService (CRUD + 전환) | "📥 기본" 자동 생성 |
| M6-2 | WorkspaceSidebar (좌측 패널, preset 12종 + 사용자 이모지) | 전환 시 탭·메모리·AI 컨텍스트·노트 교체 |
| M6-3 | WorkspaceSettings (사용자 수준 선택 R3-A) + GeneralPanel PARTIAL | system prompt 분기 |
| M6-4 | MemoryStatsPanel (좌하단) + TabManager / TabStateStore PARTIAL (workspace_id 메타) | 실시간 갱신 |
| M6-5 | OnboardingTour PARTIAL (v0.4 카드) + Sprint 015 종합 핸드오프 + state/handoffs/known-issues 갱신 + PRD v0.4.0 정식 발행 | 종료 evaluator 진입 |

**총 33개 PR (M2 8 + M3 7 + M4 5 + M5 8 + M6 5)** — A1 §F의 "약 28 PR" 보다 정밀화 (정정).

---

## F. IPC 채널 변경 영향 매트릭스 (요약)

### F1. main 프로세스 변화 라인 수 (예상)

| 파일 | 폐기 | 신규 | net |
|---|---|---|---|
| `src/main/index.ts` | 약 700 lines (translate:* handlers + helper 함수) | 약 200 lines (indexing/embedding/abort hook) | **-500** |
| `src/main/services.ts` | 약 200 lines (cache/pageResult/glossary/translate handlers) | 약 300 lines (search/chat/note/workspace/memory handlers) | **+100** |
| `src/preload/index.ts` | 약 300 lines (cacheApi/pageResultApi/glossaryApi/translateApi) | 약 250 lines (8 신규 API) | **-50** |

→ 전체 main 영역 -450 lines (정리 효과).

### F2. renderer 변화 라인 수 (예상)

| 파일 | 폐기 | 신규 | net |
|---|---|---|---|
| `src/renderer/src/translation/*` | 약 1000 lines | 0 | **-1000** |
| `src/renderer/src/settings/GlossaryPanel.tsx` | 약 200 lines | 0 | **-200** |
| `src/renderer/src/settings/DisplayModePanel.tsx` | 약 80 lines | 0 | **-80** |
| `src/renderer/src/App.tsx` | 약 100 lines | 약 200 lines (워크스페이스 사이드바 + 검색바 진입점) | **+100** |
| `src/renderer/src/chat/ChatPanel.tsx` | 0 | 약 500 lines (신규) | **+500** |
| `src/renderer/src/search/*` | 0 | 약 400 lines (신규) | **+400** |
| `src/renderer/src/workspace/*` | 0 | 약 400 lines | **+400** |
| `src/renderer/src/note/NotePanel.tsx` | 0 | 약 300 lines | **+300** |
| `src/renderer/src/memory/MemoryStatsPanel.tsx` | 0 | 약 150 lines | **+150** |

→ 전체 renderer net +570 lines.

### F3. storage 변화

| 파일 | 폐기 | 신규 | net |
|---|---|---|---|
| `src/storage/GlossaryStore.ts` | 약 300 lines | 0 | **-300** |
| `src/storage/TranslationCache.ts` | 약 280 lines | (어댑터로 약 80 lines 유지 후 M5 제거) | -200 → -280 |
| `src/storage/PageResultStore.ts` | 약 250 lines | (어댑터로 약 80 lines 유지) | -170 → -250 |
| `src/storage/IndexedPageStore.ts` | 0 | 약 500 lines | **+500** |
| `src/storage/VectorIndex.ts` | 0 | 약 200 lines | **+200** |
| `src/storage/AIResponseCache.ts` | 0 | 약 250 lines | **+250** |
| `src/storage/WorkspaceStore.ts` | 0 | 약 300 lines | **+300** |
| `src/storage/NoteStore.ts` | 0 | 약 250 lines | **+250** |
| `src/storage/AiChatHistoryStore.ts` | 0 | 약 200 lines | **+200** |
| `src/storage/TagStore.ts` | 0 | 약 150 lines | **+150** |
| `src/storage/EmbeddingQueue.ts` | 0 | 약 200 lines | **+200** |
| `src/storage/PageContentCache.ts` | 0 | 약 150 lines | **+150** |
| `src/storage/migrations/v03_to_v04.ts` | 0 | 약 400 lines | **+400** |
| `src/storage/schema/v04.sql` | 0 | 약 100 lines | **+100** |

→ 전체 storage net +약 2000 lines (신규 SQLite 통합 DB 도입 영향).

---

## G. 리스크 / 미지수

1. **main/index.ts 약 700 lines 폐기** — 한 PR로 처리 시 diff 폭증 + 호출지점 깨짐. M2 PR을 5개로 쪼개기 (M2-4/M2-5/M2-6) — 채널 단위 별도 PR.
2. **TranslationPanel.tsx 약 1000 lines 폐기 + ChatPanel 약 500 lines 신규** — M5-6에서 한 PR로 교체. 양쪽 동시 렌더 후 점진 제거 옵션 (feature flag S3).
3. **services.ts 마이그레이션 진입점** — `checkAndRunMigration()` hook 위치가 잘못되면 신규 stores가 v0.3 데이터를 못 봄. M3-6 PR에서 진입점 위치 + idempotent 검증 필수.
4. **paragraphsAborted / pageTranslateAborted / summarizeAborted 전역 변수** — 폐기 시점에 다른 함수에서 참조하면 빌드 깨짐. T04 grep으로 호출지점 모두 식별 → M2-5에서 일괄 제거.
5. **TabManager workspace_id 메타** — TabStateStore.tabs[].workspaceId schema 추가가 v0.3 데이터 마이그레이션 (A3 A5)와 동기화. M3-6 마이그레이션이 M6 TabManager 변경 전에 완료되어야 함.
6. **renderer/translation/tabGuard.ts 위치 이동** — `src/main/TabGuard.ts`로 이동 시 renderer 호출지점 (App.tsx, TabBar.tsx 등) 모두 수정. A2 PARTIAL 항목 + M2 PR 분리 권고.

---

## H. M0 종료 요약 (A1 + A2 + A3 + A4)

### M0 사전 분석 4종 산출물

| # | 산출물 | 위치 | 상태 |
|---|---|---|---|
| A1 | 폐기 매트릭스 | `.flowset/specs/v04-migration-matrix.md` | ✅ PR #99 머지 |
| A2 | 테스트 분류 + 회귀 셋 | `.flowset/specs/v04-test-classification.md` | ✅ PR #100 머지 |
| A3 | 데이터 마이그레이션 | `.flowset/specs/v04-data-migration.md` | ✅ PR #101 머지 |
| A4 | 의존 그래프 | `.flowset/specs/v04-dependency-graph.md` | (본 PR) |

### Sprint 015 M1 (PRD v0.4) 진입 준비도

- 데이터 모델 (PRD §04) ← A3 마이그레이션 매핑 + A1 신규 컴포넌트
- CRUD 매트릭스 (PRD §05) ← A4 IPC 매트릭스
- Architecture (PRD §06) ← A1 분류 + A4 호출지점
- Indexing (PRD §08) ← A4 신규 IPC + IndexingService 의존
- Migration (PRD §19) ← A3 + A4 통합

추측 입력 0건. M1 진입 가능.

### Sprint 015 contract 갱신 권고 (M1에 묶음)

1. AC-3 표현 "IPC 6개 폐기 + 15개+ 신규" → **"IPC 19개 폐기 + 20~25개 신규"** (A4 정정)
2. AC-8 산식 → `358 − 49 + 26 + 16 + 98~138 = 431~471` (A2 정정, 이미 반영됨)
3. 단계별 PR 수 "약 28 PR" → **"M2 8 + M3 7 + M4 5 + M5 8 + M6 5 = 33 PR"** (A4 §E 정정)
4. §15 S4 표기 정정 — `~/.flowbrowser/backup/v03/` → `<userDataDir>/backup/v03/<ISO_ts>/` (A3 §C)

### Known Issue 0건

본 M0 진행 중 발견된 evaluator 약점 없음. KI-NNN 신규 등록 0.

---

## I. 변경 이력

- 2026-05-16: Sprint 015 M0 T04 작성. IPC 19개 폐기 + preload 4 묶음 폐기 + renderer 60+ 호출지점 폐기 분석. 단계별 PR 33개 박힘. Sprint 015 contract 갱신 권고 4건.
