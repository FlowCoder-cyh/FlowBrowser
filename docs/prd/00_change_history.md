> [← PRD 목차](./README.md)

# 0. 문서 목적 및 변경 이력

## 0.1 문서 목적

이 문서는 **AI 네이티브 브라우저 / 콘텐츠 번역·더빙 브라우저** 아이디어를 제품 기획 수준으로 정리한 PRD다.
핵심 목적은 기존 크롬/엣지 위에 AI를 얹는 방식이 아니라, 처음부터 AI 접목을 전제로 한 브라우저형 제품을 설계하는 것이다.

## 0.13 v0.3.10 변경 이력 (2026-05-15) — Sprint 012 실측 반영

Phase 1 Sprint 012 산출물을 PRD에 반영한 패치 (탭 미리보기 + 키보드 단축키).

v0.3.9 대비 주요 변경:

1. **§9.1 탭 미리보기 (hover thumbnail)**: `ThumbnailStore` 신규 (메모리 LRU 50, set/get/remove/clear, true LRU). main에서 활성 탭 변경 직전 (`setActiveTabView` 진입 시점 `browserView` 변수 활용) 이전 view를 `webContents.capturePage()` → `resize({width: 300})` → `dataURL`로 `ThumbnailStore`에 저장. `tab:get-thumbnail` IPC. 비활성 view paint 정지 문제는 "활성일 때만 캡처" 패턴으로 우회 (Sprint 011 evaluator 권고 capture API spike 우려 해소). TabBar `onMouseEnter` 600ms 지연 → 미리보기 div (절대 위치, fade-in 150ms, placeholder 또는 img + URL/title meta). 드래그 중 hover 무시. `destroyTabView` 시 자동 remove + `mainWindow.closed` 시 clear.
2. **§9.1 키보드 단축키**: `Application Menu` accelerator 등록 — Ctrl+T 새 탭 / Ctrl+W 활성 탭 닫기 (마지막 탭이면 새 빈 탭 자동 생성 패턴 유지) / Ctrl+Tab 다음 탭 (wrap) / Ctrl+Shift+Tab 이전 탭. `mainWindow` focus 시점부터 작동, 전역 단축키 아님.
3. **§11 TabManager.cycleActiveTabId**: `cycleActiveTabId(direction: 'next' | 'prev'): string | null` 순수 함수 추가 — order 기준 순환, 단일 탭은 같은 id, 빈 상태/null active는 null. M3 키보드 단축키 + 사용자 확장 사용 케이스 대응.
4. **§11 capture hook 핫픽스 (WI-S012M1-1)**: M1 evaluator §A3 Fail (dead code) 직접 해소. `captureActiveTabThumbnail` → `captureTabThumbnail(prevTabId)` 인자화 + `setActiveTabView` 진입 시점 `browserView` 변수 활용 (syncBrowserViewRef는 함수 마지막에 호출되어 새 view로 갱신).
5. **§19 모듈 등록**: ThumbnailStore + captureTabThumbnail + installApplicationMenu + Menu 탭 서브메뉴 4 항목 + TabBar hover state/timer/preview div + tab:get-thumbnail IPC + TabManager.cycleActiveTabId 신규 등록.

본 패치는 Sprint 012 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.12 v0.3.9 변경 이력 (2026-05-15) — Sprint 011 실측 반영

Phase 1 Sprint 011 산출물을 PRD에 반영한 패치 (summary abort + 탭 UX 추가 보강).

v0.3.8 대비 주요 변경:

