# Spike 2 — YouTube 자막/제어 PoC

> **상태: 잠정 완료 (정책·스펙 조사 1차)**
> 담당: Claude (조사) + 사용자 (판정)
> 시작일: 2026-05-11
> 종료일: 2026-05-11 (1차 조사)
> 다음: Phase 1 PoC에서 실 환경 동작 매트릭스 검증 (Electron + IFrame + 다양한 영상 종류)

## 목표

YouTube 영상에서 자막 추출과 재생 제어가 직접/임베디드 환경에서 안정적으로 가능한지 확인.

## 가설

Electron BrowserView/WebContentsView로 youtube.com 직접 또는 iframe 임베디드 영상 모두에서 자막 추출과 playbackRate / pause / volume 제어가 가능하다.

## 검증 항목

- [x] YouTube IFrame Player API 공식 기능 (playbackRate, currentTime, play/pause, volume)
- [x] 자막 추출 가능성 (공식 API vs 비공식 transcript API)
- [x] 임베디드 YouTube 환경 동작 (postMessage 기반)
- [x] DRM / 연령 제한 / 광고 환경 제약 분석
- [ ] Electron BrowserView 안에서 IFrame API 실제 동작 (Phase 1 PoC)
- [ ] caption track URL 직접 호출 가능 여부 (Phase 1 PoC)
- [ ] 광고 구간 동안 playbackRate 무력화 여부 측정 (Phase 1 PoC)

## 검증 방법

1. YouTube IFrame Player API 공식 reference 정독 (developers.google.com/youtube/iframe_api_reference)
2. YouTube Data API v3 captions endpoint 검토 (3rd-party 영상 자막 접근 가능성)
3. 비공식 transcript API 사례 (youtube-transcript-api 등) 조사
4. 임베디드 vs 직접 접속 차이 분석 (postMessage 패턴)
5. DRM / 연령 제한 / Premium / 광고 환경 제약 조사

## 결과

### 1. YouTube IFrame Player API (공식 기능)

| 기능 | 메서드 / 이벤트 | 가용성 | 비고 |
|---|---|---|---|
| 재생 / 일시정지 | `player.playVideo()` / `player.pauseVideo()` | ✓ | postMessage 기반 |
| 정지 | `player.stopVideo()` | ✓ | — |
| 시간 점프 | `player.seekTo(seconds)` | ✓ | — |
| 현재 시간 조회 | `player.getCurrentTime()` | ✓ | 폴링 또는 timeupdate 이벤트 |
| 재생 속도 조회/변경 | `player.getPlaybackRate()` / `setPlaybackRate(rate)` | ✓ | 0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 |
| 볼륨 조회/변경 | `player.getVolume()` / `setVolume(0-100)` | ✓ | — |
| 음소거 | `player.mute()` / `unMute()` / `isMuted()` | ✓ | — |
| 자막 옵션 조회 | `player.getOptions('captions')` | △ | **`onAPIChange` 이벤트 후에만** (영상 재생 시작 후) |
| 자막 트랙 변경 | `player.setOption('captions', 'track', {languageCode})` | ✓ | 영상에 자막 존재 시 |

**postMessage 통신 형식**:
- 명령: `{"event":"command","func":"playVideo","args":[],"id":1,"channel":"widget"}`
- 응답: `{"event":"infoDelivery","info":{"playerState":-1,"currentTime":0,...,"playbackRate":1,...}}`

cross-origin 안전. Electron BrowserView에서 동일 동작.

### 2. 자막 추출 매트릭스

| 방법 | 가용성 | 제약 | 합법성 |
|---|---|---|---|
| **YouTube Data API v3** `captions.download` | ✓ (본인 영상만) | 3rd-party 영상 자막 다운로드 불가 | 공식, 합법 |
| **YouTube IFrame API** `getOptions('captions')` | △ | 영상 재생 후, 트랙 변경만 가능 (텍스트 추출 불가) | 공식, 합법 |
| **caption track URL 직접 호출** (`timedtext.googlevideo.com`) | ✓ | 공개 자막 영상에서 동작, 비공식 endpoint | **회색지대** |
| **비공식 transcript 라이브러리** (`youtube-transcript-api` 등) | ✓ | API key / quota 불필요, 자동 자막도 추출 | **회색지대** (Spike 1 패턴과 유사) |

