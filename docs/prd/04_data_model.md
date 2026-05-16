# 04. 데이터 모델 (Data Model)

> [← PRD 목차](./README.md)

## 4.1 핵심 Entity 그래프

```
Workspace (id, name, icon, created_at, level_preference?)
  ├─ Page (id, workspace_id, url, title, content, content_hash, embedding, lang, visited_count, ...)
  │   └─ Visit (id, page_id, workspace_id, visited_at, dwell_ms)
  │       ├─ Note[] (id, page_id, visit_id, workspace_id, selected_text, body, ai_tags, embedding)
  │       └─ AiChatHistory[] = "AI 메모"
  │           (id, workspace_id, page_id?, visit_id?, role, content, retrieved_page_ids[], created_at)
  └─ Tag[] (id, workspace_id, name, kind, ai_generated)
```

**Phase 1 base 7 entity**:
1. Workspace
2. Page
3. Visit
4. Note
5. AiChatHistory
6. Tag
7. Embedding (Page·Note 외래키, sqlite-vec 별도 테이블)

## 4.2 anchor 키 규칙

| Entity | anchor 키 | 설명 |
|---|---|---|
| Workspace | `id` (UUID) | 최상위 격리 단위 |
| Page | `id` (UUID) + `workspace_id` | URL은 본문 변경 추적 위해 별도, page_id 단위로 재방문 시 재사용 |
| Visit | `id` (UUID) + `page_id` + `workspace_id` | 매 방문마다 INSERT (시나리오 3 "첫 진입 + 다시 본 시점") |
| **Note** | **`page_id` + `visit_id` + `workspace_id` (3중 anchor)** | 검색 결과 클릭 시 "그때 작성한 노트" 복원 위해 visit 단위 anchor |
| **AiChatHistory** | **`workspace_id` 필수 + `page_id?` + `visit_id?` (조건부 3중)** | 워크스페이스 단독 대화 가능 (페이지 컨텍스트 없이) |
| Tag | `id` + `workspace_id` | 워크스페이스 단위 격리 |
| Embedding | `entity_type` (page·note) + `entity_id` | sqlite-vec 1k 차원 벡터 |

## 4.3 Entity 컬럼 spec (Phase 1)

### 4.3.1 Workspace

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| name | TEXT | NOT NULL | 사용자 입력 (예: "📚 신약 리서치") |
| icon | TEXT | NOT NULL | 이모지 (preset 12종 또는 사용자 입력) |
| created_at | TIMESTAMP | NOT NULL | 생성 시점 |
| level_preference | TEXT | NULLABLE | "novice" / "intermediate" / "advanced" / NULL (system prompt 분기 X) |

### 4.3.2 Page

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| workspace_id | UUID | FK Workspace, NOT NULL | 격리 단위 |
| url | TEXT | NOT NULL, INDEX | 정규화된 URL (origin + pathname) |
| title | TEXT | NOT NULL | DOM에서 추출 |
| content | TEXT | NOT NULL | 본문 (DOM 추출, 청크 정책은 [§08](./08_indexing.md)) |
| content_hash | TEXT | INDEX | sha256(content) — 재방문 시 변경 감지 |
| embedding | BLOB | (vector index) | text-embedding-3-small 임베딩 (sqlite-vec, 차원은 §08 결정) |
| lang | TEXT | NULLABLE | DOM `lang` 속성 또는 자동 감지 |
| visited_count | INTEGER | DEFAULT 1 | Visit 누적 카운트 (denormalized, 검색 가중치) |

### 4.3.3 Visit

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| page_id | UUID | FK Page, NOT NULL | |
| workspace_id | UUID | FK Workspace, NOT NULL | 빠른 조회 위해 denormalized |
| visited_at | TIMESTAMP | NOT NULL, INDEX | 시간축 검색 base |
| dwell_ms | INTEGER | DEFAULT 0 | 탭 활성 + focus 시간 누적 (페이지 닫기/탭 전환 시 fix) |

### 4.3.4 Note

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| page_id | UUID | FK Page, NULLABLE | NULL 가능 (Glossary 마이그레이션 케이스) |
| visit_id | UUID | FK Visit, NULLABLE | NULL 가능 (Glossary 마이그레이션 케이스) |
| workspace_id | UUID | FK Workspace, NOT NULL | |
| selected_text | TEXT | NOT NULL | 사용자가 선택한 페이지 텍스트 |
| body | TEXT | NULLABLE | 사용자 추가 메모 |
| ai_tags | JSON ARRAY | NULLABLE | AutoTagger 결과 (예: `["glossary", "topic:CAR-T"]`) |
| embedding | BLOB | (vector index) | 노트 본문 임베딩 (검색 retrieval 대상) |
| created_at | TIMESTAMP | NOT NULL | |

### 4.3.5 AiChatHistory ("AI 메모")

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| workspace_id | UUID | FK Workspace, NOT NULL | 워크스페이스 단위 영구 보존 |
| page_id | UUID | FK Page, NULLABLE | 특정 페이지 컨텍스트 채팅이면 박힘 |
| visit_id | UUID | FK Visit, NULLABLE | 특정 visit 시점 채팅이면 박힘 |
| role | TEXT | NOT NULL | "user" / "assistant" / "system" |
| content | TEXT | NOT NULL | 메시지 본문 (markdown 가능) |
| retrieved_page_ids | JSON ARRAY | NULLABLE | RAG retrieval 결과 page_id 배열 (출처 인용용) |
| chat_meta | JSON | NULLABLE | 표 출력 JSON 메타 (`{rows, columns, cells: [{value, sources}]}`) |
| created_at | TIMESTAMP | NOT NULL | |

