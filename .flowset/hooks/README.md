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

## CI 보완

`.github/workflows/flowset-policy-check.yml` — PR body `## Dual Review` 섹션 존재 + dual review 체크박스 (`- [x] evaluator` + `- [x] codex`) + 영향 영역 1개+ + 제목 형식 + G-005 secret 평문 grep 강제.

**머지 차단 조건** (codex review #7 흡수): hook 우회 시에도 본 CI job 이 PR 머지를 차단 — 단 **GitHub branch protection 에서 `FlowSet Policy Check / policy-check` 를 required status check 로 승격한 경우에만**. 본 PR 머지 직후 repo Settings → Branches → Branch protection rule (main) → "Require status checks" 에 추가 권고 (settings repo automation 부재).

## 핵심 파일 삭제 차단 패턴

`pre-tool-use.mjs` 의 정규식:

```
/(?:rm|Remove-Item)\s+(?:-[a-zA-Z]+\s+)*[^|;&]*\.flowset\/(state\.md|guardrails\.md|requirements\.md|ownership\.json|known-issues\.md|ontology\.md|contracts|specs|eval-results|handoffs)/
```

`.flowset/hooks/` 는 패턴에서 제외 — hook 자체 정비 시 차단 회피.

## 변경 이력

- 2026-05-20: 4 hook 신규 + README (mini-milestone β PR). `.ps1` 1차 시도 후 Windows PowerShell 5.1 cp949 한계 발견 → `.mjs` 전환.