1. **§9.2 summary abort API**: `summarizeChunks(texts, translate, options)`에 `abortCheck: () => boolean` 콜백 추가. 각 청크/통합/부분/최종/truncated 5개 summarize 호출 직전 검사 → true 시 `SummarizationAbortedError` throw. main에 `summarizeAborted` 플래그 + `translate:summarize-abort` IPC + `translate:summary-aborted` 이벤트 (`{ chunks, sourceTabId }`). `cancelOnTabSwitch=true` + 실제 탭 전환 시 자동 set. TranslationPanel summary 모드 "취소" 버튼 + onSummaryAborted listener. Sprint 010 §리스크 3 (summary abort 부재) 직접 해소.
2. **§9.1 / §12.1 탭 컬러 라벨**: `TabSession.color` 필드 (red/orange/yellow/green/blue/purple/gray/null 8값, 기본 null). `TabManager.setColor(id, color)` palette 검증 + 같은 색 no-op. `tab:set-color` IPC + 컨텍스트 메뉴 "색상 변경" radio 서브메뉴 (7색 + 없음, checked 현재 색 + 한글 라벨). TabBar `borderTopColor` 매트릭스 (활성/비활성 × color/null). TabStateStore 영속 + 호환 fallback (옛 파일에 color 누락 → null).
3. **§9.1 / §12.1 탭 핀(고정)**: `TabSession.pinned` 필드 (기본 false). `TabManager.setPinned(id, pinned)`는 핀↔비핀 invariant 유지 (핀 시 핀 영역 끝, 핀 해제 시 비핀 영역 끝). `closeOthers` / `closeRight` 핀 탭 자동 제외 (closed에서 빠짐, 보존). `reorder`는 핀↔비핀 경계 넘기는 이동 clamp. `tab:set-pinned` IPC + 컨텍스트 메뉴 "핀 고정 / 핀 해제" 토글. TabBar 핀 시각화 (📌 아이콘 + 좁은 너비 + 닫기 X 숨김). TabStateStore 영속 + 호환 fallback + restore 좌측 정렬 stable sort.
4. **§11 TabManager API 확장**: `setColor` / `setPinned` 신규 + `restore` color/pinned fallback + 핀 invariant 정렬 + `reorder` 핀 영역 clamp. 9 IPC 유지 + `tab:set-color` / `tab:set-pinned` 2 추가 = 11 IPC.
5. **§19 모듈 등록**: SummarizationPlanner.abortCheck / SummarizationAbortedError + TabManager.setColor/setPinned + TabBar 핀 시각화 + 컨텍스트 메뉴 6 항목 (탭 닫기 / 다른 탭 닫기 / 오른쪽 탭 모두 닫기 / 탭 복제 / 핀 토글 / 색상 서브메뉴).

본 패치는 Sprint 011 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.11 v0.3.8 변경 이력 (2026-05-15) — Sprint 010 실측 반영

Phase 1 Sprint 010 산출물을 PRD에 반영한 패치 (탭 UX 보강 + S009 잔여 P2).

v0.3.7 대비 주요 변경:

1. **§9.1 탭 드래그/순서 변경**: TabBar HTML5 DnD (`draggable` + `onDragStart/Over/Drop/End`) + `tab:reorder` IPC. `TabManager.reorder(tabId, newIndex)`는 newIndex를 `[0, length-1]`로 clamp, 같은 위치는 no-op (emit skip), 활성 탭/메타데이터 보존. 닫기 버튼은 `draggable=false` + `onDragStart preventDefault`로 드래그 영향 차단.
2. **§9.1 탭 컨텍스트 메뉴**: 우클릭 시 main process OS 네이티브 popup menu (4 항목: 탭 닫기 / 다른 탭 닫기 / 오른쪽 탭 모두 닫기 / 탭 복제). 단일 탭일 때 "다른 탭 닫기" disabled, 가장 오른쪽일 때 "오른쪽 탭 모두 닫기" disabled. `TabManager.closeOthers / closeRight / duplicate` 3 신규 API + 4종 IPC (`tab:close-others / close-right / duplicate / show-context-menu`).
3. **§12.1 cancelOnTabSwitch 필드 추가**: `UserSettingState.cancelOnTabSwitch: boolean` (기본 `false`, 호환). 활성화 시 실제 탭 전환에서 진행 중 paragraphs/page 작업 자동 abort (paragraphsAborted/pageTranslateAborted 플래그 set). 비활성화 시(기본) 백그라운드 계속 + sourceTabId 가드(Sprint 009 M2)가 UI만 차단. **한계: summary 흐름은 abort API 부재로 결과 무시만 (Sprint 011+ 후보).**
4. **§9.6 / §11 isCurrentTab 순수 함수 추출**: `src/renderer/src/translation/tabGuard.ts` 신규. `isCurrentTab(activeTabId, sourceTabId)` — sourceTabId null/undefined → true (레거시), activeTabId null → true (초기화), 그 외 일치 시 true. TranslationPanel이 inline 함수 대신 import 사용. Sprint 009 M2 G-006 Partial 후속 권고 직접 해소.
5. **§19 모듈 등록**: TabManager.reorder/closeOthers/closeRight/duplicate + tab:reorder/close-others/close-right/duplicate/show-context-menu 5 IPC + tabGuard.ts + GeneralPanel cancelOnTabSwitch 토글 신규 등록.

본 패치는 Sprint 010 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.10 v0.3.7 변경 이력 (2026-05-15) — Sprint 009 실측 반영

