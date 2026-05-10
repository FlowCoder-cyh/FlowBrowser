# FlowBrowser AI — 프로젝트별 규칙

> 본 파일은 글로벌 규칙(`~/.claude/rules/wi-*.md`)에 추가되는 프로젝트별 규칙이다.
> 충돌 시 글로벌이 우선 (참조 우선순위 PROMPT.md 참조).

## 프로젝트 메타

- **이름**: FlowBrowser AI
- **PROJECT_CLASS**: hybrid
- **현재 Phase**: 0 (치명 가설 검증 Spike)
- **PRD 버전**: v0.2 (2026-05-11)
- **GitHub**: https://github.com/FlowCoder-cyh/FlowBrowser
- **언어**: 한국어 우선

## 프로젝트별 규칙

### P-001 PRD 우선
- 분쟁 시 PRD가 SSOT
- requirements.md / state.md / handoff는 PRD 인용·참조만
- PRD 변경 시 본 디렉토리 동기화 (역방향 금지)

### P-002 Phase 0 게이트
- Spike 5종 통과 전 본격 코드 착수 금지
- Spike PoC 코드는 `.flowset/specs/spike-NN-*/` 또는 별도 `spike/` 임시 디렉토리에서만 진행
- Phase 1 진입 결정은 evaluator 평가 + 사용자 승인 필수

### P-003 Spike 단위 작업
- Phase 0 작업은 Spike 단위로 분할
- 각 Spike는 별도 브랜치: `spike/WI-S0N-{kebab-name}`
- Spike 결과는 `.flowset/specs/spike-NN-*.md`에 누적

### P-004 보안 모듈 우선
- Privacy Filter / OS Keychain 위임이 다른 P0 기능보다 먼저 활성화돼야 함
- 둘 중 하나라도 미구현 상태에서 외부 Provider 호출 코드 작성 금지

### P-005 Spike 결과 PRD 반영
- 모든 Spike 종료 시 PRD v0.3 입력으로 즉시 정리
- 5종 모두 종료 시 PRD v0.3 발행 → Phase 1 sprint-001 시작

### P-006 핸드오프 필수
- 매 작업 종료 시 `.flowset/handoffs/YYYY-MM-DD.md` 작성
- 같은 날 추가 작업 시 같은 파일에 시간으로 구분하여 이어쓰기

### P-007 온톨로지 갱신
- 새 도메인 개념 / 정책 명사 / 외부 표준 발견 시 `.flowset/ontology.md`에 즉시 추가
- PRD 데이터 모델 변경 시 ontology와 동기화

## 디렉토리 소유 (Phase 0)

| 경로 | 변경 가능 주체 |
|---|---|
| `docs/prd/` | PRD 작업 시 |
| `.flowset/requirements.md` | PRD 동기화만 |
| `.flowset/state.md` | 작업 종료 시 |
| `.flowset/guardrails.md` | 새 패턴 발견 시 |
| `.flowset/ontology.md` | 새 개념 발견 시 |
| `.flowset/handoffs/YYYY-MM-DD.md` | 매 작업 종료 |
| `.flowset/specs/spike-NN-*.md` | 해당 Spike 진행 시 |
| `.claude/agents/*.md` | 평가자 정의 변경 시 |
| `.github/workflows/*.yml` | CI 활성화 단계 |

## 디렉토리 소유 (Phase 1+)

`.flowset/ownership.json` 활성화 시 팀별 소유 명시.

## 외부 도구 의존

- **Electron** (Phase 1+)
- **OpenAI API** (Phase 1+, BYOK 또는 Codex Login)
- **YouTube IFrame Player API** (Phase 2+)
- **OS Keychain APIs** (Phase 1+)

## 변경 이력

- 2026-05-11: P-001 ~ P-007 초기 등록
