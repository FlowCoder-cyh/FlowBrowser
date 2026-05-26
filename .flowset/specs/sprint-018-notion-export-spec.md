# Sprint 018 T19 — Notion Export 설계 spec (옵션 C: spec only)

> **상태**: 설계 spec (구현 X). Sprint 018 M1 T03 산출물.
> **결정**: 사용자 옵션 C 선택 (2026-05-26) — spec 만 작성, 구현은 **Sprint 020** (PRD §16 로드맵: `ExportArtifactBuilder` Sprint 020 배치).
> **사전 협의**: codex `019e63c5-e15a-77b0-8d8f-f2e2de1336a3` (read-only, 설계 권고) + evaluator/codex dual review.
> **G-013 단계별**: 본 spec(설계) → Sprint 020 구현 PR 분리.

## 1. Purpose / Non-goals

### Purpose
한 워크스페이스의 데이터(Workspace + Page + Visit + Note + AiChatHistory + Tag + Highlight)를 사용자의 Notion 워크스페이스로 export 하는 `ExportArtifactBuilder` 의 Notion 경로 설계. PRD §11(178행) "Notion Export (Phase 3): 워크스페이스 → Notion DB / Markdown 페이지 변환" + §16(101행) `ExportArtifactBuilder` 정합.

### Non-goals (본 spec 범위 밖)
- 실제 구현 (Sprint 020).
- Markdown/JSON export — 이미 구현됨 (`MarkdownExportService.ts` / `WorkspaceExportImportService.ts`). 본 spec 은 그 위에 Notion 경로를 얹는다.
- Notion → FlowBrowser import 의 full 구현 (§11 import-from-Notion 은 전략만, P1).
- 임베딩(vec_pages/vec_notes) export — derived data, 기존 JSON export 도 제외 (KI-022 후보).

## 2. 제약 (가드레일)

| 가드레일 | 적용 |
|---|---|
| **G-003** 인증 금지선 | Notion 은 **사용자 발급 공식 integration/PAT bearer 토큰**만 사용 (정당). 비공식 토큰/쿠키/세션 우회 금지. |
| **G-004** Privacy Filter P0 | 외부 전송 경로 → `ExportPrivacyGate` preflight 필수 (§13). canonical JSON 첨부도 전송이므로 게이트 대상. |
| **G-005** OS Keychain 위임 | Notion 토큰은 main process Credential/Keychain 계층에만 (safeStorage). renderer/로그/IPC payload 노출 금지. |
| **G-013** 단계별 PR | 본 spec → Sprint 020 구현. |

### 기존 코드 baseline (재사용)
- `src/main/WorkspaceExportImportService.ts` — **canonical 페이로드 `WorkspaceExportV1`** (version 1 / schemaVersion `v05`), `exportWorkspace(workspaceId)`. round-trip import 검증 완료 (단위 회귀 존재).
- `src/main/MarkdownExportService.ts` — 이미 **presentation projection + `workspace.json` canonical 첨부** 패턴 구현 (round-trip 보장, KI-008 정합). Notion 경로도 동일 패턴.

## 3. Round-trip Contract

PRD §16(123행) MVP 종료 기준: "Export — Notion / Markdown / JSON 3종 모두 round-trip 가능".

**핵심 결정 (codex 019e63c5 P0)**: Notion 블록 모델은 lossy (HTML/마크업/`chat_meta`/anchor → Notion block 무손실 복원 불가). 따라서:
- **JSON (`WorkspaceExportV1`) = canonical round-trip 포맷** (이미 import 구현됨).
- **Notion = presentation projection + canonical JSON 첨부** (Markdown export 와 동일 전략).
- round-trip 동치는 **byte-identical 아님 → canonical semantic equality**. 실행 시점 필드(`exportedAt`, Notion page id, export run id)는 비교 제외 / 별도 envelope.
- **Privacy 적용 후 동치**: Privacy Filter 가 일부 entity 제외 시 round-trip 기준 = "filtered artifact 기준 동일". hard-block 포함 전체 round-trip 허용은 G-004 위반.

## 4. Canonical Payload

- 타입: `WorkspaceExportV1` (`WorkspaceExportImportService.ts:128`). `version: 1`, `schemaVersion: 'v05'` (v04 graceful BC).
- 무결성: export envelope 에 `payload_sha256 = sha256(canonical(WorkspaceExportV1))` 박음. canonical = key 정렬 + 실행시점 필드 제외 직렬화.
- Notion 첨부: `flowbrowser-workspace-v05.json` (또는 `.json.gz`) 을 workspace row 에 file attachment.

## 5. Notion Object Model

