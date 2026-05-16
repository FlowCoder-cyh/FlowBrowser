# A1 — 폐기 코드 식별 매트릭스 (v0.3 → v0.4)

> **M0 사전 분석 산출물 1/4**
> Sprint 015 contract `S015-T01` 산출물.
> 입력: `.flowset/specs/v04-direction.md` (방향 SSOT)
> 출력: PRD §06 (architecture) + §19 (migration) + Sprint 015 M2 폐기·일반화 작업 입력

## 메타

- **작성일**: 2026-05-16
- **스캔 범위**: `src/**/*.{ts,tsx}` 54개 + `tests/**/*.test.{ts,tsx}` 29개
- **분류 기준**: v0.4 방향 SSOT §10 Phase 분할 + §17 박힌 결정사항 + §18 P0~P2 결정
- **결정 SSOT**: `.flowset/specs/v04-direction.md`

## 분류 체계 (4종 + 신규)

| 분류 | 정의 | 일정 |
|---|---|---|
| **DEPRECATE** | 완전 폐기 (코드 제거 + 테스트 제거) | Sprint 015 M2 (어댑터 호환 끝난 후 M5에서 호출지점 제거) |
| **GENERALIZE** | 신규 모듈에 일반화 흡수, 기존은 어댑터로 v0.3 호환 유지 후 M5에서 어댑터 제거 | Sprint 015 M2 (신규 도입) → M5 (어댑터 제거) |
| **KEEP** | 변경 없음 (v0.4에서 그대로 재활용) | — |
| **PARTIAL** | 일부 코드 제거 + 나머지 유지 (메서드 단위 수술) | Sprint 015 M2~M6 (적용 시점은 의존 작업에 따름) |
| **NEW** | v0.4에서 신규 작성 | Sprint 015 M3~M6 |

## 분류 요약 (Quick View)

| 분류 | 개수 | 비율 |
|---|---|---|
| **DEPRECATE** | 6 | 11% |
| **GENERALIZE** | 2 | 4% |
| **KEEP** | 25 | 46% |
| **PARTIAL** | 21 | 39% |
| 소계 (기존) | **54** | 100% |
| **NEW** | **30+** | (신규) |

→ 기존 자산 85% 재활용 (KEEP + GENERALIZE + PARTIAL) / 폐기 11%.

---

## A. DEPRECATE (6개)

| 파일 | 사유 | 의존 호출지점 (A4 의존 그래프 입력) | 일정 |
|---|---|---|---|
| `src/ai/SummarizationPlanner.ts` | 페이지 요약 use case 폐기 (v04-direction §10.1 폐기 항목) | `src/main/services.ts` rebuildProvider 분기 / `src/main/index.ts` translate:summarize-abort handler / `src/renderer/**` 요약 호출 UI | M2 (어댑터 무관, 즉시 제거) |
| `src/perception/TranslationRenderer.ts` | replace/overlay displayMode 폐기 (v04-direction §10.1) | `src/main/index.ts` translate:render / translate:render-restore / pageResult:restore-current handlers | M5 (호출지점 ChatPanel 도입 후 제거) |
| `src/renderer/src/settings/DisplayModePanel.tsx` | displayMode 설정 UI 폐기 | `src/renderer/src/settings/SettingsPage.tsx` 라우팅 | M5 |
| `src/renderer/src/settings/GlossaryPanel.tsx` | Glossary → Note 자동 이전 후 패널 폐기 (v04-direction P0-1) | `src/renderer/src/settings/SettingsPage.tsx` 라우팅 | M5 (마이그레이션 M3 완료 후) |
| `src/renderer/src/translation/TranslationPanel.tsx` | ChatPanel로 전환 (v04-direction §10.1 + Sprint 015 T25) | `src/renderer/src/App.tsx` 우측 패널 렌더 | M5 (ChatPanel 도입과 동시 교체) |
| `src/renderer/src/translation/TranslationPopup.tsx` | 선택 영역 번역 팝업 폐기 (실시간 번역 폐기에 포함) | `src/renderer/src/App.tsx` 컨텍스트 메뉴 호출 | M5 (노트 추가 컨텍스트 메뉴로 교체) |

### DEPRECATE 테스트 (3개)
- `tests/unit/ai/SummarizationPlanner.test.ts` — M2
- `tests/unit/perception/TranslationRenderer.test.ts` — M5
- `tests/unit/storage/GlossaryStore.test.ts` — M5 (마이그레이션 테스트로 일부 케이스 이전)

