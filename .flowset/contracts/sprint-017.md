# Sprint 017 — Phase 3 진입 + Sprint 016 residual + 후속 위임 처리

> **상태: partial closure (2026-05-23 — Sprint 017 M5 mini-milestone β D PR #244 머지 후)**
> Phase: 3 (Phase 2 종결 + Phase 3 진입)
> 시작: 2026-05-21 (Sprint 016 M5 종료 후 정식화)
> partial closure: 2026-05-23 (M5 G-021 + G-022 + mini-milestone β advisory hook 박힌 후 사용자 결정 대기 항목 Sprint 018 carryover)
> 목표 기간: **3~4주 (18~25일)** — 실 진행 ~3일 (M0~M4 부분 + M5 가드레일 박힘)
> 종결 권고: codex 019e5161 (read-only) "M5 G-021 + G-022 + mini-milestone β 박힌 후 carryover 명확히 박는 게 흐름상 안전. T19/Schema v06 = 사용자 결정 대기, G-022 blocking = transcript source 안정성 검증 선행 필요."

## 0. 사전 조건

- [ ] Sprint 016 M0~M5 모두 머지 (목표 PR 누적 120+ / 단위 1436+)
- [ ] PRD v0.4.1 정식 발행 (Sprint 016 M5 T24, 2026-05-21)
- [ ] 시나리오 1·2·3·4 cover 90%+ (Sprint 016 M0~M1 + T23 scenario-accuracy)
- [ ] KI MEDIUM 0 잔여 (Sprint 016 M0 batch closed) + LOW carryover (KI-009 / KI-020 ~ KI-026 신규)
- [ ] 가드레일 G-001~G-015 위반 0 (Sprint 016 15+ PR 연속 commit-check pass)

## 1. Sprint 목표

**Phase 2 종결 + Phase 3 진입 + Sprint 016 후속 위임 + R&D 진입**:

1. **Sprint 016 residual + KI 정리** — drainUntil helper / pageId='' validation / freeform fallback wording / KI-009 React 단위 / 정량 임계 carryover
2. **T20 후속 — renderer UI overlay + Highlight SQLite swap** (G-013 2단계 + G-014 dry-run + 자동 백업)
3. **Sprint 016 신규 KI batch** — KI-020 (SPA did-navigate-in-page) / KI-021 (partition cleanup reconcile, Phase 2) / KI-022 (Import embedding_queue re-enqueue)
4. **로컬 LLM (Ollama) spike** — Phase 3 진입 — 오프라인 채팅 + 인덱싱 / 비용 0
5. **로컬 임베딩 (sentence-transformers) spike** — 오프라인 검색 / 비용 0
6. **Notion Export / Markdown Export** — 데이터 portability (PRD §19 정합)
7. **워크스페이스 공유 설계 초안** — Phase 3 협업 시나리오
8. **자동 수준 추정 R3-B 실 학습 로직** — Sprint 016 M4 T22 UserLevelEstimator mock 교체

**codex 사전 협의 (threadId 019e4a52) 권고 정합 구조**:
- M0~M2: 산출물 + AC 까지 구체화
- M3~M5: 산출물 헤더 + 진입 조건 (dependency 추가는 별도 승인 박음)

## 2. 범위

### 포함 (구체화 — M0~M2)

| # | 작업 | 산출물 |
|---|---|---|
| **M0 Sprint 016 residual + KI 정리 (T01~T05)** | | |
| S017-T01 | drainUntil(fx, predicate, max=20) helper 신규 + BackgroundTranslationQueue.test.ts 의 `for advance + Promise.resolve()` 패턴 정리 (codex T23 후속 위임 정합) | `tests/unit/main/_helpers/drainUntil.ts` + BackgroundTranslationQueue.test.ts refactor |
| S017-T02 | pageId='' validation 위치 정합 — LOW KI 등록 + 호출자 path 검증 (SQLite swap / IPC 경계) | `.flowset/known-issues.md` KI 신규 + `src/main/noteHandlers.ts` 검증 |
| S017-T03 | KI-009 MemoryStatsPanel React 컴포넌트 단위 테스트 — `@testing-library/react` 추가 + 4 케이스 (mount / workspaceId 변경 / 폴링 / error fallback) | `package.json` dev dep + `tests/unit/renderer/MemoryStatsPanel.test.tsx` |
| S017-T04 | **KI-018/019 closed 상태 audit + 정합 확인** — Sprint 016 M5 T25 시점 이미 status `closed` 전환 (T23 scenario-accuracy 30 케이스 산식 cover). 본 Sprint 017 진입 시점 재검증 + carryover regression 0 확인 | `.flowset/known-issues.md` audit log |
| S017-T05 | **KI-011/012/013/014/015/016 6종 closed 상태 audit + carryover 재측정** — Sprint 016 M0 T06 perf bench infra closed 후 Sprint 017 진입 시점 perf-baseline 재실행 (회귀 0 확인). 임계 변동 시 KI 재 open + hotfix path | `.flowset/known-issues.md` audit log + `npm run perf` 재실행 보고서 |
| **M1 T20 후속 — renderer UI overlay + Highlight SQLite swap (T06~T09)** | | |
| S017-T06 | NoteHighlight renderer UI overlay (`src/renderer/src/note/NoteHighlight.tsx`) — WebContentsView selection 캡처 + did-finish-load 시 deserializeAnchor 복원 trigger — G-013 2단계 | `src/renderer/src/note/NoteHighlight.tsx` + `src/main/index.ts` IPC wiring |
| S017-T07 | Highlight schema 신규 (`v05.sql`) + V4→V5 마이그레이션 — G-014 dry-run + 자동 백업 강제. HighlightStore SQLite swap (in-memory → SQLite) | `src/storage/schema/v05.sql` + `src/storage/migrations/v04_to_v05.ts` + `src/storage/HighlightStore.ts` swap |
| S017-T08 | renderer overlay UX — toast fallback (KI-024 graceful), highlight 클릭 시 노트 패널 포커스, 다중 highlight 동일 페이지 시 z-index 정합 | `src/renderer/src/note/NoteHighlight.tsx` + CSS |
| S017-T09 | Highlight Export/Import 통합 — WorkspaceExportImportService 에 highlights 행 추가 (Sprint 016 M3 T17 후속) | `src/main/WorkspaceExportImportService.ts` + 단위 회귀 |
| **M2 Sprint 016 신규 KI batch (T10~T13)** | | |
| S017-T10 | KI-020 (SPA did-navigate-in-page) — `createTabView` 에 `did-navigate-in-page` hook 추가 + debounce 500ms~1s + `runPageIndexing` 재호출 + iframe nav 무시 (sender frame === mainFrame check) | `src/main/index.ts` + 단위 회귀 |
| S017-T11 | KI-021 (partition cleanup reconcile, Phase 2) — `WorkspacePartitionManager.reconcileOrphanPartitions()` 신규 + 부팅 시 1회 호출 + console.warn → main log 박음 | `src/main/WorkspacePartitionManager.ts` + 단위 회귀 |
| S017-T12 | KI-022 (Import embedding_queue re-enqueue) — `WorkspaceExportImportService.importWorkspace` 후 `EmbeddingQueue.enqueue` 자동 호출 (pages + notes 양쪽) | `src/main/WorkspaceExportImportService.ts` + 단위 회귀 |
| S017-T13 | Sprint 016 freeform fallback wording 정합 (KI-031) — `AutoTagger.tagPage` / `tagNote` 의 `parseTagsResponse → null` path 호출자 책임 명시 + 단위 회귀 추가 | `src/ai/tagging/AutoTagger.ts` 코멘트 + 단위 회귀 |

### 포함 (헤더 + 진입 조건만 — M3~M5, dependency 별도 승인 후 구체화)

| # | 작업 | 산출물 헤더 | 진입 조건 |
|---|---|---|---|
| **M3 로컬 LLM / 임베딩 spike (T14~T17)** | | |
| S017-T14 | Ollama spike — `ollama` provider adapter 인터페이스 (BYOK 분기 정합) | `src/ai/providers/OllamaProvider.ts` (spike) | **dependency 추가 (`ollama` npm package) 별도 승인 필수** — codex 사전 협의 정합 |
| S017-T15 | sentence-transformers spike — 로컬 임베딩 PoC (Python sidecar 또는 ONNX runtime) | `src/ai/embedding/LocalEmbeddingClient.ts` (spike) | **Python sidecar 또는 onnxruntime-node dependency 별도 승인 필수** |
| S017-T16 | 로컬 LLM 통합 — `UserSetting.defaultProviderId='local'` 명시 시 Chat IPC OllamaProvider 분기 (기존 필드 재활용, 마이그레이션 회피) + selectChatProviderIds pure helper + KI-003 BYOK 디폴트 보존 | `src/main/services.ts` wiring + `src/main/chatProviderSelect.ts` + 단위 회귀 | T14 spike 후 + 사용자 승인 |
| S017-T17 | 로컬 임베딩 통합 — IndexingService 가 OpenAI 또는 로컬 임베딩 선택 | `src/main/IndexingService.ts` wiring | T15 spike 후 |
| **M4 Notion Export / Markdown Export / 워크스페이스 공유 (T18~T21)** | | |
| S017-T18 | Markdown Export — 워크스페이스 → Markdown 폴더 구조 (PRD §11.5.6 Phase 3) | `src/main/MarkdownExportService.ts` | T09 Highlight Export 통합 후 |
| S017-T19 | Notion Export — 워크스페이스 → Notion API push (BYOK Notion API token, OS Keychain 위임 정합 G-005) | `src/main/NotionExportService.ts` | **Notion API token UX 별도 승인** |
| S017-T20 | 자동 수준 추정 R3-B — UserLevelEstimator mock 교체 (페이지 텍스트 복잡도 + 사용자 노트 어휘 + AI 질문 패턴) | `src/main/UserLevelEstimator.ts` (mock → 실 학습) | M4 T22 mock 정합 + 별도 학습 데이터 셋 박음 |
| S017-T21 | 워크스페이스 공유 설계 초안 — 협업 시나리오 + R3-B 사용자 수준 다중 사용자 격리 | `.flowset/specs/v05-collab-spike.md` (시안) | T18 + T20 후 |
| **M5 종합 + PRD v0.5.0 + Sprint 018 시안 (T22~T26)** | | |
| S017-T22 | 단위 테스트 — 회귀 셋 + 신규 컴포넌트 + Phase 3 진입 검증 (목표 +80~120) | `tests/**/*.test.ts` | M0~M4 머지 후 |
| S017-T23 | PRD v0.5.0 발행 (Phase 3 진입 + 로컬 LLM + Notion Export 메타) | `docs/prd/00_change_history.md` + 신규 §13 로컬 LLM | T22 후 |
| S017-T24 | Sprint 017 종합 evaluator + 핸드오프 + state/known-issues 갱신 | `.flowset/handoffs/YYYY-MM-DD.md` | T23 후 |
| S017-T25 | Sprint 018 contract 시안 — Phase 3 종료 + MVP 최종 딥검증 (시나리오 4개 100% + 사용자 실사용 1주) | `.flowset/contracts/sprint-018.md` | T24 후 |
| S017-T26 | Phase 3 종료 선언 검토 — MVP 진입 가능 여부 평가 | `.flowset/specs/phase3-exit-checklist.md` | T25 후 |

### 제외 (Sprint 018 / Phase 4 / MVP)

- MVP 최종 시연 (시나리오 4개 100% + 사용자 1주 실사용) — Sprint 018+ (Phase 3 종료 후)
- 모바일 동기화 — Phase 4 또는 Phase 5
- 클라우드 backup / 협업 실시간 — Phase 4

## 3. 수용 기준

### AC-1 Sprint 016 residual + KI 정리 (T01~T05)

- drainUntil helper 신규 + BackgroundTranslationQueue.test.ts refactor (회귀 +0 / 시간 단축)
- pageId='' validation 위치 명시 + LOW KI 등록 후 closed 또는 carryover 결정
- KI-009 MemoryStatsPanel React 단위 4 케이스 PASS — KI-009 closed
- KI-018/019 closed 전환 (Sprint 016 M5 T23 산식 cover 후속)
- KI-011/012/013/014/015/016 6종 closed 전환 (Sprint 016 M0 perf bench infra carryover)

### AC-2 T20 후속 — renderer UI overlay + Highlight SQLite swap (T06~T09)

- NoteHighlight renderer UI overlay 동작 (다중 highlight 동일 페이지 / 클릭 → 노트 패널 포커스 / toast fallback)
- V4→V5 마이그레이션 dry-run + 자동 백업 (`<userDataDir>/backup/v04/<ISO_ts>/`)
- HighlightStore SQLite swap 후 in-memory 와 동일 interface (회귀 + 단위 회귀 cover)
- Workspace Export/Import 에 highlights 행 포함 round-trip 보존

### AC-3 Sprint 016 신규 KI batch (T10~T13)

- KI-020 SPA did-navigate-in-page hook 동작 (GitHub issue 클릭 / Notion 페이지 전환 시나리오)
- KI-021 partition cleanup reconcile path 부팅 시 1회 실행 + log 박음
- KI-022 Import 후 embedding_queue 자동 재 enqueue (page + note 양쪽)
- KI-031 freeform fallback wording 정합 + 회귀 (Sprint 017 M2 T13 closed — KI-013 표기는 contract 시안 시점 ID 오기, KI-013 은 검색 perf KI [closed] 라 재사용 불가)

### AC-4 Phase 3 진입 spike (T14~T17)

- Ollama spike + sentence-transformers spike 결과 보고 (`.flowset/specs/sprint-017-local-llm-spike.md`)
- **dependency 추가 사용자 승인 후 통합** — T14/T15 spike 결과 후 별도 PR

### AC-5 Notion / Markdown Export / 공유 설계 (T18~T21)

- Markdown Export 워크스페이스 → 폴더 구조 단위 회귀
- Notion Export BYOK token UX + 단위 회귀
- 자동 수준 추정 실 학습 로직 PoC
- 워크스페이스 공유 설계 시안 (Sprint 018 진입 조건)

### AC-6 통과 기준 (T22~T26)

- 각 M evaluator Pass + Pass ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 15 Sprint 연속)
- **누적 단위 테스트 ≥ 1520** (목표 1520~1560, Sprint 017 M0~M4 +80~120)
- 시나리오 회귀 셋 18+ 통합 회귀 + 30 케이스 산식 cover 유지
- PRD v0.5.0 발행
- **KI 잔여 ≤ 5 (HIGH 0 / MEDIUM 0 / LOW ≤ 5)** — Sprint 017 진입 시점 잔여 11 (Sprint 016 M5 T25 시점 closed 15 + open 11). 본 Sprint 017 M0~M5 closed 후보 (KI-009 React 단위 + KI-001 macOS 2차 + KI-004 response_format + KI-006 abort carryover + KI-020/022 batch + KI-024 Shadow DOM = 7 closed 후보). 진입 시점 carryover 매트릭스 정합.
- Sprint 018 contract 시안 작성 (Phase 3 종료 + MVP 진입 검토)

