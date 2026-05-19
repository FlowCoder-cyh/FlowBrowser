#!/usr/bin/env node
// FlowSet PostToolUse hook — Write/Edit 시 ownership 매핑 + 문서 동기화 권고.
//
// 글로벌 CLAUDE.md v3.4 — Hook "결과물 게이트" 중 PostToolUse 분담.
// - 변경 파일 ownership.json 매핑 출력
// - PRD 변경 → v04-direction.md / state.md / requirements.md 동기화 권고
// - v04-direction.md 변경 → PRD 역방향 동기화 권고 (G-012)
// - CLAUDE.md 변경 → README / docs/prd README 정합 권고
// - handoffs/ 변경 → state.md 최근 갱신 동기화 권고
// - guardrails.md 변경 → CLAUDE.md 원칙 + contract §5 정합 권고
//
// 입력: stdin JSON {"hook_event_name": "PostToolUse", "tool_name": "...", "tool_input": {"file_path": "..."}}
// 출력: stderr 권고 (block 안 함)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..').replace(/\\/g, '/');

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
if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'NotebookEdit') process.exit(0);

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== 'string' || !filePath.trim()) process.exit(0);

// normalize: backslash → forward slash, strip repo root
let normPath = filePath.replace(/\\/g, '/');
if (normPath.toLowerCase().startsWith(repoRoot.toLowerCase())) {
  normPath = normPath.substring(repoRoot.length).replace(/^\/+/, '');
}

const warnings = [];

// 1. PRD 변경
if (/^docs\/prd\//.test(normPath)) {
  warnings.push(`[G-001/G-012] PRD 변경 감지 (${normPath}) — .flowset/specs/v04-direction.md / requirements.md / state.md 동기화 확인.`);
}

// 2. v04-direction.md (SSOT) 변경
if (/\.flowset\/specs\/v04-direction\.md$/.test(normPath)) {
  warnings.push('[G-012] v04-direction.md (SSOT) 변경 — PRD §0 / README / requirements.md 역방향 동기화 확인.');
}

// 3. CLAUDE.md 변경
if (/(^|\/)CLAUDE\.md$/.test(normPath)) {
  warnings.push('[학습 #8] CLAUDE.md 변경 — README.md / docs/prd/README.md / docs/USAGE.md 정합 확인 권고.');
}

// 4. handoffs/ 변경
if (/^\.flowset\/handoffs\/\d{4}-\d{2}-\d{2}\.md$/.test(normPath)) {
  warnings.push('[P-006] 핸드오프 갱신 — state.md "최근 갱신" / "최근 핸드오프" 동기화 권고.');
}

// 5. guardrails.md 변경
if (/^\.flowset\/guardrails\.md$/.test(normPath)) {
  warnings.push('[G-NNN] guardrails.md 갱신 — CLAUDE.md "개발 원칙" + sprint contract §5 정합 확인.');
}

// 6. ownership.json 매핑 정보
const ownershipFile = join(repoRoot, '.flowset', 'ownership.json');
if (existsSync(ownershipFile)) {
  try {
    const ownership = JSON.parse(readFileSync(ownershipFile, 'utf8'));
    const matched = [];
    for (const team of ownership.teams || []) {
      for (const dir of team.directories || []) {
        const normDir = dir.replace(/\\/g, '/');
        if (normPath === normDir || normPath.startsWith(normDir.replace(/\/+$/, '') + '/')) {
          matched.push(team.name);
          break;
        }
      }
    }
    if (matched.length > 0) {
      warnings.push(`[ownership] '${normPath}' → team: ${matched.join(', ')}`);
    }
  } catch {
    // 무시
  }
}

if (warnings.length > 0) {
  process.stderr.write('=== [FlowSet PostToolUse 권고] ===\n');
  for (const w of warnings) process.stderr.write(w + '\n');
  process.stderr.write('=== ===\n');
}

process.exit(0);
