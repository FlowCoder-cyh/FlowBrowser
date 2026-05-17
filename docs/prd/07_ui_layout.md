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
| **AI 채팅 패널** | 우측 | **420px** (collapsible, 실제 코드 `PANEL_WIDTH = 420` 정합) | `ChatPanel` (신규, TranslationPanel 대체) |
| **노트 패널** | 오버레이 (선택 시) | 480px × 360px | `NotePanel` (신규) |
| **설정 / 온보딩** | 라우팅 진입 | 풀스크린 | `SettingsPage` / `OnboardingTour` |

### 7.1.2 반응형 정책

- **최소 윈도우**: 1280 × 720 (FHD 70% 데스크탑 base)
- **사이드바 접기**: 윈도우 폭 < 1024 시 워크스페이스 사이드바 자동 접힘 (아이콘만 노출, 폭 60px)
- **AI 채팅 패널 접기**: 사용자 토글 (`panel:set-open` IPC) — v0.3 우측 패널 동작 재활용
- **메모리 통계 접기**: 워크스페이스 사이드바와 동일 정책

**작은 화면 (1280×800 노트북 13인치) 우선순위**:
1. 최우선: TabBar / WebContentsView / SearchBar (Cmd+K 활성화 시 드롭다운 overlay)
2. 차우선: AI 채팅 패널 (사용자 토글로 접기 가능)
3. 후순위: 워크스페이스 사이드바 (자동 60px 축소) / 메모리 통계 (사이드바와 동일)
4. **overlay 우선**: NotePanel / SearchBar 결과 드롭다운 / 컨텍스트 메뉴 — 영역 부족 시 다른 영역 위에 floating

### 7.1.3 WebContentsView bounds 책임 (Main 프로세스)

Renderer 의 "WebContentsView placeholder" 는 시각적 표시일 뿐, 실제 view bounds 는 **Main 프로세스가 계산·setBounds**.

```typescript
// src/main/index.ts (PR b5.1 시점 정합)
const PANEL_WIDTH = 420  // AI 채팅 패널 (우측)
// Phase 1 신규: 워크스페이스 사이드바 좌측 inset
const SIDEBAR_WIDTH = 200  // 윈도우 폭 ≥ 1024 시 / 미만 시 60
const sidebarWidth = bounds.width >= 1024 ? SIDEBAR_WIDTH : 60
const rightInset = panelOpen ? PANEL_WIDTH : 0
view.setBounds({
  x: sidebarWidth,
  y: TOP_BAR_HEIGHT,
  width: bounds.width - sidebarWidth - rightInset,
  height: bounds.height - TOP_BAR_HEIGHT
})
```

Renderer 는 placeholder 영역의 시각적 frame 만 렌더. 실제 view 는 Main 이 직접 add (M6 WorkspaceService 도입 시 워크스페이스 전환에 따른 bounds 재계산 책임도 Main).

## 7.2 컴포넌트 트리 (Renderer)

