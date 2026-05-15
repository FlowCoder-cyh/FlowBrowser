# Sprint 003 — Phase 1 / 웹 번역 MVP 마무리 + Privacy 정책 가시화

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 002 머지 완료 (M1~M4, PR #14~#18)
- [x] 단위 테스트 70/70 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] CI 활성 (lint + typecheck + test + build)
- [x] Sprint 002 종합 evaluator Pass (AC 6/6, 누적 37 Pass)

## 1. Sprint 목표

Sprint 002의 잔여 보강을 우선 해소한 뒤, Phase 1 MVP 코어 (페이지 전체 번역) 마무리 + Privacy Filter 정책 사용자 가시화.

1. **LRU trim 단위 테스트 + `pageWideBlock` 구조화** (Sprint 002 evaluator §4 후속 1·2 해소)
2. **페이지 전체 번역** (PRD §9.2 P1) — Paragraph + 인라인 노드 확장 + 일괄 흐름
3. **도메인 화이트/블랙리스트 UI** (PRD §9.6 P1) — Privacy Filter 정책 사용자 가시화
4. **PRD v0.3.1 패치** (Sprint 002/003 실측 반영) — §9.2 / §9.6 / §12.4 / §19 메모 정리

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S003-T01 | TranslationCache LRU trim 단위 테스트 | `tests/unit/storage/TranslationCache.lru.test.ts` (maxBytes 초과 → 절반 trim 검증) |
| S003-T02 | Privacy 차단 사유 enum + `pageWideBlock: boolean` 구조화 | `src/privacy/types.ts` (BlockReason enum / pageWideBlock 필드) + evaluatePrivacy 반환 정합 |
| S003-T03 | PrivacyDecision UI/IPC 정합 정리 (전 페이지 차단 vs 부분 차단 구분) | popup / panel 차단 메시지 차이 적용 |
| S003-T04 | PageNodeExtractor — Paragraph 확장 (인라인 포함, 페이지 단위) | `src/perception/PageNodeExtractor.ts` (인라인/리스트/표/캡션 노드까지 + chunking) |
| S003-T05 | 페이지 전체 번역 IPC + 진행/취소 | `translate:page` IPC, 청크 단위 progress + abort 지원 |
| S003-T06 | 페이지 번역 패널/오버레이 모드 확장 | TranslationPanel 페이지 모드 표시, 진행 바 / 취소 버튼 / 누락 노드 표시 |
| S003-T07 | 도메인 정책 영속 모듈 | `src/privacy/DomainPolicyStore.ts` (whitelist/blacklist JSON 영속 + DomainFilter 통합) |
| S003-T08 | 도메인 화이트/블랙리스트 UI (Settings 안) | `src/renderer/src/settings/DomainPolicyPanel.tsx` (목록/추가/삭제/와일드카드 검증/import/export) |
| S003-T09 | 도메인 정책 IPC + 사용자 화이트리스트가 블랙리스트 우회 | `privacy:get-domain-policy` / `set-domain-policy` IPC + 우선순위 적용 |
| S003-T10 | 단위 테스트 (PageNodeExtractor / DomainPolicyStore / pageWideBlock) | `tests/unit/perception/PageNodeExtractor.test.ts`, `tests/unit/privacy/DomainPolicyStore.test.ts` 등 |
| S003-T11 | PRD v0.3.1 패치 (§9.2 / §9.6 / §12.4 / §19 메모 반영) | `docs/prd/04_requirements.md`, `06_data_model.md`, `11_dev_tasks_and_ops.md` 갱신 + 변경 이력 |
| S003-T12 | Sprint 종합 evaluator + handoff/state 갱신 | `.flowset/eval-results/sprint-003-*.md`, handoff 추가, state.md Sprint 003 종료 표기 |

### 제외 (Sprint 004+)

- 쉬운 설명 / 요약 / 용어집 (PRD §9.2 P1+)
- Codex Login Provider PoC (별도 spike 브랜치)
- 자막 / TTS / 싱크 (Phase 2~4)
- 도메인 정책 가져오기 자동 동기화 (수동 import/export만)

