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
┌─ Web Contents (사이트 콘텐츠) ────────────────────────────────────┐
│  사이트별 페이지 (사용자가 직접 navigate)                          │
│  → did-finish-load 시 ParagraphExtractor 호출 (Main 이 트리거)    │
└──────────────────────────────────────────────────────────────────┘
```

### 6.1.1 프로세스 책임 분할

| 프로세스 | 책임 | 금지 |
|---|---|---|
| **Main** | DB write owner / 외부 API 호출 / 파일시스템 / safeStorage / Shortcut / IPC handler 등록 | 직접 React 렌더링 |
| **Renderer** | UI 상태 + 사용자 입력 + preload API 호출만 | DB·파일시스템·외부 API 직접 접근 |
| **Web Contents** | 사이트 콘텐츠 표시 (사용자가 직접 navigate) | Main/Renderer 내부 API 접근 |
| **Workers (Main 내부)** | 백그라운드 큐 (임베딩·인덱싱·마이그레이션) | 직접 IPC handler 등록 |

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
| privacy:* (7) | `add-rule / remove-rule / get-rules / approve / scan-page / blocked-stats / clear-policy` | T20 인덱싱 차단 list 확장 |
| usage:* (4) | `list / summary / clear-all / purge-older-than` | 변경 없음 |
| userSetting:* (2) | `get / update` | PARTIAL — schema 변경 |
| 추가 multiline IPC (7) | (정확 카운트는 M2 시작 시 코드 grep 재검증) | 본 PR b4 시점에서 단일 라인 grep 33개 외 multiline handle 11개 — 그 중 폐기 0개, 유지 11개. 11 - 4 (consent/credential 일부 multiline 중복) = 약 7개 추가 |

소계 32개. 본 카운트는 실측 코드 grep 기준 (`ipcMain.handle(` 전체 매칭 — 단일 라인 + multiline).

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

| 의존 | 버전 / 패턴 | 사용처 | Phase |
|---|---|---|---|
| **Electron** | 30.x+ | Main / Renderer 분리 | 모든 Phase |
| **React** | 18.x | Renderer UI | 모든 Phase |
| **Vite + electron-vite** | 최신 | 빌드 | 모든 Phase |
| **better-sqlite3** | 11.x | SQLite 동기 wrapper | Phase 1+ |
| **sqlite-vec** | (PR b4 시점 1.x 또는 dev, M3 PoC에서 정확 버전 박힘) | 벡터 인덱스 | Phase 1+ |
| **OpenAI Node SDK** | 4.x+ | API Key / Codex OAuth 호출 | Phase 1+ |
| **(Phase 3) Ollama** | 자동 연동 또는 수동 | 로컬 LLM | Phase 3 |

### 6.4.1 결격사유 0 원칙 적용

[§01 §1.4](./01_overview.md#14-결격사유-0-원칙) + [§13 보안·프라이버시](./13_security_privacy.md) 참조. 외부 API 호출은 사용자 본인 credential 사용, 사이트와 무관.

## 6.5 부팅 시퀀스

```
1. Electron app.whenReady()
   ↓
2. Main: rebuildAllStores(userDataDir)
   ├─ checkAndRunMigration() — v0.3 → v0.4 첫 실행 시 자동 (G-014)
   │   ├─ Dry-run (in-memory SQLite)
   │   ├─ 자동 백업 (<userDataDir>/backup/v03/<ISO_ts>/)
   │   ├─ 실제 마이그레이션
   │   └─ Glossary → Note / Settings 폐기 키 제거 / Tabs workspace_id 부여
   ├─ flowbrowser.db 열기 (sqlite-vec extension 로드)
   ├─ WorkspaceStore (📥 기본 자동 생성 — 첫 실행 시)
   ├─ IndexedPageStore / NoteStore / AiChatHistoryStore / TagStore
   ├─ TabStateStore (workspace_id 메타)
   ├─ Credentials (safeStorage)
   └─ UserSettingStore (마이그레이션 schema)
   ↓
3. Main: ProviderRegistry.rebuildAll()
   ├─ OpenAI API Key credential 있으면 OpenAIApiKeyProvider 활성
   └─ Codex OAuth 토큰 있으면 CodexLoginProvider 활성
   ↓
4. Main: IPC handlers 등록 (80개 약)
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

### 6.5.1 후속 자동 동작

- **page 자동 인덱싱**: WebContentsView did-finish-load 시 IndexingService 트리거 ([§05 §5.4.1](./05_crud_matrix.md#541-page--visit-라이프사이클-자동-인덱싱))
- **임베딩 백그라운드**: EmbeddingQueue 활성 탭 우선 (priority 10), 백그라운드 탭 (priority 1), FIFO
- **자동 태깅**: AutoTagger 인덱싱 직후 호출 (BYOK, TX 외부)
- **dwell 측정**: DwellTracker 탭 활성 + focus 누적

## 6.6 Phase 2/3 확장점

### 6.6.1 Phase 2 추가 모듈

- **WorkspacePartitionManager** — Electron `session.fromPartition()` 활용, 워크스페이스별 cookies/storage 격리
- **HighlightStore** — DOM anchor 보존 (`{xpath, offset, text_snippet}`)
- **TranslationJobStore + TranslationJobRunner** — 백그라운드 번역 큐 + 시스템 Notification
- **UserLevelEstimator** — 메타 학습 기반 자동 수준 추정

### 6.6.2 Phase 3 추가 모듈

- **LocalLLMProvider** (Ollama) — Provider Adapter 확장
- **LocalEmbeddingProvider** — sentence-transformers 등
- **ExportArtifactBuilder** — Notion / Markdown / JSON 출력
- **SharedWorkspaceFormat** — 워크스페이스 import/export 포맷

## 6.7 SSOT 인용

- `.flowset/specs/v04-direction.md` §6 (핵심 동작 흐름) + §4 (UI 레이아웃) + §10 (Phase 분할)
- `.flowset/specs/v04-dependency-graph.md` §A (IPC 폐기 21개) + §A3 (유지 56개, PR b4 갱신) + §B (신규 24개)
- `.flowset/specs/v04-migration-matrix.md` §A~§E (DEPRECATE / GENERALIZE / KEEP / PARTIAL / NEW)
- `.flowset/specs/v04-data-migration.md` §B (부팅 시퀀스 트리거)

본 §06 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 6.8 변경 이력

- 2026-05-16 (PR b4): stub → 본문 작성. 프로세스 모델 (Main/Renderer/Web Contents/Workers) + IPC 표면 약 80개 정확 카운트 + 컴포넌트 트리 + 외부 의존 + 부팅 시퀀스 + Phase 2/3 확장점. v04-dependency-graph §A3 SSOT 갱신 동반 (유지 IPC 47개 → 56개, 실측 grep 정정).
