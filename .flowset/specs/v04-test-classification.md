# A2 — 단위 테스트 분류 + 시나리오 회귀 셋 (v0.3 → v0.4)

> **M0 사전 분석 산출물 2/4**
> Sprint 015 contract `S015-T02` 산출물.
> 입력: `.flowset/specs/v04-direction.md` (방향 SSOT) + `.flowset/specs/v04-migration-matrix.md` (A1)
> 출력: PRD §18 (evaluation) 입력 + Sprint 015 종합 evaluator 회귀 셋

## 메타

- **작성일**: 2026-05-16
- **스캔 범위**: `tests/unit/**/*.test.{ts,tsx}` 29 파일 / 358 테스트 케이스 (Sprint 014 종료 기준)
- **분류 기준**: A1 폐기 매트릭스의 모듈 분류를 테스트 단위로 매핑
- **결정 SSOT**: `.flowset/specs/v04-direction.md` §11 시나리오 cover 매트릭스 + §12.3 정량 임계

## 분류 요약

| 분류 | 파일 | 케이스 | 비율 | 일정 |
|---|---|---|---|---|
| **DEPRECATE** (테스트 제거) | 3 | 49 | 13.7% | M2~M5 |
| **GENERALIZE** (재작성·확장) | 3 | 34 → 약 60 (+26) | 9.5% → 16.7% | M2 + M3 |
| **KEEP** (변경 없음) | 19 | 191 | 53.4% | — |
| **PARTIAL** (확장만) | 4 | 84 → 약 100 (+16) | 23.5% → 27.9% | M3 + M5 + M6 |
| 소계 (기존) | **29** | **358** | 100% | — |
| **NEW** (시나리오 회귀 18 + 컴포넌트 80~100) | (신규) | **+ 98~118** | — | M3~M6 |

### 누적 단위 테스트 예상

```
Sprint 014 종료              : 358
DEPRECATE 차감 (-)           : -49
GENERALIZE 재작성 확장 (+)   : +26
PARTIAL 확장 (+)             : +16
NEW (회귀 18 + 컴포넌트 80+) : +98~118
─────────────────────────────────────
Sprint 015 종료 예상         : 431~471
```

**AC-8 임계 ≥ 420 달성 가능 (보수 추정 431, 낙관 471)**.
산식 정정: `358 - 49 + 26 + 16 + 98~118 = 431~471` (Sprint 015 contract AC-8 기존 산식 정정 입력).

---

## A. DEPRECATE 테스트 (3 파일 / 49 케이스)

| 테스트 파일 | 케이스 | 모듈 (A1) | 이전 처리 | 일정 |
|---|---|---|---|---|
| `tests/unit/ai/SummarizationPlanner.test.ts` | 18 | SummarizationPlanner DEPRECATE | 제거 | M2 (SummarizationPlanner 폐기와 동시) |
| `tests/unit/perception/TranslationRenderer.test.ts` | 12 | TranslationRenderer DEPRECATE | 제거 | M5 (ChatPanel 도입 후) |
| `tests/unit/storage/GlossaryStore.test.ts` | 19 | GlossaryStore DEPRECATE (Glossary → Note 마이그레이션) | 19 중 약 5 케이스를 `tests/unit/storage/migrations/v03_to_v04.test.ts`로 **이전** (Glossary→Note 마이그레이션 회귀) / 나머지 14 케이스 제거 | M3 (마이그레이션과 동시) |

**제거 합계: 49 - 5 (이전) = 44 케이스 제거**. 5 케이스는 신규 migration 테스트로 이전 (NEW로 카운트).

---

## B. GENERALIZE 테스트 (3 파일 / 34 → 약 60)

### B1. `TranslationCache.test.ts` + `TranslationCache.lru.test.ts` → `AIResponseCache.test.ts`

| 항목 | 기존 | 신규 |
|---|---|---|
| 파일 수 | 2 | 1 (통합) |
| 케이스 | 15 + 3 = 18 | 약 25 (+7) |
| 추가 케이스 | — | 신규 키 도메인 (translation / embedding / ai_response / tag) 4종 라우팅 + 캐시 미스 분기 + TTL 90/365일 차등 + feature flag 어댑터 분기 |
| 위치 | `tests/unit/storage/TranslationCache.test.ts` + `.lru.test.ts` | `tests/unit/storage/AIResponseCache.test.ts` |
| 일정 | — | M2 (AIResponseCache 도입) |

