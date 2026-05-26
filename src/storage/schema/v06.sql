-- FlowBrowser AI v0.6 SQLite Schema
-- Sprint 018 M2 T17a — V5→V6 마이그레이션 진입 (로컬 임베딩 통합).
--
-- v05 전체 사본 + 변동 3종 (Schema v06 spec `.flowset/specs/sprint-018-schema-v06-spec.md` §3):
--   1. workspaces.embedding_model — 워크스페이스 별 임베딩 모델 고정 (B3 결정)
--   2. vec_pages → vec_pages_1024 + vec_pages_768 / vec_notes → vec_notes_1024 + vec_notes_768
--      — dimension 별 별도 vec0 테이블 (B2 결정, sqlite-vec 0.1.x dimension 고정 제약 정합)
--   3. 트리거 갱신 — pages/notes DELETE 시 _1024 + _768 둘 다 삭제
--
-- 입력: v05.sql (Sprint 017 M1 T07) + Schema v06 spec (Sprint 018 M1 T04 복원, codex 019e653c 정정).
-- 적용: better-sqlite3 12.x + sqlite-vec 0.1.9 (vec0 가상 모듈). float[768] vec0 신규 가능 PoC 통과 (T17a 진입 게이트).
-- 멱등성: 모든 DDL `IF NOT EXISTS` — fresh install / v05 → v06 migration 양쪽 안전.
--
-- 본 파일은 **canonical v06 선언 스키마** (fresh v06 reference + drift-check 회귀 기준).
-- 실 v05 → v06 transition 은 `migrations/v05_to_v06.ts` 가 명시 DDL(ALTER + copy + drop + trigger swap)로 수행.
-- 두 경로의 schema shape 동등성은 `v05_to_v06.test.ts` 의 drift-check 회귀가 강제 (sqlite_master 정규화 비교).
--
-- 모든 timestamp 컬럼은 INTEGER (epoch-ms, Date.now() 정합).
-- 모든 BOOLEAN 은 INTEGER 0/1 (SQLite native BOOLEAN 없음).
-- 모든 JSON 필드는 TEXT (호출자가 직렬화/파싱).
-- 모든 UUID 는 TEXT (호출자가 crypto.randomUUID() 생성).

-- ============================================================
-- Workspace (PRD §04.3.1)
-- v06: embedding_model 컬럼 추가 (Schema v06 spec §3.1, B3 결정).
--   범위 = 1024/768 고정 (codex 019e653c BLOCKING — DB CHECK ↔ vec0 테이블 ↔ UX 3자 일치).
--   1536/3072 등 후속 모델 추가 시: CHECK 확장 + vec_pages_{dim}/vec_notes_{dim} 테이블 + allowlist mapping 동반 필수.
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  level_preference TEXT CHECK (level_preference IN ('novice', 'intermediate', 'advanced') OR level_preference IS NULL),
  embedding_model TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small:1024'
    CHECK (embedding_model IN (
      'openai:text-embedding-3-small:1024',
      'ollama:nomic-embed-text:768'
    ))
);

-- ============================================================
-- Page (PRD §04.3.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  lang TEXT,
  visited_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_workspace_url ON pages(workspace_id, url);
CREATE INDEX IF NOT EXISTS idx_page_workspace_content_hash ON pages(workspace_id, content_hash);

-- ============================================================
-- Visit (PRD §04.3.3)
-- ============================================================
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL,
  dwell_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_visit_workspace_time ON visits(workspace_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_page ON visits(page_id);

-- ============================================================
-- Note (PRD §04.3.4) — 3중 anchor (page/visit nullable, workspace 필수)
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  visit_id TEXT REFERENCES visits(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL,
  body TEXT,
  ai_tags TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'migration'))
);

