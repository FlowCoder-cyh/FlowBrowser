# Sprint 018 — Sprint 017 carryover + Phase 3 종료 검토 + MVP 진입

> **상태: 시안 (2026-05-23 — Sprint 017 partial closure 박힌 후 작성)**
> Phase: 3 (Sprint 017 carryover + Phase 3 종료 검토)
> 시작 예정: 사용자 명시 진입 후 (M0 T01~T02 mini-milestone β PR B/C 는 사용자 결정 불요 — codex 019e5161 §1 권고 정합. M1 T03/T04 = T19/Schema v06 사용자 명시 선택 후 진입)
> 목표 기간: **3~4주 (18~25일)** — Sprint 017 contract 정합 구조
> 출처: Sprint 017 contract §10 partial closure 박힌 후 codex 019e5161 §4 권고 path 정합

## 0. 사전 조건

- [x] Sprint 017 partial closure 박힘 (M0 5/5 + M1 4/4 + M2 4/4 + M3 3/4 + M4 1/4 + M5 대체 산출물 — G-021 + G-022 + mini-milestone β D)
- [x] M5 가드레일 신규 (G-021 + G-022) + mini-milestone β D PR (verify-pr-body.mjs + check-finalization-intent.mjs) 박힘
- [x] 학습 #8 위반 4건 모두 가드레일 본문 + 자동화 path 박힘
- [ ] T19 옵션 A/B/C/D 사용자 명시 선택 (Sprint 018 진입 시 1순위)
- [ ] Schema v06 spec 재진입 결정 (사용자 명시 선택 — 복원 / 재작성 / 폐기)
- [ ] PR #244 머지 시점 단위 회귀 1760 PASS 정합

## 1. Sprint 목표

**Sprint 017 carryover 8 항목 처리 + Phase 3 종료 검토 + MVP 진입**:

1. **T17 carryover** — 로컬 임베딩 통합 (IndexingService 가 OpenAI 또는 로컬 임베딩 선택)
2. **T19 carryover** — Notion Export (사용자 명시 선택 후 진입)
3. **T20 carryover** — R3-B UserLevelEstimator 실 학습 (학습 데이터 셋 박힌 후)
4. **T21 carryover** — 워크스페이스 공유 설계 시안
5. **T22~T26 carryover** — 단위 테스트 + PRD v0.5.0 + 핸드오프 + Sprint 019 시안 + Phase 3 종료 검토
6. **Schema v06 spec 재진입** — 사용자 명시 선택 후 진입
7. **mini-milestone β PR B** — G-022 transcript source validation + advisory SessionStart hook (codex 019e5161 §4 정합)
8. **mini-milestone β PR C** — G-022 blocking 전환 (transcript source 안정성 검증 후)

**codex 019e5161 권고 path 정합 구조**:
- 사용자 결정 대기 항목 (T19/Schema v06) 명시 선택 후 진입
- mini-milestone β = source validation → advisory → blocking 3 PR 순서
- M5 종합 evaluator + PRD v0.5.0 발행 + Sprint 019 시안 박는 path 박힘

## 2. 범위

### 포함 (구체화 — M0~M2)

