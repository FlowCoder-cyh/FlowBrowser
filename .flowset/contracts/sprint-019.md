# Sprint 019 — 로컬 LLM 오프라인 E2E 검증 + 정량 측정 + UserLevelEstimator 실 학습 (Phase 3 종료 진척 1/4)

> **상태: 시안 (2026-05-29 — Sprint 018 M5 T13 작성)**
> Phase: 3 (로컬 LLM 오프라인 end-to-end 검증 + 정량 임계 + S3 시나리오 자동 수준 학습)
> 시작 예정: **Sprint 018 T13 PR 머지(Sprint 018 완전 종료) + 사용자 명시 진입 후** (G-022)
> 목표 기간: **2~3주 (10~16일)** — Sprint 018 대비 narrower scope (단일 종료 임계 축선)
> 출처: `phase3-exit-checklist.md` §6 S019 backlog 행 + T12 evaluator MEDIUM 3 carryover 권고 + codex `019e720f-5975-73a3-8a6b-827e0b475e8a` scope 사전 협의

## 0. 사전 조건

- [ ] **Sprint 018 T13 PR 머지 완료** (M0~M5 전부 종료 = Sprint 018 완전 종료)
- [ ] **G-022 사용자 명시 선택** (Sprint 019 진입 — 본 contract 박힘 ≠ 진입 박음 권고)
- [ ] `phase3-exit-checklist.md` §6 backlog 매핑 승인 (S019 = 본 contract / S020·S021·S022 = 별도 contract)
- [ ] **로컬 LLM 정량(<2초) 측정 환경 확인** — 사용자 하드웨어 base 필요 (Ollama 런타임 + 모델 로드된 실측 환경). 부재 시 정량 AC 는 측정 환경 박힌 후로 조건부.
- [ ] **T20 UserLevelEstimator 실 학습 = 학습 데이터셋 확보 선결** — 데이터셋 acceptance(§AC-3) 통과 후 R3-B 학습 진입. 데이터셋 부재 시 본 작업만 Sprint 020 carryover (Sprint 진행 자체는 차단 안 함).
- [ ] **MEDIUM 3 carryover (KI-001 / KI-004 / KI-006)** = S019 핵심 scope 와 **별도 추적** (§5 clear path — 핵심 AC 아님, 병행 가능, MVP 직전 정리 대상)

## 1. Sprint 목표

**로컬 LLM 오프라인 end-to-end 검증 + 정량 임계 측정 + S3 시나리오(자동 수준 학습) 100% 진척**:

