# 04. 데이터 모델 (Data Model)

> [← PRD 목차](./README.md)

## 4.1 핵심 Entity 그래프

```
Workspace (id, name, icon, created_at, level_preference?)
  ├─ Page (id, workspace_id, url, title, content, content_hash, lang, visited_count, ...)
  │   └─ Visit (id, page_id, workspace_id, visited_at, dwell_ms)
  │       ├─ Note[] (id, page_id?, visit_id?, workspace_id, selected_text, body, ai_tags, ...)
  │       └─ AiChatHistory[] = "AI 메모"
  │           (id, workspace_id, page_id?, visit_id?, role, content, retrieved_items[], chat_meta?)
  └─ Tag[] (id, workspace_id, name, kind, ai_generated)

PageTag (page_id, tag_id) — M:N
NoteTag (note_id, tag_id) — M:N
vec_pages (page_id, workspace_id, embedding) — sqlite-vec virtual
vec_notes (note_id, workspace_id, embedding) — sqlite-vec virtual
```

**Phase 1 base 7 entity + 2 M:N + 2 vector**:
1. Workspace
2. Page
3. Visit
4. Note
5. AiChatHistory
6. Tag (+ PageTag / NoteTag M:N)
7. Embedding (vec_pages / vec_notes virtual table, workspace_id partition)

## 4.2 anchor 키 규칙

| Entity | anchor 키 | 설명 |
|---|---|---|
| Workspace | `id` (UUID) | 최상위 격리 단위 |
| Page | `id` (UUID) + `workspace_id` | URL은 본문 변경 추적 위해 별도, page_id 단위로 재방문 시 재사용 |
| Visit | `id` (UUID) + `page_id` + `workspace_id` | 매 방문마다 INSERT |
| **Note** | **`page_id?` + `visit_id?` + `workspace_id` (3중 anchor, page/visit nullable)** | 검색 결과 클릭 시 "그때 작성한 노트" 복원. Glossary 마이그레이션 시 page·visit NULL |
| **AiChatHistory** | **`workspace_id` 필수 + `page_id?` + `visit_id?`** | 워크스페이스 단독 대화 가능 (페이지 컨텍스트 없이) |
| Tag | `id` + `workspace_id` | 워크스페이스 단위 격리 |
| Embedding | `workspace_id` (partition) + `page_id` 또는 `note_id` | sqlite-vec partition_key, top-k 전 워크스페이스 격리 |

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
| workspace_id | UUID | FK Workspace, NOT NULL, ON DELETE CASCADE | 격리 단위 |
| url | TEXT | NOT NULL | 정규화된 URL (origin + pathname) |
| title | TEXT | NOT NULL DEFAULT '' | DOM에서 추출 (빈 문자열 허용, 마이그레이션 케이스) |
| content | TEXT | NOT NULL DEFAULT '' | 본문 (DOM 추출, 빈 문자열 허용 — 마이그레이션 시 후속 인덱싱) |
| content_hash | TEXT | INDEX | sha256(content) — 재방문 시 변경 감지. content 빈값이면 NULL 가능 |
| lang | TEXT | NULLABLE | DOM `lang` 속성 또는 자동 감지 |
| visited_count | INTEGER | DEFAULT 1 | Visit 누적 카운트 (denormalized, 검색 가중치) |
| created_at | TIMESTAMP | NOT NULL | |
| updated_at | TIMESTAMP | NOT NULL | content 변경 시 갱신 |

**임베딩**은 별도 `vec_pages` virtual table (§4.3.8 참조). Page 테이블에 embedding 컬럼 X.

### 4.3.3 Visit

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| page_id | UUID | FK Page, NOT NULL, ON DELETE CASCADE | |
| workspace_id | UUID | FK Workspace, NOT NULL | 빠른 조회 위해 denormalized |
| visited_at | TIMESTAMP | NOT NULL, INDEX | 시간축 검색 base |
| dwell_ms | INTEGER | DEFAULT 0 | 탭 활성 + focus 시간 누적 (페이지 닫기/탭 전환 시 fix) |

