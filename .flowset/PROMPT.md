# FlowSet 운영 프롬프트 (FlowBrowser AI)

> 본 파일은 Claude Code 세션에서 FlowSet 운영 시 참조하는 프롬프트 가이드다.
> SessionStart hook이 본 파일과 `state.md`를 자동 주입한다.

## 운영 원칙

### 1. PRD가 SSOT (G-001)
- 요구사항 분쟁 시 PRD가 우선
- 본 디렉토리(`.flowset/`)는 PRD를 인용/참조만 가능
- PRD와 다른 사실 발견 시: PRD 갱신 → 다른 파일 동기화 (역방향 금지)

### 2. Phase 0 게이트 (G-002)
- Spike 5종 통과 전 본격 코드 착수 금지
- Spike 자체 PoC 코드는 허용
- 본격 코드 작업 요청 시: state.md의 Spike 진행 상태 확인 후 안내

### 3. 작업 종료 시 체크리스트
- [ ] 핸드오프 작성: `.flowset/handoffs/YYYY-MM-DD.md`
- [ ] state.md 갱신 (다음 작업 / Spike 상태 / 최근 갱신 일자)
- [ ] 새 가드레일 발견 시 guardrails.md 추가
- [ ] 새 도메인 개념 발견 시 ontology.md 추가
- [ ] PRD 갱신 필요한 사실 발견 시 docs/prd/ 해당 섹션 갱신

### 4. 매 응답 종료 시 상태 출력

```
---FLOWSET_STATUS---
PHASE: 0 | 1 | 2 | 3 | 4 | 5
SPIKE_ACTIVE: 01 | 02 | 03 | 04 | 05 | none
TASK: {한 줄 요약}
NEXT: {다음 작업}
HANDOFF_NEEDED: true | false
---END_FLOWSET_STATUS---
```

## 참조 우선순위 (충돌 시)

```
1. ~/.claude/rules/wi-*.md       (글로벌)
2. .claude/rules/project.md      (프로젝트별)
3. .flowset/guardrails.md        (누적 학습)
4. CLAUDE.md                     (프로젝트 정보)
5. PRD                           (요구사항 SSOT)
```

상위 규칙과 하위 규칙 충돌 시 **상위 우선**.

## 결과물 위치 (Phase 0)

| 결과물 | 위치 |
|---|---|
| Spike 1~5 결과 | `.flowset/specs/spike-NN-*.md` |
| 데일리 핸드오프 | `.flowset/handoffs/YYYY-MM-DD.md` |
| 도메인 개념 갱신 | `.flowset/ontology.md` |
| 새 가드레일 | `.flowset/guardrails.md` |
| 상태 갱신 | `.flowset/state.md` |
| evaluator 출력 | `.flowset/eval-results/` |

## Phase 1 진입 시 추가 활성

- `.flowset/contracts/sprint-NNN.md` — Sprint 계약 (수용 기준 + 검증 방법)
- `.flowset/ownership.json` — 팀별 소유 디렉토리
- `.claude/agents/lead-workflow.md` — 6단계 리드 워크플로우
- `.github/workflows/ci.yml` — lint / test 실질 활성
- Stop hooks 일부 (커밋 메시지 형식 등)

## evaluator 운영

- **Phase 0**: Spike 결과 평가용
  - 각 Spike 종료 시 결과를 evaluator에게 제출
  - 출력: `.flowset/eval-results/spike-NN-{date}.md`
  - 채점 기준: Spike 정의의 "판정 기준" 충족 여부
- **Phase 1+**: PR 평가용
  - Sprint 계약(contracts/sprint-NNN.md)의 수용 기준에 대한 채점
  - PR 머지 게이트로 활용

## 금지 사항 요약 (G-003)

다음은 어떤 경우에도 금지:

- ChatGPT 웹 세션 / 쿠키 재사용
- 비공식 토큰 추출 (Codex CLI 인증 우회 등)
- 사용량 제한 우회
- 사용자 계정 프록시화

위반 가능성 발견 시 즉시 Spike 1로 회귀 검토.
