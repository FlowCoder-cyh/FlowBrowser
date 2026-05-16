# v0.4 방향 정립 — 결정사항 SSOT

> **이 문서의 역할**: PRD v0.4 작성 전 단계에서 확정된 방향·결정사항을 한 곳에 누적.
> PRD v0.4 작성 시 본 문서를 SSOT로 인용. 본 문서 수정은 사용자 명시 결정 시에만.

## 메타

- **작성일**: 2026-05-16
- **세션**: v0.4 방향 정립 대화 (Sprint 014 종료 후 방향 전환 컨텍스트)
- **소스**:
  - `.flowset/handoffs/2026-05-16.md` (Sprint 014 종료 + 방향 전환 결정)
  - 이전 세션 JSON `3ab3cf7c-ad90-4ae4-80c9-3e66f6978e2b.jsonl` L2574~L2698 (방향 결정 흐름)
  - L2618 "Memory + Workspace 결합 컨셉 상세" (컨셉 SSOT)
- **상태**: 박힘 (PRD v0.4 작성 입력으로 사용)

---

## 1. 한 줄 정의

> **본 페이지를 자동 기억하면서, 프로젝트별로 환경이 격리되는 AI 리서치 브라우저**

이름: FlowBrowser AI (변경 없음)

---

## 2. 정체성 + 결격사유 0 원칙

### 2.1 User-Agent (Brave/Edge/Vivaldi 패턴)

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 FlowBrowserAI/0.1.0
```

- Chromium 호환 토큰 유지 → 사이트 표준 응답 보장
- `FlowBrowserAI/0.1.0` 자체 식별 토큰 추가 → 정직한 정체성 명시
- **위장 안 함** (Electron 토큰 제거 같은 hack 금지)

### 2.2 금지선 (모든 사이트 결격사유 0 보장)

| 금지 항목 | 이유 |
|---|---|
| 헤드리스 모드 | 봇 탐지 트리거 |
| fingerprint 변조 | 위장 = 정체성 원칙 위반 |
| 자동 prefetch / 크롤링 | 봇 의심 패턴 |
| 사용자가 안 본 페이지 자동 fetch | 사이트 무관 트래픽 생성 |
| AI가 페이지 자동 조작 (에이전트) | Cloudflare/reCAPTCHA 트리거 |

### 2.3 동작 원칙

- 페이지 호출 = **사용자가 직접 연 페이지만**
- AI 호출 = **사용자 본인 OAuth 토큰**으로 OpenAI/Codex에 별도 호출 (사이트와 무관)
- 인덱싱 = 사용자가 본 페이지의 DOM만 (페이지 재 fetch 안 함)

→ 사이트 입장에서는 또 하나의 Chromium 호환 브라우저일 뿐, 비정상 패턴 0.

---

## 3. 워크스페이스 메타포

```
워크스페이스 = 프로젝트 단위로 격리된 "방"
  ├─ 자체 탭 그룹
  ├─ 자체 페이지 메모리 (인덱스)
  ├─ 자체 AI 컨텍스트 (대화 히스토리, "AI 메모")
  ├─ 자체 노트
  └─ 자체 cookies/session (Phase 2+)