## 4. 마일스톤

| M | 산출물 | 작업 | 기간 |
|---|---|---|---|
| **M0** | Sprint 016 residual + KI 정리 (carryover 8 closed) | T01~T05 | 3~4일 |
| **M1** | T20 후속 renderer UI overlay + Highlight SQLite swap | T06~T09 | 5~6일 |
| **M2** | Sprint 016 신규 KI batch (4건) | T10~T13 | 3~4일 |
| **M3** | 로컬 LLM / 임베딩 spike | T14~T17 | 5~6일 (spike 위주, dependency 승인 후 구체화) |
| **M4** | Notion / Markdown Export / 공유 설계 | T18~T21 | 5~6일 |
| **M5** | 종합 + PRD v0.5.0 + Sprint 018 시안 | T22~T26 | 3~4일 |

총 24~30일 (3.5~4.5주 보수 추정). **시간 한정 시 M3/M4 위임** (Sprint 018 진입).

## 5. 가드레일 적용

### 기존
- **G-001~G-015** 모두 활성 (Sprint 016 종료 시점 정합)
- 특히 **G-013** (단계별 PR) — T06 renderer overlay 는 T07 SQLite swap 전에 박음 (G-013 2단계 → 3단계 순)
- **G-014** (데이터 마이그레이션 dry-run + 백업) — T07 V4→V5 마이그레이션 강제 적용

