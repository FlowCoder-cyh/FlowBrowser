# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **1 (웹 번역 MVP)** — Sprint 001 M1 진행 중
- **Sprint**: 002 / M3 (Paragraph + 우측 패널) — evaluator Pass 13/0/0
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: v0.3 (2026-05-11, Phase 0 1차 조사 반영)
- **최근 갱신**: 2026-05-11 (Sprint 002 정의 작성, 통과 기준 Pass ≥ 8 적용)

## 현재 작업

- Sprint 001 M1·M2·M3 머지 완료
- M4 산출물: vitest.config.ts + tests/unit/ (6 파일 47 테스트) + CI ci.yml 활성화 + ontology 수동 승인 토큰 정책 명시
- 자동 검증: typecheck PASS / test 47/47 PASS / build PASS
- Sprint 종합 evaluator: **Pass (조건부 — 수동 QA 잔여)**
- AC: AC-2 Pass / AC-1,3,4,5,6,7 Partial (수동 QA / UI / ESLint CI 게이트 잔여)
- 다음: M4 PR auto-merge → Sprint 002 정의 또는 사용자 수동 QA 결과 대기

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

- [2026-05-11](./handoffs/2026-05-11.md)

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