### 4.3.4 Note

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| page_id | UUID | FK Page, NULLABLE, ON DELETE SET NULL | NULL 가능 (Glossary 마이그레이션 케이스) |
| visit_id | UUID | FK Visit, NULLABLE, ON DELETE SET NULL | NULL 가능 (동상) |
| workspace_id | UUID | FK Workspace, NOT NULL, ON DELETE CASCADE | |
| selected_text | TEXT | NOT NULL | 사용자가 선택한 페이지 텍스트 |
| body | TEXT | NULLABLE | 사용자 추가 메모 |
| ai_tags | JSON ARRAY | NULLABLE | AutoTagger 결과. **prefix 정책**: `["kind:name"]` 형식 (예: `["glossary", "topic:CAR-T", "domain:medicine"]`). "glossary" 는 도메인 무관 마이그레이션 마커. raw domain 은 `domain:` prefix. |
| created_at | TIMESTAMP | NOT NULL | |
| created_by | TEXT | NOT NULL CHECK ('user', 'migration') | 출처 (사용자 직접 / 마이그레이션) |

**임베딩**은 별도 `vec_notes` virtual table.

### 4.3.5 AiChatHistory ("AI 메모")

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | 자동 생성 |
| workspace_id | UUID | FK Workspace, NOT NULL, ON DELETE CASCADE | 워크스페이스 단위 영구 보존 |
| page_id | UUID | FK Page, NULLABLE | 특정 페이지 컨텍스트 채팅이면 박힘 |
| visit_id | UUID | FK Visit, NULLABLE | 특정 visit 시점 채팅이면 박힘 |
| role | TEXT | NOT NULL CHECK ('user', 'assistant', 'system', 'error') | 'error' = Provider 호출 실패 시 시스템 메시지 |
| content | TEXT | NOT NULL | 메시지 본문 (markdown 가능) |
| retrieved_items | JSON ARRAY | NULLABLE | RAG retrieval 결과 (page+note 둘 다 cover). 형식: `[{type: 'page'\|'note', id, page_id, visit_id?}]` |
| chat_meta | JSON | NULLABLE | 표 출력 JSON 메타. 형식: `{rows, columns, cells: [{value, sources: [{type, id, page_id, visit_id?}]}]}` |
| status | TEXT | NOT NULL DEFAULT 'ok' CHECK ('ok', 'pending', 'failed', **'aborted'**) | assistant 응답 중간/실패/중단 상태. 'aborted' = 사용자 명시 abort (chat:abort IPC). 재시도 정책 §4.6 참조 (PR b6.1 추가) |
| created_at | TIMESTAMP | NOT NULL | |

### 4.3.6 Tag

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | UUID | PK | |
| workspace_id | UUID | FK Workspace, NOT NULL, ON DELETE CASCADE | 격리 |
| name | TEXT | NOT NULL | 태그 이름 |
| kind | TEXT | NOT NULL CHECK | `topic` / `entity` / `metric` / `sentiment` / `domain` / `freeform` 6종 |
| ai_generated | BOOLEAN | DEFAULT FALSE | AutoTagger 자동 vs 사용자 수동 |
| created_at | TIMESTAMP | NOT NULL | |

UNIQUE: `(workspace_id, kind, name)`.

### 4.3.7 PageTag · NoteTag (M:N)

```sql
CREATE TABLE PageTag (
  page_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  workspace_id UUID NOT NULL,  -- denormalized for cascade
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (page_id, tag_id),
  FOREIGN KEY (page_id) REFERENCES Page(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES Tag(id) ON DELETE CASCADE
);

CREATE TABLE NoteTag (
  note_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES Note(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES Tag(id) ON DELETE CASCADE
);
```

`workspace_id` denormalized — Workspace cascade DELETE 시 인덱스 활용.

### 4.3.8 Embedding (sqlite-vec virtual table)

