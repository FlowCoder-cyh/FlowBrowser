# Sprint 016 M0 T06 — perf bench infra 실측 보고서

> 작성일: 2026-05-20
> 브랜치: `feat/WI-S016M0-feat-perf-bench-infra`
> 측정 환경: Windows 11 / Node 20+ / better-sqlite3 12.x + sqlite-vec 0.1.9 (in-memory)
> 측정 방식: vitest test 모드 + `performance.now()` manual measurement (vitest 2.1.x bench mode 의 sqlite-vec + beforeAll 시드 조합 samples 0 한계 회피)

## 1. 8종 매트릭스 결과 요약

| # | 지표 | 임계 (PRD §15.4) | KI | 실측 | 판정 |
|---|---|---|---|---|---|
| 1 | 인덱싱 속도 | < 500ms / 페이지 | KI-012 | **0.027ms** (mean / 100 iter, 1KB 본문, 신규 URL) | **PASS** |
| 2 | 검색 응답 | < 200ms top-10 | KI-013 | **1.404ms** (mean / 50 iter, 1000 페이지 + 임베딩) | **PASS** |
| 3 | top-10 hit rate | ≥ 80% | KI-018 | **산식 + 헬퍼 박음** (실 30 케이스 cover 는 T07~T08 시점) | DEFERRED |
| 4 | 임베딩 비용 | < $3 / 월 (1만 페이지) | KI-015 | **$0.2000 / 월** (1만 페이지 × 1000 토큰 × $0.00002/1K) | **PASS** |
| 5 | 저장 용량 | < 200MB / 1만 페이지 | KI-016 | **90.32MB** (10K 페이지 + 임베딩 1024차원 + WAL) | **PASS** |
| 6 | AI 출처 정확도 | ≥ 90% | KI-019 | **산식 + 헬퍼 박음** (실 30 케이스 cover 는 T07~T08 시점) | DEFERRED |
| 7 | MemoryStats getStats | < 20ms (1K + 10K 페이지) | KI-011 | **0.046ms / 0.447ms** (mean / 100·50 iter) | **PASS** |
| 8 | 워크스페이스 전환 | < 1초 (10 탭 기준) | KI-014 | **0.283ms** (mean / 50 iter, 10 ws × 10 tabs round-robin) | **PASS** |

**6/8 PASS** + **2/8 DEFERRED** (정확도 산식 + 헬퍼만 박음 — 실 30 케이스 회귀는 시나리오 2·3 T07~T08 시점에 적용)

## 2. 실측 결과 상세

### 2.1 KI-011 MemoryStats < 20ms

| 시드 | n | mean (ms) | min | max | 임계 |
|---|---|---|---|---|---|
| 1K pages | 100 | 0.046 | 0.044 | 0.057 | < 20ms ✓ |
| 10K pages | 50 | 0.447 | 0.430 | 0.591 | < 20ms ✓ |

- 산식: `MemoryService.getStats(workspaceId)` — 5종 SELECT (pages / visits / notes / chat / lastIndexedAt) 합.
- 스케일링: 10× pages = 9.7× mean — 거의 선형 (SQLite COUNT 쿼리 정상).
- 마진 44.7× (임계 20ms / 실측 0.447ms) — 매우 여유.

### 2.2 KI-012 IndexingService.indexPage < 500ms

| n | mean (ms) | min | max | 임계 |
|---|---|---|---|---|
| 100 | 0.027 | 0.019 | 0.155 | < 500ms ✓ |

- 산식: `IndexingGate.evaluate() → IndexedPageStoreSqlite.recordVisit() → EmbeddingQueue.enqueue()` 동기 시퀀스.
- 비고: 실제 임베딩 OpenAI 호출은 큐 워커 비동기 (본 bench 미측정). 큐 등록까지 < 0.1ms — 매우 빠름.
- 마진 18,500× — 사실상 임계 무관.

### 2.3 KI-013 SearchService.search < 200ms top-10

