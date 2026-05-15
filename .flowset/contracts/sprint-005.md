# Sprint 005 — Phase 1 / 캐시 키 확장 + 용어집 + 요약 보강

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP 확장)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 004 종료 (PR #25~#29 머지)
- [x] 단위 테스트 135/135 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] Sprint 004 종합 evaluator Pass 9 / 1 / 0
- [x] PRD v0.3.2 발행 (Sprint 004 실측 반영)

## 1. Sprint 목표

Sprint 004 잔여 보강 (캐시 우회 제거 / 요약 폭주 보호) + Phase 1 MVP P2 (용어집).

1. **캐시 키 확장** — `requestType` 포함 → Sprint 004 M2 cache 우회 제거
2. **용어집** (PRD §9.2 P2, §12.7) — GlossaryStore + 사용자 정의 용어 + glossaryVersion 자동 invalidation
3. **요약 폭주 보호 + UX** — summarizeChunks 통합 단계 입력 길이 truncate/재분할 + chunkSummaries 펼침 표시
4. **PRD v0.3.3 패치** — 위 3개 항목 명문화

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S005-T01 | TranslationCache 복합 키에 `requestType` 추가 | `src/storage/TranslationCache.ts` buildKey 시그니처 확장 |
| S005-T02 | cache 우회 제거 — explanation/summary도 정상 lookup/store | `src/main/services.ts` cacheable 분기 제거 |
| S005-T03 | LRU/회귀 단위 테스트 — requestType 분리 키 충돌 없음 검증 | `tests/unit/storage/TranslationCache.test.ts` 보강 |
| S005-T04 | GlossaryStore 구현 — sourceTerm/targetTerm/domain/version JSON 영속 | `src/storage/GlossaryStore.ts` |
| S005-T05 | 용어집 적용 — system/user prompt에 활성 용어 컨텍스트 주입 | `src/ai/providers/OpenAIApiKeyProvider.ts` buildUserPrompt 확장 |
| S005-T06 | glossaryVersion invalidation — 용어 추가/수정/삭제/임포트 시 cache invalidate | `src/main/services.ts` IPC 통합 |
| S005-T07 | Settings GlossaryPanel UI — 용어 추가/삭제/import/export | `src/renderer/src/settings/GlossaryPanel.tsx` |
| S005-T08 | SummarizationPlanner 폭주 보호 — 통합 입력이 LIMIT 초과 시 truncate 또는 추가 청크 분할 | `src/ai/SummarizationPlanner.ts` 옵션 추가 |
| S005-T09 | TranslationPanel chunkSummaries 펼침 토글 + 메타 표시 | `src/renderer/src/translation/TranslationPanel.tsx` |
| S005-T10 | 단위 테스트 (GlossaryStore + cache 키 + 폭주 보호) | `tests/unit/storage/GlossaryStore.test.ts` 등 |
| S005-T11 | PRD v0.3.3 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 006+)

- Codex Login Provider Spike (별도 spike 브랜치)
- 사용자 수동 QA 결과 반영 (사용자 직접 작업)
- Phase 2 진입 (자막 / TTS / 싱크)
- 다중 BrowserView / 탭 (Sprint 007+)

## 3. 수용 기준

### AC-1 캐시 키 확장 (S005-T01 ~ T03)
- `TranslationCache.buildKey()` 시그니처에 `requestType` 추가 (필수 필드)
- 복합 키 = `sha256(sourceText) | sourceLanguage | targetLanguage | providerType | requestType | glossaryVersion`
- 같은 sourceText로 다른 requestType 호출 시 별도 캐시 항목 보존 (충돌 0)
- Sprint 004 cache 우회 분기 제거 — explanation/summary도 cache hit/store 동작
- 기존 60 tests TranslationCache 회귀 통과 + 신규 충돌 검증 테스트 ≥ 2

### AC-2 GlossaryStore (S005-T04)
- `src/storage/GlossaryStore.ts` 신규 — PRD §12.7 1:1 정합
- 필드: id / sourceTerm / targetTerm / description / domain / isActive / version
- CRUD + JSON 영속 + 도메인별 조회 + 활성 용어만 필터
- 단위 테스트 ≥ 8

