# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **1 (웹 번역 MVP)** — Sprint 001~013 종료
- **Sprint**: **013 종료** (M4 종합 evaluator 진행 중)
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: **v0.3.11** (2026-05-15, Sprint 013 실측 반영)
- **최근 갱신**: 2026-05-15 (Sprint 013 M4 PRD 패치 + Sprint 종료)

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

### Sprint 013 결과 (PR #71~#75 진행 / 머지 예정)

- M1 (PR #72): ClosedTabHistory + Ctrl+Shift+T + tab:reopen IPC. evaluator Pass 15/0/0
- M2 (PR #73): ThumbnailDiskStore + write-through + 재시작 후 복원. evaluator Pass 16/0/0
- M3 (PR #74): viewport 우측 경계 clamp + formatTabLabel 순수 함수 추출. evaluator Pass 12/0/0
- M4 (현재 브랜치): PRD v0.3.11 + Sprint 종합
- 누적 단위 테스트: 287 → 307 (+20, AC-4 ≥ 300 충족 +7)
- PRD v0.3.11 발행
- commit-check CI 5 PR 모두 success (G-009 NNN 한 분절 7 Sprint 연속)

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

## 최근 핸드오프

- [2026-05-15](./handoffs/2026-05-15.md) — Sprint 003~009 + 010 정의
- [2026-05-11](./handoffs/2026-05-11.md) — Sprint 001/002 진행 종합

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
