# Sprint 002 — Phase 1 / 웹 번역 MVP 확장

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 001 머지 완료 (M1~M4)
- [x] 단위 테스트 47/47 PASS / typecheck / build 모두 PASS
- [x] CI 활성 (typecheck + test + build)
- [x] Sprint 001 종합 evaluator Pass (조건부)

## 1. Sprint 목표

Sprint 001의 Partial 6개 (AC-1/3/4/5/6/7) 잔여 + 핵심 확장 기능.

1. **ESLint CI 게이트** (AC-7 잔여)
2. **UsageLog 표시 UI** (AC-6 잔여)
3. **TranslationCache** (PRD §12.4 복합 키 + TTL)
4. **문단 단위 번역** (PRD §9.2 P0)
5. **우측 번역 패널** (PRD §9.2 P1 — replace / panel / overlay 모드)

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S002-T01 | ESLint 9 flat config + CI lint 단계 | `eslint.config.js`, `.github/workflows/ci.yml` 갱신 |
| S002-T02 | UsageLog 표시 UI (Settings 안) | `src/renderer/src/settings/UsagePanel.tsx`, IPC 활용 |
| S002-T03 | TranslationCache 구현 | `src/storage/TranslationCache.ts` (복합 키, TTL, LRU) |
| S002-T04 | TranslationEngine에 cache 통합 | `src/main/services.ts` 갱신 — cache hit → provider 호출 회피 |
| S002-T05 | DOM 문단 추출 (Paragraph Extractor) | `src/perception/ParagraphExtractor.ts` (executeJavaScript 본문) |
| S002-T06 | 문단 번역 IPC + 진행률 | `translate:paragraphs` IPC, 청크 단위 진행 이벤트 |
| S002-T07 | 우측 번역 패널 UI | `src/renderer/src/translation/TranslationPanel.tsx` (toggle 표시) |
| S002-T08 | 번역 표시 모드 — replace / panel / overlay 중 panel 우선 구현 | UserSetting 통합 |
| S002-T09 | 단위 테스트 (TranslationCache + Paragraph Extractor 정규식) | `tests/unit/storage/TranslationCache.test.ts` 등 |

### 제외 (Sprint 003+)

- 페이지 전체 번역 (TBD)
- 쉬운 설명 / 요약 / 용어집
- 도메인 화이트/블랙리스트 UI
- Codex Login Provider (별도 spike)
- 자막 / TTS / 싱크

## 3. 수용 기준

### AC-1 ESLint
- `npm run lint` 실행 PASS
- CI `lint` 단계 활성 + PR 차단 게이트
- 기존 코드 ESLint 위반 0건

### AC-2 UsageLog UI
- Settings 페이지에 사용량 섹션
- Provider별 / Feature별 카운트 + 비용 USD 표시
- 기간 필터 (1일 / 7일 / 30일)
- "전체 삭제" 버튼 (감사 로그 삭제, PRD §10.3)

### AC-3 TranslationCache
- 복합 키 일치 시 hit → provider 호출 없이 즉시 반환
- TTL 기본 90일, 만료 시 LRU 삭제
- hitCount 증가
- 캐시 hit 시 UsageLog는 기록하지 않음 (외부 전송 없으므로)
- 캐시 hit 시 popup에 cache 표기 ("✓ 캐시")
- 디스크 영속 (JSON)

### AC-4 문단 번역
- 사용자가 "페이지 문단 번역" 버튼 클릭 (Settings 또는 UrlBar)
- DOM에서 문단 노드 (<p>, 헤딩, blockquote 등) 추출
- 각 문단을 순차/병렬 번역 (rate limit 고려)
- 진행률 표시 (N/M 문단 완료)
- 모든 문단이 cache hit 시 즉시 완료

### AC-5 번역 패널
- 우측 sliding panel (토글 가능)
- 원문/번역 병렬 표시
- 문단별 스크롤 동기화 (간단 anchor 기반)
- 닫기 / 다시 열기 토글

### AC-6 통과 기준
- evaluator 종합 판정 Pass + Pass 카운트 ≥ 8
- 자동 검증 (typecheck / test / lint / build) 모두 PASS

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 ESLint + T02 UsageLog UI | 2~3일 |
| M2 | T03 TranslationCache + T04 cache 통합 | 3~5일 |
| M3 | T05 ParagraphExtractor + T06 문단 IPC + T07 패널 UI + T08 모드 | 5~7일 |
| M4 | T09 단위 테스트 + Sprint 종합 evaluator | 2~3일 |

총 12~18일 (영업일 기준 2~3주).

## 5. 가드레일 적용

- G-001 PRD 정합성 (§9.2 / §12.4 / §10.3)
- G-002 Phase 0 게이트 — Phase 1 진입 후
- G-004 Privacy Filter — 문단 번역도 evaluatePrivacy 게이트 통과 필수 (한 번 통과 = 모든 문단 같은 결정)
- G-006 추측 금지 — 단위 테스트 + 자동 검증
- G-007 main 직접 push 금지
- G-009 커밋 형식 `WI-S002-Mn-feat ...`

## 6. evaluator 통과 기준 (사용자 지시)

**각 M의 evaluator 호출 시 Pass 카운트 ≥ 8 이어야 머지 진행.**
미달 시 보강 후 재평가.

## 7. 리스크 / 미지수

1. **ESLint 9 flat config + electron-vite 호환성**: 시행 후 충돌 시 minimal 설정으로 시작
2. **문단 번역 rate limit**: OpenAI rate limit 시 백오프 / 청크 분할
3. **번역 패널 ↔ 외부 페이지 좌표 동기화**: WebContentsView가 차지하는 영역과 패널이 겹치지 않게 bound 재계산

## 8. Sprint 종료 후 다음

- Sprint 003 후보: 페이지 전체 번역 / 도메인 화이트리스트 UI / 쉬운 설명 / 요약 / Codex Login spike 시작
- 평행 작업: Phase 1 PoC 4개 항목 (Spike 1 비용/차단/모델/refresh)

## 9. 참조

- PRD: `docs/prd/04_requirements.md` (§9.2 AI 번역 기능)
- PRD: `docs/prd/06_data_model.md` (§12.4 TranslationCache)
- PRD: `docs/prd/10_metrics_and_risks.md` (§18.4 비용)
- Sprint 001 evaluator: `.flowset/eval-results/sprint-001-2026-05-11.md`

## 변경 이력

- 2026-05-11: Sprint 002 정의 작성
