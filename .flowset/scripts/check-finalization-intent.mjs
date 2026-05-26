#!/usr/bin/env node
// G-022 사용자 마무리 의도 신호 검출 — advisory helper.
//
// 본 helper 는 deterministic 검출 path. blocking 자동화는 다음 mini-milestone 진입 시 박힘
// (codex 019e5136 권고 — transcript source 안정성 검증 후 blocking PR 박는 단계).
//
// 사용 (CLI): node check-finalization-intent.mjs '<utterance>'
// 사용 (programmatic): import { detectFinalizationIntent } from './check-finalization-intent.mjs'
//
// 검출 표현 매트릭스: guardrails.md G-022 §검출 표현 정합 (공백 정규화 후 매칭, 무공백 variant 동일 매칭).
// 허용 패턴 우선순위: codex 019e5129 NEEDS_CHANGES #2 정합 (진입 의사 명시 박혀있으면 검출 신호보다 허용 우선).

const FINALIZATION_PATTERNS = {
  종결: [/세션\s*종료/, /세션\s*마무리/, /오늘\s*마무리/, /마치자/, /마무리하자/],
  지연: [/다음\s*세션(?!에\s*박)/, /다음세션(?!에박)/, /내일\s*(할|진행|하자)/],
  핸드오프: [/핸드오프\s*작성/, /핸드오프작성/, /핸드오프\s*박아/, /state\s*갱신해/],
  추궁: [/오래\s*걸리냐/, /오래걸리냐/, /왜\s*이렇게\s*오래/, /왜이렇게\s*오래/, /여태[^\n]+안\s*[가-힣]/, /검증\s*시켰는데/, /검증시켰는데/]
};

// 진입 의사 명시 (unblock) — 검출 신호보다 우선. S018-T02 codex 019e634d §4 보강.
// 주의: bare /진행/ 같은 광의 패턴 금지 — "다음 세션에서 진행"(지연) 을 false ALLOW 로 뒤집음.
// 동사 페어로만 매칭 (작업/계속/이어서/다른 작업 + 진행, PR + 생성/만들어/올려/박아).
const ENTRY_INTENT_PATTERNS = [
  /작업\s*진행해/,
  /계속\s*진행/,
  /이어서\s*진행/,
  /다른\s*작업\s*(?:진행|시작|해|하자|박아|로)/,
  /다음\s*작업\s*(?:진행|시작|해)/,
  /구현\s*시작/,
  /PR\s*박아/,
  /PR\s*생성/,
  /PR\s*만들어/,
  /PR\s*올려/,
  /지금\s*박아/
];

const AUTONOMOUS_DELEGATION_PATTERNS = [
  /코덱스랑\s*협의해서/,
  /코덱스\s*권고대로/,
  /codex\s*권고\s*받아서/,
  /codex\s*권고대로/,
  /codex\s*협의해서\s*진행/,
  /권고대로\s*진행/
];

export function detectFinalizationIntent(utterance) {
  if (typeof utterance !== 'string') {
    throw new TypeError('utterance must be a string');
  }
  const original = utterance;
  const normalized = utterance.replace(/\s+/g, '');

  const signals = {};
  for (const [category, patterns] of Object.entries(FINALIZATION_PATTERNS)) {
    const matched = patterns.some((p) => p.test(original) || p.test(normalized));
    if (matched) signals[category] = true;
  }

  const hasEntryIntent = ENTRY_INTENT_PATTERNS.some((p) => p.test(original) || p.test(normalized));
  const hasAutonomousDelegation = AUTONOMOUS_DELEGATION_PATTERNS.some(
    (p) => p.test(original) || p.test(normalized)
  );
  const hasFinalizationSignal = Object.keys(signals).length > 0;

  let advisory;
  if (hasEntryIntent || hasAutonomousDelegation) {
    advisory = 'ALLOW_ENTRY';
  } else if (hasFinalizationSignal) {
    advisory = 'BLOCK_ENTRY';
  } else {
    advisory = 'NEUTRAL';
  }

  return {
    hasEntryIntent,
    hasFinalizationSignal,
    hasAutonomousDelegation,
    signals,
    advisory
  };
}

const isCliEntry = (() => {
  if (!process.argv[1]) return false;
  const url = import.meta.url.replace(/\\/g, '/');
  const arg = process.argv[1].replace(/\\/g, '/');
  return url.endsWith(arg) || arg.endsWith(url.replace(/^file:\/\/\/?/, ''));
})();

if (isCliEntry) {
  const utterance = process.argv.slice(2).join(' ');
  if (!utterance) {
    console.error('사용: node check-finalization-intent.mjs "<utterance>"');
    process.exit(2);
  }
  console.log(JSON.stringify(detectFinalizationIntent(utterance), null, 2));
  process.exit(0);
}
