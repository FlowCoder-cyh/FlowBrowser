# 00. Change History (v0.3 → v0.4)

> [← PRD 목차](./README.md)

PRD v0.4.0 **정식 발행** — Sprint 015 M6 T31 완료 (2026-05-19). M1 작성 시작 (2026-05-16) → M2~M5 구현 누적 → M6 T28~T30 워크스페이스/메모리 통계/시나리오 회귀 완성 → 본 시점 release tag.

## 0.1 v0.4.0 — 방향 전환 (2026-05-16)

### 배경

Sprint 014 (Codex OAuth Login Provider 활성화) + 15회 핫픽스 후 실측 결과, **Phase 1 (실시간 페이지 번역) 효용 한계** 확인:

1. **속도 한계**: gpt-5.5 reasoning low로도 49 문단에 수십 초~분. Wikipedia (2393 문단) 사실상 사용 불가.
2. **ChatGPT 구독 한도**: 5h/주. 페이지 1개당 49+ 호출이면 며칠 안 소진.
3. **Codex 백엔드는 코딩 어시스턴트 전용**: 번역 use case는 회색지대 우회 호출. 품질 우위 보장 안 됨.
4. **ToS 회색지대**: OpenAI 정책 변경 시 언제든 차단 가능.
5. **Chrome 내장 번역 대비 차별 약함**: Chrome 자동 번역으로 충분.

### 결정 — 방향 전환

- **유지**: AI 브라우저 본체 (Electron 셸 / 다중 탭 / Privacy / Codex OAuth / DOM extractor / Cache 인프라)
- **폐기**: YouTube 자막 / TTS 더빙 / STT / 실시간 페이지 번역 (displayMode replace·overlay) / SummarizationPlanner
- **재정의**: 번역 = 백그라운드 장시간 처리 (논문/PDF 등, 시스템 알림 트리거)
- **신규 메인**: **AI 콘텐츠 메모리 + 워크스페이스 브라우저** (Time Machine for the Web + 프로젝트 격리)

### 한 줄 정의

> 본 페이지를 자동 기억하면서, 프로젝트별로 환경이 격리되는 AI 리서치 브라우저

상세는 [`01_overview.md`](./01_overview.md) 참조.

## 0.2 변경 사항 요약

### 폐기 모듈

| 분류 | 모듈 | 사유 |
|---|---|---|
| 코드 폐기 | `src/perception/TranslationRenderer.ts` | replace/overlay 모드 폐기 |
| 코드 폐기 | `src/ai/SummarizationPlanner.ts` | 페이지 요약 use case 폐기 |
| 코드 폐기 | `src/renderer/src/settings/DisplayModePanel.tsx` | displayMode 폐기 |
| 코드 폐기 | `src/renderer/src/settings/GlossaryPanel.tsx` | Glossary → Note 자동 이전 후 패널 폐기 |
| 코드 폐기 | `src/renderer/src/translation/TranslationPanel.tsx` | ChatPanel로 전환 |
| 코드 폐기 | `src/renderer/src/translation/TranslationPopup.tsx` | 선택 영역 번역 팝업 폐기 |
| IPC 폐기 | `translate:render` / `render-restore` / `paragraphs` (+abort) / `page` (+abort) / `summarize-page` (+abort) / `pageResult:restore-current` (9개) | main/index.ts (출처: A4 §A1, Sprint 015 contract AC-3 — A1은 단순 묶음 6개로 카운트, 본 PR은 contract 9개 정밀화 채택) |
| IPC 폐기 | `cache:* / pageResult:* / glossary:* / translate:request` (12개) | services.ts (출처: A4 §A2) |
| preload 폐기 | `cacheApi / pageResultApi / glossaryApi / translateApi` (4 묶음) | preload/index.ts |
| 설정 폐기 | `translationMode` / `cancelOnTabSwitch` | UserSettingStore |

### 일반화 (어댑터 후 M5 제거)

