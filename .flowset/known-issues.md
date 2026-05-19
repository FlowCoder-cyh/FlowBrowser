# FlowBrowser AI — Known Issues 누적

> Sprint·Phase 종료 evaluator에서 발견된 약점 / 시나리오 cover 부족 / 정량 임계 미달 / 회귀 가능성 항목을 KI-NNN 형식으로 누적.
> 가드레일(`guardrails.md`)과 같은 단일 파일 패턴. 절대 삭제하지 않음 (해소 시 상태만 `closed`로 변경).

## 등록 정책 (Sprint 015 진입 시 활성)

### KI 번호 규칙
- 형식: `KI-NNN` (NNN = 3자리 0-pad 숫자, 등록 순서)
- 첫 등록부터 순차 (KI-001, KI-002, ...)

### Severity 정의

| Severity | 정의 | 처리 시점 |
|---|---|---|
| **HIGH** | 핵심 시나리오 불가능 / 보안·프라이버시 위협 / 데이터 손실 위험 | **즉시 다음 Sprint M1**에 처리 (별도 작업 우선) |
| **MEDIUM** | 시나리오 동작하지만 UX 불편 / 정량 임계 미달 / 성능 저하 | **5개 누적 또는 Phase 종료 시 batch** (다음 Sprint M1~M2에 흡수) |
| **LOW** | 정성적 개선 / 마이너 버그 / 코드 정리 | **Phase 3 종료 후 MVP 직전 정리** |

### 등록 형식

각 KI는 다음 메타를 가짐:

```
### KI-NNN [status] 한 줄 제목

- **Severity**: HIGH / MEDIUM / LOW
- **Phase**: 1 / 2 / 3
- **Sprint**: 015 / 016 / ...
- **Component**: 파일 또는 모듈 경로 (예: `src/storage/IndexedPageStore.ts`)
- **영향**: 어떤 시나리오·사용자 흐름에 영향
- **발견 출처**: evaluator 보고서 인용 또는 사용자 보고
- **재현 절차**: (선택, HIGH/MEDIUM은 필수)
- **권고 해소 방향**: (선택)
- **처리 예정 Sprint**: NNN (또는 "Phase X batch")
- **상태**: `open` / `in-progress` / `closed`
```

### 상태 표기

- `[open]` 등록만 됨, 아직 처리 시작 안 됨
- `[in-progress]` 처리 Sprint 진행 중
- `[closed]` 해소 완료 (해소 PR 번호 + Sprint 인용)

### 누적 정리 트리거

- **HIGH 즉시**: 발견 즉시 다음 Sprint M1 작업으로 격상
- **MEDIUM 5개**: MEDIUM 누적 5개 도달 시 다음 Sprint M1~M2 batch 처리
- **Phase 종료 batch**: 각 Phase 종료 evaluator 시점에 MEDIUM/LOW 누적분 정리 plan 수립
- **MVP 최종**: Phase 3 종료 후 남은 LOW까지 모두 정리

---

## KI 누적

### KI-001 [open] sqlite-vec macOS native 빌드 미검증

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M3-6 codex/evaluator 핫픽스 시점 등록)
- **Component**: `package.json` (sqlite-vec optional dep) + `src/storage/Database.ts` (sqlite-vec 로드 호출)
- **영향**: macOS 사용자 install 시 `sqlite-vec-darwin-x64` / `sqlite-vec-darwin-arm64` prebuilt 동작 미검증. `better-sqlite3@12.10` Electron 39 macOS ABI rebuild 도 PoC 부재. M4 인덱싱 hook 시점에 macOS 사용자에서 sqlite-vec load 실패 시 인덱싱 전체 차단 가능.
- **발견 출처**: M3-spike (`.flowset/specs/m3-spike-decisions.md` §1 "macOS 검증: 본 세션 환경 한정 → 미검증") + 핸드오프 2026-05-18 §13.8 + 2026-05-18 M3 종합 evaluator §3 KI 후보 1 권고
- **재현 절차**: macOS x64 또는 arm64 환경에서 `npm install` + `npx electron-rebuild -f -w better-sqlite3 -v 39.x.x` 실행 후 `spike/m3-poc/electron-main.cjs` 동일 PoC 재실행
- **권고 해소 방향**: (1) macOS CI runner 추가 (`.github/workflows/*.yml` 에 `runs-on: macos-latest` 매트릭스) (2) 또는 사용자 macOS 환경에서 PoC 1회 수동 실행 후 결과 본 KI 에 기록
- **처리 예정 Sprint**: 016 (macOS CI 추가 시 해소) — Phase 1 종료 전 권고
- **상태**: `open`

