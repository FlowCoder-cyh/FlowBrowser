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
// codex 019e634d 2차/3차 review 반영:
//   - 셸 파일 쓰기는 subcommand 단위로 분리 + 각 write 동사 subcommand 의 **타겟 경로**가 전부 closeout 일 때만 통과
//     (명령 어딘가에 closeout 경로가 있으면 통과하던 우회 차단 — BLOCKING).
//   - closeout allowlist 는 **root-anchored** — `<root>/.flowset/<closeout>` 또는 repo-relative `.flowset/<closeout>` 만
//     (`src/.flowset/...`, `tmp/.flowset/...` 우회 차단). 문자열 기반 (node resolve OS 의존 회피, CI cross-platform).
//   - dependency 차단은 **mutation 만** (npm install <pkg> / pnpm·yarn add). `npm ci` / bare `npm install` (lockfile 복원=검증 준비)은 통과.
//   - gh pr create / git push(non-dry-run) / 새 브랜치 / NotebookEdit / -am·--message=·here-string 커밋 / --amend 분류.
//
// 범위 밖 (out-of-scope — guardrails.md G-022 명시): bare `>`/`>>` redirect (inspection 캡처 false-positive 위험),
//   `node -e` 파일 쓰기, cp/mv/Copy-Item/Move-Item, MCP write tool (`mcp__...`, matcher 범위 밖).
//
// 사용 (programmatic): import { classifyToolForG022 } from './g022-tool-classifier.mjs'

// 사용자 auto-memory (~/.claude/projects/<key>/memory/*.md) — repo 밖이라 패턴 매칭.
const MEMORY_PATH_RE = /\.claude\/projects\/[^/]+\/memory\//i;

