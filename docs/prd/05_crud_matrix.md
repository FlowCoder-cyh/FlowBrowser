# 05. CRUD 매트릭스 (CRUD Matrix)

> [← PRD 목차](./README.md)

본 섹션은 [§04 데이터 모델](./04_data_model.md) Entity 별로 누가 (Actor) / 어디서 (계층) / 어떤 IPC 채널 / 어떤 트랜잭션 단위로 CRUD 하는지 매트릭스화. 권한 분리 + IPC 표면 명시.

## 5.1 Actor 정의 (5종)

| Actor | 정의 | 권한 범위 |
|---|---|---|
| **User** | 사용자 입력 (직접 클릭·입력·선택) | UI 트리거만 (DB 직접 X) |
| **Renderer** | React renderer 프로세스 (browser-side) | UI 상태 + preload API 호출만. **DB·파일시스템 직접 접근 X — 모든 CRUD 는 IPC 위임** |
| **Main** | Electron main 프로세스 (실제 DB write owner) | DB 직접 + 외부 API 호출 + 파일시스템 |
| **AI** | Provider (OpenAI / Codex) 응답 처리 | Main 위임 호출, 결과 메타 INSERT (Main 이 실제 write) |
| **System** | 백그라운드 자동 동작 (인덱싱 / 임베딩 / 마이그레이션 / Privacy 차단) | Main 내부 worker — **System triggers, Main writes** |

**원칙**: Renderer 는 DB 직접 접근 X. 모든 CRUD 는 IPC 호출 → Main 위임 → Main 이 실제 write. 보안·일관성·트랜잭션 보호.

## 5.2 Entity × Actor 매트릭스

표기: C = Create / R = Read / U = Update / D = Delete / (—) = 권한 없음.
Renderer 표기 "request C/U/D via IPC" = Renderer 가 IPC 호출만 하고 실제 write 는 Main 이 수행.

| Entity | User | Renderer | Main (실제 write owner) | AI | System (triggers, Main writes) |
|---|---|---|---|---|---|
| **Workspace** | C/R/U/D (UI 트리거) | request C/R/U/D via IPC | C/R/U/D | — | triggers C (앱 첫 실행 시 📥 기본 자동 생성, 마이그레이션 시) |
| **Page** | (간접 — 페이지 열기) | request R via IPC | C/R/U | — | triggers C/U/D (인덱싱 / 본문 변경 감지 / TTL 정리) |
| **Visit** | (간접 — 페이지 열기) | request R via IPC | C/R | — | triggers C (자동 인덱싱 hook), D (정리) |
| **Note** | C/R/U/D (선택 + 추가) | request C/R/U/D via IPC | C/R/U/D | U (ai_tags 자동 태그) | — |
| **AiChatHistory** | C (질문) / R / D (대화 삭제) | request C/R/D via IPC | C/R/U/D (status 갱신 포함) | C (응답 메타 제공, Main 이 실제 INSERT) | — |
| **Tag** | C/U/D (사용자 수동 태그) | request C/R/U/D via IPC | C/R/U/D | C (AutoTagger 자동 태그) | — |
| **PageTag / NoteTag (M:N)** | (간접 — Tag 부여) | request C/D via IPC | C/D | C (자동 태깅 시) | — |
| **Embedding (vec_pages / vec_notes)** | — | — | C/U/D | — | triggers C/U (백그라운드 큐, Main writes) |
| **Settings (UserSetting)** | C/R/U (선택값 변경) | request R/U via IPC | C/R/U | — | triggers C (마이그레이션 시 디폴트), D (폐기 키 자동 제거) |

총 9 entity × 5 actor = 45 cell.

## 5.3 IPC 채널 매핑 (Phase 1 신규 + v0.3 유지)

본 표의 카운트는 PR b3.1 시점 v04-dependency-graph A4 SSOT 인용. 정확 카운트는 M2 PR 진행 중 코드 grep 으로 재확인.

### 5.3.1 Phase 1 신규 IPC (M3~M6 도입, 총 약 24개)

