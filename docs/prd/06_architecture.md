# 06. 아키텍처 (Architecture)

> [← PRD 목차](./README.md)

본 섹션은 Phase 1 시점 (Sprint 015 M6 완료 후 예정) 시스템 아키텍처. Main / Renderer / Worker 프로세스 분할, IPC 표면, 컴포넌트 트리, 외부 의존, 부팅 시퀀스, Phase 2/3 확장점.

## 6.1 프로세스 모델 (Electron)

```
┌─ Main 프로세스 (Node.js + Electron) ─────────────────────────────┐
│                                                                  │
│  ┌─ Window + UI shell ─┐  ┌─ Services ──┐  ┌─ Workers ────────┐  │
│  │ BrowserWindow       │  │ WorkspaceSvc │  │ EmbeddingQueue    │ │
│  │ WebContentsView[]   │  │ IndexingSvc  │  │ (백그라운드 워커) │ │
│  │ Shortcut (Cmd+K)    │  │ SearchSvc    │  │ MigrationRunner   │ │
│  │                     │  │ ChatSvc      │  │                   │ │
│  │                     │  │ NoteSvc      │  │                   │ │
│  │                     │  │ TabManager   │  │                   │ │
│  │                     │  │ DwellTracker │  │                   │ │
│  │                     │  │ AutoTagger   │  │                   │ │
│  └─────────────────────┘  └──────────────┘  └───────────────────┘ │
│                                                                  │
│  ┌─ Storage 계층 (SQLite + safeStorage) ─────────────────────────┐  │
│  │ flowbrowser.db (SQLite + sqlite-vec)                         │  │
│  │ <userDataDir>/page-content/ (본문 캐시)                       │  │
│  │ <userDataDir>/backup/v03/ (마이그레이션 백업)                 │  │
│  │ Credentials (safeStorage 위 API Key / OAuth 토큰)            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Provider Adapter (외부 API) ────────────────────────────────┐  │
│  │ OpenAIApiKeyProvider — BYOK 디폴트 (인덱싱·태깅·임베딩 자동)  │  │
│  │ CodexLoginProvider — 사용자 명시 동의 시 (G-003 강화)        │  │
│  │ (Phase 3) LocalLLMProvider — Ollama 등                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                ↑ IPC (electron contextBridge)
                ↓
┌─ Renderer 프로세스 (React + Vite) ─────────────────────────────────┐
│                                                                  │
│  ┌─ App.tsx (루트) ──────────────────────────────────────────────┐ │
│  │  ├─ WorkspaceSidebar (좌측)                                   │ │
│  │  ├─ TabBar + UrlBar (상단)                                    │ │
│  │  ├─ SearchBar (상단 우측, Cmd+K)                              │ │
│  │  ├─ WebContentsView placeholder (중앙, Main 이 실제 view)      │ │
│  │  ├─ ChatPanel (우측)                                          │ │
│  │  ├─ MemoryStatsPanel (좌하단)                                 │ │
│  │  ├─ NotePanel (오버레이, 선택 시)                             │ │
│  │  ├─ SettingsPage (라우팅 진입)                                │ │
│  │  └─ OnboardingTour (첫 실행 시)                               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Preload (contextBridge):                                        │
│    tabApi / navigateApi / panelApi / appApi / browserApi /       │
│    codexApi / consentApi / credentialApi / privacyApi /          │
│    usageApi / userSettingApi (유지)                              │
│    indexingApi / embeddingApi / taggingApi / searchApi /         │
│    chatApi / noteApi / workspaceApi / shortcutApi / memoryApi    │
│    (Phase 1 신규)                                                │
└──────────────────────────────────────────────────────────────────┘
                ↑ WebContents (Chromium)
                ↓
┌─ WebContents (사이트 콘텐츠, Chromium 객체) ────────────────────────┐
│  사이트별 페이지 (사용자가 직접 navigate) — Electron `WebContents`   │
│  는 Chromium renderer 와 1:1 보장되는 OS 프로세스가 아닌 컨테이너    │
│  객체. 다중 WebContentsView 가 동일 renderer 프로세스를 공유할 수도  │
│  있음 (sandbox / site isolation 정책 따라 Chromium 결정).            │
│  → did-finish-load 시 ParagraphExtractor 호출 (Main 이 트리거)      │
└──────────────────────────────────────────────────────────────────┘
```