```

- 사용자가 "📚 신약 리서치", "🏠 전세집 찾기", "💻 GraphQL 학습" 같은 워크스페이스 생성
- 전환 시 탭/메모리/AI/노트 전부 교체
- 다른 워크스페이스 노이즈 0
- 앱 첫 실행 시 "📥 기본" 워크스페이스 자동 생성 (사용자 학습 부담 0)

---

## 4. UI 레이아웃 (L2618 스케치 기반)

```
┌─[FlowBrowser AI]──────────────────────────────────────────────────┐
│┌─워크스페이스─┐  ┌─Tab1─┐ ┌─Tab2─┐ ┌─Tab3─┐ ┌─+─┐   ┌─[🔍 시간축]─┐ │
││📚 신약 리서치│  │      │ │      │ │      │ └───┘   │             │ │
││🏠 전세집 찾기│  └──────┘ └──────┘ └──────┘         └─────────────┘ │
││💻 GraphQL   │  ┌────────────────────────────────┐ ┌─AI 채팅─────┐ │
││+ 새 워크스페이스│  │                                │ │ 워크스페이스: │ │
│└──────────────┘  │       현재 활성 탭 페이지       │ │ 📚 신약리서치 │ │
│                  │                                │ │              │ │
│ ┌─메모리────┐    │                                │ │ User:        │ │
│ │ 178건 인덱싱│   │                                │ │ 이번 주 본    │ │
│ │ 마지막 12분│    │                                │ │ Phase 3 임상  │ │
│ │ 노트 23개  │    │                                │ │ 결과들 비교?  │ │
│ │ +AI 메모  │    │                                │ │              │ │
│ └────────────┘   │                                │ │ AI:          │ │
│                  └────────────────────────────────┘ │ 4건 발견 →   │ │
│                                                     │ ① BioGen ... │ │
│                                                     │ ② Pfizer ... │ │
└─────────────────────────────────────────────────────└──────────────┘
```

| 영역 | 컴포넌트 |
|---|---|
| 좌측 사이드바 | 워크스페이스 리스트 + "+ 새 워크스페이스" |
| 좌하단 메모리 패널 | N건 인덱싱 / 마지막 N분 / 노트 M개 / +AI 메모 |
| 상단 좌측 | 탭 바 (현 구조 유지) + "+" 신규 탭 |
| 상단 우측 | 시간축 검색바 (Cmd+K로 글로벌 단축키 호출) |
| 중앙 | 활성 탭 페이지 (WebContentsView, 현 구조 유지) |
| 우측 | AI 채팅 패널 (워크스페이스 표시 + 대화 + retrieval 결과) |

---

## 5. 데이터 모델

### 5.1 핵심 Entity

```
Workspace (id, name, icon, created_at, level_preference?)
  └─ Page (id, workspace_id, url, title, content, content_hash, embedding, lang, ...)
      └─ Visit (id, page_id, workspace_id, visited_at, dwell_ms)
          ├─ Note[] (id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, embedding)
          └─ AiChatHistory[] = "AI 메모"
              (id, page_id?, visit_id?, workspace_id, role, content, retrieved_page_ids[], created_at)
  └─ Tag[] (id, workspace_id, name, kind, ai_generated)
```

### 5.2 anchor 키 규칙

- **노트 anchor** = `page_id + visit_id + workspace_id` (3중 anchor)
- **AI 대화 anchor** = `workspace_id` 필수 + `page_id`·`visit_id` 선택 (페이지 컨텍스트 없이도 가능)
- **Page 본문 = `page_id` 단위 (재방문 시 재사용)**
- **Visit = 매 방문마다 누적** (시나리오 3: "첫 진입 + 다시 본 시점")

### 5.3 Forward-compatibility 컬럼 (Phase 2/3 대비)

| Entity | Phase 1 | Phase 2 추가 | Phase 3 추가 |
|---|---|---|---|
| Workspace | id/name/icon/created_at/level_preference | cookies_partition / session_storage_key | shared_id / export_format |
| Page | id/workspace_id/url/title/content/content_hash/embedding/lang/visited_count | (그대로) | translation_job_id (선택) |
| Visit | id/page_id/workspace_id/visited_at/dwell_ms | (그대로) | (그대로) |
| Note | id/page_id/visit_id/workspace_id/selected_text/body/ai_tags/embedding | highlight_anchor (DOM 위치) | (그대로) |
| AiChatHistory | id/workspace_id/page_id?/visit_id?/role/content/retrieved_page_ids/created_at | (그대로) | (그대로) |
| Tag | id/workspace_id/name/kind/ai_generated | (그대로) | (그대로) |
| (Phase 2 신규) | — | TranslationJob / Highlight | (그대로) |
| (Phase 3 신규) | — | — | ExportArtifact / SharedWorkspace |

→ Phase 1에 외래키 컬럼 nullable로 미리 박아두면 Phase 2/3에서 마이그레이션 없이 확장 가능.

---

## 6. 핵심 동작

### 6.1 자동 인덱싱

```
[사용자 페이지 열기]
   ↓
[did-finish-load 이벤트]
   ↓
[ParagraphExtractor (현 인프라 재활용) DOM 추출]
   ↓
[메타 추출: title, author, type, lang, content_hash]
   ↓