### B2. `PageResultStore.test.ts` → `IndexedPageStore.test.ts`

| 항목 | 기존 | 신규 |
|---|---|---|
| 파일 수 | 1 | 1 |
| 케이스 | 16 | 약 35 (+19) |
| 추가 케이스 | — | Visit 누적 (같은 페이지 여러 번 방문) / 워크스페이스 격리 (다른 워크스페이스 visit 비포함) / content_hash dedupe (재방문 변경 감지) / sqlite-vec 벡터 인덱스 / forward-compatibility 컬럼 (Phase 2/3 외래키 nullable) |
| 일정 | — | M2 (base 신규) + M3 (sqlite-vec/Visit/Note/AiChatHistory 확장) |

**합계: 18 + 16 = 34 → 25 + 35 = 60 (+26 케이스)**

---

## C. KEEP 테스트 (19 파일 / 191 케이스, 변경 없음)

### ai/ (5 파일 / 55 케이스)
- `CodexLoginProvider.test.ts` (9)
- `DeviceCodeFlow.test.ts` (17)
- `JwtDecoder.test.ts` (8)
- `SseStreamParser.test.ts` (10)
- `SystemPrompt.test.ts` (11)

### main/ (3 파일 / 23 케이스)
- `ClosedTabHistory.test.ts` (7)
- `ThumbnailDiskStore.test.ts` (6)
- `ThumbnailStore.test.ts` (10)

### perception/ (2 파일 / 28 케이스)
- `PageNodeExtractor.test.ts` (15)
- `ParagraphExtractor.test.ts` (13)

### privacy/ (7 파일 / 70 케이스)
- `ConsentGate.test.ts` (10)
- `DomainFilter.test.ts` (11)
- `DomainPolicyStore.test.ts` (19)
- `SensitiveFieldDetector.test.ts` (9)
- `TransmissionLogger.test.ts` (5)
- `evaluatePrivacy.test.ts` (8)
- `pageWideBlock.test.ts` (8)

### storage/ (2 파일 / 15 케이스)
- `TabStateStore.test.ts` (11) — 단 PARTIAL 확장 시 일부 케이스 추가 예정 (M6)
- `UsageLog.test.ts` (4)

→ **KEEP 합계: 191 케이스 무변경**. CI 회귀 셋 base.

---

## D. PARTIAL 테스트 (4 파일 / 84 → 약 100)

| 테스트 파일 | 기존 | 신규 케이스 | 신규 후 | 일정 |
|---|---|---|---|---|
| `tests/unit/main/TabManager.test.ts` | 54 | workspace_id 메타 (Tab 생성/이동/저장 시 워크스페이스 격리) +5 | 약 59 | M6 |
| `tests/unit/renderer/tabGuard.test.ts` | 6 | IndexingService abort (사용자가 탭 닫을 때 진행 중 인덱싱·임베딩 abort 처리) +3. 단 `src/renderer/src/translation/tabGuard.ts` → `src/main/TabGuard.ts` 위치 이동 시 테스트 위치도 이동 | 약 9 | M2 (위치 이동) + M4 (abort 케이스) |
| `tests/unit/renderer/tabLabel.test.ts` | 5 | 워크스페이스 컨텍스트 (탭 라벨에 워크스페이스 아이콘·이름 표시) +2 | 약 7 | M6 |
| `tests/unit/storage/UserSettingStore.test.ts` | 19 | 마이그레이션 (폐기 키 자동 제거 + 신규 키 디폴트) +4 / 사용자 수준 옵션 +2 | 약 25 | M3 (마이그레이션) + M5 (수준 옵션) |

**확장 합계: 84 → 100 (+16 케이스)**

---

## E. NEW 테스트 (예상 98~118 케이스, M3~M6 누적)

### E1. 시나리오 회귀 셋 (18 케이스, M2 시작 시 정의 + M3~M6 점진 활성화)

본 회귀 셋은 Phase 1 종료 evaluator의 핵심 통과 기준 (Sprint 015 contract AC-8).
파일 위치: `tests/integration/scenarios/scenario-{N}.test.ts` (4 파일).