## 3. 수용 기준

### AC-1 LRU trim 검증 (S003-T01)
- maxBytes 초과 시나리오에서 `persistOnce()` 호출 후 캐시 항목 수 ≤ 원래의 절반
- 가장 오래 사용된(lastUsedAt 오래된) 항목이 우선 제거됨
- 단위 테스트 PASS

### AC-2 pageWideBlock 구조화 (S003-T02 ~ T03)
- `BlockReason` enum: `consent | password | card_field | card_pattern | domain | none`
- `PrivacyEvaluation`에 `pageWideBlock: boolean` 추가 — `consent / password / card_field / card_pattern` 시 true, `domain` 단독 차단 시 사용자 정책에 따라 결정
- 차단 사유 매칭이 문자열 비교 → enum 비교로 전환 (G-001 ontology 갱신 동반)
- popup / panel 차단 메시지가 pageWideBlock에 따라 분기됨 (전 페이지 vs 부분)

### AC-3 페이지 전체 번역 (S003-T04 ~ T06)
- "페이지 전체 번역" 트리거 (TranslationPanel 또는 UrlBar)
- PageNodeExtractor가 paragraph + 인라인(strong/em/span 안에 텍스트만 있는 노드) + 리스트 + 표 cell + 캡션 추출
- 텍스트 길이 [8, 5000] 필터 + 중복 제거 + 페이지 N개 청크 분할
- `translate:page-start/progress/done/error/aborted` 이벤트
- 사용자 취소 가능 (`translate:page-abort` IPC) — 진행 중 청크는 완료 후 정지
- Privacy 1회 스캔 → pageWideBlock=true 시 즉시 중단 + 사유 표시
- cache hit는 즉시 표시 + UsageLog 미기록

### AC-4 도메인 정책 UI (S003-T07 ~ T09)
- Settings 안 "도메인 정책" 섹션
- 화이트리스트 / 블랙리스트 별도 목록, 와일드카드 (`*.example.com`) 입력 검증
- 항목 추가 / 삭제 / 일괄 import (JSON) / export
- JSON 영속 (encrypted 불필요, 평문 OK — PRD §10.3은 콘텐츠 전송만 보호 대상)
- 사용자 화이트리스트가 기본 블랙리스트 + 사용자 블랙리스트 우선순위를 압도 (PRD §9.6 화이트리스트 정의)
- DomainFilter가 DomainPolicyStore에서 정책을 읽어 평가

### AC-5 단위 테스트 (S003-T10)
- LRU trim 직접 측정 1개 이상
- PageNodeExtractor 10개 이상 (인라인 포함 / 청크 분할 / 중복 / 길이 필터 / 깊은 구조)
- DomainPolicyStore 6개 이상 (CRUD / 와일드카드 / import 검증 / 화이트리스트 우선 / 영속 / clear)
- pageWideBlock 회귀 테스트 (Sprint 002 evaluatePrivacy 8개 + 신규 enum 매트릭스 보강)
- 총 단위 테스트 ≥ 90 (Sprint 002 70개 → +20개 이상)

### AC-6 PRD v0.3.1 패치 (S003-T11)
- §9.2 페이지 전체 번역 실측 메모 (청크 크기 / 평균 지연 등)
- §9.6 사용자 도메인 화이트/블랙리스트 P1 → 구현 명시 + JSON 스키마
- §12.4 TranslationCache 실측 (LRU 동작)
- §19 dev_tasks_and_ops에 PageNodeExtractor / DomainPolicyStore 모듈 추가
- `docs/prd/00_change_history.md` v0.3.1 변경 이력 추가
- `.flowset/requirements.md` v0.3.1 갱신

