#!/usr/bin/env node
// G-018 산출물 매트릭스 vs 실측 git diff 자동 대조 + G-021 dual review 증거 regex
//
// 사용 (CLI): node verify-pr-body.mjs <PR_BODY_FILE> <NUMSTAT_FILE>
// 사용 (programmatic): import { verifyG018, verifyG021 } from './verify-pr-body.mjs'
//
// 출처: Sprint 017 M5 mini-milestone β (codex 019e5119 §5 + 019e5129 NEEDS_CHANGES #5 권고).

import { readFileSync } from 'node:fs';

// UUID v7 일반 검증 (codex 019e514b NEEDS_CHANGES #1 정합 — `019e` prefix 강제 시 시간대 바뀌면 false negative).
// RFC 9562 UUID v7: timestamp(48) + ver(4)=7 + rand_a(12) + var(2)=10 + rand_b(62)
const UUID_V7_RE = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EVALUATOR_COUNT_RE = /Pass\s+(\d+)\s*\/\s*Partial\s+(\d+)\s*\/\s*Fail\s+(\d+)/;
const CODEX_COUNT_RE = /BLOCKING\s+(\d+)\s*\/\s*NEEDS_CHANGES\s+(\d+)\s*\/\s*(?:NOTABLE|NB)\s+(\d+)/;

export function parseMatrixTable(prBody) {
  // 본문 안의 백틱 인용 (예: `## 산출물 매트릭스`) 매칭 차단 — line anchor 강제.
  // negative lookahead `(?!\n##\s|\n---|\n\*\*총\*\*)` — 다음 ## 헤더 / --- / **총** 만나기 전까지 매칭.
  const sectionMatch = prBody.match(
    /^##\s+산출물 매트릭스[^\n]*\n((?:(?!\n##\s|\n---|\n\*\*총\*\*)[\s\S])*)/m
  );
  if (!sectionMatch) return null;
  const rows = [...sectionMatch[1].matchAll(/^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|[^\n]*\|/gm)];
  return rows.map((r) => ({ path: r[1], plus: Number(r[2]), minus: Number(r[3]) }));
}

export function parseTotalLine(prBody) {
  // line anchor + 본문 안 인용 차단.
  const match = prBody.match(/^\*\*총\*\*\s*:\s*\*{0,2}\s*\+(\d+)\s*\/\s*-(\d+)\s*\/\s*(\d+)\s*파일/m);
  if (!match) return null;
  return { plus: Number(match[1]), minus: Number(match[2]), files: Number(match[3]) };
}

export function parseNumstat(numstatText) {
  // codex 019e514b NEEDS_CHANGES #2 정합 — binary 파일 `-\t-\tpath` 는 skip (NaN 파싱 차단).
  return numstatText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      if (parts[0] === '-' || parts[1] === '-') {
        return { path: parts[2], plus: null, minus: null, binary: true };
      }
      return { path: parts[2], plus: Number(parts[0]), minus: Number(parts[1]), binary: false };
    });
}

