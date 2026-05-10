# FlowBrowser AI

영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저.

## 현재 상태
**Phase 0 — 치명 가설 검증 Spike 단계**
세부 상태는 `.flowset/state.md` 참조 (SessionStart hook이 자동 주입).

## 프로젝트 구조

| 경로 | 용도 |
|---|---|
| `docs/prd/` | PRD v0.2 (13개 섹션 분할) |
| `archive/` | 이전 버전 PRD (v0.1 / v0.2 통합본) |
| `.flowset/` | FlowSet v4.0.4 운영 디렉토리 |
| `.claude/` | Claude Code 설정 (rules / agents / settings) |
| `.github/` | CI/CD (Phase 1+ 활성) |

## FlowSet v4.0.4 적용

- **PROJECT_CLASS**: `hybrid` (PRD/문서가 코드만큼 핵심 자산)
- **Lite 정의**: 풀 v4.0.4 골격 + Phase별 점진 활성화 (공식 Lite 모드 부재)

### 핵심 파일

- `.flowset/requirements.md` — 요구사항 SSOT (PRD 링크)
- `.flowset/state.md` — 현재 Phase / Sprint / 다음 작업
- `.flowset/guardrails.md` — 누적 규칙 (G-NNN)
- `.flowset/ontology.md` — 도메인 사전 + 관계
- `.flowset/handoffs/` — 데일리 핸드오프
- `.flowset/specs/` — Spike 결과 / 기술 스펙 누적
- `.claude/agents/evaluator.md` — 평가자 (Spike·PR 모두)
- `.claude/agents/lead-workflow.md` — 6단계 리드 (Phase 1+ 활성)

### 점진 활성화

| Phase | 활성 | 휴면 |
|---|---|---|
| 0 (현재) | requirements / state / guardrails / handoffs / ontology / specs / evaluator / commit-check | contracts / ownership / lead-workflow / CI lint+test / Stop hooks B1~B7 |
| 1+ | + contracts / ownership / lead-workflow / CI lint+test | (점진 강화) |

## 개발 원칙

- **한국어 문서 우선** (코드 식별자/표준 영어 표현은 그대로)
- **추측 금지** — 검증 후 사실만 전달, 메모리는 힌트일 뿐
- **Phase 0 게이트** — Spike 5종 통과 전 본격 코드 착수 보류 (G-002)
- **인증 금지선** — ChatGPT 웹 쿠키 / 비공식 토큰 / 사용량 우회 / 계정 프록시화 절대 금지 (G-003)
- **Privacy Filter는 P0 기능** — 정책이 아니라 기능 모듈 (G-004)
- **OS Keychain 위임** — secret 자체를 앱이 보관하지 않음 (G-005)
- **main 직접 push 금지** — 첫 셋업 커밋만 예외, 이후 PR 강제 (G-007)
- **커밋 형식** — `WI-NNN-[type] 한글 작업명` (G-009)
- **UTF-8 / LF** — 모든 텍스트 파일 (G-010)

## 참조 우선순위 (충돌 시)

```
1. ~/.claude/rules/wi-*.md       (글로벌)
2. .claude/rules/project.md      (프로젝트별)
3. .flowset/guardrails.md        (누적 학습)
4. CLAUDE.md                     (본 파일)
5. PRD                           (요구사항 SSOT)
```

상위 규칙과 하위 규칙 충돌 시 상위를 따른다.

## 진입점

- [PRD 목차](./docs/prd/README.md)
- [Phase 0 Spike 계획](./docs/prd/09_roadmap_phase0.md)
- [현재 상태](./.flowset/state.md)
- [최신 핸드오프](./.flowset/handoffs/)