---

## B. GENERALIZE (2개)

| 파일 | 일반화 대상 | 키 schema 변경 | 어댑터 전략 | 일정 |
|---|---|---|---|---|
| `src/storage/TranslationCache.ts` | **AIResponseCache** (신규) | `key: {translation, embedding, ai_response, tag}` × 도메인 키 → 단일 cache layer | M2: AIResponseCache 신규 + TranslationCache 어댑터로 v0.3 호출 유지 (feature flag `flowbrowser.v04.enabled` false 시 어댑터 경로). M5: 어댑터 제거 | M2 신규 → M5 어댑터 제거 |
| `src/storage/PageResultStore.ts` | **IndexedPageStore** (신규) | Page (id/workspace_id/url/title/content/embedding/...) + Visit (id/page_id/workspace_id/visited_at/dwell_ms) 분리 / 워크스페이스 ID 메타 / 본문 캐시 흡수 | M2: IndexedPageStore base 신규 + PageResultStore 어댑터로 v0.3 호출 유지. M3에서 sqlite-vec + Note + AiChatHistory + Tag 테이블 추가. M5에서 어댑터 제거 | M2 신규 → M3 확장 → M5 어댑터 제거 |

### GENERALIZE 테스트 (2개 → 재구성)
- `tests/unit/storage/TranslationCache.test.ts` + `.lru.test.ts` → `tests/unit/storage/AIResponseCache.test.ts`로 재작성 + LRU 케이스 + 신규 도메인 키 케이스 추가 (M2)
- `tests/unit/storage/PageResultStore.test.ts` → `tests/unit/storage/IndexedPageStore.test.ts`로 재작성 + Visit 누적 케이스 + 워크스페이스 격리 케이스 + sqlite-vec 케이스 추가 (M3)

---

## C. KEEP (25개)

변경 없이 v0.4에서 그대로 재활용. 가드레일·테스트 모두 유지.

### ai/ (5개)
- `src/ai/ProviderAdapter.ts` — Provider Adapter 추상화 (G-005 OS Keychain 위임 패턴)
- `src/ai/codex/DeviceCodeFlow.ts` — Codex OAuth device-code (재활용)
- `src/ai/codex/JwtDecoder.ts` — JWT account_id 추출 (재활용)
- `src/ai/codex/SseStreamParser.ts` — SSE 파서 (AI 채팅 SSE 응답에 재활용)
- `src/ai/providers/CodexLoginProvider.ts` — Codex Responses API 호출 (단 자동 인덱싱·태깅·임베딩에서는 BYOK 우선, G-003 강화)
- `src/ai/providers/OpenAIApiKeyProvider.ts` — BYOK 디폴트 Provider
- `src/ai/providers/index.ts` — Provider 인덱스

### main/ (4개)
- `src/main/ClosedTabHistory.ts` — 닫힌 탭 복원
- `src/main/ThumbnailDiskStore.ts` — 썸네일 디스크 저장
- `src/main/ThumbnailStore.ts` — 썸네일 메모리 store

### perception/ (2개)
- `src/perception/PageNodeExtractor.ts` — 페이지 노드 추출 (인덱싱 base 재활용)
- `src/perception/ParagraphExtractor.ts` — 단락 추출 + M3-13 style/script 필터 보존 (Sprint 015 T16 인덱싱 hook 입력)

### privacy/ (7개)
- `src/privacy/ConsentGate.ts` — 동의 게이트
- `src/privacy/DomainFilter.ts` — 도메인 필터 (인덱싱 차단 list에 재활용, T20)
- `src/privacy/DomainPolicyStore.ts` — 도메인 정책 저장
- `src/privacy/SensitiveFieldDetector.ts` — 비밀번호 필드 감지 (T20 인덱싱 차단에 재활용)
- `src/privacy/TransmissionLogger.ts` — 전송 로그
- `src/privacy/index.ts` — Privacy 인덱스
- `src/privacy/types.ts` — Privacy 타입

