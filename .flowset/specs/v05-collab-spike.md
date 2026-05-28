# Sprint 018 T21 — 워크스페이스 공유 포맷 설계 시안 (SharedWorkspaceFormat)

> **상태**: 설계 시안 (구현 X). Sprint 018 M2 T21 (S018-T07) 산출물.
> **결정**: spec 만 작성, 구현은 **Sprint 021** (PRD §16 로드맵 §16.4.1: `SharedWorkspaceFormat` Sprint 021 배치).
> **사전 협의**: codex `019e6fcf-6006-7582-b847-896373a6952a` (read-only, 설계 adversarial 검토 — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 1 흡수) + evaluator/codex dual review.
> **G-013 단계별**: 본 시안(설계) → Sprint 021 구현 PR 분리.

## 1. Purpose / Non-goals

### Purpose
한 워크스페이스를 **다른 사용자/다른 기기로 단방향 전달**할 수 있는 포터블 공유 아티팩트(`SharedWorkspaceFormat`)의 포맷·압축·서명·import 안전성 설계. v04-direction §10.3 "워크스페이스 공유 = Phase 3 = 포맷 정의 + import/export" + PRD §16.4.1 (`src/storage/SharedWorkspaceFormat.ts` = "import/export 포맷 정의 + 압축·서명", Sprint 021) 정합.

