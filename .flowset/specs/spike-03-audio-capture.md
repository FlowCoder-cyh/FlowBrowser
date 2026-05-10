# Spike 3 — 시스템 오디오 캡처 PoC

> 상태: **미시작**
> 담당: TBD
> 시작일: TBD
> 종료 목표: 1~2주

## 목표

자막 없는 영상 대응(STT)을 위해 Electron에서 OS별 시스템 오디오 캡처가 추가 설치 없이 가능한지 확인.

## 가설

Windows WASAPI Loopback과 macOS Screen Capture Kit를 활용하면 사용자가 추가 드라이버를 설치하지 않고 시스템 오디오를 캡처할 수 있다.

## 검증 환경

- **Windows 10 / 11** (WASAPI Loopback)
- **macOS 13+ (Ventura)** (Screen Capture Kit)
- **Linux 검증 제외** (PRD 1.5 범위 제외)

## 검증 항목

- [ ] **추가 드라이버 / 설정 필요 여부**
  - Windows: 기본 WASAPI 가용성 / Stereo Mix 활성화 필요 여부
  - macOS: Screen Capture Kit 권한 / BlackHole 등 가상 사운드 드라이버 필요 여부
- [ ] **권한 요청 흐름**
  - macOS: 화면 녹화 권한 / 마이크 권한
  - Windows: 사용자 동의 흐름
- [ ] **캡처 지연시간**
  - 마이크 입력 대비 시스템 오디오 캡처 lag
  - 16kHz / 48kHz 샘플링 차이
- [ ] **STT 엔진 연결 가능성**
  - 캡처 → 스트리밍 STT (OpenAI Whisper / Google STT 등)
  - 청크 크기 / VAD (Voice Activity Detection)

## 검증 방법

1. Electron 최소 PoC 앱 (BrowserWindow + main process audio capture)
2. Windows: `navigator.mediaDevices.getDisplayMedia({ audio: true })` 또는 native binding
3. macOS: ScreenCaptureKit native binding 또는 SystemAudioDump 라이브러리
4. 캡처 → WAV 저장 → 수동 검증 + STT 호출 테스트

## 측정 항목

| 항목 | 목표 |
|---|---|
| 추가 설치 필요? | "없음" 또는 "최소" |
| 권한 요청 횟수 | 1회 (첫 사용 시) |
| 캡처 시작 지연 | < 500ms |
| 청크 → STT 응답 | < 2초 |

## 판정 기준

| 결과 | 판정 | 후속 조치 |
|---|---|---|
| 추가 설치 없이 가능 | **Pass** | Phase 5 STT 진행 가능 |
| 일부 OS만 가능 | **Partial** | 가능 OS만 STT 지원, 나머지는 자막 영상 한정 |
| 추가 설치 / 권한 너무 까다로움 | **Fail** | Phase 5 STT 보류, MVP 2의 "자막 없는 영상" 영구 제외 |

## 결과 (TBD)

### Windows 결과
(작성 예정)

### macOS 결과
(작성 예정)

### STT 연결 테스트
(작성 예정)

### PRD 영향
- PRD 7.2 MVP 2 / 9.4 STT 처리 — 구체화 또는 제거
- PRD 16 Phase 5 — STT 진행 / 보류 결정

## 평가 (evaluator 입력)

본 Spike 결과는 evaluator에게 제출하여 채점한다.
- 입력: 본 파일 + 측정 데이터 + PRD 7.2 / 9.4
- 출력: `.flowset/eval-results/spike-03-{date}.md`

## 변경 이력

- 2026-05-11: placeholder 생성
