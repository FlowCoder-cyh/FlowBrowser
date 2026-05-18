-- FlowBrowser AI v0.4 SQLite Schema
-- Sprint 015 M3-1 — 통합 SQLite 진입점 schema
--
-- 입력: PRD §04.3 (Entity 컬럼 spec) + §04.5 (인덱스) + §04.6 (실패 정책) + A3 (마이그레이션)
-- 적용: better-sqlite3 12.x + sqlite-vec 0.1.9 (vec0 가상 모듈)
--
-- 호출 순서:
--   1. db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
--   2. sqliteVec.load(db)          -- vec0 모듈 등록
--   3. db.exec(<이 파일>)           -- 모든 DDL idempotent (IF NOT EXISTS)
--   4. db.exec(<schema_version 갱신>)  -- Database.ts 내부 처리
--
-- 모든 timestamp 컬럼은 INTEGER (epoch-ms, Date.now() 정합).
-- 모든 BOOLEAN 은 INTEGER 0/1 (SQLite native BOOLEAN 없음).
-- 모든 JSON 필드는 TEXT (호출자가 직렬화/파싱).
-- 모든 UUID 는 TEXT (호출자가 crypto.randomUUID() 생성).

-- ============================================================
-- Workspace (PRD §04.3.1)
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  level_preference TEXT CHECK (level_preference IN ('novice', 'intermediate', 'advanced') OR level_preference IS NULL)
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
-- Schema 메타 (마이그레이션 추적)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============================================================
-- sqlite-vec virtual tables (PRD §04.3.8)
-- 차원: 1024 (OpenAI text-embedding-3-small dimensions=1024)
-- partition_key: workspace_id (top-k 전 워크스페이스 격리)
-- 주의: 본 DDL 적용 전 sqlite-vec extension 이 로드되어 있어야 함 (Database.ts 가 순서 보장).
-- M3 spike 검증 (.flowset/specs/m3-spike-decisions.md §3.3): partition key 는 space 구분 (underscore 아님).
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024]
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes USING vec0(
  note_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024]
);
