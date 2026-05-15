> [← PRD 목차](./README.md)

# 19. 개발 태스크 초안

## 19.1 Frontend / Electron

- Electron 프로젝트 생성
- BrowserWindow / BrowserView 구성 (WebContentsView 우선 검토)
- URL Bar 구현
- 기본 Navigation 구현 (v0.3.4 Sprint 006 M1: canGoBack/canGoForward broadcast + UrlBar 버튼 disabled 동기화)
- Translation Panel 구현 (v0.3.3 Sprint 005 M3: chunkSummaries 펼치기 토글 + PATH_LABELS 한국어 / v0.3.4 Sprint 006 M2/M3: mode 분기 + 자동 render + 페이지 캐시 restoreHint 배너)
- DisplayModePanel UI (v0.3.4 Sprint 006 M2): translationMode 3종 (panel/replace/overlay) 라디오
- Subtitle Overlay 구현
- Settings Page 구현 (v0.3.3 Sprint 005 M2: GlossaryPanel 추가)
- GlossaryPanel UI (v0.3.3 Sprint 005 M2): 4 필드 폼 + 검증 + 활성 토글 + 도메인 필터 + JSON import/export
- 온보딩 / 샘플 체험 모드 UI

## 19.2 Browser Engine Layer

- DOM Extractor 구현
- Selection Extractor 구현
- ParagraphExtractor 구현 (v0.3.1 Sprint 002 M3): 9종 블록 선택자 (p/h1~h6/blockquote/li/dd), 길이 [8,5000], 중복 제거
- PageNodeExtractor 구현 (v0.3.1 Sprint 003 M2): 16종 블록 선택자 (Paragraph + dt/figcaption/caption/summary/td/th), 4000자 청크 그루핑, validatePageNodes
- TranslationRenderer 구현 (v0.3.4 Sprint 006 M1): paragraph/page preset IIFE로 외부 페이지에서 DOM 적용. replace = data-fbai-orig 백업 + textContent 교체, overlay = sibling .fbai-overlay 부착. restore는 두 모드 모두 복원
- Video Detector (직접 + iframe) 구현
- YouTube Detector 구현
- Subtitle Extractor 구현 (v0.3 Spike 2): postMessage IFrame API + caption track URL 직접 fetch (`timedtext.googlevideo.com`), 또는 youtube-transcript-api 같은 비공식 라이브러리. sourceType 구분 (human / asr).
- Playback Controller 구현

## 19.3 Privacy Layer (v0.2 신규, v0.3.1 보강)

- Sensitive Field Detector (password / card) 구현
- Domain Filter (blacklist / whitelist) 구현
- DomainPolicyStore 구현 (v0.3.1 Sprint 003 M3): JSON 영속 (`policyVersion=1`), validatePattern, import/export, setRules bulk, clearAll
- DomainPolicyPanel UI (v0.3.1 Sprint 003 M3): Settings 안 화이트/블랙 2 컬럼 + JSON import/export
- Consent Gate 구현
- Transmission Logger 구현
- BlockReason enum / pageWideBlock 구조화 (v0.3.1 Sprint 003 M1): 차단 사유 enum 6종, 페이지 전체 차단 boolean
- 사용자 승인 다이얼로그 구현

## 19.4 AI Layer

- Provider Adapter Interface 설계
- OpenAI API Provider 구현
- `buildSystemPrompt` / `buildUserPrompt` 외부 export 함수 (v0.3.2 Sprint 004 M2): requestType 7종 분기 (selection / paragraph / page / subtitle / tts_script / explanation / summary), 단위 테스트 직접 매트릭스 검증
- SummarizationPlanner (v0.3.2 Sprint 004 M3): planChunks + summarizeChunks pure 함수, mock provider 단위 테스트 가능 의존성 주입 구조
- Codex Login Provider 실험 구현 (Spike 1 통과 시)
- Translation Engine 구현
- Summary Engine 구현 (v0.3.2 Sprint 004 M3): 선택 영역은 `translate:request` 통합 IPC, 페이지는 `translate:summarize-page` 전용 IPC + 청크 분할/통합 흐름
- Explanation Engine 구현 (v0.3.2 Sprint 004 M2): 컨텍스트 메뉴 "쉽게 설명" + `translate:request(requestType='explanation')` 통합 IPC
- TTS Engine 구현 (v0.3 Spike 4): OpenAI gpt-4o-mini-tts (MVP 기본) + ElevenLabs Flash v2.5 (고급) + Kokoro-82M (프라이버시). ~~Coqui XTTS-v2~~ 영구 제외 (비상용 라이선스 + 회사 폐업).
- STT Engine — **Phase 5 별도 작업** (Spike 3 가용성 통과: Win10+ / macOS 13+ 추가 설치 불필요). STT API 선정 (Whisper / Google STT / Deepgram / 로컬) 별도.