| 그룹 | 채널 | 방향 | Entity 조작 |
|---|---|---|---|
| indexing | `indexing:enqueue` | **Main 내부** (did-finish-load hook, IPC 노출 X) | Page (C/U) + Visit (C) + Embedding 큐 등록 |
| indexing | `indexing:status` | Renderer → Main | (R only) 워크스페이스별 진행 카운트 |
| indexing | `indexing:abort` | Renderer → Main | 탭 닫기 / 워크스페이스 전환 시 |
| embedding | `embedding:enqueue` | **Main 내부** (IPC 노출 X) | Embedding 큐 INSERT |
| embedding | `embedding:status` | Renderer → Main | (R only) 큐 진행 카운트 |
| tagging | `tagging:apply` | Renderer → Main (수동) + **Main 내부** (자동) | Tag (C) + PageTag/NoteTag (C) |
| search | `search:query` | Renderer → Main | (R only) Page + Note retrieval |
| search | `search:get-content` | Renderer → Main | (R only) 본문 캐시 fetch |
| chat | `chat:request` | Renderer → Main | AiChatHistory (C user + assistant) + retrieval |
| chat | `chat:retry` | Renderer → Main | AiChatHistory (U status, 재시도) |
| chat | `chat:history` | Renderer → Main | (R only) 워크스페이스 대화 history |
| chat | `chat:clear` | Renderer → Main | AiChatHistory (D) |
| note | `note:create` / `note:update` / `note:delete` / `note:list` / `note:get` | Renderer → Main | Note CRUD |
| workspace | `workspace:create` / `workspace:switch` / `workspace:delete` / `workspace:list` / `workspace:get-current` | Renderer → Main | Workspace CRUD + 전환 |
| shortcut | `shortcut:get-bindings` / `shortcut:set-binding` | Renderer → Main | Settings.shortcutOverride (U) |
| memory | `memory:stats` | Renderer → Main | (R only) 워크스페이스별 통계 (Page·Visit·Note·AiChatHistory 카운트) |

**카운트**: Renderer ↔ Main 노출 IPC = 3 (indexing - enqueue 제외 status·abort) + 1 (embedding - status) + 1 (tagging:apply) + 2 (search) + 4 (chat) + 5 (note) + 5 (workspace) + 2 (shortcut) + 1 (memory) = **약 24개**. Main 내부 hook (indexing:enqueue, embedding:enqueue) 은 IPC 카운트에서 제외.

### 5.3.2 v0.3 유지 IPC (56개, [§06 아키텍처](./06_architecture.md) 본문 정밀 매핑)

**카운트 출처**: PR b4 시점 실측 코드 grep — main/index.ts 33개 - 폐기 9개 = **24개**, services.ts 44개 - 폐기 12개 = **32개**. 합 **56개**. v04-dependency-graph §A3 SSOT 갱신 동반 (PR b3.1 "47개" → b4 "56개").

| 그룹 | 채널 카운트 | 비고 |
|---|---|---|
| tab:* (main) | 15 (`list/open/close/switch/active/reorder/close-others/close-right/duplicate/set-color/set-pinned/get-thumbnail/reopen/reopen-size/show-context-menu`) | PARTIAL — TabManager workspace_id 메타 추가 (M6) |
| panel·app·navigate·browser:* (main) | 9 (`panel:set-open / app:set-view-visible / navigate / go-back / go-forward / reload / get-current-url / browser:get-view-id / browser:nav-state`) | 변경 없음 |
| codex:* (services) | 5 (`start-login / cancel-login / poll-status / logout / status`) | 변경 없음 |
| consent:* (services) | 3 (`get / give / revoke`) | 변경 없음 |
| credential:* (services) | 4 (`save / delete / list / validate`) | 변경 없음 |
| privacy:* (services) | 7 (`add-rule / remove-rule / get-rules / approve / scan-page / blocked-stats / clear-policy`) | T20 인덱싱 차단 list 확장 |
| usage:* (services) | 4 (`list / summary / clear-all / purge-older-than`) | 변경 없음 |
| userSetting:* (services) | 2 (`get / update`) | PARTIAL — schema 변경 (폐기 키 제거) |
| (services 추가 7개) | 7 (PR b4 §06 본문에서 정확 매핑 — credential·privacy·codex 일부 추가 핸들러 등 multiline IPC 호출) | 차이 7개는 §06 정확 분류 |

소계 = main 24 + services (위 표 25 + 7) = **56개**.