### 4.3.6 Tag

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | |
| workspace_id | UUID | FK Workspace, NOT NULL | 격리 |
| name | TEXT | NOT NULL | 태그 이름 |
| kind | TEXT | NOT NULL, CHECK | `topic` / `entity` / `metric` / `sentiment` / `domain` / `freeform` 6종 |
| ai_generated | BOOLEAN | DEFAULT FALSE | AutoTagger 자동 vs 사용자 수동 |

### 4.3.7 Page·Note ↔ Tag (M:N)

```sql
PageTag (page_id, tag_id, PRIMARY KEY (page_id, tag_id))
NoteTag (note_id, tag_id, PRIMARY KEY (note_id, tag_id))
```

### 4.3.8 Embedding (sqlite-vec)

```sql
-- sqlite-vec virtual table (차원은 §08 임베딩 모델 결정에 따라)
CREATE VIRTUAL TABLE vec_pages USING vec0(
  page_id TEXT PRIMARY KEY,
  embedding float[N]
);
CREATE VIRTUAL TABLE vec_notes USING vec0(
  note_id TEXT PRIMARY KEY,
  embedding float[N]
);
```

> **참고**: 벡터 차원 N 은 [§08 인덱싱](./08_indexing.md) 임베딩 모델 결정에 따라 박힘. OpenAI `text-embedding-3-small` 기본 1536 차원, 압축·호환성 위한 축소 옵션은 §08에서 결정. PR b3 시점 미정.

## 4.4 Forward-compatibility (Phase 2/3 외래키 nullable)

Phase 1 schema에 외래키 컬럼을 미리 nullable 로 박아두면 Phase 2/3에서 마이그레이션 없이 확장 가능 (테이블 ALTER 부담 회피).

| Entity | Phase 1 | Phase 2 추가 (nullable, ALTER 없음) | Phase 3 추가 |
|---|---|---|---|
| Workspace | id/name/icon/created_at/level_preference | cookies_partition / session_storage_key | shared_id / export_format |
| Page | id/workspace_id/url/title/content/content_hash/embedding/lang/visited_count | (그대로) | translation_job_id |
| Visit | id/page_id/workspace_id/visited_at/dwell_ms | (그대로) | (그대로) |
| Note | id/page_id/visit_id/workspace_id/selected_text/body/ai_tags/embedding/created_at | highlight_anchor (DOM 위치) | (그대로) |
| AiChatHistory | id/workspace_id/page_id?/visit_id?/role/content/retrieved_page_ids/chat_meta/created_at | (그대로) | (그대로) |
| Tag | id/workspace_id/name/kind/ai_generated | (그대로) | (그대로) |
| **(Phase 2 신규 테이블)** | — | TranslationJob / Highlight | (그대로) |
| **(Phase 3 신규 테이블)** | — | — | ExportArtifact / SharedWorkspace |

## 4.5 인덱스 정책

| 인덱스 | 대상 | 용도 |
|---|---|---|
| `idx_page_workspace_url` | Page (workspace_id, url) | 재방문 시 page lookup |
| `idx_page_content_hash` | Page (content_hash) | 본문 변경 감지 dedupe |
| `idx_visit_workspace_time` | Visit (workspace_id, visited_at DESC) | 시간축 검색 base |
| `idx_visit_page` | Visit (page_id) | 페이지별 visit history |
| `idx_note_visit` | Note (visit_id) | 검색 결과 클릭 시 노트 복원 |
| `idx_chat_workspace_time` | AiChatHistory (workspace_id, created_at DESC) | 워크스페이스 대화 히스토리 |
| `vec_pages` | Page embedding | sqlite-vec top-k retrieval |
| `vec_notes` | Note embedding | sqlite-vec top-k retrieval |

## 4.6 데이터 마이그레이션 매핑 (v0.3 → v0.4)

[§19 마이그레이션](./19_migration_v03_v04.md) 본문 참조. 요약:

| v0.3 | v0.4 매핑 |
|---|---|
| `glossary.json` GlossaryTerm | Note (ai_tags=["glossary", domain], 📥 기본 워크스페이스, page_id·visit_id NULL) |
| `page-results.json` | Page + Visit (workspace_id=📥 기본, content 빈값, 임베딩 큐 등록) |
| `translation-cache.json` | AIResponseCache (kind=translation) |
| `user-setting.json` translationMode / cancelOnTabSwitch | 자동 제거 (폐기 키) |
| `tabs.json` | TabState (workspace_id 메타 추가) |

## 4.7 SSOT 인용

- `.flowset/specs/v04-direction.md` §5 (Entity 그래프 + anchor 키 + forward-compatibility)
- `.flowset/specs/v04-data-migration.md` §A (마이그레이션 매핑)
- `.flowset/specs/v04-migration-matrix.md` §E (신규 storage 모듈 — IndexedPageStore / VectorIndex / EmbeddingQueue 등)

본 §04 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 4.8 변경 이력

- 2026-05-16 (PR b3): stub → 본문 작성. 7 entity (Workspace/Page/Visit/Note/AiChatHistory/Tag/Embedding) 컬럼 spec + anchor 키 + 인덱스 정책 + Phase 2/3 forward-compatibility + 마이그레이션 cross-reference.