1. **로컬 LLM 오프라인 E2E 검증** — 인터넷 차단 상태에서 검색 + 채팅 + 인덱싱이 외부 호출 0 으로 동작함을 통합 테스트 + 수동 시연 체크리스트로 증명 (현재 wiring 박힘 / 오프라인 end-to-end 시연·검증 미완 — `phase3-exit-checklist.md` §2 #3)
2. **로컬 LLM 응답 정량 임계 < 2초 측정** — 사용자 하드웨어 base 실측 (현재 미측정 — §2 #5)
3. **UserLevelEstimator 실 학습 (T20 R3-B)** — Phase 2 mock 을 실 학습 로직으로 교체 (학습 데이터셋 확보 후 — §2 #1 S3 시나리오 100% 기여)
4. **chatStream (Ollama NDJSON)** — **비필수 defer** (§16.4.3 offline = 검색+채팅+인덱싱, streaming 불요 — 여유 시 진행, exit 임계 무관)

**Phase 3 종료 임계 §16.4.3 기여**: #3 (오프라인 검색+채팅+인덱싱) + #5 (로컬 LLM 정량 < 2초) + #1 (S3 시나리오 100%, 자동 수준 학습 축).

**미해당 (본 Sprint 외 종료 임계)**: #1 S2 (Notion Export → S020) / #2 (1주 실사용 → S022) / #4 (Export 3종 round-trip 중 Notion → S020).

## 2. 범위

### 포함 (M0~M3)

| # | 작업 | 산출물 | 종료 임계 기여 / 출처 |
|---|---|---|---|
| **M0 로컬 LLM 오프라인 E2E 검증 (S019-T01~T02)** | | | |
| S019-T01 | 오프라인 통합 테스트 — 외부 네트워크 호출 차단 fake/spy 하에서 검색(handleSearchQuery) + 채팅(ChatService, local provider) + 인덱싱(IndexingService → OllamaProvider.embed) 이 외부 호출 0 으로 완결됨을 단언 | `tests/integration/local-llm-offline.test.ts` 신규 (예상 +회귀 5~8) | §16.4.3 #3 / checklist §2 #3 |
| S019-T02 | 오프라인 수동 시연 체크리스트 — 인터넷 차단(시스템 또는 Ollama-only) 후 검색+채팅+인덱싱 동작 절차 + 통과 기준 문서화 (사용자 실측 path) | `.flowset/specs/phase3-offline-e2e-checklist.md` 신규 | §16.4.3 #3 / G-006 (wiring ≠ exit 검증 구분) |
| **M1 로컬 LLM 정량 측정 (S019-T03)** | | | |
| S019-T03 | 로컬 LLM 응답 정량 bench — `OllamaProvider.chat` 응답 시간 측정 harness + 임계 < 2초 판정. 측정 환경 부재 시 harness + 측정 절차만 박고 실측은 사용자 하드웨어 base 조건부 (G-006 — 미측정을 "통과" 주장 금지) | `tests/perf/localLlm.bench.ts` 신규 + 보고서 `.flowset/eval-results/sprint-019-local-llm-bench.md` | §16.4.3 #5 / §15.4 |
| **M2 UserLevelEstimator 실 학습 (S019-T04~T05, 데이터셋 선결)** | | | |
| S019-T04 | 학습 데이터셋 acceptance — R3-B 실 학습 입력 데이터셋 형식/규모/라벨 기준 정의 + 확보 검증. 부재 시 본 M2 만 Sprint 020 carryover | `.flowset/specs/sprint-019-userlevel-dataset.md` 신규 | §AC-3 선결 게이트 / sprint-018 §155 리스크 |
| S019-T05 | T20 R3-B UserLevelEstimator 실 학습 로직 — Phase 2 mock 교체 + 단위 회귀 (데이터셋 acceptance 통과 후 진입) | `src/main/UserLevelEstimator.ts` 실 학습 + `tests/**/*.test.ts` 회귀 | §16.4.3 #1 (S3 100%) / checklist §6 S019 |
| **M3 Sprint 종합 + Sprint 020 시안 (S019-T06~T07)** | | | |
| S019-T06 | Sprint 019 종합 evaluator + 핸드오프 + state/known-issues 갱신 | `.flowset/handoffs/YYYY-MM-DD.md` + state/known-issues 동기화 | M0~M2 머지 후 |
| S019-T07 | Sprint 020 contract 시안 (Notion Export 구현 S020-a~f — phase3 backlog §6 다음 축선) | `.flowset/contracts/sprint-020.md` | S019-T06 후 |

### 다음 Sprint / Phase 3 종료 backlog 매핑 (codex Q1 — 본 contract scope **외**, path 추적만)

> phase3-exit-checklist.md §6 정합. 본 Sprint 019 는 4개 Sprint 축선(S019 로컬LLM / S020 Notion / S021 공유 / S022 MVP 딥검증) 중 **S019** 만 다룬다 — 그 안에 로컬 LLM 검증 축(#3+#5) + S3 자동 수준 학습 축(#1, T20 조건부)이 포함된다. S020·S021·S022 는 별도 contract 로 분리 — 본 표는 추적 장치이며 Sprint 019 가 흡수하지 않는다 (codex Q1 BLOCKING).

| Sprint | 작업 | Phase 3 종료 임계 기여 (§16.4.3) | 출처 |
|---|---|---|---|
| **S020** | `ExportArtifactBuilder` Notion 경로 구현 (S020-a~f) + round-trip 회귀 | #4 (Notion = Export 3종 마지막 1종) + #1 (S2 시나리오 100%) | 설계 spec `sprint-018-notion-export-spec.md` (옵션 C) |
| **S021** | `SharedWorkspaceFormat` 구현 (S021-a~k) + Auto-Backup | Phase 3 외부 통합 마지막 축 | 설계 spec `v05-collab-spike.md` (gzip+Ed25519 TOFU+untrusted validator) |
| **S022 (검토)** | Phase 3 종료 evaluator + MVP 최종 딥검증 (시나리오 4개 100% 시연 + 사용자 1주 실사용) | #1 (4 시나리오 전부) + #2 (1주 실사용) | PRD §16.1 (MVP 정의) / §16.4.3 |

### 제외 (Sprint 020+ / Phase 4)

- **Notion Export 구현 / 워크스페이스 공유 구현 / MVP 최종 딥검증** — 각각 별도 contract (S020 / S021 / S022)
- **chatStream 실 streaming UI 통합** — 비필수 defer (본 Sprint 여유 시 PoC 가능하나 종료 임계 무관)
- 모바일 동기화 / 클라우드 backup / 실시간 협업 — Phase 4
- 추가 provider (Anthropic / xAI / Mistral BYOK) — Phase 4

## 3. 수용 기준

### AC-1 로컬 LLM 오프라인 E2E 검증 (S019-T01~T02)

- 오프라인(외부 네트워크 호출 차단) 통합 테스트에서 검색 + 채팅 + 인덱싱이 외부 호출 0 으로 완결 (spy 음성 조건 단언)
- 오프라인 수동 시연 체크리스트 박음 (절차 + 통과 기준 + 사용자 실측 path)
- **G-006 — wiring ≠ exit 검증 구분**: 통합 테스트 통과 = 자동 검증 / 실 오프라인 시연은 사용자 실측 체크리스트로 분리. "검증 완료"를 시연 없이 주장 금지.

### AC-2 로컬 LLM 정량 측정 (S019-T03)

- `OllamaProvider.chat` 응답 시간 측정 harness 박음 + 임계 < 2초 판정 로직
- 측정 환경 확보 시 실측값 보고서 박음 (< 2초 PASS/FAIL 명시). **측정 환경 부재 시 harness + 절차만 박고 실측은 조건부** — G-006 (미측정을 "통과" 주장 금지)

### AC-3 UserLevelEstimator 실 학습 (S019-T04~T05) — 데이터셋 선결 게이트

- **선결**: 학습 데이터셋 acceptance (형식/규모/라벨 기준 정의 + 확보 검증) 통과
- 데이터셋 통과 후: `UserLevelEstimator` Phase 2 mock → 실 학습 로직 교체 + 단위 회귀 (S3 시나리오 자동 수준 추정 cover)
- **데이터셋 부재 시**: 본 AC 만 Sprint 020 carryover (Sprint 019 진행 자체는 차단 안 함, M0~M1 + M3 독립 진행)

### AC-4 통과 기준 (S019-T06~T07)

- 각 M evaluator Pass + Pass ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 연속)
- 누적 단위 테스트 ≥ 1950 (Sprint 019 신규 회귀만큼 증가, 회귀 0)
- 시나리오 1·2·3·4 cover 90%+ 유지 (S3 실 학습 시 100% 진척)
- Sprint 020 contract 시안 작성 (Notion Export 구현 path)
- **KI 잔여 매트릭스 정합** — MEDIUM 3 carryover 추적 (§5 clear path 명시, 핵심 AC 아님)

## 4. 마일스톤

| M | 산출물 | 작업 | 기간 |
|---|---|---|---|
| **M0** | 로컬 LLM 오프라인 E2E 검증 (통합 테스트 + 수동 체크리스트) | T01~T02 | 3~4일 |
| **M1** | 로컬 LLM 정량 측정 (bench harness + 보고서) | T03 | 2~3일 |
| **M2** | UserLevelEstimator 실 학습 (데이터셋 acceptance → R3-B 학습) | T04~T05 | 3~5일 (데이터셋 후) |
| **M3** | Sprint 종합 + Sprint 020 시안 | T06~T07 | 2~3일 |

총 10~15일 (2~3주 보수 추정). M2 는 데이터셋 확보 시점에 따라 변동 (부재 시 M2 carryover → 총 7~10일).

## 5. MEDIUM 3 KI carryover clear path (codex Q2 — S019 핵심 AC **아님**, 별도 추적)

> T12 evaluator 권고 — AC-6 부분충족(MEDIUM 0 목표 vs 실 MEDIUM 3) 잔여 클리어 path. 본 3건은 **S019 핵심 scope 와 별도**, 처리 가능 시 병행, MVP 직전(S022 전) batch 정리 대상 (PRD §17 정책 — HIGH 0 이므로 Phase 3 종료 차단 KI 없음).

| KI | Severity | 내용 | clear path | 처리 후보 시점 |
|---|---|---|---|---|
| **KI-001** [in-progress] | MEDIUM | sqlite-vec macOS native 빌드 미검증. 1차 PoC(arm64 + Node 20 ABI) SUCCESS (PR #168). 잔여: (2a) darwin-x64(Intel) + windows matrix 통합 → required check 승격 (2b) Electron 39 native ABI rebuild PoC | macOS Intel + Windows CI matrix 통합 PR + Electron 39 `electron-rebuild` 런타임 재load PoC. **로컬 LLM 검증과는 별개 축**(native CI 성격)이나 검증 환경 안정성과 접점 | S019 병행 가능 / MVP 직전 |
| **KI-004** [open] | MEDIUM | `ChatRequest.response_format` JSON 강제 API-level 미구현 (현 system prompt 의존) | (1) `ChatRequest.responseFormat?: 'text'\|'json_object'` 추가 (2) `OpenAIApiKeyProvider` body 전달 (3) AutoTagger `json_object` 지정. UserLevelEstimator/AutoTagger JSON 안정성과 관련 (M2 동반 검토 가능) | S019 병행 가능 (M2 접점) / MVP 직전 |
| **KI-006** [open] | MEDIUM | Workspace 전환 시 진행 작업 abort 정책 미배선 (인덱싱/임베딩큐/채팅 streaming) | `WorkspaceHandlerDeps` abort callback 3종(`abortIndexing`/`clearEmbeddingQueue`/`abortChatStreaming`) 주입 → `handleWorkspaceSwitch` 진입 시 호출. **로컬 LLM E2E 중 ws switch/streaming 취소 검증과 일부 접점**(M0 동반 검토 가능) | S019 병행 가능 (M0 접점) / MVP 직전 |

- **⚠️ KI status drift (T13 dual review codex 019e720f NOTABLE — 실 코드 대조 확인, G-006)**: KI-004·KI-006 은 known-issues.md 헤더상 `[open]` 이나 **권고 코드가 이미 실재**한다 — KI-004 = `src/ai/types.ts:86` `responseFormat?`, `OpenAIApiKeyProvider.ts:135` `body.response_format`, `AutoTagger.ts:195` `responseFormat:'json_object'` (주석 "Sprint 016 M0 T04 (KI-004)") / KI-006 = `workspaceHandlers.ts:106-108,276-278` abort callback 3종 + `services.ts:896-900` wiring. 따라서 두 건의 **실제 clear path = 신규 구현이 아닌 status 재조정(구현이 KI 충족하는지 검증 → closed 전환)** 이다. KI-001 만 실 미완(arm64 PoC 통과 / Intel·Windows matrix + Electron ABI 잔여). **본 contract 의 §5 표 "내용/clear path" 열은 known-issues SSOT 기준 기재(AC-3)** 이며, status 재조정은 Sprint 019 진입 시 최우선 reconciliation 작업(known-issues.md 별도 정정 PR — 본 docs PR scope 외, G-013). 재조정 후 실 MEDIUM 잔여는 1(KI-001)로 축소될 수 있음.
- **정책 정합**: MEDIUM 3 은 5개 batch 임계 미달(KI Severity 정의 §등록정책) + Phase 3 미종료 → MVP 직전 정리. 본 Sprint 에서 강제 해소 아님 (병행/재조정 시 closed 처리). G-006 — "충족" 아닌 "carryover 추적" 으로 정직 기록.
- LOW 5 (KI-023·025·028·029·030) 도 동일 정책(MVP 직전 batch). 본 표는 MEDIUM 3 한정 (AC-6 부분충족 직결).

## 6. 가드레일 적용

### 기존 (모두 활성)
- **G-001~G-018** 모두 활성
- **G-021** dual review 실 호출 강제 (매 PR / 핸드오프 / Milestone 종료 — evaluator Pass/Partial/Fail + codex thread ID UUID v7 인라인)
- **G-022** 사용자 마무리 의도 후 진입 차단 (PreToolUse blocking — Sprint 018 M0 정식화)

### 자동 강제 path (mini-milestone β 박힘)
- **G-018 자동 대조** (`.flowset/scripts/verify-pr-body.mjs`) — PR body 산출물 매트릭스 vs `git diff --numstat` 실측 정합
- **G-021 증거 regex** — evaluator 카운트 + codex thread ID UUID v7 + BLOCKING/NEEDS_CHANGES/NOTABLE 카운트
- **G-022 PreToolUse 게이트** (`g022-tool-classifier.mjs` + `pre-tool-use.mjs`) — 진입 차단 exit 2, 사용자 entry 발화로 해제

### 신규 (본 Sprint 활성 시안 — 정식화 시점 평가)
- **G-019 [carryover]** perf bench 정량 임계 매트릭스 강제 — Sprint 017 carryover. 본 Sprint M1 (로컬 LLM 정량 bench) 시점 정식화 후보 (측정 환경 박힌 후).
- **G-020 [carryover]** 외부 dependency 추가 별도 PR + 사용자 승인 — Sprint 017 carryover. Ollama 모델/런타임 의존이 측정 환경에 추가될 경우 정합.

## 7. evaluator 통과 기준

각 M evaluator Pass + Pass ≥ 8.

- **M0 (오프라인 E2E)**: 외부 호출 0 spy 음성 조건 + wiring ≠ exit 검증 구분(G-006) 가중. behavior-blind 우려는 mutation 테스트로 반증 (네트워크 차단 무력화 시 테스트 fail).
- **M1 (정량)**: 측정 환경 부재 시 "harness + 절차 박음" 으로 평가 (미측정을 PASS 주장 금지 — G-006).
- **M2 (UserLevelEstimator)**: 데이터셋 acceptance 선결 게이트 통과 후만 실 학습 평가. 데이터셋 부재 시 carryover 정직 기록.

## 8. 리스크 / 미지수

1. **로컬 LLM 정량 측정 환경 부재** (M1) — Ollama 런타임 + 모델 로드된 사용자 하드웨어 base 필요. CI/dev 환경에서 < 2초 실측 불가 가능성 높음. 대응: harness + 절차 박고 실측은 사용자 환경 조건부 (G-006 미측정 ≠ 통과).
2. **R3-B 학습 데이터셋 부재** (M2) — Sprint 018 에서 동일 사유로 defer. 데이터셋 acceptance 미통과 시 M2 만 Sprint 020 carryover (Sprint 진행 자체는 차단 안 함).
3. **오프라인 시연 환경** (M0) — 실 인터넷 차단 시연은 사용자 환경. 통합 테스트는 fake/spy 차단으로 자동 검증 + 수동 체크리스트로 분리.
4. **MEDIUM 3 KI 병행 여부** (§5) — 핵심 AC 아니므로 Sprint 기간 압박 시 미처리 가능. MVP 직전(S022 전) batch 로 최종 clear 보장 필요.

## 9. Sprint 종료 후 다음 (S020~S022)

1. **S020** — Notion Export 구현 (`ExportArtifactBuilder` S020-a~f) + round-trip 회귀 → 종료 임계 #4 + #1(S2)
2. **S021** — `SharedWorkspaceFormat` 구현 (S021-a~k) + Auto-Backup → Phase 3 외부 통합 완성
3. **S022 (검토)** — Phase 3 종료 evaluator + MVP 최종 딥검증 (시나리오 4개 100% 시연 + 사용자 1주 실사용) → 종료 임계 #1 #2 전부 + MVP 진입

## 10. 참조

- 시안 작성 시점: Sprint 018 M5 T13 (2026-05-29 — Sprint 018 M0~M5 종료 직전)
- backlog 출처: `.flowset/specs/phase3-exit-checklist.md` §6 (S019~S022 매핑) + §2 (종료 임계 §16.4.3 충족/미충족)
- 직전 contract: `.flowset/contracts/sprint-018.md` (구조 템플릿)
- 방향 SSOT: `.flowset/specs/v04-direction.md`
- 최신 핸드오프: `.flowset/handoffs/2026-05-29.md` 이어쓰기 7 §32 (T13 spec)
- Known Issues: `.flowset/known-issues.md` — MEDIUM 3 (KI-001 §56 / KI-004 §181 / KI-006 §98) + 잔여 8 (HIGH 0 / MEDIUM 3 / LOW 5)
- 설계 spec (다음 Sprint): `sprint-018-notion-export-spec.md` (S020) / `v05-collab-spike.md` (S021)
- 실 코드: `src/ai/providers/OllamaProvider.ts` (chat+embed) / `src/main/UserLevelEstimator.ts` (mock) / `src/main/ChatService.ts` / `src/main/IndexingService.ts`
- 가드레일: G-001~G-018 + G-021/G-022 (활성) + G-019/G-020 carryover (정식화 후보)
- codex 사전 협의: `019e720f-5975-73a3-8a6b-827e0b475e8a` — Q1 scope 한정(BLOCKING) / Q2 MEDIUM 3 별도 섹션(NEEDS_CHANGES) / Q3 데이터셋 선결(BLOCKING) / Q4 사전조건(BLOCKING) / Q5 구조 + 2 섹션 추가(NOTABLE)
- PRD: §16.1 (MVP 정의) / §16.4.3 (Phase 3 종료 임계 5영역) / §16.5 (시나리오 cover) / §15.4 (정량 임계 6종) / §12.8 (OllamaProvider) / §11.6 (UserLevelEstimator)

## 변경 이력

- 2026-05-29 (Sprint 018 M5 T13): Sprint 019 contract 시안 작성. scope = 로컬 LLM 오프라인 E2E 검증 + 정량(<2초) 측정 + UserLevelEstimator 실 학습 (Phase 3 종료 임계 §16.4.3 중 #3 + #5 + #1[S3] 축선). S020(Notion)/S021(공유)/S022(MVP 딥검증)은 §2 다음 Sprint backlog path 로만 박음 (codex 019e720f Q1 BLOCKING — scope 흡수 금지). MEDIUM 3 KI carryover (KI-001/004/006) §5 별도 clear path 섹션 (codex Q2 NEEDS_CHANGES — 핵심 AC 아님). T20 UserLevelEstimator = 데이터셋 acceptance 선결 조건부 (codex Q3 BLOCKING). M0~M3 + T01~T07 7 작업, 4 마일스톤. AC-1~AC-4. T13 머지 시 Sprint 018 완전 종료.
  - **dual review (G-021)**: evaluator `aeb40d3548f4e032b` **Pass 6/0/0** (AC1~AC6 — backlog 매핑·KI 내용·줄번호 독립 대조 어긋남 0) + codex `019e720f-5975-73a3-8a6b-827e0b475e8a` round-2 **BLOCKING 0 / NEEDS_CHANGES 1 / NOTABLE 2** → 정정 → 본 시안 반영. NC(해소): §2 "1개(로컬 LLM) 축선만" 표현이 본문 S3/T20 축 포함과 내부 모순 → "S019(로컬 LLM 검증 #3+#5 + S3 자동 수준 #1) 축" 으로 정정. NOTABLE(반영): (1) KI-004·006 코드 선행 status drift → §5 ⚠️ 정직 명시(실 clear path = status 재조정, 재조정 후 MEDIUM 잔여 1[KI-001]로 축소 가능) (2) PRD §16_roadmap L68 `src/ai/UserLevelEstimator.ts` stale path(실제 `src/main/`) → handoff drift 추적 등록(contract 경로는 정확).
