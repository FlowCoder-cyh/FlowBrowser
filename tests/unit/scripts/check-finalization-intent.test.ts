import { describe, it, expect } from 'vitest';

import { detectFinalizationIntent } from '../../../.flowset/scripts/check-finalization-intent.mjs';

describe('check-finalization-intent (G-022 advisory helper)', () => {
  describe('검출 표현 4 분류 매칭 (guardrails.md G-022 §검출 표현 정합)', () => {
    it('종결 신호 매칭 — "세션 종료" / "세션 마무리" / "마치자" / "마무리하자"', () => {
      expect(detectFinalizationIntent('오늘 세션 종료').signals).toMatchObject({ 종결: true });
      expect(detectFinalizationIntent('오늘 세션 마무리하자').signals).toMatchObject({ 종결: true });
      expect(detectFinalizationIntent('이제 마치자').signals).toMatchObject({ 종결: true });
    });

    it('지연 신호 매칭 — "다음 세션" / "내일 진행"', () => {
      expect(detectFinalizationIntent('다음 세션에서 진행').signals).toMatchObject({ 지연: true });
      expect(detectFinalizationIntent('내일 진행하자').signals).toMatchObject({ 지연: true });
    });

    it('핸드오프 신호 매칭 — "핸드오프 작성" / "state 갱신해"', () => {
      expect(detectFinalizationIntent('핸드오프 작성해줘').signals).toMatchObject({ 핸드오프: true });
      expect(detectFinalizationIntent('state 갱신해').signals).toMatchObject({ 핸드오프: true });
    });

    it('추궁 신호 매칭 — "오래걸리냐" / "왜 이렇게 오래" / "검증시켰는데"', () => {
      expect(detectFinalizationIntent('왜 이렇게 오래걸리냐').signals).toMatchObject({ 추궁: true });
      expect(detectFinalizationIntent('검증시켰는데 뭐하냐').signals).toMatchObject({ 추궁: true });
    });
  });

  describe('공백 정규화 (codex 019e5129 BLOCKING #2 정합 — 무공백 variant 동일 매칭)', () => {
    it('"다음세션에서" 무공백 variant 매칭', () => {
      const result = detectFinalizationIntent('아니 다음세션에서 진행하려고 했는데');
      expect(result.signals).toMatchObject({ 지연: true });
    });

    it('"핸드오프작성하고" 무공백 variant 매칭', () => {
      const result = detectFinalizationIntent('핸드오프작성하고 검증시켰는데');
      expect(result.signals).toMatchObject({ 핸드오프: true, 추궁: true });
    });

    it('"왜이렇게 오래" 무공백 variant 매칭', () => {
      const result = detectFinalizationIntent('왜이렇게 오래걸리냐');
      expect(result.signals).toMatchObject({ 추궁: true });
    });
  });

  describe('허용 패턴 우선순위 (codex 019e5129 NEEDS_CHANGES #2 정합)', () => {
    it('진입 의사 명시 박힌 발화는 ALLOW_ENTRY', () => {
      const result = detectFinalizationIntent('이어서 진행해');
      expect(result.hasEntryIntent).toBe(true);
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });

    it('codex 위임 명시 박힌 발화는 ALLOW_ENTRY', () => {
      const result = detectFinalizationIntent('코덱스랑 협의해서 진행해');
      expect(result.hasAutonomousDelegation).toBe(true);
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });

    it('검출 신호 + 진입 의사 둘 다 박히면 허용 우선', () => {
      const result = detectFinalizationIntent('다음 세션에서 진행하지 말고 이어서 진행해');
      expect(result.hasFinalizationSignal).toBe(true);
      expect(result.hasEntryIntent).toBe(true);
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });
  });

  describe('검출 신호만 박힌 발화 — BLOCK_ENTRY', () => {
    it('마무리 의도만 박힌 발화', () => {
      const result = detectFinalizationIntent('오늘은 세션 마무리하자');
      expect(result.advisory).toBe('BLOCK_ENTRY');
    });

    it('추궁만 박힌 발화', () => {
      const result = detectFinalizationIntent('왜 이렇게 오래걸리냐');
      expect(result.advisory).toBe('BLOCK_ENTRY');
    });

    it('지연 신호만 박힌 발화', () => {
      const result = detectFinalizationIntent('다음 세션에서 하자');
      expect(result.advisory).toBe('BLOCK_ENTRY');
    });
  });

  describe('회색지대 — 명사적 지시 (evaluator a4dc5ef9 회색지대 식별)', () => {
    it('"핸드오프 읽고" 명사적 지시는 검출 안 됨 — 동사 페어만 신호', () => {
      const result = detectFinalizationIntent('핸드오프 읽고 작업 진행해');
      expect(result.signals.핸드오프).toBeUndefined();
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });

    it('"state 확인하고" 명사적 지시는 검출 안 됨', () => {
      const result = detectFinalizationIntent('state 확인하고 진행');
      expect(result.signals.핸드오프).toBeUndefined();
    });
  });

  describe('neutral (검출/허용 둘 다 없음)', () => {
    it('단순 질문은 NEUTRAL', () => {
      const result = detectFinalizationIntent('파일 위치가 어디지');
      expect(result.advisory).toBe('NEUTRAL');
    });

    it('빈 문자열은 NEUTRAL', () => {
      const result = detectFinalizationIntent('');
      expect(result.advisory).toBe('NEUTRAL');
    });
  });

  describe('에러 path', () => {
    it('null 입력은 TypeError', () => {
      // @ts-expect-error - intentional type violation
      expect(() => detectFinalizationIntent(null)).toThrow(TypeError);
    });

    it('숫자 입력은 TypeError', () => {
      // @ts-expect-error - intentional type violation
      expect(() => detectFinalizationIntent(123)).toThrow(TypeError);
    });
  });

  describe('실제 위반 인용 회귀 (handoff §8.2 PR #241 close 직전 발화)', () => {
    it('"아니 다음세션에서 진행하려고 핸드오프작성하고 검증시켰는데 뭐이렇게 오래걸리냐?" — 3 분류 동시 검출', () => {
      const result = detectFinalizationIntent(
        '아니 다음세션에서 진행하려고 핸드오프작성하고 검증시켰는데 뭐이렇게 오래걸리냐?'
      );
      expect(result.signals).toMatchObject({ 지연: true, 핸드오프: true, 추궁: true });
      expect(result.hasFinalizationSignal).toBe(true);
      expect(result.hasEntryIntent).toBe(false);
      expect(result.advisory).toBe('BLOCK_ENTRY');
    });

    it('본 세션 진입 발화 "핸드오프 읽고 작업 진행해" — 검출 0건 + 허용', () => {
      const result = detectFinalizationIntent('핸드오프 읽고 작업 진행해');
      expect(result.hasFinalizationSignal).toBe(false);
      expect(result.hasEntryIntent).toBe(true);
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });

    it('본 세션 위임 발화 "코덱스랑 협의해서 진행해" — autonomous 위임 + 허용', () => {
      const result = detectFinalizationIntent('코덱스랑 협의해서 진행해');
      expect(result.hasAutonomousDelegation).toBe(true);
      expect(result.advisory).toBe('ALLOW_ENTRY');
    });
  });
});