### 6.1.1 프로세스/객체 책임 분할

| 계층 | 정의 | 책임 | 금지 |
|---|---|---|---|
| **Main 프로세스** | Electron main (Node.js) | DB write owner / 외부 API 호출 / 파일시스템 / safeStorage / Shortcut / IPC handler 등록 / 백그라운드 큐 | 직접 React 렌더링 |
| **Renderer 프로세스** | React renderer (Chromium) | UI 상태 + 사용자 입력 + preload API 호출만 | DB·파일시스템·외부 API 직접 접근 |
| **WebContents (객체)** | Chromium 컨테이너 객체 (프로세스 X) | 사이트 콘텐츠 표시 (사용자가 직접 navigate). 다중 WebContentsView 가 동일 또는 분리된 Chromium renderer 프로세스 사용 — Chromium site isolation 정책 결정 | Main/Renderer 내부 API 접근 |
| **Workers (Main 내부)** | Phase 1: main event loop 비동기 큐 / Phase 2+ worker_threads 검토 (M3 PoC 결정) | 백그라운드 큐 (임베딩·인덱싱·마이그레이션) | 직접 IPC handler 등록 |

## 6.2 IPC 표면

총 IPC 채널 = **유지 56개 + Phase 1 신규 약 24개 = 약 80개** (PR b4 시점 실측 + SSOT 갱신).

### 6.2.1 v0.3 유지 (56개, M2 종료까지 변경 없음)

#### main/index.ts (24개)

| 그룹 | 채널 | 비고 |
|---|---|---|
| tab:* (15) | `tab:list / tab:open / tab:close / tab:switch / tab:active / tab:reorder / tab:close-others / tab:close-right / tab:duplicate / tab:set-color / tab:set-pinned / tab:get-thumbnail / tab:reopen / tab:reopen-size / tab:show-context-menu` | M6 PARTIAL — workspace_id 메타 추가 |
| panel·app (2) | `panel:set-open / app:set-view-visible` | 변경 없음 |
| navigate·browser (7) | `navigate / go-back / go-forward / reload / get-current-url / browser:get-view-id / browser:nav-state` | 변경 없음 |

#### main/services.ts (32개)

| 그룹 | 채널 | 비고 |
|---|---|---|
| codex:* (5) | `start-login / cancel-login / poll-status / logout / status` | 변경 없음 |
| consent:* (3) | `get / give / revoke` | 변경 없음 |
| credential:* (4) | `save / delete / list / validate` | 변경 없음 |
| privacy:* (10) | `add-rule / remove-rule / get-rules / approve / scan-page / blocked-stats / clear-policy / set-rules / export-policy / import-policy` | T20 인덱싱 차단 list 확장 (3개 추가) |
| usage:* (4) | `list / summary / clear-all / purge-older-than` | 변경 없음 |
| userSetting:* (2) | `get / update` | PARTIAL — schema 변경 |
| pageResult:* (2) | `lookup / store` | **GENERALIZE → IndexedPageStore** (M2 어댑터 → M5 제거) |
| cache:* (1) | `invalidate-glossary` | **DEPRECATE** (Glossary 폐기와 함께) |
| glossary:* (1) | `import` | **DEPRECATE** |

소계: codex 5 + consent 3 + credential 4 + privacy 10 + usage 4 + userSetting 2 + pageResult 2 + cache 1 + glossary 1 = **32개**.

본 카운트는 실측 코드 grep 기준 (`ipcMain.handle(` 전체 매칭). pageResult:lookup/store는 GENERALIZE 그룹, cache:invalidate-glossary + glossary:import는 DEPRECATE 그룹이라 §6.2.2 폐기 21개에 포함되어야 함. 따라서 실제 "유지" services = 32 - 4 = **28개**, 또는 GENERALIZE 어댑터 보존 동안 32개 모두 동작.

### 6.2.2 폐기 (21개, M2 제거)

[§19 마이그레이션](./19_migration_v03_v04.md) 본문 참조. 요약:
- main/index.ts 9개 (translate:render / render-restore / paragraphs / paragraphs-abort / page / page-abort / summarize-page / summarize-abort / pageResult:restore-current)
- services.ts 12개 (cache:* 2 + pageResult:* 2 + glossary:* 7 + translate:request)

