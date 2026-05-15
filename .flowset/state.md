# FlowBrowser AI — 현재 상태

> 매 세션 시작 시 자동 주입되는 파일.
> 변경 사항은 데일리 핸드오프와 함께 갱신.

## 메타

- **Phase**: **1 (웹 번역 MVP)** — Sprint 001 / 002 종료, **Sprint 003 정의 완료 / M1 대기**
- **Sprint**: **003 정의 완료** (Sprint 002 Pass, 누적 37 Pass)
- **PROJECT_CLASS**: hybrid
- **PRD 버전**: v0.3 (2026-05-11, Phase 0 1차 조사 반영) — Sprint 003 M4에서 v0.3.1 패치 예정
- **최근 갱신**: 2026-05-15 (Sprint 003 정의 작성, contracts/sprint-003.md)

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

### Sprint 003 정의 (2026-05-15)

- 산출물: `.flowset/contracts/sprint-003.md`
- 목표: Sprint 002 잔여 보강 + Phase 1 MVP 페이지 전체 번역 + Privacy 정책 가시화
- 4 마일스톤 / 12 작업 / 7 AC / 2~3주
  - M1: LRU trim 테스트 + `pageWideBlock`/`BlockReason` enum 구조화
  - M2: PageNodeExtractor + 페이지 전체 번역 IPC + 패널 확장
  - M3: DomainPolicyStore + 도메인 화이트/블랙리스트 UI + 우선순위 적용
  - M4: PRD v0.3.1 패치 + 단위 테스트 + Sprint 종합 evaluator
- 다음 작업: Sprint 003 정의 PR 머지 후 M1 착수

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

- [2026-05-15](./handoffs/2026-05-15.md) — Sprint 003 정의
- [2026-05-11](./handoffs/2026-05-11.md) — Sprint 001/002 진행 종합

## 갱신 트리거

- Spike 시작 시: 미시작 → 진행중
- Spike 결과 도출 시: 진행중 → 완료
- 새 가드레일 발견 시: `guardrails.md` 갱신 + 본 파일 메모
- 새 도메인 개념 발견 시: `ontology.md` 갱신
- 매일 작업 종료 시: `handoffs/YYYY-MM-DD.md` 작성 + 본 파일 "최근 갱신" 동기화
