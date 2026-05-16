# 07. UI 레이아웃 (UI Layout)

> [← PRD 목차](./README.md)

본 섹션은 Phase 1 종료 시점 (Sprint 015 M6 완료) UI 레이아웃 + 컴포넌트 spec. L2618 UI 스케치 (이전 세션 SSOT)를 base 로, [§01 정체성](./01_overview.md) + [§02 시나리오](./02_personas_scenarios.md) cover 를 만족하는 UI.

## 7.1 메인 윈도우 레이아웃 (L2618 스케치)

```
┌─[FlowBrowser AI]──────────────────────────────────────────────────────┐
│┌─워크스페이스───┐  ┌─Tab1─┐ ┌─Tab2─┐ ┌─Tab3─┐ ┌─+─┐    ┌─[🔍 시간축]─┐│
││📚 신약 리서치  │  │      │ │      │ │      │ └───┘    │ Cmd+K        ││
││🏠 전세집 찾기  │  └──────┘ └──────┘ └──────┘          └──────────────┘│
││💻 GraphQL 학습 │  ┌──────────────────────────────────┐ ┌─AI 채팅────┐ │
││+ 새 워크스페이스 │  │                                  │ │ 워크스페이스:││
│└────────────────┘  │                                  │ │📚 신약리서치 ││
│                    │   현재 활성 탭 페이지            │ │              ││
│┌─메모리 통계───┐   │   (WebContentsView)              │ │ User:        ││
││ 178건 인덱싱   │   │                                  │ │ 이번 주 본    ││
││ 마지막 12분    │   │                                  │ │ Phase 3 임상││
││ 노트 23개      │   │                                  │ │ 결과들 비교? ││
││ +AI 메모 17개  │   │                                  │ │              ││
│└────────────────┘  │                                  │ │ AI:          ││
│                    └──────────────────────────────────┘ │ 4건 발견 →   ││
│                                                          │ ① BioGen ... ││
│                                                          │ ② Pfizer ... ││
└──────────────────────────────────────────────────────────└──────────────┘
```

### 7.1.1 영역 분할

| 영역 | 위치 | 크기 (기본) | 컴포넌트 |
|---|---|---|---|
| **워크스페이스 사이드바** | 좌측 | 200px (고정) | `WorkspaceSidebar` |
| **메모리 통계 패널** | 좌하단 | 200px × 150px | `MemoryStatsPanel` |
| **탭 바** | 상단 좌측 | 가변 | `TabBar` (기존 유지) |
| **시간축 검색바** | 상단 우측 | 240px | `SearchBar` (신규, Cmd+K) |
| **WebContentsView** | 중앙 | 가변 (메인) | (Main 프로세스가 view 직접 add) |
| **AI 채팅 패널** | 우측 | 320px (collapsible) | `ChatPanel` (신규, TranslationPanel 대체) |
| **노트 패널** | 오버레이 (선택 시) | 480px × 360px | `NotePanel` (신규) |
| **설정 / 온보딩** | 라우팅 진입 | 풀스크린 | `SettingsPage` / `OnboardingTour` |

### 7.1.2 반응형 정책

- **최소 윈도우**: 1280 × 720
- **사이드바 접기**: 윈도우 폭 < 1024 시 워크스페이스 사이드바 자동 접힘 (아이콘만 노출)
- **AI 채팅 패널 접기**: 사용자 토글 (`panel:set-open` IPC) — v0.3 우측 패널 동작 재활용
- **메모리 통계 접기**: 워크스페이스 사이드바와 동일 정책

## 7.2 컴포넌트 트리 (Renderer)

