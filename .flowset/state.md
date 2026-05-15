# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **방향 전환 결정** — Phase 1 (실시간 번역) 효용 한계 확인 → AI 콘텐츠 메모리 + 워크스페이스 브라우저로 전환
- **Sprint**: **014 종료 + 15회 핫픽스 + 방향 전환 결정**. Sprint 015 진입 대기 (PRD v0.4 작성부터)
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: **v0.3.12** (구버전, **v0.4 신규 작성 예정** — 방향 전환)
- **최근 갱신**: 2026-05-16 (방향 전환 결정 핸드오프 작성)
- **다음 세션 진입점**: `.flowset/handoffs/2026-05-16.md` 필독

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

## 최근 핸드오프

- **[2026-05-16](./handoffs/2026-05-16.md) — 🔴 방향 전환 결정 (필독)**
- [2026-05-15](./handoffs/2026-05-15.md) — Sprint 003~014 진행 종합
- [2026-05-11](./handoffs/2026-05-11.md) — Sprint 001/002 진행 종합

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
