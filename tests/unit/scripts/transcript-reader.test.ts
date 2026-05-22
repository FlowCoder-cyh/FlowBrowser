import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  cwdToProjectKey,
  discoverTranscriptSource,
  discoverTranscriptSourceCandidates,
  extractRecentUserUtterances
} from '../../../.flowset/scripts/transcript-reader.mjs';

describe('transcript-reader (Sprint 018 M0 T01 — Claude Code transcript helper)', () => {
  describe('cwdToProjectKey', () => {
    it('Windows path 변환 (`C:\\dev\\Flowbrowser` → `C--dev-Flowbrowser`)', () => {
      expect(cwdToProjectKey('C:\\dev\\Flowbrowser')).toBe('C--dev-Flowbrowser');
    });

    it('Unix path 변환 (`/home/user/project` → `-home-user-project`)', () => {
      expect(cwdToProjectKey('/home/user/project')).toBe('-home-user-project');
    });

    it('mixed separator path', () => {
      expect(cwdToProjectKey('C:/dev/Flowbrowser')).toBe('C--dev-Flowbrowser');
    });

    it('non-string throws TypeError', () => {
      // @ts-expect-error - intentional type violation
      expect(() => cwdToProjectKey(null)).toThrow(TypeError);
      // @ts-expect-error - intentional type violation
      expect(() => cwdToProjectKey(123)).toThrow(TypeError);
    });
  });

  describe('discoverTranscriptSource — fallback path', () => {
    it('존재하지 않는 cwd 는 source: null + reason 박음', () => {
      const result = discoverTranscriptSource('Z:\\nonexistent\\path-12345-xyz');
      expect(result.source).toBeNull();
      expect(result.reason).toContain('project dir not found');
    });
  });

  describe('extractRecentUserUtterances — fixture 기반', () => {
    let tmpDir: string;
    let fixturePath: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'flowset-transcript-test-'));
      fixturePath = join(tmpDir, 'fixture.jsonl');
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('user message string content 추출', () => {
      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: '첫번째 발화' }, uuid: 'u1', timestamp: '2026-01-01T00:00:00Z' }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: '두번째 발화' }, uuid: 'u2', timestamp: '2026-01-01T00:00:01Z' })
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 3);
      expect(result.utterances.map((u) => u.text)).toEqual(['첫번째 발화', '두번째 발화']);
    });

    it('user message array content (text block) 추출', () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'block1' },
              { type: 'text', text: 'block2' }
            ]
          },
          uuid: 'u3'
        })
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 1);
      expect(result.utterances[0].text).toBe('block1\nblock2');
    });

    it('sidechain user message skip', () => {
      const lines = [
        JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: '서브에이전트 발화' } }),
        JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: '메인 발화' } })
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 5);
      expect(result.utterances.map((u) => u.text)).toEqual(['메인 발화']);
    });

    it('JSON 파싱 실패 line skip', () => {
      const lines = [
        'not-json-line',
        JSON.stringify({ type: 'user', message: { role: 'user', content: '발화' } }),
        '{broken json'
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 5);
      expect(result.utterances.map((u) => u.text)).toEqual(['발화']);
    });

    it('빈 파일은 utterances 0건 + reason null', () => {
      writeFileSync(fixturePath, '', 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 3);
      expect(result.utterances).toEqual([]);
      expect(result.reason).toBeNull();
    });

    it('N 인자 정합 — 최신 N건만 반환', () => {
      const lines = [];
      for (let i = 1; i <= 5; i++) {
        lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `발화${i}` } }));
      }
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 2);
      expect(result.utterances.map((u) => u.text)).toEqual(['발화4', '발화5']);
    });

    it('source 없음 — utterances 0 + reason 박힘', () => {
      const result = extractRecentUserUtterances(null, 3);
      expect(result.utterances).toEqual([]);
      expect(result.reason).toBe('source not found');
    });

    it('userType external 만 (internal/system skip)', () => {
      const lines = [
        JSON.stringify({ type: 'user', userType: 'internal', message: { role: 'user', content: 'internal 발화' } }),
        JSON.stringify({ type: 'user', userType: 'external', message: { role: 'user', content: 'external 발화' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'no userType 발화' } })
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 5);
      expect(result.utterances.map((u) => u.text)).toEqual(['external 발화', 'no userType 발화']);
    });

    it('isMeta:true 박힌 caveat 행 skip (codex 019e5193 NEEDS_CHANGES #1 정합)', () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          userType: 'external',
          isMeta: true,
          message: { role: 'user', content: 'caveat 메타 행 (실 사용자 발화 아님)' }
        }),
        JSON.stringify({
          type: 'user',
          userType: 'external',
          message: { role: 'user', content: '실 사용자 발화' }
        })
      ];
      writeFileSync(fixturePath, lines.join('\n'), 'utf8');
      const result = extractRecentUserUtterances(fixturePath, 5);
      expect(result.utterances.map((u) => u.text)).toEqual(['실 사용자 발화']);
    });
  });

  describe('discoverTranscriptSource — smoke (homedir 의존)', () => {
    it('homedir() 기반 path (smoke — discoverTranscriptSource 호출 자체 정합)', () => {
      // 본 회귀는 실제 homedir() 의 ~/.claude/projects/ 의존 — fixture mocking 어려움.
      // discoverTranscriptSource 가 throw 없이 path 또는 null 반환 정합 확인.
      const result = discoverTranscriptSource(process.cwd());
      // 본 프로젝트 path 존재 시 source 박힘, 없으면 null + reason
      expect(typeof result.source === 'string' || result.source === null).toBe(true);
      if (result.source === null) {
        expect(typeof result.reason).toBe('string');
      }
    });
  });

  // codex 019e5193 NEEDS_CHANGES #3 정합 — FLOWSET_CLAUDE_PROJECTS_DIR 환경 override path 박은 fixture 회귀.
  // 본 회귀는 module re-import 박는 path — vi.resetModules + dynamic import 박음.
  describe('discoverTranscriptSourceCandidates — fixture 기반 (env override)', () => {
    let tmpHome: string;

    beforeEach(() => {
      tmpHome = mkdtempSync(join(tmpdir(), 'flowset-home-test-'));
    });

    afterEach(() => {
      rmSync(tmpHome, { recursive: true, force: true });
      delete process.env.FLOWSET_CLAUDE_PROJECTS_DIR;
    });

    it('candidates 박힘 — newest-to-oldest sort (mtime 정합)', () => {
      const projectsDir = join(tmpHome, 'projects');
      mkdirSync(projectsDir, { recursive: true });
      const projectKey = cwdToProjectKey('C:\\dev\\TestProj');
      const projectDir = join(projectsDir, projectKey);
      mkdirSync(projectDir, { recursive: true });
      const older = join(projectDir, 'older.jsonl');
      const middle = join(projectDir, 'middle.jsonl');
      const newest = join(projectDir, 'newest.jsonl');
      writeFileSync(older, '{}\n', 'utf8');
      writeFileSync(middle, '{}\n', 'utf8');
      writeFileSync(newest, '{}\n', 'utf8');
      const now = Date.now() / 1000;
      utimesSync(older, now - 300, now - 300);
      utimesSync(middle, now - 150, now - 150);
      utimesSync(newest, now, now);

      process.env.FLOWSET_CLAUDE_PROJECTS_DIR = projectsDir;
      const result = discoverTranscriptSourceCandidates('C:\\dev\\TestProj');
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0]).toBe(newest);
      expect(result.candidates[1]).toBe(middle);
      expect(result.candidates[2]).toBe(older);
    });

    it('candidates 0건 — project dir 박혔지만 jsonl 0건', () => {
      const projectsDir = join(tmpHome, 'projects');
      mkdirSync(projectsDir, { recursive: true });
      const projectKey = cwdToProjectKey('C:\\dev\\EmptyProj');
      mkdirSync(join(projectsDir, projectKey), { recursive: true });
      process.env.FLOWSET_CLAUDE_PROJECTS_DIR = projectsDir;
      const result = discoverTranscriptSourceCandidates('C:\\dev\\EmptyProj');
      expect(result.candidates).toEqual([]);
      expect(result.reason).toContain('no jsonl files');
    });
  });

  // mkdirSync 사용 (위 fixture path 정합 박음)
  void mkdirSync;
});
