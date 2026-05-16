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
M2-1 AIResponseCache 신규 + TranslationCache 어댑터 (feature flag)
M2-2 IndexedPageStore base 신규 + PageResultStore 어댑터
M2-3 SummarizationPlanner DEPRECATE
M2-4 translate:summarize-* IPC 폐기 (handler 2개)
M2-5 translate:paragraphs / page IPC 폐기 (handler 4개)
M2-6 translate:render / render-restore / pageResult:restore IPC 폐기 (handler 3개)
M2-7 ai/index.ts + types.ts PARTIAL (ProviderAdapter chat/embed 메서드 추가 시작)
M2-8 TranslationCache.test → AIResponseCache.test 재작성 + PageResultStore.test → IndexedPageStore.test 재작성
```

### 19.5.2 M3 IndexedPageStore + 임베딩 + 마이그레이션 (7 PR)

```
M3-1 SQLite v04.sql schema + 통합 DB 진입점
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
M5-5 PromptComposer (수준 분기) + ChatService (retrieval + 출처 인용)
M5-6 ChatPanel (TranslationPanel 교체) + chat_meta 표 schema
M5-7 NoteService + NotePanel (선택 → AI 자동 태그 → 3중 anchor + 임베딩)
M5-8 TranslationRenderer / DisplayModePanel / GlossaryPanel / TranslationPanel / TranslationPopup 호출지점 모두 제거 + 어댑터 제거
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
