# Sprint 016 — Phase 2 진입 + KI batch + 어댑터 정리 + 시나리오 2·3 cover

> **상태: 정식 (2026-05-19 — PR #166 잔여 hotfix `f915296` 머지 + PR #167 정식화 시점)**
> Phase: 2 진입
> 시작 예정: 본 정식화 PR 머지 직후 (2026-05-19+)
> 목표 기간: **3~4주 (19~25일)** — §4 마일스톤 합산 정합 (M0 perf bench infra 추가로 본 정식화에서 4~5일 조정 — 이전 시안 18~24일 → 19~25일)

## 0. 사전 조건

- [x] Sprint 015 M0~M6 모두 머지 (65 PR / 단위 1068)
- [x] PRD v0.4.0 정식 발행 (2026-05-19)
- [x] 시나리오 1·4 cover 100% (S1-C1~C5 + S4-C1~C3 회귀 셋)
- [x] KI 누적 17건 인지 (HIGH 1 in-progress / MEDIUM 4 / LOW 12) — Sprint 015 잔여 hotfix KI-012~017 6건 등록 후
- [x] 가드레일 위반 0 (Sprint 015 13 Sprint 연속 commit-check pass)

## 1. Sprint 목표

**Phase 2 진입 + Sprint 015 잔여 정리 + KI batch**:

1. **KI MEDIUM 4건 + LOW 정량 임계 6종 + LOW PARTIAL 회귀 1종 batch 처리** (MEDIUM: KI-001 sqlite-vec macOS / KI-004 response_format / KI-006 abort / KI-007 TabManager — 5건 batch 임계 1건 부족하나 Phase 2 진입 batch 동반 / LOW perf bench: KI-011 MemoryStats < 20ms / KI-012~016 정량 임계 5종 / LOW 회귀: KI-017 tabLabel +2 KI-007 동반)
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
| S016-T06 | **KI-011~016 정량 임계 6종 perf bench infra 신규** — 6 bench 파일 (`tests/perf/{indexing,search,workspaceSwitch,embeddingCost,storageSize,memoryStats}.bench.ts`) + 실측 결과 보고서 (`.flowset/specs/sprint-016-perf-bench.md`). 각 임계: 인덱싱 < 500ms (KI-012) / 검색 < 200ms top-5 (KI-013) / 워크스페이스 전환 < 1초 (KI-014) / 임베딩 비용 < $3/월 1만 페이지 (KI-015) / 저장 용량 < 200MB/만 페이지 (KI-016) / MemoryStats getStats < 20ms 1K+10K (KI-011) | `tests/perf/*.bench.ts` (6 파일 신규) + `.flowset/specs/sprint-016-perf-bench.md` (실측 보고서) |
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
- KI-011~016 정량 임계 6종 perf bench infra 신규 + 실측 보고서 (KI-011 MemoryStats < 20ms 1K+10K / KI-012 인덱싱 < 500ms / KI-013 검색 < 200ms top-5 / KI-014 워크스페이스 전환 < 1초 / KI-015 임베딩 비용 < $3/월 1만 페이지 / KI-016 저장 용량 < 200MB/만 페이지). 임계 초과 항목은 후속 hotfix 또는 Sprint 017 cover 결정.

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
- KI 잔여 ≤ 6 (HIGH 0 / MEDIUM 0 / LOW ≤ 6) — KI-001 + KI-004 + KI-006 + KI-007 + KI-008 + KI-010 + KI-011 7건 closed
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

| # | 임계 | bench 파일 | KI |
|---|---|---|---|
| 1 | 인덱싱 속도 < 500ms / 페이지 | `tests/perf/indexing.bench.ts` | **KI-012** |
| 2 | 검색 응답 < 200ms (top-5 retrieval) | `tests/perf/search.bench.ts` | **KI-013** |
| 3 | MemoryStats getStats < 20ms (1K + 10K) | `tests/perf/memoryStats.bench.ts` | **KI-011** |
| 4 | 워크스페이스 전환 < 1초 | `tests/perf/workspaceSwitch.bench.ts` | **KI-014** |
| 5 | 임베딩 비용 < $3/월 (1만 페이지) | `tests/perf/embeddingCost.bench.ts` | **KI-015** |
| 6 | 저장 용량 < 200MB / 만 페이지 | `tests/perf/storageSize.bench.ts` | **KI-016** |
| 7 | AI 응답 출처 인용 정확도 ≥ 90% | (정성 평가 — 시나리오 회귀 셋 기반, perf bench 외) | (별도 — 시나리오 cover 통과 시 묵시 검증) |

임계 미달 항목은 (1) 후속 hotfix PR 즉시 정정 또는 (2) Sprint 017 cover 결정 + KI status `open` 유지. 본 6 bench infra 자체는 PRD §15.4 정량 임계 6종 + AI 정확도 1종 = 7종 매트릭스 정합.

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
- Known Issues: `.flowset/known-issues.md` KI-001 ~ KI-017 (17건 — Sprint 015 잔여 hotfix 6건 등록 후)
- 외부 참조:
  - Electron Partition API: https://www.electronjs.org/docs/latest/api/session
  - sqlite-vec macOS: https://github.com/asg017/sqlite-vec/releases
  - Codex OAuth backend: chatgpt.com/backend-api/codex/responses

## 변경 이력

- 2026-05-19: Sprint 016 contract 시안 작성 (Sprint 015 M6 T31 시점). Phase 2 진입 + KI MEDIUM batch + 시나리오 2·3 cover + 어댑터 일괄 제거 + cookies partition + 백그라운드 번역. T01~T26 26 작업, 6 마일스톤. AC-1~AC-6 6 수용 기준. G-015 신규 가드레일.
- 2026-05-19 (PR #167 정식화 — Sprint 015 잔여 hotfix PR #166 `f915296` 머지 직후): 시안 → **정식** 승격. M0 T06 본문 확장 — KI-011 단독 → **KI-011~016 정량 임계 6종 perf bench infra** (6 bench 파일 + 실측 보고서). §0 기간 18~24일 → 19~25일 (3~4주). §1 #1 표기 정확화 (MEDIUM 4건 + LOW 6종 + LOW 1종). §6 정량 임계 표 KI 인용 7종 매트릭스. §4 M0 기간 3~4일 → 4~5일. T 번호 재정렬 0 (T07~T26 시안 그대로). 본 정식화는 evaluator 후속 조치 #4 (perf bench infra 별도 T 분할) 권고 정합.
