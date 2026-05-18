# 08. 인덱싱 (Indexing)

> [← PRD 목차](./README.md)

본 섹션은 자동 인덱싱 파이프라인 — 사용자가 본 페이지를 DOM 추출 → 메타 → SQLite → 임베딩 → sqlite-vec 벡터 인덱스에 누적하는 흐름. [§04 데이터 모델](./04_data_model.md) Page·Visit·Embedding 컬럼 정합.

## 8.1 인덱싱 파이프라인 (전체 흐름)

```
[사용자 페이지 navigate]
   ↓
[WebContentsView did-finish-load 이벤트 (Main 수신)]
   ↓
[Privacy IndexingGate 검사 (§8.6)]
   ├─ 차단 도메인 list 매칭 → 인덱싱 skip
   ├─ 비밀번호 필드 감지 → 인덱싱 skip
   └─ 통과 → 다음 단계
   ↓
[ParagraphExtractor (재활용, src/perception/ParagraphExtractor.ts)]
   ├─ DOM 추출 (M3-13 style/script 필터 보존)
   ├─ title / lang / 본문 텍스트 추출
   └─ canvas / PDF / 동적 렌더링 페이지는 부분/실패 가능 — §8.7 누락 정책
   ↓
[content_hash 계산 (sha256, 빈 본문이면 NULL)]
   ↓
[Page lookup by (workspace_id, url) — idx_page_workspace_url 활용]
   ├─ 없음 → Page (C) + Visit (C) — 단일 TX
   ├─ 있음 + content_hash 같음 → Visit만 (C)
   └─ 있음 + content_hash 다름 → Page (U content/hash/updated_at) + Visit (C) + Embedding 재생성 큐
   ↓
[EmbeddingQueue.enqueue(page_id, priority)] — TX 외부 (b3.1 학습)
   ├─ 활성 탭: priority 10
   └─ 백그라운드 탭: priority 1
   ↓
[비동기 백그라운드 worker]
   ├─ EmbeddingClient (OpenAI text-embedding-3-small, 1024 차원, BYOK)
   ├─ AutoTagger (BYOK, JSON 응답 파싱, freeform fallback)
   └─ vec_pages / Tag / PageTag UPDATE — 별도 TX
   ↓
[indexing:status / embedding:status broadcast (Renderer 갱신)]
```

