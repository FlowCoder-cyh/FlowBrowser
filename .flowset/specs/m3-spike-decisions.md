# M3 Spike — sqlite-vec + better-sqlite3 PoC 결과 (Windows)

> **Sprint 015 M3-2 30분 PoC 결과 박힘.**
> 입력: contract `S015` §7 리스크 #1 / 핸드오프 2026-05-18 §3.3 / PRD §15 (검색·임베딩) / PRD §04.3.8 (vec0 schema)
> 출력: M3-1 (SQLite schema + DB 진입점) / M3-2 (VectorIndex 본 PR) 의존 결정 박힘

## 메타

- **작성일**: 2026-05-18
- **PoC 실행 환경**: Windows 11 Pro / Node 24.12.0 / Electron 39.8.10 (Node 22.22.1 / V8 142)
- **PoC 작업 위치**: `spike/m3-poc/` (gitignored, P-002 정합)
- **PoC 스크립트**:
  - `spike/m3-poc/test-poc.mjs` — Node 24 단독 검증 (8 케이스)
  - `spike/m3-poc/electron-main.cjs` — Electron 39 환경 검증 (6 케이스)
- **macOS 검증**: 본 세션 환경 한정 → **미검증** (Sprint 016 또는 macOS CI 추가 시 재시도, KI 등록 후보)

## 1. 결과 요약

| 항목 | 결과 |
|---|---|
| **Windows 검증** | ✅ Node 24 단독 8/8 + Electron 39 환경 6/6 모두 PASS |
| **macOS 검증** | ❌ 본 세션 환경 부재 (Sprint 016 또는 CI 추가 시 재검증) |
| **sqlite-vec 빌드** | ✅ npm `sqlite-vec@0.1.9` + 플랫폼별 optional dep (`sqlite-vec-windows-x64@0.1.9`) → `vec0.dll` 자동 설치 |
| **better-sqlite3 빌드** | ✅ `better-sqlite3@12.10.0` + `@electron/rebuild@4.0.4` → Electron 39 ABI 정합 |
| **`vec0` virtual table** | ✅ `float[1024]` + `workspace_id TEXT partition key` 정합 |
| **top-k retrieval** | ✅ `embedding MATCH ? AND k = N` + `WHERE workspace_id = ?` → 워크스페이스 격리 (PRD §04 정합) |
| **결정** | **sqlite-vec 채택** (in-memory fallback 불요) |

## 2. 검증 매트릭스 (Electron 39 환경)

```
=== Electron 39 sqlite-vec PoC ===
Electron: 39.8.10 / Node: 22.22.1 / Chromium: 142.0.7444.265
better-sqlite3 path: <PoC>/node_modules/better-sqlite3/lib/index.js
✅ open in-memory DB — sqlite 3.53.1
✅ loadExtension(sqlite-vec) — vec_version v0.1.9
✅ create vec_pages virtual table (float[1024] + workspace_id partition) — created
✅ insert 5 embeddings (2 workspaces) — 5 rows
✅ top-k retrieval (workspace partition isolation) — 3 rows → p2(0.227), p3(0.910), p1(21.278)
✅ close DB — closed
=== Result: 6 passed / 0 failed ===
```

5 페이지 임베딩 (`ws-A` 3건 + `ws-B` 2건) 삽입 후 `ws-A` partition 에서 query top-3 조회 → 결과 3건 모두 `workspace_id = 'ws-A'` (격리 강제, `ws-B` 누설 X). distance 단조 증가 (p2 0.227 → p3 0.910 → p1 21.278) → cosine MATCH 정확.

## 3. 핵심 결정 박힘 (M3-1 / M3-2 PR 입력)

### 3.1 의존 버전 (M3-1 package.json 진입 시 고정)

| package | version | 비고 |
|---|---|---|
| `better-sqlite3` | **`^12.10.0`** | **11.x 사용 금지** — Electron 39 V8 (Chromium 142) 에서 `v8::Context::GetIsolate` 제거됨 → `better-sqlite3@11.10` 컴파일 실패 (`error C2039: 'GetIsolate'`). 12.x 가 새 V8 API 정합. |
| `sqlite-vec` | **`^0.1.9`** | optional dep (`sqlite-vec-{darwin\|linux\|windows}-{x64\|arm64}`) 5종 자동 설치 — `windows-x64` 검증 완료 |
| `@electron/rebuild` | **`^4.0.4`** | devDependencies. `npm run rebuild` 또는 postinstall hook 으로 실행 |
| `electron` | `^39.0.0` | 현재 설치 39.8.10 정합 |

### 3.2 rebuild 흐름

```
# 1. 일반 install (prebuild-install 시도, Electron ABI 매치 안 됨)
npm install

# 2. Electron 39 ABI 로 강제 rebuild (better-sqlite3 만 대상)
npx electron-rebuild -f -w better-sqlite3 -v <ELECTRON_VERSION>
```

**M3-1 적용 권고**:
- `package.json` `scripts` 에 `"rebuild": "electron-rebuild -f -w better-sqlite3"` 추가
- `postinstall` hook 추가 (CI / 사용자 install 시 자동 rebuild)
- `.gitignore` 에 native module rebuild 산출물 추가 검증 (`out/` 등은 이미 등록)
- CI workflow (`.github/workflows/*.yml`) 빌드 단계 앞에 `electron-rebuild` 호출 추가 — Windows runner 동작 검증 필수