[Page 레코드 UPSERT (page_id by content_hash) + Visit 레코드 INSERT]
   ↓
[임베딩 생성 (text-embedding-3-small) — 백그라운드 큐]
   ↓
[sqlite-vec 벡터 인덱스 갱신]
   ↓
[좌하단 메모리 패널 카운트 갱신]
```

### 6.2 재방문 정책

- **같은 URL 재방문 시**: content_hash 비교
  - 변경 없음 → Visit만 INSERT (본문/임베딩 재사용)
  - 변경 있음 → Page UPDATE + 임베딩 재생성 + Visit INSERT
- 시나리오 3 "첫 진입 + 다시 본 시점" → Visit으로 양쪽 모두 보존

### 6.3 dwell_ms 측정 정책 (Phase 1 단순)

- 탭 활성 + 페이지 focus 상태 누적 시간
- focus 잃으면 일시정지, 복귀 시 재개
- 페이지 닫기 / 탭 전환 시 fix
- 정밀 측정 (스크롤 깊이 등) 은 Phase 2+ 옵션

### 6.4 검색 흐름

```
[Cmd+K 또는 검색바 입력]
   ↓
[자연어 시간 파싱: "지난주", "6개월 전쯤" → 시간 범위]
   ↓
[질의 임베딩 생성]
   ↓
[현 워크스페이스 메모리 retrieval (top-k from sqlite-vec)]
   ├─ Page 검색 대상
   └─ Note 검색 대상 ← R1 결정 (Phase 1)
   ↓
[결과 표시: 페이지 + 시간 + dwell + 워크스페이스 + (있으면) 매칭 노트 발췌]
   ↓
[클릭 시: 본문 캐시 + 해당 visit의 노트 + 해당 visit의 AI 대화 모두 복원]
   └─ 다시 fetch X (인덱스 + 캐시)
```

### 6.5 AI 채팅 흐름

```
[사용자 질의]
   ↓
[현 워크스페이스 메모리 retrieval (top-k)]
   ↓
[Provider Adapter 호출 (OpenAI / Codex OAuth)]
   ↓
[응답 schema: 텍스트 / 표 (비교 매트릭스) / 출처 인용]
   ↓
[각 출처 셀 = 페이지 링크 → 클릭 시 본문 캐시에서 표시]
   ↓
