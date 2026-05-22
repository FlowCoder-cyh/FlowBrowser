# Sprint 017 M5 — Schema v06 spec (T17 진입 조건)

> 작성: 2026-05-24 (Sprint 017 M5, G-021 정식화 후속).
> 권고 출처: codex 019e500b Q4/Q5 (T14 시점) + codex 019e5067 + codex 019e50c2 권고 G.
> 본 spec 은 **결정 + sketch**. 실 구현 PR (`migrate_v05_to_v06.ts` + `v06.sql` + Workspace.embedding_model wiring + IndexingService 분기 + OllamaProvider.embed() 재구현) 은 Sprint 018+ 위임 (T17 본 PR scope).

## 1. 목표

Sprint 017 T14 (Ollama provider spike) 시점 발견 BLOCKER 해소:
- Ollama 디폴트 임베딩 모델 `nomic-embed-text` (768 dim) 가 `vec_pages.embedding float[1024]` 와 dimension mismatch
- 차원이 같아도 OpenAI text-embedding-3-small 과 다른 semantic space — mixed 검색 품질 저하

본 spec 으로 **T17 (로컬 임베딩 통합) 진입 조건** 확정. Sprint 018+ 에서 본 spec 기준 구현.

## 2. 결정 (codex 019e500b Q4/Q5 + 019e50c2 G 권고 정합)

**B3 + B2 조합 채택**:
- **B3**: `workspaces.embedding_model TEXT NOT NULL` 추가 — 워크스페이스 별 임베딩 모델 고정
- **B2**: dimension 별 별도 vec0 table — `vec_pages_1024` (OpenAI) + `vec_pages_768` (Ollama nomic-embed-text). 같은 워크스페이스는 한 dimension 만 사용 (workspace 생성 시 결정).