| 기존 | 신규 |
|---|---|
| `TranslationCache` | `AIResponseCache` (kind: translation/embedding/ai_response/tag) |
| `PageResultStore` | `IndexedPageStore` (Page + Visit 분리, 워크스페이스 ID 메타, 본문 캐시 흡수) |

### 신규 모듈 (30+)

- **storage**: `IndexedPageStore` / `VectorIndex` (sqlite-vec wrapper) / `PageContentCache` / `AIResponseCache` / `WorkspaceStore` / `NoteStore` / `AiChatHistoryStore` / `TagStore` / `EmbeddingQueue` / `migrations/v03_to_v04.ts` / `schema/v04.sql` (SQLite 통합 DB 스키마)
- **ai**: `embedding/EmbeddingClient.ts` / `tagging/AutoTagger.ts` / `PromptComposer.ts`
- **main**: `IndexingService.ts` / `ChatService.ts` / `SearchService.ts` / `NoteService.ts` / `WorkspaceService.ts` / `DwellTracker.ts` / `Shortcut.ts`
- **privacy**: `IndexingGate.ts` (인덱싱 차단)
- **search**: `TimeRangeParser.ts` (자연어 시간 파싱)
- **renderer**: `search/SearchBar.tsx` / `search/SearchResultCard.tsx` / `search/PreviewPane.tsx` / `chat/ChatPanel.tsx` / `note/NotePanel.tsx` / `workspace/WorkspaceSidebar.tsx` / `workspace/WorkspaceSettings.tsx` / `memory/MemoryStatsPanel.tsx`

### 데이터 마이그레이션 (P0-1, P0-2)

| 기존 | 운명 |
|---|---|
| `glossary.json` GlossaryTerm | **Note 자동 이전** (ai_tags=["glossary", domain], 📥 기본 워크스페이스) |
| `user-setting.json` translationMode / cancelOnTabSwitch | **자동 제거** + 로그 (`<userDataDir>/migration-v04.log`) |
| `translation-cache.json` | **AIResponseCache** (kind=translation 부여, 폐기 requestType skip) |
| `page-results.json` | **IndexedPageStore** (Page + Visit 변환, workspace_id 부여) |
| `tabs.json` | **workspace_id 메타 추가** (모든 탭에 📥 기본 부여) |

자동 백업 위치: `<userDataDir>/backup/v03/<ISO_timestamp>/`. 절차 + revert: [`19_migration_v03_v04.md`](./19_migration_v03_v04.md).

## 0.3 Phase 분할 (Phase별 출시 ≠ Phase별 검증)

| Phase | 내용 | Sprint |
|---|---|---|
| **Phase 1** | 베이스 인프라 (워크스페이스 + IndexedPageStore + 임베딩 + 검색 + AI 채팅 + 노트) | 015 |
| **Phase 2** | 격리 강화 (cookies/session) + 하이라이트 + 백그라운드 번역 + 자동 수준 추정 | 016+ |
| **Phase 3** | 외부 통합 (로컬 LLM / Export / 워크스페이스 공유) | 017+ |

**MVP = Phase 1 + 2 + 3 전체** (Phase별 출시 X). 각 Phase 종료 시 evaluator 8점 + Known Issue 등록 / MVP 최종 = Phase 3 종료 후 딥검증.

상세 로드맵: [`16_roadmap.md`](./16_roadmap.md).

## 0.4 신규 가드레일 (G-012 ~ G-014)

| ID | 활성 | 역할 |
|---|---|---|
| G-012 | M1 | v0.4 방향 SSOT (`.flowset/specs/v04-direction.md`) 우선 갱신 — 역방향 금지 |
| G-013 | M2 | 단계별 PR 전략 (신규 + 어댑터 → 신규 사용 → 폐기 호출지점 제거) |
| G-014 | M3 | 데이터 마이그레이션 dry-run + 자동 백업 + revert + idempotent |

[`.flowset/guardrails.md`](../../.flowset/guardrails.md) 참조.

## 0.5 v0.3 이력 보존