[AiChatHistory INSERT (workspace_id + retrieved_page_ids)]
```

- **디폴트 retrieval 범위 = 현 워크스페이스 메모리** (격리 원칙)
- **출력 schema**: 모델이 자동 판단 (텍스트 / 표) — Phase 1 system prompt에 schema 가이드 포함
- **수준 옵션**: 워크스페이스 설정에서 "초보/중급/고급" 직접 선택 → system prompt 분기 (R3-A, Phase 1)

### 6.6 노트 동작

- 페이지 텍스트 선택 → 컨텍스트 메뉴 "노트에 추가"
- AI 자동 태그 생성 (인덱싱 add-on, R2 결정)
- 노트 = `page_id + visit_id + workspace_id` anchor
- 노트 본문도 임베딩 → 검색 retrieval 대상 (R1 결정)

---

## 7. 임베딩 모델 결정

| Phase | 모델 | 비용 / 특성 |
|---|---|---|
| **Phase 1** | OpenAI `text-embedding-3-small` | $0.0001/페이지 (~$1~3/월), 인터넷 필수, **1024 차원** (OpenAI 기본 1536에서 `dimensions=1024` 축소, 저장·성능 최적화) |
| **Phase 3** | 로컬 옵션 추가 (sqlite-vec + sentence-transformers `all-MiniLM-L6-v2` 등) | 오프라인, 모델 다운로드 부담 |

- Phase 1 → 3 전환 시 임베딩 모델 변경 → 기존 임베딩은 무효화 (재생성 필요) → A3 데이터 마이그레이션에서 처리

---

## 8. 비용 / 저장

| 항목 | 수치 |
|---|---|
| 인덱싱 (1만 페이지/년 기준) | ~$1~3/월 |
| 검색 (질의당 LLM 호출) | ~$0.001/회 |
| AI 채팅 (질의당 LLM 호출) | ~$0.001~0.01/회 (retrieval + 응답) |
| 페이지 텍스트 + 메타 | ~10KB/페이지 |
| 임베딩 (1024 차원 × 1만) | ~40MB |
| 1만 페이지 합산 저장 | ~150MB |
| **Phase 3 로컬 LLM 옵션 사용 시** | 모든 호출 비용 0원 (전기료만) |

---

## 9. Chrome 확장 대비 차별 (자체 브라우저 정당화)

| 영역 | Chrome 확장 | FlowBrowser |
|---|---|---|
| 사이드패널 + 페이지 Q&A | ✅ | ✅ (동등) |
| 텍스트 선택 → AI 분석 | ✅ | ✅ (노트 + 자동 태그 추가) |
| **다중 워크스페이스 격리** | ⚠️ 논리 분리만 가능 / cookies·storage 격리 제한 | ✅ 자체 cookies/cache/storage 분리 (Phase 2+) |
| **수만 페이지 임베딩 인덱스** | ⚠️ unlimitedStorage 권한 + IndexedDB 가능하나 sqlite-vec / 마이그레이션 운영 부담 큼 | ✅ SQLite + sqlite-vec |
| **백그라운드 영구 인덱싱** | ⚠️ service worker 라이프사이클 (필요 시 로드, dormant 시 unload) | ✅ main process worker (사용자 세션 동안 안정) |
| **워크스페이스 단위 AI 메모리** | ⚠️ 단일 컨텍스트 (워크스페이스 자체 부재) | ✅ 격리 + 영구 |
| **OS 파일/클립보드/단축키/트레이** | ⚠️ Native messaging 우회 가능하나 권한·설치·UX 비용 큼 | ✅ 직접 통합 |
| **UI 완전 재설계** | ❌ 사이드/팝업 한정 | ✅ |
| **시간축 정밀 검색 (방문 시간 + 의미)** | ⚠️ 히스토리 API 한계 | ✅ |

---

## 10. Phase 분할 (확정 — R1/R2/R3 반영)

### 10.1 Phase 1 = Sprint 015 (베이스 인프라)

```
✓ 워크스페이스 메타 격리 (탭 그룹 + 워크스페이스 ID, "📥 기본" 자동 생성)
✓ IndexedPageStore (SQLite + sqlite-vec + 본문 캐시)
✓ 자동 인덱싱 hook (DOM extractor 일반화)
✓ 임베딩 (OpenAI text-embedding-3-small) — 페이지 + 노트 둘 다
✓ 시간축 + 의미 검색 (자연어 시간 파싱, Cmd+K, 페이지+노트 retrieval) ← R1
✓ AI 채팅 패널 (워크스페이스 메모리 retrieval + 출처 인용 + 표 출력 schema)
✓ 노트 (선택 + AI 자동 태그 + 페이지+visit+대화 anchor + 임베딩 + 검색 대상) ← R1
✓ AI 자동 태깅 (도메인 메타 추출, 인덱싱 add-on) ← R2 (P2→P1)
✓ 사용자 수준 직접 선택 (워크스페이스 설정 + system prompt 분기) ← R3-A
```

### 10.2 Phase 2 = Sprint 016+

```
+ cookies/session/캐시 완전 격리 (Electron Partition)
+ 하이라이트 (노트 페이지 내 고정 위치 표시)
+ 백그라운드 번역 작업 큐 + 시스템 알림 (논문/PDF, 시간 제약 없음)
+ 자동 수준 추정 (메타 학습 + override 가능) ← R3-B
```

### 10.3 Phase 3 = Sprint 017+

```
+ 로컬 LLM 옵션 (Provider Adapter 확장, Ollama)
+ 로컬 임베딩 옵션 (sqlite-vec + sentence-transformers)
+ Export (Notion / Markdown / JSON)
+ 워크스페이스 공유 (포맷 정의 + import/export)
```

### 10.4 MVP 정의

- **MVP = Phase 1 + Phase 2 + Phase 3 전체** (Phase별 출시 ≠ Phase별 검증)
- Phase 1 → 2 → 3 순차 진행, 각 Phase 종료 시 evaluator 8점 + Known Issue 등록
- MVP 최종 출시 = Phase 3 종료 후 딥검증 통과 시점

---

## 11. 시나리오 cover 매트릭스 (Phase별)

| 시나리오 | P1만 | + P2 | + P3 |
|---|---|---|---|
| 1 학술 리서치 (논문/arxiv/Nature) | **100%** | — (백그라운드 번역으로 강화) | — |
| 2 PM 경쟁 분석 (Linear vs Notion 비교) | **90%** | — | 100% (Notion Export) |
| 3 학습 (Rust lifetime 시간순) | **90%** | 100% (자동 수준 추정) | — |
| 4 우연한 재발견 (6개월 전 본 글) | **100%** | — | — |

→ **Sprint 015 (Phase 1)만 끝내도 4개 시나리오 평균 96% cover.**

---

## 12. 검증 흐름 (확정)

```
[Sprint 진행]
    ↓