근거:
- 격리 강력 — 다른 dimension 의 query embedding 이 vec0 table 안 박힐 가능 0 (단, **DB-level 강제는 불가** — codex 019e50ec NOTABLE #3: 본 invariant 는 write paths / import / reindex / 회귀 셋 책임. spec L? 의 "DB-level 차단" 표현은 부정확 — write path enforcement boundary 명시 필수)
- 마이그레이션 단순 — 기존 워크스페이스 모두 `embedding_model='openai:text-embedding-3-small:1024'` 디폴트
- 사용자 mid-stream 전환 시 — 새 워크스페이스 생성 + 기존 데이터 재import 필요 명시 (UX 부담은 있으나 데이터 무결성 보장)
- sqlite-vec 0.1.x 의 vec0 dimension 고정 제약 정합

**B1 거부 근거** (codex 019e50ec NEEDS_CHANGES #5):
- B1 (`embedding_space_id` 컬럼만 추가 + 단일 vec0 table 유지) 은 의미 space 분리는 가능하나 **dimension mismatch 자체 해소 불가** — `float[1024]` 컬럼에 768-dim 벡터 박을 수 없음. sqlite-vec vec0 의 dimension 고정 제약 정합 위배. B2 (별도 vec0 table) 가 dimension 분리 + B3 (workspaces.embedding_model) 가 의미 space 분리 — 두 축 모두 cover.

## 3. Schema 변동 매트릭스

### 3.1 workspaces 테이블 확장

```sql
-- v05 (현재)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  level_preference TEXT CHECK (...)
);

-- v06 (제안)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  level_preference TEXT CHECK (...),
  embedding_model TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small:1024'
    CHECK (embedding_model IN (
      'openai:text-embedding-3-small:1024',
      'openai:text-embedding-3-small:1536',
      'openai:text-embedding-3-large:3072',
      'ollama:nomic-embed-text:768'
      -- 후속 모델 추가 시 CHECK 확장 + 별도 vec_pages_{dim} 테이블 동반
    ))
);
```

### 3.2 dimension 별 vec0 table 분리

```sql
-- v05 (현재)
CREATE VIRTUAL TABLE vec_pages USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

-- v06 (제안) — rename + 신규
CREATE VIRTUAL TABLE vec_pages_1024 USING vec0(  -- 기존 vec_pages 데이터 마이그레이션
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024] distance_metric=cosine
);

CREATE VIRTUAL TABLE vec_pages_768 USING vec0(  -- 신규 (Ollama nomic-embed-text)
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[768] distance_metric=cosine
);

-- vec_notes 도 동일 (vec_notes_1024 / vec_notes_768)
```

### 3.3 트리거 갱신 (pages + notes 둘 다, codex 019e50ec NEEDS_CHANGES #2 정합)

```sql
-- v05: pages DELETE → vec_pages DELETE / notes DELETE → vec_notes DELETE
-- v06: pages DELETE → vec_pages_1024 + vec_pages_768 DELETE (둘 다)
CREATE TRIGGER pages_after_delete_vec_pages_v06
  AFTER DELETE ON pages
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_pages_1024 WHERE page_id = OLD.id;
    DELETE FROM vec_pages_768 WHERE page_id = OLD.id;
  END;

CREATE TRIGGER notes_after_delete_vec_notes_v06
  AFTER DELETE ON notes
  FOR EACH ROW
  BEGIN
    DELETE FROM vec_notes_1024 WHERE note_id = OLD.id;
    DELETE FROM vec_notes_768 WHERE note_id = OLD.id;
  END;
```

## 4. 마이그레이션 (G-014 dry-run + 자동 백업 강제)

`src/storage/migrations/v05_to_v06.ts` (구현 PR, 본 spec 외):

```ts
export async function migrateV05ToV06(fb: FlowbrowserDatabase, opts: { dryRun: boolean }): Promise<MigrationResult> {
  // 1. sentinel check — schema_meta.migration_v06_applied 박혀 있으면 skip
  // 2. 자동 백업 — <userDataDir>/backup/v05/<ISO_ts>/flowbrowser.db copy
  //    (codex 019e50ec NEEDS_CHANGES #3 정합 — v04→v05 패턴 V05_BACKUP_FILE='flowbrowser.db' 통일)
  // 3. dry-run 분기 — actual write 박지 않고 검증만
  // 4. workspaces ALTER (embedding_model 컬럼 추가, DEFAULT 'openai:text-embedding-3-small:1024')
  // 5. vec_pages → vec_pages_1024 rename (가능 시) 또는 vec_pages_1024 신규 + 데이터 copy + vec_pages drop
  // 6. vec_pages_768 / vec_notes_768 신규 (빈 테이블)
  // 7. 트리거 갱신 (DROP + CREATE)
  // 8. sentinel 박음 (migration_v06_applied=1)
  // 9. 실패 시 rollback (백업 path 사용자 안내)
}
```

**G-014 정합**:
- dry-run 분기 — 사용자에게 마이그레이션 결과 미리 안내
- 자동 백업 강제 — `<userDataDir>/backup/v05/<ISO_ts>/` (v04→v05 와 동일 path)
- 실패 시 사용자 알림 + 백업 path 안내

## 5. 코드 wiring 변동

### 5.1 IndexingService

```ts
// v05 (현재)
class IndexingService {
  async recordVisit(...) {
    // ...
    await this.vectorIndex.upsert({ pageId, workspaceId, vector })  // vec_pages 단일
  }
}

// v06 (제안) — codex 019e50ec NEEDS_CHANGES #4 정합: closed allowlist mapping 강제
const VEC_PAGES_TABLES: Record<number, 'vec_pages_1024' | 'vec_pages_768'> = {
  1024: 'vec_pages_1024',
  768: 'vec_pages_768'
}
const VEC_NOTES_TABLES: Record<number, 'vec_notes_1024' | 'vec_notes_768'> = {
  1024: 'vec_notes_1024',
  768: 'vec_notes_768'
}

function selectVecPagesTable(dim: number): 'vec_pages_1024' | 'vec_pages_768' {
  const table = VEC_PAGES_TABLES[dim]
  if (!table) throw new Error(`Unsupported embedding dimension: ${dim}`)
  return table
}

class IndexingService {
  async recordVisit(...) {
    const ws = this.workspaceStore.findById(workspaceId)
    const [provider, model, dimStr] = ws.embedding_model.split(':')
    const dim = parseInt(dimStr, 10)
    const vectorTable = selectVecPagesTable(dim)  // allowlist mapping (SQL identifier injection 차단)
    // 본 vector 의 length 가 dim 과 일치하는지 추가 검증 — VectorIndex.ts 의 EMBEDDING_DIMENSIONS=1024 hardcode 정정 동반
    if (vector.length !== dim) {
      throw new Error(`embedding vector dim mismatch: expected ${dim}, got ${vector.length}`)
    }
    await this.vectorIndex.upsertTo(vectorTable, { pageId, workspaceId, vector })
  }
}
```

**SQL identifier injection 차단**: vec0 table 이름은 prepared statement bind 불가 (table name 은 identifier, bind 는 value 만 가능). dynamic table 사용 시 반드시 **closed allowlist mapping** (위 `VEC_PAGES_TABLES`) 강제 — `vec_pages_${userInput}` 직접 보간 절대 금지.

**VectorIndex.ts hardcode 정정**: 현재 `src/storage/VectorIndex.ts:32` 의 `EMBEDDING_DIMENSIONS=1024` 상수 → workspace 별 dim 결정 + per-call validation 으로 교체.

### 5.2 SearchService

```ts
// 워크스페이스 별 embedding_model 따라 query embedding + 매칭 vec0 table 선택
class SearchService {
  async search(query: string, workspaceId: string) {
    const ws = this.workspaceStore.findById(workspaceId)
    const [provider, model, dim] = ws.embedding_model.split(':')
    const queryVector = await this.embeddingClient.embed(query, { provider, model })
    const vectorTable = `vec_pages_${dim}`
    return this.vectorIndex.queryFrom(vectorTable, queryVector, ...)
  }
}
```

### 5.3 OllamaProvider.embed() 재활성화

T14 시점 `ProviderError('unsupported')` throw 박음 → v06 후 활성화:

```ts
class OllamaProvider implements ProviderAdapter {
  readonly info = {
    // ...
    supportsEmbed: true,  // v06 후 활성
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    // POST /api/embed { model: 'nomic-embed-text', input: texts[] }
    // 응답 embeddings[][] → 768-dim 벡터 반환
  }
}
```

## 6. UX

### 6.1 워크스페이스 생성 시

새 UI 추가:
- "임베딩 모델" 드롭다운 (디폴트: OpenAI 1024)
- 옵션: OpenAI 3-small (1024) / OpenAI 3-small (1536) / OpenAI 3-large (3072) / Ollama nomic-embed-text (768)
- 사용자 선택 → `workspaces.embedding_model` 박음

### 6.2 기존 워크스페이스

- 마이그레이션 시 자동 `'openai:text-embedding-3-small:1024'` 박힘
- 사용자가 다른 모델로 전환 원하면 — **새 워크스페이스 생성 + Export/Import 후 재 인덱싱** 명시 (UX 안내 toast)
- 같은 워크스페이스 안에서 mid-stream 모델 변경 = 미지원 (데이터 무결성 보장)

## 7. 회귀 매트릭스 (구현 PR scope)

- migration v05_to_v06.ts 8 케이스 (fresh / v05 데이터 보존 / dry-run / idempotent / 백업 path / sentinel)
- workspaces.embedding_model CHECK constraint 위반 시 throw
- IndexingService 분기 — OpenAI 워크스페이스 + Ollama 워크스페이스 격리
- SearchService 분기 — query vector dimension 일치
- 트리거 갱신 — pages DELETE 시 두 vec table 모두 삭제

## 8. 진입 조건 (T17 본격 구현 PR)

본 spec 박힌 후 T17 구현 PR 진입:
1. G-014 dry-run + 자동 백업 path 정합 (Sprint 017 M1 T07 v04→v05 마이그레이션 패턴 정합)
2. sqlite-vec 0.1.x dimension 고정 제약 — vec_pages_768 / vec_notes_768 신규 가능 검증 **T17a 진입 전 PoC 필수** (codex 019e50ec NEEDS_CHANGES #1 정합 — 본 spec PR 안에는 PoC 산출물 없음, T17a 진입 전 별도 PoC 박힘 후 진입)
3. OllamaProvider.embed() 재구현 (`/api/embed` 호출 + 768-dim 매핑)
4. 사용자 UX — 워크스페이스 생성 모달에 모델 선택 드롭다운
5. 마이그레이션 회귀 — v05 데이터 보존 + dry-run / idempotent 검증

## 9. 후속 작업 (Sprint 018+)

| T | 산출물 | 진입 조건 |
|---|---|---|
| T17a | `v06.sql` + `migrate_v05_to_v06.ts` + 단위 회귀 | 본 spec 박힘 |
| T17b | IndexingService 분기 + SearchService 분기 + 단위 회귀 | T17a 머지 |
| T17c | OllamaProvider.embed() 재구현 + supportsEmbed=true | T17a 머지 |
| T17d | UX — 워크스페이스 생성 모달 모델 선택 | T17a 머지 |
| T17e | E2E — OpenAI 워크스페이스 + Ollama 워크스페이스 격리 검증 | T17a~d 모두 머지 |

## 10. 참조

- codex 019e500b (T14 Ollama provider 사전 협의 Q4/Q5)
- codex 019e5067 (T18 Markdown Export 사전 협의 — vec_pages 1024 dim 고정 정합)
- codex 019e50c2 (Sprint 017 M5 다음 진입점 협의 — G 옵션 권고)
- Sprint 017 M3 spec: `.flowset/specs/sprint-017-local-llm-spike.md` §3.3 (BLOCKER + 옵션 B1/B2/B3)
- Sprint 017 M1 T07 v04→v05 마이그레이션 패턴: `src/storage/migrations/v04_to_v05.ts`
- G-014 데이터 마이그레이션 dry-run + 자동 백업 정책
- PRD: §08 (Embedding) + §15 (정량 임계)

## 11. 변경 이력

- 2026-05-24: Sprint 017 M5 G-021 머지 후 G 옵션 진입. codex 019e50c2 권고 G + T14 시점 발견 BLOCKER 해소 spec. 본 spec = 결정 + sketch 만, 실 구현 Sprint 018+ 위임.