| # | 작업 | 산출물 | carryover 출처 |
|---|---|---|---|
| **M0 mini-milestone β PR B + C (S018-T01~T02)** | | | |
| S018-T01 | mini-milestone β PR B — transcript source validation + advisory SessionStart hook (transcript history 직접 읽기 path 박음 + non-blocking advisory 주입) | `.flowset/hooks/session-start.mjs` 확장 + `.flowset/scripts/check-finalization-intent.mjs` advisory 통합 + 회귀 | Sprint 017 §10.3 CO-7 |
| S018-T02 | mini-milestone β PR C — G-022 blocking 전환 (exit 2 기반 차단 + transcript source 실패 시 정책 박음) | `.flowset/hooks/session-start.mjs` blocking path + 회귀 + 사용자 메모리 갱신 | S018-T01 후 |
| **M1 T19 / Schema v06 사용자 결정 후 진입 (S018-T03~T04)** | | | |
| S018-T03 | T19 carryover — Notion Export (사용자 선택 후 진입 — A/B/C/D 옵션 매트릭스 정합) | 사용자 선택 결과에 따라 분기 (A: @notionhq/client / B: raw fetch / C: spec only / D: skip) | Sprint 017 §10.3 CO-2 |
| S018-T04 | Schema v06 spec 재진입 — PR #241 close 된 산출물 (+269, B3+B2 결정 + sketch + T17a~e 분해) 복원 또는 재작성 | `.flowset/specs/sprint-018-schema-v06-spec.md` (또는 사용자 선택 path) | Sprint 017 §10.3 CO-6 |
| **M2 T17 / T20 / T21 spike (S018-T05~T07)** | | | |
| S018-T05 | T17 carryover — 로컬 임베딩 통합 (IndexingService 분기) | `src/main/IndexingService.ts` wiring + 단위 회귀 | Sprint 017 §10.3 CO-1, T15 spike 후 dependency 승인 |
| S018-T06 | T20 carryover — R3-B UserLevelEstimator 실 학습 (학습 데이터 셋 박힘 후) | `src/main/UserLevelEstimator.ts` 실 학습 로직 | Sprint 017 §10.3 CO-3 |
| S018-T07 | T21 carryover — 워크스페이스 공유 설계 시안 | `.flowset/specs/v05-collab-spike.md` 시안 | Sprint 017 §10.3 CO-4 |

### 포함 (헤더 + 진입 조건 — M3~M5)

| # | 작업 | 산출물 헤더 | 진입 조건 |
|---|---|---|---|
| **M3 단위 회귀 + 시나리오 cover (S018-T08~T09)** | | | |
| S018-T08 | T22 carryover — 단위 테스트 회귀 셋 + 신규 컴포넌트 cover | `tests/**/*.test.ts` (목표 +80~120) | M0~M2 머지 후 |
| S018-T09 | 시나리오 1·2·3·4 cover 90%+ 검증 — Sprint 016 M0 T07/T08 시나리오 회귀 + 본 Sprint 신규 회귀 | `tests/integration/scenarios/*.test.ts` | T08 후 |
| **M4 PRD v0.5.0 발행 + Phase 3 종료 검토 (S018-T10~T11)** | | | |
| S018-T10 | T23 carryover — PRD v0.5.0 발행 (Phase 3 진입 + 로컬 LLM + Notion Export + Schema v06 메타) | `docs/prd/00_change_history.md` + 신규 §13 로컬 LLM + §11.6 Notion Export | T09 후 + Schema v06 결정 박힌 후 |
| S018-T11 | T26 carryover — Phase 3 종료 검토 (MVP 진입 가능 여부 평가) | `.flowset/specs/phase3-exit-checklist.md` | T10 후 |
| **M5 Sprint 종합 + Sprint 019 시안 (S018-T12~T13)** | | | |
| S018-T12 | T24 carryover — Sprint 018 종합 evaluator + 핸드오프 + state/known-issues 갱신 | `.flowset/handoffs/YYYY-MM-DD.md` | T11 후 |
| S018-T13 | T25 carryover — Sprint 019 contract 시안 (MVP 최종 딥검증 + Phase 3 종료 박힌 후) | `.flowset/contracts/sprint-019.md` | T12 후 |

### 제외 (Sprint 019 / Phase 4 / MVP)

- MVP 최종 딥검증 시연 (시나리오 4개 100% + 사용자 1주 실사용) — Sprint 019+
- 모바일 동기화 — Phase 4 또는 별도 product line
- 클라우드 backup / 협업 실시간 — Phase 4
- 추가 provider (Anthropic / xAI / Mistral BYOK) — Phase 4

## 3. 수용 기준

### AC-1 mini-milestone β PR B + C (S018-T01~T02)

