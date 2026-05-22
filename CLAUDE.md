# FlowBrowser AI

본 페이지를 자동 기억하면서, 프로젝트별로 환경이 격리되는 AI 리서치 브라우저.

> 2026-05-16 방향 전환 — 영어 웹/영상 번역 (v0.3) → AI 콘텐츠 메모리 + 워크스페이스 브라우저 (v0.4). 결정 38건 + 다층 갱신 14건은 `.flowset/specs/v04-direction.md`.

## 현재 상태
**Phase 1 형식적 종료 + Sprint 016 M0 진행 중** (PRD v0.4.0 정식 발행, 누적 단위 1101 / 76 PR 머지).
세부 상태는 `.flowset/state.md` 참조. SessionStart hook 의 자동 주입 강화는 Sprint 016 mini-milestone β 예정 (현재 echo 1줄만 작동, 자동화 부재가 본 세션 G-006 위반 2회 + 학습 #8 위반 1회 재현의 직접 원인).

## 프로젝트 구조

| 경로 | 용도 |
|---|---|
| `docs/prd/` | PRD v0.4.0 (19 섹션 분할) |
| `archive/` | 이전 버전 PRD (v0.1 / v0.2 통합본 + v0.3 13 섹션) |
| `.flowset/` | FlowSet v4.0.4 운영 디렉토리 |
| `.claude/` | Claude Code 설정 (rules / agents / settings) |
| `.github/` | CI/CD (typecheck + test + build + 커밋 메시지 검증 + macOS sqlite-vec PoC, 추가 hook 강화는 mini-milestone β 예정) |

## FlowSet v4.0.4 적용

- **PROJECT_CLASS**: `hybrid` (PRD/문서가 코드만큼 핵심 자산)
- **Lite 정의**: 풀 v4.0.4 골격 + Phase별 점진 활성화 (공식 Lite 모드 부재)

### 핵심 파일

- `.flowset/requirements.md` — 요구사항 SSOT (PRD 링크)
- `.flowset/state.md` — 현재 Phase / Sprint / 다음 작업
- `.flowset/guardrails.md` — 누적 규칙 (G-NNN)
- `.flowset/ontology.md` — 도메인 사전 + 관계
- `.flowset/known-issues.md` — KI-NNN 본문 + 잔여/해소 통계 (Sprint 015 도입)
- `.flowset/contracts/sprint-NNN.md` — Sprint 별 수용 기준 + 작업 매트릭스 (Sprint 015 도입)
- `.flowset/handoffs/` — 데일리 핸드오프
- `.flowset/specs/` — Spike 결과 + v0.4 방향 SSOT + 사전 분석 매트릭스 + perf bench 보고서
- `.claude/agents/evaluator.md` — 평가자 (Spike·PR 모두)
- `.claude/agents/lead-workflow.md` — 6단계 리드 (Phase 1+ 활성, hook 강제 path 는 mini-milestone β 예정)

### 점진 활성화 (실측 기반)

| Phase | 활성 | 휴면 / 진행 중 |
|---|---|---|
| 0 (Sprint 0) | requirements / state / guardrails / handoffs / ontology / specs / evaluator | contracts / ownership / lead-workflow / CI lint+test |
| 1 (Sprint 001~014) | + commit-check / CI typecheck+test+build / branch protection | Stop hook 자동화 / dual review 자동 강제 |
| 1 종료 → Sprint 015~ | + contracts / known-issues / Sprint 015 신규 가드레일 (G-012/G-013/G-014) | ownership.json 활용 hook / lead-workflow 강제 path / dual review 자동 게이트 (mini-milestone β 예정) |

## 개발 원칙

- **한국어 문서 우선** (코드 식별자/표준 영어 표현은 그대로)
- **추측 금지** (G-006) — 검증 후 사실만 전달, 메모리는 힌트일 뿐. schema description 예시 ≠ 환경 디폴트 (본 세션 학습 — `gpt-5.2-codex` 추측 후 실제는 config.toml `gpt-5.5` 사례)
- **인증 금지선** — ChatGPT 웹 쿠키 / 비공식 토큰 / 사용량 우회 / 계정 프록시화 절대 금지 (G-003)
- **Privacy Filter는 P0 기능** — 정책이 아니라 기능 모듈 (G-004). 자동 인덱싱 경로는 별도 `IndexingGate` 적용 (PRD §8.6)
- **OS Keychain 위임** — secret 자체를 앱이 보관하지 않음 (G-005)
- **main 직접 push 금지** — 첫 셋업 커밋만 예외, 이후 PR 강제 (G-007)
- **커밋 형식** — `WI-NNN-[type] 한글 작업명` (G-009 — NNN 한 분절 강제, 14 Sprint 연속)
- **UTF-8 / LF** — 모든 텍스트 파일 (G-010)
- **v0.4 SSOT** — `.flowset/specs/v04-direction.md` 우선 갱신, 역방향 금지 (G-012, M1 활성)
- **단계별 PR 전략** — (1) 신규 모듈 (2) 사용처 적용 (3) 폐기 순서 (G-013, M2 활성)
- **데이터 마이그레이션 dry-run + 자동 백업** — `<userDataDir>/backup/v03/<ISO_ts>/` (G-014, M3 활성)
- **dual review 표준** — 매 PR / 핸드오프 / Milestone 종료 시점 evaluator + codex 병렬 호출 강제 (`feedback_dual_review` 사용자 메모리). docs PR 도 예외 없음 (PR #174 위반 후 학습 #8 박음, PR #178 시도 위반 후 mini-milestone α 흡수, **Sprint 017 본 세션 PR #234/#237/#239 위반 3건 후 G-021 정식화** — 실 호출 증거 명시 강제: evaluator Pass/Partial/Fail 카운트 + codex thread ID `019eXXXX-...`)
- **사용자 마무리 의도 후 작업 진입 금지** (G-022, 메타 학습) — 사용자 발화에 종결/지연/핸드오프/추궁 신호 표현 ("세션 종료" / "다음 세션" / "핸드오프 작성" / "오래걸리냐") 박힘 시 사용자 명시 선택 (PR 생성 / 종료 / 다른 작업) 박힐 때까지 새 작업 진입 금지. codex 협의 권고 = 진입 시점 path 권고일 뿐 — 진입 _여부_ 결정 자체는 사용자 명시 선택 후만 박힘. handoff §다음 진입점 박힘 ≠ 본 세션 진입 박음 권고 (G-021 직후 본 세션 PR #241 임의 진입 회고 박음)

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

- [PRD 목차](./docs/prd/README.md) — v0.4.0 19 섹션
- [현재 상태](./.flowset/state.md) — Phase / Sprint / 진입점
- [최신 핸드오프](./.flowset/handoffs/) — 일자별 작업 종결 기록
- [v0.4 방향 SSOT](./.flowset/specs/v04-direction.md) — 결정 38건
- [Sprint 016 contract](./.flowset/contracts/sprint-016.md) — M0~M5 + T01~T26 매트릭스
- [Known Issues](./.flowset/known-issues.md) — KI 잔여/해소
