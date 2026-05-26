#!/usr/bin/env node
// Sprint 018 M0 T02 — G-022 blocking 전환 tool classifier.
//
// 본 helper 는 "사용자 마무리 의도 (BLOCK_ENTRY) 박힌 상태에서 어떤 tool call 이 새 작업 진입인가"
// 를 deterministic 분류한다. hook 본문(pre-tool-use.mjs)에서 분리 — 단위 테스트 가능 path.
//
// codex 019e634d 권고 정합:
//   - SessionStart exit 2 는 차단 불가 (공식 문서) → enforcement 는 PreToolUse.
//   - false positive 0 = closeout(상태/핸드오프/로그/메모리) 는 항상 통과, 새 작업 진입 신호만 차단.
//   - unblock 판정 = 매 호출 transcript 재독 (advisory !== BLOCK_ENTRY 면 게이트 inert).
//
// 분류 규칙 (advisory === 'BLOCK_ENTRY' 일 때만 차단 후보):
//   1. Write/Edit/MultiEdit + non-closeout file_path → block (새 산출물 작성 = 진입의 직접 시점)
//   2. Bash/PowerShell + git commit (feat|fix|refactor|perf 타입) → block (새 작업 커밋)
//   3. 그 외 (read-only Bash / closeout 경로 / docs·chore 커밋 / ALLOW_ENTRY·NEUTRAL) → allow
//
// 사용 (programmatic):
//   import { classifyToolForG022 } from './g022-tool-classifier.mjs'

// closeout 경로 — BLOCK_ENTRY 상태에서도 항상 통과 (마무리 작업 자체).
// 경로 구분자 정규화 후 매칭 (Windows backslash + Unix slash 동일).
const CLOSEOUT_PATH_PATTERNS = [
  /\.flowset\/state\.md$/i,
  /\.flowset\/handoffs\//i,
  /\.flowset\/logs\//i,
  /\.flowset\/eval-results\//i,
  /\.flowset\/known-issues\.md$/i,
  // 사용자 auto-memory (~/.claude/projects/<key>/memory/*.md + MEMORY.md)
  /\.claude\/projects\/[^/]+\/memory\//i,
  /\/MEMORY\.md$/i
];

// 새 작업 커밋 타입 — closeout(docs/chore/style/ci/revert/test)이 아닌 구현 타입.
const NEW_WORK_COMMIT_TYPES = new Set(['feat', 'fix', 'refactor', 'perf']);

function normalizePath(p) {
  if (typeof p !== 'string') return null;
  return p.replace(/\\/g, '/');
}

export function isCloseoutPath(filePath) {
  const norm = normalizePath(filePath);
  if (!norm) return false;
  return CLOSEOUT_PATH_PATTERNS.some((re) => re.test(norm));
}

// git commit 명령에서 첫 줄 메시지 추출 (-m "..." / -m '...' / here-doc).
// pre-tool-use.mjs G-009 검사와 동일 path.
export function extractCommitMessage(command) {
  if (typeof command !== 'string') return null;
  let m;
  // here-doc / here-string 먼저 — `-m "$(cat <<'EOF' ... EOF)"` 형식이 -m "..." 보다 우선.
  if ((m = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/))) {
    return m[1].trim().split('\n')[0];
  }
  if ((m = command.match(/-m\s+"([^"]+)"/))) return m[1];
  if ((m = command.match(/-m\s+'([^']+)'/))) return m[1];
  return null;
}

// 커밋 메시지에서 WI-NNN-[type] 의 type 추출. 형식 미정합 시 null.
export function extractCommitType(message) {
  if (typeof message !== 'string') return null;
  const m = message.match(
    /^WI-(?:[0-9A-Za-z]+(?:-[0-9]+)?)-(feat|fix|docs|style|refactor|test|chore|perf|ci|revert)\s/
  );
  return m ? m[1] : null;
}

/**
 * G-022 blocking 분류.
 * @param {string} toolName - Write|Edit|MultiEdit|Bash|PowerShell 등
 * @param {object} toolInput - tool_input (file_path / command 등)
 * @param {{advisory?: string}} intent - detectFinalizationIntent 결과 (advisory 만 사용)
 * @returns {{action: 'allow'|'block', reason: string|null}}
 */
export function classifyToolForG022(toolName, toolInput, intent) {
  // 게이트는 BLOCK_ENTRY 일 때만 활성 — ALLOW_ENTRY / NEUTRAL / 미상 은 항상 통과 (fail-open).
  if (!intent || intent.advisory !== 'BLOCK_ENTRY') {
    return { action: 'allow', reason: null };
  }

  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};

  // 1. 파일 작성 tool — closeout 경로 외 차단.
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    const filePath = input.file_path;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      // 경로 미상 — 차단 못 함 (fail-open).
      return { action: 'allow', reason: null };
    }
    if (isCloseoutPath(filePath)) {
      return { action: 'allow', reason: null };
    }
    return {
      action: 'block',
      reason: `[G-022] 사용자 마무리 의도(BLOCK_ENTRY) 후 새 산출물 작성 차단 — ${filePath}. closeout(state/handoffs/logs/memory)만 허용. 사용자 명시 선택("PR 생성" / "계속 진행" / "다른 작업") 박힌 후 진입.`
    };
  }

  // 2. 셸 — 새 작업 커밋(feat/fix/refactor/perf)만 차단. read-only / docs·chore 커밋은 통과.
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = input.command;
    if (typeof command !== 'string' || !command.trim()) {
      return { action: 'allow', reason: null };
    }
    if (/git\s+commit/.test(command) && !/--amend/.test(command)) {
      const msg = extractCommitMessage(command);
      const type = extractCommitType(msg);
      if (type && NEW_WORK_COMMIT_TYPES.has(type)) {
        return {
          action: 'block',
          reason: `[G-022] 사용자 마무리 의도(BLOCK_ENTRY) 후 새 작업 커밋(${type}) 차단 — closeout(docs/chore)만 허용. 사용자 명시 선택 박힌 후 진입.`
        };
      }
    }
    return { action: 'allow', reason: null };
  }

  // 3. 그 외 tool — 차단 안 함 (fail-open, false positive 0 우선).
  return { action: 'allow', reason: null };
}
