# FlowSet Hooks

> Sprint 016 M0 mini-milestone β (2026-05-20) — 자동 강제 path 활성.

본 디렉토리는 `.claude/settings.json` 의 `hooks.*` 에서 호출되는 Node.js 스크립트를 포함한다.

## 왜 Node.js (.mjs) — PowerShell (.ps1) 아님?

Windows PowerShell 5.1 은 BOM 없는 UTF-8 `.ps1` 파일을 cp949 로 해석한다. wi-utf8.md "BOM 없음" 정책을 유지하면서 한글 메시지를 안전하게 출력하려면 BOM 추가 (정책 위반) 또는 PowerShell 7+ 강제 (Windows 표준 PowerShell 5.1 호환성 손실) 둘 중 하나. Node.js 는 UTF-8 native + cross-platform + 본 프로젝트 (Electron) 의존 이미 존재 → 무비용 채택.

## 파일

| 파일 | 이벤트 | 역할 | block 여부 |
|---|---|---|---|
| `session-start.mjs` | SessionStart | state.md 앞 30줄 / 최신 핸드오프 §6~§7 80줄 / guardrails [active] 헤더 / KI 잔여 통계 / 표준 환기 stdout 실주입 | 없음 |
| `pre-tool-use.mjs` | PreToolUse (Bash/PowerShell) | main 직접 push 차단 (G-007, exit 2) / `.flowset/` 핵심 파일 삭제 차단 (wi-flowset §3, exit 2) / git commit G-009 형식 경고 / gh pr dual review 환기 | 2 케이스만 block |
| `post-tool-use.mjs` | PostToolUse (Write/Edit/NotebookEdit) | ownership.json 매핑 출력 / PRD·v04-direction·CLAUDE.md·handoffs·guardrails 변경 시 동기화 권고 | 없음 |
| `stop.mjs` | Stop | 오늘 핸드오프 존재 / state.md 최근 갱신 / 최근 commits G-009 / 미머지 브랜치 / dual review 환기 | 없음 |

## 설계 원칙

- **정보·권고 위주, 강제 차단은 최소화** — UX 보존. 강한 게이트는 CI `flowset-policy-check` 가 분담 (PR body dual review 체크박스 + 영향 영역 + 제목 형식 강제 검증).
- **PreToolUse exit 2 (block) 발동 케이스 2종**:
  1. main 직접 push 시도 (G-007)
  2. `.flowset/` 핵심 파일 삭제 시도 (`state.md`, `guardrails.md`, `requirements.md`, `ownership.json`, `known-issues.md`, `ontology.md`, `contracts/`, `specs/`, `eval-results/`, `handoffs/`) — `.flowset/hooks/` 자체는 예외 (작업 가능)
- **stderr 출력** — Claude Code 컨텍스트에 권고/차단 사유 전달
- **UTF-8 + cross-platform** — Node.js native 인코딩

## Dual Review 표준 (학습 #13 + #16 — 2026-05-20 박음, 도구 분류 정합)

본 hooks 의 환기 메시지 + PR template + 모든 PR 사전 dual review 호출 표준:

| 도구 | 권한 | 적합 시나리오 | 본문 인용 |
|---|---|---|---|
| **`/codex:adversarial-review`** | review-only | **dual review 1순위 — free-form focus text 지원, git state review** | "Unlike `/codex:review`, it can still take extra focus text after the flags" (adversarial-review.md L45) |
| `/codex:review` | review-only | 2순위 — git state native review (focus text 미지원, 단순 코드 review) | "This command is native-review only" (review.md L39) |
| raw MCP `mcp__codex__codex` + `sandbox=read-only` + `approval-policy=never` + model 생략 | review-only | 3순위 — git state 무관 자유 협의/평가 | Claude Code MCP tool, sandbox 옵션으로 강제 |
| **`/codex:rescue`** | workspace-write | **rescue / fix / investigation 의도 시 정합 도구** | codex-rescue subagent forwarder |
| raw MCP + `sandbox=workspace-write` | write | 명시적 write 의도 시 특수 케이스 | — |

**중요**: `/codex:rescue` 는 도구 자체가 금지된 것이 아니라 **dual review 케이스 (read-only 평가) 에 부적합**. rescue/fix/investigation 명시 의도 있을 때는 정합 도구. dual review 체크박스 행에 명시 시 CI `flowset-policy-check` 차단.

본 PR (#192 mini-milestone γ) 이전:
- PR #181 (β): `/codex:rescue` 가 dual review 표준으로 박혀 — PR #188 시점 codex agent 직접 commit + push 사고 (자세한 내용은 핸드오프 §11 학습 #13 참조)
- PR #189 (γ-1): `/codex:review` 1순위로 박았으나 본인 실측 부족 — PR #189/#190/#191 dual review 모두 raw MCP 사용 (slash 무시)
- 본 PR (γ): `/codex:adversarial-review` 1순위 정합 + 도구 분류 표 정확화 + rescue 정합 사용 시나리오 별도 명시 (학습 #16)

## CI 보완

`.github/workflows/flowset-policy-check.yml` — PR body `## Dual Review` 섹션 존재 + dual review 체크박스 (`- [x] evaluator` + `- [x] codex (/codex:adversarial-review | /codex:review | sandbox=read-only)`) + 영향 영역 1개+ + 제목 형식 + G-005 secret 평문 grep 강제. **`/codex:rescue`** 가 dual review 행에 명시되면 CI 차단 (dual review 케이스 한정, 도구 자체 금지 아님).

**머지 차단 조건** (codex review #7 흡수): hook 우회 시에도 본 CI job 이 PR 머지를 차단 — 단 **GitHub branch protection 에서 `FlowSet Policy Check / policy-check` 를 required status check 로 승격한 경우에만**. 본 PR 머지 직후 repo Settings → Branches → Branch protection rule (main) → "Require status checks" 에 추가 권고 (settings repo automation 부재).

## 핵심 파일 삭제 차단 패턴

`pre-tool-use.mjs` 의 정규식:

```
/(?:rm|Remove-Item)\s+(?:-[a-zA-Z]+\s+)*[^|;&]*\.flowset\/(state\.md|guardrails\.md|requirements\.md|ownership\.json|known-issues\.md|ontology\.md|contracts|specs|eval-results|handoffs)/
```

`.flowset/hooks/` 는 패턴에서 제외 — hook 자체 정비 시 차단 회피.

## 변경 이력

- 2026-05-20: 4 hook 신규 + README (mini-milestone β PR). `.ps1` 1차 시도 후 Windows PowerShell 5.1 cp949 한계 발견 → `.mjs` 전환.