**기존 JSON Export/Import 와의 차이 (본 시안의 존재 이유)**: `WorkspaceExportImportService` 의 JSON export/import 는 **자기 백업·복구**용이다 (KI-008 closed). 공유는 **신뢰할 수 없는 제3자가 만든 파일을 받아 들이는** 행위라, 자기 백업엔 없던 위협 표면이 생긴다: (1) authenticity/tamper-evidence (받은 파일이 도중에 변조됐나, 같은 사람이 보낸 게 맞나), (2) untrusted import (압축 폭탄·악성 payload·oversize DoS), (3) 받는 사람에게 노출되는 메타의 프라이버시 경계. 본 시안은 **"공유 파일 = 공격자 입력"** 을 전제로 한다 (codex 019e6fcf BLOCKING #2 — spec MUST 로 승격).

### Non-goals (본 시안 범위 밖)
- 실제 구현 (Sprint 021).
- **실시간 협업 / 동시 편집 / 머지 / 충돌 해소 / 클라우드 동기화** — 본 시안 명시 제외 (출처: Sprint 018 contract §2 제외 "클라우드 backup / 협업 실시간 — Phase 4" + §8 "모바일 / 클라우드 / 협업 — Phase 4"). v04-direction §10.4 는 MVP = Phase 1+2+3 만 규정하며 실시간/Phase 4 항목 자체가 부재.
- Notion / Markdown export — 별도 spec/구현 (`sprint-018-notion-export-spec.md` T19 = Sprint 020, `MarkdownExportService.ts` 구현됨). 본 시안은 그와 **동일 canonical payload + ExportPrivacyGate** 를 재사용한다.
- 임베딩(vec_pages/vec_notes) 공유 — derived data, model/dimension/sqlite-vec 버전 의존. 기존 JSON export 도 제외 (KI-022 정합 — import 후 재계산).
- 계정/PKI/중앙 신원 시스템 도입 — local-first 무계정 원칙 유지 (서명은 §6 의 한정된 의미만).

## 2. 제약 (가드레일)

| 가드레일 | 적용 |
|---|---|
| **G-003** 인증 금지선 | 공유 아티팩트는 **사용자 자신의 데이터만** 담는다. 쿠키/세션/비공식 토큰/계정 자격증명 일절 미포함. 서명 키는 사용자 로컬 자가 발급 (외부 인증 기관 무관). |
| **G-004** Privacy Filter P0 | 공유 = 외부 전송. **export 시 `ExportPrivacyGate` preflight 필수** (§7). 압축·서명 전 filtered artifact 기준. |
| **G-005** OS Keychain 위임 | Ed25519 **private key 는 OS Keychain/`safeStorage` 에만** 보관 (§6.4). renderer/로그/IPC payload/공유 파일에 평문 노출 금지. public key 만 아티팩트에 박음. |
| **G-013** 단계별 PR | 본 시안(설계) → Sprint 021 구현 PR 분리. |
| **G-014** 마이그레이션 dry-run + 백업 | import 는 **항상 새 워크스페이스 생성**(기존 데이터 비파괴) — `importWorkspace` 정책 정합. 본질적으로 dry-run 안전 (기존 워크스페이스 미변경). |

### 2.1 기존 코드 baseline (재사용 — DB 직접 조회 X)

- `src/main/WorkspaceExportImportService.ts:140` — **canonical 페이로드 `WorkspaceExportV1`** (`version: 1`, `schemaVersion: 'v06'`). `exportWorkspace(workspaceId)` / `importWorkspace(payload)`. round-trip 검증 완료 (단위 회귀 존재). 엔티티: Workspace(+`embedding_model`) / Page / Visit / Note / AiChatHistory / Tag / PageTag / NoteTag / Highlight.
  - import 정책: **항상 새 workspace/child id 발급** + 참조 재매핑(`retrieved_items`/`chat_meta` 안 page_id/visit_id/note_id) + **단일 TX rollback** + import 후 `embedding_queue` 재 enqueue (KI-022, priority=1) + `embedding_model` 보존 (미지원 id graceful DEFAULT).
  - `validatePayload` (`WorkspaceExportImportService.ts:617`) — version/schemaVersion/workspace 필수 필드 검증 + child 배열은 `Array.isArray` 후 **cast** 수준 (자기 백업 전제). **공유엔 불충분** → §8 deep validator 필요.
- `src/main/MarkdownExportService.ts` — projection + canonical JSON 첨부 패턴 (service 는 위치 모름, `{rootName, files[]}` 반환, 호출자가 디스크 쓰기). 본 공유 포맷도 동일하게 **service 는 byte buffer 만 생성, 디스크/다이얼로그는 호출자**.
- `sprint-018-notion-export-spec.md` §13 — `ExportPrivacyGate` preflight + filtered cascade (Page 제외 시 Visit/Note/Chat/Highlight/PageTag drop + page_id/visit_id 참조 null rewrite) + `payload_sha256 = sha256(canonical(WorkspaceExportV1))`. 본 공유 포맷은 **동일 게이트·cascade·canonical 해시를 재사용**한다 (필드명 통일 — §5.2).

## 3. Scope 경계 (Phase 3 vs Phase 4)

codex 019e6fcf #1 (NOTABLE — SSOT 정합 확인):

| 영역 | Phase | 본 시안 |
|---|---|---|
| 포맷 정의 (envelope + 압축 + 서명) | **Phase 3** | ✅ §5·§6 |
| Export (워크스페이스 → 공유 파일) | **Phase 3** | ✅ §7 |
| Import (공유 파일 → 새 워크스페이스) | **Phase 3** | ✅ §8·§9 |
| 파일 선택/저장 UX + export preflight 요약 + **import preview** | **Phase 3** | ✅ §7.3·§9.2 (codex #1 — 빠지기 쉬운 Phase 3 scope) |
| 실시간 협업 / 동시 편집 | Phase 4 | ❌ 제외 |
| 머지 / 충돌 해소 / 3-way diff | Phase 4 | ❌ 제외 |
| 클라우드 동기화 / 서버 중계 | Phase 4 | ❌ 제외 |

> **Phase 경계 출처 (evaluator ac2951b4 Partial 정정 — G-012)**: "공유 = Phase 3 (포맷+import/export)" = v04-direction §10.3. "실시간 협업/머지/클라우드 = Phase 4" = **Sprint 018 contract §2(제외) + §8(Sprint 종료 후 다음)**. v04-direction.md 에는 "Phase 4"/"실시간 협업" 표현 자체가 없음 (§10.4 는 MVP=Phase1+2+3 경계만 규정) — 본 시안이 실시간을 Phase 4 로 미루는 근거는 contract 다 (SSOT 역방향 갱신 아님).

공유 = **스냅샷 단방향 전달** (export 시점 상태를 파일로 굳혀 전달, import 는 새 워크스페이스 생성). 양방향 동기화·업데이트 반영은 본 시안 밖.

## 4. 산출물 / 책임 경계 (Sprint 021)

`src/storage/SharedWorkspaceFormat.ts` (신규, PRD §16.4.1):
- **pure 모듈** — DB 접근 X. `WorkspaceExportV1` 입력 → 공유 아티팩트 byte buffer 생성 / 공유 byte buffer → 검증된 `WorkspaceExportV1` 복원. canonicalization·해시·gzip·envelope 직렬화·deep validator 가 본 모듈 책임.
- 키 lifecycle (Ed25519 생성/Keychain 저장/서명/검증) + TOFU trust store 는 main process Credential 계층 (`src/storage/Credentials.ts` 인접) — secret 경계 (G-005).
- export 오케스트레이션(`exportWorkspace` → `ExportPrivacyGate` → 압축·서명) + import 오케스트레이션(검증 → preview → TOFU → `importWorkspace`) 은 handler/service 계층.
- 디스크 쓰기/읽기·파일 다이얼로그·UI 는 호출자 (`MarkdownExportService` 책임 분리 패턴 정합).

## 5. Envelope 구조 + Canonicalization

### 5.1 Envelope (압축 전 JSON)

```jsonc
{
  "format": "flowbrowser-shared-workspace",   // 매직 식별자 (오인 import 차단)
  "formatVersion": 1,                          // 공유 포맷 버전 (payload schemaVersion 과 별개)
  "producedAt": 1730000000000,                 // epoch ms (서명 입력 — §6.2)
  "producer": {
    "appVersion": "0.5.0",                     // 진단용 (신뢰 X)
    "instanceLabel": "내 노트북"                // 선택. 사용자가 정한 표시명. 글로벌 install id 아님 (§5.3)
  },
  "integrity": {
    "algo": "sha256",
    "payload_sha256": "<hex>"                  // = sha256(canonical(payload)). Notion spec §4 와 필드명 통일 (codex #4)
  },
  "signature": {                               // 선택 — 미서명 아티팩트도 유효 (§6.5 downgrade 정책)
    "algo": "ed25519",
    "publicKey": "<base64>",
    "keyFingerprint": "<sha256(publicKey) hex, 표시는 짧은 그룹>",
    "sig": "<base64 — §6.2 signing object 서명>"
  },
  "payload": { /* WorkspaceExportV1 (filtered, §7) */ }
}
```

전체 envelope JSON → **gzip** → `.fbworkspace` 단일 파일 (§9.0 bounded decompress).

### 5.2 Canonicalization (해시·서명 결정성)

- `canonical(payload)` = key 정렬 재귀 직렬화 + 실행시점 필드 제외. Notion spec §4 의 canonical 정의와 **동일 함수 재사용** (`payload_sha256` 동치 보장).
- `payload_sha256` 필드명은 Notion spec(`payload_sha256`)과 통일 (codex 019e6fcf #4 — 필드명 drift 차단).
- 실행시점 필드 제외 대상: `producedAt`, `producer.*`, `signature.*`, `WorkspaceExportV1.exportedAt`. → 같은 워크스페이스 상태면 같은 `payload_sha256` (재현 가능 round-trip 동치, §10).

### 5.3 installFingerprint 미채택 (프라이버시 — codex 019e6fcf #4)

초기 안의 `producer.installFingerprint` 는 **제거**한다. 글로벌 install 식별자는 공유 아티팩트를 통해 기기 추적 가능성을 만든다 (G-004 정신 위배).
- 대신 사용자가 임의로 정하는 `producer.instanceLabel`(표시명, 선택) 만 둔다.
- **주의 (TOFU 트레이드오프)**: 서명을 쓰면 `signature.publicKey` 자체가 안정적 발신자 식별자다. 이는 TOFU(§6.3)의 본질적 비용 — "같은 발신자 연속성"을 얻으려면 안정적 키가 필요하고, 그 키는 곧 추적 가능한 식별자다. 따라서 **서명은 항상 사용자 opt-in** 이며, 미서명 export 가 디폴트 후보 (Sprint 021 UX 결정 — §7.3).

## 6. 무결성 / 서명 모델 (Ed25519 TOFU)

local-first **무계정·무PKI** 환경. 서명은 신원 증명이 **아니다**.

### 6.1 두 계층

| 계층 | 강제 | 방어 대상 | 한계 |
|---|---|---|---|
| **무결성** (`payload_sha256`) | 필수 | 우발적 손상·전송 오류 탐지 | 공격자가 payload 변조 후 hash 재계산하면 무력 (codex #2) |
| **서명** (Ed25519) | 선택 (opt-in) | tamper-evidence + 동일 발신자 연속성(TOFU) | **신원 증명 아님** — fingerprint out-of-band 확인 없이는 발신자 신원 보증 불가 |

integrity-only 는 "받은 파일이 깨졌나"만 답한다. "누가 변조했나/같은 사람이 보냈나"는 서명이 필요하다.

### 6.2 서명 입력 = domain-separated canonical signing object (codex 019e6fcf BLOCKING #1)

서명은 `payload_sha256` 만이 아니라 **고정된 canonical signing object 전체**에 대해 수행한다. payloadHash 만 서명하면 envelope 메타(format/version/producedAt) 변조나 signature stripping 을 UX 가 오인할 수 있다.

```
signingObject = canonical({
  domain: "flowbrowser/shared-workspace/v1",   // domain separation (다른 용도 서명 재사용 차단)
  format, formatVersion,
  payload_sha256,
  payloadSchemaVersion,                          // = payload.schemaVersion (v06)
  producedAt
})
sig = ed25519_sign(privateKey, utf8(signingObject))
```

- 검증: `payload_sha256 == sha256(canonical(payload))` **그리고** `ed25519_verify(publicKey, signingObject, sig)`. 둘 중 하나라도 실패 → §6.5 처리.
- domain string 으로 본 서명이 다른 맥락(예: 향후 다른 아티팩트)에 재사용되지 않도록 격리.

### 6.3 TOFU (Trust On First Use) trust store

- main process 가 `keyFingerprint → {firstSeenAt, label?, lastSeenAt}` 로컬 trust store 유지 (secret 아님 — config/cache 가능, 단 §9.3 poisoning 주의).
- **처음 본 fingerprint**: "처음 보는 키" 안내 + 사용자 승인 후 import + trust store 등록.
- **기존과 동일 fingerprint**: "이전과 같은 키로 서명됨" 표시.
- **기존 fingerprint 인데 sig 불일치**: 변조 의심 — 명시 경고 + import 차단(또는 강한 확인).

### 6.4 키 lifecycle (G-005)

- Ed25519 keypair 는 **per-install 1회 생성**, private key = `safeStorage` 암호화 후 `<userDataDir>/credentials/share-signing-*.bin` (§13.4 Codex OAuth/Notion 토큰과 동일 계층).
- `safeStorage.isEncryptionAvailable()` 미지원 환경(Linux headless 등) → **서명 비활성** + 무결성-only export + 사용자 알림 (secret 평문 저장 절대 금지 — G-005).
- public key 만 envelope 에 박음. private key 는 renderer/로그/IPC/공유 파일 일절 미노출.

### 6.5 Downgrade 정책 (codex 019e6fcf BLOCKING #1)

| 상황 | 처리 |
|---|---|
| 미서명 아티팩트, 발신자 미상(trust store에 없음) | 무결성만 검증 + "서명 없음" 표시 후 import 허용 |
| **과거 동일 사람으로부터 signed 받았는데 이번엔 unsigned** | **downgrade 의심 — 경고 + 강한 확인**(또는 차단). (단, unsigned 는 fingerprint가 없어 발신자 매칭이 라벨/맥락 의존 — UX 한계 명시) |
| signed, fingerprint mismatch (sig 검증 실패) | 변조 의심 — import 차단 |
| signed, 검증 성공, 처음 본 키 | TOFU 등록 (§6.3) |
| signed, 검증 성공, 핀된 키 | "이전과 같은 키" |

### 6.6 UX 문구 제약 (codex 019e6fcf #2)

서명 UI 는 **"신원 확인"/"인증됨" 류 문구 금지**. 허용 상태 표현 4종만:
- "이전과 같은 키로 서명됨" (pinned)
- "처음 보는 키" (first-seen TOFU)
- "서명 없음" (unsigned)
- "서명 불일치 — 변조 의심" (mismatch)

## 7. Export 흐름 + Privacy Export Gate (G-004)

```
WorkspaceExportImportService.exportWorkspace(id)   // canonical WorkspaceExportV1
  → ExportPrivacyGate preflight (Privacy Filter 5단계 — §13, Notion spec §13 재사용)
  → filtered cascade 적용 후 payload 재구성 (Notion spec §13.1: Page 제외→dependent drop + 참조 null rewrite)
  → SharedWorkspaceFormat.build(filteredPayload, {sign?})  // canonical 해시 + (서명) + envelope + gzip
  → 호출자: 파일 저장 다이얼로그 + fs.writeFile('*.fbworkspace')
```

### 7.1 공유 아티팩트 미포함 (MUST)
- credential/secret (애초에 DB에 없음 — Keychain).
- embedding 벡터 (vec_pages/vec_notes — derived).
- Privacy Filter hard-block entity (ExportPrivacyGate 가 cascade drop).
- 서명 private key.

### 7.2 공유 고유 노출 메타 카테고리 (codex 019e6fcf #5 — 외부 전송과 다름)

받는 사람에게 그대로 노출되는 민감 메타를 export preview 에서 **카테고리별로 명시**한다 (hard-block 만으로 부족 — "안 막혔다 ≠ 공유해도 된다"):

| 카테고리 | 포함 데이터 | 정책 |
|---|---|---|
| 열람 기록 | Visit.visited_at / dwell_ms | **포함 여부 사용자 선택** (행동 프로파일 노출) |
| 대화 | AiChatHistory content / retrieved_items / chat_meta | **포함 여부 사용자 선택** (개인 질문/맥락 노출) |
| 페이지 본문 | Page.content / url / title | 기본 포함 (공유의 핵심), preview 표시 |
| 노트·하이라이트 | Note body / selected_text / Highlight anchor | 기본 포함, preview 표시 |
| 워크스페이스 메타 | name / icon / level_preference / embedding_model | 포함, preview 표시 |
| 태그 | Tag name / kind | 포함 |

- export preview = "이 파일에 포함되는 민감 메타 카테고리" 요약 + 선택적 카테고리(열람기록/대화) opt-out 토글. 정확한 디폴트(visit/dwell/chat 포함 여부)는 Sprint 021 UX 결정 항목으로 남김.
- 카테고리 제외 시에도 §10 round-trip 동치는 **제외 적용 후 filtered artifact 기준**.

### 7.3 서명 opt-in
- export 시 "서명하기"(기본 후보 off — §5.3 추적 트레이드오프) 선택. 서명 시 §6.2 signing object 로 서명.

## 8. Untrusted Import 위협 모델 + 한도/검증 레이어 (P0)

codex 019e6fcf **BLOCKING #2** — 공유 파일은 공격자 입력. 기존 `validatePayload`(child cast 수준) 위에 **deep schema/limits validator** 를 Sprint 021 P0 로 추가한다. 이 레이어를 통과한 payload 만 `importWorkspace` 로 넘긴다.

### 8.1 공격 표면 매트릭스 (codex 019e6fcf #3)

| 위협 | 방어 |
|---|---|
| **gzip decompression bomb** | bounded decompress — 출력 byte cap(예: 압축 해제 누적 상한) + ratio cap. 초과 즉시 abort (전량 메모리 적재 전). |
| **oversize payload (DoS)** | 압축 전후 총 byte cap + entity 배열 길이 cap (pages/notes/chat/tags/highlights 각각). |
| **malformed JSON — 깊은 중첩/거대 문자열** | JSON depth cap + per-string length cap (특히 `content`, `chat_meta`, `retrieved_items`, `anchor`). |
| **거대 구조 필드** (`chat_meta`/`retrieved_items`/`anchor`) | 파싱 후 구조 크기 cap + 배열 항목 수 cap. |
| **duplicate id** (map/skip 이상 유발) | validator 단계에서 중복 id 탐지 시 **fail-closed reject** (정규화 X — untrusted 입력은 거부, codex 019e6fcf NC#2). importWorkspace 가 page/tag 중복 id 를 map overwrite 또는 UNIQUE 실패로 처리하므로 그 앞단 validator 에서 차단. |
| **embedding queue 폭증** | import 후 재 enqueue 가 priority=1 이지만 대량 page → queue flood. throttle + §8.2 외부 호출 차단. |
| **import 후 자동 embedding → 외부 provider 호출 (privacy/cost)** | §8.2 — untrusted import 는 자동 외부 임베딩 금지(기본). |
| **renderer XSS** (page content/note body 에 HTML/script) | §8.3 — 표시 시점 sanitization 경계. |
| **악성 URL** (`file://`/custom scheme — 열기/표시) | §8.4 — URL scheme allowlist + 클릭 시 정책. |
| **TOFU trust store poisoning** | §9.3 — trust store 무결성. |
| **signature downgrade/strip/re-sign** | §6.2 signing object + §6.5 downgrade. |
| SQL injection | N/A — `importWorkspace` 전부 prepared statement. |
| path traversal | N/A — payload 에 파일 경로 없음. Markdown export 의 sanitizeSegment 는 그쪽 책임. |

### 8.1.1 의미 검증 (deep semantic validation — MUST, codex 019e6fcf NC#3)

limits(크기 cap)만으로 부족 — **의미 검증을 Sprint 021 P0 MUST 로 박는다** (구현자 누락 방지). `importWorkspace` 의 graceful skip(null rewrite)에 **의존하지 말고** validator 에서 fail-closed:

- **enum 검증**: `aiChatHistory.role` (user/assistant/system/error) / `aiChatHistory.status` (ok/pending/failed/aborted) / `tag.kind` (topic/entity/metric/sentiment/domain/freeform) / `note.created_by` (user/migration) / `workspace.level_preference` (novice/intermediate/advanced/null) / `workspace.embedding_model` (레지스트리 allowlist — `embeddingModel.ts`). 정의 외 값 reject.
- **숫자**: 모든 timestamp(`created_at`/`visited_at`/`exportedAt`/...) = finite integer. `dwell_ms`/`visited_count`/`ai_generated` = finite non-negative. NaN/Infinity/문자열 reject.
- **문자열**: URL/title/content/body per-string length cap (§8.1) + 타입 검증.
- **FK 무결성**: payload 내부 참조(`page_id`/`visit_id`/`tag_id`/`note_id` + `retrieved_items`/`chat_meta` 안 참조)가 **존재하는 entity 를 가리키거나 nullable 정책과 일치**. dangling 참조 reject (importWorkspace 가 null/skip 으로 흡수하기 전에 validator 가 차단).

### 8.2 import 후 임베딩 정책 (codex 019e6fcf #3 — privacy/cost)
- untrusted 공유 import 후 `embedding_queue` 재 enqueue 는 **자동 외부 provider 호출로 직결되면 안 됨** (받은 데이터를 사용자 OpenAI 키로 임베딩 = 비용 + 외부 전송 = G-004).
- 기본: import 는 큐에 박되 **사용자 확인 후 처리** 또는 로컬 임베딩 provider(Ollama) 워크스페이스로만 자동. 정확한 정책은 Sprint 021 — 최소한 "N 페이지 임베딩에 외부 API 호출/비용 발생" 고지 + 동의.
- **구현 노트 (codex 019e6fcf NOTABLE)**: 기존 `importWorkspace` 는 `embeddingQueue` 주입 시 TX 안에서 **즉시 enqueue** 한다 (KI-022). 공유 import 경로는 이와 충돌하지 않도록 (a) `EmbeddingQueue` 미주입(enqueue skip → `embeddingJobs:{pages:0,notes:0}`) 후 사용자 동의 시 별도 enqueue, 또는 (b) worker 처리를 pause/consent-gated 로 둔다.

### 8.3 renderer sanitization 경계
- Page.content / Note.body 는 TEXT 저장(저장 자체는 안전)이나, renderer 표시 시 HTML 로 렌더되면 stored XSS. 표시 경로(검색 결과/노트 패널/페이지 미리보기)에서 **sanitize 또는 textContent-only 렌더** 강제. Sprint 021 회귀에 악성 content fixture 포함.
- **Highlight anchor (W3C Range DOM path)** 도 untrusted — renderer overlay deserialize 시 의도외 DOM 노드 타깃 가능 (evaluator ac2951b4 보강). anchor 구조 cap(§8.1) + deserialize 시 `root.contains` 경계 + selectedText 정합 검증(PRD §11.11.4 fallback) 적용. 표시 경로 sanitization 과 별개 표면으로 회귀 cover.

### 8.4 URL scheme 정책
- import 된 Page.url 이 `file://`/custom scheme 일 때 표시/클릭 정책: scheme allowlist(http/https) + 그 외는 표시만(자동 열기 금지). Privacy/보안 회귀.

## 9. Import 흐름

```
fs.readFile('*.fbworkspace')
  → bounded gunzip (§8.1 byte/ratio cap)
  → envelope JSON parse + format 매직/formatVersion 검증
  → 무결성: payload_sha256 == sha256(canonical(payload))  (불일치 → abort)
  → 서명(있으면): ed25519_verify(signingObject) + TOFU(§6.3) + downgrade(§6.5)
  → deep schema/limits validator (§8) — 통과 못하면 reject
  → import preview (§9.2) 표시 + 사용자 승인
  → WorkspaceExportImportService.importWorkspace(payload)  // 새 워크스페이스 생성, 단일 TX
  → embedding 재계산 정책 (§8.2)
```

### 9.1 importWorkspace 재사용
- 기존 import 는 새 id 발급 + 단일 TX rollback + 참조 재매핑이 이미 견고. **검증 통과 payload 면 그대로 재사용**. 단 §8 validator 가 그 앞단 게이트.

### 9.2 Import preview (codex 019e6fcf #1 — Phase 3 scope)
- import 전 사용자에게: 워크스페이스 이름/아이콘, 엔티티 카운트(pages/notes/chat/tags/highlights), 서명 상태(§6.6 4종), 포함 메타 카테고리(§7.2), 예상 임베딩 비용(§8.2). 승인 후에만 INSERT.

### 9.3 TOFU trust store 무결성 (poisoning 방어)
- trust store(`keyFingerprint→meta`)는 secret 아니나 변조되면 "처음 보는 키"를 "핀된 키"로 오인시킬 수 있음. 로컬 파일 무결성(앱 전용 경로 + 쓰기 권한 제한) + 사용자 명시 등록만 핀. 자동 핀 금지.

## 10. Round-trip 계약

PRD §16.4.3 MVP 종료 기준 "Export — JSON round-trip 가능" 정합.
- 공유 아티팩트 = `WorkspaceExportV1` wrap → import unwrap → `importWorkspace`.
- round-trip 동치 = **filtered artifact 기준 canonical semantic equality** (byte-identical 아님 — id 재발급/실행시점 필드 제외). Notion spec §3 정의 정합.
- Privacy/카테고리 제외 적용 시: 동치 기준 = 제외 후 filtered payload (export 가 drop 한 결과가 비교 기준선). hard-block 포함 원본 전체 동치 주장 안 함 (G-004).

## 11. Sprint 021 구현 작업 분해 (T21 → Sprint 021 tasks)

codex 019e6fcf #6 (빠지면 안 되는 항목 전체):

| # | 작업 | 산출물 |
|---|---|---|
| S021-a | `SharedWorkspaceFormat` 타입 + envelope 직렬화 + canonicalization (Notion spec canonical 재사용) | `src/storage/SharedWorkspaceFormat.ts` |
| S021-b | bounded gzip decompress (byte/ratio cap) + 압축 | (동상) |
| S021-c | envelope magic/formatVersion 검증 + payload 해시 검증 (`payload_sha256`) | (동상) |
| S021-d | Ed25519 key lifecycle + Keychain(`safeStorage`) 저장 + TOFU trust store | Credential 계층 |
| S021-e | 서명 입력 signing object(§6.2) + downgrade/failed-signature UX(§6.5/§6.6) | service + IPC |
| S021-f | **untrusted deep schema/limits validator** (§8 — P0) | `SharedWorkspaceFormat` validator |
| S021-g | `ExportPrivacyGate` + filtered cascade wiring (Notion spec §13.1 재사용) + 노출 메타 카테고리 preview(§7.2) | gate wiring |
| S021-h | import preview(§9.2) + 파일 다이얼로그 IPC | handler + UI |
| S021-i | embedding 재계산 throttle + 외부 호출 동의(§8.2) | import 오케스트레이션 |
| S021-j | renderer sanitization(§8.3) + URL scheme 정책(§8.4) 회귀 | renderer + 테스트 |
| S021-k | 테스트: round-trip semantic equality / malformed gzip·zip-bomb / oversize / signature tamper·strip·re-sign / corrupt fixture / fuzz | `tests/**` |

## 12. Acceptance Criteria / Tests (Sprint 021 게이트)

- **AC-1**: 워크스페이스 export → `.fbworkspace` 생성 (envelope + gzip + 무결성 해시), import → 새 워크스페이스 + round-trip semantic equality(filtered 기준).
- **AC-2**: 서명 export → import 시 TOFU 4상태(§6.6) 정확 판정. envelope 메타 변조 = signing object 검증 실패로 탐지. signature **strip** 은 암호학적 탐지 불가 → §6.5 downgrade 정책으로만 경고. **re-sign** 은 pinned key mismatch 일 때만 경고/차단 (first-seen attacker key 면 "처음 보는 키"로만 표시) (§6.2/§6.5, codex 019e6fcf NC#1).
- **AC-3**: untrusted 방어 — zip-bomb/oversize/깊은 JSON/거대 문자열/duplicate id fixture 가 validator(§8)에서 reject (importWorkspace 도달 X).
- **AC-4**: Privacy — hard-block entity 제외(G-004) + 노출 메타 카테고리 preview + 열람기록/대화 opt-out 동작. 서명 private key 비노출(renderer/로그/IPC grep 0, G-005).
- **AC-5**: embedding 재계산이 untrusted import 시 자동 외부 호출 안 함 (§8.2) — 사용자 동의/로컬 provider 한정.
- **AC-6 (구현 착수 전)**: Node `zlib` bounded decompress API / `crypto` Ed25519(`generateKeyPairSync('ed25519')`/`sign`/`verify`) / Electron `safeStorage` 동작을 Sprint 021 착수 시점 재확인 (외부 API 변동 가능).
- 통과 기준: evaluator Pass ≥ 8 + lint/typecheck/test/build PASS.

## 13. 참조

- 사전 협의: codex `019e6fcf-6006-7582-b847-896373a6952a` (read-only, adversarial 설계 검토 — BLOCKING 2 / NEEDS_CHANGES 5 / NOTABLE 1 흡수).
- 방향 SSOT: `.flowset/specs/v04-direction.md` §10.3 (워크스페이스 공유 = Phase 3 포맷+import/export) + §10.4 (MVP = Phase1+2+3). **실시간 협업/클라우드 = Phase 4 출처 = Sprint 018 contract §2(제외) + §8** (v04-direction 에는 Phase 4 표현 부재 — §3 Phase 경계 출처 참조).
- PRD: §11.5.6 (Phase 1 JSON Import/Export 안전망) + §16.4.1 (`SharedWorkspaceFormat` Sprint 021 "압축·서명") + §16.4.3 (round-trip MVP 기준) + §13.4 (OS Keychain 위임).
- 기존 코드: `src/main/WorkspaceExportImportService.ts:140` (`WorkspaceExportV1` v06, importWorkspace 새 id 발급 + 단일 TX) / `src/main/MarkdownExportService.ts` (projection+첨부 책임 분리) / `src/storage/embeddingModel.ts` (embedding_model 레지스트리).
- 동반 spec: `sprint-018-notion-export-spec.md` (T19 — canonical JSON round-trip + ExportPrivacyGate §13 + filtered cascade §13.1 — 본 시안 재사용).
- 관련 KI: KI-008 closed (JSON Export/Import) / KI-022 closed (import 후 embedding 재 enqueue).
- 외부 API (Sprint 021 착수 시 재확인): Node.js `crypto` Ed25519 / `zlib` gzip + bounded decompress / Electron `safeStorage`.

## 14. 변경 이력

- 2026-05-29 (Sprint 018 M2 T21, S018-T07): SharedWorkspaceFormat 설계 시안 신규. 단방향 파일 공유(`.fbworkspace` = gzip envelope + 무결성 해시 + 선택 Ed25519 TOFU 서명) scope(Phase 3) ↔ 실시간 협업(Phase 4) 경계. 기존 `WorkspaceExportV1` canonical payload + `ExportPrivacyGate` filtered cascade 재사용. **"공유 파일 = 공격자 입력"** 전제 — untrusted deep schema/limits validator(§8) P0. 서명 = 신원 증명 아닌 tamper-evidence + TOFU 연속성(§6). 구현 Sprint 021(S021-a~k). codex 019e6fcf 사전 설계 협의 권고(BLOCKING 2: signing object+downgrade / untrusted validator, NEEDS_CHANGES 5, NOTABLE 1) 전량 흡수.
- 2026-05-29 (dual review hotfix, 동일 PR 흡수): evaluator `ac2951b4aa4fb4e5b` (Pass 5/Partial 1/Fail 0) + codex `019e6fcf` round-2 (BLOCKING 0/NEEDS_CHANGES 3/NOTABLE 3) 반영. (1) §1·§3·§13 Phase 4 출처 정정 — "실시간=Phase 4" 는 v04-direction 아닌 **contract §2/§8** 출처 (evaluator Partial, G-012/G-006). (2) §12 AC-2 서명 탐지 과대주장 정정 (strip=downgrade 경고 / re-sign=pinned mismatch 한정, codex NC#1). (3) §8.1 duplicate id fail-closed reject (codex NC#2). (4) §8.1.1 의미 검증(enum/finite int/FK 무결성) MUST 신설 (codex NC#3). (5) §8.2 embedding queue 미주입/consent-gate 구현 노트 (codex NOTABLE). (6) §8.3 악성 anchor DOM-path 표면 보강 (evaluator). (7) §11 S021-c envelope magic/version 검증 문구 (codex NOTABLE).