### 신규 (본 Sprint 활성화 시안 — T25 종합 evaluator 시점 정식화)
- **G-019 [신규]** perf bench infra 정량 임계 매트릭스 강제 — 매 Sprint 종료 evaluator 시점에 `npm run perf` 실행 + 8종 매트릭스 보고서 갱신 강제. Sprint 016 M0 T06 산출물 (`.flowset/eval-results/sprint-016-perf-bench.md`) 이 SSOT.
- **G-020 [신규]** 외부 dependency 추가 (npm package / Python sidecar / native binary) 시 별도 PR + 사용자 승인 필수 — Ollama / sentence-transformers / Notion API 정합. T14/T15/T19 진입 전 PR 별도.

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass ≥ 8.**

특히 M1 (T06~T09 Highlight UI + SQLite swap) 는 G-014 dry-run + 백업 동작 강제 + V4 데이터 보존 검증 가중.
M3 (T14~T17) 는 spike 위주 — 산출물 보고서 정합성 가중 (dependency 추가 시 별도 승인 명시).

**정량 임계 carry-over** (Sprint 016 M0 T06 매트릭스 8종):
- 매 Sprint M0 또는 M5 종료 시점에 `npm run perf` 실행 + 보고서 갱신 (G-019 신규 강제 후보)
- 임계 미달 시 후속 hotfix 또는 KI carry-over 결정