| 시드 | n | mean (ms) | min | max | 임계 |
|---|---|---|---|---|---|
| 1000 pages + 임베딩 | 50 | 1.404 | 1.274 | 1.743 | < 200ms ✓ |

- 산식: `VectorIndex.searchPages/Notes` (sqlite-vec MATCH top-K) + 메타 fetch + 시간 가중 정렬.
- 마진 142× — 충분히 여유. 1만 페이지 스케일링도 임계 내 추정 (10× = 14ms, 임계 200ms 미만).

### 2.4 KI-014 WorkspaceService.setActive < 1초

| 시드 | n | mean (ms) | min | max | 임계 |
|---|---|---|---|---|---|
| 10 ws × 10 tabs | 50 | 0.283 | 0.200 | 0.546 | < 1000ms ✓ |

- 산식: `WorkspaceService.setActive(id)` — `db.setActiveWorkspaceId` + `userSettingStore.update`.
- 비고: KI-006 abort 정책 wiring (IndexingService.abort + EmbeddingQueue.clear + ChatService.abortStreaming) 은 T02 시점 추가 — 본 측정은 setActive 단순 경로만. T02 wiring 후 재측정 권고.
- 마진 3,500× — 매우 여유.

### 2.5 KI-015 임베딩 비용 < $3 / 월

| 시나리오 | 비용 ($) | 임계 |
|---|---|---|
| 1만 페이지 / 월 × 1000 토큰 × $0.00002/1K | **$0.2000** | < $3 ✓ |
| 5만 페이지 / 월 (확장) | $1.0000 | < $3 ✓ |

- 산식: `estimateMonthlyCostUsd(pages, tokens) = pages × tokens × $0.00002 / 1000`.
- 가정: 페이지당 4KB / 4 chars-per-token = 1000 토큰 (PRD §15.2 보수 추정).
- 마진 15× (임계 $3 / 실측 $0.20) — 충분.

### 2.6 KI-016 저장 용량 < 200MB / 1만 페이지

| 시드 | 파일 크기 (MB) | 임계 |
|---|---|---|
| 10K pages + 임베딩 (1024차원 × 4byte) + WAL | **90.32MB** | < 200MB ✓ |

- 본문 평균 4KB / 페이지 (lorem ipsum × 150 반복).
- 임베딩 1024 float × 10K = 40MB.
- pages + visits + indices ≈ 50MB.
- 마진 2.2× — 적절. 5만 페이지 시 ~450MB → 다음 임계 검토 필요 (PRD §15.4 1만 페이지 기준 정합).

### 2.7 KI-018 top-10 hit rate ≥ 80% (DEFERRED)

- 산식 헬퍼: `topKHitRate(pairs: RetrievalPair[], k=10): number` — `tests/integration/scenarios/accuracyHelpers.ts`.
- 산식: `hit_rate = sum(any(expected ∈ returnedTopK[:k])) / N`.
- 단위 회귀: `tests/unit/scenarios/accuracyHelpers.test.ts` — topKHitRate 6 it (빈셋 / top-1 hit / 부분 hit 비율 / any-hit / k 제한 / 임계 상수) PASS.
- 실 30 케이스 cover: Sprint 016 T07~T08 (시나리오 2·3) 시점에 18 케이스 + 추가 12 케이스 = 30 셋 박힘.

### 2.8 KI-019 AI 출처 정확도 ≥ 90% (DEFERRED)

- 산식 헬퍼: `aiSourcesPrecision(pairs: AiSourcesPair[]): number` — 동일 파일.
- 산식: `precision_i = |citedSources_i ∩ retrievedItems_i| / |citedSources_i|`, mean(precision).
- citedSources 0 케이스는 평균 제외 (hallucination 없는 응답).
- 단위 회귀: aiSourcesPrecision 6 it (빈셋 / 모두 일치 / hallucination / citedSources 0 평균 제외 / 전체 0 / 임계 상수) PASS. accuracyHelpers.test.ts 총 12 it (topK 6 + AI 6) 합산.
- 실 30 케이스 cover: T07~T08 시점.