```
App.tsx (루트)
├─ Consent (첫 실행 시)
├─ OnboardingTour (consent 후 + onboardingShown=false 시)
├─ Main Layout
│   ├─ TopBar
│   │   ├─ TabBar (기존 유지, M6 PARTIAL — workspace_id 메타)
│   │   ├─ UrlBar (기존 유지, Phase 1 디폴트 위치 = 상단 중앙 / §7.3 옵션 A)
│   │   └─ SearchBar (NEW, Cmd+K — 상단 우측)
│   ├─ LeftSidebar
│   │   ├─ WorkspaceSidebar (NEW)
│   │   └─ MemoryStatsPanel (NEW)
│   ├─ Center
│   │   └─ WebContentsView placeholder (Main 이 직접 view add — bounds 책임 Main, §7.1.3)
│   └─ RightPanel
│       └─ ChatPanel (NEW, TranslationPanel DEPRECATE 대체)
├─ NotePanel (NEW, Electron native context-menu 트리거 시 오버레이 — §7.4.5)
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
- `TranslationPopup` → `NotePanel` + Electron native context-menu "노트에 추가"
- `DisplayModePanel` → 폐기 (UserSetting `translationMode` 옵션 자체 폐기, b4.1 정정 정합)
- `GlossaryPanel` → 폐기 (Glossary → Note 마이그레이션)

## 7.3 UrlBar 위치 결정

Phase 1 시점 UrlBar 위치는 [§07.1 메인 윈도우]에서 명시 부재. M6 시점 결정 (b9 §16 로드맵에서 확정):

| 옵션 | 위치 | 트레이드오프 |
|---|---|---|
| A | 상단 중앙 (탭 바 아래, 활성 탭 URL 표시 + navigate) | 기존 v0.3 패턴, 사용자 익숙. 단 탭 바 + 검색바 + UrlBar 세로 공간 사용 |
| B | 활성 탭 컨테이너 내부 (탭 별 UrlBar) | Arc 패턴, 탭마다 격리. 단 다중 탭 시 시각 복잡 |
| C | Cmd+L 글로벌 단축키 (UrlBar 토글) | 화면 절약. 단 학습 곡선 |

**Phase 1 디폴트: A** (기존 v0.3 유지). 사용자 옵션은 Phase 2+ 결정.

## 7.4 컴포넌트 spec (NEW Phase 1, M5~M6, 8 파일 / 7 UI spec 단위)

> **컴포넌트 카운트 분리** (b5.1 정합):
> - **파일·작업 단위 = 8개** (A1 §E renderer NEW): SearchBar / SearchResultCard / PreviewPane / ChatPanel / NotePanel / WorkspaceSidebar / WorkspaceSettings / MemoryStatsPanel
> - **UI spec 단위 = 7개** (본 §7.4): SearchResultCard·PreviewPane을 SearchBar (§7.4.3) 안에 spec 통합
> - **9번째 spec ShortcutSettings** (§7.4.7): A1 §D SettingsPage.tsx PARTIAL "SearchShortcut 라우팅" 의 별도 컴포넌트 spec — A1 §E 9개로 매트릭스 정정 동반 (PR b5.1)

### 7.4.1 WorkspaceSidebar (M6)

| 항목 | spec |
|---|---|
| 위치 | 좌측 200px (1024 미만 시 60px 자동 축소) |
| 데이터 | `workspace:list` IPC + 현재 활성 워크스페이스 ID |
| 아이콘 | preset 12종 (📚 💻 🎯 🏠 🔬 ✍️ 🎨 📊 🌍 ⚖️ 💡 🛒) + 사용자 이모지 입력. **이미지 업로드 옵션은 Phase 2+** ([§11 워크스페이스](./11_workspace.md) 본문 위임, v04-direction §17 P2-7) |
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
| **단축키 캡처 위치** | **Main 프로세스 글로벌 캡처** (v04-direction §17 P1-10) — WebContentsView 안의 Cmd/Ctrl+K 키 이벤트를 `before-input-event` 리스너로 main 이 먼저 가로채 SearchBar 포커스. 사이트 (Slack/Notion/Linear 등 Cmd+K 사용 사이트) 와 충돌 시 사용자가 ShortcutSettings 에서 `Cmd+Shift+K` 등으로 변경 (§7.4.7) |
| **외부 표준 충돌 인지** | Chrome `Cmd/Ctrl+K` = "Search anywhere on the page", Firefox `Ctrl+K` = 검색바 — 본 시스템이 의도적 override + 사용자 변경 경로 제공 |
| 인풋 | 자연어 텍스트 (시간 + 의미 결합) |
| 동작 | 인풋 변화 시 debounce 300ms → `search:query` IPC → 결과 리스트 드롭다운 |
| 결과 카드 (SearchResultCard) | 제목 + URL + 시간 시그널 ("5일 전, 12분 머묾") + 매칭 발췌 (±100자 highlight). 키보드 네비게이션: `↑/↓` 결과 이동 / `Enter` 선택 / `Esc` 닫기 |
| 상태 | loading (debounce 중) / empty (결과 0건) / error (검색 실패) / ok 4종 명시 |
| 클릭 동작 | 결과 페이지로 navigate + 본문 캐시에서 표시 (재 fetch X) + 해당 visit 의 노트 / AI 대화 패널에 자동 복원 |
| 미리보기 (PreviewPane) | hover 시 우측 미리보기 (선택, M5 후순위 — Phase 1 base 9 컴포넌트에 포함되지만 인터랙션 깊어 후순위 분리) |

### 7.4.4 ChatPanel (M5, TranslationPanel 대체)

| 항목 | spec |
|---|---|
| 위치 | 우측 **420px** (collapsible — 실제 코드 `PANEL_WIDTH = 420` 정합, `panel:set-open` 기존 IPC 재활용) |
| 데이터 | `chat:history` (현 워크스페이스 + 옵션 페이지 컨텍스트) + 현재 워크스페이스 표시 |
| 인풋 | 자연어 질문 + (옵션) 첨부: 활성 페이지 컨텍스트 명시 |
| 동작 | 전송 → `chat:request` IPC → AiChatHistory user INSERT → retrieval + Provider 호출 → assistant 응답 streaming |
| 메시지 표시 | role (user / assistant / system / error) + content (markdown) + chat_meta (표 schema) + retrieved_items 출처 인용 |
| 출처 클릭 | `search:get-content` IPC → 본문 캐시 표시 또는 페이지 navigate |
| **표 schema** | Markdown 표 + JSON 메타. 정확 형식 (v04-direction §17 P0-4 + §04 `AiChatHistory.chat_meta` 컬럼 정합): `{rows: string[], columns: string[], cells: [{value: string, sources: [{page_id, visit_id?}]}]}`. 각 셀 우클릭 → 출처 페이지 navigate. 표 cell wrapping / source badge / hover state 는 §7.7 table token 정의 |
| **재시도 동작 상세** | `status='failed'` 메시지에 "재시도" 버튼 → `chat:retry` IPC (payload: `{failed_assistant_message_id, retry_strategy: 'reuse_prompt' \| 'edit_prompt'}`). 'reuse_prompt' 디폴트 (기존 user prompt 재사용, 새 assistant row UPDATE — `status: pending → ok/failed`) |
| Provider 선택 | 사용자 능동 호출이라 API Key / Codex OAuth 모두 가능 ([§06 §6.5](./06_architecture.md#65-부팅-시퀀스-v04-기준--함수명은-실제-코드-기준)) — 자동 호출 BYOK 디폴트와 구별 |
| 키보드 | `Cmd/Ctrl+Enter` 전송 / `Esc` 포커스 해제 |

### 7.4.5 NotePanel (M5)

| 항목 | spec |
|---|---|
| 위치 | 오버레이 480px × 360px (텍스트 선택 후 컨텍스트 메뉴 "노트에 추가" 클릭 시) |
| **트리거 메커니즘** | **Electron native context-menu** (`webContents.on('context-menu')` + `Menu.buildFromTemplate`). Renderer overlay event 아님 (Electron 30+ 권장 패턴). 메뉴 항목 "노트에 추가" 추가는 v0.3 `TranslationPopup` 트리거 위치 재활용 (`src/main/index.ts:466` context-menu handler 확장). v0.3 기존 항목 (번역/설명/요약/복사) 중 "노트에 추가" 신규 + 폐기 항목 정리 |
| 데이터 | 선택 텍스트 + 현재 active visit_id + 워크스페이스 ID. **active visit_id 보장**: TabManager 활성 탭의 최신 Visit 레코드 ID 를 IPC payload 에 포함 (M4 IndexingService 가 Visit 생성 후 TabManager 와 binding) |
| 인풋 | 노트 body (선택) + 사용자 수동 태그 (선택) |
| 동작 | 저장 → `note:create` IPC → Note INSERT (단일 TX) → 비동기 AutoTagger (BYOK, TX 외부) + EmbeddingClient → ai_tags / embedding 갱신 |
| 표시 | 저장 직후 노트 ID + 자동 태그 부여 인디케이터 (비동기 도착) |
| 조회 | 검색 결과 클릭 → 해당 visit 의 노트 자동 복원 (오버레이 또는 ChatPanel 인용) |
| 상태 | saving / saved / enriching (AutoTagger 진행) / failed 4종 명시 |

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

## 7.7 디자인 토큰 (Phase 1 최소 변수 세트)

### 7.7.1 컬러 (라이트 / 다크 듀얼)

```css
:root[data-theme="light"] {
  --bg: #FFFFFF;
  --surface: #F7F8FA;
  --text: #1A1A1A;
  --muted: #6B7280;
  --border: #E5E7EB;
  --accent: #3B82F6;  /* 브랜드 블루 */
  --focus: #2563EB;
  --error: #DC2626;
  --warning: #D97706;
  --success: #059669;
}
:root[data-theme="dark"] {
  --bg: #1E1E1E;
  --surface: #2A2A2A;
  --text: #E5E5E5;
  --muted: #9CA3AF;
  --border: #3F3F46;
  --accent: #60A5FA;
  --focus: #93C5FD;
  --error: #F87171;
  --warning: #FBBF24;
  --success: #34D399;
}
```

테마 전환: Electron `nativeTheme` + `prefers-color-scheme` 자동 감지 + 사용자 settings override (M5 ShortcutSettings 옆 ThemeSettings 추가 검토).

### 7.7.2 워크스페이스 강조 컬러 12종 (Phase 1 박힘)

preset 아이콘 12종에 1:1 매핑되는 컬러:

| 아이콘 | 컬러 (라이트) | 컬러 (다크) | 의미 |
|---|---|---|---|
| 📚 | `#8B5CF6` | `#A78BFA` | 학술·리서치 |
| 💻 | `#3B82F6` | `#60A5FA` | 개발·기술 |
| 🎯 | `#DC2626` | `#F87171` | 목표·PM |
| 🏠 | `#059669` | `#34D399` | 생활 |
| 🔬 | `#0EA5E9` | `#38BDF8` | 실험·과학 |
| ✍️ | `#D97706` | `#FBBF24` | 글쓰기 |
| 🎨 | `#EC4899` | `#F472B6` | 디자인·창작 |
| 📊 | `#0891B2` | `#22D3EE` | 분석·데이터 |
| 🌍 | `#65A30D` | `#A3E635` | 일반·다영역 |
| ⚖️ | `#6B7280` | `#9CA3AF` | 법무·정책 |
| 💡 | `#EAB308` | `#FACC15` | 아이디어 |
| 🛒 | `#DB2777` | `#F472B6` | 쇼핑·비교 |

