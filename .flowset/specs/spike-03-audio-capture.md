# Spike 3 — 시스템 오디오 캡처 PoC

> **상태: 잠정 완료 (정책·스펙 조사 1차)**
> 담당: Claude (조사) + 사용자 (판정)
> 시작일: 2026-05-11
> 종료일: 2026-05-11 (1차 조사)
> 다음: Phase 1 PoC에서 OS별 실 환경 측정 (Windows + macOS)

## 목표

자막 없는 영상 대응(STT)을 위해 Electron에서 OS별 시스템 오디오 캡처가 추가 설치 없이 가능한지 확인.

## 가설

Windows WASAPI Loopback과 macOS ScreenCaptureKit / CoreAudio Tap API를 활용하면 사용자가 추가 드라이버 설치 없이 시스템 오디오를 캡처할 수 있다.

## 검증 항목

- [x] Windows 시스템 오디오 캡처 가능성 (WASAPI)
- [x] macOS 시스템 오디오 캡처 가능성 (ScreenCaptureKit / CoreAudio Tap / BlackHole)
- [x] Electron desktopCapturer + getDisplayMedia 공식 지원
- [x] electron-audio-loopback 같은 npm 패키지 가용성
- [x] Electron 버전별 안정성 (회귀 이슈 등)
- [x] 권한 요청 흐름 (마이크 / 화면 녹화)
- [ ] 실 캡처 → STT 엔진 연결 (Phase 1 PoC 이관)
- [ ] 캡처 지연시간 측정 (Phase 1 PoC 이관)

## 검증 방법

1. Microsoft WASAPI Loopback 공식 문서 확인
2. Apple ScreenCaptureKit / CoreAudio Tap API 정보 수집
3. Electron `desktopCapturer` 공식 문서 + 최근 이슈 확인
4. `electron-audio-loopback` npm 모듈 분석
5. macOS BlackHole 가상 드라이버 대안 검토 (구버전 macOS 폴백)

## 결과

### 1. OS별 캡처 매트릭스

| OS | 가용성 | 추가 설치 | 필요 권한 | API | 비고 |
|---|---|---|---|---|---|
| Windows 10+ | ✓ | **없음** | 마이크 권한 (Loopback 동일 분류) | WASAPI Loopback (shared mode) | 이벤트 기반 loopback (Win10 1703+) |
| macOS 13+ (Ventura+) | ✓ | **없음** | 화면 녹화 권한 | ScreenCaptureKit + CoreAudio Tap | OBS 등 네이티브 사례 |
| macOS 12 이하 | ✗ | BlackHole (또는 Soundflower 후속) | 가상 드라이버 권한 | 가상 입력 장치 라우팅 | 사용자 마찰 큼 |
| ~~Linux~~ | (PRD 1.5 비범위) | — | — | (PulseAudio / PipeWire) | 별도 검토 |

**결론**: Windows 10+ / macOS 13+ 환경에서는 추가 설치 없이 시스템 오디오 캡처 가능. 이는 본 PRD 1.5 MVP 범위 (Windows / macOS) 와 정합.

### 2. Electron 통합 방식

| 방식 | 설명 | 안정성 |
|---|---|---|
| **`desktopCapturer` + `getDisplayMedia({audio: true})`** | Electron 공식 API. Chromium의 시스템 오디오 capture | macOS 15+ experimental (command line switch), Electron 40.1.0 회귀 |
| **`electron-audio-loopback` npm 모듈** | macOS 12.3+ / Windows 10+ / Linux 지원, 추가 드라이버 불필요 | Electron ≥31.0.1 필요 |
| **네이티브 모듈 자체 작성** | WASAPI / ScreenCaptureKit 직접 호출 | 안정적, 제작 비용 |

**Electron 39.0.0-beta.4 변화**: Chromium이 macOS에서 Apple 새 CoreAudio Tap API를 desktopCapturer 기본으로 채택.