v0.3.0 ~ v0.3.12 누적 이력은 [`archive/prd-v0.3/00_change_history.md`](../../archive/prd-v0.3/00_change_history.md) 보존. 본 PRD는 v0.4 신규 작성이라 v0.3 이력을 본문에 흡수하지 않음.

v0.3.12까지의 핵심 완성 자산:
- Electron 셸 + WebContentsView + URL Bar (Sprint 001)
- Privacy Filter 5단계 + OS Keychain 위임 (Sprint 002, G-004 + G-005)
- Provider Adapter + OpenAI API Key (Sprint 002+)
- TranslationCache 복합 키 + TTL 차등 (Sprint 005)
- PageResultStore + nodesSignature (Sprint 006)
- 다중 탭 + 영속 + UX (Sprint 008~013)
- Codex OAuth Login Provider (Sprint 014, Experimental + G-011)
- OnboardingTour (Sprint 014)

이 자산은 v0.4에서 **85% 재활용** (KEEP + GENERALIZE + PARTIAL). 폐기 11%.

## 0.6 발행 메타

### 0.6.1 v0.4.0 정식 발행 (2026-05-19)

- 발행일: 2026-05-19 (Sprint 015 M6 T31 완료 시점)
- Sprint: 015 M6 (T28~T31 모두 머지)
- 누적 PR: 65 (M5 종료 시점 61 + M6 T28~T31 4 PR)
- 누적 단위 테스트: 1068 (M5 종료 968 → M6 +100)
- 시나리오 회귀 셋 cover: 시나리오 1 (학술) 100% / 시나리오 4 (재발견) 100% / 시나리오 2·3 **0% (Sprint 016 M1 cover 예정 — Sprint 015 범위 외)**. v04-direction §11 "90% cover" 목표 표기는 Sprint 016 완료 시점 측정값으로 갱신.
- KI 누적: 17건 (HIGH 1 / MEDIUM 4 / LOW 12) — Sprint 015 잔여 hotfix KI-012~017 6건 등록 후 (PR #166)
- 작성 패턴: 19 섹션 분할 (단일 책임)
- SSOT 인용 디렉토리: `.flowset/specs/v04-*.md`
- 다음 변경 이력 갱신: Sprint 016 Phase 2 진입 완료 시 → v0.4.1 발행

### 0.6.2 v0.4.0 작성 메타 (2026-05-16 ~ 2026-05-19)

- 작성 시작: 2026-05-16 (Sprint 015 M1 PR b1)
- 작성 완료: 2026-05-17 (Sprint 015 M1 종합 evaluator Pass 6/2/0)
- 구현 완료: 2026-05-19 (Sprint 015 M6 T28~T30 머지)
- 종합 evaluator: 2026-05-19 (Sprint 015 M6 T31)

## 0.7 v0.4.1 — Phase 2 진입 + KI batch 정리 (2026-05-21)

Sprint 016 M0~M5 종결 시점 발행. M0 KI MEDIUM batch + LOW perf bench + M1 시나리오 2·3 cover + M2 어댑터 일괄 제거 + M3 cookies partition + Export/Import + M4 백그라운드 번역 + 하이라이트 + M5 종합 (T23 회귀 + T24 본 PRD + T25 핸드오프 + T26 Sprint 017 시안).

### 0.7.1 v0.4.1 발행 메타

- 발행일: 2026-05-21 (Sprint 016 M5 T24 시점)
- Sprint: 016 M0~M5 (T01~T26 모두 머지 예정 — T23 #217 + T24 본 PRD docs PR)
- 누적 PR: 114+ (Sprint 015 65 + Sprint 016 M0~M4 누적 +49 + M5 진행 중)
- 누적 단위 테스트: **1436 PASS** (Sprint 015 1068 → Sprint 016 M0~M4 +306 → M5 T23 +62 = +368 누적)
- 시나리오 회귀 셋 cover: 시나리오 1·4 100% (Sprint 015 T30) + 시나리오 2·3 cover (Sprint 016 M1 T07~T08) — 18/18 통합 회귀. KI-018 / KI-019 30 케이스 산식 cover (Sprint 016 M5 T23 scenario-accuracy 신규 통합 회귀 보강).
- KI 변동 (Sprint 016 누적 closed 후보 + 신규):
  - **MEDIUM closed (4)**: KI-001 macOS sqlite-vec (M0 T01 1차 PoC + 2차 matrix) / KI-004 response_format (M0 T04) / KI-006 abort 정책 (M0 T02 + T02-followup) / KI-007 TabManager workspace_id (M0 T03a/b/c)
  - **LOW closed (5)**: KI-002 PageResultStore (M2 T12) / KI-005 AutoTagger.tagNote (M4 T21) / KI-008 Workspace JSON Export/Import (M3 T17) / KI-010 인덱싱 broadcast (M0 T05) / KI-017 tabLabel context 회귀 (M0 T03b)
  - **HIGH 자가 status 전환**: KI-003 BYOK wiring (Sprint 015 M5 완료, `open` → `closed` 본 v0.4.1 메타)
  - **LOW perf bench infra cover (PASS 6 / DEFERRED 2)**: KI-011 (MemoryStats 0.447ms) / KI-012 (Indexing 0.027ms) / KI-013 (Search 1.404ms) / KI-014 (Workspace switch 0.283ms) / KI-015 ($0.20/월) / KI-016 (90.32MB) — `closed` 후보. KI-018 / KI-019 — 30 케이스 산식 cover (closed 후보 본 v0.4.1).
  - **신규 (Sprint 016 M3/M4)**: KI-020 (SPA did-navigate-in-page) / KI-021 (partition cleanup reconcile, Phase 2) / KI-022 (Import embedding_queue re-enqueue) / KI-023 (PDF viewer DOM range) / KI-024 (Shadow DOM cross-boundary) / KI-025 (contentHash 폐기 보수성) / KI-026 (PRD 표기 정정 — 본 v0.4.1 발행 시점 옵션 B `§11.11` 으로 해소)
- 가드레일 활성: G-001~G-015 (Sprint 015 8 + Sprint 016 신규 G-015 cookies partition 격리)
- 가드레일 추가 후보 (T25 핸드오프 박음): G-019 (perf bench infra 정량 임계 매트릭스 강제) — Sprint 017 시안 박음

### 0.7.2 v0.4.1 주요 변경 — Phase 2 진입

- **§11.11 Highlights 신설** (M4 T20 + M5 T24) — KI-026 옵션 B 해소. codex 사전 협의 권고 정합 (§11.5 Workspace CRUD 점유로 §11.11 박음). G-013 1단계 옵션 A (in-memory store) 산출물 보존. Phase 2 옵션 B (SQLite swap) Sprint 017 위임.
- **G-015 cookies partition 격리 실효** (M3 T14~T16) — WorkspacePartitionManager (`persist:ws-{uuid}` 단위) 도입. 워크스페이스 삭제 시 cascade clearStorageData + clearCache.
- **어댑터 일괄 제거 종결** (M2 T09~T13) — ProviderAdapter.translate / executeTranslateRequest / TranslationCache 어댑터 / PageResultStore 어댑터 / fetchImpl 통일. v0.3 자산 완전 폐기.
- **백그라운드 번역 + 하이라이트 인프라** (M4 T18~T22) — BackgroundTranslationQueue / NotificationService / AutoTagger.tagNote / UserLevelEstimator mock / NoteHighlight DOM anchor.

### 0.7.3 v0.4.1 작성 메타

- 작성 시작: 2026-05-21 (Sprint 016 M5 T24 진입)
- 작성 완료: 2026-05-21 (본 docs PR 머지 시점)
- 종합 evaluator: 2026-05-21 (Sprint 016 M5 T25 시점)
- 다음 발행 예고: v0.4.2 또는 v0.5.0 (Sprint 017 Phase 3 진입 — 로컬 LLM / Notion Export / 공유 / T20 renderer UI overlay / 옵션 B SQLite swap)

## 0.8 v0.5.0 — Phase 3 진입 (로컬 임베딩 통합 + Schema v06 + Notion/공유 설계) (2026-05-29)

Sprint 017~018 종결 시점 발행. Phase 2 (격리 강화 + 정형 출력) 종료 후 **Phase 3 (외부 통합 + 운영성)** 진입. v0.4.1 시점 "Phase 3 future" 로 표기됐던 로컬 임베딩·로컬 LLM·Schema v06 가 **실 코드로 박힘** + Notion Export / 워크스페이스 공유는 **설계 spec 완료 (구현 Sprint 020/021 위임)**.

> **본 발행은 "shipped drift 정정 + 메타 bump + 로드맵 재정렬"** (codex 019e718f 정합). Notion·공유·LocalLLM 의 Sprint 020+ 구현 상세를 본문에 선반영하지 않음 — 실 구현 시점에 해당 섹션 갱신.

### 0.8.1 v0.5.0 발행 메타

- 발행일: 2026-05-29 (Sprint 018 M4 T10 시점)
- Sprint: 018 M0~M4 (mini-milestone β PR B/C + T19/Schema v06 spec + T17a~e + T21 spike + T22/T09 cover + 본 v0.5.0 docs PR)
- 누적 PR: first-parent 머지 누적 **267** (최신 #269 state sync, 본 v0.5.0 docs PR 예정 **#270**)
- 누적 단위 테스트: **1950 PASS** (104 파일 — 실측. Sprint 016 v0.4.1 시점 1436 → Sprint 017~018 +514 누적; 본 v0.5.0 은 docs-only 라 무변동)
- 시나리오 회귀 셋 cover: Phase 1 평균 **95%** (S1 학술 100% / S2 PM 90% / S3 학습 90% / S4 재발견 100% — §16.5 Phase 1 열). Phase 2 평균 97.5% / Phase 3 평균 100% 는 §16.5 목표열 (MVP 최종 측정값).
- KI: 누적 **31 등록 / 25 closed / 잔여 6** (헤더 status 실측 — HIGH 0 / **MEDIUM 1** [KI-001 in-progress] / **LOW 5** [KI-023·KI-025·KI-028·KI-029·KI-030] — Phase 3 종료 후 MVP 직전 batch 정리 대상). 본 v0.5.0 발행 KI 변동 0. ⚠️ 발행 시점(T10) 메타는 "23 closed / 잔여 8 / MEDIUM 3 [KI-004·006 포함]" 으로 기재했으나, **Sprint 018 M5 T13 후속 reconciliation** 에서 KI-004·006 이 실제로는 Sprint 016 M0 구현 완료(본 §0.8 v0.4.1 :148 이미 closed 기재)인데 `known-issues.md` 헤더 status 만 `open` 잔존한 drift 로 확인 → 본 집계를 실 상태(25 closed / 잔여 6 / MEDIUM 1)로 정합 (:148 과의 내부 모순 해소). 실 구현 시점 불변(Sprint 016) — status 표기만 정합. (T12 §통계 off-by-one 9→8 정정 후 본 reconciliation 8→6.)
- 가드레일 활성: G-001~G-018 + **G-021** (docs PR dual review 실 호출 강제) + **G-022** (사용자 마무리 의도 후 진입 차단, Sprint 018 M0 PreToolUse blocking 전환).
- 작성 패턴: 기존 19 섹션 유지 (신규 섹션 추가 X — 로컬 LLM 은 §12/§06, Notion Export 는 §11.5.6, 공유는 §11 신규 소절, Schema v06 은 §04, 진행/매핑은 §16 에 반영). 로컬 LLM 명칭 `LocalLLMProvider`/`LocalEmbeddingProvider` → 단일 `OllamaProvider` (chat+embed) 수렴. §05/§09/§15 의 `vec_pages` 단수 SQL 예시는 dimension family 총칭 (§4.3.8 umbrella note) — 전면 dimension-aware 정합은 후속 drift sweep (구현 시점 동반).

### 0.8.2 v0.5.0 주요 변경 — Phase 3 진입

1. **Schema v06 구현 완료** (Sprint 018 T17a, `V06_SCHEMA_VERSION=3`) — `workspaces.embedding_model TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small:1024'` (CHECK 1024/768 allowlist) + vec0 dimension 분리 `vec_pages_1024`/`vec_pages_768`/`vec_notes_1024`/`vec_notes_768`. `migrateV05ToV06` (G-014 dry-run + 자동 백업 `<userDataDir>/backup/v05/<ISO_ts>/` + sentinel idempotent). [§04 §4.3.1/§4.3.8](./04_data_model.md) 반영.
2. **로컬 임베딩 통합** (Sprint 018 T17 라인 — T17a~e + write-path wiring) — `OllamaProvider.embed()` (`/api/embed`, `nomic-embed-text` 768 dim, `supportsEmbed=true`) + 워크스페이스 생성 시 임베딩 모델 선택 UX + query/write path 가 워크스페이스 `embedding_model` 따라 provider·dimension 해소 (provider-aware). E2E 격리 검증 (`tests/integration/t17e-embedding-isolation.test.ts`). [§08 §8.3](./08_indexing.md) + [§12 §12.2](./12_provider_adapter.md) 반영.
3. **로컬 LLM 채팅 wiring** (Sprint 017 T14 chat + Sprint 018 T17c embed) — `OllamaProvider` (`providerType='local'`) 가 `providers.set('local', ...)` 로 등록 + `defaultProviderId='local'` 채팅 경로 (OpenAI fallback 금지 — 비용/프라이버시 surprise 회피) + 검색 embed 경로. **`chatStream` 은 defer** (Phase 3 후속). 로드맵 §16.4.1 의 미래 명칭 `LocalLLMProvider`/`LocalEmbeddingProvider` 는 실 구현에서 단일 `OllamaProvider` (chat+embed) 로 수렴 — §16.4.1 명칭 정정 동반.
4. **Notion Export 설계 spec** 완료 (Sprint 018 T19, 옵션 C spec only) — `.flowset/specs/sprint-018-notion-export-spec.md`. canonical JSON (`WorkspaceExportV1`) round-trip + Notion presentation projection 분리. **구현 Sprint 020 위임** (G-013 단계별). [§11 §11.5.6](./11_workspace.md) 상태 반영.
5. **SharedWorkspaceFormat 설계 spec** 완료 (Sprint 018 T21) — `.flowset/specs/v05-collab-spike.md`. 단방향 파일 공유 (`.fbworkspace` = gzip(envelope) + Ed25519 TOFU 서명 + untrusted import validator P0). **구현 Sprint 021 위임**. [§11 §11.12](./11_workspace.md) 신규 소절.
6. **백그라운드 번역 + 하이라이트 SQLite 영속화** (Sprint 016~017) — `highlights` 테이블 v05 도입 (§11.11 Phase 2 옵션 B SQLite swap 실효). v0.4.1 에 일부 반영, 본 발행에서 Schema 정합 명시.

### 0.8.3 v0.5.0 작성 메타

- 작성 시작: 2026-05-29 (Sprint 018 M4 T10 진입, 사용자 명시 entry 후 — G-022)
- 작성 완료: 2026-05-29 (본 docs PR 머지 시점)
- 사전 설계 협의: codex `019e718f-0901-7443-989a-320f2011b111` (read-only — 섹션 불일치/scope/PR 구성/Phase 3 종료 검토 4문항)
- 다음: Phase 3 종료 검토 체크리스트 (S018-T11, `.flowset/specs/phase3-exit-checklist.md`) → Sprint 018 종합 + Sprint 019 시안 (M5)
- 다음 발행 예고: v0.5.1 또는 v0.6.0 (Sprint 020 Notion Export 구현 + Sprint 021 워크스페이스 공유 구현 + Phase 3 종료 임계 충족 시 MVP 최종)