export function verifyG018(prBody, numstatText) {
  const errors = [];
  const matrix = parseMatrixTable(prBody);
  if (!matrix) {
    errors.push('PR body 산출물 매트릭스 표 파싱 실패 — `## 산출물 매트릭스` 섹션 + 표 양식 (G-018)');
    return errors;
  }
  const numstat = parseNumstat(numstatText);
  const numstatPaths = new Set(numstat.map((r) => r.path));
  const matrixPaths = new Set(matrix.map((r) => r.path));
  // 실측 → 매트릭스 누락 검출 (실측에 있지만 매트릭스 없음)
  for (const r of numstat) {
    if (!matrixPaths.has(r.path)) {
      errors.push(`실측 변경 파일 \`${r.path}\` 산출물 매트릭스 누락 (G-018 위반)`);
    }
  }
  // 매트릭스 → 실측 누락 검출 (codex 019e514b NEEDS_CHANGES #3 정합 — 양방향 대조)
  for (const m of matrix) {
    if (!numstatPaths.has(m.path)) {
      errors.push(`산출물 매트릭스 \`${m.path}\` 실측 변경 파일 없음 — 매트릭스에 박혔지만 실제 변경 X (G-018 위반)`);
    }
  }
  // 수치 불일치 검출 (binary 파일 skip)
  for (const m of matrix) {
    const actual = numstat.find((r) => r.path === m.path);
    if (!actual) continue;
    if (actual.binary) continue; // binary 파일은 numeric 비교 skip (codex 019e514b NEEDS_CHANGES #2)
    if (m.plus !== actual.plus || m.minus !== actual.minus) {
      errors.push(
        `산출물 매트릭스 \`${m.path}\` 수치 불일치 — 매트릭스 +${m.plus}/-${m.minus} vs 실측 +${actual.plus}/-${actual.minus} (G-018 위반)`
      );
    }
  }
  // 합계 검증 — total 행 필수 (codex 019e514b NEEDS_CHANGES #4 정합)
  const total = parseTotalLine(prBody);
  if (!total) {
    errors.push('PR body 산출물 매트릭스 `**총**: +N / -N / M 파일` 행 누락 — G-018 위반 (총합 명시 강제)');
  } else {
    const nonBinary = numstat.filter((r) => !r.binary);
    const actualPlus = nonBinary.reduce((s, r) => s + r.plus, 0);
    const actualMinus = nonBinary.reduce((s, r) => s + r.minus, 0);
    const actualFiles = numstat.length;
    if (total.plus !== actualPlus || total.minus !== actualMinus || total.files !== actualFiles) {
      errors.push(
        `산출물 매트릭스 총합 불일치 — 표기 +${total.plus}/-${total.minus}/${total.files} 파일 vs 실측 +${actualPlus}/-${actualMinus}/${actualFiles} 파일 (G-018 위반)`
      );
    }
  }
  return errors;
}

export function verifyG021(prBody) {
  const errors = [];
  // line anchor 강제 — 본문 안 백틱 인용 (`## Dual Review`) 매칭 차단.
  const sectionMatch = prBody.match(
    /^##\s+Dual Review[^\n]*\n((?:(?!\n##\s)[\s\S])*)/m
  );
  if (!sectionMatch) {
    errors.push('PR body Dual Review 섹션 누락 (G-021 위반)');
    return errors;
  }
  const section = sectionMatch[0];
  const evalLine = section.match(/^-\s*\[x\]\s*evaluator[^\n]*/m);
  if (!evalLine) {
    errors.push('Dual Review evaluator 체크박스 누락 (G-021 위반)');
  } else if (!EVALUATOR_COUNT_RE.test(evalLine[0])) {
    errors.push('evaluator 행 `Pass N / Partial M / Fail K` 카운트 누락 (G-021 위반 — 카운트 명시 강제)');
  }
  const codexLine = section.match(/^-\s*\[x\]\s*codex[^\n]*/m);
  if (!codexLine) {
    errors.push('Dual Review codex 체크박스 누락 (G-021 위반)');
  } else {
    if (!UUID_V7_RE.test(codexLine[0])) {
      errors.push(
        'codex 행 thread ID UUID v7 패턴 누락 (G-021 위반 — `019eXXXX-XXXX-7XXX-XXXX-XXXXXXXXXXXX` full UUID 필수, 자가 위조 차단)'
      );
    }
    if (!CODEX_COUNT_RE.test(codexLine[0])) {
      errors.push(
        'codex 행 `BLOCKING N / NEEDS_CHANGES M / NOTABLE K` 카운트 누락 (G-021 위반 — `NB` 약어도 허용)'
      );
    }
  }
  return errors;
}

const isCliEntry = (() => {
  if (!process.argv[1]) return false;
  const url = import.meta.url.replace(/\\/g, '/');
  const arg = process.argv[1].replace(/\\/g, '/');
  return url.endsWith(arg) || arg.endsWith(url.replace(/^file:\/\/\/?/, ''));
})();

if (isCliEntry) {
  const [prBodyFile, numstatFile] = process.argv.slice(2);
  if (!prBodyFile || !numstatFile) {
    console.error('사용: node verify-pr-body.mjs <PR_BODY_FILE> <NUMSTAT_FILE>');
    process.exit(2);
  }
  const prBody = readFileSync(prBodyFile, 'utf-8');
  const numstat = readFileSync(numstatFile, 'utf-8');
  const errors = [...verifyG018(prBody, numstat), ...verifyG021(prBody)];
  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log('verify-pr-body PASS (G-018 + G-021 정합)');
  process.exit(0);
}