## 3. 본 T06 산출물

### 3.1 perf infra
- `vitest.config.ts` — `benchmark.include: ['tests/perf/**/*.bench.ts']` 추가 (test 와 분리)
- `package.json` — `"perf": "vitest bench --run"` script 신규
- `tests/perf/*.bench.ts` × 6 (memoryStats / indexing / search / workspaceSwitch / embeddingCost / storageSize)
- `tests/perf/embeddingCostHelpers.ts` — 비용 산식 + 임계 상수

### 3.2 정확도 회귀
- `tests/integration/scenarios/accuracyHelpers.ts` — `topKHitRate` + `aiSourcesPrecision` + 임계 상수
- `tests/unit/scenarios/accuracyHelpers.test.ts` — 12 케이스 산식 회귀

### 3.3 실측 baseline
- `tests/integration/perf-baseline.test.ts` — 7 case `performance.now()` manual measurement + expect 강제
- `tests/unit/perf/embeddingCost.test.ts` — 5 case 비용 산식 회귀
- `.flowset/eval-results/sprint-016-perf-bench.md` — 본 보고서

### 3.4 vitest bench mode 한계 기록

vitest 2.1.x bench mode 가 sqlite-vec + `beforeAll` 시드 조합에서 samples 0 측정 한계 확인:
- 시도: `tests/perf/memoryStats.bench.ts` `beforeAll(seedNK)` + `bench(getStats)` → ✓ 표시 + samples 0 / hz 0.0000
- 동일 패턴 다른 bench (embeddingCost — setup 없음) 는 samples 13M+ 정상 측정
- 원인 추정: bench fn 의 `fx` closure 의 native module (sqlite-vec) tinybench scheduler 와 호환 이슈
- 우회: vitest test 모드 + `performance.now()` manual loop → 7/7 측정 성공

후속: vitest 2.2+ 또는 tinybench 직접 활용 시 bench mode 복원 가능.

## 4. KI status 변동 권고

| KI | 본 측정 결과 | Status 변동 권고 |
|---|---|---|
| KI-011 | PASS (0.046 / 0.447ms) | `open` → **closed** 후보 (Sprint 016 종합 evaluator 시점 확정) |
| KI-012 | PASS (0.027ms) | `open` → **closed** 후보 |
| KI-013 | PASS (1.404ms) | `open` → **closed** 후보 |
| KI-014 | PASS (0.283ms, KI-006 abort wiring 전) | `open` 유지 — T02 wiring 후 재측정 후 closed |
| KI-015 | PASS ($0.20/월) | `open` → **closed** 후보 |
| KI-016 | PASS (90.32MB) | `open` → **closed** 후보 |
| KI-018 | DEFERRED (산식 박힘, 실 30 케이스 T07~T08) | `open` 유지 — T08 시점에 closed |
| KI-019 | DEFERRED (산식 박힘) | `open` 유지 — T08 시점에 closed |

## 5. 후속 조치

1. **KI-011/012/013/015/016 closed 전환** — Sprint 016 종합 evaluator (T25) 시점에 확정. 본 측정 baseline 첨부.
2. **KI-014 재측정** — T02 (KI-006 abort 정책 wiring) 머지 후 동일 매트릭스 재실측. abort 호출 추가 시 + 0~수ms 예상.
3. **KI-018/019 회귀 cover** — T07~T08 시점에 시나리오 2·3 회귀 셋 (각 5 case × 2 = 10 신규) + Sprint 015 시나리오 1·4 회귀 (5+3=8) + 12 추가 = 30 케이스. 본 헬퍼 import + expect 강제.
4. **5만 페이지 스케일링 측정** — KI-016 1만 90.32MB → 5만 ~450MB 추정. PRD §15.3 차후 임계 검토 시점.
5. **vitest 2.2+ 또는 tinybench 검토** — `.bench.ts` mode 복원 시 본 manual measurement → bench mode 마이그레이션 가능.
