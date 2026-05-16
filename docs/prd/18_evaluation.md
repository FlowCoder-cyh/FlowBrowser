# 18. 평가 (Evaluation)

> [← PRD 목차](./README.md)

본 섹션은 검증 layering (Sprint·Phase·MVP) + 정량 임계 6종 측정 protocol + 시나리오 회귀 셋 18 케이스. v04-direction §12 + Sprint 015 contract §6 정합.

## 18.1 검증 layering (4 계층)

```
[Sprint 진행]
   ↓
[Sprint 종료]
   └─ Evaluator 채점 (Pass ≥ 8)
        ├─ 통과 → 약점은 Known Issue (KI-NNN) 등록
        └─ 미통과 → 즉시 보강 후 재채점
   ↓
[Phase 종료]
   └─ Evaluator 종합 채점 + Known Issue 정리 + 정량 임계 측정 + 시나리오 회귀
   ↓
[Known Issue 정리]
   ├─ HIGH 즉시 → 다음 Sprint M1
   ├─ MEDIUM 5개 누적 → 다음 Sprint M1~M2 batch
   └─ LOW Phase 3 종료 → MVP 직전 정리
   ↓
[MVP 최종 딥검증] (Phase 3 종료 후)
   ├─ 시나리오 4개 100% 시연
   ├─ 정량 임계 6종 측정
   ├─ Evaluator 종합 채점
   └─ 사용자 실사용 1주 + 일지
```