```
App.tsx (루트)
├─ Consent (첫 실행 시)
├─ OnboardingTour (consent 후 + onboardingShown=false 시)
├─ Main Layout
│   ├─ TopBar
│   │   ├─ TabBar (기존 유지, M6 PARTIAL — workspace_id 메타)
│   │   └─ SearchBar (NEW, Cmd+K)
│   ├─ LeftSidebar
│   │   ├─ WorkspaceSidebar (NEW)
│   │   └─ MemoryStatsPanel (NEW)
│   ├─ Center
│   │   └─ WebContentsView placeholder (Main 이 직접 view add)
│   └─ RightPanel
│       ├─ ChatPanel (NEW, TranslationPanel DEPRECATE 대체)
│       └─ UrlBar (기존 유지 — 위치는 §7.3 결정)
├─ NotePanel (NEW, 텍스트 선택 컨텍스트 메뉴 트리거 시 오버레이)
└─ SettingsPage (라우팅 진입)
    ├─ GeneralPanel (PARTIAL — translationMode 제거 / 신규 옵션 추가)
    ├─ CodexLoginPanel (기존 유지)
    ├─ DomainPolicyPanel (기존 유지)
    ├─ UsagePanel (기존 유지)
    ├─ WorkspaceSettings (NEW — 사용자 수준 옵션 등)
    └─ ShortcutSettings (NEW — Cmd+K override 등)
```