탭/사이드바/검색 결과/출처 chip 에 1:1 매핑. 사용자 이모지 입력 시 컬러는 시스템 기본 accent.

### 7.7.3 타이포·spacing·radius

| 토큰 | 값 | 비고 |
|---|---|---|
| 폰트 | 시스템 기본 (SF Pro / Segoe UI / Roboto) | OS별 자동 |
| Font size base | 14px | Renderer body |
| spacing 단위 | 4px grid (4/8/12/16/24/32/48) | |
| radius | 6px (카드) / 4px (버튼) / 8px (모달) / 12px (overlay) | |
| z-index | dropdown 1000 / modal 2000 / overlay 3000 / toast 4000 | |
| shadow | `0 1px 2px rgba(0,0,0,0.05)` (카드) / `0 4px 12px rgba(0,0,0,0.15)` (모달) | |

### 7.7.4 Table token (ChatPanel 표 출력 핵심)

420px ChatPanel 안 표 표시 위해 별도 token:

| 토큰 | 값 | 비고 |
|---|---|---|
| Table cell padding | 6px 8px | |
| Table cell max-width | 140px (3 col) / 110px (4 col) / 90px (5+ col) | wrapping 강제 |
| Source badge | `--accent` background + white text + 10px font | 셀 우측 floating |
| Hover state | `--surface` background | |
| Focus state | `2px solid --focus` outline | 키보드 네비게이션 |

