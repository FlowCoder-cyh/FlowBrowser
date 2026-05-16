# Sprint 015 — Phase 1 / AI 콘텐츠 메모리 + 워크스페이스 베이스 인프라

> **상태: 정의 완료, M0부터 자율 착수**
> Phase: 1 (방향 전환 후 신규 Phase 1 — 베이스 인프라)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2.5~3주

## 0. 사전 조건

- [x] Sprint 014 종료 (PR #76~#95 머지 + END 핸드오프 #96 + #97 핫픽스)
- [x] 단위 테스트 358/358 PASS
- [x] Sprint 014 evaluator (M1~M4) + 핸드오프 evaluator Pass 10/0/0
- [x] PRD v0.3.12 발행 (방향 전환 직전 마지막 버전)
- [x] **방향 전환 결정 핸드오프** (`.flowset/handoffs/2026-05-16.md`)
- [x] **v0.4 방향 SSOT** (`.flowset/specs/v04-direction.md` — 본 세션 박힘)
- [x] 본 세션 추가 결정 P0~P2 10건 박힘 (v04-direction.md §17~§18)
- [x] Codex OAuth 동작 검증 ✅ (재활용 자산으로 보존)
- [x] 가드레일 위반 0 (8 Sprint 연속)

## 1. Sprint 목표

**Phase 1 베이스 인프라 = 4개 시나리오 모두 동일 컴포넌트 위에서 동작하는 상태.**

L2618 결합 컨셉 (#2 Time Machine + #1 워크스페이스)의 Phase 1을 한 Sprint 안에 완성. 시나리오 1·4는 100% cover, 시나리오 2·3은 90% cover 목표. Phase 2(cookies 격리/하이라이트/백그라운드 번역) 및 Phase 3(로컬 LLM/Export/공유)은 Sprint 016+로 이월.

**기존 v0.3 자산은 완전무결 마이그레이션**: TranslationRenderer/SummarizationPlanner 폐기, TranslationCache → AIResponseCache 일반화, PageResultStore → IndexedPageStore 일반화, Glossary → Note 자동 이전.

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| **M0 사전 분석 (A1~A4)** | | |
| S015-T01 | 폐기 코드 식별 매트릭스 — 파일/모듈 단위 폐기/일반화/유지/부분폐기 분류 + 일정 매핑 | `.flowset/specs/v04-migration-matrix.md` |
| S015-T02 | 단위 테스트 분류 (358개) — 폐기/유지/재작성 + Phase 1 시나리오 회귀 셋 정의 | `.flowset/specs/v04-test-classification.md` |
| S015-T03 | 데이터 마이그레이션 분석 — 기존 SQLite·TranslationCache·PageResultStore·Glossary·UserSetting의 운명 + 자동 마이그레이션 스크립트 spec | `.flowset/specs/v04-data-migration.md` |
| S015-T04 | 의존 그래프 분석 — 폐기 대상 모듈 호출지점 전수 + IPC 채널 변경 영향 매트릭스 | `.flowset/specs/v04-dependency-graph.md` |
| **M1 PRD v0.4 작성** | | |
| S015-T05 | PRD v0.4 19개 섹션 (00~19) 작성 — `.flowset/specs/v04-direction.md` SSOT 인용 | `docs/prd/00_change_history.md` ~ `19_migration_v03_v04.md` |
| S015-T06 | 진입 문서 갱신 — README.md / state.md / requirements.md / ontology.md (v0.4 도메인 개념 추가) | 4개 파일 |
| **M2 폐기 + 일반화 (S1 단계별 PR + S3 feature flag)** | | |
| S015-T07 | TranslationCache → AIResponseCache 일반화 — 키 schema 확장 (key kind: translation/embedding/ai_response/tag) / v0.3 호환 어댑터 유지 / `flowbrowser.v04.enabled` flag | `src/storage/AIResponseCache.ts`, `src/storage/TranslationCache.ts` 어댑터 |
| S015-T08 | PageResultStore → IndexedPageStore base 일반화 — Page/Visit 분리 / 워크스페이스 ID 메타 / v0.3 호환 어댑터 | `src/storage/IndexedPageStore.ts`, 어댑터 |
| S015-T09 | TranslationRenderer / SummarizationPlanner / displayMode replace·overlay 폐기 마킹 — feature flag로 비활성화 + 의존 호출지점 정리 (T04 그래프 기반) | `src/render/*`, `src/translation/*`, `src/main/services.ts` |
| S015-T10 | paragraphs/page IPC 채널 폐기 마킹 + 호출지점 제거 — `src/main/index.ts` IPC handler 제거 / preload API deprecation 마킹 / 호출 UI 제거 | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/**` |
| **M3 IndexedPageStore + 임베딩 + 마이그레이션** | | |
| S015-T11 | IndexedPageStore SQLite 스키마 신규 — Workspace/Page/Visit/Note/AiChatHistory/Tag 테이블 + forward-compatibility 컬럼 (Phase 2/3 외래키 nullable) | `src/storage/schema/v04.sql`, migration scripts |
| S015-T12 | sqlite-vec 통합 — Electron native module 빌드 검증 + 벡터 인덱스 CRUD wrapper | `src/storage/VectorIndex.ts` |
| S015-T13 | 페이지 본문 캐시 — content_hash 기반 dedupe + 재방문 시 본문 변경 감지 | `src/storage/PageContentCache.ts` |
| S015-T14 | 임베딩 클라이언트 — OpenAI `text-embedding-3-small` 호출 + Provider Adapter 통한 토큰 사용 / 백그라운드 큐 (활성 탭 우선, 동일 priority FIFO) / **BYOK 디폴트 (G-003 강화 — 페이지마다 자동 호출되는 백그라운드 임베딩이 ChatGPT 한도를 묵시 소진하지 않도록)** | `src/ai/embedding/EmbeddingClient.ts`, `src/storage/EmbeddingQueue.ts` |
| S015-T15 | 데이터 마이그레이션 스크립트 — Glossary → Note 자동 이전 (ai_tags=["glossary"], "📥 기본" 워크스페이스), settings 폐기 키 자동 제거 + `.flowset/logs/v04-migration.log` 기록 / dry-run + 자동 백업 (S4) | `src/storage/migrations/v03_to_v04.ts` |
| **M4 인덱싱 hook + 자동 태깅 + Privacy** | | |
| S015-T16 | 페이지 인덱싱 hook — `did-finish-load` → ParagraphExtractor (재활용) → 메타 추출 → Page UPSERT + Visit INSERT → 임베딩 큐 등록 | `src/main/IndexingService.ts` |
| S015-T17 | 재방문 정책 — content_hash 비교, 변경 없음 시 Visit만 INSERT, 변경 있음 시 Page UPDATE + 임베딩 재생성 | `src/main/IndexingService.ts` |
| S015-T18 | AI 자동 태깅 — Tag.kind ∈ {topic, entity, metric, sentiment, domain, freeform}, 인덱싱 add-on (Provider Adapter 호출, JSON 응답 파싱). **BYOK (OpenAI API Key) 디폴트, Codex OAuth는 사용자 명시 동의 시에만** (G-003 강화 — 인덱싱 자동 호출이 ChatGPT 한도를 묵시 소진하지 않도록) | `src/ai/tagging/AutoTagger.ts` |
| S015-T19 | dwell_ms 측정 — 탭 활성 + 페이지 focus 시간 누적, focus 잃으면 일시정지 | `src/main/DwellTracker.ts` |
| S015-T20 | Privacy Filter 인덱싱 차단 확장 — 디폴트 도메인 list (bank/mail/login 패턴) + 비밀번호 필드 감지 → 자동 차단 / 사용자 추가·제외 가능 | `src/privacy/IndexingGate.ts`, `UserSetting.privacyExclusions[]` |
| **M5 검색바 + AI 채팅 + 노트** | | |
| S015-T21 | 검색바 (Cmd+K) — 글로벌 단축키 (메인 프로세스 캡처, 사용자 설정 가능 디폴트 `Cmd/Ctrl+K`) + 입력 UI + 결과 list | `src/renderer/src/search/SearchBar.tsx`, `src/main/Shortcut.ts` |
| S015-T22 | 자연어 시간 파싱 — "지난주" / "6개월 전쯤" / "어제" 등 → `{from, to}` 시간 범위 (사용자 발화 시점 기준 계산) | `src/search/TimeRangeParser.ts` |
| S015-T23 | 검색 retrieval — 질의 임베딩 + 시간 필터 + top-k 정렬 공식 `score = 0.85 × cosine_sim + 0.15 × exp(-days_ago/180)` / Page + Note 모두 retrieval 대상 (R1) | `src/search/SearchService.ts` |
| S015-T24 | 검색 미리보기 — 제목 + URL + 의미 매칭 발췌 (±100자 highlight) + 시간 시그널 ("5일 전, 12분 머묾") + 클릭 시 본문 캐시 + 노트 + AI 대화 복원 | `src/renderer/src/search/SearchResultCard.tsx`, `src/renderer/src/search/PreviewPane.tsx` |
| S015-T25 | AI 채팅 패널 — `TranslationPanel` → `ChatPanel` 변환 / 현 워크스페이스 메모리 retrieval (디폴트) / Markdown + JSON 메타 표 schema (`{rows, columns, cells: [{value, sources}]}`) / 출처 셀 클릭 → 본문 캐시 / AiChatHistory INSERT (workspace_id + retrieved_page_ids) | `src/renderer/src/chat/ChatPanel.tsx`, `src/main/ChatService.ts` |
| S015-T26 | 노트 모델 + UI — 텍스트 선택 → 컨텍스트 메뉴 "노트에 추가" → AI 자동 태그 → page_id + visit_id + workspace_id anchor / 노트 본문 임베딩 → 검색 retrieval 대상 (R1) | `src/renderer/src/note/NotePanel.tsx`, `src/main/NoteService.ts` |
| S015-T27 | 사용자 수준 직접 선택 (R3-A) — 워크스페이스 설정 "내 수준: 초보/중급/고급" → AI 채팅 system prompt 분기 | `src/renderer/src/workspace/WorkspaceSettings.tsx`, `src/ai/PromptComposer.ts` |
| **M6 워크스페이스 + 메모리 통계 + 종합** | | |
| S015-T28 | 워크스페이스 사이드바 — 좌측 패널 / 워크스페이스 리스트 + "+ 새 워크스페이스" / preset 12종 아이콘 (📚 💻 🎯 🏠 🔬 ✍️ 🎨 📊 🌍 ⚖️ 💡 🛒) + 사용자 이모지 입력 / 전환 시 탭·메모리·AI 컨텍스트·노트 전부 교체 / 앱 첫 실행 시 "📥 기본" 워크스페이스 자동 생성 | `src/renderer/src/workspace/WorkspaceSidebar.tsx`, `src/main/WorkspaceService.ts` |
| S015-T29 | 메모리 통계 UI — 좌하단 패널 / N건 인덱싱 / 마지막 N분 / 노트 M개 / +AI 메모 (워크스페이스 단위 카운트, 실시간 갱신) | `src/renderer/src/memory/MemoryStatsPanel.tsx` |
| S015-T30 | 단위 테스트 — Phase 1 회귀 셋 (시나리오 1·4) + 신규 컴포넌트 (IndexedPageStore / VectorIndex / EmbeddingClient / IndexingService / SearchService / ChatService / NoteService / WorkspaceService / TimeRangeParser / AutoTagger / IndexingGate / DwellTracker / migrations) | `tests/unit/**/*.test.ts` |
| S015-T31 | PRD v0.4.0 발행 + Sprint 015 종합 evaluator + state/handoff/known-issues 초기화 + Phase 2 진입 contract 시안 (Sprint 016 예고) | `docs/prd/`, `.flowset/state.md`, `.flowset/handoffs/`, `.flowset/known-issues.md`, `.flowset/contracts/sprint-016.md` (시안만) |

### 제외 (Sprint 016+ / Phase 2)

- **워크스페이스 cookies/session/캐시 완전 격리** (Electron Partition) — Sprint 016
- **하이라이트** (노트 페이지 내 고정 위치 표시) — Sprint 016
- **백그라운드 번역 작업 큐 + 시스템 알림** — Sprint 016
- **자동 수준 추정** (R3-B 메타 학습) — Sprint 016+
- **로컬 LLM 옵션 (Ollama) / 로컬 임베딩 옵션 (sentence-transformers) / Export (Notion/Markdown) / 워크스페이스 공유** — Sprint 017+ (Phase 3)
- **MVP 최종 딥검증** (시나리오 4개 100% 시연 + 사용자 실사용 1주) — Phase 3 종료 후

## 3. 수용 기준

### AC-1 M0 사전 분석 4종 (S015-T01 ~ T04)

- **T01 폐기 매트릭스**: 폐기/일반화/유지/부분폐기 4종 분류로 src/ 전 파일 분류. 폐기 대상에 대체 모듈 명시. 일정 = M2 또는 M5.
- **T02 테스트 분류**: 358개 단위 테스트 폐기 N / 유지 M / 재작성 K / 신규 추가 P 명시. Phase 1 시나리오 4개 회귀 셋 정의 (각 시나리오당 3~5 케이스).
- **T03 데이터 마이그레이션**: 기존 SQLite/Cache/PageResult/Glossary/UserSetting의 자동 마이그레이션 또는 폐기 결정 명시. dry-run 절차 + 자동 백업 위치(`<userDataDir>/backup/v03/<ISO_timestamp>/`) + revert 경로. (M0 A3 §C 정정 반영)
- **T04 의존 그래프**: 폐기 대상 (TranslationRenderer / SummarizationPlanner / paragraphs IPC) 호출지점 전수 + IPC 채널 변경 영향 매트릭스 + 단계별 PR 순서 권고.

### AC-2 PRD v0.4 발행 (S015-T05 ~ T06)

- `docs/prd/` 아래 19개 섹션 (`00_change_history.md` ~ `19_migration_v03_v04.md`) 작성 완료
- 본문 모든 결정사항은 `.flowset/specs/v04-direction.md` 인용 (추측 X)
- README.md / state.md / requirements.md / ontology.md에 v0.4 도메인 개념 (워크스페이스/Page/Visit/Note/AiChatHistory/Tag/임베딩/sqlite-vec) 추가
- PRD v0.4.0 (정식 발행 — v0.3.12 → v0.4.0)

### AC-3 폐기 + 일반화 (S015-T07 ~ T10)

- `AIResponseCache` 신규 동작 + `TranslationCache` 어댑터로 v0.3 호출 유지 (feature flag `flowbrowser.v04.enabled` false 시 어댑터 경로)
- `IndexedPageStore` base 동작 + `PageResultStore` 어댑터 유지
- `TranslationRenderer` / `SummarizationPlanner` / `displayMode replace·overlay` 코드 비활성 + 의존 호출지점 0
- **IPC 21개 폐기 (main/index.ts 9개 + services.ts 12개) + 20~25개 신규 매핑** (M0 A4 §A 참조 — main: `translate:render` / `translate:render-restore` / `translate:paragraphs` / `translate:paragraphs-abort` / `translate:page` / `translate:page-abort` / `translate:summarize-page` / `translate:summarize-abort` / `pageResult:restore-current`. services: `cache:stats` / `cache:clear-all` / `pageResult:stats` / `pageResult:clear` / `glossary:list` / `glossary:add` / `glossary:remove` / `glossary:update` / `glossary:export` / `glossary:clear` / `glossary:version` / `translate:request`. 신규는 M3~M6 누적 `indexing:* / search:* / chat:* / note:* / workspace:* / shortcut:* / embedding:* / tagging:* / memory:*`)
- preload API 폐기 4 묶음 (`cacheApi` / `pageResultApi` / `glossaryApi` / `translateApi`) + 8 묶음 신규 (`indexingApi` / `searchApi` / `chatApi` / `noteApi` / `workspaceApi` / `shortcutApi` / `embeddingApi` / `taggingApi`)
- UI 호출 제거 (TranslationPanel 약 30 호출지점 / GlossaryPanel 8 호출지점 / 등 약 60개)
- M2 종료 시 lint / typecheck / test / build 모두 PASS

### AC-4 IndexedPageStore + 임베딩 + 마이그레이션 (S015-T11 ~ T15)

- 신규 SQLite 스키마 (`v04.sql`) 적용 — Workspace / Page / Visit / Note / AiChatHistory / Tag 테이블 + forward-compatibility 컬럼 (P2/P3 외래키 nullable)
- sqlite-vec native 모듈 Electron 빌드 통과 (Windows/macOS 둘 다)
- 페이지 본문 캐시 content_hash dedupe 동작 + 재방문 변경 감지
- OpenAI `text-embedding-3-small` 호출 + 백그라운드 큐 (활성 탭 우선, 동일 priority FIFO)
- 마이그레이션 dry-run 절차 + 백업 + Glossary → Note 자동 이전 + settings 폐기 키 제거 + 로그 기록

### AC-5 인덱싱 hook + 자동 태깅 + Privacy (S015-T16 ~ T20)

- `did-finish-load` → 자동 인덱싱 → Page+Visit+임베딩 큐 INSERT (시나리오 1·3·4 cover)
- 재방문 시 content_hash 비교 → 변경 없음 = Visit만 누적 (시나리오 3 "첫 진입 + 다시 본 시점")
- AI 자동 태깅 6종 kind 동작 (시나리오 1 freeform / 시나리오 2 정형 topic·entity·metric·sentiment·domain)
- dwell_ms 측정 (탭 활성 + focus, focus 잃으면 일시정지)
- Privacy Filter 인덱싱 차단 디폴트 list + 비밀번호 필드 감지 + 사용자 settings 추가·제외 (G-004 강화)

### AC-6 검색바 + AI 채팅 + 노트 (S015-T21 ~ T27)

- Cmd+K 단축키 캡처 (메인 프로세스, 사용자 설정 가능, 디폴트 `Cmd/Ctrl+K`)
- 자연어 시간 파싱 5종 (어제 / 지난주 / N개월 전 / N년 전 / 절대 날짜)
- 검색 정렬 공식 `score = 0.85 × cosine_sim + 0.15 × exp(-days_ago/180)` 동작
- 시나리오 4 회귀: "6개월 전 마이크로서비스 vs 모놀리스" 시나리오로 top-3에 정답 포함
- 검색 결과 클릭 → 본문 캐시 + 해당 visit 노트 + 해당 visit AI 대화 복원 (다시 fetch X)
- AI 채팅 패널 — `TranslationPanel` → `ChatPanel` 변환 / 워크스페이스 메모리 retrieval / 표 schema (Markdown + JSON 메타) / 출처 셀 클릭 동작 / AiChatHistory 영속
- 노트 — 선택 → AI 자동 태그 → 3중 anchor (page+visit+workspace) + 노트 본문 임베딩 + 검색 retrieval 대상 (시나리오 1 "이 메커니즘 어디서 봤더라" cover)
- 사용자 수준 직접 선택 워크스페이스 설정 + system prompt 분기 동작

### AC-7 워크스페이스 + 메모리 통계 (S015-T28 ~ T29)

- 워크스페이스 사이드바 + 생성/전환/preset 12종 + 사용자 이모지 입력 동작
- 워크스페이스 전환 시 탭 / 페이지 메모리 / AI 컨텍스트 / 노트 전부 교체 (시나리오 1·2·3 격리 검증)
- 앱 첫 실행 시 "📥 기본" 워크스페이스 자동 생성
- 메모리 통계 UI 좌하단 (N건 인덱싱 / 마지막 N분 / 노트 M개 / +AI 메모) 워크스페이스 단위 실시간 갱신

### AC-8 통과 기준 (S015-T30 ~ T31)

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 9 Sprint 연속)
- **누적 단위 테스트 ≥ 420** (목표 431~471). 산식: 358 (Sprint 014) − 49 (DEPRECATE 차감) + 26 (GENERALIZE 확장) + 16 (PARTIAL 확장) + 98~138 (NEW) ≈ 431~471. 정정 출처: `.flowset/specs/v04-test-classification.md` §H
- 시나리오 회귀 셋 (1·4 100%, 2·3 90%+) 통과
- PRD v0.4.0 정식 발행
- Known Issue 등록 정책 활성 (`.flowset/known-issues.md` 신규 + KI-NNN 형식)
- Sprint 016 contract 시안 작성 (Phase 2 진입 준비)

## 4. 마일스톤

| M | 산출물 | 작업 | 기간 |
|---|---|---|---|
| **M0** | A1~A4 사전 분석 4종 | T01~T04 | 3~4일 |
| **M1** | PRD v0.4.0 19개 섹션 | T05~T06 | 2~3일 |
| **M2** | 폐기 + 일반화 (어댑터 + 호출지점 제거) | T07~T10 | 2~3일 |
| **M3** | IndexedPageStore + sqlite-vec + 임베딩 + 마이그레이션 | T11~T15 | 4~5일 |
| **M4** | 인덱싱 hook + 자동 태깅 + Privacy + dwell | T16~T20 | 3~4일 |
| **M5** | 검색바 + AI 채팅 + 노트 + 수준 옵션 | T21~T27 | 4~5일 |
| **M6** | 워크스페이스 사이드바 + 메모리 통계 + 종합 핸드오프 | T28~T31 | 2~3일 |

총 20~27일 (2.5~3.5주 보수 추정). Sprint 014 4주 패턴 대비 단축 목표.

## 5. 가드레일 적용

### 기존
- **G-001** PRD 정합 — PRD v0.4.0 SSOT 발행 + 본 contract와 정합
- **G-003** 인증 금지선 + **정체성 원칙** — **자동 인덱싱(T16)·자동 임베딩(T14)·자동 태깅(T18) 호출 모두 BYOK 디폴트**, Codex OAuth는 사용자 명시 동의 시에만. **UA 위장 X / 봇 우회 X / 헤드리스 X / 자동 prefetch X 원칙은 PRD §13에 박힘 (T05)** — 모든 사이트 결격사유 0 원칙 유지
- **G-004** Privacy Filter P0 — 인덱싱 차단 list + 비밀번호 필드 감지 (확장 적용, T20)
- **G-005** OS Keychain 위임 — OpenAI API Key / Codex OAuth 토큰 safeStorage 유지
- **G-006** 추측 금지 — v04-direction.md SSOT 인용, PRD에 "TBD" 금지
- **G-007** main 직접 push 금지 — 모든 작업 브랜치 + PR
- **G-009** 커밋명 — `WI-S015M0-...` / `WI-S015M1-...` / ... / `WI-S015M6-...` (NNN 한 분절, G-009 9 Sprint 연속). **T 번호는 한글 작업명 본문에 박음** (예: `WI-S015M0-docs T01 폐기 매트릭스 작성`), `-T01-` 추가 분절 금지 (학습 30, 2026-05-16 Sprint 015 T01 amend 사례)
- **G-010** UTF-8 / LF
- **G-011** 공개 endpoint 회색지대 — Codex OAuth 유지 (가벼운 채팅 호출에 적합)

### 신규 (본 Sprint에서 활성화)
- **G-012 [신규]** v0.4 방향 SSOT — `.flowset/specs/v04-direction.md`가 PRD v0.4 작성 입력의 SSOT. 결정사항 변경 시 본 문서 먼저 갱신 후 PRD 동기화 (역방향 금지). M1 시작 시 활성.
- **G-013 [신규]** 단계별 PR 전략 — 한 번에 전체 갈아엎기 금지. (1) 신규 모듈 + 어댑터 도입 → (2) 신규 사용처 적용 → (3) 기존 호출지점 제거 순서. M2에서 활성.
- **G-014 [신규]** 데이터 마이그레이션 dry-run + 자동 백업 — 신규 SQLite 스키마 도입 시 자동 백업 (`<userDataDir>/backup/v03/<ISO_timestamp>/`, Electron `app.getPath('userData')` 기준) + dry-run 결과 로그 (`<userDataDir>/migration-v04.log`) + revert 경로. M3에서 활성. (M0 A3 §C 표기 정정 반영)

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

특히 M0 evaluator는 사전 분석 4종의 완성도 (분류 누락 X / 호출지점 누락 X / 데이터 손실 시나리오 X)에 가중.

Phase 1 종료 (M6 후) evaluator는 시나리오 회귀 셋 통과율 (1·4 100%, 2·3 90%+)에 가중.

**정량 임계 6종 측정 (Phase 1 종료 시 Sprint 015 종합 evaluator 입력)** — v04-direction.md §12.3 참조:
- 인덱싱 속도 < 500ms / 페이지 (DOM+메타+임베딩 포함)
- 검색 응답 < 200ms (top-5 retrieval, 본문 캐시 제외)
- 검색 정확도 top-5 hit rate ≥ 80% (자체 페어 테스트 셋)
- 임베딩 비용 < $3/월 (1만 페이지 기준)
- 저장 용량 < 200MB / 만 페이지
- AI 응답 출처 인용 정확도 ≥ 90%

임계 미달 항목은 Known Issue (KI-NNN) 등록 — Severity 정의에 따라 즉시 처리 또는 Phase 2 batch.

## 7. 리스크 / 미지수

1. **sqlite-vec Electron native 모듈 빌드 (T12)** — Windows/macOS 모두 동작 검증 필요. M3 시작 전 30분 PoC 권고. 실패 시 Phase 1에서 임시로 cosine similarity in-memory 계산 + Phase 2에서 sqlite-vec 재시도.
2. **임베딩 비용 임계 (T14)** — 페이지당 토큰 수 측정 후 $3/월 임계 초과 시 본문 청크 길이 제한 (예: 첫 2000 토큰만) 적용. 비용 정량은 M3 종료 시 측정 → Known Issue 또는 정책 수정.
3. **데이터 마이그레이션 손실 (T15)** — dry-run + 자동 백업으로 방어. 사용자 기존 Glossary 데이터 0개라도 마이그레이션 코드는 작성 (회귀 테스트 포함).
4. **WebContentsView Cmd+K 캡처 (T21)** — 사이트 내부 Cmd+K 핸들러와 충돌 가능. 메인 프로세스 `before-input-event` 캡처 + 사용자 설정 변경 메커니즘으로 방어.
5. **M0 사전 분석 부담** — A1~A4가 4일 초과 시 M1 PRD 작성과 일부 병행 가능 (T01·T04 먼저 완료 후 T05 시작). 단 T02·T03은 PRD §18·§19 입력이라 M1 완료 전 박혀야 함.
6. **AI 자동 태깅 모델 응답 안정성 (T18)** — JSON 응답 schema 강제 + 파싱 실패 시 freeform fallback. evaluator 통과 임계 = 회귀 셋에서 태그 추출 성공률 ≥ 80%.
7. **회귀 테스트 셋 정의 (T02·T30)** — 시나리오 1·4는 정확한 retrieval 검증 (top-3 hit rate), 시나리오 2·3은 부분 cover라 정량 임계 신중. T02에서 셋 정의 후 사용자 검토 권고.
8. **PRD 19 섹션 작성 부담 (T05)** — 19개 섹션이 평균 200줄이면 3800줄. v04-direction.md (550줄)를 SSOT로 인용해 추측·중복 회피. 단 작성 일정 초과 시 16/17/18/19 섹션은 간소화 + 후속 Sprint 보강 옵션.

## 8. Sprint 종료 후 다음 (Sprint 016 / Phase 2 후보)

1. **워크스페이스 cookies/session/캐시 완전 격리** (Electron Partition API)
2. **하이라이트** — 노트 페이지 내 고정 위치 표시 (DOM anchor)
3. **백그라운드 번역 작업 큐 + 시스템 알림** (논문/PDF, Codex OAuth + reasoning medium/high 활용)
4. **자동 수준 추정** (R3-B 메타 학습) + 사용자 override
5. **AI 자동 태깅 정형 schema 강화** (시나리오 2 cover 향상)
6. **Known Issue MEDIUM batch 정리** (Phase 1 누적분)

## 9. 참조

- 방향 SSOT: `.flowset/specs/v04-direction.md` (본 Sprint 박힘)
- 핸드오프: `.flowset/handoffs/2026-05-16.md`
- 컨셉 SSOT (이전 세션): `3ab3cf7c-ad90-4ae4-80c9-3e66f6978e2b.jsonl` L2618
- 가드레일: G-001 / G-004 / G-005 / G-006 / G-007 / G-009 / G-010 / G-011 / **G-012** / **G-013** / **G-014**
- 외부 참조:
  - sqlite-vec: https://github.com/asg017/sqlite-vec
  - OpenAI Embeddings: https://platform.openai.com/docs/guides/embeddings
  - Electron Partition API: https://www.electronjs.org/docs/latest/api/session
  - RFC 7807 problem+json (오류 schema 참고)

## 변경 이력

- 2026-05-16: Sprint 015 정의 작성 — Phase 1 베이스 인프라 (AI 콘텐츠 메모리 + 워크스페이스). M0 사전 분석 신설. v04-direction.md SSOT 인용. G-012/G-013/G-014 신규 가드레일. 시나리오 1·4 100%, 2·3 90%+ cover 목표.
