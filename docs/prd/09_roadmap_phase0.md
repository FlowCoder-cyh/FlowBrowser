> [← PRD 목차](./README.md)

# 16. 우선순위 로드맵 (v0.3 — Phase 0 1차 조사 완료)

## Phase 0: 치명 가설 검증 Spike — **1차 조사 종료 (2026-05-11)**

5개 Spike 모두 1차 조사 + evaluator 검증 완료. **차단 사유 없음 = Phase 0 게이트 통과 가능**. 상세는 `.flowset/specs/phase0-summary.md`.

| # | Spike | 판정 | evaluator P/P/F |
|---|---|---|---|
| 1 | Codex 인증 | Pass w/ conditions | 8 / 1 / 0 |
| 2 | YouTube 자막·제어 | Pass w/ conditions | 5 / 2 / 0 |
| 3 | 시스템 오디오 캡처 | Pass w/ conditions | 6 / 1 / 0 |
| 4 | TTS 3축 | Pass w/ conditions | 4 / 3 / 0 |
| 5 | 사용자 인터뷰 가이드 | Pass | 7 / 0 / 0 |

Phase 1 PoC 이관 항목 = 22개 + 사용자 직접 7단계 (인터뷰).

아래는 1차 조사 기록 보존용. Phase 1 진입 후 본 섹션은 history로 보존.

기존 v0.1의 Phase 0(Electron 셸·URL 로드·DOM 추출 코드 작성)은 다음 5종 Spike로 전면 교체한다.
모든 Spike는 1~2주 내 결과 도출을 목표로 하며, Spike 결과에 따라 MVP 1~3 범위와 일정을 조정한다.
**Phase 0이 끝나기 전까지는 본격 코드 착수를 보류한다.**

### Spike 1. Codex/ChatGPT 인증 방식 검증

**목표**: 정책 위반 없이 Codex/ChatGPT 로그인 기반 Provider를 구현할 수 있는지 확인

**검증 항목**:
- 공식 인증 경로 존재 여부 (OAuth, API 파트너 프로그램)
- 3rd-party 앱 사용 약관 검토
- 토큰 저장/갱신 방식
- 사용량 제한 정책
- 필요시 OpenAI 개발자 지원 직접 문의 또는 법무 자문

**판정 기준**:
- 공식 인증 경로 확인 → Codex Login Provider 활성화, MVP 메인
- 불확실 → Experimental 모드 유지, MVP 기본은 OpenAI API Key
- 정책 위반 가능성 → Codex Login Provider 제거

**결과물**: 인증 방식 결정 문서, PRD v0.3에 반영

### Spike 2. YouTube 자막/제어 검증

**목표**: YouTube 영상에서 자막 추출과 재생 제어가 안정적으로 가능한지 확인

**검증 환경**:
- youtube.com 직접 접속 영상
- **iframe 임베디드 YouTube** (블로그/강의 플랫폼/문서 페이지 내)
- 수동 자막 영상
- 자동 생성 자막 영상
- 자막 없는 영상
- 광고 구간
- 로그인 필요 영상
- 연령 제한 영상
- DRM/Premium 콘텐츠

**검증 동작**:
- video element 접근
- currentTime 조회
- play / pause 제어
- playbackRate 제어
- volume / mute 제어
- 수동 / 자동 자막 추출

**결과물**: 환경별 동작 매트릭스. MVP 2 대상 범위 확정 입력.

### Spike 3. 시스템 오디오 캡처 검증

**목표**: 자막 없는 영상 대응(STT)을 위해 Electron에서 OS별 오디오 캡처가 가능한지 확인

**검증 환경**:
- Windows (WASAPI Loopback)
- macOS (Screen Capture Kit / 가상 사운드 드라이버)
- Linux는 검증 제외 (1.5 범위 제외)

**검증 항목**:
- 추가 드라이버 설치 필요 여부
- 권한 요청 흐름
- 캡처 지연시간
- STT 엔진 연결 가능성

