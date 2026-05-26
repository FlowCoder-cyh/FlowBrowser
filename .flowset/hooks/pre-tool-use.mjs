#!/usr/bin/env node
// FlowSet PreToolUse hook — git commit / git push / gh pr / .flowset 삭제 사전 점검 + G-022 진입 차단.
//
// 글로벌 CLAUDE.md v3.4 — Hook "결과물 게이트" 중 PreToolUse 분담.
// - git push main 차단 (G-007, exit 2)
// - .flowset/ 핵심 파일 삭제 차단 (wi-flowset §3, exit 2) — hooks/ 디렉토리는 예외
// - git commit 메시지 G-009 형식 경고 (stderr, block 안 함)
// - gh pr create/merge dual review 환기 (stderr)
// - G-022 blocking 전환 (Sprint 018 M0 T02): 사용자 마무리 의도(BLOCK_ENTRY) 후 새 작업 진입 차단 (exit 2)
//
// codex 019e634d 권고 정합 — SessionStart 는 exit 2 차단 불가(공식 문서) → enforcement 는 PreToolUse.
// false positive 0: closeout(state/handoffs/logs/memory) 통과, 새 산출물 작성 + 새 작업 커밋만 차단.
// fail-open: transcript 미발견 / 발화 추출 실패 / 검출 에러 시 차단 안 함 (exit 0).
//
// 입력: stdin JSON {"hook_event_name": "PreToolUse", "tool_name": "...", "tool_input": {...},
//                   "transcript_path": "...", "cwd": "..."}
// 출력 / 종료 코드:
//   - exit 0: 통과
//   - exit 2: block + stderr (Claude 에 차단 사유 전달)

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import {
  discoverTranscriptSourceCandidates,
  extractRecentUserUtterances
} from '../scripts/transcript-reader.mjs';
import { detectFinalizationIntent } from '../scripts/check-finalization-intent.mjs';
import { classifyToolForG022 } from '../scripts/g022-tool-classifier.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
// 사용자 memory projects root — closeout memory anchor (transcript-reader getProjectsDir 와 동일 규칙).
const memoryRoot = process.env.FLOWSET_CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');

const G022_GATED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);

// 현재 세션 최신 user 발화 박기.
// codex 019e634d NEEDS_CHANGES #1 정합 — transcript_path 가 주어지면 그 파일만 신뢰.
// 추출 0건이어도 다른 jsonl 로 fallback 하지 않음 (stale 세션의 BLOCK_ENTRY 오집어 false positive 회피).
// transcript_path 가 아예 없을 때만 mtime discovery fallback.
export function resolveLatestUtterance(payload, root = repoRoot) {
  const tpath = payload?.transcript_path;
  if (typeof tpath === 'string' && tpath.trim()) {
    const { utterances } = extractRecentUserUtterances(tpath, 1);
    return utterances.length > 0 ? utterances[utterances.length - 1] : null;
  }
  const cwd = (typeof payload?.cwd === 'string' && payload.cwd.trim()) ? payload.cwd : root;
  const { candidates } = discoverTranscriptSourceCandidates(cwd);
  let scanned = 0;
  for (const candidate of candidates) {
    scanned += 1;
    const { utterances } = extractRecentUserUtterances(candidate, 1);
    if (utterances.length > 0) return utterances[utterances.length - 1];
    if (scanned >= 5) break;
  }
  return null;
}

// G-022 게이트 판정 — { block, reason }. 에러는 모두 fail-open (block:false).
export function evaluateG022Gate(payload, root = repoRoot) {
  try {
    const toolName = payload?.tool_name;
    if (!G022_GATED_TOOLS.has(toolName)) return { block: false, reason: null };

    const utterance = resolveLatestUtterance(payload, root);
    if (!utterance || typeof utterance.text !== 'string') {
      return { block: false, reason: null }; // 발화 미상 — fail-open
    }
    const intent = detectFinalizationIntent(utterance.text);
    const result = classifyToolForG022(toolName, payload?.tool_input, intent, root, memoryRoot);
    if (result.action === 'block') {
      return { block: true, reason: result.reason };
    }
    return { block: false, reason: null };
  } catch {
    return { block: false, reason: null }; // 검출 에러 — fail-open (false positive 0 우선)
  }
}

// 기존 Bash/PowerShell 결정적 점검 (G-007 main push / wi-flowset .flowset 삭제 / G-009 / dual review).
export function evaluateShellChecks(command) {
  const warnings = [];
  const blocks = [];
  if (typeof command !== 'string' || !command.trim()) return { warnings, blocks };

  // 1. main 직접 push 차단 (G-007)
  if (/git\s+push/.test(command) && !/--dry-run/.test(command)) {
    if (/origin\s+main(\s|$)/.test(command) || /origin\s+HEAD:main/.test(command)) {
      blocks.push(`[G-007] main 직접 push 시도 — 브랜치 → PR 경로만 허용. command: ${command}`);
    }
  }

  // 2. .flowset/ 핵심 파일/디렉토리 삭제 차단 (wi-flowset §3) — hooks/ 디렉토리는 작업 가능
  const corePathChars = `(state\\.md|guardrails\\.md|requirements\\.md|ownership\\.json|known-issues\\.md|ontology\\.md|README\\.md|PROMPT\\.md|contracts|specs|eval-results|handoffs|logs)`;
  const deletePatternA = new RegExp(`^\\s*(?:rm|Remove-Item)\\s+(?:-[a-zA-Z]+\\s+)*[^|;&'"\`]*?\\.flowset[\\\\/]${corePathChars}(?:[\\\\/]|\\s|$)`);
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
    warnings.push('[학습 #8/#16] dual review 표준: evaluator + codex 병렬. codex 1순위 = `/codex:adversarial-review` (focus text 지원) / 2순위 = `/codex:review` / 3순위 = raw MCP sandbox=read-only. `/codex:rescue` 는 rescue/fix 의도 시 정합 도구 (dual review 본문 사용 시 CI 차단). PR body 체크박스 [x] + 도구 명시.');
  }

  return { warnings, blocks };
}

const isCliEntry = (() => {
  if (!process.argv[1]) return false;
  const url = import.meta.url.replace(/\\/g, '/');
  const arg = process.argv[1].replace(/\\/g, '/');
  return url.endsWith(arg) || arg.endsWith(url.replace(/^file:\/\/\/?/, ''));
})();

if (isCliEntry) {
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
  const warnings = [];
  const blocks = [];

  // G-022 진입 차단 (Write/Edit/MultiEdit/Bash/PowerShell — fail-open)
  const g022 = evaluateG022Gate(payload, repoRoot);
  if (g022.block) blocks.push(g022.reason);

  // 기존 Bash/PowerShell 결정적 점검
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = payload?.tool_input?.command;
    const shell = evaluateShellChecks(command);
    warnings.push(...shell.warnings);
    blocks.push(...shell.blocks);
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
}
