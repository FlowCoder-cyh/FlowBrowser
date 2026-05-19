# Sprint 016 — Phase 2 진입 + KI batch + 어댑터 정리 + 시나리오 2·3 cover

> **상태: 정식 (2026-05-19 — PR #166 잔여 hotfix `f915296` 머지 + PR #167 정식화 시점)**
> Phase: 2 진입
> 시작 예정: 본 정식화 PR 머지 직후 (2026-05-19+)
> 목표 기간: **3~4주 (19~25일)** — §4 마일스톤 합산 정합 (M0 perf bench infra 추가로 본 정식화에서 4~5일 조정 — 이전 시안 18~24일 → 19~25일)

## 0. 사전 조건

- [x] Sprint 015 M0~M6 모두 머지 (65 PR / 단위 1068)
- [x] PRD v0.4.0 정식 발행 (2026-05-19)
- [x] 시나리오 1·4 cover 100% (S1-C1~C5 + S4-C1~C3 회귀 셋)
- [x] KI 누적 19건 인지 (HIGH 1 in-progress / MEDIUM 4 / LOW 14) — Sprint 015 잔여 hotfix KI-012~017 6건 + 본 PR #167 정식화에서 KI-018 / KI-019 (PRD §15.4 #3 top-10 hit rate + #6 AI 정확도) 추가 등록
- [x] 가드레일 위반 0 (Sprint 015 13 Sprint 연속 commit-check pass)

## 1. Sprint 목표

**Phase 2 진입 + Sprint 015 잔여 정리 + KI batch**:

1. **KI MEDIUM 4건 + LOW 정량 임계 8종 (perf 6 + 정확도 2) + LOW PARTIAL 회귀 1종 batch 처리** (MEDIUM: KI-001 sqlite-vec macOS / KI-004 response_format / KI-006 abort / KI-007 TabManager — 5건 batch 임계 1건 부족하나 Phase 2 진입 batch 동반 / LOW perf bench: KI-011 MemoryStats < 20ms / KI-012~016 정량 임계 5종 / KI-018 top-10 hit rate / KI-019 AI 출처 정확도 / LOW 회귀: KI-017 tabLabel +2 KI-007 동반)
2. **시나리오 2·3 90%+ cover** — 시나리오 1·4 (100%) 와 합쳐 Phase 1 시나리오 회귀 전체 cover
3. **어댑터 일괄 제거 (M5-8 분할 2편)** — 5종 어댑터 정리로 v0.3 자산 완전 폐기 종결
4. **Phase 2 cookies/storage partition** — Electron `session.fromPartition('persist:ws-{uuid}')` + WorkspacePartitionManager
5. **백그라운드 번역 + 하이라이트** — 논문/PDF Codex OAuth + DOM anchor 노트 고정 위치

**Sprint 015 미달 항목 흡수**:
- 인덱싱 자동 호출 (IndexingService wiring) — KI-010 broadcast 동반
- AutoTagger.tagNote 신규 — KI-005 closed
- MemoryStats < 20ms 측정 (KI-011)
- Workspace JSON Export/Import (KI-008)

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| **M0 KI MEDIUM batch (T01~T06)** | | |
| S016-T01 | KI-001 sqlite-vec macOS CI runner 추가 (matrix windows + macos-latest) | `.github/workflows/ci.yml` |
| S016-T02 | KI-006 Workspace 전환 abort 정책 wiring (IndexingService.abort + EmbeddingQueue.clear + ChatService.abortStreaming) + **tabGuard.test.ts +3 abort 회귀 + `src/renderer/src/translation/tabGuard.ts` → `src/main/TabGuard.ts` 위치 이동** (v04-test-classification §D 매트릭스 누락분 흡수) | `src/main/workspaceHandlers.ts` + 3 모듈 abort API + `src/main/TabGuard.ts` + `tests/unit/main/tabGuard.test.ts` |
| S016-T03 | KI-007 TabManager workspace_id 필드 + stash/restore 트리거 (PARTIAL → 완전 격리) + **TabManager.test.ts +5 workspace_id 메타 회귀 + tabLabel.test.ts +2 워크스페이스 컨텍스트 회귀 (KI-017 동반)** (v04-test-classification §D 매트릭스 누락분 흡수) | `src/main/TabManager.ts` + `src/storage/TabStateStore.ts` + `tests/unit/main/TabManager.test.ts` + `tests/unit/renderer/tabLabel.test.ts` |
| S016-T04 | KI-004 ChatRequest.response_format JSON 강제 API-level (`response_format: { type: 'json_object' }`) + AutoTagger 적용 | `src/ai/types.ts` + `src/ai/providers/OpenAIApiKeyProvider.ts` |
| S016-T05 | KI-010 IndexingService wiring (services.ts) + did-finish-load 결합 + 인덱싱 완료 broadcast | `src/main/services.ts` + `src/main/IndexingService.ts` |
| S016-T06 | **KI-011~016 + KI-018~019 정량 임계 8종 perf/회귀 infra 신규** — (a) perf bench 6 파일 (`tests/perf/{indexing,search,workspaceSwitch,embeddingCost,storageSize,memoryStats}.bench.ts`) + (b) `vitest.config.ts` bench include 패턴 추가 + (c) `package.json` script `perf: vitest bench --run` 신규 + (d) 정확도 회귀 (top-10 hit rate ≥ 80% KI-018 / AI 출처 정확도 ≥ 90% KI-019) — 시나리오 30 케이스 정확도 산식 명시 + (e) 실측 결과 보고서 (`.flowset/eval-results/sprint-016-perf-bench.md`). 각 임계: 인덱싱 < 500ms (KI-012) / 검색 < 200ms top-10 (KI-013) / top-10 hit rate ≥ 80% (KI-018 신규) / 임베딩 비용 < $3/월 (KI-015) / 저장 용량 < 200MB/만 (KI-016) / AI 출처 정확도 ≥ 90% (KI-019 신규) / MemoryStats < 20ms (KI-011) / 워크스페이스 전환 < 1초 (KI-014) | `tests/perf/*.bench.ts` (6 파일 신규) + `vitest.config.ts` + `package.json` script + `.flowset/eval-results/sprint-016-perf-bench.md` (실측 보고서) |
| **M1 시나리오 2·3 cover (T07~T08)** | | |
| S016-T07 | 시나리오 2 (PM 경쟁 분석) 회귀 셋 5 케이스 (S2-C1~C5) | `tests/integration/scenarios/scenario-2-pm.test.ts` |
| S016-T08 | 시나리오 3 (학습) 회귀 셋 5 케이스 (S3-C1~C5) | `tests/integration/scenarios/scenario-3-learning.test.ts` |
| **M2 어댑터 일괄 제거 (M5-8 분할 2편, T09~T13)** | | |
| S016-T09 | ProviderAdapter.translate() 메서드 자체 제거 (Sprint 015 M5-8 위임) | `src/ai/ProviderAdapter.ts` + OpenAIApiKeyProvider + CodexLoginProvider |
| S016-T10 | executeTranslateRequest → ChatService.chat() 마이그레이션 + selection 번역 chat 호출 통합 | `src/main/services.ts` |
| S016-T11 | TranslationCache 어댑터 제거 + cache:* IPC 정리 (AIResponseCache 일반화 완료) | `src/storage/TranslationCache.ts` + `src/main/services.ts` |
| S016-T12 | PageResultStore 어댑터 제거 + pageResult:* IPC 정리 + PageCachePanel UI 폐기 (KI-002 closed) | `src/storage/PageResultStore.ts` + UI |
| S016-T13 | fetchImpl 통일 + provider 별 fetch 일관성 | `src/ai/providers/*` |
| **M3 Phase 2 — cookies/storage partition (T14~T17)** | | |
| S016-T14 | WorkspacePartitionManager 신규 (session.fromPartition + persist:ws-{uuid}) | `src/main/WorkspacePartitionManager.ts` |
| S016-T15 | 워크스페이스 전환 시 partition 동기화 (탭 그룹 stash/restore + cookies 격리) | `src/main/workspaceHandlers.ts` |
| S016-T16 | 워크스페이스 삭제 시 clearStorageData + clearCache cascade | `src/main/WorkspaceService.ts` |
| S016-T17 | KI-008 Workspace JSON Export/Import (workspace:export-json + workspace:import-json IPC) | `src/main/workspaceHandlers.ts` |
| **M4 백그라운드 번역 + 하이라이트 (T18~T22)** | | |
| S016-T18 | BackgroundTranslationQueue (논문/PDF 시간 걸려도 백그라운드 + 완료 알림) | `src/main/BackgroundTranslationQueue.ts` |
| S016-T19 | 시스템 알림 통합 (Electron Notification API) | `src/main/index.ts` |
| S016-T20 | 노트 하이라이트 (DOM anchor + 고정 위치 표시) — PRD §11.2.1 highlights | `src/renderer/src/note/NoteHighlight.tsx` |
| S016-T21 | AutoTagger.tagNote 신규 메서드 (KI-005 closed) | `src/ai/tagging/AutoTagger.ts` |
| S016-T22 | 자동 수준 추정 mock (R3-B) — Phase 2 진입 자리만 | `src/main/UserLevelEstimator.ts` (mock) |
| **M5 Sprint 016 종합 (T23~T26)** | | |
| S016-T23 | 단위 테스트 — 회귀 셋 + 신규 컴포넌트 + Phase 2 진입 검증 (목표 +60~80) | `tests/**/*.test.ts` |
| S016-T24 | PRD v0.4.1 발행 (Phase 2 진입 메타 + KI 11→ ≤6 해소 + 어댑터 정리 종결) | `docs/prd/00_change_history.md` |
| S016-T25 | Sprint 016 종합 evaluator + 핸드오프 + state/known-issues 갱신 | `.flowset/handoffs/YYYY-MM-DD.md` |
| S016-T26 | Sprint 017 contract 시안 (Phase 3 진입 예고 — 로컬 LLM / Notion Export / 공유) | `.flowset/contracts/sprint-017.md` |

### 제외 (Sprint 017+ / Phase 3 / Phase 4)

- 로컬 LLM 옵션 (Ollama) — Sprint 017 (Phase 3)
- 로컬 임베딩 옵션 (sentence-transformers) — Sprint 017
- Notion Export / Markdown Export — Sprint 017 (Phase 3)
- 워크스페이스 공유 — Sprint 017
- MVP 최종 딥검증 (시나리오 4개 100% 시연 + 사용자 실사용 1주) — Phase 3 종료 후

## 3. 수용 기준

### AC-1 KI MEDIUM batch (T01~T06)

- KI-001 macOS sqlite-vec CI 통과 (windows + macos matrix)
- KI-006 abort 정책 — 워크스페이스 전환 시 인덱싱/임베딩/채팅 3종 abort 호출 정합
- KI-007 TabManager stash/restore — 워크스페이스 전환 시 탭 그룹 교체 검증
- KI-004 response_format API-level 적용 (AutoTagger + 회귀 1건)
- KI-010 인덱싱 완료 broadcast — IndexingService wiring + MemoryStatsPanel 자동 갱신 통합
- KI-011~016 + KI-018~019 정량 임계 8종 perf/회귀 infra 신규 + 실측 보고서. perf 6종 (KI-011 MemoryStats < 20ms / KI-012 인덱싱 < 500ms / KI-013 검색 < 200ms top-10 / KI-014 워크스페이스 전환 < 1초 / KI-015 임베딩 비용 < $3/월 / KI-016 저장 용량 < 200MB/만) + 정확도 2종 (KI-018 top-10 hit rate ≥ 80% / KI-019 AI 출처 정확도 ≥ 90% — 시나리오 30 케이스 산식). vitest bench config 추가 + package.json script 신규. 임계 미달 항목은 후속 hotfix 또는 Sprint 017 cover 결정.

### AC-2 시나리오 2·3 cover (T07~T08)

- 시나리오 2: S2-C1~C5 5/5 통과 (PM 경쟁 분석 — 정형 태깅 + 비교 표 + AI 분석)
- 시나리오 3: S3-C1~C5 5/5 통과 (학습 — 초보 수준 + 첫 진입 vs 재방문 dwell)
- 시나리오 회귀 셋 18/18 (시나리오 1·4 100% Sprint 015 + 2·3 90%+ 본 Sprint)
- Phase 1 시나리오 cover 종합 ≥ 95%

### AC-3 어댑터 일괄 제거 (T09~T13)

- ProviderAdapter.translate() 메서드 자체 제거 + 호출지점 0
- executeTranslateRequest 폐기 + selection 번역 chat 호출 통합
- TranslationCache / PageResultStore 어댑터 자체 폐기
- cache:* / pageResult:* IPC 잔여 정리 + preload deprecation 종결
- fetchImpl 통일 + provider 일관성

### AC-4 Phase 2 cookies partition (T14~T17)

- WorkspacePartitionManager + persist:ws-{uuid} session 격리 동작
- 워크스페이스 전환 시 cookies/localStorage/IndexedDB 완전 격리 (User stage 검증)
- 워크스페이스 삭제 시 clearStorageData + clearCache cascade 동작
- JSON Export/Import — Workspace + Page + Visit + Note + AiChatHistory + Tag 전체 보존

### AC-5 백그라운드 번역 + 하이라이트 (T18~T22)

- BackgroundTranslationQueue — 논문 PDF 대상 백그라운드 처리 + 시스템 알림 통합
- 노트 하이라이트 — DOM anchor + 페이지 재방문 시 고정 위치 표시
- AutoTagger.tagNote 동작 (KI-005 closed)
- 자동 수준 추정 mock (Phase 3 R&D 자리)

### AC-6 통과 기준 (T23~T26)

- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 14 Sprint 연속)
- **누적 단위 테스트 ≥ 1130** (목표 1130~1150)
- 시나리오 회귀 셋 18/18 (1·4 100% + 2·3 90%+)
- PRD v0.4.1 발행
- KI 잔여 ≤ 2 (HIGH 0 / MEDIUM 0 / LOW ≤ 2) — Sprint 016 M0~M5 closed 17건: MEDIUM 4건 (KI-001 macOS T01 / KI-004 response_format T04 / KI-006 abort T02 / KI-007 TabManager T03) + HIGH 1건 (KI-003 BYOK wiring Sprint 015 M5 완료 status `closed` 전환) + LOW 12건 (KI-002 PageResultStore T12 / KI-005 AutoTagger.tagNote T21 / KI-008 Export T17 / KI-010 broadcast T05 / KI-011~016 perf 6종 T06 / KI-017 tabLabel T03 / KI-018 hit rate T06 / KI-019 AI 정확도 T06). 잔여 LOW: KI-009 MemoryStatsPanel React unit (Phase 3 종료 정리) + 본 Sprint 신규 도출 KI 1~2건.
- Sprint 017 contract 시안 작성 (Phase 3 진입 준비)