**결론**: 공식 API로는 3rd-party 영상 자막 추출 불가. 비공식 caption track URL 또는 transcript 라이브러리가 사실상 표준. Spike 1 (Codex OAuth) 회색지대 패턴과 동일.

### 3. 임베디드 vs 직접 접속

| 환경 | postMessage 동작 | IFrame API | caption track URL |
|---|---|---|---|
| youtube.com 직접 (Chromium 브라우저 컨텍스트) | ✓ | ✓ | ✓ |
| iframe 임베디드 (다른 사이트 내) | ✓ (cross-origin postMessage) | ✓ | ✓ (별도 fetch) |
| Electron BrowserView (직접 로드) | ✓ (Chromium 동일) | ✓ | ✓ |
| Electron BrowserView (임베디드 페이지 로드) | ✓ (postMessage cross-origin) | ✓ | ✓ |

**핵심**: 임베디드 환경에서도 postMessage 기반 IFrame API는 정상 작동. 단, **자막 텍스트 추출은 caption track URL 직접 fetch 필요** (postMessage로 텍스트 자체는 못 받음).

### 4. 환경별 제약

| 환경 | playbackRate / pause | 자막 추출 | 비고 |
|---|---|---|---|
| 일반 공개 영상 (수동 자막) | ✓ | ✓ | MVP 2 핵심 대상 |
| 일반 공개 영상 (자동 자막) | ✓ | ✓ | sourceType=asr 표기 |
| 자막 없는 영상 | ✓ | ✗ | Phase 5 STT (Spike 3 의존) |
| 광고 구간 | △ | ✗ | 광고 자체는 별도 영상, 재생 제어 일부 무력화 가능. 광고 후 정상 |
| 로그인 필요 영상 (예: 멤버십) | △ | △ | 사용자 본인 로그인 시 가능, 미로그인 임베드는 거부 |
| 연령 제한 영상 (18+) | △ | △ | 사용자 본인 로그인 + 연령 확인 필요. Electron 세션이 인증되면 가능 |
| Premium 전용 영상 | ✗ | ✗ | 미공개 영상 등, 임베드 자체 거부 |
| DRM 콘텐츠 (예: YouTube TV / Movies) | ✗ | ✗ | TV 클라이언트(TVHTML5) 한정 DRM 적용, 일반 IFrame 무관 |
| 임베드 비활성 영상 (제작자가 거부) | ✗ | ✗ | 임베드 거부 |

### 5. PRD §7.2 범위와의 정합성

PRD v0.2 §7.2 명시: "MVP 2는 자막 접근 가능한 YouTube 영상에 한정한다."

본 spec 결과로 MVP 2 대상 = "공개 + 자막 있는 (수동/자동) + 임베드 허용 + 비-DRM" 영상. PRD 범위와 정합.

### 6. 가드레일 정합성

| 가드레일 | 위반? | 근거 |
|---|---|---|
| G-002 Phase 0 게이트 | No | 정책·스펙 조사만, 코드 PoC는 Phase 1 이관 |
| G-003 인증 금지선 | No | YouTube IFrame API는 공식, 자막 추출은 회색지대지만 쿠키/세션 우회 아님 |
| G-006 추측 금지 | No | 모든 결과는 공식 docs 또는 명시적 출처 기반 |
| G-001 PRD 정합성 | No | PRD §7.2 범위와 일치 |

## 판정

| 항목 | 결과 |
|---|---|
| **종합 판정** | **Pass with conditions** |
| MVP 2 진행 가능 | 자막 접근 가능한 일반 공개 영상에 한정 |
| 임베디드 YouTube 지원 | 가능 (postMessage 기반) |
| 자막 추출 방식 | caption track URL 직접 fetch + 비공식 transcript 라이브러리 (회색지대) |
| 광고 / 연령 제한 / DRM 처리 | MVP 2 범위 외 (Phase 5 또는 영구 제외) |

### 조건