### KI-002 [open] PageCachePanel PARTIAL — v0.3 어댑터 의존 잔존

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M3-7 PARTIAL 적용 + codex/evaluator 핫픽스 시점 등록)
- **Component**: `src/renderer/src/settings/PageCachePanel.tsx` + `src/storage/PageResultStore.ts` 어댑터
- **영향**: 본 패널은 M3-7 에서 copy 만 "페이지 본문 캐시" 로 갱신되었으나 컴포넌트 자체는 v0.3 `pageResultApi` 의존. M5-8 어댑터 일괄 제거 시점에 본 패널도 동반 폐기 (MemoryStatsPanel 흡수 contract). 현재 UX 영향 없음 (정상 동작).
- **발견 출처**: PR #138 본문 + 2026-05-18 M3 종합 evaluator §3 KI 후보 2 권고
- **권고 해소 방향**: M5-8 ChatService 도입 시점에 `pageResultApi` + `PageResultStore` 어댑터 + 본 패널 동시 제거 + 신규 `MemoryStatsPanel` (M6) 으로 흡수
- **처리 예정 Sprint**: 015 M5-8 (정합 contract) 또는 Phase 3 종료 후 MVP 직전 정리
- **상태**: `open`

### KI-003 [open] AutoTagger G-003 BYOK provider 검증 wiring 필요

- **Severity**: HIGH
- **Phase**: 1
- **Sprint**: 015 (M4-2 codex 핫픽스 시점 등록)
- **Component**: `src/main/IndexingService.ts` (M4-5 wiring 시점) + `src/ai/tagging/AutoTagger.ts` (호출자 책임 명시)
- **영향**: AutoTagger 자체는 호출자가 어떤 provider 주입했는지 모름 — Codex OAuth 가 주입되면 자동 백그라운드 호출이 ChatGPT 한도를 묵시 소진. G-003 강화 (BYOK 디폴트, 자동 호출은 OpenAI API Key 만) 가 wiring 단계에서 강제되지 않으면 사용자 동의 없이 ChatGPT 할당 소비 가능 — 보안·UX 위협.
- **발견 출처**: M4-2 PR #146 codex 정밀 검토 KI 후보 1 (Severity HIGH)
- **재현 절차**: IndexingService 가 AutoTagger 호출 시 provider = CodexLoginProvider 주입 → 자동 인덱싱마다 ChatGPT 호출 발생
- **권고 해소 방향**: M4-5 wiring 또는 후속 단계에서 `IndexingService.tagPage` 호출 시 `UserSetting.defaultProviderId === 'openai-key'` 또는 사용자 명시 동의 검증. AutoTagger.constructor 에 BYOK 가드 add (`opts.provider.info.providerType === 'openai'` 또는 옵션 `enforceByokOnly: true`)
- **처리 예정 Sprint**: 015 M4-5 또는 M5 (wiring 시점)
- **상태**: `open`

