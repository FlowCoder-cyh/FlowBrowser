# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **1 형식적 종료 선언** (AI 콘텐츠 메모리 + 워크스페이스 베이스 인프라, Sprint 015 M6 T28~T31 모두 머지) — **실용 검증은 Sprint 016 M0~M1 후 확정** (정량 임계 6종 미측정 + 시나리오 2·3 0% + 어댑터 5종 위임 + KI MEDIUM 4건 (5건 batch 임계 1건 부족, Sprint 016 M0 batch 처리 권고))
- **Sprint**: **015 M0~M6 완료 (12 단계 모두 머지)** — M0 사전 분석 + M1 PRD v0.4 본문 + M2 폐기·일반화 + M3 SQLite·임베딩 + M4 인덱싱·태깅·Privacy + M5 검색·채팅·노트 + M6 워크스페이스·메모리·종합 + **잔여 hotfix (정량 임계 5종 KI 등록 + PARTIAL 4파일 회귀 누락 contract 흡수 + Sprint 016 기간 통일 + PRD §0.6.1 시나리오 표기 정정)**
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: **v0.4.0 정식 발행** (19 섹션, 약 5,200+ lines, 2026-05-19 release tag) — §0.6.1 시나리오 2·3 표기 hotfix 정정 (90%+ → 0%)
- **최근 갱신 (Sprint 016 M4 백그라운드 번역 + 하이라이트 5/5 PR 시퀀스 완료 — M4 종결)**: 2026-05-21 (M2 6 PR + M3 4 PR + **M4 시퀀스 5 PR 머지 (#210 T21 / #211 T22 / #212 T19 / #213 T18 / #215 T20) + docs PR 2 (#214 M4 4/5 시점 + 본 docs PR T20 종결)** — 본 세션 evaluator + codex 병렬 평가 **누적 45회** (M2 23 + M3 8 + M4 5 PR × 2 + 사후협의 2 + 본 docs PR 2 = 14) + PR 내 hotfix 누적 **64건** (M2 39 + M3 7 + **M4 18건 — T21 NC 1 + T22 NB-HF 1 + T19 NC 3 + T18 NC 4 + T20 NC 1 + NB 2 + evaluator NB 1 = T20 4건 + 본 docs PR 5건 (codex NC 3 + NB 2)**) / 단위 **1374 PASS** (T21 +20 / T22 +27 / T19 +21 / T18 +30 / T20 +45 = +143 M4 누적 신규, 1231 → 1374) / **PR 누적 114** (M3 후 #209 + M4 5 PR = #215) / **KI-002 closed (M2) + KI-005 closed (M4 T21) + KI-008 closed (M3 T17) / KI-021 + KI-022 신규 (M3 NB) + KI-023~026 신규 (M4 T20 evaluator + codex batch) = 3 closed + 6 신규** / **가드레일 G-015 활성** (M3) / **학습 누적** #5 + #8 + #13 + #14 + #15 + #16 + #17 + **#18 (codex 사전 dual review 본질적 가치) 11번째 확증 (M4 T20 hotfix 4건 본 PR + 본 docs PR 5건 추가 흡수 + 후속 위임 KI 4건)** + #19 (codex 협의 시퀀스 모범 패턴). 자기 검증 루프 **33회차 SUCCESS** (#181~#215, 33 PR 누적). 본 세션 종료 검증: lint + typecheck + test 1374 PASS + build PASS + M4 5/5 시퀀스 완료 (AutoTagger.tagNote KI-005 closed / UserLevelEstimator mock R3-B / NotificationService Electron + fallback / BackgroundTranslationQueue skeleton + 5 위험 박음 / **T20 NoteHighlight DOM anchor pure 모듈 + in-memory store + W3C Range serialize/deserialize**).
- **다음 세션 진입점**: `.flowset/handoffs/2026-05-21.md` §17 — **Sprint 016 M5 종합 (T23~T26)** 권고 0순위. 단위 테스트 +60~80 + PRD v0.4.1 발행 (KI-026 정정 옵션 B 권장 — PRD §11.5 highlights 신설) + 종합 evaluator + Sprint 017 contract 시안. M5 종료 후 권고: **1순위 T20 후속 renderer UI overlay** (G-013 2단계) / **2순위 옵션 B (Highlight schema + HighlightStore SQLite swap, G-014 dry-run + 백업)** / **3순위 KI-022 후속** / **4순위 KI-021 후속** / **5순위 G-013 3단계 후속**. 학습 #18 11번째 확증 + #19 정합 + G-017 잔존 브랜치 정리 + G-018 산출물 매트릭스 정확성.

## 현재 작업

- Sprint 002 완전 종료 — main 18 commits / 18 PR 모두 머지
- 누적: 18 PR / 70 unit tests / 14 evaluator 호출 / 가드레일 위반 0
- 통과 기준 Pass ≥ 8 적용 (S002부터): 모든 evaluator 충족
- Sprint 001/002 합쳐 Phase 1 MVP 핵심 기능 완성:
  - Electron 셸 + WebContentsView + URL Bar
  - Privacy Layer 5단계 게이트 (G-004)
  - Provider Adapter + OpenAI API Key + OS Keychain (G-005)
  - 선택 영역 + 문단 단위 번역 + 미니 팝업 + 우측 패널
  - TranslationCache (복합 키 + TTL 90/365일 + LRU)
  - UsageLog UI / 차단 통계
  - ESLint + CI lint+typecheck+test+build

### Sprint 003 결과 (PR #20~#24 머지)

- 누적 단위 테스트: 70 → 115 (+45 신규)
- Sprint 종합 evaluator: Pass 17 / 0 / 0
- PRD v0.3.1 발행

### Sprint 004 결과 (PR #25~#29 머지)

- 누적 단위 테스트: 115 → 135 (+20 신규)
- Sprint 종합 evaluator: Pass 9 / Partial 1 / Fail 0
- PRD v0.3.2 발행

### Sprint 005 결과 (PR #30~#34 머지)

- 누적 단위 테스트: 135 → 158 (+23)
- Sprint 종합 evaluator: Pass 9 / 0 / 0
- PRD v0.3.3 발행

### Sprint 006 결과 (PR #35~#39 머지)

- 누적 단위 테스트: 158 → 192 (+34)
- Sprint 종합 evaluator: Pass 8 / 0 / 0
- PRD v0.3.4 발행

### Sprint 007 결과 (PR #40~#44 머지)

- 누적 단위 테스트: 192 → 200 (+8)
- Sprint 종합 evaluator: Pass 17 / 0 / 0
- PRD v0.3.5 발행
- commit-check CI 모든 PR success

### Sprint 008 결과 (PR #45~#49 머지)

- 누적 단위 테스트: 200 → 217 (+17)
- Sprint 종합 evaluator: Pass 17 / 0 / 0
- PRD v0.3.6 발행

### Sprint 009 결과 (PR #50~#55 머지)

- 누적 단위 테스트: 217 → 229 (+12 신규)
- Sprint 종합 evaluator: Pass 11 / 0 / 0
- PRD v0.3.7 발행
- commit-check CI 4개 PR 모두 success

### Sprint 010 결과 (PR #56~#60 머지)

- 누적 단위 테스트: 229 → 254 (+25)
- Sprint 종합 evaluator: Pass 11 / 0 / 0
- PRD v0.3.8 발행
- commit-check CI 5 PR 모두 success

### Sprint 011 결과 (PR #61~#65 머지)

- 누적 단위 테스트: 254 → 273 (+19)
- Sprint 종합 evaluator: Pass 11 / 0 / 0
- PRD v0.3.9 발행
- commit-check CI 5 PR 모두 success

### Sprint 012 결과 (PR #66~#70 머지)

- 누적 단위 테스트: 273 → 287 (+14)
- Sprint 종합 evaluator: Pass 12 / 0 / 0
- PRD v0.3.10 발행
- commit-check CI 6 PR 모두 success

### Sprint 013 결과 (PR #71~#75 머지)

- 누적 단위 테스트: 287 → 307 (+20)
- Sprint 종합 evaluator: Pass 13 / 0 / 0
- PRD v0.3.11 발행
- commit-check CI 5 PR 모두 success

### Sprint 014 결과 (PR #76~#80 머지) — Phase 1 MVP 본체 완료 선언

- M1 (PR #77): DeviceCodeFlow + CodexLoginProvider 코어. evaluator Pass 8/1/0 → 12/0/0 (M2 자가 해소)
- M2 (PR #78): CodexLoginPanel UI + Codex IPC + Spike 1 조건 5개. evaluator Pass 10/0/0
- M3 (PR #79): OnboardingTour + README + docs/USAGE.md. evaluator Pass 12/0/0
- M4 (PR #80): PRD v0.3.12 + Phase 1 §16 매트릭스 + Phase 1.5 트랙. evaluator Pass 14/0/0
- Sprint 014 M4 시점 누적 단위 테스트: **336** / 358
- PRD v0.3.12 발행
- commit-check CI 5 PR 모두 success (G-009 NNN 한 분절 8 Sprint 연속)

### Sprint 014 핫픽스 시퀀스 (PR #81~#95) — 15회 + END 핸드오프 (#96)

사용자 실측 후 발견 문제 핫픽스 (M3-1~M3-15). 모두 main 머지.

- M3-1 Consent 체크박스 / M3-2 WebContentsView 가림 / M3-3 OnboardingTour 가림
- M3-4 Privacy 오탐 / M3-5 기본 Provider Codex 누락
- M3-6 Codex endpoint chatgpt.com/backend-api/codex/responses
- M3-7 모델명 gpt-5.5 + 우클릭 일반 메뉴
- M3-8 instructions 필드 / M3-9 input list / M3-10 store/tools 필드 / M3-11 SSE streaming
- M3-12 자동 번역 + reasoning low / M3-13 Extractor style/script 필터
- M3-14 연속 navigate abort + state 초기화 + debounce / M3-15 progressive render
- 본 세션 종료 시 누적 단위 테스트: **358** / 358 PASS
- 모든 가드레일 위반 0

### Phase 1 §16 11개 항목 100% 완료 매트릭스

| Phase 1 항목 | Sprint |
|---|---|
| Electron 셸 / URL·DOM / Privacy Filter / 선택·문단 번역 / 패널 / 캐시 / API Key+Keychain / UsageLog | 001~002 |
| **Codex Login Provider 실험 (Spike 1 통과 시)** | **014** |
| **온보딩 / 샘플 체험 모드** | 002 (Consent) + **014 (OnboardingTour)** |

## 활성 Spike (5종)

| # | Spike | 상태 | 결과물 | evaluator |
|---|---|---|---|---|
| 1 | Codex/ChatGPT 인증 방식 검증 | **1차 조사 완료 (evaluator: Pass w/ conditions 8/1/0)** | [specs/spike-01-codex-auth.md](./specs/spike-01-codex-auth.md) | [eval-results/spike-01-2026-05-11.md](./eval-results/spike-01-2026-05-11.md) |
| 2 | YouTube 자막/제어 PoC | **1차 조사 완료 (evaluator: Pass w/ conditions)** | [specs/spike-02-youtube.md](./specs/spike-02-youtube.md) | [eval-results/spike-02-2026-05-11.md](./eval-results/spike-02-2026-05-11.md) |
| 3 | 시스템 오디오 캡처 PoC | **1차 조사 완료 (evaluator: Pass w/ conditions)** | [specs/spike-03-audio-capture.md](./specs/spike-03-audio-capture.md) | [eval-results/spike-03-2026-05-11.md](./eval-results/spike-03-2026-05-11.md) |
| 4 | TTS 3축 측정 | **1차 조사 완료 (evaluator: Partial — 차단 아님)** | [specs/spike-04-tts-3axis.md](./specs/spike-04-tts-3axis.md) | [eval-results/spike-04-2026-05-11.md](./eval-results/spike-04-2026-05-11.md) |
| 5 | 사용자 인터뷰 5~10명 | **가이드 보강 완료 (evaluator: Pass)**, 실제 인터뷰는 사용자 진행 | [specs/spike-05-user-interview.md](./specs/spike-05-user-interview.md) | [eval-results/spike-05-2026-05-11.md](./eval-results/spike-05-2026-05-11.md) |

## Phase 0 종료 조건

5종 Spike 모두 판정 완료 → PRD v0.3 업데이트 → Phase 1 진입.

## 🔴 방향 전환 결정 (2026-05-16)

**Phase 1 (실시간 페이지 번역) 효용 한계 실측 확인 → 폐기/재정의**:

### 폐기
- YouTube 자막 (Phase 2)
- TTS 더빙 (Phase 3)
- STT (Phase 5 일부)
- 실시간 페이지 번역 (displayMode replace/overlay)
- SummarizationPlanner (페이지 요약 — 새 방향에서 형태 다름)

### 번역 재정의
- **백그라운드 장시간 처리만 유지** — 논문/PDF 등을 시간 걸려도 백그라운드 + 완료 알림

### 신규 메인 방향
**AI 콘텐츠 메모리 + 워크스페이스 브라우저** (Time Machine for the Web + 프로젝트 격리)
- 본 페이지 자동 인덱싱 (로컬 SQLite + 임베딩)
- 워크스페이스 격리 (탭/메모리/AI/노트 분리)
- 시간축 + 의미 검색
- AI 횡단 분석 (워크스페이스 메모리 retrieval)
- Chrome 확장 못 하는 영역 (대용량 인덱스 / 다중 워크스페이스 / 시스템 통합)

### 유지 인프라
Electron 셸 / 다중 탭 + 영속 / Privacy Filter / OS Keychain / Provider Adapter / Codex OAuth (가벼운 채팅에 적합) / DOM extractor / Cache (일반화 예정)

### 다음 세션 작업
1. PRD v0.4 전면 재작성 (방향 전환 공식화)
2. 폐기 코드 정리 + 일반화 (TranslationCache → AIResponseCache 등)
3. 자동 인덱싱 + 워크스페이스 + 검색바 + AI 채팅 패널

상세: `.flowset/handoffs/2026-05-16.md`

---

## 🟢 Sprint 015 M0~M2 완료 (2026-05-18)

### M0 사전 분석 4 산출물 (T01~T04)
- `.flowset/specs/v04-migration-matrix.md` (A1, 폐기/일반화/유지/부분폐기 분류 + PR b10.1 §B GENERALIZE 4개 정정)
- `.flowset/specs/v04-test-classification.md` (A2, 358 테스트 분류 + 시나리오 회귀 셋 18 케이스)
- `.flowset/specs/v04-data-migration.md` (A3, 5단계 마이그레이션 + 자동 백업 `<userDataDir>/backup/v03/<ISO_ts>/`)
- `.flowset/specs/v04-dependency-graph.md` (A4, IPC 21 폐기 / 56 유지 / 23~24 신규 + PR b10.1 §A 매트릭스 헤더 정정)
- **M0 evaluator (PR #103)**: Pass 16 / Partial 4 / Fail 0 → 권고 4건 정정 완료

### M1 PRD v0.4 19 섹션 본문 완성 (PR #104 ~ #120, b1~b10)
- `docs/prd/README.md` + `00_change_history.md` ~ `19_migration_v03_v04.md` (20행, 약 5,200+ lines)
- 진행 중 codex blocking 127건 + evaluator Partial/Fail 21건 즉시 핫픽스 (b{N}.1 패턴) → KI 누적 0건
- **M1 종합 evaluator (2026-05-17)**: Pass 6 / Partial 2 / Fail 0 → 종합 Pass, M2 진입 가능
- **PR b10.1 핫픽스**: A1 §B GENERALIZE 4개 / §A1 9개 / §A2 12개 / PRD §05.3.1 25개 + cross-link 5파일 / §18 TBD 표현 통일

### M2 폐기 + 일반화 8 PR 완료 (PR #122 ~ #129)
- **신규 모듈** (M2-1/M2-2/M2-7): AIResponseCache + featureFlags + IndexedPageStore + ChatRequest/Response + EmbedRequest/Response (5 타입) + OpenAI/Codex chat/embed 구현
- **폐기** (M2-3/M2-4/M2-5/M2-6): SummarizationPlanner / TranslationRenderer / TranslationPanel 모듈 자체 삭제 / IPC handler 11 (summarize 2 + paragraphs/page 4 + render/restore 3 + pageResult lookup/store 2) / preload API 11 + listener 14 + Payload 타입 17 / CSS dead style 39
- **cleanup** (M2-8): v0.3 단위 테스트 3 파일 (-34) + services.ts dead export 4 + IPC 2 + storage helper 1 + legacy 회귀 2 추가
- **codex+evaluator 병렬 평가 패턴**: 평가 약점 27건 (codex 25 + evaluator Partial 4 - 중복 2) 모두 본 PR 내 즉시 핫픽스 → **KI 누적 0건 / 32 PR 연속**
- **단위 테스트**: 358 → 417 (+59)
- **Bundle**: JS 329.26 → 305.80 kB (-23.46) / CSS 26.49 → 22.27 kB (-4.22)

### Sprint 015 진입 시 박힌 자산
- **`.flowset/specs/v04-direction.md`** — v0.4 방향 SSOT (568+ lines, 19 섹션, P0~P2 결정 38건, 다층 갱신 14건)
- **`.flowset/contracts/sprint-015.md`** — Sprint 015 contract (M0~M6, T01~T31, AC-1~AC-8)
- **`.flowset/known-issues.md`** — KI-NNN 등록 정책 + Severity 정의 + 누적 0건
- **`.claude/settings.json`** — SessionStart hook schema 정상화 (`/doctor` 통과)

### CI 게이트 강화 (Sprint 015 진입 시점 활성)
- main branch protection rule 적용
  - Required status checks: `typecheck + test + build` + `커밋 메시지 형식 검증`
  - Strict (브랜치 최신 동기화 필수): true
  - Enforce admins: false (핫픽스 긴급 우회 능력 보존)
  - Required linear history: true (squash 일관성)
  - Force push / 브랜치 삭제: 차단
- 오토머지 활성 (`gh pr merge --auto --squash --delete-branch`)

### 신규 가드레일 (Sprint 015에서 활성)
- **G-012** v0.4 방향 SSOT — `.flowset/specs/v04-direction.md` 우선 갱신 (역방향 금지). M1 활성.
- **G-013** 단계별 PR 전략 — 신규 모듈+어댑터 → 신규 사용처 → 기존 호출지점 제거 순서. M2 활성.
- **G-014** 데이터 마이그레이션 dry-run + 자동 백업 — `<userDataDir>/backup/v03/<ISO_ts>/`. M3 활성. (M0 A3 정정)

### Sprint 015 M0~M6 (목표 2.5~3주)
- **M0** ✅ (T01~T04 사전 분석, PR #98~#103)
- **M1** ✅ (PRD v0.4.0 19 섹션 본문 작성, PR #104~#120 + b10.1 핫픽스 PR #121)
- **M2** ✅ (폐기 + 일반화 8 PR, #122~#129) — 단위 358 → 417 (+59) / JS bundle -23.46 kB / KI 0건
- **M3** ✅ (spike + 7 PR + docs + 핫픽스, #131~#140) — 단위 417 → 570 (+153) / KI 0 → 2 / 42 PR 누적
- **M4** ✅ (5 PR + 2 hotfix + 1 통합 회귀, #141~#148) — IndexingGate + IndexingService + DwellTracker + AutoTagger + 통합 회귀 / 단위 570 → **681** (+111) (M4 종합 evaluator NB-3 정정 — 668 표기 부정확) / KI 2 → 4 (KI-003 HIGH 첫 등록) / 50 PR 누적
  - M4-4 ✅ IndexingGate 신규 + privacyExclusions UserSetting 확장 (PR #141 + #142 hotfix, +36)
  - M4-1 ✅ IndexingService 신규 + IndexingGate/recordVisit/EmbeddingQueue 통합 (PR #143 + #145 hotfix, +21)
  - M4-3 ✅ DwellTracker + IndexedPageStoreSqlite.updateVisitDwell (PR #144, +21)
  - M4-2 ✅ AutoTagger + JSON schema 6 kind + freeform fallback (PR #146 + #148 hotfix, +23) / KI-003 HIGH + KI-004 MEDIUM 등록
  - M4-5 ✅ M4 통합 회귀 시나리오 1+3 + DwellTracker + Privacy 차단 매트릭스 (PR #147, +10)
- **M6** ✅ 완료 (4 PR — 단위 968 → **1068 (+100)** / **65 PR 누적**, evaluator + codex 병렬 평가 4회 정합)
  - T28 ✅ WorkspaceService + WorkspaceSidebar + preset 12종 (PR #162 + hotfix BLOCKING 1 + NEEDS_CHANGES 2 해소, +75)
  - T29 ✅ MemoryStatsPanel + MemoryService + memory IPC (PR #163 + hotfix broadcast 도입, +17)
  - T30 ✅ 시나리오 1·4 회귀 8 케이스 (PR #164 + codex NB 5 해소, +8)
  - T31 ✅ PRD v0.4.0 정식 발행 + KI 6건 등록 + Sprint 016 contract 시안 + 핸드오프 §11
- **M5** ✅ 완료 (8/8 PR — 단위 681 → **968 (+287)** / **61 PR 누적**, evaluator + codex 병렬 평가 11회 정합)
  - M5-1 ✅ Shortcut + SearchBar UI (PR #150 + 본 PR 내 hotfix, +61)
  - M5-2 ✅ TimeRangeParser (PR #151 + 본 PR 내 hotfix, +37)
  - M5-3a ✅ SearchService core (PR #154 + hotfix, +47) — schema vec0 distance_metric=cosine 명시 (codex BLOCKING)
  - M5-3b ✅ search IPC wiring (PR #155, +18) — 첫 클린 머지 (BLOCKING 0)
  - M5-4 ✅ SearchResultCard + 시간 시그널 + 매칭 발췌 (PR #156 + hotfix, +42) — unicode 길이 비보존 case-fold + 워크스페이스 컬러 후순위
  - M5-5 ✅ ChatService + PromptComposer + KI-003 BYOK wiring (PR #157 + hotfix, +28) — allowedProviders ['openai'] 디폴트
  - M5-6 ✅ ChatPanel + chat_meta 표 schema + chat IPC (PR #158 + hotfix, +27) — PRD §10.3.2 정합 schema 정정
  - M5-7 ✅ NoteService + note IPC (PR #159 + hotfix, +27) — selectedText guard + AutoTagger note FK 위반 차단 (KI-005 신규)
  - M5-8 ✅ ChatPanel App.tsx mount 분할 1편 (PR #160, +0) — 어댑터 일괄 제거 4종 (ProviderAdapter.translate / executeTranslateRequest / TranslationCache adapter / PageResultStore adapter / fetchImpl 통일) Sprint 016 위임

### 시나리오 cover 결과 (Sprint 015 M6 T30 완료)
- 시나리오 1 (학술): **100%** (S1-C1~C5 회귀 셋 5/5 통과 — tests/integration/scenarios/scenario-1-academic.test.ts)
- 시나리오 4 (우연재발견): **100%** (S4-C1~C3 회귀 셋 3/3 통과 — tests/integration/scenarios/scenario-4-recall.test.ts)
- 시나리오 2 (PM 경쟁) / 3 (학습): **Sprint 016 cover 예정** — 본 Sprint 015 범위 외 (contract AC-8 90%+ 목표는 Phase 1 종료 직전 측정)

## 최근 핸드오프

- [2026-05-21](./handoffs/2026-05-21.md) — **Sprint 016 M2 어댑터 일괄 제거 + M3 cookies partition + M4 백그라운드 번역·하이라이트 + M4 종결 (5/5 — T20 NoteHighlight DOM anchor 머지)** (M2 6 PR #198~#203 + M2 docs #204 + M3 4 PR #205~#208 + M3 docs #209 + **M4 4 PR #210 T21 / #211 T22 / #212 T19 / #213 T18 + M4 docs #214 + M4 T20 #215 + 본 docs PR = 누적 18 PR**) — **KI-002 (M2) + KI-005 (M4 T21) + KI-008 (M3) closed = 3 closed / KI-021 + KI-022 신규 (M3 NB) + KI-023~026 신규 (M4 T20 batch) = 6 신규** / 단위 1374 PASS / codex 사전 BLOCKING/NEEDS_CHANGES 6 (M2) + 7 (M3) + 8 (M4) + 1 (T20) + 3 (본 docs PR) = **25건 모두 본 PR 내 hotfix 흡수** + 학습 #18 **11번째 확증** + #19 정합, 다음 세션 **Sprint 016 M5 종합 (T23~T26)** 진입
- [2026-05-20](./handoffs/2026-05-20.md) — Sprint 016 M0 §1~§14 + §15 M1 T07+T08 시나리오 2·3 cover (#194/#195) + §16 T02-followup KI-006 실 구현 (#196/#197) 완료 — 시나리오 회귀 18/18 cover + KI-006 closed 후보 추가 (총 7종) + race-safe generation 패턴, 단위 1163 PASS, 자기 검증 루프 17회차 SUCCESS, 가드레일 G-018, 학습 8종 (#18 codex BLOCKING 본질적 설계 결함 차단), 다음 세션 M2 어댑터 일괄 제거 진입
- [2026-05-19](./handoffs/2026-05-19.md) — Sprint 015 M5 (§10) + M6 종합 (§11) 모두 완료 — Phase 1 종료 선언 + PRD v0.4.0 정식 발행 + Sprint 016 진입 권고
- [2026-05-18](./handoffs/2026-05-18.md) — Sprint 015 M4 5/5 + 2 hotfix 완료
- [2026-05-17](./handoffs/2026-05-17.md) — Sprint 015 M0~M1 완료
- [2026-05-16](./handoffs/2026-05-16.md) — 🔴 방향 전환 결정
- [2026-05-15](./handoffs/2026-05-15.md) — Sprint 003~014 진행 종합
- [2026-05-11](./handoffs/2026-05-11.md) — Sprint 001/002 진행 종합

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
