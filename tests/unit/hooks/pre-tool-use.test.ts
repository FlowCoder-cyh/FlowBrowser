import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  evaluateG022Gate,
  resolveLatestUtterance,
  evaluateShellChecks
} from '../../../.flowset/hooks/pre-tool-use.mjs';

function userLine(text: string, ts = '2026-05-26T00:00:00Z') {
  return JSON.stringify({
    type: 'user',
    userType: 'external',
    message: { role: 'user', content: text },
    uuid: 'u-' + ts,
    timestamp: ts
  });
}

describe('pre-tool-use hook (Sprint 018 M0 T02 — G-022 blocking 전환)', () => {
  let tmpDir: string;
  let blockTranscript: string;
  let allowTranscript: string;
  let neutralTranscript: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flowset-pretooluse-test-'));
    blockTranscript = join(tmpDir, 'block.jsonl');
    allowTranscript = join(tmpDir, 'allow.jsonl');
    neutralTranscript = join(tmpDir, 'neutral.jsonl');
    // 최신 발화 = 마지막 user 행 (extractRecentUserUtterances 가 마지막 N건 반환)
    writeFileSync(
      blockTranscript,
      [userLine('이전 발화', '2026-05-26T00:00:00Z'), userLine('오늘은 세션 마무리하자', '2026-05-26T01:00:00Z')].join('\n'),
      'utf8'
    );
    writeFileSync(
      allowTranscript,
      [userLine('오늘은 세션 마무리하자', '2026-05-26T00:00:00Z'), userLine('아니 계속 진행해', '2026-05-26T01:00:00Z')].join('\n'),
      'utf8'
    );
    writeFileSync(neutralTranscript, userLine('파일 위치가 어디지'), 'utf8');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveLatestUtterance — transcript_path 우선', () => {
    it('transcript_path 의 마지막 user 발화 박음', () => {
      const u = resolveLatestUtterance({ transcript_path: blockTranscript });
      expect(u?.text).toBe('오늘은 세션 마무리하자');
    });

    it('transcript_path 미상 + cwd 미상 — null (fail-open)', () => {
      const u = resolveLatestUtterance({ cwd: 'Z:\\nonexistent-xyz-123' });
      expect(u).toBeNull();
    });

    it('transcript_path 주어졌으나 발화 0건 — fallback 안 함, null (codex NEEDS_CHANGES #1)', () => {
      // 빈 transcript_path → stale discovery 로 fallback 하면 안 됨 (false positive 회피)
      const empty = join(tmpDir, 'empty.jsonl');
      writeFileSync(empty, '', 'utf8');
      const u = resolveLatestUtterance({ transcript_path: empty });
      expect(u).toBeNull();
    });
  });

  describe('evaluateG022Gate — BLOCK_ENTRY 발화', () => {
    it('새 산출물 작성 (src) → block', () => {
      const r = evaluateG022Gate({
        tool_name: 'Write',
        tool_input: { file_path: 'src/main/Foo.ts' },
        transcript_path: blockTranscript
      });
      expect(r.block).toBe(true);
      expect(r.reason).toContain('G-022');
    });

    it('closeout 작성 (state.md / handoffs) → allow', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Write',
          tool_input: { file_path: '.flowset/state.md' },
          transcript_path: blockTranscript
        }).block
      ).toBe(false);
      expect(
        evaluateG022Gate({
          tool_name: 'Edit',
          tool_input: { file_path: '.flowset/handoffs/2026-05-26.md' },
          transcript_path: blockTranscript
        }).block
      ).toBe(false);
    });

    it('NotebookEdit (non-closeout) → block (hook gate set 포함 — e2e 회귀)', () => {
      const r = evaluateG022Gate({
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: 'nb/x.ipynb' },
        transcript_path: blockTranscript
      });
      expect(r.block).toBe(true);
    });

    it('gh pr create / git push / npm install → block', () => {
      for (const command of ['gh pr create --fill', 'git push -u origin feature/x', 'npm install lodash']) {
        expect(
          evaluateG022Gate({ tool_name: 'Bash', tool_input: { command }, transcript_path: blockTranscript }).block
        ).toBe(true);
      }
    });

    it('새 작업 커밋 (feat) → block / docs 커밋 → allow', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "WI-S018M0-feat 기능"' },
          transcript_path: blockTranscript
        }).block
      ).toBe(true);
      expect(
        evaluateG022Gate({
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "WI-S018M0-docs 핸드오프"' },
          transcript_path: blockTranscript
        }).block
      ).toBe(false);
    });
  });

  describe('evaluateG022Gate — 허용/중립/실패 발화는 게이트 inert', () => {
    it('ALLOW_ENTRY (계속 진행) — src 작성 통과', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Write',
          tool_input: { file_path: 'src/main/Foo.ts' },
          transcript_path: allowTranscript
        }).block
      ).toBe(false);
    });

    it('NEUTRAL — 통과', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Write',
          tool_input: { file_path: 'src/main/Foo.ts' },
          transcript_path: neutralTranscript
        }).block
      ).toBe(false);
    });

    it('transcript 미발견 — fail-open (block false)', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Write',
          tool_input: { file_path: 'src/main/Foo.ts' },
          transcript_path: join(tmpDir, 'does-not-exist.jsonl'),
          cwd: 'Z:\\nonexistent-xyz-123'
        }).block
      ).toBe(false);
    });

    it('비게이트 tool (Read) — block false', () => {
      expect(
        evaluateG022Gate({
          tool_name: 'Read',
          tool_input: { file_path: 'src/main/Foo.ts' },
          transcript_path: blockTranscript
        }).block
      ).toBe(false);
    });
  });

  describe('evaluateShellChecks — 기존 결정적 점검 보존 (G-007 / wi-flowset / G-009 / dual review)', () => {
    it('main 직접 push → block', () => {
      const r = evaluateShellChecks('git push origin main');
      expect(r.blocks.some((b) => b.includes('G-007'))).toBe(true);
    });

    it('.flowset/state.md 삭제 → block', () => {
      const r = evaluateShellChecks('rm .flowset/state.md');
      expect(r.blocks.some((b) => b.includes('wi-flowset'))).toBe(true);
    });

    it('.flowset/hooks 작업은 통과 (예외)', () => {
      const r = evaluateShellChecks('rm .flowset/hooks/tmp.mjs');
      expect(r.blocks).toHaveLength(0);
    });

    it('커밋 형식 위반 → warning', () => {
      const r = evaluateShellChecks('git commit -m "wrong format"');
      expect(r.warnings.some((w) => w.includes('G-009'))).toBe(true);
    });

    it('정상 커밋 형식 → warning 없음', () => {
      const r = evaluateShellChecks('git commit -m "WI-S018M0-feat 기능 추가"');
      expect(r.warnings.some((w) => w.includes('G-009'))).toBe(false);
    });

    it('gh pr create → dual review 환기 warning', () => {
      const r = evaluateShellChecks('gh pr create --fill');
      expect(r.warnings.some((w) => w.includes('dual review'))).toBe(true);
    });

    it('일반 명령 → 무경고/무차단', () => {
      const r = evaluateShellChecks('git status');
      expect(r.warnings).toHaveLength(0);
      expect(r.blocks).toHaveLength(0);
    });
  });
});