### 7.7.5 UI 문자열 정책

- **디폴트 한국어** (G-008): 모든 사용자 노출 텍스트 (버튼 / 메뉴 / aria-label / 에러 메시지)
- **코드 식별자 영어 유지**: 컴포넌트명 / IPC 채널 / 변수명
- 다국어 (영어 외) 는 Phase 2+ i18n 시스템 도입 시 결정
- 시스템 메시지 패턴: `[FlowBrowser] 메시지 내용` (콘솔 로그) / 사용자 알림은 한국어 직접

## 7.8 접근성 (Accessibility, M5~M6)

### 7.8.1 ARIA·role 표기

| 컴포넌트 | role | aria-label (한국어) |
|---|---|---|
| WorkspaceSidebar | `navigation` | "워크스페이스 목록" |
| WorkspaceSidebar 항목 | `button` + aria-current="page" (활성) | "{workspace.name} 워크스페이스" |
| SearchBar | `combobox` + aria-expanded | "시간축·의미 검색" |
| SearchBar 결과 드롭다운 | `listbox` | "검색 결과 N개" |
| ChatPanel | `region` + aria-labelledby | "AI 채팅 패널" |
| ChatPanel assistant 메시지 | `article` | "AI 응답" |
| ChatPanel user 메시지 | `article` | "사용자 질문" |
| NotePanel | `dialog` + aria-modal="true" | "노트 추가" |
| TabBar 탭 | `tab` + aria-selected | "{tab.title} 탭" |
| MemoryStatsPanel | `complementary` | "워크스페이스 메모리 통계" |