### renderer/ (4개)
- `src/renderer/src/TabBar.tsx` — 탭 바 (워크스페이스 단위 격리는 WorkspaceService에서 처리)
- `src/renderer/src/UrlBar.tsx` — URL bar
- `src/renderer/src/main.tsx` — React 진입점
- `src/renderer/src/onboarding/Consent.tsx` — 동의 화면
- `src/renderer/src/settings/CodexLoginPanel.tsx` — Codex Login 패널
- `src/renderer/src/settings/DomainPolicyPanel.tsx` — 도메인 정책 패널 (Privacy 차단 list 사용자 추가·제외)
- `src/renderer/src/settings/UsagePanel.tsx` — 사용량 패널

### storage/ (2개)
- `src/storage/Credentials.ts` — OAuth 토큰 묶음 + API Key safeStorage
- `src/storage/UsageLog.ts` — 사용량 로그

### KEEP 테스트 (20개)
- `tests/unit/ai/CodexLoginProvider.test.ts` / `DeviceCodeFlow.test.ts` / `JwtDecoder.test.ts` / `SseStreamParser.test.ts` / `SystemPrompt.test.ts` (5)
- `tests/unit/main/ClosedTabHistory.test.ts` / `TabManager.test.ts` / `ThumbnailDiskStore.test.ts` / `ThumbnailStore.test.ts` (4)
- `tests/unit/perception/PageNodeExtractor.test.ts` / `ParagraphExtractor.test.ts` (2)
- `tests/unit/privacy/*.test.ts` (7개: ConsentGate, DomainFilter, DomainPolicyStore, SensitiveFieldDetector, TransmissionLogger, evaluatePrivacy, pageWideBlock)
- `tests/unit/renderer/tabGuard.test.ts` / `tabLabel.test.ts` (2)
- `tests/unit/storage/TabStateStore.test.ts` / `UsageLog.test.ts` / `UserSettingStore.test.ts` (3)

---

## D. PARTIAL (21개)

일부 코드 제거 + 나머지 유지. 수술 범위 명시.

### ai/ (2개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/ai/index.ts` | SummarizationPlanner export | Provider Adapter / Codex / OpenAI / AutoTagger·EmbeddingClient·PromptComposer (신규 추가) export | M2 + M3 |
| `src/ai/types.ts` | TranslationInput/Output / SummarizeInput/Output / DisplayMode 타입 | ChatMessage / ChatResponse / Embedding / Tag / Workspace / Page / Visit / Note / AiChatHistory 타입 (신규) | M2 + M3 |

### main/ (3개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/main/index.ts` | IPC handlers 6개: `translate:render`, `translate:render-restore`, `pageResult:restore-current`, `translate:paragraphs-abort`, `translate:page-abort`, `translate:summarize-abort` (대략 +700 lines 폐기) | 기존 tab:* / panel:* / app:* / navigate / browser:* 19개 유지 + 신규 IPC handlers 추가: `indexing:*`, `search:*`, `chat:*`, `note:*`, `workspace:*`, `shortcut:*`, `embedding:*`, `tagging:*` (15개+ 신규) | M2 폐기 + M3~M6 신규 |
| `src/main/services.ts` | rebuildProvider 안 paragraphs/page/summary 처리 분기 (translate flow) | rebuildProvider 본체 유지 + IndexingService / SearchService / ChatService / NoteService / WorkspaceService 위임 (신규) | M2 + M3~M6 |
| `src/main/TabManager.ts` | (없음) | 워크스페이스 ID 메타 추가 (Tab에 workspace_id 컬럼) + 워크스페이스 단위 탭 격리 | M6 (워크스페이스 사이드바 도입 시) |

### preload/ (2개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/preload/index.ts` | `paragraphsApi`, `pageApi`, `summaryApi`, `glossaryApi`, `displayModeApi` 노출 제거 | `tabApi`, `panelApi`, `appApi`, `navigateApi`, `browserApi`, `codexApi`, `consentApi`, `credentialApi`, `usageApi`, `domainPolicyApi` 유지 + `indexingApi`, `searchApi`, `chatApi`, `noteApi`, `workspaceApi`, `shortcutApi`, `embeddingApi`, `taggingApi` 신규 | M2 폐기 + M3~M6 신규 |
| `src/preload/index.d.ts` | 동일 (타입 선언) | 동일 | M2 + M3~M6 |