Phase 1 Sprint 009 산출물을 PRD에 반영한 패치 (안정화 묶음).

v0.3.6 대비 주요 변경:

1. **§12.7 GlossaryStore bumpVersion 안정화**: 같은 ms 내 mutation 시 동일 version 반환하던 flaky를 단조 증가 counter 추가로 해소. Sprint 008 evaluator §Glossary flaky 직접 해소. 회귀 테스트 2 추가 (10/10 PASS).
2. **§9.1 / §9.2 sourceTabId 가드**: paragraphs/page/summarize 3종 IPC 진입 시점 활성 탭 ID 캡처 후 13종 이벤트 페이로드에 전파. TranslationPanel이 활성 탭과 비교해 다르면 UI 업데이트 무시. 백그라운드 작업이 다른 탭에 잘못 patch되지 않음.
3. **§9.1 / §12.10 탭 영속**: TabStateStore (`tabs.json` policyVersion=1) — TabManager 상태(tabs + activeId)를 디스크에 영속. 앱 재시작 시 자동 복원. debounced 200ms 자동 저장 + 종료 시 강제 flush. 손상 파일은 빈 상태 fallback (안전).
4. **§11 TabManager.restore**: 외부 상태 import + emit 1회. activeId가 tabs에 없으면 마지막 탭 자동 선택. subscribe 등록 순서 정합 (복원 broadcast push 경로 보장).
5. **§19 모듈 등록**: TabStateStore + TabManager.restore + initializeTabs + scheduleTabStateSave 신규 등록.

본 패치는 Sprint 009 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.9 v0.3.6 변경 이력 (2026-05-15) — Sprint 008 실측 반영

Phase 1 Sprint 008 산출물을 PRD에 반영한 패치. PRD §9.1 탭 관리 P2 구현 완료.

v0.3.5 대비 주요 변경:

1. **§9.1 탭 관리 P2 구현 완료**: TabManager (PRD §11 신규) + 다중 WebContentsView + 탭바 UI + 활성 탭 라우팅. 5종 IPC (`tab:list / open / close / switch / active`) + `tab:list-update` broadcast. 마지막 탭 close 시 새 빈 탭 자동 open.
2. **§11 TabManager + 다중 WebContentsView 아키텍처**: 각 탭당 view 1개 사전 생성, 활성 view만 `mainWindow.contentView.addChildView`, 비활성은 remove. WebContentsRegistry는 탭별 등록 유지. 메모리는 `destroyTabView()` + `mainWindow.on('closed')`에서 명시 `webContents.close()`.
3. **§11.1 탭별 흐름 자동 라우팅**: `browserView` 변수가 `setActiveTabView`/`syncBrowserViewRef`로 활성 탭 view를 항상 가리킴 → paragraphs/page/summarize-page/render/restoreHint 모든 IPC 흐름이 별도 분기 없이 활성 탭 기준 작동.
4. **§9.1 Navigation broadcast 활성 탭 라우팅**: `did-navigate / did-finish-load / page-title-updated` 이벤트는 활성 탭일 때만 `browser:navigated` 송신 → UrlBar 자동 동기화 (탭 전환 시 즉시 갱신).
5. **§19 UI/모듈 등록**: TabManager / TabBar.tsx / 다중 view 관리 / 5 IPC + broadcast 신규 등록.

본 패치는 Sprint 008 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.8 v0.3.5 변경 이력 (2026-05-15) — Sprint 007 실측 반영

Phase 1 Sprint 007 산출물을 PRD에 반영한 패치 (누적 정리 Sprint).

v0.3.4 대비 주요 변경:

1. **§12.1 UserSetting 잔여 4 필드 구현**: `defaultLanguage` (기본 'ko') / `sourceLanguage` (기본 'auto') / `defaultProviderId` (기본 'openai') / `privacyFilterEnabled` (기본 true). UserSettingStore 확장 + Settings GeneralPanel UI + TranslationPanel 5종 흐름(paragraphs/page/summarizePage/restoreCurrent/lookup)에 setting 적용. `subtitleMode / ttsEnabled / syncMode`는 Phase 2~4 진입 시 추가.
2. **§9.6 / §10.3 privacyFilterEnabled 안전 정책**: false 시 도메인 차단만 우회. password 필드 / 카드 필드 / 본문 카드 패턴은 항상 차단 (G-004 안전 정책 무력화 절대 금지). services.ts evalDomains 분기 + manualApprovalToken 의도적 드롭으로 우회 불가 보장.
3. **§9.2 / §12.10 요약 메타 수치 표시**: SummarizeResult에 `combinedInputChars` / `combineCharLimit` 추가. TranslationPanel 메타에 "통합 입력 N자 / limit M자" 표시. truncated 경로 시각적 강조.
4. **§12.10 PageCachePanel UI**: Settings에 페이지 캐시 통계 (count) + 모두 삭제 (confirm) UI. PageResultStore.stats() / clearAll() 활용.
5. **§19 빌드/타입 보강** (운영): tsconfig.node.json include 확장 (storage/ai/privacy/perception/tests). main/index.ts + services.ts의 dynamic import 5건 → 정적 import로 전환. vite chunk 분리 사라짐 (out/main에 index.js 단일).