## 4. 마일스톤

| M | 산출물 | 작업 | 기간 |
|---|---|---|---|
| **M0** | KI MEDIUM batch (4건) + LOW perf bench infra (6종 KI-011~016) + LOW PARTIAL 회귀 (KI-017) | T01~T06 | 4~5일 |
| **M1** | 시나리오 2·3 회귀 셋 (10 케이스) | T07~T08 | 2~3일 |
| **M2** | 어댑터 일괄 제거 (5종) | T09~T13 | 3~4일 |
| **M3** | Phase 2 cookies partition + Export | T14~T17 | 4~5일 |
| **M4** | 백그라운드 번역 + 하이라이트 | T18~T22 | 4~5일 |
| **M5** | 종합 + PRD v0.4.1 + Sprint 017 시안 | T23~T26 | 2~3일 |

총 19~25일 (3~4주 보수 추정 — 본 정식화에서 M0 perf bench infra 추가로 +1~+1일 조정).

## 5. 가드레일 적용

### 기존
- **G-001** PRD 정합 — PRD v0.4.1 발행 + 본 contract 정합
- **G-003** 인증 금지선 — Codex OAuth 백그라운드 번역 호출은 사용자 명시 동의 시에만 (T18)
- **G-004** Privacy Filter — 워크스페이스 partition 도입 후에도 Privacy 차단 우선
- **G-005** OS Keychain 위임 — 유지
- **G-006** 추측 금지
- **G-007** main 직접 push 금지
- **G-009** 커밋 형식 (NNN 한 분절, 학습 30 정합)
- **G-010** UTF-8 / LF
- **G-011** 공개 endpoint 회색지대
- **G-012** v0.4 SSOT — `.flowset/specs/v04-direction.md` 우선 갱신
- **G-013** 단계별 PR — (1) 신규 모듈 (2) 사용처 적용 (3) 폐기 순서
- **G-014** 데이터 마이그레이션 dry-run + 백업