CREATE INDEX IF NOT EXISTS idx_note_workspace_time ON notes(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_page_visit ON notes(page_id, visit_id);

-- ============================================================
-- AiChatHistory ("AI 메모", PRD §04.3.5)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chat_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  visit_id TEXT REFERENCES visits(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
  content TEXT NOT NULL,
  retrieved_items TEXT,
  chat_meta TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'pending', 'failed', 'aborted')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_workspace_time ON ai_chat_history(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_status ON ai_chat_history(status) WHERE status != 'ok';

-- ============================================================
-- Tag (PRD §04.3.6) — 6종 kind (topic/entity/metric/sentiment/domain/freeform)
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('topic', 'entity', 'metric', 'sentiment', 'domain', 'freeform')),
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, kind, name)
);

CREATE INDEX IF NOT EXISTS idx_tag_workspace_kind ON tags(workspace_id, kind, name);

-- ============================================================
-- PageTag / NoteTag M:N (PRD §04.3.7)
-- ============================================================
CREATE TABLE IF NOT EXISTS page_tags (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id)
);

-- ============================================================
-- EmbeddingQueue (M3-4) — 백그라운드 임베딩 작업 큐
-- PRD §15 / 백그라운드 큐 (활성 탭 우선, 동일 priority FIFO).
-- ============================================================
CREATE TABLE IF NOT EXISTS embedding_queue (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('page', 'note')),
  target_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_queue_status_priority
  ON embedding_queue(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_target
  ON embedding_queue(target_type, target_id);

-- ============================================================
-- Highlights (Sprint 017 M1 T07, PRD §11.2.1)
-- 노트 선택 영역 anchor 메타데이터 영속. v05 와 동일 (v06 무변동).
-- ============================================================
CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  anchor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_highlight_workspace_page_time
  ON highlights(workspace_id, page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_url_hash_time
  ON highlights(workspace_id, url, content_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_url_time
  ON highlights(workspace_id, url, created_at);
CREATE INDEX IF NOT EXISTS idx_highlight_note_time
  ON highlights(note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_time
  ON highlights(workspace_id, created_at);

-- ============================================================
-- Schema 메타 (마이그레이션 추적)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============================================================
-- sqlite-vec virtual tables (PRD §04.3.8) — v06: dimension 별 분리 (Schema v06 spec §3.2)
-- 1024 = OpenAI text-embedding-3-small (dimensions=1024)
-- 768  = Ollama nomic-embed-text
-- partition_key: workspace_id (top-k 전 워크스페이스 격리)
-- distance_metric=cosine 명시 강제 (PRD §9.4 b6.1 — vec0 디폴트 L2 회피).
-- 주의: 본 DDL 적용 전 sqlite-vec extension 이 로드되어 있어야 함 (Database.ts 가 순서 보장).
--
-- 같은 워크스페이스는 한 dimension 만 사용 (workspaces.embedding_model 로 결정).
-- DB-level 강제는 불가 (codex 019e50ec NOTABLE #3) — invariant 는 write path / import / reindex 책임.
-- vec0 dimension 은 테이블 단위로 native 강제 (T17a PoC 실측 — 차원 mismatch insert 거부).
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages_1024 USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages_768 USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[768] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes_1024 USING vec0(
  note_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes_768 USING vec0(
  note_id TEXT,
  workspace_id TEXT partition key,
  embedding float[768] distance_metric=cosine
);

-- ============================================================
-- vec0 정리 트리거 (PRD §04.6 cascade) — v06: _1024 + _768 둘 다 삭제 (Schema v06 spec §3.3)
-- 외래키는 virtual table 미지원 → AFTER DELETE trigger 로 보완.
-- pages / notes 삭제 시 (workspace cascade 포함) 두 dimension 테이블 모두 자동 정리.
-- ============================================================
CREATE TRIGGER IF NOT EXISTS pages_after_delete_vec_pages_v06
  AFTER DELETE ON pages
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_pages_1024 WHERE page_id = OLD.id;
    DELETE FROM vec_pages_768 WHERE page_id = OLD.id;
  END;

CREATE TRIGGER IF NOT EXISTS notes_after_delete_vec_notes_v06
  AFTER DELETE ON notes
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_notes_1024 WHERE note_id = OLD.id;
    DELETE FROM vec_notes_768 WHERE note_id = OLD.id;
  END;
