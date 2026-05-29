# 11. 워크스페이스 (Workspace)

> [← PRD 목차](./README.md)

본 섹션은 워크스페이스 격리 모델 + 전환 UX + 데이터 모델 + 사용자 수준 옵션. [§01 §1.2](./01_overview.md#12-적용-패러다임) "프로젝트별 환경 격리" 원칙 + [§04 §4.3.1 Workspace](./04_data_model.md#431-workspace) 컬럼 spec 정합.

## 11.1 핵심 메타포

```
워크스페이스 = 프로젝트 단위 격리된 "방"
  ├─ 자체 탭 그룹 (TabManager workspace_id 메타)
  ├─ 자체 페이지 메모리 (Page + Visit + Embedding workspace_id partition)
  ├─ 자체 AI 컨텍스트 (AiChatHistory workspace_id 격리)
  ├─ 자체 노트 (Note workspace_id 격리)
  └─ Phase 2+ 자체 cookies/session/storage (Electron Partition)
```

사용자가 "📚 신약 리서치", "🏠 전세집 찾기", "💻 GraphQL 학습" 같은 워크스페이스 생성 → 전환 시 모든 자산 교체. 다른 워크스페이스 노이즈 0.

## 11.2 격리 수준 (Phase 별)

### 11.2.1 Phase 1 격리 (메타 단위)

| 자산 | 격리 방식 | 구현 |
|---|---|---|
| 탭 | TabState.workspace_id 메타 + 전환 시 활성 탭 그룹 교체 | M6 TabManager PARTIAL |
| 페이지 메모리 | Page.workspace_id NOT NULL + sqlite-vec `partition key` (M3 spike — space) | M3 IndexedPageStore |
| AI 컨텍스트 | AiChatHistory.workspace_id NOT NULL + 채팅 history 워크스페이스 필터 | M5 ChatService |
| 노트 | Note.workspace_id NOT NULL + 검색 retrieval 필터 | M5 NoteService |
| 태그 | Tag.workspace_id NOT NULL + UNIQUE (workspace_id, kind, name) | M3 TagStore |

**Phase 1 미격리** (모든 워크스페이스 공유):
- cookies / localStorage / sessionStorage / 캐시 / Service Worker — Phase 2+
- 브라우저 히스토리 (Chromium 자체) — Electron 디폴트
- 다운로드 폴더 — 사용자 설정

### 11.2.2 Phase 2 격리 (Electron Partition)

[§06 §6.7.1](./06_architecture.md#671-phase-2-추가-모듈) WorkspacePartitionManager 도입.

| 자산 | 격리 방식 | 구현 |
|---|---|---|
| cookies | Electron `session.fromPartition('persist:ws-{uuid}')` | Phase 2 M? |
| storage (localStorage / sessionStorage / IndexedDB) | 동상 — partition 단위 격리 | 동상 |
| 캐시 | `wsSession.clearCache()` (await 대상) + `wsSession.clearStorageData({storages: [...]})` (localStorage/IndexedDB/ServiceWorker 분리 정리) | 동상 — Electron `Session` 객체 메서드 (PR b7.1 변수명 정정) |
| Service Worker | partition 단위 등록 | 동상 |

```typescript
// Phase 2 WorkspacePartitionManager 예시 (PR b7.1 변수명 정정)
import { session, WebContentsView } from 'electron'
const wsSession = session.fromPartition(`persist:ws-${workspace_id}`)
const view = new WebContentsView({ webPreferences: { session: wsSession } })
mainWindow.contentView.addChildView(view)  // 수명주기 명시 — 워크스페이스 전환 시 destroy + recreate

// 워크스페이스 삭제 시
await wsSession.clearCache()
await wsSession.clearStorageData({
  storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
})
```

Electron 공식 문서 ([session.fromPartition](https://www.electronjs.org/docs/latest/api/session)) 기준 — `persist:` prefix 가 디스크 영속 partition.

### 11.2.3 Phase 1 → 2 마이그레이션

Phase 2 진입 시 기존 cookies/storage 는 모든 워크스페이스 공유 상태 → 사용자가 워크스페이스별 재로그인 (예: GitHub 계정 분리). 자동 마이그레이션 X (보안 결정 위임).

Phase 2 contract 작성 시 사용자 안내 UI + 워크스페이스별 cookies 격리 활성화 선택 옵션 도입.

## 11.3 전환 UX (M6)

[§07 §7.4.1 WorkspaceSidebar](./07_ui_layout.md#741-workspacesidebar-m6) + [§05 §5.4.4 Workspace 전환](./05_crud_matrix.md#544-workspace-전환) 정합.

### 11.3.1 전환 흐름

```
사용자: WorkspaceSidebar 항목 클릭
   ↓
Renderer: workspace:switch IPC 호출 (target_workspace_id)
   ↓
Main: 현 워크스페이스 진행 중 작업 abort (함수명은 가설, M3/M4/M5 contract 시 정확 spec 박힘)
   ├─ IndexingService.abort (M4 신규) — 현 워크스페이스 인덱싱 큐
   ├─ EmbeddingQueue.clear (M3 신규) — 현 워크스페이스 임베딩 큐
   └─ ChatService.abortStreaming (M5 신규) — active streaming + chat:abort IPC
   ↓
Main: TabManager 활성 탭 그룹 교체
   ├─ 현 워크스페이스 탭 그룹 stash (WebContentsView 메모리 정리)
   └─ target 워크스페이스 탭 그룹 restore (TabStateStore 에서 복원)
   ↓
Main: UserSetting.activeWorkspaceId = target_workspace_id (영속)
   ↓
Renderer broadcast:
   ├─ ChatPanel 새 워크스페이스 AiChatHistory 로드
   ├─ MemoryStatsPanel 카운트 갱신
   ├─ NotePanel (열려있으면) 닫기
   └─ SearchBar 결과 캐시 무효화
```

### 11.3.2 전환 비용

| 비용 | 추정 |
|---|---|
| 탭 그룹 stash + restore | 탭당 ~50ms (WebContentsView destroy + recreate) — 5~10 탭 기준 250~500ms |
| ChatHistory 로드 | < 50ms (50 메시지 기준, idx_chat_workspace_time 활용) |
| MemoryStats 카운트 | < 20ms (denormalized 통계, M3+) |
| **전체** | **< 1초** (M6 정량 임계 검증) |

### 11.3.3 진행 중 작업 abort 정책

- 인덱싱: 현재 페이지 인덱싱 X 완료 직전이면 강제 abort. Visit 만 INSERT, Embedding 큐 제거 (재방문 시 재인덱싱)
- 임베딩: 큐에서 page_id 제거. 이미 호출 중인 API 응답은 받지만 결과 저장 X
- 채팅 streaming: AbortController + AiChatHistory.status='aborted'

## 11.4 첫 실행 — "📥 기본" 워크스페이스

[§06 §6.5](./06_architecture.md#65-부팅-시퀀스-v04-기준--함수명은-실제-코드-기준) 부팅 시퀀스 정합.

### 11.4.1 자동 생성 시점

| 진입 경로 | 워크스페이스 생성 시점 |
|---|---|
| **Fresh install** (v0.3 JSON 모두 없음) | initServices(userDataDir) 진입 시 첫 워크스페이스 INSERT (`name='기본', icon='📥', created_at=now()`) |
| **v0.3 → v0.4 마이그레이션** | checkAndRunMigration 진입 시 첫 워크스페이스 INSERT (동일) + Glossary/Page/Visit/Tab 모두 이 workspace_id 부여 |

### 11.4.2 다국어 (Phase 1 한국어 우선)

기본 워크스페이스 `name` = "기본" (한국어). Phase 2+ i18n 시스템 도입 시 사용자 선택 언어로 자동 번역.

## 11.5 워크스페이스 CRUD

[§05 §5.3.1 workspace 5 IPC](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-25개) 정합.

### 11.5.1 Create (`workspace:create`)

| 입력 | 검증 |
|---|---|
| `name` | NOT NULL, 1~50자 |
| `icon` | preset 12종 또는 사용자 이모지 1자. UTF-8 emoji 검증 |
| `level_preference` (선택) | `novice / intermediate / advanced / null` |

UI: WorkspaceSidebar "+ 새 워크스페이스" 모달 (M6).

### 11.5.2 Read (`workspace:list` / `workspace:get-current`)

| 채널 | 응답 |
|---|---|
| `workspace:list` | 전체 워크스페이스 목록 (id/name/icon/created_at/level_preference/통계) |
| `workspace:get-current` | UserSetting.activeWorkspaceId 기반 현재 워크스페이스 |

### 11.5.3 Update (`workspace:update`)

| 가능 필드 | 비고 |
|---|---|
| `name` | 즉시 갱신 |
| `icon` | 즉시 갱신, MemoryStatsPanel 컬러 매핑 자동 변경 |
| `level_preference` | 즉시 갱신, ChatService 다음 요청부터 system prompt 분기 적용 |

### 11.5.4 Delete (`workspace:delete`)

[§05 §5.4.5 Workspace cascade DELETE](./05_crud_matrix.md#545-workspace-cascade-delete) 정합. 단일 TX + vec 명시 DELETE.

**확인 dialog 필수**: "워크스페이스 '{name}' 을 삭제하시겠습니까? 페이지 N건, 노트 M건, AI 대화 K건이 모두 삭제됩니다." — 복구 불가.

**Phase 2+ 옵션**: "휴지통" 으로 30일 보존 + 자동 영구 삭제 (현재 Phase 1 즉시 삭제).

### 11.5.5 마지막 워크스페이스 보호

마지막 워크스페이스 1개 삭제 시 자동으로 "📥 기본" 신규 생성 (워크스페이스 0개 상태 방지).

### 11.5.6 Import / Export (Phase 1 base — PR b7.1 추가)

PR b7 에서 Export 를 Phase 3 만으로 미뤘으나, **데이터 portability + 복구 안전망** 위해 Phase 1 시점 최소 JSON export 도입.

| 동작 | Phase | 상태 | 형식 |
|---|---|---|---|
| **JSON Export/Import (Phase 1, M6)** | Phase 1 | ✅ 구현 (`WorkspaceExportImportService`, canonical `WorkspaceExportV1` `schemaVersion: 'v06'`) | 워크스페이스 단위 JSON (Workspace[embedding_model 포함] + Page + Visit + Note + AiChatHistory + Tag + PageTag + NoteTag + Highlight 일괄) — 백업·복구. round-trip import 검증 + id remap (모든 child id + 참조 rewrite). v04/v05 payload graceful import (highlights 빈배열 normalize / embedding_model 부재 시 DEFAULT) |
| **Markdown Export (Phase 3)** | Phase 3 | ✅ 구현 (`MarkdownExportService`) | presentation projection + `workspace.json` canonical 첨부 (round-trip 보장, KI-008 정합) |
| **Notion Export (Phase 3)** | Phase 3 | 📝 설계 spec 완료, 구현 **Sprint 020 위임** | canonical JSON round-trip + Notion presentation projection (lossy block 모델). `.flowset/specs/sprint-018-notion-export-spec.md` (T19 옵션 C). `ExportArtifactBuilder` Notion 경로 |

> **v0.5.0 갱신**: JSON·Markdown Export 는 이미 구현 (round-trip 보장). Notion Export 는 **설계 spec 만 완료** (T19, 구현 Sprint 020 — G-013 단계별). 외부 전송 경로는 `ExportPrivacyGate` preflight 필수 (§13, G-004) + Notion 토큰 OS Keychain 위임 (G-005). Phase 1 JSON Export 는 마이그레이션·삭제 안전망 (M6 UI).

## 11.6 사용자 수준 옵션 (R3-A, Phase 1)

[§04 §4.3.1 Workspace.level_preference](./04_data_model.md#431-workspace) + [§10 §10.4.1 PromptComposer 4 분기](./10_ai_chat.md#1041-사용자-수준-옵션-r3-a-phase-1-직접-선택) 정합.

### 11.6.1 사용자 직접 선택 (Phase 1)

| 옵션 | 의미 | 적용 |
|---|---|---|
| `novice` ("초보") | 초보 사용자 / 학습 초기 | ChatService PromptComposer "어려운 용어 풀어 설명, 비유" 분기 |
| `intermediate` ("중급") | 기본 개념 익숙 | "핵심만 간결, 코드/수식 자유" 분기 |
| `advanced` ("고급") | 전문가 | "세부 기술, 한계, trade-off 명시" 분기 |
| `null` ("미설정") | 디폴트 | 분기 없음 (균형 톤) |

### 11.6.2 자동 추정 (R3-B, Phase 2)

[§06 §6.7.1](./06_architecture.md#671-phase-2-추가-모듈) UserLevelEstimator 도입. 메타 학습 기반:
- 사용자가 본 페이지 난이도 추정 (페이지 텍스트 복잡도 분석)
- 사용자 노트의 어휘 수준
- AI 대화에서 사용자 질문 패턴

Phase 1 시점: mock (회귀 셋 통과만, 실제 학습 로직 X).

## 11.7 시나리오별 워크스페이스 활용 ([§02](./02_personas_scenarios.md) 인용)

| 페르소나 | 워크스페이스 예시 | 핵심 활용 |
|---|---|---|
| P1 학술 | "📚 암 면역치료" / "🔬 단백질 구조" | 같은 학술 도메인 다중 워크스페이스 (서로 다른 연구 주제 격리) |
| P2 PM | "🎯 경쟁사 분석 Q1" / "🎯 신기능 리서치" | 시점별 분석 격리 |
| P3 학습 | "💻 Rust 학습" / "💻 GraphQL" / "🎨 디자인 패턴" | 학습 영역별 격리 + level_preference="novice" |
| P4 일반 | "🌍 일반 리서치" / "🛒 쇼핑 비교" | 도메인 분리 |

권장 사용 패턴: **3~10 워크스페이스** (너무 많으면 사이드바 스크롤 + 전환 오버헤드, 너무 적으면 격리 효과 약함).

## 11.8 정량 임계 (M6 종료)

| 지표 | 임계 | 측정 |
|---|---|---|
| 워크스페이스 전환 시간 | < 1초 (10 탭 기준) | M6 종료 stopwatch 측정 |
| 워크스페이스별 격리 (회귀 셋 S1-C5) | 100% (다른 워크스페이스 retrieval 0) | sqlite-vec `partition key` (M3 spike — space) 검증 |
| 마지막 1개 삭제 시 자동 재생성 | 100% | 단위 테스트 |

[§18 평가](./18_evaluation.md) 시나리오 1 회귀 셋 S1-C5 (워크스페이스 격리) 통과 필수.

## 11.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §3 (워크스페이스 메타포) + §10 (Phase 분할 격리) + §11 (시나리오) + §17 P2-7 (preset 아이콘) + R3-A (사용자 수준)
- [§04 §4.3.1 Workspace](./04_data_model.md#431-workspace)
- [§05 §5.4.4 / §5.4.5 전환·삭제 라이프사이클](./05_crud_matrix.md#544-workspace-전환)
- [§06 §6.5 부팅 / §6.7.1 Phase 2 WorkspacePartitionManager](./06_architecture.md)
- [§07 §7.4.1 WorkspaceSidebar UI](./07_ui_layout.md#741-workspacesidebar-m6) + [§7.7.2 컬러 12종](./07_ui_layout.md#772-워크스페이스-강조-컬러-12종-phase-1-박힘)
- [§10 §10.4 PromptComposer 사용자 수준](./10_ai_chat.md#104-promptcomposer-system-prompt-분기)
- Electron 공식 문서: [session.fromPartition](https://www.electronjs.org/docs/latest/api/session)

본 §11 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 11.10 변경 이력

- 2026-05-16 (PR b7): stub → 본문 작성. 격리 메타포 + Phase 1/2 격리 수준 (메타 vs Electron Partition) + 전환 UX 4 step + 전환 비용 분석 (< 1초) + abort 정책 3종 + "📥 기본" 자동 생성 path 2종 + CRUD 5 동작 + 마지막 워크스페이스 보호 + 사용자 수준 4 분기 (Phase 1 직접 / Phase 2 자동) + 페르소나별 활용 패턴 + 정량 임계 3종.
- 2026-05-16 (PR b7.1): codex·evaluator 핫픽스. Electron Session 변수명 (partition → wsSession) + addChildView 수명주기 명시 + clearStorageData 다층 storage 정리. abort 함수명 (M3/M4/M5 신규) 시제 명시. §11.5.6 Phase 1 JSON Import/Export 안전망 신규 (Notion·Markdown Export 는 Phase 3 유지).
- 2026-05-21 (v0.4.1 발행, Sprint 016 M4 T20 + M5 T24): §11.11 Highlights 신설 (KI-026 옵션 B — codex 사전 협의 권고 정합 `§11.5` 가 Workspace CRUD 점유로 § 충돌 회피, `§11.11` 으로 박음). G-013 1단계 옵션 A (in-memory HighlightStore + W3C Range serialize/deserialize) 산출물 보존. Phase 2 옵션 B (SQLite swap + 마이그레이션) 는 Sprint 017 위임.
- 2026-05-29 (v0.5.0 발행, Sprint 018 M4 T10): §11.5.6 Export 상태 정정 (JSON/Markdown ✅ 구현 / Notion 📝 설계 spec 완료 구현 Sprint 020 위임) + §11.12 **SharedWorkspaceFormat 신규 소절** (T21 설계 spike, 구현 Sprint 021). codex 019e718f scope 협의 (drift 정정, 구현 선반영 X).

## 11.11 Highlights (Sprint 016 M4 T20 + M5 T24 v0.4.1)

> Sprint 016 contract `§T20 NoteHighlight DOM anchor` 산출물 SSOT. KI-026 정정 (옵션 B — `§11.11` 으로 박음).

### 11.11.1 책임

- 노트 선택 영역을 **페이지 재방문 시 고정 위치에 복원** 가능한 anchor 메타데이터 보존
- [§04 §4.3.4 Note](./04_data_model.md#434-note) 확장 — Highlight 는 별도 record (1:N — 한 노트가 여러 highlight 가능)
- DOM W3C Range API 기반 (외부 dependency 0 — Rangy 비채택, codex 사전 협의 정합)

### 11.11.2 Anchor schema (pure W3C Range serialize)

| 필드 | 타입 | 비고 |
|---|---|---|
| `rootSelector` | `string` | root element 식별 (예: `'body'`, `'main#content'`) — metadata 보존만, deserialize 는 root: Element 직접 받음 |
| `startPath` | `number[]` | root.childNodes 기준 자식 인덱스 배열 (element-only `children` 아님) |
| `endPath` | `number[]` | 동일 |
| `startOffset` | `number` | start text node 내부 character offset (UTF-16 code unit) |
| `endOffset` | `number` | 동일 |
| `selectedText` | `string` | range.toString() — drift 시 정합 검증 |
| `prefix` | `string` | 좌측 컨텍스트 — Array.from 기준 최대 32 chars (surrogate pair 안전) |
| `suffix` | `string` | 우측 컨텍스트 — Array.from 기준 최대 32 chars |
| `contentHash` | `string` | root.textContent normalized SHA-256 hex (drift confidence 판단) |
| `contextHash` | `string` | prefix + selectedText + suffix SHA-256 hex (drift fuzzy 우선순위) |

### 11.11.3 HighlightRecord (Phase 1 in-memory store)

| 필드 | 타입 | 비고 |
|---|---|---|
| `id` | `string` | randomUUID (noteId 1:1 강제 X — 한 노트 여러 highlight) |
| `noteId` | `string` | 연결된 노트 id (필수) |
| `pageId` | `string \| null` | pages 테이블 FK 후보. PDF 등 pageId 미발급 시 null |
| `url` | `string` | drift fallback 시 페이지 식별 |
| `contentHash` | `string` | anchor 시점 root.textContent 해시 — listByPage 필터 |
| `anchor` | `HighlightAnchor` | W3C Range serialize 결과 (§11.11.2) |
| `workspaceId` | `string` | 워크스페이스 격리 강제 — listByPage 의 필수 필터 |
| `createdAt` | `number` | epoch ms |

### 11.11.4 deserialize 우선순위

1. **childNodes path fast path** — contentHash 일치 시 startPath/endPath 따라가서 Range 박음. selectedText 정합 검증 후 반환.
2. **prefix/suffix fuzzy** — root.textContent 안에서 `prefix + selectedText + suffix` 정확 매칭. ambiguous (복수 매칭) 시 null.
3. **단일 match locateUnique** — prefix/suffix 둘 다 빈 경우 selectedText 단독 매칭 + 유일성 검증.
4. **fallback 모두 실패** — `{ range: null, strategy: 'failed' }` 반환. 호출자 (renderer overlay) 는 toast 안내 권고.

### 11.11.5 미지원 (Phase 3 R&D 잔존 — KI-023~025)

- **iframe / Shadow DOM cross-boundary range** — root.contains() false 시 명시 throw (KI-024 후속 — graceful fallback + toast)
- **PDF viewer 내부 selection** — Chromium 내장 PDF plugin 별도 path 필요 (KI-023 후속 — Phase 3 R&D)
- **contentHash 미일치 시 path 폐기 보수성** — confidence score 노출 + Phase 3 후속 R&D (KI-025 — codex NB-1/3/5 흡수)

### 11.11.6 Phase 별 구현

| Phase | 구현 | 상태 |
|---|---|---|
| Phase 1 (Sprint 016 M4 T20) | in-memory HighlightStore (1:N noteId→highlight, byId Map) | **완료** (PR #215 머지 `1082990`) |
| Phase 2 (Sprint 017 옵션 B) | SQLite highlights 테이블 + V4→V5 마이그레이션 (G-014 dry-run + 자동 백업) | 위임 |
| Phase 2 (Sprint 017 옵션 B) | renderer overlay UI (`src/renderer/src/note/NoteHighlight.tsx` + WebContentsView selection 캡처 + did-finish-load 복원 trigger) — G-013 2단계 | 위임 |
| Phase 3 | iframe / Shadow DOM graceful fallback / PDF viewer 별도 path | R&D |

### 11.11.7 SSOT 인용

- `src/perception/highlightAnchor.ts` — pure serialize/deserialize 모듈
- `src/storage/HighlightStore.ts` — in-memory store
- `tests/unit/perception/highlightAnchor.test.ts` — 21+11 = 32 회귀
- `tests/unit/storage/HighlightStore.test.ts` — 24+11 = 35 회귀
- Sprint 016 M4 T20 (PR #215) — 산출물 4 파일 +1505 / -0
- Sprint 016 M5 T23 (PR #217) — 후속 안전망 22 회귀 추가 (HighlightStore + highlightAnchor edge case)

## 11.12 워크스페이스 공유 — SharedWorkspaceFormat (Sprint 018 T21 설계 spike, 구현 Sprint 021)

> **상태**: 설계 spec 완료 (`.flowset/specs/v05-collab-spike.md`, Sprint 018 T21). **구현 Sprint 021 위임** (G-013 단계별 — 설계 머지 / 구현 별도). 실시간 협업은 Phase 4 (scope 외).

### 11.12.1 공유 ≠ 자기 백업

§11.5.6 JSON Export/Import 는 **자기 백업·복구** (같은 사용자/기기). SharedWorkspaceFormat 은 **타 사용자/기기로 단방향 전달** — 자기 백업엔 없던 위협을 다룬다:

1. **authenticity / tamper-evidence** — 받은 파일이 변조되지 않았는가
2. **untrusted import** — 공유 파일 = 공격자 입력 (압축 폭탄 / 악성 payload / DoS)
3. **노출 메타 프라이버시** — 받는 사람에게 무엇이 보이는가

### 11.12.2 포맷 결정 (설계)

| 항목 | 결정 |
|---|---|
| 파일 | `.fbworkspace` = **gzip(envelope)** 단일 파일 |
| envelope | `{format, formatVersion, producedAt, producer, integrity.payload_sha256, signature?, payload: WorkspaceExportV1(filtered)}` |
| 서명 | **Ed25519 self-signed per-install** (private key = safeStorage/Keychain, G-005). **신원 증명 아님** — TOFU(trust-on-first-use) = tamper-evidence + 발신자 연속성만 (local-first 무PKI 정직 한정) |
| canonical | domain-separated signing object (payloadHash 단독 아님) + downgrade 정책 (signed→unsigned 경고) |
| import | **untrusted deep validator P0** — byte/count/length/depth cap + enum/finite int/FK 무결성, fail-closed. duplicate id reject (정규화 X) |
| 재사용 | 기존 `WorkspaceExportV1` (v06) + `ExportPrivacyGate` filtered cascade (Notion spec §13 정합) |

### 11.12.3 Sprint 021 구현 분해

`.flowset/specs/v05-collab-spike.md` §11 (S021-a~k) — envelope/canonicalization → Ed25519 TOFU 서명 → Export+ExportPrivacyGate → untrusted import validator → import 흐름 → round-trip → AC-1~6. data model forward-compat: `Workspace.shared_id` (§04 §4.4 Phase 3 컬럼).

### 11.12.4 SSOT 인용

- `.flowset/specs/v05-collab-spike.md` (T21 설계 spike, 14 섹션)
- [§13 보안·프라이버시](./13_security_privacy.md) (ExportPrivacyGate / OS Keychain G-005)
- [§16 §16.4.1](./16_roadmap.md) (SharedWorkspaceFormat 컴포넌트 / Sprint 021 매핑)