1. **자막 추출 방식 = caption track URL 직접 fetch** (회색지대, OpenClaw·Roo Code 패턴과 유사)
2. **공식 YouTube Data API v3 captions.download은 사용 안 함** (본인 영상 한정으로 무용)
3. **광고 구간 제어는 시도하지 않음** (실패 시 자막 모드 fallback)
4. **연령 제한 / 멤버십 영상**은 사용자 본인 YouTube 로그인 후에만 동작 (Electron 세션 활용)
5. **DRM / Premium 전용 영상**은 영구 제외 (임베드 자체 거부)
6. **Phase 1 PoC에서 Electron BrowserView 안에서 위 동작 실측**

## PRD 영향

다음 섹션을 PRD v0.3에서 갱신:

### PRD 7.2 MVP 2 범위 한정
- 기존 "자막 접근 가능한 YouTube 영상에 한정" 유지
- 보강: "공개 + 자막 있는 (수동/자동) + 임베드 허용 + 비-DRM" 명시

### PRD 9.3 YouTube/영상 기능
- 자막 추출 방식 = caption track URL 직접 fetch + 비공식 transcript 라이브러리 명시 (회색지대 인지)

### PRD 11.1 아키텍처 / Subtitle Extractor
- 구현 방식: postMessage IFrame API (재생 제어) + caption track URL fetch (자막 텍스트)

### PRD 18.5 사이트 호환성 리스크
- 광고 구간 제어 시도하지 않음 (실패 시 자막 모드 fallback) 명시
- DRM / Premium 영구 제외 명시

## 미해결 → Phase 1 PoC 이관

다음 항목은 실 Electron 환경 코드 없이 검증 불가능:

1. **Electron BrowserView 안에서 IFrame API postMessage 정상 작동 검증**
2. **caption track URL 직접 fetch 응답 안정성 측정** (Google 측 변경 시그널)
3. **광고 구간 playbackRate 무력화 빈도 측정** (1주 시청 100영상 기준 %)
4. **연령 제한 영상에서 Electron 세션 인증 흐름 검증**
5. **임베디드 YouTube (블로그/강의 플랫폼)에서 실제 동작 매트릭스**
6. **자동 자막 vs 수동 자막 품질 차이 (sourceType=asr vs human)**

## 평가 (evaluator 입력)

본 Spike 결과를 evaluator에게 제출:
- 입력: 본 파일 + PRD 7.2 / 9.3 / 11.1 / 18.5
- 출력: `.flowset/eval-results/spike-02-2026-05-11.md`

## 참조 (Sources)

### YouTube 공식
- [YouTube Player API Reference for iframe Embeds — Google Developers](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [Captions | YouTube Data API v3](https://developers.google.com/youtube/v3/docs/captions)

### IFrame API 분석
- [Handling Captions via the YouTube Player API — Terrill Thompson](https://terrillthompson.com/648)
- [YouTube Captions Revisited — Terrill Thompson](https://terrillthompson.com/713)
- [YouTube IFrame API postMessage details — David Hu](https://bugs.xdavidhu.me/google/2021/01/18/the-embedded-youtube-player-told-me-what-you-were-watching-and-more/)
- [Listening to time change events without polling — gist](https://gist.github.com/zavan/75ed641de5afb1296dbc02185ebf1ea0)

### 자막 추출 (3rd-party)
- [How to Scrape YouTube Video Transcripts — ScrapeCreators](https://scrapecreators.com/blog/how-to-scrape-youtube-video-transcripts-step-by-step-developer-guide)
- [YouTube Captions API: Latest Features & Best Practices 2026](https://copyprogramming.com/howto/how-to-youtube-transcript-with-api-captions-download)

### DRM / 연령 제한 / Premium
- [Age-restricted content — YouTube Help](https://support.google.com/youtube/answer/2802167?hl=en)
- [YouTube DRM added on ALL videos with TV clients — Hacker News](https://news.ycombinator.com/item?id=43321145)
- [DRM Restrictions for Videos — Muvi](https://www.muvi.com/blogs/drm-restrictions-for-video-and-digital-assets/)

## 변경 이력

- 2026-05-11: placeholder 생성
- 2026-05-11: 1차 조사 완료, Pass with conditions. PRD §7.2 범위와 정합. Phase 1 PoC 이관 6개 명시.