**Electron 40.1.0 회귀 이슈**: desktop-capture 스트림이 silence audio로 캡처되는 버그 (Issue #49607). 운영 시 Electron 버전 고정 필요.

### 3. macOS 권한 흐름

```
앱 실행 → desktopCapturer 첫 호출
  → 시스템 다이얼로그 "FlowBrowser AI에서 화면을 녹화하려고 합니다"
  → 사용자 허용 → 시스템 환경설정 > 개인 정보 보호 > 화면 녹화 등록
  → 앱 재시작 (한 번만)
  → 이후 호출은 즉시 가능
```

**중요**: macOS 화면 녹화 권한 = 시스템 오디오 캡처 권한 통합. 사용자에게 "왜 화면 녹화 권한이 필요한가" 명확한 안내 필수 (실제로는 오디오만 사용).

### 4. Windows 권한 흐름

```
앱 실행 → desktopCapturer 첫 호출
  → 마이크 권한 다이얼로그 (또는 무 다이얼로그, OS 정책에 따라)
  → 사용자 허용 → 즉시 사용 가능
```

WASAPI Loopback은 마이크 권한 분류에 들어가지만, 실제로는 **시스템에서 출력되는 오디오를 캡처**. Windows 11에서 권한 흐름이 macOS보다 가벼움.

### 5. STT 연결 가능성 (개념)

캡처 → STT 흐름:

```
시스템 오디오 캡처 (PCM 스트림)
  → 청크 분할 (예: 1~5초 단위 + VAD)
  → STT API 호출
    ├─ OpenAI Whisper API (실시간 / 배치)
    ├─ Google Cloud Speech-to-Text (스트리밍)
    ├─ Deepgram (저지연 스트리밍)
    └─ 로컬 Whisper (faster-whisper / Whisper.cpp)
  → 한국어 텍스트 → 번역 → 자막 / TTS
```

본 Spike는 **캡처 가능성**까지만 검증. STT API 선정은 Phase 5 작업 (PRD 9.4 P3).

## 판정

| 항목 | 결과 |
|---|---|
| **종합 판정** | **Pass with conditions** |
| Windows 10+ | 추가 설치 없이 가능 |
| macOS 13+ (Ventura+) | 추가 설치 없이 가능 (화면 녹화 권한 필요) |
| macOS 12 이하 | BlackHole 권장 또는 비지원 명시 |
| Electron 버전 | ≥39.0.0 (CoreAudio Tap 기본), **40.1.0 회귀 회피** 권장 |
| Phase 5 STT | 캡처 가능 → 진행 가능 (단, STT API 선정은 별도) |

### 조건

1. **MVP 지원 OS = Windows 10+ / macOS 13+** (PRD 1.5와 일치)
2. **macOS 12 이하 = 비지원 명시** 또는 BlackHole 가상 드라이버 안내 (Phase 6+ 별도 검토)
3. **Electron 버전 고정** (≥39.0.0 권장, 40.1.0 회피 또는 패치 확인)
4. **권한 흐름 안내 UI** = macOS 첫 캡처 시 "화면 녹화 권한 필요 (실제로는 오디오만 사용)" 명확 고지
5. **electron-audio-loopback 또는 자체 네이티브 모듈** 중 PoC 후 결정 (Phase 1 PoC)
6. **STT API 선정은 Phase 5 별도 작업**

## PRD 영향

다음 섹션을 PRD v0.3에서 갱신:

### PRD 7.2 MVP 2 / 자막 없는 영상
- "Phase 5의 STT 기반 기능으로 분리, STT 가용성 Spike 3에서 선검증" → "**Spike 3 통과**: Windows 10+ / macOS 13+ 캡처 가능. STT API 선정은 Phase 5 별도 작업" 갱신

### PRD 9.4 STT 처리 (P3)
- "Phase 0 Spike 3에서 가용성만 선검증" → "**가용성 검증 완료**: Windows 10+ / macOS 13+ 추가 설치 없이 캡처 가능. STT API 선정은 Phase 5 별도 spec"

### PRD 11.1 AI Perception Layer / Audio Capture
- 구현 방식: Electron `desktopCapturer` + `getDisplayMedia({audio: true, video: true})` (macOS는 audio only 미지원)
- 폴백: `electron-audio-loopback` npm 모듈 또는 자체 네이티브 모듈

### PRD 16 Phase 5: 확장 / STT 기반 자막 없는 영상 대응
- 진행 가능 명시 (Spike 3 통과)
- 단, Electron 버전 고정 + 권한 흐름 안내 + STT API 선정 작업 필요

### PRD 19.2 Browser Engine Layer / Video Detector
- (변경 없음)

### PRD 19.4 AI Layer / STT Engine
- "Spike 3 통과 시" → "**Phase 5에서 진행** (STT API 선정 / 통합 별도 작업)"

## 미해결 → Phase 1 PoC 이관

다음 항목은 실 Electron 환경 코드 없이 검증 불가능:

1. **Electron `desktopCapturer` + `getDisplayMedia` 정상 작동 검증** (Windows + macOS)
2. **electron-audio-loopback 모듈 안정성 측정** (1시간 연속 캡처 시 누수 / 끊김)
3. **macOS 화면 녹화 권한 안내 UX 흐름**
4. **Electron 40.1.0 회귀 영향 확인** (사용 시) — 안전 버전 결정
5. **캡처 → 청크 분할 → STT 호출 지연시간 측정** (Phase 5 작업)
6. **시스템 오디오 + 마이크 동시 캡처 가능성** (사용자 본인 음성 분리 — 미래 기능)

## 평가 (evaluator 입력)

본 Spike 결과를 evaluator에게 제출:
- 입력: 본 파일 + PRD 7.2 / 9.4 / 11.1 / 16 / 19
- 출력: `.flowset/eval-results/spike-03-2026-05-11.md`

## 참조 (Sources)

### Windows
- [Loopback Recording — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [Application loopback audio capture sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
- [WasapiLoopbackCapture — NAudio docs](https://github.com/naudio/NAudio/blob/master/Docs/WasapiLoopbackCapture.md)
- [audiotee-wasapi GitHub](https://github.com/huxinhai/audiotee-wasapi)

### macOS
- [desktopCapturer ScreenCaptureKit Issue #47490 — electron/electron](https://github.com/electron/electron/issues/47490)
- [Finally, Easy Audio Loopback in Electron — Alec Armbruster](https://alec.is/posts/bringing-system-audio-loopback-to-electron/)
- [BlackHole audio driver](https://existential.audio/blackhole/) (구버전 macOS 폴백)

### Electron
- [desktopCapturer | Electron docs](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [electron-audio-loopback npm](https://www.npmjs.com/package/electron-audio-loopback)
- [electron-audio-loopback GitHub — alectrocute](https://github.com/alectrocute/electron-audio-loopback)
- [docs: improve desktop-capturer loopback docs PR #47493](https://github.com/electron/electron/pull/47493)
- [Broken Desktop Audio Capture Issue #49607 (Electron 40.1.0 회귀)](https://github.com/electron/electron/issues/49607)
- [MacCatapLoopbackAudioForScreenShare flag Issue #42605](https://github.com/electron/electron/issues/42605)

## 변경 이력

- 2026-05-11: placeholder 생성
- 2026-05-11: 1차 조사 완료, Pass with conditions. Windows 10+ / macOS 13+ 추가 설치 불필요 확인. Phase 5 STT 진행 가능. Electron 40.1.0 회귀 회피 권장.
