# 16. 로드맵 (Roadmap)

> [← PRD 목차](./README.md)

본 섹션은 Phase 1/2/3 분할 + Sprint 매핑 + 시나리오 cover 매트릭스 + MVP 정의. v04-direction §10 SSOT 정합.

## 16.1 MVP 정의

> **MVP = Phase 1 + Phase 2 + Phase 3 전체** (Phase별 출시 ≠ Phase별 검증)

- Phase 1 → 2 → 3 순차 진행
- 각 Phase 종료 시 evaluator 8점 + Known Issue 등록 (HIGH 즉시 처리 / MEDIUM·LOW 누적 후 정리)
- **MVP 최종 출시 = Phase 3 종료 후 딥검증 통과 시점** (시나리오 4개 100% 시연 + 정량 임계 + 사용자 실사용 1주)

## 16.2 Phase 1 (현재) — Sprint 015 = 베이스 인프라

[v04-direction §10.1](../../.flowset/specs/v04-direction.md) 정합. M0~M6 분해 + 약 33 PR 단계별.

### 16.2.1 Phase 1 컴포넌트 (9 base + ShortcutSettings)

| # | 컴포넌트 | 도입 milestone | 파일 |
|---|---|---|---|
| 1 | 워크스페이스 메타 격리 | M6 | WorkspaceSidebar + Tab workspace_id |
| 2 | IndexedPageStore (SQLite + sqlite-vec + 본문 캐시) | M3 | IndexedPageStore / VectorIndex / PageContentCache |
| 3 | 자동 인덱싱 (DOM extractor + 임베딩 + 메타) | M4 | IndexingService + EmbeddingClient + EmbeddingQueue |
| 4 | 임베딩 (OpenAI text-embedding-3-small 1024 차원) | M3 | EmbeddingClient (BYOK) |
| 5 | 시간축 + 의미 검색 (자연어 시간 + Cmd+K) | M5 | SearchService + TimeRangeParser + SearchBar + SearchResultCard + PreviewPane (M5 후순위) |
| 6 | AI 채팅 패널 (워크스페이스 메모리 retrieval + 출처 인용 + 표 schema) | M5 | ChatService + ChatPanel + PromptComposer |
| 7 | 노트 (선택 + AI 자동 태그 + 페이지+visit+대화 anchor + 검색 retrieval 대상) | M5 | NoteService + NotePanel + AutoTagger |
| 8 | AI 자동 태깅 (정형 5종 + freeform, 인덱싱 add-on) | M4 | AutoTagger + TagStore + JSON schema |
| 9 | 사용자 수준 직접 선택 (워크스페이스 설정 + system prompt 분기, R3-A) | M5~M6 | WorkspaceSettings + PromptComposer |
| 10 | ShortcutSettings (Cmd+K override 등) | M5 | ShortcutSettings (A1 §E 9 renderer NEW, PR b5.1 정정) |

### 16.2.2 Phase 1 Sprint 015 M0~M6

| Milestone | 내용 | PR 범위 |
|---|---|---|
| M0 | 사전 분석 A1~A4 (폐기 매트릭스 / 테스트 분류 / 데이터 마이그레이션 / 의존 그래프) | PR 4 (T01~T04) |
| M1 | PRD v0.4 19 섹션 작성 (현재 진행) | PR ~14 (b1~b10, 본문 + 핫픽스) |
| M2 | 폐기 + 일반화 (AIResponseCache / IndexedPageStore base / ProviderAdapter 마이그레이션 / 폐기 9 모듈) | PR 8 |
| M3 | IndexedPageStore 확장 (sqlite-vec / Note / AiChat / Tag) + 임베딩 + 마이그레이션 | PR 7 |
| M4 | 인덱싱 hook + 자동 태깅 + dwell + Privacy IndexingGate | PR 5 |
| M5 | 검색 + AI 채팅 + 노트 + 어댑터 제거 | PR 8 |
| M6 | 워크스페이스 + 메모리 통계 + 종합 | PR 5 |

**총 약 47 PR** (M0 4 + M1 ~14 + M2~M6 33).

### 16.2.3 Phase 1 종료 임계 (정량 + 회귀)

