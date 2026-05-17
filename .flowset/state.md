# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **1** (AI 콘텐츠 메모리 + 워크스페이스 베이스 인프라, Sprint 015 진행 중)
- **Sprint**: **015 M0~M1 완료** (M2 진입 대기 — T07~T10 폐기 + 일반화 PR 8개)
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: **v0.4.0 본문 완성** (19 섹션, 약 5,200+ lines — 정식 release tag 는 Sprint 015 M6 종료 시점)
- **최근 갱신**: 2026-05-17 (M0~M1 종합 evaluator Pass 6/2/0 + PR b10.1 핫픽스 4건 정정)
- **다음 세션 진입점**: `.flowset/handoffs/2026-05-17.md` (M1 종합) + `.flowset/contracts/sprint-015.md` §2 T07~T10 (M2 범위)

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

## 🟢 Sprint 015 M0~M1 완료 (2026-05-17)

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
- **M0** ✅ (T01~T04 사전 분석, PR #98~#103 진행 완료)
- **M1** ✅ (PRD v0.4.0 19 섹션 본문 작성, PR #104~#120 + b10.1 핫픽스)
- **M2** (다음) — 폐기 + 일반화 (PR 8개)
  - M2-1 AIResponseCache 신규 + TranslationCache 어댑터 (feature flag `flowbrowser.v04.enabled` 도입)
  - M2-2 IndexedPageStore base + PageResultStore 어댑터
  - M2-3 SummarizationPlanner DEPRECATE
  - M2-4 translate:summarize-* IPC 폐기
  - M2-5 translate:paragraphs/page IPC 폐기
  - M2-6 translate:render/restore IPC 폐기
  - M2-7 ai/index.ts + types.ts PARTIAL (ProviderAdapter chat/embed 메서드 추가)
  - M2-8 TranslationCache.test → AIResponseCache.test 재작성
- **M3** (4~5일): IndexedPageStore (SQLite + sqlite-vec + 본문 캐시) + 임베딩 + 데이터 마이그레이션
- **M4** (3~4일): 페이지 인덱싱 hook + 재방문 정책 + AI 자동 태깅 + dwell + Privacy 차단
- **M5** (4~5일): 검색바 (Cmd+K) + AI 채팅 패널 (ChatPanel) + 노트 + 수준 옵션
- **M6** (2~3일): 워크스페이스 사이드바 + 메모리 통계 UI + Sprint 종합 핸드오프

### 시나리오 cover 목표
- 시나리오 1 (학술) / 4 (우연재발견): **100%** (Phase 1만으로)
- 시나리오 2 (PM 경쟁) / 3 (학습): **90%+** (Phase 1만으로, Notion Export = Phase 3)

## 최근 핸드오프

- **[2026-05-17](./handoffs/2026-05-17.md) — Sprint 015 M0~M1 완료 + M2 진입 준비 (필독)**
- [2026-05-16](./handoffs/2026-05-16.md) — 🔴 방향 전환 결정
- [2026-05-15](./handoffs/2026-05-15.md) — Sprint 003~014 진행 종합
- [2026-05-11](./handoffs/2026-05-11.md) — Sprint 001/002 진행 종합

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
