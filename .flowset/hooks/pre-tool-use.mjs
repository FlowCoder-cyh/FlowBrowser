#!/usr/bin/env node
// FlowSet PreToolUse hook — git commit / git push / gh pr / .flowset 삭제 사전 점검.
//
// 글로벌 CLAUDE.md v3.4 — Hook "결과물 게이트" 중 PreToolUse 분담.
// - git push main 차단 (G-007, exit 2)
// - .flowset/ 핵심 파일 삭제 차단 (wi-flowset §3, exit 2) — hooks/ 디렉토리는 예외
// - git commit 메시지 G-009 형식 경고 (stderr, block 안 함)
// - gh pr create/merge dual review 환기 (stderr)
//
// 입력: stdin JSON {"hook_event_name": "PreToolUse", "tool_name": "...", "tool_input": {"command": "..."}}
// 출력 / 종료 코드:
//   - exit 0: 통과
//   - exit 2: block + stderr (Claude 에 차단 사유 전달)

import { readFileSync } from 'node:fs';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}
if (!raw.trim()) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const toolName = payload.tool_name;
if (toolName !== 'Bash' && toolName !== 'PowerShell') process.exit(0);

const command = payload?.tool_input?.command;
if (typeof command !== 'string' || !command.trim()) process.exit(0);

const warnings = [];
const blocks = [];

// 1. main 직접 push 차단 (G-007)
if (/git\s+push/.test(command) && !/--dry-run/.test(command)) {
  if (/origin\s+main(\s|$)/.test(command) || /origin\s+HEAD:main/.test(command)) {
    blocks.push(`[G-007] main 직접 push 시도 — 브랜치 → PR 경로만 허용. command: ${command}`);
  }
}

// 2. .flowset/ 핵심 파일/디렉토리 삭제 차단 (wi-flowset §3) — hooks/ 디렉토리는 작업 가능
// codex review #5 흡수: README.md 추가 / rm -rf .flowset 전체 / Windows backslash 경로 cover
// 셸 명령을 ; && || 단위로 분할 → 각 sub-command 만 검사 (quote 내부 string literal false-positive 회피)
const corePathChars = `(state\\.md|guardrails\\.md|requirements\\.md|ownership\\.json|known-issues\\.md|ontology\\.md|README\\.md|PROMPT\\.md|contracts|specs|eval-results|handoffs|logs)`;
const deletePatternA = new RegExp(`^\\s*(?:rm|Remove-Item)\\s+(?:-[a-zA-Z]+\\s+)*[^|;&'\"\`]*?\\.flowset[\\\\/]${corePathChars}(?:[\\\\/]|\\s|$)`);
const deletePatternB = /^\s*(?:rm|Remove-Item)\s+(?:-[a-zA-Z]+\s+)*[^|;&'"`]*?\.flowset(?:[\\/])?(?:\s*$|\s+(?:-|[;&|]))/;
const subCommands = command.split(/(?:&&|\|\||;)/);
for (const sub of subCommands) {
  const trimmed = sub.trim();
  if (deletePatternA.test(trimmed) || deletePatternB.test(trimmed)) {
    blocks.push(`[wi-flowset §3] .flowset/ 핵심 파일/디렉토리 삭제 시도 — 절대 금지. command: ${command}`);
    break;
  }
}

// 3. git commit 메시지 G-009 형식 검사 (-m 또는 here-doc)
if (/git\s+commit/.test(command) && !/--amend/.test(command)) {
  let msg = null;
  let m;
  if ((m = command.match(/-m\s+"([^"]+)"/))) msg = m[1];
  else if ((m = command.match(/-m\s+'([^']+)'/))) msg = m[1];
  else if ((m = command.match(/cat\s+<<'EOF'\s*([\s\S]*?)\s*EOF/))) msg = m[1].trim().split('\n')[0];

  if (msg) {
    const pattern = /^WI-([0-9A-Za-z]+(-[0-9]+)?-(feat|fix|docs|style|refactor|test|chore|perf|ci|revert)|chore|docs)\s+.+/;
    if (!pattern.test(msg)) {
      warnings.push(`[G-009] 커밋 메시지 형식 위반 가능 — 'WI-NNN-[type] 한글 작업명' 확인 필요. 첫 줄: ${msg}`);
    }
  }
}

// 4. gh pr create / gh pr merge dual review 환기
if (/gh\s+pr\s+(create|merge)/.test(command)) {
  warnings.push('[학습 #8] dual review 표준: evaluator + codex 병렬 호출 후 PR body 체크박스 [x] 표시 필요. CI flowset-policy-check 가 검증.');
}

if (warnings.length > 0) {
  process.stderr.write('=== [FlowSet PreToolUse 경고] ===\n');
  for (const w of warnings) process.stderr.write(w + '\n');
  process.stderr.write('=== ===\n');
}

if (blocks.length > 0) {
  process.stderr.write('=== [FlowSet PreToolUse 차단] ===\n');
  for (const b of blocks) process.stderr.write(b + '\n');
  process.stderr.write('=== ===\n');
  process.exit(2);
}

process.exit(0);