```sql
-- 차원: 1024 (OpenAI text-embedding-3-small `dimensions=1024` 축소, 기본 1536에서 축소)
-- 결정 SSOT: v04-direction §7
-- partition_key: workspace_id (top-k 전 워크스페이스 격리)
-- rowid (integer PK) + UUID metadata 패턴 (sqlite-vec 제약)

CREATE VIRTUAL TABLE vec_pages USING vec0(
  rowid INTEGER PRIMARY KEY,
  page_id TEXT,
  workspace_id TEXT partition_key,
  embedding float[1024]
);

CREATE VIRTUAL TABLE vec_notes USING vec0(
  rowid INTEGER PRIMARY KEY,
  note_id TEXT,
  workspace_id TEXT partition_key,
  embedding float[1024]
);
```

> **참고**: sqlite-vec `vec0` 가상 모듈은 integer rowid + metadata 컬럼 + `float[N]` 패턴 사용. PR b3 시점 schema 안 (M3 sqlite-vec 도입 PoC에서 정확 문법 검증 후 확정). `partition_key`로 워크스페이스 격리 top-k 보장 — 다른 워크스페이스 retrieval 차단.

> **차원 결정**: v04-direction §7 SSOT 인용. OpenAI 기본 1536 → `dimensions=1024` 축소로 저장·성능 최적화 (Phase 1).

## 4.4 Forward-compatibility (Phase 2/3 외래키 nullable)

Phase 1 schema에 외래키 컬럼을 미리 nullable 로 박아두면 Phase 2/3에서 ALTER 부담 감소 (단 신규 테이블 vec/M:N은 Phase 별 DDL 필요).

| Entity | Phase 1 | Phase 2 추가 (nullable, ALTER 없음) | Phase 3 추가 |
|---|---|---|---|
| Workspace | id/name/icon/created_at/level_preference | cookies_partition / session_storage_key | shared_id / export_format |
| Page | id/workspace_id/url/title/content/content_hash/lang/visited_count/created_at/updated_at | (그대로) | translation_job_id |
| Visit | id/page_id/workspace_id/visited_at/dwell_ms | (그대로) | (그대로) |
| Note | id/page_id?/visit_id?/workspace_id/selected_text/body/ai_tags/created_at/created_by | highlight_anchor (DOM 위치 JSON) | (그대로) |
| AiChatHistory | id/workspace_id/page_id?/visit_id?/role/content/retrieved_items/chat_meta/status/created_at | (그대로) | (그대로) |
| Tag | id/workspace_id/name/kind/ai_generated/created_at | (그대로) | (그대로) |
| PageTag·NoteTag | page_id/tag_id/workspace_id/ai_generated/created_at | (그대로) | (그대로) |
| **(Phase 2 신규 테이블)** | — | TranslationJob / Highlight | (그대로) |
| **(Phase 3 신규 테이블)** | — | — | ExportArtifact / SharedWorkspace |

## 4.5 인덱스 정책

| 인덱스 | 대상 | 용도 |
|---|---|---|
| `idx_page_workspace_url` | Page (workspace_id, url) | 재방문 시 page lookup (워크스페이스 격리) |
| `idx_page_workspace_content_hash` | Page (workspace_id, content_hash) | 워크스페이스 scoped dedupe |
| `idx_visit_workspace_time` | Visit (workspace_id, visited_at DESC) | 시간축 검색 base |
| `idx_visit_page` | Visit (page_id) | 페이지별 visit history |
| `idx_note_workspace_time` | Note (workspace_id, created_at DESC) | 워크스페이스 노트 timeline |
| `idx_note_page_visit` | Note (page_id, visit_id) | 검색 결과 클릭 시 노트 복원 |
| `idx_chat_workspace_time` | AiChatHistory (workspace_id, created_at DESC) | 워크스페이스 대화 히스토리 |
| `idx_chat_status` | AiChatHistory (status) WHERE status != 'ok' | 실패/중간 응답 재시도 큐 |
| `idx_tag_workspace_kind` | Tag (workspace_id, kind, name) | UNIQUE 보장 + 자동 태깅 lookup |
| `vec_pages` | Page embedding | sqlite-vec top-k retrieval (workspace_id partition) |
| `vec_notes` | Note embedding | sqlite-vec top-k retrieval (workspace_id partition) |