// .flowset/ 하위 closeout 상대 경로 (root anchor 이후 매칭).
const FLOWSET_CLOSEOUT_REL = [
  /^state\.md(?=$|[\s"'])/i,
  /^handoffs\//i,
  /^logs\//i,
  /^eval-results\//i,
  /^known-issues\.md(?=$|[\s"'])/i
];

// 파일 쓰기 tool — non-closeout 경로 차단 대상.
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// 새 작업 커밋 타입 — closeout(docs/chore/style/ci/revert/test)이 아닌 구현 타입.
const NEW_WORK_COMMIT_TYPES = new Set(['feat', 'fix', 'refactor', 'perf']);

// 파일 쓰기 셸 동사 (in-place 편집 / PowerShell write cmdlet).
const SHELL_WRITE_VERB = /\b(?:Set-Content|Add-Content|Out-File|Tee-Object)\b|\bsed\s+-i|\bperl\s+-[a-zA-Z]*i\b/i;

function normalizePath(p) {
  if (typeof p !== 'string') return null;
  return p.replace(/\\/g, '/');
}

// closeout 경로 판정. root 주어지면 `<root>/.flowset/<closeout>` 로 anchor (절대 경로 cover).
// root 미지정(순수 단위 테스트)이어도 repo-relative `.flowset/<closeout>` 는 anchor 됨 (startsWith).
export function isCloseoutPath(filePath, root) {
  const norm = normalizePath(filePath);
  if (!norm) return false;
  if (MEMORY_PATH_RE.test(norm)) return true; // 메모리는 repo 밖
  let rel = null;
  if (root) {
    const r = normalizePath(root).replace(/\/+$/, '');
    const prefix = r + '/.flowset/';
    if (norm.startsWith(prefix)) rel = norm.slice(prefix.length);
  }
  if (rel === null && norm.startsWith('.flowset/')) rel = norm.slice('.flowset/'.length);
  if (rel === null) return false;
  return FLOWSET_CLOSEOUT_REL.some((re) => re.test(rel));
}

// 경로 무관 — 무조건 새 작업 진입 셸 동작.
function matchShellNewWork(command) {
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    return 'gh pr create — "PR 생성" 은 사용자 명시 선택. ALLOW_ENTRY 발화 박힌 후만.';
  }
  if (/\bgit\s+push\b/.test(command) && !/--dry-run/.test(command)) {
    return 'git push — 새 작업 publish. 사용자 명시 선택 후만.';
  }
  if (/\bgit\s+(?:checkout\s+-b|switch\s+-c)\b/.test(command)) {
    return 'git 새 브랜치 생성 — 새 작업 진입.';
  }
  // dependency mutation 만 (npm install <pkg> / pnpm·yarn add). npm ci / bare install 은 lockfile 복원 → 통과.
  if (/\bnpm\s+(?:install|i)\s+(?!-)\S/.test(command) || /\b(?:pnpm|yarn)\s+add\b/.test(command)) {
    return 'dependency 추가 (G-020) — 새 작업.';
  }
  return null;
}

// 단일 셸 쓰기 subcommand 의 타겟이 전부 closeout 인가 (codex BLOCKING — 타겟 기반 판정).
// path-like 토큰을 추출 — 하나라도 non-closeout 이면 차단. 타겟 식별 불가 시 차단(fail-closed, BLOCK_ENTRY 하 셸쓰기는 의심).
export function shellWriteTargetsCloseout(sub, root) {
  const tokens = sub.split(/[\s"'`()]+/).filter(Boolean);
  const pathTokens = tokens.filter(
    (t) => !t.startsWith('-') && (/[\\/]/.test(t) || /\.[A-Za-z0-9]{1,6}$/.test(t))
  );
  if (pathTokens.length === 0) return false;
  return pathTokens.every((t) => isCloseoutPath(t, root));
}

// git commit 명령에서 첫 줄 메시지 추출 (here-doc / here-string / -m / -am / --message=).
export function extractCommitMessage(command) {
  if (typeof command !== 'string') return null;
  let m;
  // here-doc — `-m "$(cat <<'EOF' ... EOF)"` 형식이 -m "..." 보다 우선.
  if ((m = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/))) {
    return m[1].trim().split('\n')[0];
  }
  // PowerShell here-string @'...'@ / @"..."@
  if ((m = command.match(/@['"]\s*\n([\s\S]*?)\n['"]@/))) {
    return m[1].trim().split('\n')[0];
  }
  // -m / -am / -sm "..." or '...'
  if ((m = command.match(/-[a-zA-Z]*m\s+"([^"]+)"/))) return m[1];
  if ((m = command.match(/-[a-zA-Z]*m\s+'([^']+)'/))) return m[1];
  // --message=... / --message ...
  if ((m = command.match(/--message[=\s]+"([^"]+)"/))) return m[1];
  if ((m = command.match(/--message[=\s]+'([^']+)'/))) return m[1];
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
 * @param {string} toolName - Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell 등
 * @param {object} toolInput - tool_input (file_path / notebook_path / command 등)
 * @param {{advisory?: string}} intent - detectFinalizationIntent 결과 (advisory 만 사용)
 * @param {string} [root] - repo root (closeout 절대 경로 anchor — hook 이 전달)
 * @returns {{action: 'allow'|'block', reason: string|null}}
 */
export function classifyToolForG022(toolName, toolInput, intent, root) {
  // 게이트는 BLOCK_ENTRY 일 때만 활성 — ALLOW_ENTRY / NEUTRAL / 미상 은 항상 통과 (fail-open).
  if (!intent || intent.advisory !== 'BLOCK_ENTRY') {
    return { action: 'allow', reason: null };
  }

  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};

  // 1. 파일 작성 tool — closeout 경로 외 차단.
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const filePath = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { action: 'allow', reason: null }; // 경로 미상 — fail-open
    }
    if (isCloseoutPath(filePath, root)) {
      return { action: 'allow', reason: null };
    }
    return {
      action: 'block',
      reason: `[G-022] 사용자 마무리 의도(BLOCK_ENTRY) 후 새 산출물 작성 차단 — ${filePath}. closeout(state/handoffs/logs/memory)만 허용. 사용자 명시 선택("PR 생성" / "계속 진행" / "다른 작업") 박힌 후 진입.`
    };
  }

  // 2. 셸 — 새 작업 동작 + 파일 쓰기 + 새 작업 커밋 차단. read-only / closeout 대상은 통과.
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = input.command;
    if (typeof command !== 'string' || !command.trim()) {
      return { action: 'allow', reason: null };
    }

    // 2a. 경로 무관 새 작업 동작 (gh pr create / git push / 새 브랜치 / dependency mutation)
    const newWorkReason = matchShellNewWork(command);
    if (newWorkReason) {
      return { action: 'block', reason: `[G-022] BLOCK_ENTRY 후 차단 — ${newWorkReason}` };
    }

    // 2b. 파일 쓰기 셸 동사 — subcommand 단위, 각 write subcommand 타겟이 전부 closeout 일 때만 통과.
    const subs = command.split(/&&|\|\||;/);
    for (const sub of subs) {
      if (SHELL_WRITE_VERB.test(sub) && !shellWriteTargetsCloseout(sub, root)) {
        return {
          action: 'block',
          reason: `[G-022] BLOCK_ENTRY 후 셸 파일 쓰기 차단 (non-closeout 타겟) — Set-Content/Out-File/sed -i 등. 사용자 명시 선택 박힌 후 진입.`
        };
      }
    }

    // 2c. 새 작업 커밋 (feat/fix/refactor/perf) — docs/chore 등 closeout 커밋은 통과
    if (/git\s+commit/.test(command)) {
      const msg = extractCommitMessage(command);
      const type = extractCommitType(msg);
      if (type && NEW_WORK_COMMIT_TYPES.has(type)) {
        return {
          action: 'block',
          reason: `[G-022] BLOCK_ENTRY 후 새 작업 커밋(${type}) 차단 — closeout(docs/chore)만 허용. 사용자 명시 선택 박힌 후 진입.`
        };
      }
    }

    return { action: 'allow', reason: null };
  }

  // 3. 그 외 tool — 차단 안 함 (fail-open, false positive 0 우선).
  return { action: 'allow', reason: null };
}