**KI-018/019 30 케이스 산식 cover** (Sprint 016 M5 T23 scenario-accuracy):
- 본 Sprint 017 의 새 회귀 추가 시 산식 적용 강제 (시나리오 1·3·4 + S2 기존 페어 셋 + AI precision 30 케이스 mock)

## 7. 리스크 / 미지수

1. **Ollama dependency 사용자 승인 미달 시 M3 일정 영향** — T14 spike 만 진행하고 통합 T16 은 Sprint 018 위임.
2. **Notion API token UX 부담** — OS Keychain 위임 (G-005) 정합 + 사용자 발급 절차 가이드 필요.
3. **V4→V5 마이그레이션 데이터 손실 위험** — G-014 dry-run + 자동 백업 강제. 실패 시 부팅 차단 + 사용자 안내.
4. **renderer UI overlay z-index / iframe conflict** — KI-024 Shadow DOM cross-boundary graceful fallback + toast 안내 동반.
5. **R3-B 학습 데이터 셋 부재** — T20 mock 교체는 학습 데이터 셋 박힘 후 진행. Phase 3 종료 후 MVP 진입 조건.
6. **drainUntil helper refactor** — BackgroundTranslationQueue.test.ts 30+ 회귀 모두 수정 시 fragile. PR 분할 (T01 helper 만 신규 → T01b refactor 별도) 권고.
7. **사용자 PRD 변경 위험** — Sprint 017 진입 시 Phase 3 우선순위 (로컬 LLM vs Export vs 공유) 조정 가능. 본 contract 는 시안 — 본격 진입 전 사용자 검토 권고.