#### 시나리오 1 — 학술 리서치 (`scenario-1-academic.test.ts`, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S1-C1 | 자동 인덱싱 후 시간축 검색 ("지난주 본 IL-2 관련") → top-3에 정답 페이지 포함 | top-3 hit rate (binary, 모킹된 페이지 3개 인덱싱 후 검색) |
| S1-C2 | 검색 결과 클릭 → 본문 캐시 + 해당 visit 노트 + 해당 visit AI 대화 모두 복원 (다시 fetch X) | 3가지 entity 복원 통과 |
| S1-C3 | AI 채팅 비교 표 출력 + 각 셀에 출처 페이지 링크 | Markdown 표 + JSON 메타 schema 검증 (rows/columns/cells/sources 구조) |
| S1-C4 | 노트 추가 (선택 텍스트 + AI 자동 태그) → 3중 anchor (page + visit + workspace) | DB 저장 후 anchor 키 정확성 |
| S1-C5 | 워크스페이스 전환 → 탭/메모리/AI 컨텍스트/노트 전부 교체, 다른 워크스페이스 노이즈 0 | 전환 후 retrieval 결과에 다른 워크스페이스 데이터 X |

#### 시나리오 2 — PM 경쟁 분석 (`scenario-2-pm.test.ts`, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S2-C1 | 수집 모드 (페이지 N개 자유 방문 + 자동 인덱싱) | N개 인덱싱 통과 |
| S2-C2 | AI 자동 태깅 정형 5종 (topic/entity/metric/sentiment/domain) + freeform 케이스 1 | Tag.kind 6종 모두 추출 통과 |
| S2-C3 | 비교 매트릭스 (3x4 표 출력) + 셀별 출처 표시 | 표 schema + sources 배열 검증 |
| S2-C4 | 시간 + 의미 검색 ("어제 본 Reddit 스레드 Linear 단점") | top-3 hit rate |
| S2-C5 | **Export 데이터 생성** (Phase 3 외부 전송은 위임, 데이터 생성까지만 검증) | JSON export 형식 검증 |

**S2 P1 cover 정의**: S2-C1~C5 5케이스 모두 통과 시 100%. Phase 3 Export 외부 전송은 P3 위임 (별도 통합 테스트). v04-direction §11 "90% cover"는 가치 명제 추정 (Notion 외부 전송 부재로 -10%).

#### 시나리오 3 — 학습 (`scenario-3-learning.test.ts`, 5 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S3-C1 | 메모리 누적 (3개월간 178개 페이지 인덱싱 모킹) | 178개 페이지 인덱싱 + 워크스페이스 격리 |
| S3-C2 | 같은 페이지 여러 번 방문 시 별도 visit 누적 ("첫 진입 + 다시 본 시점") | Visit 2개 INSERT 확인 |
| S3-C3 | 시간순 + 의미 검색 ("Rust lifetime 헷갈렸던 글") → 2개 visit 모두 발견 | 시간 시그널 + 의미 매칭 |
| S3-C4 | AI 튜터 + 사용자 수준 직접 선택 (워크스페이스 설정 "초보/중급/고급") → system prompt 분기 | PromptComposer 분기 검증 |
| S3-C5 | 자동 수준 추정 mock (Phase 2 위임) | mock object 호출만 검증, 실제 학습 로직은 P2 |

**S3 P1 cover 정의**: S3-C1~C5 5케이스 모두 통과 시 100%. v04-direction §11 "90% cover"는 자동 수준 추정 미구현으로 -10%.

#### 시나리오 4 — 우연 재발견 (`scenario-4-recall.test.ts`, 3 케이스)

| 케이스 ID | 검증 내용 | 측정 protocol |
|---|---|---|
| S4-C1 | 자연어 시간 파싱 ("6개월 전쯤" / "지난주" / "어제") | TimeRangeParser 정확도 (5종 표현 모두 통과) |
| S4-C2 | 의미 임베딩 + 시간 필터 결합 (180일 반감기 공식) → top-3 hit rate | 정렬 공식 `0.85 × cosine + 0.15 × exp(-days/180)` 검증 |
| S4-C3 | dwell_ms 시그널 표시 ("18분 머묾" vs "짧게 본 거") | 검색 결과 카드에 dwell 표시 |

### E2. 컴포넌트별 신규 테스트 (M3~M6, 약 80~100 케이스)