### renderer/src/ (2개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/renderer/src/App.tsx` | TranslationPanel 우측 렌더 / TranslationPopup 컨텍스트 메뉴 호출 / displayMode 분기 | TabBar / UrlBar / WebContentsView placeholder 유지 + WorkspaceSidebar (좌측, 신규) / ChatPanel (우측, 신규) / SearchBar (상단, 신규) / MemoryStatsPanel (좌하단, 신규) / NotePanel (선택 시 호출, 신규) | M5 + M6 |
| `src/renderer/src/onboarding/OnboardingTour.tsx` | Glossary 안내 카드 / displayMode 추천 문구 | Codex Login / OpenAI API Key 카드 유지 + 워크스페이스 안내 카드 (신규) + 추천 URL 3개 갱신 (학술/뉴스/리서치) | M6 |

### renderer/src/settings/ (3개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/renderer/src/settings/SettingsPage.tsx` | DisplayMode / Glossary 라우팅 | CodexLogin / DomainPolicy / Usage / PageCache 라우팅 유지 + WorkspaceSettings / SearchShortcut / IndexingPolicy 라우팅 신규 | M5 + M6 |
| `src/renderer/src/settings/GeneralPanel.tsx` | displayMode (replace/overlay) / summaryPolicy / fontSize 옵션 | targetLanguage / defaultProviderId 유지 + 워크스페이스 디폴트 설정 신규 + 사용자 수준 (초보/중급/고급) 신규 (T27) | M5 |
| `src/renderer/src/settings/PageCachePanel.tsx` | PageResultStore 기반 캐시 통계 | IndexedPageStore 기반 캐시 통계로 의미 변경 (또는 MemoryStatsPanel에 통합 후 폐기 검토) | M3 (IndexedPageStore 도입) |

### renderer/src/translation/ (2개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/renderer/src/translation/tabGuard.ts` | 번역 abort 로직 | 탭 전환 guard 핵심 로직은 IndexingService abort에 재활용 (모듈 위치 이동 검토: `src/main/TabGuard.ts`) | M2 (재활용) |
| `src/renderer/src/translation/tabLabel.ts` | 번역 진행 상태 라벨 | 탭 라벨 생성 로직은 워크스페이스 컨텍스트 추가 후 재활용 | M6 |

### storage/ (3개)

| 파일 | 제거 | 유지 / 신규 | 일정 |
|---|---|---|---|
| `src/storage/TabStateStore.ts` | (없음) | 워크스페이스 ID 메타 추가 (Tab 저장 schema 확장, forward-compatibility) | M6 |
| `src/storage/UserSettingStore.ts` | displayMode / summaryPolicy / fontSize / paragraphsIPCFlag 키 자동 제거 (v04-direction P0-2) | targetLanguage / defaultProviderId / privacyExclusions / onboardingShown 유지 + workspaceDefault / userLevelPreference / shortcutOverride 신규 | M3 (마이그레이션) + M5 (신규) |
| `src/storage/index.ts` | GlossaryStore export | Credentials / TranslationCache (어댑터) / PageResultStore (어댑터) / TabStateStore / UsageLog / UserSettingStore 유지 + AIResponseCache / IndexedPageStore / WorkspaceStore / NoteStore / AiChatHistoryStore / TagStore / VectorIndex / PageContentCache / EmbeddingQueue 신규 | M2 + M3 |

### PARTIAL 테스트 (1개)
- `tests/unit/storage/UserSettingStore.test.ts` — 폐기 키 마이그레이션 케이스 추가 (M3)

---

## E. NEW (30+개, Sprint 015 신규 작성)

### storage/ (10개)
- `src/storage/IndexedPageStore.ts` (T11) — Page/Visit CRUD + 본문 캐시 + 워크스페이스 ID 메타
- `src/storage/VectorIndex.ts` (T12) — sqlite-vec wrapper
- `src/storage/PageContentCache.ts` (T13) — content_hash dedupe
- `src/storage/AIResponseCache.ts` (T07) — 일반화 신규
- `src/storage/WorkspaceStore.ts` (T28) — 워크스페이스 CRUD + 전환
- `src/storage/NoteStore.ts` (T26) — Note CRUD + 3중 anchor
- `src/storage/AiChatHistoryStore.ts` (T25) — AI 대화 히스토리 영구 보존
- `src/storage/TagStore.ts` (T18) — Tag CRUD + kind 6종
- `src/storage/EmbeddingQueue.ts` (T14) — 백그라운드 임베딩 큐 (활성 탭 우선)
- `src/storage/schema/v04.sql` (T11) — SQLite 스키마 신규
- `src/storage/migrations/v03_to_v04.ts` (T15) — Glossary → Note / settings 폐기 키 / 자동 백업