[Sprint 종료]
    └─ Evaluator 채점 (Pass ≥ 8)
        ├─ 통과 → 약점은 Known Issue (KI-NNN) 등록
        └─ 미통과 → 즉시 보강 후 재채점
    ↓
[Phase 종료]
    └─ Evaluator 종합 채점 (Pass ≥ 8) + Known Issue 누적 정리
    ↓
[Known Issue 정리 정책]
    ├─ HIGH: 즉시 다음 Sprint M1에 처리
    ├─ MEDIUM: 5개 누적 또는 Phase 종료 시 batch (신규 기능 Sprint M1~M2에 흡수)
    └─ LOW: Phase 3 종료 후 MVP 직전 정리
    ↓
[MVP 최종 딥검증] (Phase 3 종료 후)
    ├─ 시나리오 4개 100% 시연
    ├─ 정량 임계 측정
    ├─ Evaluator 종합 채점
    └─ 사용자 실사용 1주 + 일지
```

### 12.1 Severity 정의

| Severity | 정의 | 처리 |
|---|---|---|
| HIGH | 핵심 시나리오 불가능 / 보안 / 데이터 손실 위험 | 즉시 다음 Sprint M1 |
| MEDIUM | 시나리오 동작하지만 UX 불편 / 성능 임계 미달 | 5개 누적 또는 Phase 종료 시 batch |
| LOW | 정성적 개선 / 마이너 버그 | Phase 3 종료 후 MVP 직전 정리 |

### 12.2 Known Issue 등록 형식

- 파일: `.flowset/known-issues.md` (가드레일과 같은 단일 파일 패턴)
- 형식: `KI-NNN / Severity / Phase / Component / 영향 / 발견 evaluator 인용 / 상태(open/closed)`

### 12.3 정량 임계 (Phase 1 예시 — Phase 종료 시 측정)

| 지표 | 임계 |
|---|---|
| 인덱싱 속도 | 페이지당 < 500ms (DOM+메타+임베딩 포함) |
| 검색 응답 | < 200ms (top-5 retrieval, 본문 캐시 제외) |
| 검색 정확도 | top-5 hit rate ≥ 80% (자체 페어 테스트 셋) |
| 임베딩 비용 | < $3/월 (1만 페이지 기준) |
| 저장 용량 | < 200MB / 만 페이지 |
| AI 응답 출처 인용 정확도 | ≥ 90% |

---

## 13. PRD v0.4 섹션 분할 (00~19 = 20행: README + 19개 섹션)

```
docs/prd/
  README.md                       — 목차 + v0.3 → v0.4 전환 안내
  00_change_history.md            — 전환 기록 (Sprint 014 종료 → v0.4 방향)
  01_overview.md                  — 한 줄 + 정체성 + 결격사유 0 원칙
  02_personas_scenarios.md        — 4개 페르소나 + 시나리오 1~4
  03_value_propositions.md        — Chrome 확장 대비 차별
  04_data_model.md                — Entity ERD + anchor 키 + forward-compatibility
  05_crud_matrix.md               — CRUD 매트릭스 (Entity × Actor) + IPC 채널 + 라이프사이클
  06_architecture.md              — Main/Renderer + IPC + 컴포넌트 트리 + 의존 그래프
  07_ui_layout.md                 — UI 스케치 + 컴포넌트 spec
  08_indexing.md                  — 인덱싱 흐름 + 임베딩 + 캐시 + 재방문 정책
  09_search.md                    — 검색 흐름 + 자연어 시간 파싱 + retrieval 정책
  10_ai_chat.md                   — 채팅 retrieval + 출력 schema + 출처 인용 + 수준 옵션
  11_workspace.md                 — 격리 모델 (P1 메타 / P2 cookies) + 전환 UX
  12_provider_adapter.md          — OpenAI / Codex OAuth / 로컬 LLM (P3) + 모델 fallback
  13_security_privacy.md          — Privacy Filter + OS Keychain + UA 정체성
  14_translation_background.md    — 백그라운드 번역 (P2) + 작업 큐 + 알림 + 결과 저장
  15_costs_storage.md             — 비용 / 저장 / 임계
  16_roadmap.md                   — Phase 1/2/3 + Sprint 매핑 + 시나리오 cover 매트릭스
  17_known_issues_policy.md       — KI-NNN 정책 + Severity 정의
  18_evaluation.md                — 검증 layering (Sprint·Phase·MVP) + 정량 임계 셋
  19_migration_v03_v04.md         — v0.3 → v0.4 모듈 매핑 + 데이터 마이그레이션 + 회귀 셋