- transcript source discovery + 경로 탐색 + 최신 user utterance 추출 path 박힘
- SessionStart hook advisory 주입 (non-blocking) — Sprint 018 진입 시 검출 신호 출력 + 사용자 발화 표시
- blocking 전환 시 exit 2 + 사용자 메모리 정합 path 박음 (false positive 0건 검증)
- 학습 #8 5번째 위반 차단 자동화 path 검증 (실측 시나리오 회귀)

### AC-2 T19 / Schema v06 사용자 결정 후 진입 (S018-T03~T04)

- T19 사용자 명시 선택 후 분기 진입 (A/B/C/D)
- Schema v06 spec 재진입 결정 박힌 후 산출물 (복원 또는 재작성)
- G-022 §허용 패턴 정합 진입 (사용자 명시 선택 박힘 시점에 진입)

### AC-3 T17 / T20 / T21 spike (S018-T05~T07)

- T17 로컬 임베딩 통합 — dependency 승인 후 IndexingService 분기 동작
- T20 R3-B 실 학습 PoC (학습 데이터 셋 박힘 후 진행, 단위 회귀)
- T21 워크스페이스 공유 설계 시안 (PRD §11 공유 path 정합)

### AC-4 단위 회귀 + 시나리오 cover (S018-T08~T09)

- 누적 단위 테스트 ≥ 1840 (Sprint 018 +80~120)
- 시나리오 1·2·3·4 cover 90%+ 유지 (회귀 0)

### AC-5 PRD v0.5.0 발행 + Phase 3 종료 검토 (S018-T10~T11)

- PRD v0.5.0 정식 발행 (Phase 3 진입 + 로컬 LLM + Notion Export + Schema v06 메타)
- Phase 3 종료 체크리스트 박음 (MVP 진입 가능 여부 평가)

### AC-6 통과 기준 (S018-T12~T13)

- 각 M evaluator Pass + Pass ≥ 8
- lint / typecheck / test / build 모두 PASS
- commit-check CI 모든 PR success (G-009 NNN 한 분절 16 Sprint 연속)
- 누적 단위 테스트 ≥ 1840
- 시나리오 회귀 cover 유지
- KI 잔여 매트릭스 정합 (HIGH 0 / MEDIUM 0 / LOW ≤ 5)
- Sprint 019 contract 시안 작성 (MVP 최종 딥검증 + Phase 3 종료)

## 4. 마일스톤

| M | 산출물 | 작업 | 기간 |
|---|---|---|---|
| **M0** | mini-milestone β PR B + C (advisory → blocking 전환) | T01~T02 | 4~5일 |
| **M1** | T19 / Schema v06 사용자 결정 후 진입 | T03~T04 | 5~6일 (사용자 결정 후) |
| **M2** | T17 / T20 / T21 spike | T05~T07 | 5~6일 |
| **M3** | 단위 회귀 + 시나리오 cover | T08~T09 | 3~4일 |
| **M4** | PRD v0.5.0 발행 + Phase 3 종료 검토 | T10~T11 | 3~4일 |
| **M5** | Sprint 종합 + Sprint 019 시안 | T12~T13 | 2~3일 |

총 22~28일 (3.5~4주 보수 추정).

## 5. 가드레일 적용

### 기존
- **G-001~G-018** 모두 활성
- **G-021** Docs PR dual review 실 호출 강제 (Sprint 017 M5)
- **G-022** 사용자 마무리 의도 후 진입 차단 (Sprint 017 M5)

### 자동 강제 path (mini-milestone β 박힘)
- **G-018 자동 대조** (`.flowset/scripts/verify-pr-body.mjs`) — PR body 산출물 매트릭스 vs `git diff --numstat` 실측 정합 검증
- **G-021 증거 regex** — evaluator Pass/Partial/Fail 카운트 + codex thread ID UUID v7 + BLOCKING/NEEDS_CHANGES/NOTABLE 카운트 검증
- **G-022 advisory helper** (`.flowset/scripts/check-finalization-intent.mjs`) — 본 Sprint 018 M0 에서 blocking 전환 (T01~T02)