[§16 §16.4.3](./16_roadmap.md#1643-phase-3-종료-임계-mvp-최종) 정합.

## 18.2 Evaluator 통과 기준

[`.claude/agents/evaluator.md`](../../.claude/agents/evaluator.md) + Sprint 015 contract §6 정합.

| 통과 기준 | 정의 |
|---|---|
| **Pass ≥ 8** | evaluator 채점 항목 중 Pass 8개 이상 |
| **Fail 0** | 치명 결함 0건 |
| **Partial 흡수** | Partial 항목은 다음 milestone M1~M2 에서 정정 또는 KI 등록 |

### 18.2.1 evaluator 채점 카테고리 (Sprint 015 M0~M6 패턴)

본 PRD v0.4 작성 (M1) 시 적용된 카테고리:

| 카테고리 | 정의 |
|---|---|
| **C 구조** | 섹션 분할 / cross-link / SSOT 인용 / 변경 이력 |
| **D SSOT 정합** | v04-direction §X ↔ PRD §Y 정확 일치 |
| **E 완전무결** | 필수 정보 누락 0 / 카운트 정확 / 매트릭스 빠짐 X |
| **F 추측 금지 (G-006)** | "TBD" / "필요" / "추후" 미완성 표현 0 / 결정 위임 명시 |
| **G 한국어 (G-008)** | 본문 한국어 + 코드 식별자 영어 적정 |
| **H 일관성** | README 상태 표기 / cross-link 정확 / 학습 적용 |
| **I 기술 정확성** | 실제 코드 grep / API 패턴 / 인덱스 정책 |
| **J 외부 사실** | 가격·rate limit·API spec 공식 문서 인용 (b6.1 학습 강화) |

### 18.2.2 codex 병렬 평가 (b5+ 도입)

evaluator 와 별개 codex 리뷰 병렬 호출 — 비판 강도 +1 layer:

| codex 관점 | 책임 |
|---|---|
| 실제 코드 사실 검증 | 인터페이스 / 함수명 / schema 실제 grep |
| 외부 사실 검증 | API 가격 / rate limit / 공식 문서 |
| 자기모순 발견 | 수치 헤더 vs 본문 / 카운트 합산 |
| 기술 정확성 | 수학 공식 / 정규식 / 트랜잭션 정책 |
| 누락 / 약점 | UX 흐름 / 접근성 / 에러 시나리오 |

## 18.3 시나리오 회귀 셋 18 케이스

[v04-test-classification §E1](../../.flowset/specs/v04-test-classification.md) 정합. `tests/integration/scenarios/scenario-{N}.test.ts` 4 파일.

### 18.3.1 시나리오 1 — 학술 리서치 (P1, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S1-C1 | 자동 인덱싱 후 시간축 검색 ("지난주 본 IL-2 관련") → top-3 에 정답 페이지 포함 | top-3 hit rate (모킹된 페이지 3개 인덱싱 후 검색) |
| S1-C2 | 검색 결과 클릭 → 본문 캐시 + 해당 visit 노트 + 해당 visit AI 대화 모두 복원 | 3가지 entity 복원 통과 |
| S1-C3 | AI 채팅 비교 표 출력 + 각 셀에 출처 페이지 링크 | Markdown 표 + JSON chat_meta schema (`{rows, columns, cells:[{value, sources:[{type, id, page_id, visit_id?}]}]}`) |
| S1-C4 | 노트 추가 (선택 + AI 자동 태그) → 3중 anchor | DB 저장 후 anchor 키 정확성 |
| S1-C5 | 워크스페이스 전환 → 탭/메모리/AI 컨텍스트/노트 전부 교체, 다른 워크스페이스 노이즈 0 | 전환 후 retrieval 결과에 다른 workspace_id 데이터 X |

### 18.3.2 시나리오 2 — PM 경쟁 분석 (P2, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S2-C1 | 수집 모드 (페이지 N개 자유 방문 + 자동 인덱싱) | N개 인덱싱 통과 |
| S2-C2 | AI 자동 태깅 정형 5종 (topic/entity/metric/sentiment/domain) + freeform 1 | Tag.kind 6종 모두 추출 통과 |
| S2-C3 | 비교 매트릭스 (3x4 표 출력) + 셀별 출처 표시 | 표 schema + sources 배열 검증 |
| S2-C4 | 시간 + 의미 검색 ("어제 본 Reddit 스레드 Linear 단점") | top-3 hit rate |
| S2-C5 | **Export 데이터 생성** (Phase 3 외부 전송 위임, 데이터 생성까지만 검증) | JSON export 형식 검증 |

**S2 Phase 1 cover 정의**: S2-C1~C5 5케이스 모두 통과 시 회귀 100%. v04-direction §11 "가치 명제 cover 90%" 는 Notion 외부 전송 부재로 -10% 정성 평가.

### 18.3.3 시나리오 3 — 학습 (P3, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S3-C1 | 메모리 누적 (3개월간 178개 페이지 인덱싱 모킹) | 178개 페이지 + workspace_id 격리 |
| S3-C2 | 같은 페이지 여러 번 방문 시 별도 visit 누적 ("첫 진입 + 다시 본 시점") | Visit 2개 INSERT 확인 |
| S3-C3 | 시간순 + 의미 검색 ("Rust lifetime 헷갈렸던 글") → 2개 visit 모두 발견 | 시간 시그널 + 의미 매칭 |
| S3-C4 | AI 튜터 + 사용자 수준 직접 선택 (워크스페이스 설정 "초보/중급/고급") → system prompt 분기 | PromptComposer 분기 검증 |
| S3-C5 | 자동 수준 추정 mock (Phase 2 위임) | mock object 호출만 검증, 실제 학습 로직은 Phase 2 |

**S3 Phase 1 cover 정의**: S3-C1~C5 5케이스 모두 통과 시 100%. 가치 명제 cover 90% (자동 수준 추정 미구현으로 -10%, v04-direction §11 정합).

### 18.3.4 시나리오 4 — 우연 재발견 (P4, 3 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S4-C1 | 자연어 시간 파싱 ("6개월 전쯤" / "지난주" / "어제" / N개월 전 / 절대 날짜) | TimeRangeParser 5종 표현 정확도 |
| S4-C2 | 의미 임베딩 + 시간 필터 결합 (180일 e-folding 공식) → top-3 hit rate | 정렬 공식 `0.85 × cosine + 0.15 × exp(-days/180)` 검증 |
| S4-C3 | dwell_ms 시그널 표시 ("18분 머묾" vs "짧게 본 거") | 검색 결과 카드에 dwell 표시 |

## 18.4 측정 protocol

### 18.4.1 회귀 셋 cover %

```
시나리오 N Phase 1 cover % = (P1 base에서 통과한 케이스 수) / (전체 케이스 수) × 100%
  단 Phase 2/3 위임 케이스는 mock 통과로 카운트
```

| 시나리오 | 전체 케이스 | Phase 1 통과 임계 | v04-direction §11 가치 cover |
|---|---|---|---|
| S1 (학술) | 5 | 5/5 = **100%** | 100% (가치 일치) |
| S2 (PM) | 5 | 5/5 = **100%** (Export 데이터 생성까지) | 90% (Notion 전송 Phase 3) |
| S3 (학습) | 5 | 5/5 = **100%** (자동 수준 mock) | 90% (자동 학습 Phase 2) |
| S4 (재발견) | 3 | 3/3 = **100%** | 100% (가치 일치) |

### 18.4.2 Sprint 015 종합 통과 기준

- 회귀 셋 **18 케이스 모두 통과** (4 시나리오 100%)
- v04-direction §11 가치 명제 cover (정성) — 결과 기록만, 게이트는 회귀 통과

## 18.5 정량 임계 6종 측정 (Phase 1 종료 evaluator 입력)

[§15 §15.4](./15_costs_storage.md#154-정량-임계-6종-v04-direction-§123-phase-1-종료-evaluator-입력) 정합. 측정 시점·방법 명시.

| # | 지표 | 임계 | 측정 시점 | 측정 방법 |
|---|---|---|---|---|
| 1 | 인덱싱 속도 | < 500ms / 페이지 | M4 종료 | 100 페이지 모킹 인덱싱 (DOM + 메타 + 임베딩 큐 등록 모두 포함). performance.now() 평균 |
| 2 | 검색 응답 | < 200ms (top-10 표시까지) | M5 종료 | 1000 페이지 인덱스 + retrieval × 100회 평균. 본문 캐시 fetch 제외 |
| 3 | top-10 hit rate | ≥ 80% | M5 종료 | 회귀 셋 18 + 50 페어 자체 테스트 셋. 정답 페이지 top-10 안에 포함 |
| 4 | 임베딩 비용 | < $3 / 월 (1만 페이지) | M3 종료 | 실측 페이지당 토큰 수 × $0.00002 × 1만. 현재 추정 $0.20/월 (15배 여유) |
| 5 | 저장 용량 | < 200MB / 만 페이지 | M3 종료 | 1만 페이지 모킹 후 SQLite + 본문 캐시 파일 크기. 현재 추정 ~150MB |
| 6 | AI 응답 출처 정확도 | ≥ 90% | M5 종료 | 회귀 셋 30 케이스. chat_meta.cells.sources 가 실제 retrieved_items 내 page_id/note_id 와 일치 비율 |

임계 미달 → [§17 Known Issue](./17_known_issues_policy.md) Severity 정의에 따라 등록.

## 18.6 MVP 최종 딥검증 (Phase 3 종료 후)

[§16 §16.4.3](./16_roadmap.md#1643-phase-3-종료-임계-mvp-최종) 정합.

| 검증 | 임계 |
|---|---|
| 시나리오 4개 100% 시연 | S1·S4 100% / S2·S3 (Notion Export + 자동 수준) 100% |
| 정량 임계 6종 | Phase 1 임계 유지 + Local LLM 응답 < 2초 (Phase 3 추가) |
| 사용자 실사용 1주 | 매일 사용 + 일지 + issue 30 개 이내 |
| Export round-trip | Notion / Markdown / JSON 모두 export → 외부 도구 → re-import 결과 동일 |
| 오프라인 모드 | Local LLM 도입 후 인터넷 없이 검색 + 채팅 + 인덱싱 가능 |

## 18.7 evaluator + codex 협조 패턴 (Sprint 015 학습)

본 Sprint 015 M0~M1 진행 중 누적 학습. b3 이후 패턴:

### 18.7.1 매 PR 평가 흐름

```
[PR 생성 + 오토머지 활성]
   ↓ (병렬)
   ├─ evaluator 채점 (C/D/E/F/G/H/I/J 8 카테고리)
   ├─ codex 리뷰 (실제 코드 grep + 외부 사실 + 자기모순)
   └─ CI watch (typecheck + test + build + commit-check)
   ↓
[3 결과 종합]
   ├─ Pass 8 이상 + Fail 0 → 머지 진행
   └─ 약점 발견 → 핫픽스 PR (b{N}.1) 즉시 진행
```

### 18.7.2 누적 학습 (b1~b9)

| PR | codex blocking | 핵심 학습 |
|---|---|---|
| b1 / b2 | 10 + 8 | stub 표기 / 외부 제품 매트릭스 기준일 |
| b3 / b4 | 24 + 15 | 카운트 정확 / 실제 코드 사실 / SSOT 동반 갱신 |
| b5 / b6 | 15 + 23 | 외부 사실 검증 (가격) / 수학 정확성 / schema 다층 |
| b7 | **32** | ProviderAdapter 인터페이스 grep / UsageLog schema 정합 (역대 최대) |
| b8 / b9 | (TBD M2+) | 정량 임계 측정·외부 통신 감사 |

**적용 규칙** (b8+ 강화):
1. 인터페이스/스키마/함수명 = 실제 코드 grep 후 박힘
2. 외부 가격·rate limit·API spec = 공식 문서 직접 인용 + 기준일 명시
3. KEEP vs GENERALIZE = 실제 변경 범위 기준
4. 현재 시제 vs 미래 시제 명확 분리
5. 카운트 정확 (헤더 / 본문 / 합산 일치)

## 18.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §12 (검증 흐름 + 정량 임계)
- `.flowset/specs/v04-test-classification.md` §E1 (회귀 셋 18) + §F (측정 protocol)
- `.flowset/contracts/sprint-015.md` §6 (evaluator 통과 기준)
- `.flowset/known-issues.md` (KI 등록 영속)
- `.claude/agents/evaluator.md` (evaluator 정의)
- [§09 §9.4 정렬 공식](./09_search.md#94-정렬-공식-phase-1) + [§09 §9.7](./09_search.md#97-성능-임계-phase-1-종료-evaluator-입력)
- [§10 §10.3.2 chat_meta schema](./10_ai_chat.md#1032-json-메타-chat_meta) + [§10 §10.8](./10_ai_chat.md#108-정량-임계-phase-1-종료-evaluator-입력)
- [§15 §15.4 정량 임계](./15_costs_storage.md#154-정량-임계-6종-v04-direction-§123-phase-1-종료-evaluator-입력)
- [§16 §16.4.3 MVP 최종](./16_roadmap.md#1643-phase-3-종료-임계-mvp-최종)
- [§17 KI 정책](./17_known_issues_policy.md)

본 §18 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 18.9 변경 이력

- 2026-05-16 (PR b10): stub → 본문 작성. 4 계층 검증 layering + Evaluator 통과 기준 (Pass≥8 + Fail 0) + 8 카테고리 채점 + codex 병렬 5 관점 + 시나리오 회귀 18 케이스 (S1·S2·S3 각 5 + S4 3) + 측정 protocol + 정량 임계 6종 측정 방법 + MVP 최종 5종 검증 + evaluator·codex 협조 패턴 (Sprint 015 학습) + 누적 codex blocking 통계 (b1 10 ~ b7 32) + 적용 규칙 5종.