### 6.2.3 Phase 1 신규 (약 24개, M3~M6 도입)

[§05 CRUD 매트릭스 §5.3.1](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개) 참조. 요약:

| 그룹 | 채널 수 | 도입 milestone |
|---|---|---|
| indexing (status·abort, enqueue 는 main 내부) | 2 | M4 |
| embedding (status, enqueue 는 main 내부) | 1 | M3 |
| tagging:apply | 1 | M4 |
| search:* | 2 | M5 |
| chat:* | 4 | M5 |
| note:* | 5 | M5 |
| workspace:* | 5 | M6 |
| shortcut:* | 2 | M5 |
| memory:stats | 1 | M6 |

소계 23~24개 (chat:retry 포함 여부에 따라).

### 6.2.4 합계

- 유지 56 + 신규 24 = **약 80개**
- 폐기 (M2 후 제거) 21 → 최종 80개 active IPC

## 6.3 컴포넌트 트리 (Main 모듈 의존 그래프)

```
src/main/index.ts (IPC handler 등록 + WindowManager)
  ├─ src/main/services.ts (Provider 빌드 + 통합 IPC + 비-tab IPC handler)
  │   ├─ Provider Adapter
  │   │   ├─ OpenAIApiKeyProvider
  │   │   ├─ CodexLoginProvider
  │   │   └─ (Phase 3) LocalLLMProvider
  │   ├─ Credentials (safeStorage)
  │   ├─ UserSettingStore (JSON, v0.4 마이그레이션 schema)
  │   ├─ ConsentGate / DomainPolicyStore / TransmissionLogger
  │   └─ UsageLog
  │
  ├─ src/main/TabManager.ts (다중 탭 + workspace_id 메타)
  │   ├─ ClosedTabHistory
  │   ├─ ThumbnailStore / ThumbnailDiskStore
  │   └─ TabStateStore (JSON, workspace_id 메타)
  │
  ├─ src/main/WorkspaceService.ts (Phase 1 신규, M6)
  │   └─ WorkspaceStore (SQLite)
  │
  ├─ src/main/IndexingService.ts (Phase 1 신규, M4)
  │   ├─ ParagraphExtractor (재활용)
  │   ├─ IndexingGate (Privacy 차단)
  │   ├─ DwellTracker
  │   └─ IndexedPageStore (SQLite + sqlite-vec)
  │       ├─ Page · Visit · PageTag · NoteTag 테이블
  │       └─ PageContentCache (디스크)
  │
  ├─ src/main/SearchService.ts (Phase 1 신규, M5)
  │   ├─ TimeRangeParser (자연어 시간)
  │   ├─ VectorIndex (sqlite-vec wrapper, workspace_id partition)
  │   └─ AIResponseCache
  │
  ├─ src/main/ChatService.ts (Phase 1 신규, M5)
  │   ├─ SearchService retrieval 호출
  │   ├─ PromptComposer (user level 분기)
  │   ├─ Provider Adapter 호출 (BYOK 디폴트 — 사용자 능동 호출은 자유 선택)
  │   ├─ AiChatHistoryStore
  │   └─ SseStreamParser (Codex SSE 재활용)
  │
  ├─ src/main/NoteService.ts (Phase 1 신규, M5)
  │   ├─ NoteStore (SQLite)
  │   └─ AutoTagger (BYOK, TX 외부)
  │
  └─ src/main/Workers (백그라운드)
      ├─ EmbeddingQueue (활성 탭 우선 priority)
      │   └─ EmbeddingClient (OpenAI text-embedding-3-small, 1024 차원, BYOK)
      └─ MigrationRunner (v0.3 → v0.4, M3)
```

### 6.3.1 KEEP 모듈 (변경 없음, [§19](./19_migration_v03_v04.md) Migration Matrix A1 §C)

- Codex OAuth 4종 (DeviceCodeFlow / JwtDecoder / SseStreamParser / CodexLoginProvider)
- Privacy 7종 (ConsentGate / DomainFilter / DomainPolicyStore / SensitiveFieldDetector / TransmissionLogger / 외 2)
- ParagraphExtractor / PageNodeExtractor (M3-13 style/script 필터 보존)
- TabManager / ThumbnailStore (PARTIAL — workspace_id 메타 추가)
- ClosedTabHistory
- UsageLog / Credentials (G-005 safeStorage)