**판정 기준**:
- 추가 설치 없이 가능 → Phase 5 STT 진행
- 추가 설치 필요 → Phase 5 보류 또는 자막 영상 한정 영구 제한

**결과물**: STT 가용성 결정. MVP 2의 "자막 없는 영상" 처리 방향 확정.

### Spike 4. TTS 3축 측정

**목표**: 14장 싱크 정책의 매개변수가 현실적인지 확인 + Provider 선택 결정

**측정 매트릭스**:

| Provider | 품질 | 지연 (첫 음성 출력) | 비용 (분당) | 비고 |
|---|---|---|---|---|
| OpenAI TTS | ? | ? | ? | MVP 후보 |
| ElevenLabs | ? | ? | ? | 고급 더빙 후보 |
| 로컬 TTS (Coqui/XTTS) | ? | ? | ? | 하드웨어 의존 |

**측정 시나리오**:
- 10초 / 30초 / 1분 / 5분 구간별 처리
- 한국어 TTS 음성 길이 vs 원본 영어 음성 길이 비율
- 동시 다중 요청 처리 한계

**결과물**: TTS Provider 선정, 14.2 싱크 임계값 캘리브레이션, 비용 시뮬레이션

### Spike 5. 사용자 인터뷰 (5~10명)

**목표**: 핵심 차별점 가설("한국어 더빙이 자막보다 선호된다") + 지불 의사 검증

**대상**: 5.2 세부 사용자군에서 5~10명 (창업가/개발자, 강의 시청자, 리서치 사용자 균형)

**질문**:

선호도:
- 영어 영상 볼 때 가장 불편한 점
- 자막 번역과 음성 더빙 중 선호
- 영상이 잠깐 멈추거나 0.75배 속도가 되더라도 한국어 더빙을 원하는가
- 3~5초 지연을 허용할 수 있는가
- 어떤 콘텐츠에서 가장 쓰고 싶은가 (YouTube / 강의 / 문서 / 뉴스)

지불 의사:
- 월 4,900원이라면 쓸 의향이 있는가
- 월 9,900원이라면 쓸 의향이 있는가
- 긴 영상 더빙을 크레딧 차감 방식으로 제공하면 쓸 의향이 있는가
- BYOK 방식과 자체 크레딧 방식 중 무엇이 더 편한가

**결과물**: 차별점 가설 검증 결과, BM 가격 결정 입력, 페르소나 우선순위 확정

### Phase 0 종료 조건

5종 Spike의 판정이 모두 끝나고, PRD v0.3에 반영된 시점에 Phase 1 착수.

## Phase 1: 웹 번역 MVP

- Electron 브라우저 셸 생성
- URL 로드, DOM 텍스트 추출
- Privacy Filter (P0)
- 선택 영역 번역
- 문단 번역
- 번역 패널
- 캐시 저장 (TTL/키 정책 적용)
- API Key 등록 (OS Keychain 위임)
- Codex Login Provider 실험 (Spike 1 통과 시)
- 온보딩 / 샘플 체험 모드
- UsageLog 기록

## Phase 2: YouTube 자막 MVP

- YouTube 감지 (직접 + 임베디드, Spike 2 결과 반영)
- 자막 추출 (수동/자동, sourceType 구분)
- 자막 번역
- 자막 오버레이
- 자막 캐시 (TTL 365일)

## Phase 3: TTS 더빙 MVP

- TTS Provider 연결 (Spike 4 결정)
- TTS 큐 관리
- 원본 볼륨 낮춤
- 한국어 음성 출력
- 자막 기반 더빙

## Phase 4: 싱크 제어 MVP

- 영상 재생속도 제어
- 영상 일시정지 제어
- 지연 상태 분석 (Spike 4 캘리브레이션)
- 싱크 정책 적용

## Phase 5: 확장

- **STT 기반 자막 없는 영상 대응 — Spike 3 통과로 진행 가능**. STT API 선정 (OpenAI Whisper / Google STT / Deepgram / 로컬) 별도 작업.
- 일반 HTML5 video 지원
- 국가별 언어팩
- 용어집
- 요약/질의응답