**폐기 컴포넌트** ([§19 마이그레이션](./19_migration_v03_v04.md), [§06 §6.3.3](./06_architecture.md#633-deprecate-모듈-m2m5-폐기-a1-a)):
- `TranslationPanel` → `ChatPanel`
- `TranslationPopup` → `NotePanel` + 컨텍스트 메뉴 "노트에 추가"
- `DisplayModePanel` → 폐기 (displayMode 자체 폐기)
- `GlossaryPanel` → 폐기 (Glossary → Note 마이그레이션)

## 7.3 UrlBar 위치 결정

Phase 1 시점 UrlBar 위치는 [§07.1 메인 윈도우]에서 명시 부재. M6 시점 결정 (b9 §16 로드맵에서 확정):

| 옵션 | 위치 | 트레이드오프 |
|---|---|---|
| A | 상단 중앙 (탭 바 아래, 활성 탭 URL 표시 + navigate) | 기존 v0.3 패턴, 사용자 익숙. 단 탭 바 + 검색바 + UrlBar 세로 공간 사용 |
| B | 활성 탭 컨테이너 내부 (탭 별 UrlBar) | Arc 패턴, 탭마다 격리. 단 다중 탭 시 시각 복잡 |
| C | Cmd+L 글로벌 단축키 (UrlBar 토글) | 화면 절약. 단 학습 곡선 |

**Phase 1 디폴트: A** (기존 v0.3 유지). 사용자 옵션은 Phase 2+ 결정.

## 7.4 컴포넌트 spec (NEW Phase 1, M5~M6)

### 7.4.1 WorkspaceSidebar (M6)

| 항목 | spec |
|---|---|
| 위치 | 좌측 200px |
| 데이터 | `workspace:list` IPC + 현재 활성 워크스페이스 ID |
| 아이콘 | preset 12종 (📚 💻 🎯 🏠 🔬 ✍️ 🎨 📊 🌍 ⚖️ 💡 🛒) + 사용자 이모지 입력 |
| 인터랙션 | 클릭 → `workspace:switch` / 우클릭 → 컨텍스트 메뉴 (rename / delete) / "+ 새 워크스페이스" 클릭 → 모달 |
| 첫 실행 | "📥 기본" 워크스페이스 자동 생성 ([§06 §6.5](./06_architecture.md#65-부팅-시퀀스-v04-기준--함수명은-실제-코드-기준)) |

### 7.4.2 MemoryStatsPanel (M6)

| 항목 | spec |
|---|---|
| 위치 | 좌하단 200px × 150px |
| 데이터 | `memory:stats` IPC (워크스페이스별, 실시간 갱신) |
| 표시 항목 | N건 인덱싱 / 마지막 갱신 시간 / 노트 M개 / AI 메모 (대화 히스토리 카운트) |
| 갱신 트리거 | 인덱싱 완료 broadcast / 노트 생성 broadcast / AI 채팅 broadcast |

### 7.4.3 SearchBar (M5)

| 항목 | spec |
|---|---|
| 위치 | 상단 우측 240px |
| 단축키 | `Cmd+K` (디폴트, 사용자 설정 가능 — `shortcut:set-binding`) |
| 인풋 | 자연어 텍스트 (시간 + 의미 결합) |
| 동작 | 인풋 변화 시 debounce 300ms → `search:query` IPC → 결과 리스트 드롭다운 |
| 결과 카드 | `SearchResultCard` — 제목 + URL + 시간 시그널 ("5일 전, 12분 머묾") + 매칭 발췌 (±100자 highlight) |
| 클릭 동작 | 결과 페이지로 navigate + 본문 캐시에서 표시 (재 fetch X) + 해당 visit 의 노트 / AI 대화 패널에 자동 복원 |
| 미리보기 | `PreviewPane` — hover 시 우측 미리보기 (선택, M5 후순위) |

### 7.4.4 ChatPanel (M5, TranslationPanel 대체)

| 항목 | spec |
|---|---|
| 위치 | 우측 320px (collapsible — `panel:set-open` 기존 IPC 재활용) |
| 데이터 | `chat:history` (현 워크스페이스 + 옵션 페이지 컨텍스트) + 현재 워크스페이스 표시 |
| 인풋 | 자연어 질문 + (옵션) 첨부: 활성 페이지 컨텍스트 명시 |
| 동작 | 전송 → `chat:request` IPC → AiChatHistory user INSERT → retrieval + Provider 호출 → assistant 응답 streaming |
| 메시지 표시 | role (user / assistant / system / error) + content (markdown) + chat_meta (표 schema) + retrieved_items 출처 인용 |
| 출처 클릭 | `search:get-content` IPC → 본문 캐시 표시 또는 페이지 navigate |
| 표 schema | Markdown 표 + JSON 메타 (`{rows, columns, cells:[{value, sources}]}`) — 각 셀 우클릭 → 출처 페이지 navigate |
| 재시도 | status='failed' 메시지에 "재시도" 버튼 → `chat:retry` IPC |
| Provider 선택 | 사용자 능동 호출이라 API Key / Codex OAuth 모두 가능 ([§06 §6.5](./06_architecture.md#65-부팅-시퀀스-v04-기준--함수명은-실제-코드-기준)) — 자동 호출 BYOK 디폴트와 구별 |

### 7.4.5 NotePanel (M5)

| 항목 | spec |
|---|---|
| 위치 | 오버레이 480px × 360px (텍스트 선택 후 컨텍스트 메뉴 "노트에 추가" 클릭 시) |
| 데이터 | 선택 텍스트 + 현재 active visit_id + 워크스페이스 ID |
| 인풋 | 노트 body (선택) + 사용자 수동 태그 (선택) |
| 동작 | 저장 → `note:create` IPC → Note INSERT → 비동기 AutoTagger (BYOK, TX 외부) + EmbeddingClient → ai_tags / embedding 갱신 |
| 표시 | 저장 직후 노트 ID + 자동 태그 부여 인디케이터 (비동기 도착) |
| 조회 | 검색 결과 클릭 → 해당 visit 의 노트 자동 복원 (오버레이 또는 ChatPanel 인용) |

### 7.4.6 WorkspaceSettings (M5~M6)

| 항목 | spec |
|---|---|
| 진입 | SettingsPage > WorkspaceSettings 탭 |
| 항목 | 워크스페이스 이름 / 아이콘 변경 / 사용자 수준 선택 ("초보" / "중급" / "고급" / "미설정") / 워크스페이스 삭제 |
| 사용자 수준 (R3-A) | system prompt 분기 (`PromptComposer`) |

### 7.4.7 ShortcutSettings (M5)

| 항목 | spec |
|---|---|
| 진입 | SettingsPage > ShortcutSettings 탭 |
| 항목 | Cmd+K override (디폴트 `Cmd/Ctrl+K`, 사이트 충돌 시 `Cmd+Shift+K` 등 변경 가능) |
| 데이터 | `shortcut:get-bindings` / `shortcut:set-binding` IPC |

## 7.5 인터랙션 흐름 (시나리오 cover 매핑)

| 시나리오 | UI 흐름 |
|---|---|
| **시나리오 1 (학술)** | TabBar 새 탭 → URL navigate → 자동 인덱싱 (UI 노출 X, MemoryStatsPanel 카운트 증가) → SearchBar Cmd+K "지난주 본 IL-2" → SearchResultCard 클릭 → WebContentsView 표시 + NotePanel 복원 + ChatPanel 복원 → ChatPanel "비교 정리" 입력 → 표 schema 응답 + 출처 인용 |
| **시나리오 2 (PM)** | 다중 탭 수집 (자동 인덱싱 + 자동 태깅) → ChatPanel "비교 매트릭스" → JSON 메타 표 응답 + 셀 클릭 → 출처 페이지 |
| **시나리오 3 (학습)** | WorkspaceSettings 사용자 수준 "초보" → 누적 인덱싱 → SearchBar "처음 헷갈렸던 글" → 시간순 + 의미 결과 → ChatPanel "내 자료 기반 설명" (system prompt 초보 분기) |
| **시나리오 4 (재발견)** | SearchBar Cmd+K "6개월 전쯤" → 자연어 시간 파싱 + 임베딩 retrieval → SearchResultCard (dwell 시그널 포함) → 클릭 → 본문 캐시 |

## 7.6 접근성 + 키보드 단축키

| 단축키 | 동작 |
|---|---|
| `Cmd/Ctrl+K` | SearchBar 포커스 (디폴트, override 가능) |
| `Cmd/Ctrl+T` | 새 탭 (기존) |
| `Cmd/Ctrl+W` | 탭 닫기 (기존) |
| `Cmd/Ctrl+L` | UrlBar 포커스 (기존) |
| `Cmd/Ctrl+Shift+T` | 닫은 탭 복원 (기존) |
| `Cmd/Ctrl+Enter` | ChatPanel 메시지 전송 |
| `Esc` | NotePanel 닫기 / SearchBar 결과 드롭다운 닫기 |

[§13 보안·프라이버시](./13_security_privacy.md) Privacy Filter 비밀번호 필드 감지 시 인덱싱 차단 UI 인디케이터 (M4).

## 7.7 디자인 토큰

| 토큰 | 값 (Phase 1 디폴트) | 비고 |
|---|---|---|
| 폰트 | 시스템 기본 (SF Pro / Segoe UI / Roboto) | OS별 자동 |
| 컬러 — 배경 | `#FFFFFF` (라이트) / `#1E1E1E` (다크) | OS 시스템 설정 따름 |
| 컬러 — 워크스페이스 강조 | 사용자 선택 (preset 12종 컬러 매핑) | M6 |
| spacing 단위 | 4px grid | |
| 라운드 | 6px (카드) / 4px (버튼) | |

> 상세 디자인 시스템 spec 은 Phase 2+ 결정 (Phase 1 시점은 기능 우선, 디자인 기본값).

## 7.8 SSOT 인용

- `.flowset/specs/v04-direction.md` §4 (UI 레이아웃) + §17 결정사항 (preset 아이콘 12종 / Cmd+K 사용자 설정 / 비교 매트릭스 schema)
- L2618 (이전 세션 SSOT, UI 스케치 원문)
- [§04 데이터 모델](./04_data_model.md) (entity → UI 매핑)
- [§05 CRUD 매트릭스 §5.3.1](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개) (UI ↔ IPC 매핑)
- [§06 §6.3 컴포넌트 트리](./06_architecture.md#63-컴포넌트-트리-main-모듈-의존-그래프) (renderer 진입점)

본 §07 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 7.9 변경 이력

- 2026-05-16 (PR b5): stub → 본문 작성. 메인 윈도우 레이아웃 8 영역 + 컴포넌트 트리 (Renderer) + 신규 컴포넌트 7종 spec (WorkspaceSidebar / MemoryStatsPanel / SearchBar / ChatPanel / NotePanel / WorkspaceSettings / ShortcutSettings) + 시나리오 ↔ UI 매핑 + 단축키 + 디자인 토큰. UrlBar 위치 옵션 3종 + Phase 1 디폴트 A 결정.