### AC-3 용어집 적용 (S005-T05)
- `buildUserPrompt()`가 input.context에 활성 용어 (있으면) 컨텍스트 블록으로 주입
- 활성 용어가 0개면 기존 동작 그대로
- 활성 용어가 N개면 prompt에 "Glossary (use these terms):\n- src → tgt\n..." 형식 추가
- requestType 'subtitle' / 'tts_script' / 'page' / 'paragraph' / 'selection'에 적용 (explanation/summary는 의역이라 적용 안 함)

### AC-4 glossaryVersion invalidation (S005-T06)
- 용어 추가/수정/삭제/import 시 version 갱신 → `translationCache.invalidateByGlossaryVersion(prevVersion)` 호출
- Settings UI 작업 후 캐시 hit 결과가 사라지는지 사용자 확인 가능 (cacheApi.stats)
- 통합 흐름: GlossaryStore mutation → version increment → cache invalidate IPC

### AC-5 GlossaryPanel UI (S005-T07)
- Settings 안 "용어집" 섹션 (DomainPolicyPanel 옆)
- 용어 추가 (sourceTerm / targetTerm / description / domain) + 검증
- 활성/비활성 토글, 삭제, 도메인 필터, JSON import/export
- 적용 도메인 표시

### AC-6 요약 폭주 보호 + UX (S005-T08 ~ T09)
- summarizeChunks에 옵션 `combineCharLimit` (기본 8000) 추가
- 통합 단계 입력 > combineCharLimit 시 재분할 (2단계 청크 → 부분 통합 → 최종 통합) 또는 truncate 폴백
- TranslationPanel에 "청크별 요약 펼치기" 토글 → chunkSummaries 표시
- 메타에 "통합 입력 길이 / 보호 동작" 표기

### AC-7 단위 테스트 (S005-T10)
- GlossaryStore ≥ 8
- cache 키 충돌 검증 ≥ 2
- summarizeChunks 폭주 보호 ≥ 3 (정상 / 재분할 / truncate 폴백)
- 누적 단위 테스트 ≥ 150 (Sprint 004 135 + 15 이상)

### AC-8 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01~T03 캐시 키 확장 + 우회 제거 + 회귀 테스트 | 1~2일 |
| M2 | T04~T07 GlossaryStore + 적용 + invalidation + UI | 4~6일 |
| M3 | T08~T09 폭주 보호 + chunkSummaries UX | 2~3일 |
| M4 | T10 단위 테스트 + T11 PRD v0.3.3 + Sprint 종합 | 2~3일 |

총 9~14일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.2 / §12.4 / §12.7)
- G-004 Privacy Filter — 용어집 컨텍스트는 sourceText에 추가되지 않음 (별도 system prompt 영역), Privacy 평가에 영향 없음
- G-006 추측 금지 — 단위 테스트 + 실측
- G-007 main 직접 push 금지
- G-009 커밋 형식 `WI-S005-Mn-feat ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **캐시 키 확장 = 기존 캐시 항목 invalidation**: 기존 항목은 requestType 없이 저장되어 있어 신규 키와 매치 안 됨. 신규 lookup은 항상 miss → 점진적 재캐싱. migrate 코드 없이 자연 폐기 채택 (사용자 영향 미미, dev 단계).
2. **용어집 적용으로 인한 prompt 길이 폭주**: 활성 용어가 너무 많으면 system/user prompt 토큰 초과. 도메인 필터 + 최대 N개 (기본 50개) 제한.
3. **summarizeChunks 재분할 무한 루프**: 재분할 후에도 LIMIT 초과면 한 번만 재분할하고 그 후는 truncate 폴백.
4. **GlossaryStore 마이그레이션**: domain-policy.json과 별도 파일 (`glossary.json`).

## 8. Sprint 종료 후 다음 (Sprint 006 후보)

1. Codex Login Provider Spike (Phase 1 PoC 4종)
2. 사용자 수동 QA 결과 반영
3. 다중 탭 / BrowserView (Phase 1 MVP P1)
4. 페이지 캐시 (Phase 1 MVP P2)
5. Phase 2 진입 (자막 / TTS / 싱크) — Spike 2/3/4 PoC 임계 정량화 우선

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.2 (용어집 P2)
- PRD: `docs/prd/06_data_model.md` §12.4 (TranslationCache) / §12.7 (GlossaryTerm)
- Sprint 004 종합: `.flowset/eval-results/sprint-004-2026-05-15.md`
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 005 정의 작성
