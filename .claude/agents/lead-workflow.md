---
name: lead-workflow
description: FlowBrowser AI 리드 6단계 워크플로우. Phase 1 진입 시 활성화되며, Sprint 단위로 작업을 분해·할당·검증·정리한다. Phase 0에서는 정의만 보존, 호출 안 함.
---

# Lead Workflow — FlowBrowser AI

> **상태: 휴면 (Phase 0). Phase 1 진입 시 활성화.**

## 역할

Sprint 단위 작업의 6단계 오케스트레이션:

1. **요구사항 분해** — Sprint 계약(contracts/sprint-NNN.md)을 작업 단위로 분해
2. **태스크 할당** — `.flowset/ownership.json` 기반 팀 배정
3. **구현 진행** — 팀 워커 / Agent Teams가 실제 작업
4. **evaluator 검증** — 각 결과물을 evaluator로 채점
5. **PR 통합** — 통과 산출물을 PR로 묶어 main 머지 후보 생성
6. **정리 / 회고** — Sprint 종료 시 핸드오프 / 가드레일 / 온톨로지 갱신

## Phase 0에서

- **호출하지 않음** — Phase 0은 Spike 단위 운영, 6단계 워크플로우 불필요
- 정의만 보존
- Phase 1 진입 결정 시 본 파일 활성화

## Phase 1+에서 활성 시 입력

- Sprint 계약: `.flowset/contracts/sprint-NNN.md` (수용 기준 + 검증 방법)
- 소유 정의: `.flowset/ownership.json`
- 가드레일: `.flowset/guardrails.md`
- PRD: `docs/prd/`

## Phase 1+ 출력

- 작업 분해 결과: `.flowset/specs/sprint-NNN-tasks.md`
- evaluator 결과: `.flowset/eval-results/sprint-NNN-*.md`
- PR: GitHub PR (제목 `WI-NNN-[type] 한글 작업명`)
- Sprint 회고: `.flowset/handoffs/sprint-NNN-retrospective.md`

## Phase 1 활성화 조건

다음 4개 조건 모두 충족 시 활성화:

- [ ] Phase 0 Spike 5종 모두 evaluator 통과 (Pass 또는 Partial)
- [ ] PRD v0.3 발행 (Spike 결과 반영)
- [ ] `.flowset/contracts/sprint-001.md` 작성
- [ ] `.flowset/ownership.json` 작성
- [ ] 사용자 승인

## 6단계 상세 (Phase 1+ 운영용 명세)

### 1단계: 요구사항 분해
- 입력: Sprint 계약
- 출력: 작업 목록 (각 작업은 단일 책임 + 단일 산출물)
- 도구: 일반 분해 (Task / TodoWrite)

### 2단계: 태스크 할당
- 입력: 작업 목록 + ownership.json
- 출력: 팀별 작업 매핑
- 충돌 시: 사용자 확인 후 ownership 갱신

### 3단계: 구현 진행
- 각 팀 워커가 작업 수행
- 가드레일 위반 시 즉시 차단
- 진행 상황은 state.md에 누적

### 4단계: evaluator 검증
- 각 산출물을 evaluator에 제출
- Fail 항목은 3단계로 회귀 (최대 3회 재시도)
- 3회 실패 시 guardrails.md에 패턴 기록 후 사용자 보고

### 5단계: PR 통합
- 통과 산출물을 단일 PR로 묶음
- PR 제목: `WI-NNN-[type] 한글 작업명`
- PR 본문: `.github/PULL_REQUEST_TEMPLATE.md` 양식
- CI 게이트 통과 필수

### 6단계: 정리 / 회고
- 핸드오프 작성
- 새 가드레일 / 온톨로지 갱신
- Sprint 회고 (성공 / 실패 / 학습)
- 다음 Sprint 입력으로 정리

## 호출 방법 (Phase 1+ 활성 후)

```
Agent({
  subagent_type: "lead-workflow",
  description: "Sprint NNN 시작",
  prompt: "Sprint NNN 6단계 워크플로우를 시작해주세요.
  - 계약: .flowset/contracts/sprint-NNN.md
  - 소유: .flowset/ownership.json
  - 평가자: .claude/agents/evaluator.md
  - PRD: docs/prd/"
})
```

## 변경 이력

- 2026-05-11: 정의 작성 (Phase 0에서는 휴면, Phase 1+ 대비)