> **Notion API 모델 변경 (2025-09-03+)**: `database` = 컨테이너, `data source` = rows/properties 가진 table. database 가 1+ data source 를 담고, data source 의 children 이 page. spec 용어는 `database/data source` 병기. (https://developers.notion.com/reference/database, https://developers.notion.com/reference/data-source)

```
사용자 지정 target parent page
└─ "FlowBrowser Workspaces" database / data source
   └─ workspace row/page (Flow External ID = workspace:{uuid})
      ├─ canonical JSON file attachment (flowbrowser-workspace-v05.json)
      ├─ "Pages" data source
      ├─ "Notes" data source
      ├─ "AI Chat" data source
      ├─ "Highlights" data source (Phase 2+)
      └─ (P1) "Visits" / "Tags" data source
```

## 6. Entity → Notion 매핑

| FlowBrowser | Notion | 비고 |
|---|---|---|
| Workspace | `FlowBrowser Workspaces` data source row/page | canonical JSON 첨부 위치 |
| Page | `Pages` data source row | 본문 = row page blocks (content) |
| Note | `Notes` data source row | `Page` relation + `page_external_id` fallback. selected_text/body |
| AiChatHistory | `AI Chat` data source row | 메시지 1개 = row 1개. `chat_meta` 표는 JSON 첨부 canonical, Notion 엔 best-effort table block |
| Tag | **P0**: Page/Note `multi_select` 에 `kind:name` 인코딩 / **P1**: normalized `Tags` data source | |
| Visit | **P0**: canonical JSON only + Page summary 속성 / **P1**: `Visits` data source | |
| Highlight | Phase 2+ `Highlights` data source row | anchor 는 canonical JSON only (DOM Range 복원 Notion 불가) |

## 7. Managed Metadata Properties

Notion 엔 진짜 hidden property 없음 → `FlowBrowser/*` 관리 속성으로 **명시** (codex 권고).

| 속성 | 타입 | 용도 |
|---|---|---|
| `Flow External ID` | rich_text / title | `{entity}:{flowbrowser_uuid}` — upsert dedup 키 |
| `Flow Workspace ID` | rich_text | `{workspace_uuid}` |
| `Flow Schema Version` | rich_text | `v05` |
| `Flow Row Hash` | rich_text | `sha256(canonical entity JSON)` — update/skip 판정 |

`unique_id` property 는 자동 생성 계열이라 external id 용도로 사용 불가 → `rich_text`/`title` 기반.

## 8. Idempotency / Re-export 알고리즘

Notion native upsert 없음 → **query → match → update/create** (codex P0).

```
1. target parent 아래 "FlowBrowser Workspaces" data source 찾거나 생성
2. workspace:{id} row query
3. child data source(Pages/Notes/AI Chat/...)별 Flow External ID query
4. 0건 → create / 1건 → Flow Row Hash 비교 후 update | skip
5. 2건 이상 → 자동 삭제 금지. canonical 1건만 update, 나머지 duplicate 로 report
6. row page 본문 블록 = "managed section"만 교체 (또는 generated page 전체 managed 명시)
```

## 9. Block Rendering Rules / Known Lossiness

- Page content / Note body → Notion paragraph/heading/code/list block 변환. HTML rich markup 은 best-effort (손실 허용 — canonical JSON 이 무손실 원본).
- `chat_meta` 표 → Notion table block best-effort (cells.sources 메타는 손실 → JSON 첨부 canonical).
- Highlight anchor (DOM Range) → Notion 표현 불가 → JSON only.
- Notion request limits: rich_text 2000 chars / URL 2000 chars / block 1000개·500KB per request / multi_select·relation 배열 100개 → 초과 시 분할(append children paginate) + truncation 정책 박음.

## 10. Canonical JSON Attachment Strategy

- workspace row 에 `flowbrowser-workspace-v05.json` 첨부 (20MB 이하 direct upload, 초과 시 multipart + gzip).
- Notion file URL 은 임시 URL → 재조회(retrieve file) 필요. import 시 다운로드 후 `WorkspaceExportImportService.importWorkspace` 로 복원.
- 첨부 JSON 도 **Privacy Gate 통과한 filtered artifact** (§13).

## 11. Import-from-Notion Strategy (P1, 전략만)

- 1순위: workspace row 의 canonical JSON 첨부 다운로드 → 기존 `importWorkspace` 재사용 (무손실).
- 2순위 (첨부 없음): Notion data source rows → `WorkspaceExportV1` 재구성 (lossy, best-effort). Sprint 020+ 후순위.

## 12. Auth / Credential Handling (G-003 / G-005)

- Notion 공식 integration/PAT **bearer 토큰**만 허용. 헤더 `Authorization: Bearer <token>`.
- 토큰 저장: main process `safeStorage` 암호화 (§13.4 Codex OAuth 토큰 묶음과 동일 계층, `<userDataDir>/credentials/notion-*.bin`). `safeStorage.isEncryptionAvailable()` 미지원 시 메모리-only 세션 한정 + 사용자 알림.
- Notion page/data source ID 는 secret 아님 → local config/cache 저장 가능.
- renderer/로그/IPC payload 토큰 노출 금지.

## 13. Privacy Export Gate (G-004)

```
WorkspaceExportImportService.exportWorkspace()
→ ExportArtifactBuilder 가 정확한 outbound artifact 를 로컬 빌드
→ ExportPrivacyGate preflight (Privacy Filter 5단계 — §13 정합)
→ 사용자 승인 / block / filtered plan 제시
→ NotionClient upload/create/update
```
- canonical JSON 첨부 포함 모든 outbound 콘텐츠가 게이트 대상.
- Privacy Filter hard-block entity 는 export 에서 제외 → round-trip 기준은 filtered artifact (§3).

## 14. Rate Limit / Pagination / Retry

- Base URL `https://api.notion.com`. Version 헤더 필수 `Notion-Version: 2026-03-11`.
- Rate limit: connection당 평균 **3 req/s**. 429 시 `Retry-After` 준수 (exponential backoff + jitter).
- Pagination: 최대 100/page, `has_more` / `next_cursor` / `start_cursor`.
- 핵심 endpoint: `POST /v1/pages` (create) / `PATCH /v1/pages/{id}` (update) / `POST /v1/databases` / `POST /v1/data_sources` / `POST /v1/data_sources/{id}/query` / `PATCH /v1/blocks/{id}/children` (append) / `GET /v1/blocks/{id}/children?page_size=100`.

## 15. Error Handling / Partial Failure

- 부분 실패 복구: export run 단위 progress 기록 (어떤 entity 까지 upsert 됐는지) → 재시도 시 idempotent dedup(§8)으로 이어서.
- 네트워크/429/5xx → backoff 재시도, 4xx(권한/스키마) → 즉시 사용자 알림 + run abort.
- duplicate 2건+ 발견 시 자동 삭제 금지 → report only.

## 16. Sprint 020 구현 작업 분해 (T19 → Sprint 020 tasks)

| # | 작업 | 산출물 |
|---|---|---|
| S020-a | round-trip contract + canonical envelope (sha256/equality) | `ExportArtifactBuilder` 골격 + envelope |
| S020-b | Notion schema/property 매핑 (data source 생성 + 관리 속성) | `NotionSchemaMapper` |
| S020-c | idempotent export 알고리즘 (query→match→upsert) | `NotionUpsertEngine` |
| S020-d | auth(Keychain) + `ExportPrivacyGate` | `NotionCredentialStore` + gate wiring |
| S020-e | rate limit/pagination/retry + 부분 실패 복구 | `NotionClient` |
| S020-f | acceptance tests + round-trip 회귀 | `tests/**` |

## 17. Acceptance Criteria / Tests (Sprint 020 게이트)

- AC-1: workspace export → Notion data sources + canonical JSON 첨부 생성 (managed 속성 4종 박힘).
- AC-2: 재export idempotent — 중복 row 0건 (Flow External ID upsert), Row Hash 변경분만 update.
- AC-3: round-trip — Notion 첨부 JSON → `importWorkspace` → canonical semantic equality (filtered artifact 기준).
- AC-4: Privacy Gate — hard-block entity 제외 검증 (G-004), 토큰 비노출 검증 (G-005, renderer/로그/IPC grep 0).
- AC-5: rate limit 429 backoff + pagination 100+ rows 회귀.
- 통과 기준: evaluator Pass ≥ 8 + lint/typecheck/test/build PASS.

## 18. 참조

- 사전 협의: codex `019e63c5-e15a-77b0-8d8f-f2e2de1336a3` (설계 권고 5항목 + Notion API 기본).
- 기존 코드: `src/main/WorkspaceExportImportService.ts` (`WorkspaceExportV1`), `src/main/MarkdownExportService.ts` (projection+JSON 첨부 패턴).
- PRD: §11(178행 Notion Export / 170행 §11.5.6 JSON Import/Export) + §16(101행 ExportArtifactBuilder / 123행 round-trip MVP 기준) + §13.4 (Keychain).
- Notion API: authentication / versioning(2026-03-11) / request-limits / database / data-source / query / post-page / blocks-children / file upload (developers.notion.com).

## 변경 이력

- 2026-05-26 (Sprint 018 M1 T03, 옵션 C): Notion Export 설계 spec 신규. canonical JSON(`WorkspaceExportV1`) round-trip + Notion presentation projection 분리. 구현 Sprint 020 (S020-a~f). codex 019e63c5 권고 정합.
