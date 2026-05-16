# 05. CRUD 매트릭스 (CRUD Matrix)

> [← PRD 목차](./README.md)

본 섹션은 [§04 데이터 모델](./04_data_model.md) Entity 별로 누가 (Actor) / 어디서 (계층) / 어떤 IPC 채널 / 어떤 트랜잭션 단위로 CRUD 하는지 매트릭스화. 권한 분리 + IPC 표면 명시.

## 5.1 Actor 정의 (5종)

| Actor | 정의 | 권한 범위 |
|---|---|---|
| **User** | 사용자 입력 (직접 클릭·입력·선택) | UI 트리거 |
| **Renderer** | React renderer 프로세스 (browser-side) | UI 상태 + preload API 호출만 (DB 직접 X) |
| **Main** | Electron main 프로세스 | DB 직접 + 외부 API 호출 + 파일시스템 |
| **AI** | Provider (OpenAI / Codex) 응답 처리 | Main 위임 호출, 결과 메타 INSERT |
| **System** | 백그라운드 자동 동작 (인덱싱 / 임베딩 / 마이그레이션 / Privacy 차단) | Main 내부 worker |

**원칙**: Renderer 는 DB 직접 접근 X. 모든 CRUD 는 Main 위임 (IPC). 보안·일관성·트랜잭션 보호.

## 5.2 Entity × Actor 매트릭스

표기: C = Create / R = Read / U = Update / D = Delete / (—) = 권한 없음

| Entity | User | Renderer | Main | AI | System |
|---|---|---|---|---|---|
| **Workspace** | C/R/U/D (UI 트리거) | R (IPC 응답) | C/R/U/D (DB) | — | C (마이그레이션 시 📥 기본 자동) |
| **Page** | (간접) | R (IPC 응답) | C/R/U (DB) | — | C/U/D (인덱싱 / 본문 변경 감지 / 정리 정책) |
| **Visit** | (간접 — 페이지 열기) | R (IPC 응답) | C (INSERT) / R | — | C (자동 인덱싱 hook) / D (정리) |
| **Note** | C/R/U/D (선택 + 추가) | C·U·D (IPC 호출) / R (IPC 응답) | C/R/U/D (DB) | U (자동 태그) | — |
| **AiChatHistory** | C (질문) / R / D (대화 삭제) | C·D (IPC 호출) / R | C/R/D (DB) | C (응답 INSERT) | — |
| **Tag** | C/U/D (사용자 수동 태그) | C·U·D (IPC 호출) / R | C/R/U/D (DB) | C (AutoTagger 자동 태그) | — |
| **Embedding (vec_pages / vec_notes)** | — | — | C/D | — | C (백그라운드 큐) / U (재방문 본문 변경 시) |
| **Settings (UserSetting)** | C/R/U (선택값 변경) | R (IPC 응답) / U (IPC 호출) | C/R/U (DB) | — | C (마이그레이션 시 디폴트) / D (폐기 키 제거) |

## 5.3 IPC 채널 매핑 (Phase 1 신규 + 기존 유지)

[§19 마이그레이션 IPC 폐기 21개](./19_migration_v03_v04.md) 와 별개로 Phase 1 신규 IPC 약 20~25개. v0.3 유지 IPC 47개.

### 5.3.1 Phase 1 신규 IPC (M3~M6 도입)

| 그룹 | 채널 | 방향 | Entity 조작 |
|---|---|---|---|
| indexing | `indexing:enqueue` | Renderer → Main (자동, 사용자 호출 X) | Page (C/U) + Visit (C) + Embedding 큐 등록 |
| indexing | `indexing:status` | Renderer → Main | (R only) 워크스페이스별 진행 카운트 |
| indexing | `indexing:abort` | Renderer → Main | 탭 닫기 / 워크스페이스 전환 시 |
| embedding | `embedding:enqueue` | Main 내부 | Embedding (C) |
| embedding | `embedding:status` | Renderer → Main | (R only) 큐 진행 카운트 |
| tagging | `tagging:apply` | Main 내부 (자동) + Renderer → Main (수동) | Tag (C) + PageTag / NoteTag |
| search | `search:query` | Renderer → Main | (R only) Page + Note retrieval |
| search | `search:get-content` | Renderer → Main | (R only) 본문 캐시 fetch |
| chat | `chat:request` | Renderer → Main | AiChatHistory (C) + retrieval |
| chat | `chat:history` | Renderer → Main | (R only) 워크스페이스 대화 history |
| chat | `chat:clear` | Renderer → Main | AiChatHistory (D) |
| note | `note:create` / `update` / `delete` / `list` / `get` | Renderer → Main | Note CRUD |
| workspace | `workspace:create` / `switch` / `delete` / `list` / `get-current` | Renderer → Main | Workspace CRUD + 전환 |
| shortcut | `shortcut:get-bindings` / `set-binding` | Renderer → Main | Settings.shortcutOverride (U) |
| memory | `memory:stats` | Renderer → Main | (R only) 워크스페이스별 통계 (Page·Visit·Note·AiChatHistory 카운트) |

