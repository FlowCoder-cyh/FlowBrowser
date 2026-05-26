import { describe, it, expect } from 'vitest';

import {
  classifyToolForG022,
  isCloseoutPath,
  extractCommitMessage,
  extractCommitType
} from '../../../.flowset/scripts/g022-tool-classifier.mjs';

const BLOCK = { advisory: 'BLOCK_ENTRY' as const };
const ALLOW = { advisory: 'ALLOW_ENTRY' as const };
const NEUTRAL = { advisory: 'NEUTRAL' as const };

describe('g022-tool-classifier (Sprint 018 M0 T02 — G-022 blocking 전환)', () => {
  describe('isCloseoutPath — closeout 경로 (BLOCK_ENTRY 에서도 통과)', () => {
    it('.flowset/state.md (forward / backslash 둘 다)', () => {
      expect(isCloseoutPath('.flowset/state.md')).toBe(true);
      expect(isCloseoutPath('C:\\dev\\Flowbrowser\\.flowset\\state.md')).toBe(true);
    });

    it('.flowset/handoffs/ 하위', () => {
      expect(isCloseoutPath('.flowset/handoffs/2026-05-26.md')).toBe(true);
      expect(isCloseoutPath('C:\\dev\\Flowbrowser\\.flowset\\handoffs\\2026-05-26.md')).toBe(true);
    });

    it('.flowset/logs/ 및 eval-results/', () => {
      expect(isCloseoutPath('.flowset/logs/run.jsonl')).toBe(true);
      expect(isCloseoutPath('.flowset/eval-results/r.md')).toBe(true);
    });

    it('.flowset/known-issues.md', () => {
      expect(isCloseoutPath('.flowset/known-issues.md')).toBe(true);
    });

    it('사용자 auto-memory (~/.claude/projects/<key>/memory/*.md + MEMORY.md)', () => {
      expect(
        isCloseoutPath('C:\\Users\\User\\.claude\\projects\\C--dev-Flowbrowser\\memory\\foo.md')
      ).toBe(true);
      expect(
        isCloseoutPath('/home/u/.claude/projects/-home-u-proj/memory/MEMORY.md')
      ).toBe(true);
    });

    it('non-closeout (src / specs / guardrails / prd) 는 false', () => {
      expect(isCloseoutPath('src/main/Foo.ts')).toBe(false);
      expect(isCloseoutPath('.flowset/specs/v06.md')).toBe(false);
      expect(isCloseoutPath('.flowset/guardrails.md')).toBe(false);
      expect(isCloseoutPath('docs/prd/13_local_llm.md')).toBe(false);
      expect(isCloseoutPath('tests/unit/foo.test.ts')).toBe(false);
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

    it('git commit (feat/fix/refactor/perf) → block', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-feat 기능"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-fix 핫픽스"' }, BLOCK).action).toBe('block');
      expect(classifyToolForG022('PowerShell', { command: 'git commit -m "WI-S018M0-refactor 정리"' }, BLOCK).action).toBe('block');
    });

    it('git commit (docs/chore/style/ci/test/revert) → allow (closeout)', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-docs 핸드오프"' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-chore 셋업"' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git commit -m "WI-S018M0-test 회귀"' }, BLOCK).action).toBe('allow');
    });

    it('git commit --amend 는 통과 (재작성 — 새 진입 아님)', () => {
      expect(classifyToolForG022('Bash', { command: 'git commit --amend -m "WI-S018M0-feat 기능"' }, BLOCK).action).toBe('allow');
    });

    it('read-only Bash (status/diff/log) → allow', () => {
      expect(classifyToolForG022('Bash', { command: 'git status' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git diff --stat' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'node .flowset/scripts/transcript-reader.mjs' }, BLOCK).action).toBe('allow');
    });

    it('gh pr create / git push → allow (closeout PR 보호 — 게이트 대상 아님)', () => {
      expect(classifyToolForG022('Bash', { command: 'gh pr create --fill' }, BLOCK).action).toBe('allow');
      expect(classifyToolForG022('Bash', { command: 'git push -u origin feature/x' }, BLOCK).action).toBe('allow');
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