### KI-006 [open] Workspace 전환 시 진행 작업 abort 정책 미배선

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator + codex KI 후보 #1)
- **Component**: `src/main/workspaceHandlers.ts` (`handleWorkspaceSwitch`) + `src/main/IndexingService.ts` (abort API 신규 노출) + `src/storage/EmbeddingQueue.ts` (clear API 신규) + `src/main/ChatService.ts` (abortStreaming API 신규)
- **영향**: 사용자 워크스페이스 전환 시 이전 ws 의 인덱싱 진행 / 임베딩 큐 / 채팅 streaming 이 그대로 진행되어 GPT 호출이 새 ws 에 연결되지 않은 ws_id 로 계속 발생. 비용 묵시 소진 + 노이즈 데이터 INSERT 가능. PRD §11.3.1 명시 abort 4-step 흐름 미구현.
- **재현 절차**: 워크스페이스 A 에서 페이지 인덱싱 중 워크스페이스 B 로 전환 → A 의 임베딩 큐 / Visit INSERT 가 A 워크스페이스로 계속 기록
- **권고 해소 방향**: `WorkspaceHandlerDeps` 에 abort callback 3종 (`abortIndexing` / `clearEmbeddingQueue` / `abortChatStreaming`) 주입 → `handleWorkspaceSwitch` 진입 시 호출. main `setActive` 후 broadcast `workspace:switched` 활용.
- **처리 예정 Sprint**: 016 (M0 또는 M1)
- **상태**: `open`

### KI-007 [open] TabManager workspace_id 메타 + 탭 그룹 stash/restore 미구현

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator KI 후보 #2)
- **Component**: `src/main/TabManager.ts` (workspace_id 필드 신규) + `src/storage/TabStateStore.ts` (영속 schema 확장) + `src/main/workspaceHandlers.ts` (stash/restore 트리거)
- **영향**: PRD §11.2.1 의 탭 격리 PARTIAL 라 본 PR (T28) 단계에서 허용 범위이나, contract AC-7 명시 "탭 전부 교체" 미달. 워크스페이스 전환해도 동일 탭 그룹 유지 → 시나리오 1·2·3 격리 검증 어려움.
- **재현 절차**: ws A 에서 GitHub 탭 5개 → ws B 전환 → 여전히 GitHub 탭 5개 그대로
- **권고 해소 방향**: TabState schema 확장 (`workspace_id` NOT NULL) + TabManager filter by activeWorkspaceId + setActiveTabView 시 stash/restore. Phase 2 cookies partition (WorkspacePartitionManager) 와 동반 처리.
- **처리 예정 Sprint**: 016 (Phase 2 cookies partition 동반)
- **상태**: `open`

### KI-008 [open] Workspace JSON Export/Import 미구현

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T28 evaluator KI 후보 #3)
- **Component**: `src/main/WorkspaceService.ts` (`exportJson` / `importJson` 신규 메서드) + `src/renderer/src/workspace/WorkspaceSidebar.tsx` (Export 버튼 + handler)
- **영향**: PRD §11.5.6 "Phase 1, M6" 명시 산출물이나 contract T28 산출물 목록에 포함 0. 사용자 워크스페이스 삭제 직전 안전망 부재 (현재 cascade DELETE 후 복구 불가).
- **권고 해소 방향**: IPC 2종 (`workspace:export-json` / `workspace:import-json`) + UI 우클릭 메뉴 추가. v0.4 자체 schema (Workspace + Page + Visit + Note + AiChatHistory + Tag 전체).
- **처리 예정 Sprint**: 016 M0 또는 Phase 3 종료 전 정리
- **상태**: `open`

### KI-009 [open] MemoryStatsPanel React 컴포넌트 단위 테스트 0

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 evaluator NB-7)
- **Component**: `src/renderer/src/memory/MemoryStatsPanel.tsx`
- **영향**: 폴링 동작 / workspaceId prop 변경 시 즉시 재로드 / error fallback UI / loading state / broadcast onInvalidated 구독 — React component 단위 미검증. pure logic 17 cover 완전 + 시나리오 통합 회귀로 부분 cover.
- **권고 해소 방향**: vitest + @testing-library/react + IPC mock 으로 4 케이스 (mount / workspaceId 변경 / 폴링 / error). renderer 환경 happy-dom 활성 필요.
- **처리 예정 Sprint**: Phase 3 종료 후 MVP 직전 정리 또는 Sprint 016
- **상태**: `open`