## 8. Sprint 종료 후 다음 (Sprint 018 / MVP 후보)

1. **MVP 최종 딥검증** — 시나리오 4개 100% 시연 + 사용자 실사용 1주
2. **모바일 동기화** — Phase 4 또는 별도 product line
3. **클라우드 backup / 협업 실시간** — Phase 4
4. **추가 provider 추가** — Anthropic / xAI / Mistral (BYOK)
5. **PWA 또는 native mobile shell** — 본 Electron shell 외부 분기

## 9. 참조

- 시안 작성 시점: Sprint 016 M5 T26 (2026-05-21)
- 방향 SSOT: `.flowset/specs/v04-direction.md` (Sprint 015 박힘, Sprint 016 M5 시점 정합)
- 최신 핸드오프: `.flowset/handoffs/2026-05-21.md` (Sprint 016 M5 진행)
- 가드레일: G-013 / G-014 (Sprint 015 박힘) + G-015 (Sprint 016 박힘) + **G-019 / G-020 신규 (본 시안)**
- Known Issues: `.flowset/known-issues.md` KI-001 ~ KI-026 (26건 — Sprint 016 M5 T25 종결 시점 closed 15 + carryover 11). 본 시안 정식화 PR 시점에 신규 KI 후보 3건 (drainUntil helper / pageId='' validation / freeform fallback wording) 등록 권고.
- 외부 참조 (M3 spike 진입 전):
  - Ollama: https://ollama.com/ + https://github.com/ollama/ollama-js
  - sentence-transformers: https://huggingface.co/sentence-transformers + ONNX runtime
  - Notion API: https://developers.notion.com/

