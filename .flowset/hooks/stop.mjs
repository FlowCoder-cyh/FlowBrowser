#!/usr/bin/env node
// FlowSet Stop hook — 세션 종료 시 종합 점검.
//
// 글로벌 CLAUDE.md v3.4 — Hook "결과물 게이트" 중 Stop 분담.
// 점검:
// 1. 오늘 핸드오프 작성 여부 (P-006)
// 2. state.md "최근 갱신: YYYY-MM-DD" 오늘 반영 여부
// 3. 최근 main commits 형식 G-009 (직전 5개)
// 4. 로컬 미머지 브랜치 (정보)
// 5. dual review 환기 (학습 #8)
//
// 출력: stderr 권고 (block 안 함)

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const flowset = join(repoRoot, '.flowset');

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const today = todayIso();
const warnings = [];
const infos = [];

// 1. 오늘 핸드오프
const todayHandoff = join(flowset, 'handoffs', `${today}.md`);
if (!existsSync(todayHandoff)) {
  warnings.push(`[P-006] 오늘 핸드오프 (${today}.md) 미작성 — 작업 종료 시 필요.`);
} else {
  infos.push(`[P-006] 오늘 핸드오프 (${today}.md) 존재.`);
}

// 2. state.md 최근 갱신
const stateMd = join(flowset, 'state.md');
if (existsSync(stateMd)) {
  const head = readFileSync(stateMd, 'utf8').split(/\r?\n/).slice(0, 30).join('\n');
  if (head.includes(`최근 갱신`) && head.includes(today)) {
    infos.push(`[state.md] '최근 갱신: ${today}' 반영됨.`);
  } else {
    warnings.push(`[state.md] '최근 갱신: ${today}' 미반영 — 작업 종료 시 동기화 필요.`);
  }
}

// 3. 최근 commits 형식
try {
  const log = execSync('git log --no-merges --format="%H %s" -5', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const pattern = /^[a-f0-9]+ WI-([0-9A-Za-z]+(-[0-9]+)?-(feat|fix|docs|style|refactor|test|chore|perf|ci|revert)|chore|docs)\s+.+/;
  const lines = log.split(/\r?\n/).filter((l) => l.trim());
  const violations = lines.filter((l) => !pattern.test(l));
  if (violations.length > 0) {
    warnings.push(`[G-009] 최근 commits 중 형식 위반: ${violations.length}건`);
  }
} catch {
  // git 호출 실패 시 무시
}

// 4. 로컬 미머지 브랜치
try {
  const branches = execSync('git branch --format="%(refname:short)"', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b && b !== 'main' && b !== 'master');
  if (branches.length > 0) {
    infos.push(`[git] 로컬 미머지 브랜치 ${branches.length}개 — main 머지/삭제 권고.`);
  }
} catch {
  // 무시
}

// 4b. Sprint 016 M0 (학습 #13 후속) — G-017: 잔존 원격 브랜치 점검.
// MERGED/CLOSED PR 의 브랜치가 origin 에 잔존하면 경고. GitHub `delete_branch_on_merge` 정책은
// MERGED 한정 — CLOSED 는 자동 삭제 안 되므로 수동 cleanup 강제.
try {
  // 원격 브랜치 목록 (main 제외)
  const remoteBranches = execSync(
    'git for-each-ref --format="%(refname:short)" refs/remotes/origin',
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
    .split(/\r?\n/)
    .map((b) => b.trim().replace(/^origin\//, ''))
    .filter((b) => b && b !== 'main' && b !== 'HEAD' && !b.startsWith('HEAD'));

  if (remoteBranches.length > 0) {
    // gh 가 설치되어 있는지 검사 (없으면 skip)
    try {
      execSync('gh --version', { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      // gh 미설치 시 단순 카운트만 알림
      infos.push(
        `[G-017] 원격 미머지/미정리 브랜치 ${remoteBranches.length}개 (gh CLI 미설치 — 상세 점검 skip).`
      );
      throw new Error('gh-missing');
    }

    const staleClosed = [];
    const staleMerged = [];
    let ghLookupFailures = 0;
    for (const branch of remoteBranches) {
      try {
        // codex review #1 흡수: execFileSync 로 shell injection 회피 (branch 가 git ref 값이라 완전한 상수 아님)
        const json = execFileSync(
          'gh',
          [
            'pr',
            'list',
            '--state',
            'all',
            '--head',
            branch,
            '--json',
            'number,state,mergedAt',
            '--limit',
            '1',
          ],
          {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }
        );
        const prs = JSON.parse(json);
        if (prs.length === 0) continue; // PR 없는 active 브랜치는 skip
        const pr = prs[0];
        if (pr.state === 'MERGED') staleMerged.push(`#${pr.number} ${branch}`);
        else if (pr.state === 'CLOSED' && !pr.mergedAt) staleClosed.push(`#${pr.number} ${branch}`);
      } catch {
        // codex review #2 흡수: 개별 실패를 graceful skip 으로 보이게 카운트
        ghLookupFailures += 1;
      }
    }
    if (staleClosed.length > 0) {
      warnings.push(
        `[G-017] CLOSED PR 의 잔존 원격 브랜치 ${staleClosed.length}개 — 정책상 자동 삭제 안 됨, 수동 \`git push origin --delete <branch>\` 필요: ${staleClosed.join(' / ')}`
      );
    }
    if (staleMerged.length > 0) {
      warnings.push(
        `[G-017] MERGED PR 의 잔존 원격 브랜치 ${staleMerged.length}개 — \`gh pr merge --delete-branch\` 옵션 누락 가능성, 수동 정리 권고: ${staleMerged.join(' / ')}`
      );
    }
    if (ghLookupFailures > 0) {
      infos.push(
        `[G-017] gh PR lookup 개별 실패 ${ghLookupFailures}건 (인증/API/네트워크 가능성) — graceful skip, 원격 브랜치 분류 미완.`
      );
    }
  }
} catch {
  // 무시 (gh-missing 또는 git for-each-ref 실패)
}

// 5. dual review 환기
infos.push('[학습 #8/#13] 본 세션 모든 PR / 핸드오프 / Milestone 종료 시 evaluator + `/codex:review` (review-only) 병렬 호출 완료 여부 자가 점검. `/codex:rescue` 사용 시 write 권한 부여 — dual review 표준 위반.');

process.stderr.write('=== [FlowSet Stop 점검] ===\n');
if (warnings.length > 0) {
  process.stderr.write('-- 경고 --\n');
  for (const w of warnings) process.stderr.write(w + '\n');
}
if (infos.length > 0) {
  process.stderr.write('-- 정보 --\n');
  for (const i of infos) process.stderr.write(i + '\n');
}
process.stderr.write('=== ===\n');

process.exit(0);