### 신규 (본 Sprint 활성화 시안 — Sprint 019 진입 시 정식화)
- **G-019 [carryover]** perf bench infra 정량 임계 매트릭스 강제 (Sprint 017 carryover, M5 종합 evaluator 시점)
- **G-020 [carryover]** 외부 dependency 추가 별도 PR + 사용자 승인 (Sprint 017 carryover, T03/T05 진입 전 정합)

## 6. evaluator 통과 기준

각 M evaluator Pass + Pass ≥ 8.

특히 M0 (mini-milestone β PR B + C) 는 false positive 0 + transcript source 안정성 검증 가중.
M1 (T19/Schema v06) 는 사용자 명시 선택 후 진입 — G-022 정합 path 검증.

## 7. 리스크 / 미지수

1. **transcript source 안정성** (M0 T01) — `~/.claude/projects/<project>/conversations/*.jsonl` 파일 양식 변경 / 권한 / 위치 변경 가능성. 실패 시 fallback (advisory only) path 박음.
2. **사용자 결정 대기 항목 (T19/Schema v06)** — 사용자 명시 선택 없으면 본 Sprint 018 진입 차단. AskUserQuestion 박는 시점 사용자 환경 정합 필요.
3. **R3-B 학습 데이터 셋 부재** — T20 mock 교체는 학습 데이터 셋 박힘 후 진행. 부재 시 carryover Sprint 019.
4. **PRD v0.5.0 발행 시점** — T17 + T19 + T20 carryover 박힌 후 (M0~M2 머지 완료 후). M3~M5 박힌 후 발행.

## 8. Sprint 종료 후 다음 (Sprint 019 / MVP 후보)

1. **MVP 최종 딥검증** — 시나리오 4개 100% + 사용자 1주 실사용
2. **Phase 3 종료 선언** — Phase 4 진입 결정
3. **모바일 / 클라우드 / 협업** — Phase 4
4. **추가 provider** — Anthropic / xAI / Mistral (BYOK)

## 9. 참조

- 시안 작성 시점: Sprint 017 partial closure 박힌 후 (2026-05-23)
- 방향 SSOT: `.flowset/specs/v04-direction.md` (Sprint 015 박힘)
- Sprint 017 partial closure: `.flowset/contracts/sprint-017.md` §10
- 최신 핸드오프: `.flowset/handoffs/2026-05-24.md` §12 (partial closure 박힘)
- 가드레일: G-001~G-018 + G-021/G-022 (Sprint 017 M5) + G-019/G-020 carryover (시안 시점 정식화)
- Known Issues: `.flowset/known-issues.md` — Sprint 017 partial closure 시점 잔여 9 (HIGH 0 / MEDIUM 0 / LOW 9)
- codex 사전 협의:
  - `019e5161-fe42-70c1-b216-fbc96fc5c86c` — Sprint 017 partial closure 1순위 권고 + mini-milestone β PR B/C path 분리 권고
  - `019e5136-0292-7731-a853-6fa3224f612c` — mini-milestone β D 1순위 권고 (Sprint 017 M5)
- 외부 참조 (M1 T03 진입 전): Notion API https://developers.notion.com/
- 외부 참조 (M2 T05 진입 전): Ollama https://ollama.com/ + sentence-transformers https://huggingface.co/sentence-transformers

## 변경 이력

- 2026-05-23: Sprint 018 contract 시안 작성 (Sprint 017 partial closure §10 박힌 후). Sprint 017 carryover 8 항목 (T17 / T19 / T20 / T21 / T22~T26 / Schema v06 / mini-milestone β PR B + C / PRD v0.5.0) 매트릭스 박음. M0~M5 + T01~T13 13 작업, 6 마일스톤. AC-1~AC-6 6 수용 기준. codex 019e5161 권고 path 정합 (PR A docs/meta → PR B source validation → PR C blocking). G-019/G-020 carryover 시안.