## 10. Partial Closure 보고 (2026-05-23)

### 10.1 진행 상태 매트릭스

| M | 작업 | 상태 | 비고 |
|---|---|---|---|
| **M0** | T01~T05 (residual + KI 정리) | ✅ 머지 5/5 | PR #219~#222 |
| **M1** | T06~T09 (T20 후속 renderer overlay + Highlight SQLite swap) | ✅ 머지 4/4 | PR #223~#229 |
| **M2** | T10~T13 (Sprint 016 신규 KI batch) | ✅ 머지 4/4 | PR #230~#234 |
| **M3** | T14~T17 (로컬 LLM / 임베딩 spike) | ⚠️ 부분 머지 3/4 | T14/T15/T16 머지 (PR #235~#237) — **T17 carryover** |
| **M4** | T18~T21 (Notion / Markdown Export / 공유 설계) | ⚠️ 부분 머지 1/4 | T18 머지 (PR #238) — **T19/T20/T21 carryover** |
| **M5** | T22~T26 (종합 + PRD v0.5.0 + Sprint 018 시안) | ⚠️ 대체 진행 0/5 → mini-milestone β 박음 | T22~T26 carryover. M5 대체 산출물: G-021 (PR #240) + G-022 (PR #243) + mini-milestone β D (PR #244) |

### 10.2 M5 대체 산출물 (가드레일 + 자동화 박음)

본 Sprint 017 M5 = contract 시안의 T22~T26 (단위 테스트 + PRD v0.5.0 + 핸드오프 + Sprint 018 시안 + Phase 3 종료 검토) 대신 학습 #8 4번째 위반 회고 → 가드레일 + hook 자동화 박는 path 로 대체:

- **PR #240 G-021** (`64978a1`) — Docs PR dual review 실 호출 강제 + 위반 패턴 차단 (학습 #8 보강). PR #234/#237/#239 위반 3건 회고.
- **PR #243 G-022** (`90cc14f`) — 사용자 마무리 의도 후 작업 진입 차단 (메타 학습). PR #239 머지 후 G-021/Schema v06 임의 진입 (PR #241 close) 회고. codex 019e5119 1순위 권고 정합.
- **PR #244 mini-milestone β D** (`7894636`) — G-018 자동 대조 (verify-pr-body.mjs) + G-021 증거 regex (UUID v7 RFC 9562) + G-022 advisory helper (check-finalization-intent.mjs). codex 019e5136 1순위 권고 정합. 회귀 1709 → 1760 (+51).
- **PR #241 Schema v06 spec** — close (사용자 마무리 의도 위반 회고, +269 산출물 carryover 결정 대기)

### 10.3 carryover 매트릭스 (Sprint 018 위임)

| # | carryover 항목 | 사유 | Sprint 018 진입 조건 |
|---|---|---|---|
| **CO-1** | **T17** 로컬 임베딩 통합 (IndexingService) | T15 spike 후 dependency 승인 필요 | T15 spike 결과 + 사용자 dependency 승인 |
| **CO-2** | **T19** Notion Export | 옵션 A/B/C/D 사용자 명시 선택 필요 — codex 019e5119 §3 권고: 선택 전 C (spec only) / 선택 후 B (raw fetch) | 사용자 명시 선택 |
| **CO-3** | **T20** R3-B UserLevelEstimator 실 학습 | 학습 데이터 셋 부재 | 학습 데이터 셋 박힌 후 |
| **CO-4** | **T21** 워크스페이스 공유 설계 시안 | T18 + T20 후속 | T20 carryover 박힌 후 |
| **CO-5** | **T22~T26** 종합 + PRD v0.5.0 + Sprint 018 시안 + Phase 3 종료 검토 | M5 대체 진행으로 단독 마일스톤 미박음 | Sprint 018 종합 evaluator 시점 |
| **CO-6** | **Schema v06 spec 재진입** | PR #241 close 된 산출물 (+269, B3+B2 결정 + sketch + T17a~e 분해) — 사용자 결정 필요 (왜 close 됐는지 의도) | 사용자 명시 선택 (복원 / 재작성 / 폐기) |
| **CO-7** | **mini-milestone β G-022 blocking PR** | transcript source `~/.claude/projects/<project>/conversations/*.jsonl` 안정성 검증 필요 — codex 019e5161 §1 권고 정합 path: source validation + advisory SessionStart → blocking 전환 | transcript source validation PR (별도) 박힌 후 |
| **CO-8** | **PRD v0.5.0 발행** | Phase 3 진입 + 로컬 LLM + Notion Export 메타 박힘 필요 | T17 + T19 + T20 carryover 박힌 후 |

### 10.4 종결 시점 누적

- 누적 main first-parent S017 PR: **25** (코드 17 + docs 8) — M4 docs #242 + G-021 #240 + G-022 #243 + mini-milestone β D #244 포함
- close PR: 1 (PR #241 Schema v06 spec)
- 단위 회귀: 1374 (Sprint 016 종료) → **1760** (Sprint 017 partial closure) — +386 누적
- 자기 검증 루프: 35 (Sprint 016 종료) → **53** (Sprint 017 M5 partial closure docs PR) — +18 누적 (D 진입 50/G-021 / 51/G-022 / 52/D / 53/partial closure)
- 학습 #8 위반 누적: 4건 모두 가드레일 본문 (G-021 + G-022) + 자동화 (mini-milestone β D) path 박힘
- KI 잔여: 9 (Phase 1 7 + Phase 2 0 + Phase 3 2) — 변동 0
- 가드레일 신규: G-021 (Docs PR dual review 실 호출) + G-022 (사용자 마무리 의도 후 진입 차단). G-019/G-020 시안은 carryover (T22~T23 박힌 후 정식화).

### 10.5 partial closure 권고 정합 path (codex 019e5161)

본 partial closure docs PR = codex 019e5161 §1 권고 (1순위) 정합 진입:
> "M5 G-021 + G-022 + mini-milestone β 박힌 후 carryover 명확히 박는 게 흐름상 안전. T19/Schema v06 = 사용자 결정 대기, G-022 blocking = transcript source 안정성 검증 선행 필요."

권고 처리 path (codex 019e5161 §4):
1. PR A: Sprint 017 partial closure docs/meta (**본 PR**)
2. PR B: G-022 transcript source validation + advisory SessionStart (Sprint 018 진입 후)
3. PR C: 검증 후 blocking 전환 (Sprint 018 진입 후)

## 변경 이력

- 2026-05-21: Sprint 017 contract 시안 작성 (Sprint 016 M5 T26 시점). Phase 2 종결 + Phase 3 진입 + Sprint 016 후속 위임 + R&D 진입. T01~T26 26 작업, 6 마일스톤. AC-1~AC-6 6 수용 기준. G-019/G-020 신규 가드레일 후보. codex 사전 협의 (threadId 019e4a52) 권고 정합 — 앞 M0~M2 구체화 + 뒤 M3~M5 헤더+진입조건 + dependency 추가 별도 승인.
- 2026-05-23: **partial closure** 박음 (Sprint 017 M5 mini-milestone β D PR #244 머지 후). 헤더 상태 정정 + §10 신규 (Partial Closure 보고 — 10.1~10.5). M3 T17 + M4 T19/T20/T21 + M5 T22~T26 + Schema v06 + G-022 blocking 8 항목 Sprint 018 carryover 매트릭스 박음. M5 대체 산출물 (G-021 + G-022 + mini-milestone β D) 정합 명시. codex 019e5161 권고 path (PR A docs/meta → PR B source validation → PR C blocking) 박음.
