# 09. 검색 (Search)

> [← PRD 목차](./README.md)

본 섹션은 SearchBar (Cmd+K) → 자연어 시간 파싱 → 의미 임베딩 retrieval → 정렬 → 결과 표시 흐름. [§07 §7.4.3 SearchBar](./07_ui_layout.md#743-searchbar-m5) UI spec + [§04 §4.3.8 sqlite-vec](./04_data_model.md#438-embedding-sqlite-vec-virtual-table) 정합.

## 9.1 검색 파이프라인

```
[사용자 SearchBar 인풋 (Cmd+K)]
   ↓
[debounce 300ms]
   ↓
[search:query IPC → Main]
   ↓
[TimeRangeParser — 자연어 시간 추출 (§9.2)]
   ├─ "지난주" / "6개월 전쯤" / "어제" / N개월 전 / 절대 날짜
   └─ 결과: {from: timestamp, to: timestamp} 또는 null (시간 표현 없음)
   ↓
[EmbeddingClient.embed(query) — 질의 임베딩 (1024 차원)]
   ↓
[SearchService — vec_pages + vec_notes top-k retrieval (§9.3)]
   ├─ workspace_id partition (현 워크스페이스만)
   ├─ 시간 필터 (있으면) — visited_at IN (from, to)
   └─ top-k = 20 (Phase 1 디폴트)
   ↓
[정렬 공식 적용 (§9.4)]
   ├─ score = 0.85 × cosine_sim + 0.15 × exp(-days_ago / 180)
   └─ Page + Note 결합 정렬 (재정렬)
   ↓
[상위 N개 결과 카드 빌드 (Phase 1 디폴트 N=10)]
   ↓
[Renderer SearchBar 드롭다운 표시 (§07 §7.4.3)]
   ├─ SearchResultCard — 제목 + URL + 시간 시그널 + 매칭 발췌
   └─ PreviewPane (hover, M5 후순위)
```

## 9.2 TimeRangeParser (자연어 시간 파싱, M5)

[§04 §4.3.3 Visit.visited_at](./04_data_model.md#433-visit) 시간 필터 활용.

### 9.2.1 지원 표현 (Phase 1, 5종)

| 표현 | 파싱 결과 | 예시 |
|---|---|---|
| **상대 (recent)** | `{from: now - duration, to: now}` | "어제" → `{now-1d, now}` / "지난주" → `{now-7d, now}` |
| **상대 (older approx)** | `{from: target - margin, to: target + margin}` | "6개월 전쯤" → `{now-180d-30d, now-180d+30d}` |
| **상대 (N개월/년 전)** | `{from: now - Nm, to: now - (N-1)m}` | "3개월 전" → `{now-90d, now-60d}` |
| **절대 (YYYY-MM-DD)** | `{from: date, to: date+1d}` | "2026-05-01" → 해당 일 |
| **절대 (월/연)** | `{from: month_start, to: month_end}` | "2026년 5월" → 5월 1~31일 |

### 9.2.2 파싱 미일치

자연어 시간 표현이 없으면 → `null` 반환 → 시간 필터 적용 X (전체 메모리 retrieval).

### 9.2.3 다중 표현 / 모호 표현

- "지난주랑 어제" 같은 다중 시간 표현은 Phase 1 미지원 — 첫 매치만 사용. Phase 2+ 옵션.
- "최근" / "오래된" 같은 정성 표현은 모호 — Phase 1 시점에는 시간 필터 적용 X (의미 검색만)

### 9.2.4 회귀 테스트 (M5)

[§18 평가](./18_evaluation.md) 회귀 셋 + 단위 테스트:
- 5종 표현 각 1~2 케이스 (8 테스트 케이스)
- 시간대 (timezone) 처리 — UTC 또는 사용자 로컬 (M5 PoC 결정)

## 9.3 retrieval — sqlite-vec top-k

### 9.3.1 vec_pages + vec_notes 결합

[§04 §4.3.8](./04_data_model.md#438-embedding-sqlite-vec-virtual-table) 정합. Page + Note 둘 다 retrieval 대상 (R1 결정, v04-direction §17).

```sql
-- Page top-k (워크스페이스 격리 + 시간 필터)
SELECT vec.page_id, vec.distance, p.title, p.url, v.visited_at, v.dwell_ms
FROM vec_pages vec
JOIN Page p ON p.id = vec.page_id
JOIN Visit v ON v.page_id = p.id AND v.workspace_id = vec.workspace_id
WHERE vec.workspace_id = :current_workspace
  AND vec.embedding MATCH :query_embedding
  AND (:from IS NULL OR v.visited_at >= :from)
  AND (:to IS NULL OR v.visited_at <= :to)
ORDER BY vec.distance ASC
LIMIT :top_k;  -- Phase 1 디폴트 20
```

Note retrieval 도 동일 패턴 (`vec_notes` + Note + Visit join).

### 9.3.2 partition_key 활용

sqlite-vec `workspace_id partition_key` 로 다른 워크스페이스 retrieval 차단 — top-k 전 필터 (post-filter 아닌 pre-filter 로 recall 손실 방지).

### 9.3.3 결합 정렬

Page + Note 결과를 단일 정렬 — score 기준 재정렬 (§9.4 공식). 결과 카드에 type 표기 (`page` / `note`).

## 9.4 정렬 공식 (Phase 1)

```
score = 0.85 × cosine_sim + 0.15 × time_factor
time_factor = exp(-days_ago / 180)
```

| 변수 | 정의 | 비고 |
|---|---|---|
| `cosine_sim` | 1 - (sqlite-vec distance) — 0~1 정규화 | distance = L2 또는 cosine, M3 PoC 결정 |
| `days_ago` | (now - visited_at) / 86400 (초→일) | Visit 의 최근값 (다중 visit 시 max) |
| `time_factor` | exp(-days_ago / 180) | 180일 반감기 — 6개월 전 = 0.37, 1년 전 = 0.13 |
| `α = 0.85` | 의미 가중치 | v04-direction §17 P2-5 |
| `β = 0.15` | 시간 가중치 | 약하게 — 시나리오 4 (6개월 전) cover 위해 |

### 9.4.1 dwell 가중치 (Phase 2+)

```
score = 0.7 × cosine_sim + 0.15 × time_factor + 0.15 × log(dwell_ms / 1000 + 1) / log(3600 + 1)
```

dwell 가중치는 Phase 2+ 옵션 — Phase 1 시점 측정만 (UI 시그널). 정렬에는 미반영.

### 9.4.2 정렬 회귀

시나리오 4 (6개월 전 마이크로서비스 vs 모놀리스) 회귀 테스트:
- 회귀 셋: 6개월 전 페이지 1개 + 다른 시간대 페이지 N개 + 의미 유사도 다양
- 임계: top-3 안에 정답 페이지 포함 ([§18 §F4](./18_evaluation.md))

## 9.5 결과 미리보기 (SearchResultCard + PreviewPane)

### 9.5.1 SearchResultCard 필드

| 필드 | 소스 | 표시 |
|---|---|---|
| 제목 | Page.title 또는 Note.selected_text 첫 50자 | bold |
| URL | Page.url (도메인만 strip) | muted small |
| 시간 시그널 | Visit.visited_at + Visit.dwell_ms | "5일 전, 12분 머묾" / "8개월 전, 짧게 본 거 (1분 미만)" |
| 매칭 발췌 | content 또는 selected_text 의 의미 매칭 영역 (±100자) | query 키워드 highlight (`<mark>`) |
| 타입 인디케이터 | "📄 페이지" / "📝 노트" | 작은 chip |
| 워크스페이스 컬러 | Workspace.icon → §7.7.2 컬러 12종 | 좌측 4px 컬러 막대 |

### 9.5.2 매칭 발췌 알고리즘

1. content 에서 query 임베딩과 가장 유사한 sentence 위치 찾기 (M5 PoC — sentence splitter + 임베딩 vs query 임베딩 cosine)
2. 그 sentence 중심으로 ±100자 추출
3. query 토큰을 `<mark>` 태그로 highlight

비용 최적화: sentence 임베딩은 caching (M5 ResponseCache 활용).

### 9.5.3 시간 시그널 표시 규칙

| dwell_ms 범위 | 표시 |
|---|---|
| < 60_000 (1분 미만) | "짧게 본 거" |
| 60_000 ~ 600_000 (1~10분) | "{분}분 머묾" |
| 600_000 ~ 3_600_000 (10분~1시간) | "{분}분 머묾" |
| ≥ 3_600_000 (1시간 이상) | "{시간}시간 머묾" |

`days_ago` 표시:
- < 1일: "{시간}시간 전" 또는 "방금"
- 1~7일: "{N}일 전"
- 7~30일: "{N}주 전"
- 30~365일: "{N}개월 전"
- ≥ 365일: "{N}년 전"

### 9.5.4 PreviewPane (M5 후순위)

hover 시 우측 280px × 200px 패널 — Page 본문 캐시 첫 300자 또는 Note body 전체. 인터랙션 깊은 게 부담이라 Phase 1 후순위 ([§07 §7.4.3 PreviewPane](./07_ui_layout.md#743-searchbar-m5) 정합).

## 9.6 결과 클릭 동작

[§05 §5.4.4 Workspace 전환](./05_crud_matrix.md#544-workspace-전환) 와 별개. 검색 결과 클릭 시:

```
1. 페이지 navigate (활성 탭에 URL 로드)
   └─ 본문 캐시 활용 — 재 fetch 안 함 ([§04 §4.3.2 Page.content](./04_data_model.md#432-page))
2. 해당 visit_id 의 Note 자동 복원
   └─ ChatPanel 또는 NotePanel 에 인용 ([§07 §7.4.5 NotePanel](./07_ui_layout.md#745-notepanel-m5))
3. 해당 visit_id 의 AiChatHistory 자동 복원
   └─ ChatPanel 에 표시
```

## 9.7 성능 임계 (Phase 1 종료 evaluator 입력)

v04-direction §12.3 검색 관련:

| 지표 | 임계 | 측정 방법 (M5 종료) |
|---|---|---|
| 검색 응답 | < 200ms (top-5 retrieval, 본문 캐시 fetch 제외) | 1000 페이지 인덱스 + retrieval × 100회 평균 |
| top-5 hit rate | ≥ 80% | 회귀 셋 + 50 페어 자체 테스트 셋 |

[§18 평가 §F4](./18_evaluation.md) 측정 protocol + KI 등록 시점.

## 9.8 캐싱 정책

| 캐시 | TTL | 키 |
|---|---|---|
| Query 임베딩 | 30일 | `embedding:query:{sha256(query)}` (AIResponseCache, kind='embedding') |
| Search 결과 (동일 query + workspace + 시간 필터) | 1시간 | `search:{query_hash}:{workspace_id}:{time_filter_hash}` |
| 본문 매칭 발췌 | 30일 | `search:excerpt:{page_id}:{query_hash}` |

자주 재검색 시 비용 절감 (v04-direction §17 R2 임베딩 비용 임계 대응).

## 9.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §6 (검색 흐름) + §17 P1-10 (Cmd+K) + P2-5 (정렬 공식) + P2-6 (검색 미리보기)
- `.flowset/specs/v04-test-classification.md` §E1 S4 (자연어 시간 + 정렬 회귀 셋)
- [§04 §4.3.8 sqlite-vec](./04_data_model.md#438-embedding-sqlite-vec-virtual-table)
- [§05 §5.3.1 search IPC](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개)
- [§07 §7.4.3 SearchBar UI](./07_ui_layout.md#743-searchbar-m5)
- [§08 §8.3 EmbeddingClient](./08_indexing.md#83-embeddingclient-byok-openai-text-embedding-3-small)

본 §09 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 9.10 변경 이력

- 2026-05-16 (PR b6): stub → 본문 작성. 검색 파이프라인 7 step + TimeRangeParser 5종 표현 + sqlite-vec top-k SQL + 정렬 공식 (0.85 × cosine + 0.15 × exp(-days/180)) + Phase 2+ dwell 가중치 옵션 + SearchResultCard 필드 7종 + 시간 시그널 표시 규칙 + 결과 클릭 동작 (본문 캐시 + 노트 + AI 대화 복원) + 성능 임계 (검색 < 200ms, top-5 hit rate ≥ 80%) + 캐싱 정책 3종.