### 신규 (본 Sprint 활성화)
- **G-015 [신규]** Phase 2 cookies partition 격리 — 워크스페이스 단위 session 격리 강제. 사용자 명시 동의 후 활성화. M3 활성.

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

특히 M0 evaluator 는 KI 6건 batch 처리의 완성도 (재현 검증 / 정량 측정 / 회귀 누락 X) 에 가중.
M3 cookies partition 은 사용자 stage 격리 검증 강제 (User stage 또는 in-memory partition 분리 stub).

**정량 임계 (Sprint 016 M0 T06 perf bench infra 일괄 실측 + 종료 시 종합 evaluator 입력)**:

PRD SSOT — §15.4 정량 임계 6종 + §11.3.2 MemoryStats + §11.8 워크스페이스 전환 = 총 **8종 매트릭스**:

| # | 지표 | 임계 | 측정 방법 | bench/회귀 셋 | KI | PRD |
|---|---|---|---|---|---|---|
| 1 | 인덱싱 속도 | < 500ms / 페이지 | 100 페이지 모킹 인덱싱 + 시간 측정 | `tests/perf/indexing.bench.ts` | **KI-012** | §15.4 #1 / §8.10 |
| 2 | 검색 응답 | < 200ms (top-10 표시까지, 본문 캐시 fetch 제외) | 1000 페이지 + retrieval × 100회 평균 | `tests/perf/search.bench.ts` | **KI-013** | §15.4 #2 / §9.7 |
| 3 | top-10 hit rate | ≥ 80% | 회귀 셋 + 50 페어 자체 테스트 셋 | `tests/integration/scenarios/*` + 50 페어 셋 | **KI-018** (신규) | §15.4 #3 / §9.7 |
| 4 | 임베딩 비용 | < $3 / 월 (1만 페이지) | 페이지당 토큰 × $0.00002 × 1만 (현재 추정 $0.20/월) | `tests/perf/embeddingCost.bench.ts` | **KI-015** | §15.4 #4 / §15.2 |
| 5 | 저장 용량 | < 200MB / 만 페이지 | 1만 페이지 모킹 후 SQLite 파일 크기 (현재 추정 ~150MB) | `tests/perf/storageSize.bench.ts` | **KI-016** | §15.4 #5 / §15.3 |
| 6 | AI 응답 출처 정확도 | ≥ 90% | 회귀 셋 30 케이스 — `chat_meta.cells.sources` 가 실제 `retrieved_items` 내 `page_id` 와 일치하는 비율 | `tests/integration/scenarios/*` (30 케이스 정확도 산식) | **KI-019** (신규) | §15.4 #6 / §10.8 |
| 7 | MemoryStats getStats | < 20ms (1K + 10K 페이지) | denormalized 통계 SELECT 5개 평균 | `tests/perf/memoryStats.bench.ts` | **KI-011** | §11.3.2 / §11.8 |
| 8 | 워크스페이스 전환 | < 1초 (10 탭 기준) | stopwatch 측정 (KI-006 abort + KI-007 stash/restore 후) | `tests/perf/workspaceSwitch.bench.ts` | **KI-014** | §11.8 / §11.3.2 |