```

---

## 14. 사전 분석 4종 (PRD 작성 전 필수)

### A1. 폐기 코드 식별 매트릭스

- 산출물: `.flowset/specs/v04-migration-matrix.md`
- 내용: 파일/모듈 단위 분류 (폐기 / 일반화 / 유지 / 부분 폐기)
- 입력: PRD §06 (architecture) + §19 (migration)

### A2. 단위 테스트 분류

- 산출물: `.flowset/specs/v04-test-classification.md`
- 내용: 358개 테스트 → 폐기 N / 유지 M / 재작성 K + 신규 회귀 셋 정의
- 입력: PRD §18 (evaluation)

### A3. 데이터 마이그레이션 분석

- 산출물: `.flowset/specs/v04-data-migration.md`
- 내용: 기존 SQLite / TranslationCache / PageResultStore / Glossary / Settings의 운명 + 자동 마이그레이션 스크립트 spec
- 입력: PRD §19 (migration)

### A4. 의존 그래프 분석

- 산출물: `.flowset/specs/v04-dependency-graph.md`
- 내용: 폐기 대상 모듈을 의존하는 호출지점 전수 + IPC 채널 변경 영향
- 입력: PRD §06 (architecture)

---

## 15. 안전장치 4종 (Sprint 015 구현 중 적용)

| # | 안전장치 | 적용 시점 |
|---|---|---|
| S1 | **단계별 PR 전략** — 한 번에 다 갈아엎지 X. M2 일반화 시 v0.3 호환 유지 → M3 신규 사용 → M5에서 v0.3 호출지점 제거 | M2~M5 |
| S2 | **회귀 테스트 셋** — Phase 1 시나리오 4개에 대한 자동화 셋 | M2 시작 시 셋 정의, M3~M6 매 PR에서 통과 강제 |
| S3 | **feature flag** (`flowbrowser.v04.enabled`) — 신규 모듈 도입 시 기존 동작 유지 가능 | M2~M5 |
| S4 | **데이터 마이그레이션 dry-run + 백업** — 사용자 기존 SQLite 자동 백업 후 마이그레이션. 백업 위치: `<userDataDir>/backup/v03/<ISO_timestamp>/` (Electron `app.getPath('userData')` 기준, OS 호환). 마이그레이션 로그: `<userDataDir>/migration-v04.log` | M3 (IndexedPageStore 도입 시) |

---

## 16. 진행 흐름 (확정)

```
[M0 — 사전 분석] (Sprint 015 신설 milestone)
    ├─ A1 폐기 코드 식별 매트릭스
    ├─ A2 단위 테스트 분류
    ├─ A3 데이터 마이그레이션 분석
    └─ A4 의존 그래프 분석
    ↓
[M1 — PRD v0.4 19개 섹션 작성]
    ↓
[M2 — 폐기 + 일반화 (S1 단계별 PR + S3 feature flag)]
    ├─ TranslationCache → AIResponseCache 일반화
    ├─ PageResultStore → IndexedPageStore 일반화
    └─ TranslationRenderer / SummarizationPlanner 폐기 마킹
    ↓