### IPC 채널 정책 (v0.3.2 Sprint 004 명문화)

- **선택 영역 단위** (`selection / explanation / summary`): 통합 IPC `translate:request` + 컨텍스트 메뉴 진입 + `translation:popup-show / popup-result` 이벤트 + `mode: 'translation' | 'explanation' | 'summary'` 페이로드 분기. 별도 IPC 미신설.
- **페이지 단위** (`translate:paragraphs / translate:page / translate:summarize-page`): 각 흐름이 청크/노드 분할이 필요해 전용 IPC. 진행/완료/오류/취소 별도 이벤트 채널 (`*-start / *-progress / *-done / *-aborted / *-error`). abort IPC (`translate:paragraphs-abort / translate:page-abort`) 별도 노출.
- 사유: 단일 호출 vs 다회 호출 + 사용자 취소 vs 즉시 응답의 UX 차이가 본질적이라 통합 시 페이로드 복잡도가 분리 시보다 큼. Sprint 003 M2 evaluator §D + Sprint 004 M2 Partial 직접 해소.

## 19.5 Storage Layer

- SQLite 또는 local database 구성
- ProviderCredential OS Keychain 위임 구현 (Electron safeStorage)
- TranslationCache 저장 (복합 키 6요소: sourceHash | lang × 2 | provider | **requestType** | glossaryVersion, TTL, LRU. v0.3.3 Sprint 005 M1 requestType 추가)
- SubtitleSegment 저장 (sourceType 포함)
- UserSettingStore 구현 (v0.3.4 Sprint 006 M2): PRD §12.1 translationMode 우선 영속 (panel/replace/overlay)
- UsageLog 저장
- GlossaryStore 구현 (v0.3.3 Sprint 005 M2): PRD §12.7 1:1, JSON 영속, version 자동 갱신, getActiveForDomain 최대 50개, formatGlossaryContext, validateTerm 5종, GLOSSARY_POLICY_VERSION import/export
- PageResultStore 구현 (v0.3.4 Sprint 006 M3): PRD §12.10 1:1, 페이지 URL 정규화 + nodesSignature(sha256) + TTL 30일 + LRU 500MB, translate:page 정상 완료 시 자동 영속, restoreCurrent IPC + signature mismatch 검증
- SummarizationPlanner combineCharLimit 보호 (v0.3.3 Sprint 005 M3): 4 경로 (single/direct/resplit/truncated), 재분할 1회 후 truncate 폴백, 기본 limit 8000자

## 19.6 운영 인프라 (v0.2 신규)

- 자동 업데이트: electron-updater
- 코드 사이닝: Windows Authenticode / macOS Developer ID
- 패키징: Windows MSI / macOS DMG
- 크래시 리포트: Sentry 또는 자체 수집
- 원격 feature flag: Provider 활성/비활성 원격 토글 (특히 Codex Login 차단 시 즉시 OFF)
- 앱 버전 관리: semver, 채널(stable/beta/canary)
- Provider 장애 공지 채널 (앱 내 알림)
- 로그 수집 동의 흐름
- 텔레메트리 옵트인
- **Electron 버전 정책 (v0.3 Spike 3)**: `>= 39.0.0` (CoreAudio Tap 기본) 권장. `40.1.0` 회귀 회피 (Issue #49607: silence audio 캡처 버그). 패치 확인 후 상위 버전 채택

## 19.7 Sync Layer

- TTS Queue Manager 구현
- Delay Analyzer 구현
- Sync Policy Engine 구현 (Spike 4 임계값 적용)
- Volume Ducking 구현
- Playback Rate Controller 구현
