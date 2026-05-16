# 00. Change History (v0.3 → v0.4)

> [← PRD 목차](./README.md)

PRD v0.4 정식 발행 — Sprint 015 M1 (2026-05-16).

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
| IPC 폐기 | `translate:render` / `render-restore` / `paragraphs` (+abort) / `page` (+abort) / `summarize-page` (+abort) / `pageResult:restore-current` (9개) | main/index.ts |
| IPC 폐기 | `cache:* / pageResult:* / glossary:* / translate:request` (12개) | services.ts |
| preload 폐기 | `cacheApi / pageResultApi / glossaryApi / translateApi` (4 묶음) | preload/index.ts |
| 설정 폐기 | `translationMode` / `cancelOnTabSwitch` | UserSettingStore |

### 일반화 (어댑터 후 M5 제거)

| 기존 | 신규 |
|---|---|
| `TranslationCache` | `AIResponseCache` (kind: translation/embedding/ai_response/tag) |
| `PageResultStore` | `IndexedPageStore` (Page + Visit 분리, 워크스페이스 ID 메타, 본문 캐시 흡수) |

### 신규 모듈 (30+)

- **storage**: `IndexedPageStore` / `VectorIndex` (sqlite-vec wrapper) / `PageContentCache` / `AIResponseCache` / `WorkspaceStore` / `NoteStore` / `AiChatHistoryStore` / `TagStore` / `EmbeddingQueue` / `migrations/v03_to_v04.ts`
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

- 발행일: 2026-05-16
- Sprint: 015 M1
- 작성 패턴: 19 섹션 분할 (단일 책임)
- SSOT 인용 디렉토리: `.flowset/specs/v04-*.md`
- 다음 변경 이력 갱신: Phase 1 종료 (Sprint 015 M6 완료 시) → v0.4.1 발행
