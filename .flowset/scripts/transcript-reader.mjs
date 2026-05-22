#!/usr/bin/env node
// Sprint 018 M0 T01 — Claude Code transcript history 직접 읽기 helper.
//
// transcript source: ~/.claude/projects/<projectKey>/<sessionId>.jsonl
//   - projectKey: cwd 변환 (예: `C:\\dev\\Flowbrowser` → `C--dev-Flowbrowser`)
//   - 최신 jsonl 파일 (mtime sort) 박음
//
// 사용 (programmatic):
//   import { discoverTranscriptSource, extractRecentUserUtterances } from './transcript-reader.mjs'
// 사용 (CLI):
//   node transcript-reader.mjs [N=3] [cwd?]
//
// codex 019e5183 권고 정합 — source discovery + transcript validation + non-blocking advisory.
// Claude 발화 인식 위조 차단 (transcript 파일 직접 읽기, 사용자 메모리 / 응답 위조 불가).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';

// codex 019e5193 NEEDS_CHANGES #3 정합 — 환경 override path 박음 (fixture 회귀 cover).
// 매번 평가 (env runtime mutation cover — module cache 안에서도 정합).
function getProjectsDir() {
  return process.env.FLOWSET_CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');
}

export function cwdToProjectKey(cwd) {
  if (typeof cwd !== 'string') throw new TypeError('cwd must be a string');
  // Windows: C:\dev\Flowbrowser → C--dev-Flowbrowser
  // Unix: /home/user/project → -home-user-project (앞 - 보존)
  return cwd.replace(/[\\/:]/g, '-');
}

// codex 019e5193 NEEDS_CHANGES #2 정합 — candidates array 반환 (newest-to-oldest scan path 박음).
// session-start.mjs 가 newest 박힌 jsonl 에서 extract 0건 박힘 시 다음 candidate scan.
export function discoverTranscriptSourceCandidates(cwd) {
  const projectKey = cwdToProjectKey(cwd);
  const projectDir = join(getProjectsDir(), projectKey);
  if (!existsSync(projectDir)) {
    return { candidates: [], reason: `project dir not found: ${projectDir}` };
  }
  let entries;
  try {
    entries = readdirSync(projectDir);
  } catch (e) {
    return { candidates: [], reason: `readdir failed: ${e.message}` };
  }
  const jsonlFiles = entries
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const fullPath = join(projectDir, f);
      try {
        return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.mtime !== a.mtime) return b.mtime - a.mtime;
      return b.path.localeCompare(a.path);
    });
  if (jsonlFiles.length === 0) {
    return { candidates: [], reason: `no jsonl files in ${projectDir}` };
  }
  return { candidates: jsonlFiles.map((f) => f.path), reason: null };
}

// 단일 source (newest only) 박은 path — backward-compatibility.
export function discoverTranscriptSource(cwd) {
  const { candidates, reason } = discoverTranscriptSourceCandidates(cwd);
  if (candidates.length === 0) return { source: null, reason };
  return { source: candidates[0], reason: null };
}

function extractTextContent(message) {
  if (!message || typeof message !== 'object') return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlocks = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    return textBlocks.length > 0 ? textBlocks.join('\n') : null;
  }
  return null;
}

export function extractRecentUserUtterances(sourcePath, n = 3) {
  if (!sourcePath || !existsSync(sourcePath)) {
    return { utterances: [], reason: 'source not found' };
  }
  let content;
  try {
    content = readFileSync(sourcePath, 'utf8');
  } catch (e) {
    return { utterances: [], reason: `read failed: ${e.message}` };
  }
  const utterances = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'user') continue;
    if (obj.isSidechain === true) continue;
    // codex 019e5193 NEEDS_CHANGES #1 정합 — isMeta:true caveat 행 skip.
    if (obj.isMeta === true) continue;
    if (obj.message?.role !== 'user') continue;
    if (obj.userType && obj.userType !== 'external') continue;
    const text = extractTextContent(obj.message);
    if (!text) continue;
    utterances.push({
      text,
      timestamp: obj.timestamp ?? null,
      uuid: obj.uuid ?? null
    });
  }
  return { utterances: utterances.slice(-n), reason: null };
}

const isCliEntry = (() => {
  if (!process.argv[1]) return false;
  const url = import.meta.url.replace(/\\/g, '/');
  const arg = process.argv[1].replace(/\\/g, '/');
  return url.endsWith(arg) || arg.endsWith(url.replace(/^file:\/\/\/?/, ''));
})();

if (isCliEntry) {
  const n = Number(process.argv[2]) || 3;
  const cwd = process.argv[3] || process.cwd();
  const { source, reason: discoverReason } = discoverTranscriptSource(cwd);
  if (!source) {
    console.log(JSON.stringify({ source: null, reason: discoverReason, utterances: [] }, null, 2));
    process.exit(0);
  }
  const { utterances, reason: extractReason } = extractRecentUserUtterances(source, n);
  console.log(JSON.stringify({ source, reason: extractReason, utterances }, null, 2));
  process.exit(0);
}