### 6.3.2 GENERALIZE 모듈 (M2 어댑터 후 M5 제거, A1 §B)

| 기존 | 신규 |
|---|---|
| `src/storage/TranslationCache.ts` | `src/storage/AIResponseCache.ts` (kind: translation/embedding/ai_response/tag) |
| `src/storage/PageResultStore.ts` | `src/storage/IndexedPageStore.ts` (Page+Visit 분리, workspace_id 메타) |

### 6.3.3 DEPRECATE 모듈 (M2/M5 폐기, A1 §A)

`src/ai/SummarizationPlanner.ts` / `src/perception/TranslationRenderer.ts` / `src/renderer/src/settings/DisplayModePanel.tsx` / `src/renderer/src/settings/GlossaryPanel.tsx` / `src/renderer/src/translation/TranslationPanel.tsx` / `src/renderer/src/translation/TranslationPopup.tsx`

### 6.3.4 NEW 모듈 (Phase 1 신규, 30+개, A1 §E)

- storage 11개 (IndexedPageStore / VectorIndex / PageContentCache / AIResponseCache / WorkspaceStore / NoteStore / AiChatHistoryStore / TagStore / EmbeddingQueue / migrations/v03_to_v04.ts / schema/v04.sql)
- ai 3개 (EmbeddingClient / AutoTagger / PromptComposer)
- main 7개 (IndexingService / ChatService / SearchService / NoteService / WorkspaceService / DwellTracker / Shortcut)
- privacy 1개 (IndexingGate)
- search 1개 (TimeRangeParser)
- renderer 8개 (SearchBar / SearchResultCard / PreviewPane / ChatPanel / NotePanel / WorkspaceSidebar / WorkspaceSettings / MemoryStatsPanel)

## 6.4 외부 의존

**현재 의존성** (package.json 기준, PR b4 시점 실측):

| 의존 | 현재 버전 | 사용처 |
|---|---|---|
| **Electron** | `^39.0.0` | Main / Renderer 분리 |
| **React** | 18.x | Renderer UI |
| **Vite + electron-vite** | 최신 | 빌드 |

**계획 의존성** (M3 도입 예정, package.json 미존재):

| 의존 | 계획 버전 | 사용처 | Phase | 도입 milestone | 비고 |
|---|---|---|---|---|---|
| **better-sqlite3** | 11.x | SQLite 동기 wrapper (Main 프로세스) | Phase 1 | M3 | Native module + Electron ABI rebuild 필요 (Windows·macOS·Linux 배포 검증 부담) |
| **sqlite-vec** | 0.x dev (안정판 미출시, M3 PoC에서 정확 버전 박힘) | 벡터 인덱스 (sqlite-vec extension load 방식) | Phase 1 | M3 | extension 동적 로드 + native build 의존 |
| **(Phase 3) Ollama** | (Phase 3 PoC에서 결정) | 로컬 LLM | Phase 3 | M3 시작 시 미정 — 자동 탐지 (localhost:11434 ping) vs 사용자 명시 endpoint 설정 | |

**현재 외부 API 호출 방식**:

- `src/ai/providers/OpenAIApiKeyProvider.ts` — **`fetch` 기반 REST 호출** (OpenAI Node SDK 미사용). Phase 1 OpenAI 임베딩/태깅 호출도 동일 패턴 유지 또는 SDK 도입은 M3 시작 시 결정.
- `src/ai/codex/*` — Codex OAuth + Responses API 호출 (fetch + SSE 파서). 변경 없음.

### 6.4.1 결격사유 0 원칙 적용