### 7.8.2 키보드 네비게이션

- **focus trap**: NotePanel (모달) / SearchBar 드롭다운 — `Esc` 로 닫기 + 트리거 위치로 포커스 복귀
- **roving tabindex**: WorkspaceSidebar 항목 / TabBar 탭 / SearchBar 결과 — 화살표 키 이동 (Tab 키 외부 이동)
- **Esc 우선순위**: 최상위 active layer 닫기 (NotePanel > SearchBar 드롭다운 > ChatPanel 포커스 해제 > 컨텍스트 메뉴)
- **WCAG 2.1 권장**: OS 표준 단축키 (Cmd+, settings) 보존, override X

### 7.8.3 컬러 대비

- WCAG AA 기준 4.5:1 (본문 텍스트) / 3:1 (대형 텍스트)
- §7.7.1 컬러 토큰 모두 라이트/다크 양쪽에서 AA 만족 검증 (M6 시각 QA 회귀 셋)

### 7.8.4 Screen reader 안내

- 인덱싱 진행: `aria-live="polite"` ("페이지 인덱싱 중 / 완료")
- AI 채팅 응답: `aria-live="polite"` (assistant 응답 streaming 마지막 chunk 안내)
- 오류: `aria-live="assertive"`

## 7.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §4 (UI 레이아웃) + §17 결정사항 (preset 아이콘 12종 / Cmd+K 사용자 설정 / 비교 매트릭스 schema)
- L2618 (이전 세션 SSOT, UI 스케치 원문)
- [§04 데이터 모델](./04_data_model.md) (entity → UI 매핑)
- [§05 CRUD 매트릭스 §5.3.1](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-25개) (UI ↔ IPC 매핑)
- [§06 §6.3 컴포넌트 트리](./06_architecture.md#63-컴포넌트-트리-main-모듈-의존-그래프) (renderer 진입점)

본 §07 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 7.9 변경 이력

- 2026-05-16 (PR b5): stub → 본문 작성. 메인 윈도우 레이아웃 8 영역 + 컴포넌트 트리 (Renderer) + 신규 컴포넌트 7종 spec (WorkspaceSidebar / MemoryStatsPanel / SearchBar / ChatPanel / NotePanel / WorkspaceSettings / ShortcutSettings) + 시나리오 ↔ UI 매핑 + 단축키 + 디자인 토큰. UrlBar 위치 옵션 3종 + Phase 1 디폴트 A 결정.
- 2026-05-16 (PR b5.1): codex 15건 + evaluator 1+3건 핫픽스. (1) UrlBar 위치 자기모순 해소 (TopBar 이동). (2) ChatPanel 320 → 420px 정정 (실제 코드 PANEL_WIDTH). (3) Cmd+K main-process capture 명시 + Chrome/Firefox 표준 충돌 명시. (4) WebContentsView bounds 책임 Main 명시 (§7.1.3 신규). (5) NotePanel Electron native context-menu 명시 + active visit_id 보장 메커니즘. (6) displayMode → translationMode 정정 (b4.1 학습 회귀 해소). (7) chat:retry 상세 (메시지 ID + reuse_prompt 전략). (8) ShortcutSettings A1 §E 9개 정정 (별도 컴포넌트 spec). (9) 컴포넌트 카운트 분리 명시 (파일 8 / UI spec 7). (10) §7.7 디자인 토큰 확장 (라이트/다크 듀얼 9 컬러 + 워크스페이스 컬러 12종 박힘 + Table token + UI 한국어 문자열 정책). (11) §7.8 접근성 신규 (ARIA·role 9 + 키보드 네비게이션 + WCAG AA + screen reader). (12) 작은 화면 우선순위 4 레벨 정책. (13) PreviewPane M5 후순위 명시. (14) UI Settings 키보드 단축키. (15) 워크스페이스 이미지 업로드 Phase 2+ cross-link.