| 컴포넌트 (NEW from A1) | 예상 케이스 | 일정 |
|---|---|---|
| IndexedPageStore (확장은 GENERALIZE 포함, 그 외 신규 인터페이스) | 포함됨 | M3 |
| VectorIndex (sqlite-vec wrapper) | 8 | M3 |
| PageContentCache (content_hash dedupe) | 6 | M3 |
| WorkspaceStore | 10 | M6 |
| NoteStore | 8 | M5 |
| AiChatHistoryStore | 6 | M5 |
| TagStore | 6 | M3 |
| EmbeddingQueue (활성 탭 우선 + FIFO) | 6 | M3 |
| EmbeddingClient | 4 | M3 |
| AutoTagger (Tag.kind 6종) | 8 | M4 |
| PromptComposer (수준 분기) | 4 | M5 |
| IndexingService (did-finish-load hook + 재방문 정책) | 8 | M4 |
| ChatService (retrieval + 출처 인용) | 6 | M5 |
| SearchService (시간축 + 의미 + 정렬 공식) | 8 | M5 |
| NoteService (선택 → AI 태그 → anchor) | 5 | M5 |
| WorkspaceService (전환 + 격리) | 6 | M6 |
| DwellTracker (탭 활성 + focus) | 4 | M4 |
| Shortcut (Cmd+K + 사용자 설정) | 3 | M5 |
| IndexingGate (디폴트 list + 비밀번호 필드 감지) | 6 | M4 |
| TimeRangeParser (자연어 시간 5종) | 8 | M5 |
| migrations/v03_to_v04.ts (Glossary→Note + settings 폐기 키 + 자동 백업) | 8 (5는 GlossaryStore에서 이전 + 3 신규) | M3 |

**예상 합계: 약 138 케이스 (시나리오 18 + 컴포넌트 약 120). 단 일부는 KEEP 컴포넌트 PARTIAL 확장과 중복**.

**보수 추정 (중복 차감): 98 + 시나리오 18 = 116 신규. 낙관 추정: 138.**

---

## F. 시나리오 회귀 셋 측정 protocol (evaluator 권고 3 해소)

### F1. 통과 기준 (binary per case)

각 케이스는 통과/실패 binary. 부분 통과 X.

### F2. 시나리오 cover % 정의

```
시나리오 N P1 cover % = (P1 base에서 통과한 케이스 수) / (전체 케이스 수) × 100%
  단 P2/P3 위임 케이스는 mock 통과로 카운트 (실제 로직은 후속 Phase)
```

| 시나리오 | 전체 케이스 | P1 통과 임계 | v04-direction §11 가치 명제 cover |
|---|---|---|---|
| S1 (학술) | 5 | **5/5 = 100%** | 100% (가치 명제 일치) |
| S2 (PM) | 5 | **5/5 = 100%** (Export 데이터 생성까지) | 90% (Notion 외부 전송 P3) |
| S3 (학습) | 5 | **5/5 = 100%** (자동 수준 추정 mock) | 90% (자동 학습 실제 로직 P2) |
| S4 (재발견) | 3 | **3/3 = 100%** | 100% (가치 명제 일치) |

### F3. Sprint 015 종합 evaluator 통과 기준 (AC-8 강화)

- 시나리오 회귀 셋 **18 케이스 모두 통과** (4 시나리오 모두 100%)
- v04-direction §11 가치 명제 cover (가치 추정 정성) — 결과 기록만, 게이트는 회귀 셋 통과

### F4. 정량 임계 측정 (Phase 1 종료 시, v04-direction §12.3)

회귀 셋과 별개로 정량 임계 6종 측정 (Sprint 015 contract §6):

| 지표 | 측정 시점 | 측정 방법 |
|---|---|---|
| 인덱싱 속도 < 500ms / 페이지 | M4 종료 | 100 페이지 모킹 인덱싱 + 시간 측정 |
| 검색 응답 < 200ms | M5 종료 | 1000 페이지 인덱스 + top-5 retrieval × 100회 |
| top-5 hit rate ≥ 80% | M5 종료 | 회귀 셋 + 추가 50 페어 자체 테스트 셋 |
| 임베딩 비용 < $3/월 | M3 종료 | 실측 페이지당 토큰 수 × $0.0001 × 1만 페이지 |
| 저장 용량 < 200MB / 만 페이지 | M3 종료 | 1만 페이지 모킹 후 SQLite 파일 크기 |
| AI 응답 출처 정확도 ≥ 90% | M5 종료 | 회귀 셋 + 추가 30 케이스 (cells의 sources 정확도) |