### 3.3 schema 정합 (PRD §04.3.8 → 실제 동작 정합 확인)

PRD §04.3.8 spec 과 실제 sqlite-vec 0.1.9 문법 비교:

```sql
-- PRD §04.3.8 spec
CREATE VIRTUAL TABLE vec_pages USING vec0(
  rowid INTEGER PRIMARY KEY,
  page_id TEXT,
  workspace_id TEXT partition_key,
  embedding float[1024]
);
```

**실제 검증된 문법** (PoC 통과):
```sql
CREATE VIRTUAL TABLE vec_pages USING vec0(
  page_id TEXT,
  workspace_id TEXT partition key,
  embedding float[1024]
)
```

차이점:
- `partition_key` ❌ → **`partition key`** ✅ (space 구분, underscore 아님)
- `rowid INTEGER PRIMARY KEY` 명시는 불필요 — vec0 가 자동 부여 (auto `rowid`)

→ **PRD §04.3.8 정정 권고**: `partition_key` → `partition key` (PR b3.2 후속 정정 대상, M3-1 PR 동반 핫픽스)

### 3.4 INSERT/SELECT 인터페이스 (M3-2 VectorIndex 구현)

```javascript
// INSERT
const buf = Buffer.from(new Float32Array(1024).buffer)
db.prepare('INSERT INTO vec_pages(page_id, workspace_id, embedding) VALUES (?, ?, ?)').run(pageId, wsId, buf)

// top-k retrieval (workspace 격리)
db.prepare(`
  SELECT page_id, distance
  FROM vec_pages
  WHERE workspace_id = ?
    AND embedding MATCH ?
    AND k = ?
  ORDER BY distance
`).all(wsId, queryBuf, k)
```

- 임베딩: `Float32Array(1024)` → `Buffer.from(arr.buffer)` 전달
- distance: cosine distance (vec_version v0.1.9 기본). PRD §15 `score = 0.85 × cosine_sim + 0.15 × exp(-days_ago/180)` 에서 `cosine_sim = 1 - distance / 2` 또는 정규화 임베딩 가정 시 `cosine_sim = 1 - distance` (M3-5 EmbeddingClient 에서 정규화 강제 권고)

### 3.5 fallback 미발동

PoC 통과로 **in-memory cosine fallback 불요**. PRD §15 (검색·임베딩) 의 sqlite-vec 채택 결정 박힘. M3-2 PR 은 sqlite-vec 단일 경로 + VectorIndex wrapper 만 구현.

단 **macOS 미검증** 으로 리스크 잔존:
- Sprint 016 또는 macOS CI 추가 시 동일 PoC 재실행
- 실패 시 KI-NNN (HIGH severity) 등록 후 Sprint 016 M1 즉시 fallback 추가
- 본 PoC 결과 박힘 (Windows ✅) 으로 Phase 1 진입은 가능 — macOS 차단 사유는 X

## 4. 리스크 / 잔여

### 4.1 KI 후보 (M3-2 PR 시점 등록 가능)

- **MEDIUM** — sqlite-vec macOS native 빌드 미검증. 처리 예정: Sprint 016 macOS CI 추가 시 재검증. 발견 출처: 본 PoC.

### 4.2 better-sqlite3 11.x 사용 금지 강제

M3-1 PR 진입 시 `better-sqlite3@^12.10.0` 강제. 11.x 는 Electron 39 컴파일 차단:
```
error C2039: 'GetIsolate': 'v8::Context'의 멤버가 아닙니다.
```
원인: Chromium 142 / V8 13.6 에서 `v8::Context::GetIsolate` 메서드 제거 (대체: `v8::Isolate::GetCurrent()`).

### 4.3 native rebuild CI 부담

Windows runner 에서 MSBuild + node-gyp + Python 의존. 현재 `ubuntu-latest` 가 CI 디폴트인 경우 Windows runner 추가 필요. M3-1 PR 시점에 CI workflow 검토.

## 5. 다음 (M3-1 PR 즉시 진입 가능)

| # | 작업 |
|---|---|
| 1 | `package.json` 신규 의존 추가 — `better-sqlite3@^12.10.0` / `sqlite-vec@^0.1.9` / `@electron/rebuild@^4.0.4` (devDep) |
| 2 | `npm run rebuild` script + `postinstall` hook 추가 |
| 3 | `src/storage/schema/v04.sql` 작성 — PRD §04.3 모든 entity (Workspace / Page / Visit / Note / AiChatHistory / Tag / PageTag / NoteTag / vec_pages / vec_notes) + §04.5 인덱스 11종 |
| 4 | `src/storage/Database.ts` 신규 — better-sqlite3 + sqlite-vec.load + schema migration 진입점 + 워크스페이스 디폴트 생성 |
| 5 | 단위 테스트 — DB 진입 / schema 정합 / vec_pages CRUD (workspace 격리 검증) |
| 6 | PRD §04.3.8 `partition_key` → `partition key` 정정 (본 PR 내 핫픽스) |
| 7 | CI workflow Windows runner + electron-rebuild 단계 추가 (별도 PR 분리 검토) |

## 6. 변경 이력

- **2026-05-18**: M3-2 sqlite-vec native build 30분 PoC 결과 박힘. Windows ✅ / macOS ❌ (미검증). better-sqlite3 12.x 강제 / 11.x 차단. sqlite-vec 0.1.9 채택. in-memory fallback 불요. PRD §04.3.8 `partition_key` → `partition key` 정정 권고.