핵심 원칙:
- **외부 API 호출 (OpenAI) 은 DB TX 외부** ([§05 §5.4.1](./05_crud_matrix.md#541-page--visit-라이프사이클-자동-인덱싱))
- **자동 백그라운드 호출 = BYOK 디폴트** (G-003 강화, [§01 §1.4.2](./01_overview.md#142-동작-원칙))
- **사용자 의식 없음**: 인덱싱 진행은 [§07 §7.4.2 MemoryStatsPanel](./07_ui_layout.md#742-memorystatspanel-m6) 카운트만 갱신

## 8.2 ParagraphExtractor 재활용 정책

v0.3 `src/perception/ParagraphExtractor.ts` 그대로 재활용 (A1 §C KEEP). M3-13 핫픽스 (style/script 자식 + CSS-like 필터) 보존.

### 8.2.1 현재 ParagraphExtractor 기능 (v0.3 KEEP)

실제 코드 `src/perception/ParagraphExtractor.ts` 기능 (PR b6.1 검증 정정):

- **본문 문단 추출**: `<p>`, `<h1>~<h6>`, `<li>`, `<dd>` 등 문단성 요소
- **자식 필터** (M3-13 보존): `<style>` / `<script>` / `<noscript>` / `<template>` 자식 제외
- **CSS-like 패턴 필터** (M3-13 보존): `color: red; font-size: ...` 같은 스타일 조각 제외

### 8.2.2 Phase 1 확장 spec (M3~M4 도입, PR b6 과장 표현 정정)

PR b6 에서 "article/main/section 우선 + title/lang/meta/OpenGraph 추출" 라고 표기했으나 현재 코드 기능 아님. Phase 1 도입 정책:

- 페이지 `<title>` → Page.title 추출 (`document.title`, JS 1줄)
- `<html lang="...">` → Page.lang (없으면 빈 값, Phase 2+ 자동 감지)
- **본문 영역 우선순위**: `<article>` / `<main>` / `<section>` 우선 추출 정책은 M3 PoC 결정 — 현재 코드는 모든 `<p>` 추출 + boilerplate 영역 (nav/footer/aside) 무차별 포함. Phase 1 M3 PoC에서 의미 영역 우선 추출 도입 검토
- **메타 (author / publish date)**: Phase 1 미지원. Phase 2+ OpenGraph / JSON-LD 파싱 옵션
- **광고·boilerplate 제외**: Phase 1 미지원 (모든 `<p>` 추출). Phase 2+ 휴리스틱 옵션

### 8.2.3 콘텐츠 청크

본문이 매우 길면 (예: > 4000 토큰) 임베딩 전 청크 분할 정책. Phase 1 디폴트:
- **전체 본문 1개 임베딩** (페이지 단위) — 단순. text-embedding-3-small 입력 한계 (8192 tokens) 내 대부분 cover.
- 한계 초과 시: 처음 8000 tokens 만 사용 (truncate). 손실은 KI 등록.
- Phase 2+ 옵션: 청크 분할 + chunk_id 단위 embedding (의미 정확도 향상, 단 vector index 행 수 증가)

## 8.3 EmbeddingClient (BYOK, OpenAI text-embedding-3-small)

### 8.3.1 모델·차원

| 항목 | 값 | 비고 |
|---|---|---|
| 모델 | OpenAI `text-embedding-3-small` | v04-direction §7 SSOT |
| 차원 | **1024** | OpenAI 기본 1536 → `dimensions=1024` 축소 (저장·성능 최적화) |
| 비용 | **$0.00002 / 1k tokens** = $0.02 / 1M tokens (2026-05-16 기준 OpenAI 공식 가격) | ~$0.2~0.6/월 (1만 페이지, 평균 1k tokens/페이지) — PR b6 의 "$1~3/월" 5배 추정 오류 정정 |
| 호출 방식 | **fetch 기반 REST** (현재 OpenAIApiKeyProvider 패턴 재활용, OpenAI Node SDK 미사용) | M3 SDK 도입 결정 시 PoC |

### 8.3.2 BYOK 디폴트 정책 (G-003 강화)

자동 인덱싱·임베딩은 사용자 본인 API Key 사용. Codex OAuth 호출은 사용자 명시 동의 시에만 — 자동 백그라운드 호출이 ChatGPT 한도를 묵시 소진하지 않도록.

```
EmbeddingClient.embed(text)
  ├─ Provider 선택: UserSetting.defaultProviderId === 'openai-key' 면 즉시 호출
  ├─ 아니면: 'codex' 또는 'none' → 사용자 settings 알림 + 임베딩 큐에서 보류
  └─ 큐 보류 시: indexing:status 로 "임베딩 대기 — API Key 등록 필요" broadcast
```

### 8.3.3 EmbeddingQueue 정책

| 항목 | spec |
|---|---|
| 우선순위 | 활성 탭 page = 10 / 백그라운드 탭 = 1 / 동일 priority 내 FIFO |
| 동시 호출 | 최대 5 (OpenAI rate limit 보수, M3 PoC에서 조정) |
| Rate limit 대응 | 지수 백오프 (5초 / 30초 / 5분 / 30분 / 포기) + KI-NNN 등록 |
| 실패 처리 | 재시도 4회 → 5회째 실패 시 **EmbeddingQueue 테이블 (M4+ SQLite 영속 큐) `status='failed'` 마킹** + KI-NNN. Page 컬럼 spec 변경 X (b6.1 §04 schema 침범 회피) |
| Abort 트리거 | 탭 닫기 / 워크스페이스 전환 → 해당 page_id 큐 제거 |
| 큐 영속 | M3 in-memory / M4+ SQLite EmbeddingQueue 테이블 (재시작 시 복원) |

## 8.4 재방문 정책 (content_hash 비교)

[§05 §5.4.1](./05_crud_matrix.md#541-page--visit-라이프사이클-자동-인덱싱) 흐름 그대로. 본 §8.4는 비교 알고리즘 + 임계 정책.

| 분기 | 조건 | 동작 |
|---|---|---|
| **신규 페이지** | (workspace_id, url) lookup 결과 없음 | Page (C) + Visit (C) + 임베딩 큐 등록 |
| **재방문, 본문 동일** | (workspace_id, url) 있음 + content_hash 동일 | Visit (C) 만. visited_count++ |
| **재방문, 본문 변경** | (workspace_id, url) 있음 + content_hash 다름 | Page (U) + Visit (C) + **임베딩 재생성 큐** (vec_pages UPDATE) |
| **재방문, 본문 빈값** | content 빈 문자열 (canvas/PDF 등) | Page (U content_hash=NULL) + Visit (C) + 임베딩 큐 skip |

### 8.4.1 content_hash 계산

```
content_hash = sha256(normalized(content))
  - normalize: trim whitespace + 연속 공백 1개 + 줄바꿈 정리
```

URL 정규화는 본문 변경과 무관 — URL 자체는 `idx_page_workspace_url` 의 lookup 키로만 사용.

## 8.5 dwell_ms 측정 (DwellTracker, M4)

[§04 §4.3.3](./04_data_model.md#433-visit) Visit.dwell_ms 컬럼 채움.

### 8.5.1 측정 정책

- **시작**: 탭 활성 + WebContentsView focus
- **일시정지**: 탭 비활성 OR 윈도우 focus 잃음 OR 사용자 idle (15초 이상 입력 없음)
- **재개**: 탭 다시 활성 OR 윈도우 focus 복귀 OR 사용자 입력
- **fix**: 페이지 닫기 OR 탭 전환 시 누적 시간을 Visit.dwell_ms 에 UPDATE
- **단위**: ms

### 8.5.2 시그널 사용

- [§07 §7.4.3 SearchBar](./07_ui_layout.md#743-searchbar-m5) 결과 카드: "5일 전, 12분 머묾" (시각화)
- [§09 §9.4 정렬 공식](./09_search.md#94-정렬-공식): Phase 1 base 에는 dwell 가중치 X (계산 단순화). Phase 2+ 옵션 — `score = α × semantic + β × time + γ × log(dwell_ms)`

### 8.5.3 정밀 측정 (Phase 2+)

- 스크롤 깊이 추적
- 페이지 visible viewport 영역 추적
- focus·blur 외 mousemove / scroll 이벤트 활용

Phase 1 시점: 탭 활성 + focus 만으로 충분 (b4.1 학습 — 외부 호출 부담 없음).

## 8.6 Privacy IndexingGate (M4)

[§13 보안·프라이버시](./13_security_privacy.md) 본문 + A1 §E `src/privacy/IndexingGate.ts` 신규.

### 8.6.1 디폴트 차단 list (v04-direction §17 P1-9, PR b6.1 강화 + M4-4 정합)

본 list 는 v0.3 `src/privacy/DomainFilter.ts` (KEEP, A1 §C) 패턴 기준 + PR b6.1 보강 + M4-4 IndexingGate 전용 1패턴 추가 + path glob 1종. 실제 코드의 매칭 범위 (mail.*/accounts?/banking.*/payment/pay/checkout/signin/oauth/id/*.bank/gmail/paypal/icloud + naver mail path) 반영.

| 패턴 | 매칭 방식 | 사유 |
|---|---|---|
| `*.bank.com` / `*.bank.*` | domain | 은행 |
| `banking.*` | domain prefix | 은행 일반 (DomainFilter `^banking\.`) |
| `mail.*` | domain prefix | 메일 서비스 일반 |
| `gmail.com` | domain | Gmail |
| `*.paypal.com` | domain | 결제 |
| `*.icloud.com` | domain (IndexingGate 전용 — DomainFilter 미포함) | iCloud 메모/사진/메일 |
| `accounts.*` / `accounts?.*` | domain prefix | 계정 페이지 일반 |
| `signin.*` / `login.*` | domain prefix | 로그인 페이지 |
| `oauth.*` / `id.*` | domain prefix | OAuth / SSO / Passkey |
| `payment.*` / `pay.*` / `checkout.*` | domain prefix | 결제 흐름 |
| `*.naver.com/mail/*` | **path glob** (M4-4 IndexingGate 본격 도입) | 네이버 메일 — DomainFilter 는 domain 매칭만, IndexingGate 가 path 매칭 확장 |

**카운트 표기**: 위 표는 **11 카테고리**, concrete matcher 카운트는 **15** (`defaultBlacklistPatterns()` 13 RegExp + IndexingGate 전용 1 + path glob 1). 카테고리 = 사용자 의도 분류, concrete matcher = 실 코드 매칭 단위.

사용자 settings 추가/제외 가능 (`UserSetting.privacyExclusions[]`). `type='allow'` 는 본 디폴트 list (domain + path) 외에 `<input type='password'>` 감지도 bypass — 사용자 명시 허용 신뢰 정책 (M4-4 `IndexingGate.evaluate()` 정합).

### 8.6.2 비밀번호 필드 감지

`SensitiveFieldDetector` (KEEP, A1 §C) 재활용 — `<input type="password">` 감지 시 자동 차단.

### 8.6.3 차단 시 동작

- Page·Visit 모두 INSERT 안 함
- [§07 §7.4.2 MemoryStatsPanel](./07_ui_layout.md#742-memorystatspanel-m6) 카운트 증가 X
- 사용자 알림: 차단 인디케이터 (UI 부담 적게, 작은 아이콘으로)

### 8.6.4 사용자 명시 override

사용자가 "이 페이지 인덱싱" 컨텍스트 메뉴 클릭 시 1회 override (Visit + Page 생성). v0.3 ConsentGate 패턴 재활용.

## 8.7 DOM 추출 실패 영역 정책

본문 추출이 부분/실패하는 영역 — [§03 §3.7 한계](./03_value_propositions.md#37-정당화의-한계-정직한-명시) 명시.

| 영역 | 정책 |
|---|---|
| **canvas / SPA dynamic** | content 빈값 → Page·Visit INSERT (시간 시그널은 보존) + 임베딩 skip |
| **PDF** | Phase 1 **URL/제목/방문 시그널만 저장**, 본문 검색·RAG 제외 (Chromium PDF viewer 컨테이너 인식 X). **시나리오 1 (학술 P1) 영향**: 논문 PDF use case 는 Phase 1 부분 cover (제목/시간/방문 기록만) — Phase 2+ pdf-extract 라이브러리 도입으로 본문 인덱싱 + RAG 완성. 학술 시나리오 회귀 셋에 PDF 케이스 포함 시 별도 임계 |
| **로그인 페이지 / 인증 화면** | Privacy IndexingGate 차단 |
| **이미지 only 페이지 (캡션 부재)** | content 빈값. OCR 은 Phase 2+ 옵션 |
| **iframe 안 콘텐츠** | M3 PoC 결정 (top frame 만 vs 동일 origin iframe 포함) |

## 8.8 자동 태깅 (AutoTagger, M4)

### 8.8.1 트리거

인덱싱 직후 EmbeddingQueue 와 독립 큐 (TaggingQueue, M4 PoC 결정 — EmbeddingQueue 재활용 vs 별도). 자동 호출 = BYOK 디폴트 (G-003 강화).

### 8.8.2 Tag.kind 6종 (v04-direction §17 P0-3)

| kind | 의미 | 예시 |
|---|---|---|
| `topic` | 주제 | "CAR-T", "마이크로서비스" |
| `entity` | 고유명사 (사람·회사·제품) | "Linear", "BioGen" |
| `metric` | 수치·지표 | "10x faster", "ICU 입원율" |
| `sentiment` | 감정·평가 | "긍정", "부정", "중립" |
| `domain` | 도메인 | "medicine", "engineering" |
| `freeform` | 자유 (정형 매칭 실패 시 fallback) | (모델 자유 텍스트) |

### 8.8.3 응답 schema

OpenAI Provider 응답을 JSON 강제. system prompt 에 schema 명시:

```json
{
  "tags": [
    {"kind": "topic", "name": "CAR-T 저항성"},
    {"kind": "entity", "name": "BioGen"},
    {"kind": "domain", "name": "medicine"}
  ]
}
```

JSON 파싱 실패 시 → freeform fallback (응답 텍스트를 `kind=freeform`, `name=<응답 200자 truncate>` 단일 태그). M4-2 codex NB-2 정정 — Tag.name 저장 길이 제한 + 검색 정합 위해 200자 cap. 모델 응답이 200자 초과해도 본 fallback 은 truncate 본만 저장 (raw text 는 AutoTagResult.rawText 로 호출자 노출).

### 8.8.4 정확도 임계

[§18 평가 §F4](./18_evaluation.md): 회귀 셋에서 태그 추출 성공률 ≥ 80% (M4 종료 evaluator 입력).

## 8.9 비용·저장 추정

| 항목 | 추정 (v04-direction §8) |
|---|---|
| 임베딩 호출 | **~$0.00002 / 페이지** (1k tokens 기준, OpenAI 공식 2026-05-16) |
| 1만 페이지 / 월 | **~$0.2~0.6** (PR b6.1 정정 — 가격 5배 오류 해소) |
| 페이지 텍스트 저장 | ~10KB / 페이지 |
| 임베딩 저장 (1024 차원) | ~4KB / 페이지 |
| 1만 페이지 합산 | ~150MB |

상세는 [§15 비용·저장](./15_costs_storage.md).

## 8.10 정량 임계 (Phase 1 종료 evaluator 입력)

v04-direction §12.3 정량 임계 6종 중 인덱싱 관련:

| 지표 | 임계 | 측정 시점 |
|---|---|---|
| 인덱싱 속도 | < 500ms / 페이지 (DOM + 메타 + 임베딩 큐 등록) | M4 종료 |
| 임베딩 비용 | < $3 / 월 (1만 페이지 기준) | M3 종료 |
| 저장 용량 | < 200MB / 만 페이지 | M3 종료 |

[§18 평가 §F4](./18_evaluation.md) 측정 방법 + 미달 시 KI 등록.

## 8.11 SSOT 인용

- `.flowset/specs/v04-direction.md` §6 (핵심 동작) + §7 (임베딩 모델) + §8 (비용·저장) + §12.3 (정량 임계) + §17 P0-3 (Tag.kind 6종) + P1-9 (Privacy 차단 list)
- `.flowset/specs/v04-data-migration.md` §B (마이그레이션 후 임베딩 큐 등록)
- [§04 §4.3.2 Page](./04_data_model.md#432-page) + [§04 §4.3.8 sqlite-vec](./04_data_model.md#438-embedding-sqlite-vec-virtual-table)
- [§05 §5.4.1 라이프사이클](./05_crud_matrix.md#541-page--visit-라이프사이클-자동-인덱싱)
- [§06 §6.3 컴포넌트 트리](./06_architecture.md#63-컴포넌트-트리-main-모듈-의존-그래프)

본 §08 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 8.12 변경 이력

- 2026-05-16 (PR b6): stub → 본문 작성. 인덱싱 파이프라인 12 step + ParagraphExtractor 재활용 (M3-13 보존) + EmbeddingClient (1024 차원, BYOK) + EmbeddingQueue (활성 탭 우선, 백오프 5종) + 재방문 4 분기 + DwellTracker + Privacy IndexingGate + DOM 추출 실패 영역 정책 + AutoTagger 6종 kind + JSON schema + 비용 추정 + 정량 임계 3종.
- 2026-05-16 (PR b6.1): codex 다수 + evaluator 핫픽스. **외부 사실 정정**: OpenAI 임베딩 가격 5배 오류 — $0.0001 → **$0.00002 / 1k tokens** ($0.02 / 1M, 2026-05-16 공식). 월 비용 $1~3 → **$0.2~0.6**. v04-direction §7 동반 갱신. **실제 코드 정합**: ParagraphExtractor 과장 표현 정정 (현재 코드 = 문단 추출 + M3-13 필터만, "article/main/section 우선" / "OpenGraph" / "boilerplate 제외" 는 Phase 1 M3 PoC 결정 또는 Phase 2+). **Privacy 강화**: 디폴트 8 → 11 패턴 (signin/oauth/id/payment/pay/checkout 추가) + path glob (M3 PathMatcher 도입). **PDF**: P1 시나리오 영향 명시 (URL/제목/시간만 저장, 본문 RAG Phase 2+). **embedding_status**: Page schema 침범 회피 — EmbeddingQueue 테이블 status 컬럼으로 격하.