### ai/ (4개)
- `src/ai/embedding/EmbeddingClient.ts` (T14) — OpenAI text-embedding-3-small (BYOK 디폴트)
- `src/ai/tagging/AutoTagger.ts` (T18) — Tag.kind 6종 (BYOK 디폴트)
- `src/ai/PromptComposer.ts` (T27) — system prompt 분기 (사용자 수준 옵션)
- `src/ai/types.ts` 확장 (PARTIAL) — ChatMessage / Embedding / Tag 타입

### main/ (7개)
- `src/main/IndexingService.ts` (T16, T17) — did-finish-load hook + 재방문 정책
- `src/main/ChatService.ts` (T25) — AI 채팅 retrieval + AiChatHistory INSERT
- `src/main/SearchService.ts` (T23) — 시간축 + 의미 검색
- `src/main/NoteService.ts` (T26) — 노트 CRUD + AI 태그
- `src/main/WorkspaceService.ts` (T28) — 워크스페이스 전환 + 탭·메모리·AI 컨텍스트·노트 교체
- `src/main/DwellTracker.ts` (T19) — dwell_ms 측정 (탭 활성 + focus)
- `src/main/Shortcut.ts` (T21) — Cmd+K 글로벌 단축키 캡처

### privacy/ (1개)
- `src/privacy/IndexingGate.ts` (T20) — 인덱싱 차단 (디폴트 list + 비밀번호 필드 감지)

### search/ (2개)
- `src/search/TimeRangeParser.ts` (T22) — 자연어 시간 파싱 ("지난주" / "6개월 전쯤" / "어제")
- `src/search/SearchService.ts` (T23) (main 또는 search 디렉토리 선택은 M3에서 결정)

### renderer/src/ (9개, PR b5.1 ShortcutSettings 추가)
- `src/renderer/src/search/SearchBar.tsx` (T21)
- `src/renderer/src/search/SearchResultCard.tsx` (T24)
- `src/renderer/src/search/PreviewPane.tsx` (T24, M5 후순위)
- `src/renderer/src/chat/ChatPanel.tsx` (T25) — TranslationPanel 대체
- `src/renderer/src/note/NotePanel.tsx` (T26)
- `src/renderer/src/workspace/WorkspaceSidebar.tsx` (T28)
- `src/renderer/src/workspace/WorkspaceSettings.tsx` (T27)
- `src/renderer/src/settings/ShortcutSettings.tsx` (T21, PR b5.1 정정) — Cmd+K override + Phase 1 단축키 정책
- `src/renderer/src/memory/MemoryStatsPanel.tsx` (T29)

### 테스트 (예상 50+개 신규, T30)

- IndexedPageStore / VectorIndex / PageContentCache / AIResponseCache / WorkspaceStore / NoteStore / AiChatHistoryStore / TagStore / EmbeddingQueue / migrations
- EmbeddingClient / AutoTagger / PromptComposer
- IndexingService / ChatService / SearchService / NoteService / WorkspaceService / DwellTracker / Shortcut
- IndexingGate
- TimeRangeParser
- 시나리오 회귀 셋 (시나리오 1·4 각 3~5 케이스, 시나리오 2·3 각 3~5 케이스) = 12~20 케이스

---

## F. 단계별 PR 전략 (G-013 적용)

각 분류별 PR 머지 순서:

```
[M2 — 폐기·일반화 도입]
  ① GENERALIZE 신규 모듈 + 어댑터 (TranslationCache → AIResponseCache, PageResultStore → IndexedPageStore base)
  ② DEPRECATE M2 즉시 (SummarizationPlanner)
  ③ ai/index.ts / ai/types.ts PARTIAL (export 정리)
  ④ main/index.ts IPC handler 6개 폐기 (단 호출지점 임시 stub 유지로 빌드 깨짐 방지)
  ⑤ main/services.ts paragraphs/page 분기 폐기 + IndexingService stub 위임
  ⑥ preload/index.ts API 정리

[M3 — IndexedPageStore + 임베딩 + 마이그레이션]
  ⑦ IndexedPageStore 확장 (sqlite-vec / Note / AiChatHistory / Tag)
  ⑧ EmbeddingClient + EmbeddingQueue
  ⑨ migrations/v03_to_v04.ts (Glossary → Note / settings 폐기 키 / 자동 백업)
  ⑩ PageCachePanel PARTIAL (IndexedPageStore 기반)
  ⑪ UserSettingStore PARTIAL (마이그레이션 케이스 + 신규 키)

[M4 — 인덱싱 hook + 자동 태깅 + Privacy + dwell]
  ⑫ IndexingService 본체 (did-finish-load + 재방문)
  ⑬ AutoTagger
  ⑭ DwellTracker
  ⑮ IndexingGate (Privacy 인덱싱 차단)

[M5 — 검색 + 채팅 + 노트 + 어댑터 제거]
  ⑯ Shortcut + SearchBar + TimeRangeParser
  ⑰ SearchService
  ⑱ SearchResultCard + PreviewPane
  ⑲ ChatPanel + ChatService + PromptComposer
  ⑳ NoteService + NotePanel
  ㉑ App.tsx PARTIAL (ChatPanel 교체 + 컨텍스트 메뉴 갱신)
  ㉒ TranslationRenderer / DisplayModePanel / GlossaryPanel / TranslationPanel / TranslationPopup DEPRECATE 호출지점 제거
  ㉓ TranslationCache / PageResultStore 어댑터 제거

[M6 — 워크스페이스 + 메모리 통계]
  ㉔ WorkspaceService + WorkspaceStore + WorkspaceSidebar
  ㉕ WorkspaceSettings + GeneralPanel PARTIAL
  ㉖ MemoryStatsPanel
  ㉗ TabManager / TabStateStore PARTIAL (workspace_id 메타)
  ㉘ OnboardingTour PARTIAL (v0.4 카드 갱신)
```

→ 약 28개 PR (소규모 단위), 평균 1~1.5 PR/일.

## G. 리스크 / 미지수

1. **main/index.ts 분량** — 약 1100+ lines 중 약 700 lines 폐기 + 신규 500 lines 추가. 한 번에 변경 시 PR diff 폭증 → 단계별 PR (G-013) 엄격 적용.
2. **App.tsx 우측 패널 교체** — TranslationPanel → ChatPanel 즉시 교체 시 UI 깨짐. feature flag (S3) 또는 양쪽 동시 렌더 후 점진 제거.
3. **PageCachePanel 운명** — IndexedPageStore 통합 후 의미가 워크스페이스 통계와 겹침. M3 진행 중 MemoryStatsPanel과 통합 여부 결정 → PRD §11 / §13 명시 필요.
4. **tabGuard.ts 위치** — `src/renderer/src/translation/` 아래 있는데 v0.4에서 번역 폐기 후 위치 부자연. `src/main/TabGuard.ts`로 이동 검토 (단 renderer 모듈에서 가져다 쓰는 의존 영향 점검 필요 — A4 의존 그래프).
5. **테스트 재작성 분량** — KEEP 20 / GENERALIZE 재작성 2 / PARTIAL 1 / DEPRECATE 3 / NEW 50+ = 약 75개. Sprint 014 358개 → 약 405개 예상 (DEPRECATE 차감 + NEW 가산). AC-8 누적 ≥ 420 임계 산식은 M0 T02 종료 후 정정.

## H. 다음 (A2 / A3 / A4 입력)

본 매트릭스가 입력으로 들어가는 후속 사전 분석:

- **A2 단위 테스트 분류** (T02): 본 매트릭스 DEPRECATE/GENERALIZE/KEEP/PARTIAL/NEW 분류를 테스트 단위로 매핑 + 시나리오 회귀 셋 정의
- **A3 데이터 마이그레이션** (T03): GENERALIZE 2건 + DEPRECATE 1건 (GlossaryStore) 데이터 자동 마이그레이션 스크립트 spec + dry-run + 자동 백업
- **A4 의존 그래프** (T04): DEPRECATE 6건 + GENERALIZE 2건 + PARTIAL 21건의 호출지점 전수 매트릭스 (특히 main/index.ts IPC channel 6개 폐기 영향)

## I. 변경 이력

- 2026-05-16: Sprint 015 M0 T01 작성. src/ 54개 + tests/ 29개 분류 완료. 단계별 PR 전략 (G-013) 28개 PR 안 박힘.
