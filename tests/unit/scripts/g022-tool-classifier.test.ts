import { describe, it, expect } from 'vitest';

import {
  classifyToolForG022,
  isCloseoutPath,
  shellWriteTargetsCloseout,
  extractCommitMessage,
  extractCommitType
} from '../../../.flowset/scripts/g022-tool-classifier.mjs';

const BLOCK = { advisory: 'BLOCK_ENTRY' as const };
const ALLOW = { advisory: 'ALLOW_ENTRY' as const };
const NEUTRAL = { advisory: 'NEUTRAL' as const };
const ROOT = 'C:\\dev\\Flowbrowser';
const MEMROOT = 'C:/Users/User/.claude/projects';

describe('g022-tool-classifier (Sprint 018 M0 T02 — G-022 blocking 전환)', () => {
  describe('isCloseoutPath — closeout 경로 (BLOCK_ENTRY 에서도 통과)', () => {
    it('.flowset/state.md (repo-relative / root-anchored 절대)', () => {
      expect(isCloseoutPath('.flowset/state.md')).toBe(true);
      expect(isCloseoutPath('C:\\dev\\Flowbrowser\\.flowset\\state.md', ROOT)).toBe(true);
    });

    it('.flowset/handoffs/ 하위', () => {
      expect(isCloseoutPath('.flowset/handoffs/2026-05-26.md')).toBe(true);
      expect(isCloseoutPath('C:\\dev\\Flowbrowser\\.flowset\\handoffs\\2026-05-26.md', ROOT)).toBe(true);
    });

    it('.flowset/logs/ 및 eval-results/', () => {
      expect(isCloseoutPath('.flowset/logs/run.jsonl')).toBe(true);
      expect(isCloseoutPath('.flowset/eval-results/r.md')).toBe(true);
    });

    it('.flowset/known-issues.md', () => {
      expect(isCloseoutPath('.flowset/known-issues.md')).toBe(true);
    });

    it('사용자 auto-memory (~/.claude/projects/<key>/memory/ 하위만)', () => {
      expect(
        isCloseoutPath('C:\\Users\\User\\.claude\\projects\\C--dev-Flowbrowser\\memory\\foo.md')
      ).toBe(true);
      expect(
        isCloseoutPath('/home/u/.claude/projects/-home-u-proj/memory/MEMORY.md')
      ).toBe(true);
    });

    it('bare MEMORY.md 광의 매칭 제거 (codex NEEDS_CHANGES #2) — 임의 위치 MEMORY.md 는 false', () => {
      expect(isCloseoutPath('docs/MEMORY.md')).toBe(false);
      expect(isCloseoutPath('src/MEMORY.md')).toBe(false);
    });

    it('non-closeout (src / specs / guardrails / prd) 는 false', () => {
      expect(isCloseoutPath('src/main/Foo.ts')).toBe(false);
      expect(isCloseoutPath('.flowset/specs/v06.md')).toBe(false);
      expect(isCloseoutPath('.flowset/guardrails.md')).toBe(false);
      expect(isCloseoutPath('docs/prd/13_local_llm.md')).toBe(false);
      expect(isCloseoutPath('tests/unit/foo.test.ts')).toBe(false);
    });

    it('root-anchor — 중첩 .flowset 우회 차단 (codex NEEDS_CHANGES #1)', () => {
      expect(isCloseoutPath('src/.flowset/handoffs/foo.ts')).toBe(false);
      expect(isCloseoutPath('tmp/.flowset/state.md')).toBe(false);
      expect(isCloseoutPath('src/.flowset/handoffs/foo.ts', ROOT)).toBe(false);
      expect(isCloseoutPath('C:\\dev\\Flowbrowser\\src\\.flowset\\state.md', ROOT)).toBe(false);
    });

    it('memory-anchor — memoryRoot 주어지면 중첩 .claude 우회 차단 (codex 4차 NEEDS_CHANGES)', () => {
      // 정상 memory 경로 (memoryRoot 하위) → allow
      expect(
        isCloseoutPath('C:/Users/User/.claude/projects/C--dev-Flowbrowser/memory/m.md', ROOT, MEMROOT)
      ).toBe(true);
      // src/.claude/... 우회 → memoryRoot 하위 아님 → false
      expect(isCloseoutPath('src/.claude/projects/x/memory/foo.md', ROOT, MEMROOT)).toBe(false);
      expect(
        isCloseoutPath('C:\\dev\\Flowbrowser\\src\\.claude\\projects\\x\\memory\\foo.md', ROOT, MEMROOT)
      ).toBe(false);
    });

    it('shellWriteTargetsCloseout — 셸 쓰기 타겟이 전부 closeout 인지', () => {
      expect(shellWriteTargetsCloseout('Set-Content .flowset/state.md -Value x')).toBe(true);
      expect(shellWriteTargetsCloseout('Set-Content src/main/Foo.ts -Value x')).toBe(false);
      // 타겟 식별 불가 → false (fail-closed)
      expect(shellWriteTargetsCloseout('Set-Content -Value x')).toBe(false);
      // 쓰기 타겟은 src, 참조만 closeout → false (타겟 기반 — codex BLOCKING)
      expect(
        shellWriteTargetsCloseout('Set-Content src/main/Foo.ts -Value (Get-Content .flowset/state.md)')
      ).toBe(false);
    });

    it('비문자열 입력은 false (fail-open)', () => {
      // @ts-expect-error - intentional type violation
      expect(isCloseoutPath(null)).toBe(false);
      // @ts-expect-error - intentional type violation
      expect(isCloseoutPath(123)).toBe(false);
    });
  });

  describe('extractCommitMessage / extractCommitType', () => {
    it('-m "..." 추출', () => {
      expect(extractCommitMessage('git commit -m "WI-S018M0-feat 기능"')).toBe('WI-S018M0-feat 기능');
    });

    it("-m '...' 추출", () => {
      expect(extractCommitMessage("git commit -m 'WI-S018M0-docs 핸드오프'")).toBe('WI-S018M0-docs 핸드오프');
    });

    it('here-doc 첫 줄 추출', () => {
      const cmd = "git commit -m \"$(cat <<'EOF'\nWI-S018M0-fix 핫픽스\n둘째 줄\nEOF\n)\"";
      expect(extractCommitMessage(cmd)).toBe('WI-S018M0-fix 핫픽스');
    });

    it('commit type 추출 (feat/docs/fix)', () => {
      expect(extractCommitType('WI-S018M0-feat 기능')).toBe('feat');
      expect(extractCommitType('WI-S018M0-docs 핸드오프')).toBe('docs');
      expect(extractCommitType('WI-001-1-fix 후속 핫픽스')).toBe('fix');
    });

    it('-am / --message= 변형 추출 (codex NEEDS_CHANGES #3)', () => {
      expect(extractCommitMessage('git commit -am "WI-S018M0-feat 기능"')).toBe('WI-S018M0-feat 기능');
      expect(extractCommitMessage('git commit --message="WI-S018M0-feat 기능"')).toBe('WI-S018M0-feat 기능');
      expect(extractCommitMessage("git commit --message 'WI-S018M0-fix 핫픽스'")).toBe('WI-S018M0-fix 핫픽스');
    });

    it('PowerShell here-string @\'...\'@ 첫 줄 추출', () => {
      const cmd = "git commit -m @'\nWI-S018M0-feat 기능\n둘째 줄\n'@";
      expect(extractCommitMessage(cmd)).toBe('WI-S018M0-feat 기능');
    });

    it('형식 미정합은 null', () => {
      expect(extractCommitType('feat: 그냥 conventional')).toBeNull();
      expect(extractCommitType(null as unknown as string)).toBeNull();
    });
  });

  describe('classifyToolForG022 — BLOCK_ENTRY 게이트 활성', () => {
    it('Write/Edit/MultiEdit + non-closeout 경로 → block', () => {
      expect(classifyToolForG022('Write', { file_path: 'src/main/Foo.ts' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Edit', { file_path: '.flowset/guardrails.md' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('MultiEdit', { file_path: '.flowset/specs/v06.md' }, BLOCK).action).toBe('block');
    });

    it('Write/Edit + closeout 경로 → allow', () => {
      expect(classifyToolForG022('Write', { file_path: '.flowset/state.md' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Edit', { file_path: '.flowset/handoffs/2026-05-26.md' }, BLOCK).action).toBe('allow');
      expect(
        classifyToolForG022(
          'Write',
          { file_path: 'C:\\Users\\User\\.claude\\projects\\C--dev-Flowbrowser\\memory\\m.md' },
          BLOCK
        ).action
      ).toBe('allow');
    });

    it('file_path 미상 → allow (fail-open)', () => {
      expect(classifyToolForG022('Write', {}, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Edit', { file_path: '' }, BLOCK).action).toBe('allow');
    });

    it('NotebookEdit + non-closeout → block / closeout → allow (codex NEEDS_CHANGES #4)', () => {
      expect(classifyToolForG022('NotebookEdit', { notebook_path: 'notebooks/x.ipynb' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('NotebookEdit', { file_path: 'notebooks/x.ipynb' }, BLOCK).action).toBe('block');
    });

    it('git commit (feat/fix/refactor/perf) → block', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-feat 기능"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-fix 핫픽스"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('PowerShell', { command: 'git commit -m "WI-S018M0-refactor 정리"' }, BLOCK).action).toBe('block');
    });

    it('git commit -am / --message= 변형도 분류 (codex NEEDS_CHANGES #3)', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit -am "WI-S018M0-feat 기능"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git commit --message="WI-S018M0-feat 기능"' }, BLOCK).action).toBe('block');
    });

    it('git commit (docs/chore/style/ci/test/revert) → allow (closeout)', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-docs 핸드오프"' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-chore 셋업"' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-test 회귀"' }, BLOCK).action).toBe('allow');
    });

    it('git commit --amend 도 분류 (feat → block / docs → allow / 메시지 없으면 allow)', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit --amend -m "WI-S018M0-feat 기능"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git commit --amend -m "WI-S018M0-docs 핸드오프"' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit --amend --no-edit' }, BLOCK).action).toBe('allow');
    });

    it('read-only Bash (status/diff/log) → allow', () => {
      expect(classifyToolForG022('Bash', { command: 'git status' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git diff --stat' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'node .flowset/scripts/transcript-reader.mjs' }, BLOCK).action).toBe('allow');
    });

    it('gh pr create / git push / 새 브랜치 / dependency 추가 → block (codex BLOCKING)', () => {
      expect(classifyToolForG022('Bash', { command: 'gh pr create --fill' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git push -u origin feature/x' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git checkout -b feat/x' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('PowerShell', { command: 'git switch -c feat/x' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'npm install lodash' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'pnpm add zod' }, BLOCK).action).toBe('block');
    });

    it('npm install -D/--save-dev <pkg> 우회 차단 (codex 4차 BLOCKING)', () => {
      expect(classifyToolForG022('Bash', { command: 'npm install -D lodash' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'npm i --save-dev vitest' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'npm install --save zod' }, BLOCK).action).toBe('block');
    });

    it('npm ci / bare install / flag-only → allow (lockfile 복원=검증 준비, codex NEEDS_CHANGES #2)', () => {
      expect(classifyToolForG022('Bash', { command: 'npm ci' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'npm install' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'pnpm install' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'npm install --production' }, BLOCK).action).toBe('allow');
    });

    it('git push --dry-run → allow (publish 아님)', () => {
      expect(classifyToolForG022('Bash', { command: 'git push --dry-run origin feature/x' }, BLOCK).action).toBe('allow');
    });

    it('셸 파일 쓰기 (Set-Content/Out-File/sed -i) + non-closeout → block (codex BLOCKING #1)', () => {
      expect(classifyToolForG022('PowerShell', { command: 'Set-Content src/main/Foo.ts -Value x' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('PowerShell', { command: 'Out-File -FilePath src/x.ts' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'sed -i "s/a/b/" src/x.ts' }, BLOCK).action).toBe('block');
    });

    it('셸 파일 쓰기 + closeout 타겟 → allow', () => {
      expect(classifyToolForG022('PowerShell', { command: 'Set-Content .flowset/state.md -Value x' }, BLOCK).action).toBe('allow');
    });

    it('chained 셸 쓰기 우회 차단 (closeout + non-closeout 혼합 — codex 3차 BLOCKING)', () => {
      expect(
        classifyToolForG022('PowerShell', { command: 'Set-Content .flowset/state.md -Value x; Set-Content src/x.ts -Value y' }, BLOCK).action
      ).toBe('block');
      expect(
        classifyToolForG022('PowerShell', { command: 'Set-Content src/x.ts -Value (Get-Content .flowset/state.md)' }, BLOCK).action
      ).toBe('block');
    });

    it('command 미상 Bash → allow (fail-open)', () => {
      expect(classifyToolForG022('Bash', {}, BLOCK).action).toBe('allow');
    });

    it('기타 tool (Read/Glob/Grep) → allow', () => {
      expect(classifyToolForG022('Read', { file_path: 'src/main/Foo.ts' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Grep', { pattern: 'x' }, BLOCK).action).toBe('allow');
    });
  });

  describe('classifyToolForG022 — 게이트 inert (BLOCK_ENTRY 아님)', () => {
    it('ALLOW_ENTRY — 새 산출물 작성 통과', () => {
      expect(classifyToolForG022('Write', { file_path: 'src/main/Foo.ts' }, ALLOW).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-feat 기능"' }, ALLOW).action).toBe('allow');
    });

    it('NEUTRAL — 통과', () => {
      expect(classifyToolForG022('Write', { file_path: 'src/main/Foo.ts' }, NEUTRAL).action).toBe('allow');
    });

    it('intent null/undefined — 통과 (fail-open)', () => {
      expect(classifyToolForG022('Write', { file_path: 'src/main/Foo.ts' }, null).action).toBe('allow');
      expect(classifyToolForG022('Write', { file_path: 'src/main/Foo.ts' }, undefined).action).toBe('allow');
    });
  });
});