### KI-010 [open] MemoryStatsPanel 인덱싱 완료 broadcast 미구현 (잔여 1종)

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 hotfix 부분 cover)
- **Component**: `src/main/IndexingService.ts` (wiring 시점에 broadcast 추가) + `src/renderer/src/memory/MemoryStatsPanel.tsx` (이미 onInvalidated 구독 중)
- **영향**: PRD §07.4.2 broadcast 3종 (인덱싱 / 노트 / AI 채팅) 중 노트 + AI 채팅 2종은 T29 hotfix 로 cover. 인덱싱 완료 broadcast 는 IndexingService 가 main process 에 wiring 안 됨 (Sprint 015 M4-5 자체는 인스턴스 정의만, services.ts wiring 0).
- **권고 해소 방향**: IndexingService 가 services.ts 에서 인스턴스화 + did-finish-load 핸들러 결합 시점에 recordVisit 후 `broadcastMemoryInvalidated(workspaceId)` 호출. KI-006 abort 정책과 동반 처리 가능.
- **처리 예정 Sprint**: 016 M0 또는 M1 (IndexingService wiring 시점)
- **상태**: `open`

### KI-011 [open] MemoryStats 카운트 < 20ms 정량 임계 미측정

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M6 T29 evaluator 항목 3 Partial)
- **Component**: `src/main/MemoryService.ts` (`getStats` 5개 prepared SELECT)
- **영향**: PRD §11.3.2 임계 측정 데이터 부재. 실측 < 20ms 정량 검증 필요 (10K page workspace 기준). 단위 테스트는 in-memory SQLite — 실디스크 WAL mode + 인덱스 활용 시 차이 가능성.
- **권고 해소 방향**: T31 종합 evaluator 또는 Sprint 016 M0 에 stopwatch 측정 셋 추가 (1K / 10K 페이지 시 getStats 실측 ms). 임계 초과 시 denormalized 카운트 컬럼 (workspaces 테이블에 신규) 도입 권고.
- **처리 예정 Sprint**: 016 M0
- **상태**: `open`

### KI-005 [open] AutoTagger.tagPage(pageId=note.id) page_tags FK 위반 — note 자동 태깅 차단

- **Severity**: LOW (현 시점 wiring 미활성 — NoteService.opts.autoTagger 미주입 + 통합 자체 제거)
- **Phase**: 1
- **Sprint**: 015 (M5-7 PR #159 codex 정밀 검토 발견)
- **Component**: `src/ai/tagging/AutoTagger.ts` (tagPage 가 내부에서 attachToPage 호출) + `src/main/NoteService.ts` (호출 path 차단)
- **영향**: AutoTagger.tagPage 가 내부에서 `tagStore.attachToPage(input.pageId, ...)` 호출 — schema `page_tags.page_id REFERENCES pages(id) ON DELETE CASCADE` FK 제약. NoteService 가 note.id 를 pageId 자리에 주입 시 SQLite FOREIGN KEY constraint 실패. 현 NoteService 는 autoTagger 호출 자체 차단으로 안전.
- **발견 출처**: M5-7 PR #159 codex 정밀 검토 N-001 + evaluator KI 후보 1 (Sprint 015 M5 종료 핸드오프 §10.5)
- **재현 절차**: 향후 NoteService 에 AutoTagger 인스턴스 주입 + createNote({enableAutoTagging: true}) 호출 시 — schema FK 검사에서 throw
- **권고 해소 방향**: AutoTagger.tagNote 신규 메서드 도입 — `tagStore.attachToNote` 호출 path. 또는 AutoTagger 가 attach 호출 자체 호출자에게 분리 (provider.chat 결과 tag rows 만 반환).
- **처리 예정 Sprint**: 016 (note 자동 태깅 UI 도입 시점)
- **상태**: `open`

### KI-004 [open] ChatRequest.response_format JSON 강제 API-level 미구현

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M4-2 codex 핫픽스 시점 등록)
- **Component**: `src/ai/types.ts` (ChatRequest) + `src/ai/providers/OpenAIApiKeyProvider.ts` (chat 호출)
- **영향**: PRD §8.8.3 "OpenAI Provider 응답을 JSON 강제" — 현재는 system prompt 의존 (모델이 schema 따르도록 지시만). OpenAI API 의 `response_format: { type: 'json_object' }` 또는 `json_schema` 미사용 → 모델이 JSON 외 출력 시 freeform fallback 트리거되어 정확도 저하 가능.
- **발견 출처**: M4-2 PR #146 codex 정밀 검토 NB-3 / KI 후보 2 (Severity MEDIUM)
- **권고 해소 방향**: (1) `ChatRequest` 에 `responseFormat?: 'text' | 'json_object'` 추가 (2) OpenAIApiKeyProvider body 에 `response_format` 전달 (3) AutoTagger 가 `responseFormat: 'json_object'` 지정. M5 ChatService 도입 시점에 본 contract 함께 처리.
- **처리 예정 Sprint**: 015 M5-5 (ChatService 도입) 또는 Sprint 016 정확도 측정 시점
- **상태**: `open`

