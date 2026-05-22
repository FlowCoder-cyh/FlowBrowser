import { describe, it, expect } from 'vitest';

import {
  parseMatrixTable,
  parseTotalLine,
  parseNumstat,
  verifyG018,
  verifyG021
} from '../../../.flowset/scripts/verify-pr-body.mjs';

describe('verify-pr-body (G-018 + G-021 자동 검증)', () => {
  describe('parseMatrixTable (G-018)', () => {
    it('정상 매트릭스 표 파싱', () => {
      const body = `## 산출물 매트릭스 (G-018)

| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | 첫 |
| \`b/c.ts\` | 20 | 0 | 둘째 |

**총**: **+30 / -5 / 2 파일**`;
      const result = parseMatrixTable(body);
      expect(result).toEqual([
        { path: 'a.md', plus: 10, minus: 5 },
        { path: 'b/c.ts', plus: 20, minus: 0 }
      ]);
    });

    it('산출물 매트릭스 섹션 없으면 null', () => {
      expect(parseMatrixTable('## 다른 섹션')).toBeNull();
    });

    it('빈 매트릭스 (헤더만) 도 empty array', () => {
      const body = `## 산출물 매트릭스

| 파일 | + | - | 비고 |
|---|---|---|---|`;
      expect(parseMatrixTable(body)).toEqual([]);
    });

    it('본문 안 백틱 인용 `## 산출물 매트릭스` 매칭 차단 — line anchor 강제 (self-check 발견 bug)', () => {
      const body = `## 다른 섹션

설명에 \`## 산출물 매트릭스\` 인용이 박힘.

## 산출물 매트릭스

| 파일 | + | - | 비고 |
|---|---|---|---|
| \`real.md\` | 5 | 0 | x |

**총**: +5 / -0 / 1 파일`;
      const result = parseMatrixTable(body);
      expect(result).toEqual([{ path: 'real.md', plus: 5, minus: 0 }]);
    });
  });

  describe('parseTotalLine (G-018)', () => {
    it('총합 행 파싱 — 굵게 강조 없음', () => {
      expect(parseTotalLine('**총**: +30 / -5 / 2 파일')).toEqual({ plus: 30, minus: 5, files: 2 });
    });

    it('총합 행 파싱 — 굵게 강조', () => {
      expect(parseTotalLine('**총**: **+145 / -16 / 4 파일** (실측 수치)')).toEqual({
        plus: 145,
        minus: 16,
        files: 4
      });
    });

    it('총합 행 없으면 null', () => {
      expect(parseTotalLine('내용만 박힌 PR body')).toBeNull();
    });
  });

  describe('parseNumstat (G-018)', () => {
    it('git diff --numstat 출력 파싱', () => {
      const numstat = '10\t5\ta.md\n20\t0\tb/c.ts';
      expect(parseNumstat(numstat)).toEqual([
        { path: 'a.md', plus: 10, minus: 5, binary: false },
        { path: 'b/c.ts', plus: 20, minus: 0, binary: false }
      ]);
    });

    it('빈 입력은 empty array', () => {
      expect(parseNumstat('')).toEqual([]);
    });

    it('binary 파일 `-\\t-\\tpath` skip (codex 019e514b NEEDS_CHANGES #2 정합)', () => {
      const numstat = '10\t5\ta.md\n-\t-\timage.png';
      expect(parseNumstat(numstat)).toEqual([
        { path: 'a.md', plus: 10, minus: 5, binary: false },
        { path: 'image.png', plus: null, minus: null, binary: true }
      ]);
    });
  });

  describe('verifyG018 — 정상 정합 path', () => {
    it('매트릭스 = 실측 정합 (errors empty)', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |

**총**: +10 / -5 / 1 파일`;
      const numstat = '10\t5\ta.md';
      expect(verifyG018(body, numstat)).toEqual([]);
    });

    it('매트릭스 + 다중 파일 정합', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |
| \`b/c.ts\` | 20 | 0 | y |

**총**: +30 / -5 / 2 파일`;
      const numstat = '10\t5\ta.md\n20\t0\tb/c.ts';
      expect(verifyG018(body, numstat)).toEqual([]);
    });
  });

  describe('verifyG018 — 위반 검출', () => {
    it('매트릭스 섹션 누락 검출', () => {
      const body = '## 다른 섹션';
      const errors = verifyG018(body, '10\t5\ta.md');
      expect(errors.some((e: string) => e.includes('산출물 매트릭스') && e.includes('파싱 실패'))).toBe(true);
    });

    it('파일 누락 검출 — 실측에 있지만 매트릭스 없음', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |

**총**: +10 / -5 / 1 파일`;
      const numstat = '10\t5\ta.md\n20\t0\tb.ts';
      const errors = verifyG018(body, numstat);
      expect(errors.some((e: string) => e.includes('b.ts') && e.includes('누락'))).toBe(true);
    });

    it('수치 불일치 검출', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |

**총**: +10 / -5 / 1 파일`;
      const numstat = '15\t5\ta.md';
      const errors = verifyG018(body, numstat);
      expect(errors.some((e: string) => e.includes('a.md') && e.includes('수치 불일치'))).toBe(true);
    });

    it('합계 불일치 검출 — 매트릭스 행 정합하지만 총합 표기 어긋남', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |

**총**: +20 / -5 / 1 파일`;
      const numstat = '10\t5\ta.md';
      const errors = verifyG018(body, numstat);
      expect(errors.some((e: string) => e.includes('총합 불일치'))).toBe(true);
    });

    it('매트릭스 → 실측 누락 검출 (codex 019e514b NEEDS_CHANGES #3 정합 양방향 대조)', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |
| \`gone-away.md\` | 5 | 0 | x |

**총**: +15 / -5 / 2 파일`;
      const numstat = '10\t5\ta.md'; // gone-away.md 실측 없음
      const errors = verifyG018(body, numstat);
      expect(errors.some((e: string) => e.includes('gone-away.md') && e.includes('실측 변경 파일 없음'))).toBe(true);
    });

    it('total 행 누락 검출 (codex 019e514b NEEDS_CHANGES #4 정합 — total 필수)', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |
`;
      const numstat = '10\t5\ta.md';
      const errors = verifyG018(body, numstat);
      expect(errors.some((e: string) => e.includes('총') && e.includes('행 누락'))).toBe(true);
    });

    it('binary 파일 포함 시 numeric 비교 skip + 파일 수 합계 정합', () => {
      const body = `## 산출물 매트릭스
| 파일 | + | - | 비고 |
|---|---|---|---|
| \`a.md\` | 10 | 5 | x |
| \`image.png\` | 0 | 0 | binary |

**총**: +10 / -5 / 2 파일`;
      const numstat = '10\t5\ta.md\n-\t-\timage.png';
      // binary 는 numeric 비교 skip — image.png 매트릭스 +0/-0 표기해도 통과
      // 단, total 의 파일 수는 binary 포함하여 2 정합 필요
      expect(verifyG018(body, numstat)).toEqual([]);
    });
  });

  describe('verifyG021 — 정상 정합 path', () => {
    it('evaluator 카운트 + codex UUID + 카운트 정합 (errors empty)', () => {
      const body = `## Dual Review

- [x] evaluator (thread \`abc123\`) — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`019e5129-8c58-7662-92d5-db379c67271f\`) — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 4
`;
      expect(verifyG021(body)).toEqual([]);
    });

    it('NB 약어도 카운트 패턴 정합', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`019e5119-1634-76d3-bd31-76664fe14fac\`) — BLOCKING 0 / NEEDS_CHANGES 0 / NB 0
`;
      expect(verifyG021(body)).toEqual([]);
    });
  });

  describe('verifyG021 — 위반 검출', () => {
    it('Dual Review 섹션 누락', () => {
      const body = '## 다른 섹션\n내용';
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('Dual Review 섹션 누락'))).toBe(true);
    });

    it('evaluator 카운트 누락', () => {
      const body = `## Dual Review

- [x] evaluator — 통과
- [x] codex (threadId \`019e5129-8c58-7662-92d5-db379c67271f\`) — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 4
`;
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('evaluator') && e.includes('카운트'))).toBe(true);
    });

    it('codex UUID 패턴 누락', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (thread abc-123) — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 4
`;
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('UUID'))).toBe(true);
    });

    it('codex 카운트 누락', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`019e5129-8c58-7662-92d5-db379c67271f\`) — 통과
`;
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('BLOCKING') && e.includes('카운트'))).toBe(true);
    });

    it('자가 위조 차단 — UUID 짝수자리 prefix 만 박힘 (UUID v7 full pattern 위반)', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`019e5129\`) — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 4
`;
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('UUID'))).toBe(true);
    });

    it('UUID v7 일반 검증 — 다른 timestamp prefix 도 매칭 (codex 019e514b NEEDS_CHANGES #1 정합)', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`01a2b3c4-5678-7abc-89de-f01234567890\`) — BLOCKING 0 / NEEDS_CHANGES 0 / NOTABLE 0
`;
      expect(verifyG021(body)).toEqual([]);
    });

    it('본문 안 백틱 인용 `## Dual Review` 매칭 차단 — line anchor 강제 (self-check 발견 bug)', () => {
      const body = `## 다른 섹션

설명에 \`## Dual Review\` 인용이 박힘.

## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`019e5129-8c58-7662-92d5-db379c67271f\`) — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 4
`;
      // 본문 안 인용이 매칭됐다면 evaluator/codex 체크박스 찾기 실패. line anchor 박은 후 정합 정상 path.
      expect(verifyG021(body)).toEqual([]);
    });

    it('UUID v7 version bit 위반 (version 7 아님) — BLOCK', () => {
      const body = `## Dual Review

- [x] evaluator — Pass 9 / Partial 0 / Fail 1
- [x] codex (threadId \`01a2b3c4-5678-4abc-89de-f01234567890\`) — BLOCKING 0 / NEEDS_CHANGES 0 / NOTABLE 0
`;
      // version bit `4` (UUID v4) — UUID v7 regex `7[0-9a-f]{3}` 패턴 위반
      const errors = verifyG021(body);
      expect(errors.some((e: string) => e.includes('UUID'))).toBe(true);
    });
  });
});