총 약 22개 신규 IPC.

### 5.3.2 v0.3 유지 IPC (47개, [§06 아키텍처](./06_architecture.md) 참조)

- tab:* 14개 / panel·app·navigate·browser:* 9개 / codex:* 5개 / consent:* 3개 / credential:* 4개 / privacy:* 7개 / usage:* 4개 / userSetting:* 2개 = 48개. 단 v0.3 → v0.4 전환에서 userSetting 일부 키 정리 ([§19](./19_migration_v03_v04.md) 참조).

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
content_hash 계산
   ↓
[Page lookup by (workspace_id, url)]
   ├─ 없음 → Page (C) + Visit (C)
   ├─ 있음 + content_hash 같음 → Visit만 (C)
   └─ 있음 + content_hash 다름 → Page (U) + Visit (C) + Embedding (재생성 큐)
   ↓
EmbeddingQueue.enqueue(page_id, priority=active_tab ? 10 : 1)
   ↓
[비동기] Embedding (C/U) + AutoTagger (C of Tag + PageTag)
   ↓
indexing:status broadcast (Renderer 갱신)
```

### 5.4.2 Note 라이프사이클

```
사용자: 페이지 텍스트 선택 → 컨텍스트 메뉴 "노트에 추가"
   ↓
Renderer: note:create IPC 호출 (selected_text + active visit_id)
   ↓
Main: Note INSERT (page_id, visit_id, workspace_id, selected_text)
   ↓
Main: AutoTagger 호출 (BYOK 우선) → Tag (C) + NoteTag (C) + ai_tags 컬럼 UPDATE
   ↓
Main: EmbeddingClient 호출 → Note.embedding (U)
   ↓
note:created broadcast (Renderer 갱신)
```

### 5.4.3 AI Chat 라이프사이클 (RAG)

```
사용자: AI 채팅 패널에 질문 입력
   ↓
Renderer: chat:request IPC 호출 (workspace_id, content, optional page_id)
   ↓
Main: AiChatHistory.user 메시지 INSERT
   ↓
Main: TimeRangeParser (자연어 시간) + SearchService retrieval (Page + Note top-k)
   ↓
Main: PromptComposer (system prompt 분기, level_preference 반영)
   ↓
Main: Provider Adapter 호출 (사용자 선택 — API Key 또는 Codex OAuth)
   ↓
Main: Provider 응답 파싱 (Markdown + JSON 메타 분리)
   ↓
Main: AiChatHistory.assistant 메시지 INSERT (retrieved_page_ids + chat_meta)
   ↓
chat:response broadcast (Renderer 갱신, 출처 셀 클릭 시 본문 캐시 fetch)
```

### 5.4.4 Workspace 전환

```
사용자: 워크스페이스 사이드바 클릭
   ↓
Renderer: workspace:switch IPC 호출 (target_workspace_id)
   ↓
Main: 현 워크스페이스 인덱싱 / 채팅 등 진행 작업 abort
   ↓
Main: 활성 탭 그룹 교체 (TabManager workspace_id 메타)
   ↓
Renderer: 메모리 통계 / AI 채팅 패널 / 노트 패널 / 탭 바 모두 새 워크스페이스 데이터로 교체
```

## 5.5 트랜잭션 단위

| 작업 | 트랜잭션 | 이유 |
|---|---|---|
| Page (C) + Visit (C) | 단일 TX | 인덱싱 일관성 |
| Note (C) + Tag (C) + NoteTag (C) | 단일 TX | 노트 작성 원자성 |
| AiChatHistory user + assistant 메시지 | **별도 TX** | user INSERT 후 assistant 응답이 비동기 도착 |
| Embedding (C/U) | 별도 TX (백그라운드 큐) | 응답 지연 X |
| Workspace (D) cascade | 단일 TX | Page/Visit/Note/AiChatHistory/Tag 모두 cascade DELETE (FK ON DELETE CASCADE) |
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
- `.flowset/specs/v04-dependency-graph.md` §A (IPC 19개 폐기) + §B (신규 IPC 20~25개)
- `.flowset/specs/v04-migration-matrix.md` §E (신규 storage 모듈)

본 §05 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 5.8 변경 이력

- 2026-05-16 (PR b3): stub → 본문 작성. Actor 5종 정의 + Entity × Actor 매트릭스 + IPC 매핑 (신규 22개 + 유지 47개) + 라이프사이클 4종 + 트랜잭션 단위 + Keychain 위임 정책.
