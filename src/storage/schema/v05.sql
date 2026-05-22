-- FlowBrowser AI v0.5 SQLite Schema
-- Sprint 017 M1 T07 — V4→V5 마이그레이션 진입.
--
-- v04 전체 사본 + 신규 `highlights` 테이블 (PRD §11.2.1 — 노트 선택 영역 anchor 영속).
--
-- 입력: v04.sql (Sprint 015 M3-1 박힘) + Sprint 016 M4 T20 HighlightStore + Sprint 017 M1 T06 IPC handler.
-- 적용: better-sqlite3 12.x + sqlite-vec 0.1.9 (vec0 가상 모듈)
-- 멱등성: 모든 DDL `IF NOT EXISTS` — fresh install / v04 → v05 migration 양쪽 안전.
--
-- 호출 순서 (codex 사전 협의 019e4dd1 BLOCKING 정합):
--   v04 DB 인 경우:
--     1. `FlowbrowserDatabase.open({path})` — schema 미적용
--     2. `migrateV04ToV05({fb, userDataDir, ...})` — 백업 (`fb.getDb().backup(<userDataDir>/backup/v04/<ISO_ts>/flowbrowser.db`)) → applySchema(v05) → schema_meta sentinel 박음
--     3. `fb.ensureDefaultWorkspace()`
--   fresh install:
--     1. `FlowbrowserDatabase.open({path})` — schema 미적용
--     2. `migrateV04ToV05({fb, userDataDir, ...})` — 백업 skip (v04 데이터 없음) → applySchema(v05) → schema_meta sentinel 박음
--     3. `fb.ensureDefaultWorkspace()`
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
-- Highlights (Sprint 017 M1 T07 신규, PRD §11.2.1)
-- 노트 선택 영역 anchor 메타데이터 영속.
--
-- 1:N relation — 한 노트가 여러 highlight 가능 (한 페이지에 다중 선택, 또는 여러 페이지의 highlight 가 한 노트로 묶임).
--
-- FK 정책 (codex 019e4dd1 정합):
--   - note_id CASCADE: 노트 삭제 시 동반 삭제 (highlight 는 노트의 자식)
--   - workspace_id CASCADE: 워크스페이스 삭제 시 동반 삭제 (PRD §04.6 isolation cascade 정합)
--   - page_id SET NULL: 페이지 삭제 시 highlight 살아 있음 (url + content_hash 기반 drift fallback 복원 가능)
--
-- anchor TEXT NOT NULL: HighlightAnchor (rootSelector/startPath/endPath/startOffset/endOffset/selectedText/prefix/suffix/contentHash/contextHash)
--   JSON.stringify 영속. 인덱스 query surface 없으므로 별도 컬럼화 안 함 (codex #5 권고).
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

-- 인덱스 — listByPage / listByNote / listByWorkspace query path 직접 매칭 (codex 019e4dd1 #7 + 019e4e82 NOTABLE #4 보강).
-- HighlightStore 의 query path:
--   listByPage(pageId)       → workspace_id + page_id + ORDER BY created_at ASC
--   listByPage(url+contentHash) → workspace_id + url + content_hash + ORDER BY created_at ASC
--   listByPage(url 단독)     → workspace_id + url + ORDER BY created_at ASC  ← codex NOTABLE #4
--   listByNote               → note_id + ORDER BY created_at ASC              ← codex NOTABLE #4
--   listByWorkspace          → workspace_id + ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_page_time
  ON highlights(workspace_id, page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_url_hash_time
  ON highlights(workspace_id, url, content_hash, created_at);
-- codex 019e4e82 NOTABLE #4 — url 단독 분기 (content_hash unbound) 의 ORDER BY 정합 인덱스.
CREATE INDEX IF NOT EXISTS idx_highlight_workspace_url_time
  ON highlights(workspace_id, url, created_at);
-- codex 019e4e82 NOTABLE #4 — listByNote 의 ORDER BY created_at 정합 인덱스 (단순 (note_id) 만으로는 SQLite 가 추가 sort).
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
-- sqlite-vec virtual tables (PRD §04.3.8)
-- 차원: 1024 (OpenAI text-embedding-3-small dimensions=1024)
-- partition_key: workspace_id (top-k 전 워크스페이스 격리)
-- 주의: 본 DDL 적용 전 sqlite-vec extension 이 로드되어 있어야 함 (Database.ts 가 순서 보장).
-- M3 spike 검증 (.flowset/specs/m3-spike-decisions.md §3.3): partition key 는 space 구분 (underscore 아님).
-- ============================================================
-- distance_metric=cosine 명시 강제 (PRD §9.4 b6.1 정정 — vec0 디폴트는 L2 이며 cosine 변환 불가능).
-- 미명시 시 sqlite-vec 0.1.9 디폴트 L2 로 동작 → SearchService 의 `cosineSim = 1 - distance` 변환에서 score scale 손상.
-- 실측 (`node vec-probe.mjs` 2026-05-19): orthogonal 벡터 distance = 1.4142 (L2) vs 1.0 (cosine) — codex BLOCKING PR #154 정정 박힘.
CREATE VIRTUAL TABLE IF NOT EXISTS vec_pages USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes USING vec0(
  note_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

-- ============================================================
-- vec0 정리 트리거 (PRD §04.6 cascade — vec_pages·vec_notes 동반 삭제)
-- 외래키는 virtual table 미지원 → AFTER DELETE trigger 로 보완.
-- pages / notes 삭제 시 (workspace cascade 포함) 자동 정리.
-- M3-2 (Sprint 015) 진입 시 추가.
-- ============================================================
CREATE TRIGGER IF NOT EXISTS pages_after_delete_vec_pages
  AFTER DELETE ON pages
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_pages WHERE page_id = OLD.id;
  END;

CREATE TRIGGER IF NOT EXISTS notes_after_delete_vec_notes
  AFTER DELETE ON notes
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_notes WHERE note_id = OLD.id;
  END;