**bench infra 셋업** (T06 본문에 명시):
- `vitest.config.ts` 에 `bench` 패턴 include 추가 (`tests/perf/**/*.bench.ts`) — 현재 config는 `tests/**/*.test.ts` 만 include
- `package.json` script: `"perf": "vitest bench --run"` 신규
- 정확도 측정 (#3 top-10 hit rate / #6 AI 정확도) 은 perf bench 외 — `tests/integration/scenarios/` 30 케이스 회귀 셋 (Sprint 016 T07~T08 시나리오 2·3 + Sprint 015 T30 시나리오 1·4 합 18 케이스 + Sprint 016 추가 12 케이스 = 30) 안에 정확도 산식 명시

임계 미달 항목은 (1) 후속 hotfix PR 즉시 정정 또는 (2) Sprint 017 cover 결정 + KI status `open` 유지. 본 8 매트릭스는 PRD §15.4 6종 + §11.3.2 + §11.8 별도 2종 = 8종 정합 — codex BLOCKING #1 해소 (이전 표는 PRD top-10 hit rate / AI 정확도 산식 누락이었음).

## 7. 리스크 / 미지수

1. **macOS sqlite-vec native 빌드 (T01)** — Sprint 015 KI-001 미검증. CI matrix 추가 시 sqlite-vec-darwin-x64 / arm64 prebuilt 동작 확인 + 실패 시 임시 in-memory cosine fallback.
2. **session.fromPartition cookies 호환성 (T14)** — Electron 38+ Partition API 가 안정적이나 일부 사이트 (Notion 등) 의 session storage 차단 가능성. 사용자 보고 시 즉시 KI 등록.
3. **TabManager workspace_id 마이그레이션 (T03)** — 기존 단일 그룹 탭 → workspace_id NOT NULL 컬럼 추가. 기존 사용자 탭 → "📥 기본" 워크스페이스 자동 할당. dry-run + 백업 (G-014).
4. **시나리오 2·3 회귀 셋 정의 (T07~T08)** — 시나리오 2 정형 태깅 + 시나리오 3 학습 메타 모두 R3-A (사용자 수준 직접 선택) 기반. 자동 수준 추정은 Phase 3.
5. **어댑터 폐기 시 미발견 호출지점 (T09~T13)** — 사전 grep + 단위 회귀로 cover. Sprint 015 M5-8 분할 1편 학습 활용.
6. **백그라운드 번역 비용 (T18)** — Codex OAuth 한도 5h/주 — 대용량 PDF (100 페이지) 시 분당 1 페이지 → 5h 안에 300 페이지. 사용자 임계 안내 UX (T19 시스템 알림).
7. **사용자 PRD 변경 위험** — Phase 2 진입 시 사용자 feedback 으로 Phase 3 (로컬 LLM) 우선순위 조정 가능. 본 contract 는 시안 — 본격 진입 전 사용자 검토 권고.

## 8. Sprint 종료 후 다음 (Sprint 017 / Phase 3 후보)

1. **로컬 LLM 옵션 (Ollama)** — 오프라인 채팅 + 인덱싱 / 비용 0
2. **로컬 임베딩 옵션 (sentence-transformers)** — 오프라인 검색
3. **Notion Export / Markdown Export** — 데이터 portability
4. **워크스페이스 공유** — 협업 시나리오
5. **자동 수준 추정 (R3-B)** — UserLevelEstimator 실 학습 로직
6. **MVP 최종 딥검증** — 시나리오 4개 100% 시연 + 사용자 실사용 1주

## 9. 참조

- 시안 작성 시점: Sprint 015 M6 T31 (2026-05-19)
- 방향 SSOT: `.flowset/specs/v04-direction.md` (Sprint 015 박힘)
- 최신 핸드오프: `.flowset/handoffs/2026-05-19.md` §11 (M6 종합)
- 가드레일: G-009 / G-013 / G-014 + **G-015 신규**
- Known Issues: `.flowset/known-issues.md` KI-001 ~ KI-019 (19건 — Sprint 015 잔여 hotfix 6건 + 본 PR #167 정식화 KI-018/019 2건 등록 후)
- 외부 참조:
  - Electron Partition API: https://www.electronjs.org/docs/latest/api/session
  - sqlite-vec macOS: https://github.com/asg017/sqlite-vec/releases
  - Codex OAuth backend: chatgpt.com/backend-api/codex/responses

## 변경 이력

- 2026-05-19: Sprint 016 contract 시안 작성 (Sprint 015 M6 T31 시점). Phase 2 진입 + KI MEDIUM batch + 시나리오 2·3 cover + 어댑터 일괄 제거 + cookies partition + 백그라운드 번역. T01~T26 26 작업, 6 마일스톤. AC-1~AC-6 6 수용 기준. G-015 신규 가드레일.
- 2026-05-19 (PR #167 정식화 — Sprint 015 잔여 hotfix PR #166 `f915296` 머지 직후): 시안 → **정식** 승격. M0 T06 본문 확장 — KI-011 단독 → **KI-011~016 + KI-018~019 정량 임계 8종 perf/회귀 infra** (6 bench 파일 + vitest config 확장 + package.json perf script + 정확도 회귀 산식 + 실측 보고서). §0 기간 18~24일 → 19~25일 (3~4주). §1 #1 표기 정확화 (MEDIUM 4건 + LOW perf/정확도 8종 + LOW PARTIAL 1종). §3 AC-1 본문 KI-011 → KI-011~016 + KI-018~019 8종 + 임계 미달 fallback 명시. §4 M0 기간 3~4일 → 4~5일. §6 정량 임계 표 PRD §15.4 6종 + §11.3.2 + §11.8 별도 2종 = **8종 매트릭스** (codex BLOCKING #1+#2 해소 — 이전 표는 PRD top-10 hit rate / AI 정확도 산식 누락이었음). T 번호 재정렬 0 (T07~T26 시안 그대로). 본 정식화는 evaluator 후속 조치 #4 (perf bench infra 별도 T 분할) + codex BLOCKING #1+#2 (PRD SSOT 정합) 권고 정합.
- 2026-05-19 (PR #167 codex BLOCKING + NEEDS_CHANGES 본 PR 내 hotfix): §6 표 6종 → **8종 매트릭스 재구성** (PRD §15.4 6종 정확 인용 + §11.3.2 + §11.8 별도 2종). KI-013 본문 "top-5 retrieval" → "top-10 표시" (PRD §9.7 b6.1 정합). KI-018 / KI-019 신규 (top-10 hit rate / AI 출처 정확도). T06 본문 vitest bench config + package.json perf script + 30 케이스 정확도 산식 명시. §3 AC-1 정합 확장. AC-6 KI 잔여 산식 갱신 (≤6 → ≤2, closed 7건 → 17건 매트릭스). specs → eval-results 경로 정정. state.md PR #166 (예정) → 머지 완료 정리. KI 통계 17 → 19 갱신.
