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
| 페이지 메모리 | Page.workspace_id NOT NULL + sqlite-vec partition_key | M3 IndexedPageStore |
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
| 캐시 | `partition.clearCache()` 단위 관리 | 동상 |
| Service Worker | partition 단위 등록 | 동상 |

```typescript
// Phase 2 WorkspacePartitionManager 예시
import { session, WebContentsView } from 'electron'
const ws_partition = session.fromPartition(`persist:ws-${workspace_id}`)
const view = new WebContentsView({ webPreferences: { session: ws_partition } })
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
Main: 현 워크스페이스 진행 중 작업 abort
   ├─ IndexingService.abort (현 워크스페이스 인덱싱 큐)
   ├─ EmbeddingQueue.clear (현 워크스페이스 임베딩 큐)
   └─ ChatService.abortStreaming (active streaming)
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

[§05 §5.3.1 workspace 5 IPC](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개) 정합.

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
| 워크스페이스별 격리 (회귀 셋 S1-C5) | 100% (다른 워크스페이스 retrieval 0) | sqlite-vec partition_key 검증 |
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
