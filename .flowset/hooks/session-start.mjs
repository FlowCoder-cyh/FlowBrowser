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

import {
  discoverTranscriptSourceCandidates,
  extractRecentUserUtterances
} from '../scripts/transcript-reader.mjs';
import { detectFinalizationIntent } from '../scripts/check-finalization-intent.mjs';

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

// 5. G-022 advisory — transcript history 박힌 최신 user 발화 + 검출 결과 (Sprint 018 M0 T01, non-blocking)
// codex 019e5193 NEEDS_CHANGES #2 정합 — candidates newest-to-oldest scan path 박음.
// SessionStart 시점 newest jsonl 이 hook/meta only 박힘 시 다음 candidate 까지 scan + 첫 실 발화 박은 source 박음.
try {
  const { candidates, reason: discoverReason } = discoverTranscriptSourceCandidates(repoRoot);
  if (candidates.length === 0) {
    console.log('## G-022 advisory (transcript source 검색)');
    console.log('');
    console.log(`- transcript source 미발견: ${discoverReason ?? 'unknown'}`);
    console.log('- advisory only (Claude 자체 발화 인식 fallback)');
    console.log('');
  } else {
    console.log('## G-022 advisory (transcript 박힌 최신 user 발화)');
    console.log('');
    let foundUtterance = null;
    let foundSource = null;
    let scanned = 0;
    for (const candidate of candidates) {
      scanned += 1;
      const { utterances } = extractRecentUserUtterances(candidate, 1);
      if (utterances.length > 0) {
        foundUtterance = utterances[utterances.length - 1];
        foundSource = candidate;
        break;
      }
      if (scanned >= 5) break; // 안전 한계 — 너무 많은 jsonl scan 차단
    }
    if (!foundUtterance) {
      console.log(`- transcript candidates ${candidates.length}건 박혔지만 user 발화 추출 0건 (scan ${scanned}건)`);
    } else {
      const intent = detectFinalizationIntent(foundUtterance.text);
      const preview =
        foundUtterance.text.length > 200 ? foundUtterance.text.slice(0, 200) + '…' : foundUtterance.text;
      console.log(`- 최신 user 발화 (${foundUtterance.timestamp ?? '시점 미상'}): "${preview.replace(/\n/g, ' ')}"`);
      console.log(`- source: ${foundSource}${scanned > 1 ? ` (scan ${scanned}건 — newest 박힘 meta-only fallback)` : ''}`);
      console.log(
        `- G-022 advisory: \`${intent.advisory}\` (signals: ${JSON.stringify(intent.signals)} / entry: ${intent.hasEntryIntent} / delegation: ${intent.hasAutonomousDelegation})`
      );
      if (intent.advisory === 'BLOCK_ENTRY') {
        console.log('- ⚠️ 마무리 의도 검출 — 사용자 명시 선택 박힐 때까지 새 작업 진입 금지 (G-022)');
      } else if (intent.advisory === 'ALLOW_ENTRY') {
        console.log('- ✓ 허용 패턴 (진입 의사 / autonomous 위임 박힘) — G-022 §허용 패턴 정합 진입 가능');
      }
    }
    console.log('');
  }
} catch (e) {
  // hook 자체는 non-blocking — advisory 실패 시 nullable + Claude 자체 fallback
  console.log('## G-022 advisory (실패 — non-blocking)');
  console.log('');
  console.log(`- transcript reader 실패: ${e.message}`);
  console.log('- advisory only path 유지 (exit 0)');
  console.log('');
}

// 6. 표준 환기
console.log('## 표준 환기');
console.log('- 모든 PR / 핸드오프 / Milestone 종료 시 evaluator + codex 병렬 호출 (학습 #8, feedback_dual_review)');
console.log('- dual review codex 호출 1순위 = `/codex:adversarial-review` (review-only + free-form focus text 지원, 학습 #16) / 2순위 = `/codex:review` (focus text 미지원) / 3순위 = raw MCP sandbox=read-only (git state 무관)');
console.log('- `/codex:rescue` 는 rescue/fix/investigation 의도 시 정합 도구 (workspace-write) — dual review 본문에 사용 시 CI 차단 (도구 자체 금지 아님)');
console.log('- raw MCP 호출 시 sandbox: "read-only" + approval-policy: "never" + model 생략 (config.toml gpt-5.5 자동) — 학습 #5/#13 G-006');
console.log('- 브랜치 분기: main 에서만 / 커밋 형식 WI-NNN-[type] 한글 작업명 (G-009 NNN 한 분절)');
console.log('');
console.log('=== [FlowSet] SessionStart 종료 ===');