본 패치는 Sprint 007 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.7 v0.3.4 변경 이력 (2026-05-15) — Sprint 006 실측 반영

Phase 1 Sprint 006 산출물을 PRD에 반영한 패치.

v0.3.3 대비 주요 변경:

1. **§9.1 Navigation 동기화**: did-navigate / did-navigate-in-page / did-finish-load 이벤트 broadcast → `browser:navigated` IPC → UrlBar canGoBack / canGoForward 버튼 disabled 동기화. PRD §9.1 P1 해소.
2. **§9.2 / §12.1 표시 모드 3종 통합 + UserSetting 적용**: panel(기본) / replace(DOM 치환) / overlay(인접 박스). PRD §12.1 `translationMode` 필드 영속. Settings DisplayModePanel UI. paragraphs/page 흐름이 mode 따라 자동 render IPC 호출. 페이지 이동 시 자동 renderRestore.
3. **§9.2 / §11.1 TranslationRenderer 외부 페이지 IIFE**: paragraph/page selector preset + 길이/중복 필터로 id 매칭. replace 모드는 `data-fbai-orig` 속성에 원문 백업 + textContent 교체. overlay 모드는 sibling `.fbai-overlay` div 부착 + 재호출 시 갱신. restore는 두 모드 모두 복원.
4. **§12.4 / §12.10 PageResultStore (페이지 캐시)**: 페이지 URL 정규화(origin+pathname) + nodesSignatureFromTexts(sha256 32자) + TTL 30일 + LRU 500MB. translate:page 정상 완료 시 자동 영속. 재방문 시 onNavigated → 자동 lookup → restoreHint 표시. 복원 클릭 시 signature 검증 후 render. 페이지 변경 감지 (signature mismatch) 시 복원 차단.
5. **§19.1 / §19.5 모듈 등록**: TranslationRenderer / UserSettingStore / PageResultStore / DisplayModePanel 신규 등록.

본 패치는 Sprint 006 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.6 v0.3.3 변경 이력 (2026-05-15) — Sprint 005 실측 반영

Phase 1 Sprint 005 산출물을 PRD에 반영한 패치.

v0.3.2 대비 주요 변경:

1. **§9.2 / §12.4 캐시 키 확장**: TranslationCache 복합 키에 `requestType` 추가 (6요소화). Sprint 004 M2 cache 우회 정책 제거 — explanation/summary도 정상 lookup/store. 기존 디스크 항목은 `requestType` 누락 시 `'selection'` fallback (자연 폐기).
2. **§9.2 / §12.7 용어집**: PRD §12.7 GlossaryTerm 1:1 정합 GlossaryStore 구현. 활성 + 도메인 일치 (또는 빈 도메인) 최대 50개를 prompt 컨텍스트로 주입. explanation/summary는 의역이라 적용 외. mutation 시 sha256 기반 version 자동 갱신 → `translationCache.invalidateByGlossaryVersion(prevVersion)` 7개 IPC에서 일관 호출.
3. **§9.6 / §11 GlossaryPanel UI**: Settings 안 신규 섹션 — 4 필드 폼 + 검증 5종 (empty_source/empty_target/too_long_source/too_long_target/duplicate) + 활성 토글 + 도메인 필터 + JSON import/export + 모두 삭제. DomainPolicyPanel과 동일 패턴 적용.
4. **§9.2 / §11.1 요약 폭주 보호**: `summarizeChunks(combineCharLimit=8000)` 옵션. 4 경로 (`single / direct / resplit / truncated`). 통합 입력 > limit 시 1회 재분할 → 재분할 후에도 초과 시 truncate 폴백 (무한 루프 방지). TranslationPanel에 `combinedPath` 한국어 라벨 + chunkSummaries 펼치기 토글.
5. **§19.5 / §19.6 모듈 등록**: GlossaryStore / formatGlossaryContext / validateTerm / GlossaryPanel 신규 등록.