폐기 IPC ([§19 마이그레이션](./19_migration_v03_v04.md) 본문) — 21개:
- main/index.ts: 9개 (`translate:render / render-restore / paragraphs / paragraphs-abort / page / page-abort / summarize-page / summarize-abort / pageResult:restore-current`)
- services.ts: 12개 (`cache:* 2 + pageResult:* 2 + glossary:* 7 + translate:request`)

## 5.4 라이프사이클 다이어그램

### 5.4.1 Page + Visit 라이프사이클 (자동 인덱싱)

```
사용자가 URL navigate
   ↓
Main: tab:open 또는 navigate IPC 처리
   ↓
WebContentsView did-finish-load 이벤트
   ↓
[Privacy IndexingGate 검사 — 차단 도메인 / 비밀번호 필드 감지]
   ↓ (통과 시)
ParagraphExtractor (DOM 추출)
   ↓
content_hash 계산 (빈 본문이면 NULL)
   ↓
[Page lookup by (workspace_id, url)]
   ├─ 없음 → 단일 TX { Page (C) + Visit (C) }
   ├─ 있음 + content_hash 같음 → 단일 TX { Visit (C) } (Page UPDATE 없음)
   └─ 있음 + content_hash 다름 → 단일 TX { Page (U content/content_hash/updated_at) + Visit (C) }
   ↓
EmbeddingQueue.enqueue(page_id, priority=active_tab ? 10 : 1) — TX 외부
   ↓
[비동기 백그라운드] Embedding (C/U) + AutoTagger 호출 (TX 외부, 실패 시 재시도)
   ↓
indexing:status broadcast (Renderer 갱신)
```

### 5.4.2 Note 라이프사이클

```
사용자: 페이지 텍스트 선택 → 컨텍스트 메뉴 "노트에 추가"
   ↓
Renderer: note:create IPC 호출 (selected_text + active visit_id)
   ↓
Main: 단일 TX { Note (C, ai_tags=NULL, created_by='user') }
   ↓
note:created broadcast (Renderer 즉시 갱신 — UX 우선)
   ↓
[비동기 백그라운드, TX 외부] AutoTagger (BYOK) → Tag (C) + NoteTag (C) + Note.ai_tags UPDATE
   ↓
[비동기 백그라운드, TX 외부] EmbeddingClient → vec_notes (C)
   ↓
note:enriched broadcast (Renderer 태그 + 임베딩 인디케이터 갱신)
```

**중요**: AutoTagger / EmbeddingClient 외부 호출은 **DB TX 외부**. 외부 AI 호출을 TX 안에 넣으면 장기 lock 위험.

### 5.4.3 AI Chat 라이프사이클 (RAG)

```
사용자: AI 채팅 패널에 질문 입력
   ↓
Renderer: chat:request IPC 호출 (workspace_id, content, optional page_id)
   ↓
Main: TX#1 { AiChatHistory (C, role='user', status='ok') }
   ↓
Main: TimeRangeParser (자연어 시간) + SearchService retrieval (vec_pages + vec_notes top-k)
   ↓
Main: PromptComposer (system prompt 분기, level_preference 반영)
   ↓
Main: TX#2 { AiChatHistory (C, role='assistant', status='pending', retrieved_items=[...]) }
   ↓
Main: Provider Adapter 호출 (사용자 선택 — API Key 또는 Codex OAuth) — TX 외부
   ├─ 성공 → TX#3 { AiChatHistory (U, content + chat_meta + status='ok') }
   └─ 실패 → TX#3 { AiChatHistory (U, content=에러 메시지 + status='failed') }
              + 사용자 UI 에 "재시도" 버튼 표시
   ↓
chat:response broadcast (Renderer 갱신, 출처 셀 클릭 시 search:get-content fetch)
```

**중요**: user / assistant 메시지는 별도 TX. Provider 외부 호출은 TX 외부.

### 5.4.4 Workspace 전환

```
사용자: 워크스페이스 사이드바 클릭
   ↓
Renderer: workspace:switch IPC 호출 (target_workspace_id)
   ↓
Main: 현 워크스페이스 인덱싱·임베딩·채팅 등 진행 작업 abort (큐 클리어)
   ↓
Main: 활성 탭 그룹 교체 (TabManager workspace_id 메타)
   ↓
Renderer: 메모리 통계 / AI 채팅 패널 / 노트 패널 / 탭 바 모두 새 워크스페이스 데이터로 교체
```