임계 미달 → Known Issue (KI-NNN) 등록 + Severity 정의에 따라 처리.

---

## G. 신규 테스트 파일 구조 (디렉토리)

```
tests/
├── unit/
│   ├── ai/
│   │   ├── (KEEP 5)
│   │   ├── embedding/EmbeddingClient.test.ts (NEW)
│   │   ├── tagging/AutoTagger.test.ts (NEW)
│   │   └── PromptComposer.test.ts (NEW)
│   ├── main/
│   │   ├── (KEEP 3 + TabManager PARTIAL)
│   │   ├── IndexingService.test.ts (NEW)
│   │   ├── ChatService.test.ts (NEW)
│   │   ├── SearchService.test.ts (NEW)
│   │   ├── NoteService.test.ts (NEW)
│   │   ├── WorkspaceService.test.ts (NEW)
│   │   ├── DwellTracker.test.ts (NEW)
│   │   ├── Shortcut.test.ts (NEW)
│   │   └── TabGuard.test.ts (이전: renderer/tabGuard.test.ts)
│   ├── perception/ (KEEP 2)
│   ├── privacy/
│   │   ├── (KEEP 7)
│   │   └── IndexingGate.test.ts (NEW)
│   ├── renderer/ (KEEP tabLabel, tabGuard 이전 후 1)
│   ├── search/
│   │   └── TimeRangeParser.test.ts (NEW)
│   └── storage/
│       ├── (KEEP 2 + UserSettingStore PARTIAL + TabStateStore PARTIAL)
│       ├── AIResponseCache.test.ts (재작성)
│       ├── IndexedPageStore.test.ts (재작성)
│       ├── VectorIndex.test.ts (NEW)
│       ├── PageContentCache.test.ts (NEW)
│       ├── WorkspaceStore.test.ts (NEW)
│       ├── NoteStore.test.ts (NEW)
│       ├── AiChatHistoryStore.test.ts (NEW)
│       ├── TagStore.test.ts (NEW)
│       ├── EmbeddingQueue.test.ts (NEW)
│       └── migrations/
│           └── v03_to_v04.test.ts (NEW, GlossaryStore 5 케이스 이전 + 3 신규)
└── integration/
    └── scenarios/
        ├── scenario-1-academic.test.ts (5 케이스, NEW)
        ├── scenario-2-pm.test.ts (5 케이스, NEW)
        ├── scenario-3-learning.test.ts (5 케이스, NEW)
        └── scenario-4-recall.test.ts (3 케이스, NEW)
```

---

## H. CI / evaluator 통과 임계 (Sprint 015 AC-8 정정)

본 매트릭스가 AC-8 산식 정정:

**기존 (Sprint 015 contract v1)**:
> 누적 단위 테스트 ≥ 420 (Sprint 014 358 + 폐기 N개 - 신규 70+개)
> → 부호 모순 (폐기는 차감, 신규는 가산)

**정정 (본 A2 결과)**:
> 누적 단위 테스트 ≥ 420 (목표 431~471)
> 산식: 358 (Sprint 014) - 49 (DEPRECATE 차감) + 26 (GENERALIZE 확장) + 16 (PARTIAL 확장) + 98~138 (NEW)
> 보수 ≈ 431, 낙관 ≈ 471

→ Sprint 015 contract §3 AC-8에 본 산식으로 갱신 PR 필요 (M1 PRD 작성 시 같이 갱신 권고).

---

## I. 다음 (T03 / T04 입력)

- **T03 데이터 마이그레이션**: GlossaryStore 5 케이스 이전 위치 + 자동 백업 형식
- **T04 의존 그래프**: PARTIAL 4 파일 (TabManager / tabGuard / tabLabel / UserSettingStore)의 호출지점 매트릭스 — TabManager 워크스페이스 ID 메타 추가 시 영향 범위

## J. 변경 이력

- 2026-05-16: Sprint 015 M0 T02 작성. tests/ 29 파일 / 358 케이스 분류 완료. 시나리오 회귀 셋 18 케이스 정의 + 측정 protocol 박힘 (evaluator 권고 3 해소). AC-8 산식 정정 입력.