본 패치는 Sprint 005 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.5 v0.3.2 변경 이력 (2026-05-15) — Sprint 004 실측 반영

Phase 1 Sprint 004 산출물을 PRD에 반영한 패치. 본격 변경 없이 실측·정책 명문화.

v0.3.1 대비 주요 변경:

1. **§9.2**: 쉬운 설명 / 요약 P1 — Sprint 004 M2/M3에서 RequestType `'explanation' | 'summary'` 추가, OpenAIApiKeyProvider system prompt 분기 (tutor / summarizer), 컨텍스트 메뉴 "쉽게 설명" / "이 부분 요약" 항목 추가. 페이지 요약은 청크 분할 + 통합 요약 흐름 (SummarizationPlanner pure 함수, mock 단위 테스트로 회귀 보장).
2. **§9.6 / §11.1 IPC 정책 명문화**: 선택 영역 흐름 (`selection / explanation / summary`)은 통합 IPC `translate:request` + 컨텍스트 메뉴 통합 + popup mode 분기. 페이지 단위 흐름 (`page` 번역 / `summarize-page` 요약)은 청크 분할이 필요해 전용 IPC + 진행/완료/오류/취소 별도 이벤트 채널. Sprint 003 M2 evaluator §D + Sprint 004 M2 Partial 해소.
3. **§9.6 IPC 채널 분리 (Sprint 004 M1)**: `translate:page-aborted` / `translate:page-error` / `translate:paragraphs-aborted` / `translate:paragraphs-error` 4종 신규 이벤트로 분리. 기존 `translate:*-done`은 정상 완료/page_wide_block 시점에 `stoppedReason` 필드와 함께 송신 (호환 유지). `translate:paragraphs-abort` IPC 신설.
4. **§12.4 캐시 정책 보강**: explanation/summary는 캐시 우회 (캐시 키에 requestType 미포함 → 충돌 회피). cache 키 확장은 Sprint 005 이후 별도 검토.
5. **§12.8 UsageLog feature 매핑**: requestType → feature 매핑 함수 (`featureFromRequestType`) 도입. explanation/summary는 별도 feature로 기록, UsagePanel byFeature 동적 표시.
6. **§19.2 / §19.4**: SummarizationPlanner / OpenAIApiKeyProvider buildSystemPrompt/buildUserPrompt export / "쉽게 설명" / "이 부분 요약" 컨텍스트 메뉴 항목 신규 등록.

본 패치는 Sprint 004 M1~M3 evaluator 결과를 입력으로 작성됨.

## 0.4 v0.3.1 변경 이력 (2026-05-15) — Sprint 002·003 실측 반영

Phase 1 Sprint 002·003 산출물을 PRD에 반영한 패치. 본격 변경 없이 실측·정책 명문화.

v0.3 대비 주요 변경:

1. **§9.2**: 페이지 전체 번역 P1 — Sprint 003 M2에서 16종 블록 노드 선택자 + 4000자 청크 그루핑 + abort 지원으로 구현. 청크 단위 진행 / cache hit 즉시 표시 / pageWideBlock=true 시 즉시 중단 명문화.
2. **§9.6**: 사용자 도메인 화이트/블랙리스트 P1 — Sprint 003 M3 DomainPolicyPanel UI + DomainPolicyStore JSON 영속 + import/export (policyVersion=1) 구현 명시. 패턴은 `*.example.com` 선두 와일드카드만 허용. 사용자 화이트리스트 > 사용자 블랙리스트 > 기본 블랙리스트 우선순위 명문화.
3. **§9.6 BlockReason 도입**: Sprint 003 M1에서 차단 사유를 enum (`consent / password / card_field / card_pattern / domain / none`)으로 구조화. `pageWideBlock: boolean` 추가 — 차단 시 페이지 전체 차단 여부. 모든 차단 사유는 pageWideBlock=true (사용자 명시 차단 의도 통일).
4. **§12.4**: TranslationCache 실측 — Sprint 002 M2에서 5요소 복합 키 (sha256 + 4필드) + TTL 90/365일 + LRU trim (maxBytes 1GB 초과 시 절반 제거, lastAccessedAt 기준) 구현. Sprint 003 M1에서 LRU trim 직접 측정 단위 테스트 3종 추가.
5. **§19**: 신규 모듈 등록 — `PageNodeExtractor` / `DomainPolicyStore` / `BlockReason / pageWideBlock` 타입 / `TranslationPanel 페이지 모드`. dev_tasks_and_ops에 반영.

