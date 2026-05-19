# FlowBrowser AI — 사용자 가이드

본 문서는 FlowBrowser AI를 처음 빌드/실행하여 직접 테스트하는 사용자를 위한 단계별 가이드.

> 2026-05-16 방향 전환: 페이지 번역 (v0.3) 폐기 → AI 콘텐츠 메모리 + 워크스페이스 브라우저 (v0.4). 본 가이드는 v0.4 기준. 백그라운드 장시간 번역 (논문/PDF) 만 유지 (Sprint 016 M4 예정).

## 목차

1. [빌드 / 실행](#1-빌드--실행)
2. [Provider 등록](#2-provider-등록)
3. [기본 사용법](#3-기본-사용법)
4. [워크스페이스](#4-워크스페이스)
5. [검색 / AI 채팅 / 노트](#5-검색--ai-채팅--노트)
6. [설정](#6-설정)
7. [FAQ](#7-faq)
8. [알려진 한계](#8-알려진-한계)

---

## 1. 빌드 / 실행

### 사전 조건

- Node.js ≥ 20 (개발 검증: v24)
- npm ≥ 10
- Git
- 지원 OS: Windows 10+, macOS 13+ (Ventura) — macOS sqlite-vec native 빌드는 Sprint 016 M0 T01 PoC 진행 중 (`KI-001`)

### 의존성 설치

```
npm install
```

### 개발 모드 (Hot Reload)

```
npm run dev
```

코드 변경 시 자동 재시작.

### Production 빌드 + 실행

```
npm run build
npm start
```

빌드 산출물:
- `out/main/index.js` — Electron main process
- `out/preload/index.js` — preload bridge
- `out/renderer/index.html` + assets — React UI

---

## 2. Provider 등록

AI 채팅 / 자동 태깅 / 임베딩 기능을 사용하려면 AI Provider 등록이 필요합니다. 두 가지 방식 중 선택:

### 방식 A: Codex Login (Experimental)

**ChatGPT 구독 계정으로 로그인**하면 별도 API Key 비용 없이 채팅 기능 사용 가능.

⚠️ **주의**: OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드. OpenAI가 차단할 가능성이 있으며, 자동 인덱싱·임베딩 등 백그라운드 호출은 BYOK (OpenAI API Key) 만 허용 (G-003 강화 — 사용자 명시 동의 없이 ChatGPT 한도 묵시 소진 차단).

**절차**:
1. 앱 실행 → 우상단 **설정** 버튼 클릭
2. **Codex Login (Experimental)** 섹션 → **Codex Login 시작** 버튼
3. 화면에 표시된 **user_code** (예: `ABCD-EFGH`) 확인
4. 표시된 URL (`https://auth.openai.com/codex/device`)을 브라우저에서 열고 ChatGPT 로그인
5. user_code 입력 → 인증 완료
6. 앱은 자동으로 토큰을 받아 OS Keychain에 안전 저장 (15분 내 완료)

**보안**:
- Device code는 피싱 표적이 되기 쉬우니 절대 다른 사람에게 공유 금지
- access_token은 만료 60초 이내 자동 refresh
- 토큰은 OS Keychain (Electron safeStorage)에 위임 저장 — 앱이 평문 보관 안 함
- 로그아웃 시 토큰 즉시 제거

### 방식 B: OpenAI API Key (BYOK)

**OpenAI 콘솔에서 발급한 API Key를 직접 등록**. 사용량 별 청구. 자동 인덱싱·임베딩·태깅에 권장.

**절차**:
1. https://platform.openai.com/api-keys 에서 API Key 발급 (sk-... 형식)
2. 앱 실행 → 우상단 **설정** 버튼 클릭
3. **AI Provider** 섹션 → API Key 입력 → **저장 + 검증**
4. 자동 검증 성공 메시지 확인

**보안**: OS Keychain 위임 저장. 평문 미보관.

---

## 3. 기본 사용법

### URL 이동

상단 URL Bar에 URL 입력 후 Enter. `Ctrl+L` 로 URL Bar 포커스. 페이지 방문 시 IndexingGate 평가 후 통과한 페이지는 자동 인덱싱 (Privacy 차단 도메인 / password 필드 / 사용자 차단 외).

추천 시작 URL:
- https://en.wikipedia.org/wiki/Artificial_intelligence — 인덱싱 + 검색 시연
- https://arxiv.org/abs/1706.03762 — 학술 시나리오
- https://github.com — SPA 인덱싱 (KI-020 — did-navigate-in-page hook 후속)

### 다중 탭

- **새 탭**: `Ctrl+T` 또는 TabBar `+` 버튼
- **탭 닫기**: `Ctrl+W` 또는 X 버튼
- **다음/이전 탭**: `Ctrl+Tab` / `Ctrl+Shift+Tab`
- **닫은 탭 복원**: `Ctrl+Shift+T`
- **드래그**로 순서 변경
- **우클릭 컨텍스트 메뉴**: 닫기 / 다른 탭 닫기 / 오른쪽 탭 모두 닫기 (핀 탭 자동 보존) / 복제 / 핀 / 색상 변경 (7색)
- **hover 미리보기**: 600ms 호버 시 활성 탭 캡처 썸네일 + URL/title

탭 상태(URL/색상/핀/순서/`workspace_id`)는 앱 재시작 후 자동 복원. 워크스페이스 전환 시 탭 그룹 stash/restore — 다른 워크스페이스 탭은 시각적으로 숨김.

### 자동 인덱싱 (PRD §8)

`did-finish-load` 시점에 자동 동작:
1. **IndexingGate 평가** — Privacy Filter 5단계와 별도. 차단 도메인 13종 + icloud + naver mail path + password 필드 + 사용자 `privacyExclusions`
2. **본문 추출** — ParagraphExtractor.executeJavaScript (CSS-like 텍스트 / style/script 자동 제외)
3. **recordVisit** — 단일 TX (Page UPSERT + Visit INSERT + content_hash 매칭)
4. **EmbeddingQueue 등록** — 활성 탭 priority 10 / 백그라운드 1
5. **broadcast** — `memory:stats-invalidated` 발송 (MemoryStatsPanel 자동 갱신)

http/https 외 scheme (file:/blob:/javascript:/data:/chrome-error:/about:) 일괄 skip.

---

## 4. 워크스페이스

프로젝트별 메모리 / 탭 / AI / 노트를 격리하는 v0.4 핵심 기능. 좌측 사이드바 (`240px` 점유) 로 진입.

### 워크스페이스 종류

- **기본 워크스페이스**: fresh install 시 자동 생성 (default workspace, 이름·아이콘 사용자 변경 가능)
- **신규 생성 시 12종 아이콘 preset** (`src/renderer/src/workspace/presets.ts`):
  📚 / 💻 / 🎯 / 🏠 / 🔬 / ✍️ / 🎨 / 📊 / 🌍 / ⚖️ / 💡 / 🛒
- preset 외 1 grapheme 이모지 사용자 직접 입력 가능 (Intl.Segmenter 검증 + main `validateWorkspaceIcon` SSOT)
- 이름은 사용자 자유 입력

### 워크스페이스 전환

좌측 사이드바에서 클릭. 전환 시:
- TabManager 가 활성 ws filter 적용 (다른 ws 탭은 숨김, 영속 데이터는 유지)
- 활성 BrowserView refresh
- 마지막 활성 탭 stash/restore (`activeTabByWorkspace` Map)
- `workspace:switched` broadcast — TabBar / WorkspaceSidebar 상태 동기화

### 메모리 통계 패널

워크스페이스별 통계 표시:
- 페이지 카운트 / 방문 카운트 / 노트 카운트 / 채팅 메시지 카운트 / 마지막 인덱싱 시각

자동 갱신: `memory:stats-invalidated` 구독 (인덱싱 / 노트 / AI 채팅 INSERT 시 broadcast).

### Phase 2 cookies/storage partition (Sprint 016 M3 예정)

`session.fromPartition('persist:ws-<uuid>')` 로 워크스페이스 단위 cookies / localStorage / IndexedDB 완전 격리. 사용자 명시 동의 후 활성화.

---

## 5. 검색 / AI 채팅 / 노트

### 5.1 검색 (`Ctrl+K`)

검색바 진입. 자연어 시간 파싱 + 의미 검색:

- **자연어 시간**: "지난주", "이번달 화요일", "어제" — TimeRangeParser 가 시간 범위 산출
- **의미 검색**: 입력 문구 → OpenAI embedding (`text-embedding-3-small`) → sqlite-vec cosine similarity top-10
- **결과 카드**: 페이지 / 노트 통합. 시간 시그널 (방문 시각 + 상대 시간) + 매칭 발췌 + 워크스페이스 컬러
- **본문 fetch**: 검색 결과 클릭 시 IndexedPageStoreSqlite.getPage(pageId) 로 본문 표시

> 정량 임계 (Sprint 016 M0 T06 perf bench 측정 예정): 검색 응답 < 200ms (top-10 표시까지), top-10 hit rate ≥ 80%

### 5.2 AI 채팅

우측 채팅 패널. 현재 wiring 상태 (Sprint 015 M5-6 시점):

1. **호출자 책임 retrieval** — `ChatService.chat()` 의 `retrievedItems?: RetrievedItem[]` 옵션은 Renderer 측이 채워 전달. SearchService.search 자동 호출 wiring 은 미박힘 — 호출자 (ChatPanel) 가 search 결과를 명시 주입 시에만 retrieval 활성.
2. **PromptComposer** — 시스템 프롬프트 + retrieved_items (호출자 주입분) + 사용자 질문 조립
3. **ChatService.chat()** — Provider 호출 (BYOK 디폴트, allowedProviders=['openai'])
4. **chat_meta** — `cells.sources` 에 `page_id` / `note_id` / 인용 표기 (PRD §10.8 — AI 응답 출처 정확도 ≥ 90% 목표, KI-019 측정 예정)
5. **AiChatHistoryStore** — 메시지 영속

> 자동 retrieval wiring (`ChatPanel` 진입 시 SearchService 자동 호출 + retrievedItems 자동 채움) 은 Sprint 016 M_ 또는 후속 hotfix 예정. 현재는 호출자 명시 주입 path 만 작동.

### 5.3 노트

페이지에서 텍스트 선택 → 우클릭 → "노트로 저장" UI (현재 `ShortcutBinding` 은 `searchBar.focus` 1종만 박힘 — `Ctrl+K`. 노트 전용 단축키는 Sprint 016 M4 NoteService UI 박힘 시점 동반 예정). NoteService 가:
1. NoteStore.create — Note + 워크스페이스 연결
2. EmbeddingQueue.enqueue — 자동 임베딩 (검색 대상 포함)
3. broadcast — MemoryStatsPanel 갱신

> AutoTagger.tagNote (자동 태깅) 는 KI-005 status `open` — Sprint 016 M4 T21 예정. 현재는 사용자 수동 태깅.

---

## 6. 설정

설정 페이지 (우상단 ⚙️ 또는 단축키)에서:

| 섹션 | 기능 |
|---|---|
| **Codex Login** | Codex OAuth 로그인 / 로그아웃 |
| **OpenAI API Key** | BYOK 등록 / 삭제 / 검증 |
| **일반 설정** | 기본 Provider / 기본 워크스페이스 / Privacy Filter / 자동 인덱싱 토글 |
| **Privacy Exclusions** | `privacyExclusions[]` 신규 — type=block (자동 인덱싱 차단) / type=allow (디폴트 차단 우회) |
| **도메인 정책** | 외부 호출 블랙/화이트리스트 (Privacy Filter 와 별도) |
| **워크스페이스** | 생성 / 이름·아이콘·색상 변경 / 삭제 |
| **메모리** | 워크스페이스별 통계 + 페이지 본문 캐시 stats / clear |
| **단축키** | ShortcutBinding 변경 (충돌 검증) |

> 폐기된 설정 (페이지 캐시 TTL / displayMode / 용어집) 은 v0.4 에서 제거 또는 격하.

---

## 7. FAQ

**Q. 자동 인덱싱이 안 돼요.**
A. (1) IndexingGate 차단 도메인 (gmail.com / banking / icloud / naver mail path 등) 확인. (2) password 필드 감지 시 자동 차단. (3) `privacyExclusions[type=block]` 사용자 설정 확인. (4) sqlite-vec native 빌드 실패 시 인프라 비활성 (`KI-001` macOS PoC 후속).

**Q. 워크스페이스 전환했는데 탭이 그대로예요.**
A. Sprint 016 M0 T03 stash/restore wiring 박힘. fresh install 직후 V1→V2 마이그레이션 시점에 workspace_id null → 활성 ws backfill. 그래도 안 되면 앱 재시작 후 다시 시도.

**Q. Codex Login이 실패하거나 차단됐어요.**
A. OpenAI가 비공식 클라이언트를 차단할 가능성을 사전 고지한 상태입니다. 차단 시 OpenAI API Key 모드로 자동 폴백되므로 BYOK 등록을 권장합니다.

**Q. 토큰이 만료되었다고 나와요.**
A. access_token은 만료 60초 이내 자동 refresh됩니다. refresh도 실패하면 다시 로그인 필요. 설정 → Codex Login 시작 재실행.

**Q. AI 채팅 응답에 출처가 없거나 부정확해요.**
A. PRD §10.8 — AI 응답 출처 정확도 ≥ 90% 목표 (`KI-019` Sprint 016 M0 T06 측정 예정). 활성 워크스페이스에 인덱싱된 페이지가 적으면 retrieval 결과가 부족. 노트 추가 또는 더 많은 페이지 방문 후 재시도.

**Q. 비밀번호 / 카드 번호 페이지에서 동작이 안 돼요.**
A. 의도된 안전 정책(G-004). Privacy Filter 토글로도 우회 불가. IndexingGate 가 password 필드 감지 시 차단.

**Q. 데이터는 어디에 저장되나요?**
A. 모두 사용자 로컬 디스크의 Electron `userData` 폴더:
- Windows: `%APPDATA%/flowbrowser-ai/`
- macOS: `~/Library/Application Support/flowbrowser-ai/`

주요 파일: `credentials.json` (암호화) / `user-setting.json` / `tabs.json` (V2 schema, workspace_id 포함) / `thumbnails.json` / `shortcut.json` / `flowbrowser.db` (v0.4 SQLite 본체 — Page / Visit / Note / AiChatHistory / Tag / EmbeddingQueue / Workspace) / `page-results.json` (v0.3 PageResultStore 잔여, KI-002 closed 예정) / `translation-cache.json` (v0.3 TranslationCache, Sprint 016 M2 어댑터 제거 후 폐기 예정).

**Q. v0.3 데이터 (캐시 / 페이지 결과) 는 어떻게 마이그레이션됐나요?**
A. PRD §19 — 5단계 마이그레이션 + 자동 백업 `<userDataDir>/backup/v03/<ISO_ts>/`. G-014 적용. v0.3 `page-results.json` / `translation-cache.json` 등은 백업 후 v0.4 schema 로 이전 또는 폐기 (실제 파일명은 `defaultPageResultPath` / `defaultTranslationCachePath` 정합).

---

## 8. 알려진 한계

본 가이드 작성 시점 (2026-05-20) 기준 잔여 Known Issues **17건** (등록 누적 20건, closed 3건 — KI-007 / KI-010 / KI-017 모두 Sprint 016 M0 T03·T05 시점). 전체 본문은 [`.flowset/known-issues.md`](../.flowset/known-issues.md).

| KI | Severity | 상태 | 내용 | 예정 |
|---|---|---|---|---|
| KI-001 | MEDIUM | in-progress | sqlite-vec macOS native 빌드 (1차 arm64 PoC SUCCESS, 잔여 macos-intel + windows + Electron 39 ABI rebuild) | Sprint 016 M0 T01 |
| KI-002 | LOW | open | PageCachePanel PARTIAL — v0.3 어댑터 의존 잔존 | Sprint 016 M2 T12 (PageResultStore 어댑터 제거 동반) |
| KI-003 | HIGH | open | AutoTagger BYOK provider 검증 wiring | Sprint 016 M0 T05 부분 박힘 + T06 또는 T21 closed 후보 |
| KI-004 | MEDIUM | open | ChatRequest.response_format JSON 강제 API-level 미구현 | Sprint 016 M0 T04 |
| KI-005 | LOW | open | AutoTagger.tagPage(pageId=note.id) page_tags FK 위반 (NoteService autoTagger 통합 자체 차단으로 안전) | Sprint 016 M4 T21 (AutoTagger.tagNote 신규) |
| KI-006 | MEDIUM | open | 워크스페이스 전환 시 인덱싱/임베딩/채팅 abort 미배선 | Sprint 016 M0 T02 |
| KI-008 | LOW | open | Workspace JSON Export/Import 미구현 | Sprint 016 M3 T17 |
| KI-009 | LOW | open | MemoryStatsPanel React 컴포넌트 단위 테스트 0 | Phase 3 종료 후 또는 Sprint 016 |
| KI-011~016 | LOW (6건) | open | 정량 임계 미측정 — MemoryStats < 20ms / 인덱싱 < 500ms / 검색 < 200ms / 워크스페이스 전환 < 1초 / 임베딩 비용 < $3/월 / 저장 < 200MB/만 | Sprint 016 M0 T06 일괄 측정 |
| KI-018 / KI-019 | LOW (2건) | open | 정확도 임계 미측정 — top-10 hit rate ≥ 80% / AI 응답 출처 정확도 ≥ 90% | Sprint 016 M0 T06 (시나리오 30 케이스) |
| KI-020 | LOW | open | SPA `did-navigate-in-page` 자동 인덱싱 누락 (codex PR #176 NB-1 추출) | Sprint 016 M1 (시나리오 2 PM 경쟁) 또는 후속 hotfix |

기타 한계:
- **Codex Login**: OpenAI 공식 등록 파트너십이 아닌 회색지대. OpenAI 측 차단 가능성 상존. BYOK 폴백 필수.
- **자동화 부재**: SessionStart hook 의 echo 1줄만 작동. dual review 강제 / G-006 자동 검출 / ownership 강제 hook 모두 미박힘 → Sprint 016 mini-milestone β 예정.

## 변경 이력

- 2026-05-15: v1 작성 (Sprint 014 M3, Phase 1 페이지 번역 사용자 테스트 진입)
- 2026-05-20: v2 재작성 (Sprint 016 M0 mini-milestone α, v0.4 방향 전환 반영 — 페이지 번역 폐기 + AI 콘텐츠 메모리 + 워크스페이스 / 검색 / AI 채팅 / 노트 신규 박음. 폐기된 displayMode / 페이지 캐시 / 용어집 섹션 제거 또는 격하)