---

## 통계 (Phase 단위)

| Phase | HIGH 누적 | MEDIUM 누적 | LOW 누적 | 해소 | 잔여 |
|---|---|---|---|---|---|
| Phase 1 | 1 | 4 | 6 | 0 | 11 |
| Phase 2 | — | — | — | — | — |
| Phase 3 | — | — | — | — | — |

---

## 참조

- 가드레일: `.flowset/guardrails.md` (KI vs 가드레일 구분 — 가드레일 = 절대 규칙, KI = 일시적 약점)
- 검증 정책: `.flowset/specs/v04-direction.md` §12 (검증 흐름 + Severity 정의)
- Sprint 015 contract: `.flowset/contracts/sprint-015.md` §6 (evaluator 통과 기준)

## 변경 이력

- 2026-05-16: 등록 정책 + Severity 정의 + KI 형식 초기 등록 (Sprint 015 진입 시점, KI 0건)
- 2026-05-18 (M3 종료 핫픽스): KI-001 MEDIUM (sqlite-vec macOS 미검증) + KI-002 LOW (PageCachePanel PARTIAL) 등록. evaluator + codex 병렬 평가에서 추출. Sprint 015 누적 0건 → 2건 (KI 등록 정책 본격 발동).
- 2026-05-18 (M4-2 핫픽스): KI-003 HIGH (G-003 BYOK wiring 강제) + KI-004 MEDIUM (ChatRequest.response_format JSON 강제 API-level) 등록. M4-2 codex 정밀 검토 KI 후보 1/2 추출. Sprint 015 누적 2건 → 4건. HIGH 첫 등록 — M4-5 wiring 시점 즉시 처리 정책 적용.
- 2026-05-19 (M5-7 핫픽스): KI-005 LOW (AutoTagger.tagPage page_tags FK 위반 — NoteService note 자동 태깅 차단) 등록. PR #159 codex 정밀 검토 N-001 발견. NoteService 가 autoTagger 통합 자체 제거로 안전 차단. Sprint 015 누적 4건 → 5건. KI-003 HIGH wiring 완료 — M5-3b/M5-5/M5-6/M5-7 에 BYOK 검증 박힘 (status `in-progress` 갱신 후보, Sprint 016 또는 M5-8 분할 2편 시점 closed 권고).
- 2026-05-19 (M6 T28~T31 종합): KI-006 MEDIUM (Workspace 전환 abort 정책 미배선) + KI-007 MEDIUM (TabManager workspace_id stash/restore) + KI-008 LOW (Workspace JSON Export/Import) + KI-009 LOW (MemoryStatsPanel React unit 0) + KI-010 LOW (MemoryStats 인덱싱 broadcast 잔여 1종) + KI-011 LOW (MemoryStats < 20ms 미측정) 6건 등록. T28 + T29 evaluator + codex 병렬 평가에서 추출. Sprint 015 누적 5건 → 11건. MEDIUM 누적 4건 도달 (KI-001 + KI-004 + KI-006 + KI-007) — 5건 batch 임계 1건 부족. Sprint 016 M0 처리 권고.