| 영역 | 임계 | 측정 ([§18](./18_evaluation.md) + [§15 §15.4](./15_costs_storage.md#154-정량-임계-6종-v04-direction-§123-phase-1-종료-evaluator-입력)) |
|---|---|---|
| 정량 임계 6종 | 모두 통과 | M3~M5 PoC 측정 |
| 회귀 셋 18 케이스 | S1·S4 100% / S2·S3 90%+ | M6 종료 stopwatch |
| evaluator | 각 M Pass + Pass ≥ 8 | Sprint 015 contract §6 |
| Known Issue | HIGH 0 / MEDIUM 5 미만 | M6 종료 |

## 16.3 Phase 2 (Sprint 016+) — 격리 강화 + 정형 출력

[v04-direction §10.2](../../.flowset/specs/v04-direction.md) 정합.

### 16.3.1 Phase 2 신규 컴포넌트

| 컴포넌트 | 파일 | 책임 |
|---|---|---|
| **WorkspacePartitionManager** | `src/main/WorkspacePartitionManager.ts` | Electron `session.fromPartition('persist:ws-{uuid}')` — 워크스페이스별 cookies / storage 격리 |
| **하이라이트 (Note 확장)** | Note schema 확장 + UI `HighlightOverlay` | DOM anchor 보존 + 페이지 내 고정 위치 표시 |
| **TranslationJobStore + Runner + Panel** | [§14](./14_translation_background.md) | 백그라운드 번역 (논문/PDF) + 시스템 알림 + 워크스페이스 메모리 저장 |
| **UserLevelEstimator** | `src/ai/UserLevelEstimator.ts` | R3-B — 메타 학습 기반 사용자 수준 자동 추정 + override |
| **AutoTagger 정형 schema 강화** | `src/ai/tagging/AutoTagger.ts` 확장 | 시나리오 2 PM 경쟁 분석 cover 향상 (가격/기능/평가 정확도) |
| **PDF 인덱싱** | `src/perception/PdfExtractor.ts` | pdf-extract 라이브러리 도입 — 학술 P1 시나리오 PDF use case 완성 |

### 16.3.2 Phase 2 Sprint 매핑 (잠정 — Sprint 016 contract 확정 시)

| Sprint | milestone 범위 |
|---|---|
| Sprint 016 | cookies/session/캐시 격리 + 하이라이트 + 자동 수준 추정 |
| Sprint 017 | 백그라운드 번역 (큐 + Runner + Panel + 알림) + PDF 인덱싱 |
| (Sprint 018 검토) | AutoTagger 정형 강화 + Phase 2 종료 evaluator |

총 2~3 Sprint 추정.

### 16.3.3 Phase 2 종료 임계

| 영역 | 임계 |
|---|---|
| 회귀 셋 S2 (PM 경쟁 분석) | 95%+ (자동 태깅 정형 강화로 +5% — Phase 1 90% → Phase 2 95%) |
| 회귀 셋 S3 (학습) | 95%+ (자동 수준 추정 도입으로 +5% — Phase 1 90% → Phase 2 95%) |
| 백그라운드 번역 시연 | 학술 P1 PDF use case end-to-end (논문 1편 5분 이내 알림) |
| 워크스페이스 cookies 격리 | 다른 워크스페이스 cookies 전혀 미공유 검증 |

## 16.4 Phase 3 (Sprint 017+ 후속) — 외부 통합 + 운영성

[v04-direction §10.3](../../.flowset/specs/v04-direction.md) 정합.

### 16.4.1 Phase 3 신규 컴포넌트

> **v0.5.0 진행 현황 정정**: v0.4.x 가 명시한 미래 컴포넌트 명칭 일부는 실 구현에서 다르게 수렴. 로컬 LLM/임베딩은 **단일 `OllamaProvider`** (chat+embed) 로 통합 (별도 `LocalLLMProvider`/`LocalEmbeddingProvider` 분리 미채택). 상태 열은 2026-05-29(Sprint 018 M4) 기준.

| 컴포넌트 (실 명칭) | 파일 | 책임 | 상태 |
|---|---|---|---|
| **`OllamaProvider`** (chat+embed) | `src/ai/providers/OllamaProvider.ts` | Ollama (`/api/chat` + `/api/embed`). chat=`llama3.2:3b` 등 / embed=`nomic-embed-text` 768. raw fetch, `providerType='local'` | **chat ✅ (S017 T14) / embed ✅ (S018 T17c) / chatStream ✗ defer**. LM Studio/llama.cpp/vLLM = 미도입 후보 |
| **Schema v06 (vec0 dimension 분리)** | `src/storage/schema/v06.sql` + `migrations/v05_to_v06.ts` | `workspaces.embedding_model` + `vec_pages_{1024,768}`/`vec_notes_{1024,768}` + 워크스페이스별 임베딩 격리 | **✅ 구현 (S018 T17a~e, `V06_SCHEMA_VERSION=3`)** |
| **`MarkdownExportService`** | `src/main/MarkdownExportService.ts` | 워크스페이스 → Markdown projection + canonical JSON 첨부 (round-trip) | **✅ 구현** |
| **`ExportArtifactBuilder` (Notion 경로)** | `src/main/ExportArtifactBuilder.ts` (planned, 미생성) | 워크스페이스 → Notion DB (data source + canonical JSON 첨부, lossy projection) | 📝 설계 spec 완료 (T19), **구현 Sprint 020** |
| **`SharedWorkspaceFormat`** | `src/storage/SharedWorkspaceFormat.ts` (planned, 미생성) | `.fbworkspace` gzip envelope + Ed25519 TOFU 서명 + untrusted validator | 📝 설계 spec 완료 (T21), **구현 Sprint 021** |
| **Auto-Backup Service** | `src/main/AutoBackup.ts` | 주기적 워크스페이스 JSON 백업 (사용자 디스크 + 옵션 클라우드) | 미착수 (Sprint 021+ 검토) |

### 16.4.2 Phase 3 Sprint 매핑 (v0.5.0 실측 갱신)

| Sprint | milestone 범위 | 상태 |
|---|---|---|
| Sprint 017 | 로컬 LLM spike + `OllamaProvider.chat()` (T14) + Schema v06 spec + 백그라운드 번역 + 하이라이트 SQLite | ✅ 종결 |
| Sprint 018 | **Schema v06 구현 (T17a~e)** + 로컬 임베딩 통합 (`OllamaProvider.embed()` T17c + write-path) + Notion Export spec (T19) + SharedWorkspaceFormat spec (T21) + **PRD v0.5.0 발행 (T10)** | ✅ M0~M4 종결 (본 발행) |
| Sprint 019 (예상) | (carryover) UserLevelEstimator 실 학습 (T20, 학습 데이터셋 박힌 후) + Phase 3 잔여 검증 | 시안 |
| Sprint 020 | `ExportArtifactBuilder` Notion 경로 구현 (S020-a~f) | 설계 spec 완료 |
| Sprint 021 | `SharedWorkspaceFormat` 구현 (S021-a~k) + Auto-Backup | 설계 spec 완료 |
| (Sprint 022 검토) | Phase 3 종료 evaluator + MVP 최종 딥검증 (4 시나리오 100% + 1주 실사용) | — |

총 3~4 Sprint 추정 (Sprint 017~018 에서 로컬 LLM/임베딩/Schema v06 선행 박힘 — 본래 Sprint 019 예상이 앞당겨짐).

> **Phase 3 종료 미충족 (S018-T11 추적)**: 로컬 LLM chat/embed wiring 은 박혔으나 **오프라인 end-to-end 시연 / 모델별 정량 임계(< 2초) / Export 3종 round-trip / 시나리오 100% / 사용자 1주 실사용** 미완. Notion·공유는 설계만. MVP 최종은 Sprint 020~022. 상세 = `.flowset/specs/phase3-exit-checklist.md`.

### 16.4.3 Phase 3 종료 임계 (MVP 최종)

| 영역 | 임계 |
|---|---|
| 4개 시나리오 모두 | **100%** cover (S2 Notion Export 완성 / S3 자동 수준 + 학습 자료 누적 / S1 학술 + 백그라운드 번역 / S4 우연재발견) |
| 사용자 실사용 1주 | 매일 사용 + 일지 작성 + 발견된 issue 30 개 이내 |
| Local LLM 오프라인 | 인터넷 없이 검색 + 채팅 + 인덱싱 가능 (단 1회 모델 다운로드 후) |
| Export | Notion / Markdown / JSON 3종 모두 round-trip 가능 (export → 외부 도구 import → 재 export 결과 동일) |
| 정량 임계 6종 (§15.4) | Phase 1 임계 그대로 유지 + 로컬 LLM 응답 < 2초 (사용자 하드웨어 base) |

## 16.5 시나리오 cover 매트릭스 (Phase 별)

[v04-direction §11](../../.flowset/specs/v04-direction.md) + [§02](./02_personas_scenarios.md) 정합:

| 시나리오 | Phase 1 만 | + Phase 2 | + Phase 3 |
|---|---|---|---|
| **1 학술 리서치** (논문/arxiv/Nature) | **100%** (HTML 페이지) | **100%** + PDF 백그라운드 번역 = 깊이 ↑ | (그대로) |
| **2 PM 경쟁 분석** (Linear vs Notion 비교) | **90%** | **95%** (자동 태깅 정형 강화) | **100%** (Notion Export) |
| **3 학습** (Rust lifetime 시간순) | **90%** (수준 직접 선택) | **95%** (자동 수준 추정) | **100%** (Local LLM 오프라인 + 학습 자료 영구 보존) |
| **4 우연 재발견** (6개월 전 본 글) | **100%** | (그대로) | (그대로) |

→ **Phase 1 평균 95%, Phase 2 평균 97.5%, Phase 3 평균 100%**.

## 16.6 가드레일 누적 (G-001 ~ G-014)

| ID | 정의 | Phase 활성 |
|---|---|---|
| G-001 | PRD가 SSOT | 전 Phase |
| G-002 | Phase 0 게이트 | (Phase 0 종료, deprecated) |
| G-003 | 인증 금지선 + 자동 호출 BYOK 디폴트 강화 | 전 Phase |
| G-004 | Privacy Filter P0 | 전 Phase |
| G-005 | OS Keychain 위임 | 전 Phase |
| G-006 | 추측 금지 | 전 Phase |
| G-007 | main 직접 push 금지 (PR 강제) | 전 Phase |
| G-008 | 한국어 우선 | 전 Phase |
| G-009 | 커밋명 (`WI-NNN-[type] 한글 작업명`) | 전 Phase |
| G-010 | UTF-8 / LF | 전 Phase |
| G-011 | 공개 endpoint 회색지대 허용 (G-003 금지선 준수) | 전 Phase |
| G-012 | v0.4 방향 SSOT (역방향 갱신 금지) | M1 시작 + 후속 Phase |
| G-013 | 단계별 PR 전략 (어댑터 후 신규 사용 후 폐기 호출지점) | M2 + 후속 Phase |
| G-014 | 마이그레이션 dry-run + 자동 백업 | M3 + 후속 Phase |

[`.flowset/guardrails.md`](../../.flowset/guardrails.md) 본문.

## 16.7 PR 누적 (Sprint 015 M0~M1 진행 중)

PR b8 시점 (2026-05-16):

| 단계 | PR 범위 | 누적 |
|---|---|---|
| Sprint 014 종료 | #76 ~ #97 (Codex OAuth + 15 핫픽스) | 22 PR |
| **Sprint 015 진입** | #98 (정의 + SSOT) | 23 |
| M0 사전 분석 | #99 ~ #102 (A1~A4) | 27 |
| M0 evaluator 권고 | #103 (4건 정정) | 28 |
| **M1 PRD v0.4 작성 (현재 진행)** | #104 ~ #118 (b1~b8 + 핫픽스 7회) | **43 ~** |

남은 M1: b9 (본 PR) + b10 (17/18/19) + 핫픽스 예상 = 약 5~6 PR.

M2~M6: 약 33 PR (§16.2.2 분배).

**Sprint 015 총 PR 예상: 약 80 PR** (M0 4 + M1 ~22 + M2~M6 ~33 + 핫픽스 + 종합).

## 16.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §10 (Phase 분할) + §11 (시나리오 cover) + §12 (검증 흐름) + §13 (PRD 19 섹션) + §16 (진행 흐름)
- `.flowset/contracts/sprint-015.md` (M0~M6 + AC 8 + 정량 임계)
- `.flowset/specs/v04-test-classification.md` §E1 (회귀 셋 18) + §F4 (정량 임계 측정)
- `.flowset/guardrails.md` (G-001 ~ G-014)
- [§02 시나리오](./02_personas_scenarios.md)
- [§15 §15.4 정량 임계](./15_costs_storage.md#154-정량-임계-6종-v04-direction-§123-phase-1-종료-evaluator-입력)
- [§18 평가](./18_evaluation.md)

본 §16 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 16.9 변경 이력

- 2026-05-16 (PR b9): stub → 본문 작성. MVP 정의 (Phase 1+2+3 전체) + Phase 1 컴포넌트 10 (9 base + ShortcutSettings) + M0~M6 매핑 + 총 PR 약 47 + Phase 2 신규 컴포넌트 6 + Sprint 016~018 매핑 + Phase 3 신규 컴포넌트 5 + Sprint 019~022 매핑 + 시나리오 cover 매트릭스 (Phase 1 평균 95%, Phase 3 100%) + 가드레일 G-001~G-014 14종 + 본 시점 PR 누적 통계 (43 PR / 약 80 PR 예상).
- 2026-05-29 (v0.5.0, Sprint 018 M4 T10): **Phase 3 진행 실측 반영**. §16.4.1 컴포넌트 — 미래 명칭 `LocalLLMProvider`/`LocalEmbeddingProvider` → 실 구현 단일 `OllamaProvider` (chat ✅/embed ✅/chatStream defer) + Schema v06 ✅ + MarkdownExportService ✅ + ExportArtifactBuilder/SharedWorkspaceFormat 설계 spec 완료. §16.4.2 Sprint 매핑 — Sprint 017~018 에서 로컬 LLM/임베딩/Schema v06 선행 박힘 (본래 Sprint 019 예상 앞당김) + Notion=Sprint 020 / 공유=Sprint 021 + **Phase 3 종료 미충족** 명시 (오프라인 시연/정량 임계/Export round-trip/시나리오 100%/1주 실사용 미완 — `phase3-exit-checklist.md` 추적). codex 019e718f scope 협의 (drift 정정, 구현 선반영 X). ※ §16.6 가드레일 표는 G-001~G-014 시점 유지 (G-015~G-022 누적은 guardrails.md SSOT).