### 5.4.5 Workspace cascade DELETE

```
Main: workspace:delete IPC 호출
   ↓
단일 TX {
  vec_pages DELETE WHERE workspace_id=target  (sqlite-vec partition 활용)
  vec_notes DELETE WHERE workspace_id=target
  AiChatHistory DELETE (FK CASCADE)
  Note → NoteTag 자동 CASCADE
  Page → Visit / PageTag 자동 CASCADE
  Tag DELETE (FK CASCADE)
  Workspace DELETE
}
```

ON DELETE CASCADE FK 설정으로 자동. vec_pages/vec_notes 는 가상 테이블이라 FK CASCADE 미적용 — 명시 DELETE 필수.

## 5.5 트랜잭션 단위

| 작업 | 트랜잭션 | 이유 |
|---|---|---|
| Page (C) + Visit (C) | 단일 TX | 인덱싱 일관성 |
| Note (C) | 단일 TX (Tag·NoteTag·Embedding 분리) | 외부 AI 호출 (AutoTagger·EmbeddingClient) 을 TX 안에 넣지 않음 |
| Note.ai_tags U + NoteTag C | 별도 TX (백그라운드) | AutoTagger 결과 비동기 도착 |
| AiChatHistory user / assistant / status 갱신 | **3 개 별도 TX** | Provider 외부 호출이 비동기 |
| Embedding (C/U) | 별도 TX (백그라운드 큐) | 외부 호출 지연·실패 격리 |
| Tag (C) + PageTag/NoteTag (C) | 단일 TX (AutoTagger 응답 도착 후) | 태그 부여 원자성 |
| Workspace (D) cascade | 단일 TX (vec 명시 DELETE 포함) | 일관성 |
| 마이그레이션 (v0.3 → v0.4) | 단일 TX 권장 (회복 가능) | 실패 시 전체 revert ([§19](./19_migration_v03_v04.md)) |

## 5.6 권한 제약 (G-005 OS Keychain 위임)

| Entity | Keychain 위임 | 이유 |
|---|---|---|
| Settings.shortcutOverride | ❌ (UserSetting JSON) | 민감 정보 아님 |
| OpenAI API Key | ✅ (safeStorage) | G-005 |
| Codex OAuth 토큰 묶음 | ✅ (safeStorage) | G-005 |
| Workspace / Page / Visit / Note / AiChatHistory / Tag / Embedding | ❌ (SQLite 평문) | 콘텐츠 데이터, 워크스페이스 cookies 격리는 Phase 2 |

> **참고 (Phase 2+)**: 민감 워크스페이스 (의료·법무·금융 등) cookies 격리 + 디스크 암호화 옵션은 [§13 보안·프라이버시](./13_security_privacy.md) Phase 2 절차 참조.

## 5.7 SSOT 인용

- `.flowset/specs/v04-direction.md` §5 (데이터 모델) + §6 (핵심 동작 흐름)
- `.flowset/specs/v04-dependency-graph.md` §A (IPC 폐기 21개) + §B (신규 IPC 약 24개)
- `.flowset/specs/v04-migration-matrix.md` §E (신규 storage 모듈)

본 §05 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 5.8 변경 이력

- 2026-05-16 (PR b3): stub → 본문 작성. Actor 5종 + Entity × Actor 매트릭스 + IPC 매핑 + 라이프사이클 4종 + 트랜잭션 + Keychain 위임.
- 2026-05-16 (PR b3.1): codex 24건 + evaluator 2건 핫픽스. Renderer "request via IPC" 분리 표기 / System triggers/Main writes 통일 / 매트릭스 9 entity × 5 actor = 45 cell (PageTag·NoteTag 행 추가) / Phase 1 신규 IPC 약 22 → 약 24 정정 (내부 hook 분리 명시) / 유지 IPC "47개" → "약 47개" 수치 일관 + §06 본문 위임 / 라이프사이클 4종 → 5종 (Workspace cascade DELETE 추가) / Note·Embedding TX 외부 명시 (외부 AI 호출 lock 방지) / AiChatHistory user·assistant·status 3 TX 분리 / vec 가상 테이블 명시 DELETE 필수 명시.
