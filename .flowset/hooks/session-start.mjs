#!/usr/bin/env node
// FlowSet SessionStart hook — state.md / 최신 핸드오프 §6~§7 / guardrails 헤더 / KI 잔여 실주입.
//
// 글로벌 CLAUDE.md v3.4 — Hook "결과물 게이트" 중 SessionStart 자동 주입 분담.
// Node.js + cross-platform + UTF-8 native (Windows PowerShell 5.1 cp949 한계 회피).
//
// 입력: stdin JSON {"hook_event_name": "SessionStart", ...} (현재 미사용)
// 출력: stdout 텍스트 → Claude Code 컨텍스트 주입

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const flowset = join(repoRoot, '.flowset');

function readLines(path, maxLines = null) {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);
  return maxLines ? lines.slice(0, maxLines) : lines;
}

console.log('=== [FlowSet] SessionStart 자동 주입 ===');
console.log('');

// 1. state.md 앞 30줄
const stateMd = join(flowset, 'state.md');
const stateLines = readLines(stateMd, 30);
if (stateLines) {
  console.log('## .flowset/state.md (앞 30줄)');
  console.log('');
  console.log(stateLines.join('\n'));
  console.log('');
} else {
  console.log('[경고] .flowset/state.md 없음');
}

// 2. 최신 핸드오프 §6 / §다음 세션 진입 부터 80줄
const handoffDir = join(flowset, 'handoffs');
if (existsSync(handoffDir)) {
  const files = readdirSync(handoffDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse();
  if (files.length > 0) {
    const latest = files[0];
    const lines = readLines(join(handoffDir, latest));
    if (lines) {
      console.log(`## 최신 핸드오프 §6~§7 (${latest})`);
      console.log('');
      let start = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^## 6\./.test(lines[i]) || /^## 다음 세션/.test(lines[i])) {
          start = i;
          break;
        }
      }
      if (start >= 0) {
        const end = Math.min(start + 80, lines.length);
        console.log(lines.slice(start, end).join('\n'));
      } else {
        console.log(lines.slice(-60).join('\n'));
      }
      console.log('');
    }
  }
}

// 3. guardrails 헤더 (활성 G-NNN)
const guardrails = join(flowset, 'guardrails.md');
const grLines = readLines(guardrails);
if (grLines) {
  console.log('## 활성 가드레일 (G-NNN)');
  console.log('');
  const headers = grLines.filter((l) => /^### G-\d+ \[active\]/.test(l));
  for (const h of headers) {
    console.log('- ' + h.replace(/^### /, ''));
  }
  console.log('');
}

// 4. KI 잔여 통계
const kiFile = join(flowset, 'known-issues.md');
const kiLines = readLines(kiFile);
if (kiLines) {
  const text = kiLines.join('\n');
  const totalOpen = (text.match(/\| KI-\d+ \|[^\n]*\| (?:open|in-progress) \|/g) || []).length;
  const high = (text.match(/\| KI-\d+ \|[^\n]*\| HIGH \|[^\n]*\| (?:open|in-progress) \|/g) || []).length;
  const medium = (text.match(/\| KI-\d+ \|[^\n]*\| MEDIUM \|[^\n]*\| (?:open|in-progress) \|/g) || []).length;
  const low = (text.match(/\| KI-\d+ \|[^\n]*\| LOW \|[^\n]*\| (?:open|in-progress) \|/g) || []).length;
  console.log('## Known Issues 잔여 (table 추정치)');
  console.log(`- 전체 open/in-progress: ${totalOpen} (HIGH ${high} / MEDIUM ${medium} / LOW ${low})`);
  console.log('');
}

// 5. 표준 환기
console.log('## 표준 환기');
console.log('- 모든 PR / 핸드오프 / Milestone 종료 시 evaluator + codex 병렬 호출 (학습 #8, feedback_dual_review)');
console.log('- codex 호출 = `/codex:review` (review-only 강제) 우선 — `/codex:rescue` 는 rescue/fix 작업용 (write 가능)');
console.log('- raw MCP 직접 호출 시 sandbox: "read-only" + approval-policy: "never" + model 생략 (config.toml gpt-5.5 자동) — 학습 #5/#13 G-006');
console.log('- 브랜치 분기: main 에서만 / 커밋 형식 WI-NNN-[type] 한글 작업명 (G-009 NNN 한 분절)');
console.log('');
console.log('=== [FlowSet] SessionStart 종료 ===');