### AC-7 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8 (사용자 지시)
- 자동 검증 lint / typecheck / test / build 모두 PASS
- Sprint 종합 evaluator Pass

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 LRU trim 테스트 + T02 BlockReason enum / pageWideBlock + T03 UI 분기 | 2~3일 |
| M2 | T04 PageNodeExtractor + T05 페이지 IPC + T06 패널/오버레이 확장 | 4~6일 |
| M3 | T07 DomainPolicyStore + T08 UI + T09 IPC/우선순위 적용 | 3~5일 |
| M4 | T10 단위 테스트 + T11 PRD v0.3.1 + T12 Sprint 종합 evaluator + handoff/state | 2~3일 |

총 11~17일 (영업일 기준 2~3주).

## 5. 가드레일 적용

- G-001 PRD 정합성 (§9.2 / §9.6 / §10.3 / §12.4 / §19)
- G-002 Phase 0 게이트 — Phase 1 진입 후 (해당 없음)
- G-003 인증 금지선 — Sprint 003 BYOK 한정, 영향 없음
- G-004 Privacy Filter — 페이지 전체 번역도 evaluatePrivacy 1회 스캔 + pageWideBlock 분기 필수
- G-005 OS Keychain — 도메인 정책 JSON은 평문 OK (콘텐츠 아님)
- G-006 추측 금지 — 단위 테스트 + 자동 검증 + 실측
- G-007 main 직접 push 금지
- G-009 커밋 형식 `WI-S003-Mn-feat ...`
- G-010 UTF-8 / LF
- G-011 회색지대 — 적용 없음

## 6. evaluator 통과 기준 (사용자 지시 유지)

**각 M의 evaluator 호출 시 Pass 카운트 ≥ 8 이어야 머지 진행.**
미달 시 보강 후 재평가.

## 7. 리스크 / 미지수

1. **PageNodeExtractor 인라인 처리 복잡도**: 중첩 인라인 (`<p>foo <strong>bar <em>baz</em></strong></p>`) 분해 시 의미 단위 결정. 첫 구현은 블록 레벨 정규화 + 인라인은 텍스트 합본 처리.
2. **청크 분할 단위**: 토큰 기반 (대략 1청크 ≤ 4k 글자), provider rate limit 시 백오프.
3. **취소 흐름**: AbortController로 fetch 취소 vs 청크 완료 후 정지 — 후자가 일관성 안전. 진행 중 청크는 일관성 보장 후 정지.
4. **DomainPolicyStore JSON 스키마 호환**: 향후 사용자 import 시 버전 필드 (`policyVersion: 1`) 포함.
5. **pageWideBlock 도메인 분기**: 사용자 블랙리스트가 page-wide 차단을 의미하는지 정책 결정 필요 → "도메인 차단도 pageWideBlock=true" (사용자가 명시 차단했으므로) 채택.

## 8. Sprint 종료 후 다음 (Sprint 004 후보)

1. 쉬운 설명 / 요약 (PRD §9.2 P1)
2. Codex Login Provider Spike (Phase 1 PoC 4종: 비용 / 차단 / 모델 / refresh) — 별도 spike 브랜치
3. 용어집 (PRD §9.2 P2) — 사용자 정의 용어 + glossaryVersion 캐시 invalidation 활용
4. 사용자 수동 QA 결과 반영 (Sprint 001 AC-1/3/4/5/7 잔여)
5. Phase 2 진입 결정 (자막/TTS/싱크) — Spike 2/3/4 PoC 임계값 정량 정의 우선

## 9. 참조

- PRD: `docs/prd/04_requirements.md` (§9.2 / §9.6)
- PRD: `docs/prd/05_architecture.md` (§11)
- PRD: `docs/prd/06_data_model.md` (§12.4 TranslationCache / §12.8 UsageLog)
- PRD: `docs/prd/10_metrics_and_risks.md` (§18 — 비용/광고)
- Sprint 002 종합: `.flowset/eval-results/sprint-002-2026-05-11.md`
- 가드레일: `.flowset/guardrails.md`
- 온톨로지: `.flowset/ontology.md` (BlockReason enum 등록 예정)

## 변경 이력

- 2026-05-15: Sprint 003 정의 작성