[§01 §1.4](./01_overview.md#14-결격사유-0-원칙) + [§13 보안·프라이버시](./13_security_privacy.md) 참조. 외부 API 호출은 사용자 본인 credential 사용, 사이트와 무관.

## 6.5 부팅 시퀀스 (v0.4 기준 — 함수명은 실제 코드 기준)

```
1. Electron app.whenReady()
   ↓
2. Main: initServices(userDataDir) — 실제 코드 `src/main/services.ts`
   ├─ checkAndRunMigration() — v0.3 → v0.4 자동 (G-014)
   │   조건: <userDataDir>/flowbrowser.db 없음 + v0.3 JSON 파일 1개 이상 존재
   │   ├─ Dry-run (in-memory SQLite)
   │   ├─ 자동 백업 (<userDataDir>/backup/v03/<ISO_ts>/)
   │   ├─ 실제 마이그레이션 (단일 TX)
   │   │   ├─ "📥 기본" Workspace 자동 생성 (migration path 진입 시점)
   │   │   ├─ Glossary → Note 이전
   │   │   ├─ Settings 폐기 키 제거
   │   │   └─ Tabs workspace_id 부여
   │   └─ revert 경로 (실패 시)
   │
   │   대안: Fresh install (v0.3 JSON 모두 없음)
   │   └─ "📥 기본" Workspace 자동 생성 (fresh install path)
   │
   ├─ flowbrowser.db 열기 (sqlite-vec extension 로드 — M3 PoC 확정 방식)
   ├─ Store 초기화: IndexedPageStore / NoteStore / AiChatHistoryStore / TagStore / WorkspaceStore / TabStateStore (workspace_id 메타)
   ├─ Credentials (safeStorage)
   └─ UserSettingStore (마이그레이션 schema)
   ↓
3. Main: rebuildAllProviders() — 실제 코드 `src/main/services.ts`
   ├─ OpenAI API Key credential 있으면 OpenAIApiKeyProvider 활성 (fetch 기반)
   └─ Codex OAuth 토큰 있으면 CodexLoginProvider 활성 (자동 백그라운드 호출 X, 사용자 명시 동의 시만)
   ↓
4. Main: IPC handlers 등록 (Phase 1 종료 후 약 80개 — 유지 56 + 신규 24)
   ↓
5. Main: BrowserWindow 생성 + Renderer 로드
   ↓
6. Renderer: workspace:get-current IPC 호출 → 활성 워크스페이스 lookup
   ↓
7. Renderer: TabStateStore.restoreTabs() (workspace_id 필터)
   ↓
8. Main: TabManager 가 WebContentsView 들 재생성
   ↓
9. (선택) OnboardingTour — UserSetting.onboardingShown=false 시 표시
   ↓
10. 사용자 인터랙션 시작
```

**중요 (b3.1 학습 적용)**:
- 외부 API 호출 (OpenAI / Codex) 은 모두 DB TX 외부 ([§05 §5.4.2/§5.4.3](./05_crud_matrix.md#542-note-라이프사이클))
- 자동 백그라운드 호출 (인덱싱·임베딩·태깅) = BYOK 디폴트 (G-003 강화, [§01 §1.4.2](./01_overview.md#142-동작-원칙))
- 마이그레이션 트리거는 initServices 진입 시점, IPC 등록 (step 4) 전 완료 보장
- "📥 기본" Workspace 생성은 fresh install / migration 두 경로 모두에서 (path 분리 명시)

### 6.5.1 후속 자동 동작

- **page 자동 인덱싱**: WebContentsView did-finish-load 시 IndexingService 트리거 ([§05 §5.4.1](./05_crud_matrix.md#541-page--visit-라이프사이클-자동-인덱싱))
- **임베딩 백그라운드**: EmbeddingQueue 활성 탭 우선 (priority 10), 백그라운드 탭 (priority 1), FIFO
- **자동 태깅**: AutoTagger 인덱싱 직후 호출 (BYOK, TX 외부)
- **dwell 측정**: DwellTracker 탭 활성 + focus 누적

## 6.6 운영 부담 및 리스크 (b4.1 추가)

| 영역 | 부담 / 리스크 | 완화 |
|---|---|---|
| **WebContentsView 다중 인스턴스 메모리** | 탭 N개 동시 활성 시 메모리·CPU 부담 (Chromium renderer 프로세스 수 결정은 Chromium site isolation 정책) | 비활성 탭 메모리 정리 정책 [§07 UI 레이아웃](./07_ui_layout.md) 결정. M6 TabManager workspace_id 메타 도입 시 inactive view 정책 확정 |
| **Provider rate limit / backoff** | OpenAI rate limit 도달 시 임베딩 큐 폭주 | EmbeddingQueue 지수 백오프 (5초/30초/5분/30분/포기) + KI-NNN 등록 ([§04 §4.6](./04_data_model.md#46-실패재시도-시나리오)) |
| **better-sqlite3 native module + Electron ABI rebuild** | Windows/macOS/Linux 배포 시 ABI 호환 검증 | electron-rebuild 또는 prebuilt 바이너리. M3 PoC에서 배포 검증 |
| **sqlite-vec extension load** | extension 동적 로드 방식 (CLI vs API) + Electron sandbox 호환 | M3 PoC에서 정확 방식 박힘 (R1 대안: in-memory cosine similarity fallback, [§18 평가](./18_evaluation.md)) |
| **본문 캐시 디스크 사용량** | 1만 페이지 ~100MB + 임베딩 ~40MB = ~150MB (v04-direction §8). 누적 시 사용자 디스크 부담 | LRU 정리 정책 또는 사용자 옵션 ([§15 비용·저장](./15_costs_storage.md) 결정) |
| **마이그레이션 실패 revert** | v0.3 → v0.4 dry-run 실패 시 사용자 데이터 손실 위험 | 자동 백업 + revert ([§19 마이그레이션](./19_migration_v03_v04.md) 5단계 절차) |

## 6.7 Phase 2/3 확장점

### 6.7.1 Phase 2 추가 모듈

- **WorkspacePartitionManager** — Electron `session.fromPartition()` 활용, 워크스페이스별 cookies/storage 격리
- **HighlightStore** — DOM anchor 보존 (`{xpath, offset, text_snippet}`)
- **TranslationJobStore + TranslationJobRunner** — 백그라운드 번역 큐 + 시스템 Notification
- **UserLevelEstimator** — 메타 학습 기반 자동 수준 추정

### 6.7.2 Phase 3 추가 모듈

- **LocalLLMProvider** (Ollama) — Provider Adapter 확장
- **LocalEmbeddingProvider** — sentence-transformers 등
- **ExportArtifactBuilder** — Notion / Markdown / JSON 출력
- **SharedWorkspaceFormat** — 워크스페이스 import/export 포맷

## 6.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §6 (핵심 동작 흐름) + §4 (UI 레이아웃) + §10 (Phase 분할)
- `.flowset/specs/v04-dependency-graph.md` §A (IPC 폐기 21개) + §A3 (유지 56개, PR b4 갱신) + §B (신규 24개)
- `.flowset/specs/v04-migration-matrix.md` §A~§E (DEPRECATE / GENERALIZE / KEEP / PARTIAL / NEW)
- `.flowset/specs/v04-data-migration.md` §B (부팅 시퀀스 트리거)

본 §06 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 6.9 변경 이력

- 2026-05-16 (PR b4): stub → 본문 작성. 프로세스 모델 (Main/Renderer/Web Contents/Workers) + IPC 표면 약 80개 정확 카운트 + 컴포넌트 트리 + 외부 의존 + 부팅 시퀀스 + Phase 2/3 확장점. v04-dependency-graph §A3 SSOT 갱신 동반 (유지 IPC 47개 → 56개, 실측 grep 정정).
- 2026-05-16 (PR b4.1): codex 15건 + evaluator 4건 핫픽스. **실제 코드 사실 정정**: (1) Electron 30.x+ → ^39.0.0 (package.json 실측). (2) better-sqlite3/sqlite-vec/OpenAI Node SDK → "계획 의존성, M3 도입" 분리 + 현재 fetch 기반 명시. (3) 부팅 함수명 `rebuildAllStores` → `initServices()`, `ProviderRegistry.rebuildAll()` → `rebuildAllProviders()` (실제 코드). (4) WebContents = "객체/컨테이너" 명시 (프로세스 X, Chromium site isolation 정책). (5) Workers = "Phase 1 main event loop 비동기 큐 / Phase 2+ worker_threads 검토" 명시. (6) services 추가 7개 정확 분류 (privacy 3 추가 + pageResult 2 GENERALIZE + cache 1 + glossary 1 DEPRECATE). (7) "📥 기본" Workspace 생성 시점 분리 (fresh install path / migration path). (8) §6.6 운영 부담·리스크 신규 (WebContentsView 메모리 / Provider rate limit / native build / sqlite-vec extension / 본문 캐시 LRU / 마이그레이션 revert). (9) §6.5 부팅 BYOK 디폴트 + TX 외부 명시. (10) §6.2.1 services.ts 표 라벨 정정 (multiline 잘못된 설명 삭제, 7개 핸들러 정확 분류). v04-dependency-graph §통계 요약 동반 정정 (47 → 56).