## 4.6 실패·재시도 시나리오

| 시나리오 | 정책 |
|---|---|
| **임베딩 호출 실패** | Page·Note INSERT 는 성공 (DB TX 외). 임베딩 큐가 실패 항목 재시도 (지수 백오프 5초/30초/5분/30분/포기). 포기 시 KI-NNN 등록 ([§17](./17_known_issues_policy.md)). |
| **AutoTagger 호출 실패** | Note·Page INSERT 는 성공 (DB TX 외). ai_tags = NULL 또는 freeform 결과만 부분 저장. 큐가 재시도. |
| **AI assistant 응답 실패** | AiChatHistory.user INSERT 후 assistant 호출 → 실패 시 AiChatHistory.error INSERT (role='error', status='failed', content=에러 메시지). 사용자가 UI 에서 "재시도" 버튼으로 새 요청. |
| **마이그레이션 실패** | Dry-run + 자동 백업 + revert 절차 ([§19](./19_migration_v03_v04.md) + A3). 실패 시 v0.3 데이터 복원 후 KI-NNN 등록. |
| **Workspace cascade DELETE** | FK ON DELETE CASCADE: Page → Visit → Note·AiChatHistory·PageTag·NoteTag · vec_pages·vec_notes 모두 자동 삭제. 단일 TX. |

## 4.7 데이터 마이그레이션 매핑 (v0.3 → v0.4)

상세는 [`.flowset/specs/v04-data-migration.md`](../../.flowset/specs/v04-data-migration.md) 참조 (b10 §19 작성 시 통합). 요약:

| v0.3 | v0.4 매핑 |
|---|---|
| `glossary.json` GlossaryTerm | Note (`ai_tags=["glossary"]` + domain 있으면 `"domain:{value}"`, 📥 기본 워크스페이스, page_id·visit_id NULL, created_by='migration') |
| `page-results.json` | Page + Visit (workspace_id=📥 기본, content='', content_hash=NULL, 임베딩 큐 등록) |
| `translation-cache.json` | AIResponseCache (kind=translation) |
| `user-setting.json` translationMode / cancelOnTabSwitch | 자동 제거 (폐기 키) |
| `tabs.json` | TabState (workspace_id 메타 추가) |

## 4.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §5 (Entity 그래프 + anchor 키 + forward-compatibility) + §7 (임베딩 모델·차원)
- `.flowset/specs/v04-data-migration.md` §A (마이그레이션 매핑)
- `.flowset/specs/v04-migration-matrix.md` §E (신규 storage 모듈 — IndexedPageStore / VectorIndex / EmbeddingQueue 등)
- sqlite-vec 공식 문서 ([https://alexgarcia.xyz/sqlite-vec/](https://alexgarcia.xyz/sqlite-vec/)) — `vec0` 가상 모듈 + partition_key
- OpenAI Embeddings ([https://platform.openai.com/docs/guides/embeddings](https://platform.openai.com/docs/guides/embeddings)) — `text-embedding-3-small` 기본 1536 + `dimensions` 축소

본 §04 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 4.9 변경 이력

- 2026-05-16 (PR b3): stub → 본문 작성. 7 entity + M:N + vector + anchor + 컬럼 spec + Phase 2/3 forward-compat + 인덱스 + 마이그레이션.
- 2026-05-16 (PR b3.1): codex 24건 + evaluator 2건 핫픽스. 차원 1024 명시 (SSOT direction §7 갱신 동반) / sqlite-vec rowid+metadata+partition_key 정확화 / vec workspace_id partition 추가 / 인덱스 8→11개 (note_workspace_time, note_page_visit, page_workspace_content_hash, chat_status, tag_workspace_kind 추가) / PageTag·NoteTag 컬럼 spec 신규 / retrieved_page_ids → retrieved_items (Page+Note 둘 다 cover) / chat_meta sources 형식 명시 / ai_tags prefix 정책 명시 / Note created_by / AiChatHistory status / Page content 빈값 허용 / 실패·재시도 시나리오 §4.6 신규.