[M3 — IndexedPageStore (SQLite + sqlite-vec + 본문 캐시) + 임베딩 백그라운드 작업]
    └─ S4 데이터 마이그레이션 dry-run 적용
    ↓
[M4 — 페이지 인덱싱 hook (did-finish-load → 백그라운드 인덱싱) + AI 자동 태깅]
    ↓
[M5 — 검색바 (Cmd+K) + AI 채팅 패널 (TranslationPanel → ChatPanel) + 노트]
    ├─ 노트 임베딩 + 검색 retrieval (R1)
    ├─ AI 채팅 retrieval + 출력 schema + 출처 인용
    └─ 수준 옵션 (R3-A)
    ↓
[M6 — 워크스페이스 사이드바 + 메모리 통계 UI + Sprint 015 종합 핸드오프]
    ↓
[Sprint 015 종료 evaluator + Known Issue 등록]
    ↓
[Sprint 016+ — Phase 2 진입]
```

---

## 17. 박힌 결정 사항 요약 (체크리스트)

### 방향
- [x] AI 브라우저 본체 유지 (방향 전환만)
- [x] 번역 / YouTube / STT 폐기 (번역은 백그라운드 장시간으로 재정의, Phase 2)
- [x] 신규 메인 = AI 콘텐츠 메모리 + 워크스페이스 (L2618 #2+#1 결합)

### 정체성
- [x] UA 위장 X — 자체 브랜드 UA (Brave/Edge 패턴)
- [x] 모든 사이트 결격사유 0 — Chrome 호환 + AI 레이어 부가
- [x] 헤드리스 X, 봇 우회 X, 자동 prefetch X

### 컴포넌트 분배
- [x] 노트 = Phase 1 base
- [x] 페이지 본문 캐시 = Phase 1 base
- [x] 시간축 자연어 파싱 = Phase 1 base
- [x] 비교 매트릭스 = AI 채팅 출력 schema (별도 view X)
- [x] **R1: 노트도 임베딩 + 검색 retrieval 대상 (Phase 1)**
- [x] **R2: AI 자동 태깅 (도메인 메타 추출) Phase 2 → Phase 1**
- [x] **R3-A: 사용자 수준 직접 선택 (Phase 1)**
- [x] **R3-B: 자동 수준 추정 (Phase 2)**
- [x] cookies/session 격리 = Phase 2
- [x] 백그라운드 번역 = Phase 2
- [x] 하이라이트 = Phase 2
- [x] 로컬 LLM / 로컬 임베딩 = Phase 3
- [x] Export = Phase 3
- [x] 워크스페이스 공유 = Phase 3

### 운영
- [x] MVP = Phase 1+2+3 전체 (Phase별 출시 X)
- [x] 검증 = Sprint·Phase 종료 evaluator 8점 + Known Issue 등록 + MVP 종료 시 딥검증
- [x] Severity HIGH/MEDIUM/LOW 정의 + 처리 정책
- [x] 임베딩 Phase 1 = OpenAI text-embedding-3-small / Phase 3 로컬 옵션
- [x] PRD = 19개 섹션 분할
- [x] 사전 분석 A1~A4 → M0 신설
- [x] 안전장치 S1~S4

### 디폴트 정책 (자연 추정)
- [x] 앱 첫 실행 시 "📥 기본" 워크스페이스 자동 생성
- [x] AI 채팅 retrieval 디폴트 = 현 워크스페이스 메모리 (격리 원칙)
- [x] 재방문 시 content_hash 비교 → 변경 없으면 Visit만 누적
- [x] dwell_ms = 탭 활성 + 페이지 focus 시간 (정밀 측정은 Phase 2+)

### 데이터 마이그레이션 (A3 입력)
- [x] **Glossary → Note 자동 이전**: "📥 기본" 워크스페이스 / `ai_tags = ["glossary"]` / 검색 retrieval 대상 자동 포함
- [x] **settings 호환**: 폐기 항목 자동 제거 + `<userDataDir>/migration-v04.log` 기록 / **폐기 키 = `translationMode` / `cancelOnTabSwitch`** (M0 A3 코드 실측 — `displayMode` / `summaryPolicy` / `fontSize` / `paragraphIPC` 은 실제 schema에 없음, 본 §17 정정 2026-05-16)

### Schema (PRD §04/§10 입력)
- [x] **Tag schema**: `Tag.kind ∈ {topic, entity, metric, sentiment, domain, freeform}` — 정형 + free-form 결합 / 시나리오 1·2 모두 cover
- [x] **AI 채팅 표 schema**: Markdown + JSON 메타 결합 / 사용자 표시 = markdown / 내부 메타 = `{rows, columns, cells: [{value, sources:[{page_id, visit_id}]}]}` / 셀 클릭 = 본문 캐시 표시

### 인덱싱·검색·UX (PRD §07~§09/§13 입력)
- [x] **인덱싱 큐 우선순위**: 활성 탭 우선, 동일 priority 내 FIFO / 사용자가 보는 페이지 즉시 검색 반영
- [x] **Privacy Filter 인덱싱 차단**: 디폴트 list + 컨텐츠 감지 (비밀번호 필드) 결합 / 디폴트 패턴 = `*.bank.com / mail.google.com / gmail.com / *.paypal.com / *.naver.com/mail/* / *.icloud.com / accounts.google.com / login.*` 등 / 사용자 추가·제외 가능
- [x] **Cmd+K 단축키**: 사용자 설정 가능 (디폴트 Cmd/Ctrl+K) / WebContentsView 안의 Cmd/Ctrl+K를 메인 프로세스에서 먼저 캡처 / 사이트 충돌 시 Cmd+Shift+K 등으로 변경 가능
- [x] **검색 정렬 공식 (Phase 1)**: `score = 0.85 × cosine_sim + 0.15 × time_factor` / `time_factor = exp(-days_ago / 180)` (180일 반감기) / 시나리오 4 "6개월 전" cover 위해 시간 가중치 약하게 / dwell 가중치는 Phase 2+ 옵션
- [x] **검색 미리보기**: 제목 + URL + 의미 매칭 발췌 (±100자 highlight) + 시간 시그널 ("5일 전, 12분 머묾" / "8개월 전, 짧게 본 거")
- [x] **워크스페이스 아이콘**: preset 12종 (📚 💻 🎯 🏠 🔬 ✍️ 🎨 📊 🌍 ⚖️ 💡 🛒) + 사용자 이모지 자유 입력 / 이미지 업로드는 Phase 2+

---

## 18. 추가 결정 완료 (P0~P2 10건, 2026-05-16)

본 세션에서 §17의 모든 미박힘 항목 박힘. PRD 작성 시 추측 없는 입력으로 사용.

| # | 항목 | 결정 | PRD 책임 섹션 |
|---|---|---|---|
| P0-1 | Glossary 운명 | Note로 자동 이전 (ai_tags=["glossary"]) | §19 + A3 |
| P0-2 | settings 호환 | 폐기 항목 자동 제거 + 로그 | A3 |
| P0-3 | AI 태깅 schema | 정형 + free-form 결합 (kind 필드) | §10 |
| P0-4 | AI 채팅 표 schema | Markdown + JSON 메타 결합 | §10 |
| P1-8 | 인덱싱 큐 우선순위 | 활성 탭 우선 | §08 |
| P1-9 | Privacy Filter 차단 | 디폴트 list + 컨텐츠 감지 | §13 |
| P1-10 | Cmd+K 단축키 | 사용자 설정 (디폴트 Cmd/Ctrl+K) | §07 |
| P2-5 | 검색 정렬 공식 | 결합 공식 (의미 0.85 + 시간 0.15, 180일 반감기) | §09 |
| P2-6 | 검색 미리보기 | 제목+URL+발췌+시간 시그널 | §09 |
| P2-7 | 워크스페이스 아이콘 | preset 12종 + 사용자 이모지 | §11 |

---

## 19. 참조

- 핸드오프: `.flowset/handoffs/2026-05-16.md`
- 이전 컨셉 정의: 세션 `3ab3cf7c` L2618
- 가드레일: `.flowset/guardrails.md`
- 온톨로지: `.flowset/ontology.md`
- 현재 PRD (v0.3): `docs/prd/`