본 패치는 Sprint 002 종합 + Sprint 003 M1/M2/M3 evaluator 결과를 입력으로 작성됨.

## 0.3 v0.3 변경 이력 (2026-05-11) — Phase 0 1차 조사 반영

Phase 0 치명 가설 5종 (Codex 인증 / YouTube 자막·제어 / 시스템 오디오 캡처 / TTS 3축 / 사용자 인터뷰) 1차 조사 결과를 PRD에 반영. **5개 모두 차단 사유 없음 = Phase 0 게이트 통과 가능**.

v0.2 대비 주요 변경:

1. **§1.5**: macOS 12 이하 비지원 명시 (Spike 3)
2. **§7.2**: MVP 2 범위 보강 — "공개 + 자막 있는 + 임베드 허용 + 비-DRM" (Spike 2)
3. **§9.3**: 자막 추출 방식 명시 — caption track URL fetch + 비공식 transcript 라이브러리 (회색지대 인지, G-011)
4. **§9.4**: TTS Provider 3종 명시 (OpenAI gpt-4o-mini-tts / ElevenLabs Flash v2.5 / Kokoro-82M). STT P3 비고 — "Spike 3 가용성 검증 완료, STT API 선정 Phase 5 별도"
5. **§11.1**: Subtitle Extractor 구현 (postMessage IFrame API + caption track URL fetch). Audio Capture 구현 (desktopCapturer + getDisplayMedia / electron-audio-loopback)
6. **§11.2**: ElevenLabsProvider 명시, ~~Coqui XTTS-v2~~ → Kokoro-82M 교체 (라이선스 + Coqui AI 회사 폐업)
7. **§11.3**: Codex Login Provider — "Phase 0 Spike 1 1차 조사 통과, Experimental 활성화" (공식 등록 부재 명시)
8. **§14.2**: 임계값(0.9배 / 0.75~0.85배 / 4초) 유지 + Phase 1 PoC 캘리브레이션 명시
9. **§15.2**: ElevenLabs P2 유지 (PRD 본문과 일치 확인). 로컬 모델 = Kokoro-82M 명시
10. **§15.3**: G-011 인용 추가 — "공개 endpoint 회색지대 허용 / 자격증명 우회 절대 금지"
11. **§16**: Phase 0 종료 선언. Phase 5 STT 진행 가능 (Spike 3 통과)
12. **§18.1**: Codex 클라이언트 ID 무효화로 즉시 정지 가능 → 폴백 즉시 동작 필수
13. **§18.4**: TTS 비용 시뮬레이션 갱신 — gpt-4o-mini-tts 기준 1시간 영상 = $0.90 (캐시 365일 재방문 시 0)
14. **§18.5**: 광고 fallback / DRM 영구 제외 명시 (Spike 2)
15. **§19.2 / §19.4 / §19.6**: 구현 태스크 보강 — Subtitle Extractor / STT Engine (Phase 5) / Electron 버전 고정

이 변경은 5개 Spike spec + 4개 evaluator + Phase 0 종합 보고 (`.flowset/specs/phase0-summary.md`)를 입력으로 작성됨.

## 0.2 v0.2 변경 이력 (2026-05-11)

v0.1 대비 주요 변경:

1. **Phase 0 전면 교체**: 개발 셸 착수 → 치명 가설 5종 Spike (16장)
2. **Codex Login Provider 격하**: 확정 메인 Provider → Phase 0 검증 통과 시에만 활성화 (11.3 / 15.3)
3. **MVP 2 범위 한정**: "자막 접근 가능한 YouTube 영상"으로 명시 (7.2)
4. **Privacy Filter 신설**: 정책 → P0 기능 모듈로 격상 (9.6 / 11장 / 10.3)
5. **15.3 금지 강화**: ChatGPT 웹 세션/쿠키 재사용 명시 금지
6. **데이터 모델 보강**: UsageLog 스키마(12.8), TranslationCache 키/TTL(12.4), ProviderCredential OS Keychain 위임(12.2), SubtitleSegment.sourceType(12.6)
7. **신규 섹션**:
   - 1.5 범위 제외 (Linux / 모바일)
   - 5.4 경쟁 제품 분석
   - 8.0 온보딩 시나리오 (샘플 모드 포함)
   - 19.6 운영 인프라

이 변경은 GPT/Claude 교차 검토 결과 합의 사항을 반영한 것이며, Phase 0 Spike 결과에 따라 v0.3에서 추가 조정될 수 있다.
