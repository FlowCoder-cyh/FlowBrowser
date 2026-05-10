> [← PRD 목차](./README.md)

# 19. 개발 태스크 초안

## 19.1 Frontend / Electron

- Electron 프로젝트 생성
- BrowserWindow / BrowserView 구성 (WebContentsView 우선 검토)
- URL Bar 구현
- 기본 Navigation 구현
- Translation Panel 구현
- Subtitle Overlay 구현
- Settings Page 구현
- 온보딩 / 샘플 체험 모드 UI

## 19.2 Browser Engine Layer

- DOM Extractor 구현
- Selection Extractor 구현
- Video Detector (직접 + iframe) 구현
- YouTube Detector 구현
- Subtitle Extractor 구현 (sourceType 구분)
- Playback Controller 구현

## 19.3 Privacy Layer (v0.2 신규)

- Sensitive Field Detector (password / card) 구현
- Domain Filter (blacklist / whitelist) 구현
- Consent Gate 구현
- Transmission Logger 구현
- 사용자 승인 다이얼로그 구현

## 19.4 AI Layer

- Provider Adapter Interface 설계
- OpenAI API Provider 구현
- Codex Login Provider 실험 구현 (Spike 1 통과 시)
- Translation Engine 구현
- Summary Engine 구현
- TTS Engine 구현 (Spike 4 선정 Provider)
- STT Engine 추후 구현 (Spike 3 통과 시)

## 19.5 Storage Layer

- SQLite 또는 local database 구성
- ProviderCredential OS Keychain 위임 구현 (Electron safeStorage)
- TranslationCache 저장 (복합 키, TTL, LRU)
- SubtitleSegment 저장 (sourceType 포함)
- UserSetting 저장
- UsageLog 저장
- GlossaryTerm 저장 (version 관리)

## 19.6 운영 인프라 (v0.2 신규)

- 자동 업데이트: electron-updater
- 코드 사이닝: Windows Authenticode / macOS Developer ID
- 패키징: Windows MSI / macOS DMG
- 크래시 리포트: Sentry 또는 자체 수집
- 원격 feature flag: Provider 활성/비활성 원격 토글
- 앱 버전 관리: semver, 채널(stable/beta/canary)
- Provider 장애 공지 채널 (앱 내 알림)
- 로그 수집 동의 흐름
- 텔레메트리 옵트인

## 19.7 Sync Layer

- TTS Queue Manager 구현
- Delay Analyzer 구현
- Sync Policy Engine 구현 (Spike 4 임계값 적용)
- Volume Ducking 구현
- Playback Rate Controller 구현
