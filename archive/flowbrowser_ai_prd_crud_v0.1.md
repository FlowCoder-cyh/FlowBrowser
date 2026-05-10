# FlowBrowser AI PRD & CRUD 상세 매트릭스

## 0. 문서 목적

이 문서는 **AI 네이티브 브라우저 / 콘텐츠 번역·더빙 브라우저** 아이디어를 제품 기획 수준으로 정리한 PRD 초안이다.  
핵심 목적은 기존 크롬/엣지 위에 AI를 얹는 방식이 아니라, 처음부터 AI 접목을 전제로 한 브라우저형 제품을 설계하는 것이다.

---

# 1. 제품 개요

## 1.1 제품명

**FlowBrowser AI**  
임시명이며, 향후 브랜드명 변경 가능.

## 1.2 한 줄 정의

**영어 웹사이트와 영상을 한국어로 읽고, 보고, 들을 수 있게 해주는 AI 네이티브 브라우저**

## 1.3 핵심 컨셉

기존 브라우저에 확장 프로그램을 얹는 방식은 DOM 접근, 오디오 처리, 영상 재생 제어, 오버레이 UI, AI 연동 측면에서 제약이 많다.

FlowBrowser AI는 Electron/Chromium 기반 브라우저 위에 AI 기능을 기본 구조로 내장하여 다음 경험을 제공한다.

- 웹페이지 자연 한국어 번역
- 선택 문장 번역/요약/설명
- YouTube 영어 자막 한국어 변환
- 영어 음성 STT → 한국어 번역 → 한국어 TTS
- 한국어 TTS 싱크에 맞춘 영상 재생 제어
- 국가별 언어팩 확장
- 멀티 AI Provider 연동

## 1.4 제품의 본질

이 제품은 단순 번역기가 아니다.

**웹과 영상을 사용자의 언어로 재구성하는 AI 브라우징 환경**이다.

---

# 2. 문제 정의

## 2.1 사용자 문제

영어 콘텐츠를 자주 소비하지만 영어가 불편한 사용자는 다음 문제를 겪는다.

1. 브라우저 기본 번역 품질이 어색하다.
2. YouTube 자동 자막/번역이 자연스럽지 않다.
3. 영어 음성을 듣기 어렵고, 자막만으로는 피로도가 크다.
4. 영상 번역과 실제 영상 재생 싱크가 맞지 않는다.
5. 페이지 전체 맥락을 고려한 번역, 요약, 설명이 부족하다.
6. 기존 AI 도구는 브라우저에 얹힌 보조 기능이라 제어권이 제한적이다.
7. 긴 영상이나 강의 콘텐츠를 한국어로 따라가기 어렵다.
8. 사용자가 이미 구독 중인 AI 서비스를 활용하고 싶지만, 기존 서비스는 이를 자연스럽게 연결하지 못한다.

## 2.2 기존 방식의 한계

### Chrome Extension 방식의 한계

- 사이트별 DOM/CSS 충돌 가능성
- 모든 텍스트 구조를 안정적으로 읽기 어려움
- 오디오 캡처와 TTS 출력 제어가 제한적
- 영상 재생속도, 일시정지, 볼륨 제어가 사이트별로 불안정
- AI가 브라우저 경험 전체를 제어하기 어려움

### 일반 번역기 방식의 한계

- 텍스트 번역 중심
- 영상/오디오/자막과 연결되지 않음
- 사용자의 시청 흐름을 제어하지 못함
- 문맥 기반 재구성이 약함

### YouTube 자동 더빙/자막 방식의 한계

- 플랫폼이 제공하는 범위에 한정됨
- 모든 영상에 적용되지 않음
- 웹사이트, 강의 플랫폼, SaaS, 문서까지 확장하기 어려움
- 사용자 개인 선호 말투, 자막 길이, TTS 스타일을 반영하기 어려움

---

# 3. 제품 목표

## 3.1 1차 목표

영어 웹페이지와 YouTube 영상을 한국어 사용자가 자연스럽게 이해할 수 있는 AI 브라우저 MVP를 만든다.

## 3.2 2차 목표

영상 자막/음성 번역 결과에 맞춰 영상 재생 속도와 일시정지를 제어하는 AI 싱크 더빙 경험을 만든다.

## 3.3 3차 목표

한국어를 시작으로 일본어, 스페인어, 인도네시아어 등 국가별 언어팩으로 확장 가능한 AI 브라우저 플랫폼을 만든다.

## 3.4 장기 목표

브라우저를 단순 웹 탐색 도구가 아니라, AI가 사용자의 웹 이해와 작업을 보조하는 실행 환경으로 확장한다.

---

# 4. 핵심 가설

## 4.1 제품 가설

사용자는 단순 번역보다, 웹/영상/오디오를 자신의 언어 경험으로 재구성해주는 브라우저를 원한다.

## 4.2 기술 가설

Electron/Chromium 기반 브라우저를 만들면 확장 프로그램보다 DOM, 영상, 오디오, 오버레이, 재생 제어를 더 일관되게 다룰 수 있다.

## 4.3 성장 가설

“영어 YouTube를 한국어 더빙처럼 볼 수 있는 AI 브라우저”라는 데모는 입소문을 만들 수 있다.

## 4.4 리스크 가설

Codex/ChatGPT 로그인 토큰 기반 사용은 초기 진입장벽을 낮출 수 있지만, 정책 변경 가능성이 있으므로 멀티 Provider 구조가 필요하다.

---

# 5. 타깃 사용자

## 5.1 1차 타깃

영어 콘텐츠를 자주 보지만 영어가 불편한 한국 사용자

## 5.2 세부 사용자군

1. 해외 YouTube 강의/리뷰/인터뷰를 보는 사용자
2. 개발 문서, SaaS 문서, 기술 블로그를 읽는 사용자
3. 영어 뉴스, 리서치, 논문을 보는 사용자
4. 영어 강의 플랫폼을 이용하는 학생/직장인
5. 해외 툴을 업무에 활용하는 창업가/개발자/기획자
6. 영어 콘텐츠를 한국어로 듣고 싶은 일반 사용자

## 5.3 초기 페르소나

### Persona A. 영어가 불편한 창업가/개발자

- 해외 SaaS, 개발 문서, AI 툴 문서를 자주 봄
- 브라우저 번역은 어색하고 문맥 파악이 어려움
- YouTube 튜토리얼을 많이 보지만 영어 음성이 불편함
- 목표: 영어 콘텐츠를 한국어로 빠르게 이해

### Persona B. 영어 강의 시청자

- 해외 강의, YouTube, 웨비나를 자주 봄
- 자막 번역이 어색하면 학습 흐름이 끊김
- 음성으로 한국어 설명을 듣고 싶음
- 목표: 영어 강의를 한국어 강의처럼 소비

### Persona C. 리서치 사용자

- 해외 기사, 논문, 문서를 자주 읽음
- 긴 문서를 번역, 요약, 질문하고 싶음
- 목표: 영어 리서치 시간을 단축

---

# 6. 제품 포지셔닝

## 6.1 하면 안 되는 포지셔닝

- 그냥 번역기
- 크롬 대체 브라우저
- API 비용 없이 무제한 AI 번역기
- Codex 토큰 우회 도구
- 단순 YouTube 자막 번역기

## 6.2 해야 하는 포지셔닝

**영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저**

## 6.3 핵심 메시지

- 영어 콘텐츠를 한국어처럼 보는 브라우저
- AI가 웹페이지와 영상을 사용자의 언어로 재구성합니다
- 번역 속도에 맞춰 영상까지 조절하는 AI 싱크 브라우저
- 영어 YouTube를 한국어 더빙처럼 시청하세요

---

# 7. MVP 범위

## 7.1 MVP 1: AI 웹 번역 브라우저

### 포함 기능

- Electron 기반 브라우저 실행
- URL 입력
- 웹페이지 로드
- 현재 페이지 DOM 텍스트 추출
- 선택 영역 번역
- 문단 단위 번역
- 우측 번역 패널
- 번역 결과 캐시
- Provider 선택
- Codex Login Provider 실험 지원
- OpenAI API Key Provider 지원

### 제외 기능

- 완전한 크롬 대체 기능
- 확장 프로그램 호환
- 비밀번호 관리자
- 북마크 동기화
- 멀티 프로필
- OCR
- 실시간 음성 더빙

## 7.2 MVP 2: YouTube 자막 번역 브라우저

### 포함 기능

- YouTube URL 로드
- 영상 플레이어 감지
- 자막 존재 여부 감지
- 영어 자막 추출
- 한국어 자막 번역
- 하단 오버레이 자막 표시
- 원문/번역 토글
- 자막 캐시

### 제외 기능

- 자막 없는 영상의 STT
- 한국어 TTS 더빙
- 영상 재생 자동 제어

## 7.3 MVP 3: AI 싱크 더빙

### 포함 기능

- 영어 자막 또는 STT 결과를 문장 큐로 변환
- 한국어 번역 생성
- 한국어 TTS 생성
- 원본 영상 볼륨 낮춤
- 한국어 TTS 출력
- TTS 큐 상태에 따라 영상 일시정지
- TTS 큐 상태에 따라 재생속도 조절
- 싱크 상태 표시

### 제외 기능

- 완전 실시간 동시통역 수준의 더빙
- 음성 복제
- 립싱크
- 영상 자체 재렌더링

---

# 8. 핵심 사용자 시나리오

## 8.1 시나리오 1: 영어 웹사이트 읽기

1. 사용자가 FlowBrowser AI를 실행한다.
2. 영어 웹사이트 URL을 입력한다.
3. 브라우저가 페이지를 로드한다.
4. 사용자가 “페이지 번역” 버튼을 누른다.
5. 브라우저가 DOM 텍스트를 추출한다.
6. AI Provider가 문단 단위로 번역한다.
7. 번역 결과가 우측 패널 또는 페이지 오버레이에 표시된다.
8. 사용자는 원문/번역을 토글한다.

## 8.2 시나리오 2: 선택 영역 번역

1. 사용자가 웹페이지에서 영어 문장을 드래그한다.
2. 미니 번역 버튼이 나타난다.
3. 사용자가 버튼을 누른다.
4. 선택 문장이 번역된다.
5. 사용자는 번역, 쉬운 설명, 요약 중 하나를 선택할 수 있다.

## 8.3 시나리오 3: YouTube 자막 번역

1. 사용자가 YouTube 영상을 연다.
2. 브라우저가 영상과 자막 존재 여부를 감지한다.
3. 영어 자막이 있으면 자막을 추출한다.
4. AI가 한국어 자막으로 변환한다.
5. 영상 하단에 한국어 자막 오버레이가 표시된다.
6. 사용자는 원문 자막, 번역 자막, 병렬 자막을 선택한다.

## 8.4 시나리오 4: AI 싱크 더빙

1. 사용자가 AI 더빙 모드를 켠다.
2. 브라우저가 영어 자막 또는 STT 결과를 가져온다.
3. 한국어 번역과 TTS를 생성한다.
4. 원본 영상 볼륨을 낮춘다.
5. 한국어 TTS를 출력한다.
6. TTS 생성이 늦어지면 영상 속도를 낮추거나 일시정지한다.
7. TTS 큐가 안정화되면 영상 재생을 정상화한다.

---

# 9. 기능 요구사항

## 9.1 브라우저 기본 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| URL 입력 | 사용자가 웹사이트 주소 입력 | P0 |
| 페이지 로드 | Chromium WebView/BrowserView로 웹페이지 표시 | P0 |
| 뒤로가기/앞으로가기 | 기본 탐색 기능 | P1 |
| 새로고침 | 현재 페이지 새로고침 | P1 |
| 탭 관리 | 복수 탭 열기/닫기 | P2 |
| 히스토리 | 방문 기록 저장 | P2 |
| 북마크 | 자주 쓰는 사이트 저장 | P3 |

## 9.2 AI 번역 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| DOM 텍스트 추출 | 현재 페이지 텍스트 노드 추출 | P0 |
| 선택 영역 번역 | 드래그한 텍스트 번역 | P0 |
| 문단 번역 | 페이지 문단 단위 번역 | P0 |
| 페이지 전체 번역 | 전체 페이지 번역 | P1 |
| 원문/번역 토글 | 원문과 번역 표시 방식 변경 | P1 |
| 쉬운 설명 | 어려운 문장을 쉽게 설명 | P1 |
| 요약 | 선택 영역/페이지 요약 | P1 |
| 용어집 적용 | 사용자 정의 용어 반영 | P2 |

## 9.3 YouTube/영상 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| 영상 감지 | 페이지 내 video 요소 감지 | P0 |
| YouTube 감지 | YouTube URL/플레이어 감지 | P0 |
| 자막 감지 | 영상 자막 존재 여부 확인 | P0 |
| 자막 추출 | 영어 자막 데이터 추출 | P0 |
| 자막 번역 | 한국어 자막 생성 | P0 |
| 자막 오버레이 | 영상 하단에 번역 자막 표시 | P0 |
| 병렬 자막 | 원문+번역 동시 표시 | P1 |
| 자막 캐시 | 동일 영상 자막 재사용 | P1 |

## 9.4 AI 싱크 더빙 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| TTS 생성 | 한국어 음성 생성 | P1 |
| TTS 큐 관리 | 생성된 음성을 순서대로 관리 | P1 |
| 원본 볼륨 낮춤 | 영상 음량 자동 조절 | P1 |
| TTS 재생 | 한국어 음성 출력 | P1 |
| 재생속도 제어 | TTS 큐 상태에 따라 영상 속도 조절 | P2 |
| 일시정지 제어 | TTS 준비가 늦을 때 영상 일시정지 | P2 |
| 싱크 상태 표시 | 현재 싱크 지연/정상 상태 표시 | P2 |
| STT 처리 | 자막 없는 영상 음성 인식 | P3 |

## 9.5 AI Provider 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| Provider 선택 | 사용할 AI 엔진 선택 | P0 |
| Codex Login Provider | ChatGPT/Codex 로그인 기반 실험 Provider | P0 |
| OpenAI API Key Provider | OpenAI API Key 기반 사용 | P0 |
| Provider 상태 확인 | 로그인/키 유효성 확인 | P0 |
| 사용량 표시 | Provider별 사용량 표시 | P1 |
| Gemini API Provider | Gemini API 연동 | P2 |
| Claude API Provider | Anthropic API 연동 | P2 |
| DeepL Provider | 번역 특화 Provider | P2 |
| Local Model Provider | 로컬 모델 사용 | P3 |

---

# 10. 비기능 요구사항

## 10.1 성능

- 선택 영역 번역은 3초 이내 결과 표시를 목표로 한다.
- 문단 번역은 스트리밍 방식으로 부분 결과를 우선 표시한다.
- YouTube 자막 번역은 영상 재생 전 또는 초반 버퍼링 구간에서 선처리한다.
- TTS 더빙 모드는 3~5초 지연 동기화를 허용한다.

## 10.2 안정성

- Provider 장애 시 다른 Provider로 전환 가능해야 한다.
- Codex Login Provider가 중단되어도 API Key 모드로 동작해야 한다.
- 번역 실패 시 원문은 유지되어야 한다.
- 영상 제어 실패 시 자막 모드로 자동 전환한다.

## 10.3 보안

- API Key는 로컬 암호화 저장한다.
- 사용자의 세션 쿠키 탈취, 비공식 토큰 추출은 금지한다.
- 공식 인증 흐름 또는 사용자가 직접 입력한 API Key만 사용한다.
- 민감한 웹페이지는 자동 번역 제외 옵션을 제공한다.

## 10.4 확장성

- AI Provider는 Adapter 구조로 교체 가능해야 한다.
- 언어팩은 독립 모듈로 추가 가능해야 한다.
- 번역, STT, TTS, 싱크 제어는 각각 독립 모듈로 분리한다.

---

# 11. 권장 아키텍처

## 11.1 전체 구조

```text
Electron / Chromium App
│
├─ Browser Layer
│  ├─ URL Loader
│  ├─ WebView / BrowserView
│  ├─ Navigation Controller
│  └─ Tab Manager
│
├─ AI Perception Layer
│  ├─ DOM Extractor
│  ├─ Selection Extractor
│  ├─ Subtitle Extractor
│  ├─ Video Detector
│  ├─ Audio Capture
│  └─ OCR Adapter (future)
│
├─ AI Processing Layer
│  ├─ Translation Engine
│  ├─ Summary Engine
│  ├─ Explanation Engine
│  ├─ STT Engine
│  ├─ TTS Engine
│  └─ Provider Adapter
│
├─ Sync Control Layer
│  ├─ Playback Controller
│  ├─ TTS Queue Manager
│  ├─ Delay Analyzer
│  ├─ Volume Ducking Controller
│  └─ Sync Policy Engine
│
├─ UI Layer
│  ├─ Browser Chrome UI
│  ├─ Translation Panel
│  ├─ Subtitle Overlay
│  ├─ TTS Control Panel
│  └─ Settings Page
│
└─ Storage Layer
   ├─ Translation Cache
   ├─ Subtitle Cache
   ├─ Provider Credentials
   ├─ User Preferences
   ├─ Glossary
   └─ Usage Logs
```

## 11.2 Provider Adapter 구조

```text
ProviderAdapter
├─ CodexLoginProvider
├─ OpenAIApiKeyProvider
├─ AnthropicApiKeyProvider
├─ GeminiApiKeyProvider
├─ DeepLProvider
├─ ElevenLabsProvider
└─ LocalModelProvider
```

## 11.3 Provider 전략

### 메인

- Codex/ChatGPT 로그인 기반 Provider
- 초기 진입장벽을 낮추기 위한 실험적 메인 Provider

### 보조

- OpenAI API Key
- Gemini API Key
- Claude API Key
- DeepL API Key
- ElevenLabs API Key
- 로컬 모델

### 설계 원칙

Codex 토큰이 막히더라도 제품이 죽지 않아야 한다.  
제품의 핵심은 특정 Provider가 아니라 AI 브라우저 경험이다.

---

# 12. 데이터 모델 초안

## 12.1 UserSetting

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 설정 ID |
| defaultLanguage | string | 기본 번역 대상 언어 |
| sourceLanguage | string | 원문 언어 |
| translationMode | enum | panel / overlay / replace |
| subtitleMode | enum | translated / bilingual / original |
| ttsEnabled | boolean | TTS 사용 여부 |
| syncMode | enum | off / soft / strict |
| defaultProviderId | string | 기본 Provider |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.2 ProviderCredential

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | Provider Credential ID |
| providerType | enum | codex / openai / claude / gemini / deepl / local |
| displayName | string | 사용자 표시명 |
| authType | enum | oauth / api_key / local |
| encryptedSecret | string | 암호화된 인증 정보 |
| status | enum | active / expired / invalid / disabled |
| lastValidatedAt | datetime | 마지막 검증일 |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.3 TranslationRequest

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 요청 ID |
| sourceText | text | 원문 |
| sourceLanguage | string | 원문 언어 |
| targetLanguage | string | 번역 언어 |
| context | json | 페이지/영상 문맥 |
| requestType | enum | selection / paragraph / page / subtitle / tts_script |
| providerId | string | 사용 Provider |
| status | enum | pending / processing / completed / failed |
| createdAt | datetime | 생성일 |
| completedAt | datetime | 완료일 |

## 12.4 TranslationCache

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 캐시 ID |
| sourceHash | string | 원문 해시 |
| sourceText | text | 원문 |
| translatedText | text | 번역문 |
| sourceLanguage | string | 원문 언어 |
| targetLanguage | string | 대상 언어 |
| providerType | string | 사용 Provider |
| domain | string | 도메인 |
| hitCount | number | 재사용 횟수 |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.5 VideoSession

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 영상 세션 ID |
| url | string | 영상 URL |
| platform | enum | youtube / html5 / other |
| title | string | 영상 제목 |
| duration | number | 영상 길이 |
| currentTime | number | 현재 재생 위치 |
| subtitleStatus | enum | none / detected / extracted / translated |
| ttsStatus | enum | off / preparing / playing / failed |
| syncStatus | enum | normal / delayed / paused / resyncing |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.6 SubtitleSegment

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 세그먼트 ID |
| videoSessionId | string | 영상 세션 ID |
| startTime | number | 시작 시간 |
| endTime | number | 종료 시간 |
| sourceText | text | 원문 자막 |
| translatedText | text | 번역 자막 |
| ttsAudioPath | string | 생성된 TTS 파일 경로 |
| ttsDuration | number | TTS 길이 |
| status | enum | pending / translated / tts_ready / played / failed |

## 12.7 GlossaryTerm

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 용어 ID |
| sourceTerm | string | 원문 용어 |
| targetTerm | string | 번역 용어 |
| description | text | 설명 |
| domain | string | 적용 도메인 |
| isActive | boolean | 사용 여부 |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

---

# 13. CRUD 상세 매트릭스

## 13.1 UserSetting CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 기본 설정 생성 | 최초 실행 시 기본값 생성 | 설정 페이지에서 조회 | 언어/표시방식/Provider 변경 | 초기화 가능 | 로컬 저장 |
| 번역 언어 설정 | 기본 언어 생성 | 현재 대상 언어 조회 | 한국어/일본어 등 변경 | 기본값 복원 | 언어팩과 연결 |
| 자막 표시 설정 | 기본 자막 모드 생성 | 현재 모드 조회 | 원문/번역/병렬 변경 | 기본값 복원 | 영상 기능에서 사용 |
| TTS 설정 | 기본 OFF 생성 | 사용 여부 조회 | ON/OFF 변경 | 기본값 복원 | 더빙 모드와 연결 |
| 싱크 설정 | 기본 soft 생성 | 현재 싱크 정책 조회 | off/soft/strict 변경 | 기본값 복원 | 재생 제어 정책 |

## 13.2 ProviderCredential CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Codex Login 연결 | OAuth/로그인 토큰 저장 | 로그인 상태 조회 | 토큰 갱신 | 연결 해제 | 정책 리스크 존재 |
| OpenAI API Key 등록 | API Key 암호화 저장 | Key 존재 여부 조회 | Key 교체 | Key 삭제 | BYOK 핵심 |
| Claude API Key 등록 | API Key 암호화 저장 | Provider 상태 조회 | Key 교체 | Key 삭제 | 보조 Provider |
| Gemini API Key 등록 | API Key 암호화 저장 | Provider 상태 조회 | Key 교체 | Key 삭제 | 보조 Provider |
| DeepL Key 등록 | API Key 암호화 저장 | Provider 상태 조회 | Key 교체 | Key 삭제 | 번역 특화 |
| Provider 활성화 | Provider 생성 시 active | 현재 활성 Provider 조회 | 기본 Provider 변경 | 비활성화 | 멀티 Provider 구조 |

## 13.3 TranslationRequest CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 선택 영역 번역 요청 | 드래그 후 요청 생성 | 요청 상태 조회 | pending → completed 변경 | 기록 삭제 | P0 |
| 문단 번역 요청 | 문단 단위 요청 생성 | 진행률 조회 | 실패/완료 상태 변경 | 기록 삭제 | P0 |
| 페이지 번역 요청 | 페이지 전체 요청 생성 | 요청 목록 조회 | 부분 완료 업데이트 | 기록 삭제 | P1 |
| 자막 번역 요청 | 자막 세그먼트별 생성 | 세그먼트 상태 조회 | 번역 결과 업데이트 | 기록 삭제 | P0 |
| TTS 스크립트 요청 | 번역문 기반 생성 | TTS 준비 상태 조회 | 음성 경로 업데이트 | 기록 삭제 | P1 |

## 13.4 TranslationCache CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 번역 캐시 저장 | 번역 완료 시 생성 | 같은 원문 해시 조회 | hitCount 증가 | 캐시 삭제 | 비용 절감 핵심 |
| 도메인별 캐시 | 도메인 정보 포함 생성 | 도메인별 조회 | 만료일 갱신 | 도메인 캐시 삭제 | 사이트별 최적화 |
| 자막 캐시 | 영상 자막 번역 저장 | 영상 재방문 시 조회 | 수정 번역 반영 | 영상 캐시 삭제 | YouTube 핵심 |
| Provider별 캐시 | Provider 정보 포함 저장 | Provider별 조회 | 품질 점수 업데이트 | Provider 캐시 삭제 | 품질 비교 가능 |

## 13.5 VideoSession CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 영상 세션 생성 | YouTube/Video 감지 시 생성 | 현재 세션 조회 | currentTime/status 갱신 | 세션 종료 시 삭제/보관 | P0 |
| 자막 상태 관리 | 세션 생성 시 none | 상태 조회 | detected/extracted/translated 변경 | 세션 삭제 시 정리 | P0 |
| TTS 상태 관리 | 더빙 모드 ON 시 생성/갱신 | 현재 TTS 상태 조회 | preparing/playing/failed 변경 | 더빙 OFF 시 정리 | P1 |
| 싱크 상태 관리 | 세션 생성 시 normal | 현재 싱크 상태 조회 | delayed/paused/resyncing 변경 | 세션 종료 시 정리 | P2 |

## 13.6 SubtitleSegment CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 자막 세그먼트 생성 | 자막 추출 시 생성 | 현재 시간대 세그먼트 조회 | 번역문 업데이트 | 세그먼트 삭제 | P0 |
| 번역 자막 저장 | 번역 완료 시 업데이트 | 번역 자막 조회 | 수정 번역 반영 | 캐시 삭제 | P0 |
| TTS 오디오 연결 | TTS 생성 시 경로 저장 | 재생할 오디오 조회 | 재생 상태 업데이트 | 오디오 삭제 | P1 |
| 재생 상태 관리 | 초기 pending | 현재 상태 조회 | played/failed 변경 | 세션 종료 시 정리 | P1 |

## 13.7 GlossaryTerm CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 용어 등록 | 사용자가 용어 추가 | 용어 목록 조회 | 번역어 수정 | 용어 삭제 | P2 |
| 도메인 용어집 | 도메인별 용어 생성 | 도메인별 조회 | 적용 범위 변경 | 도메인 용어 삭제 | 전문 번역 강화 |
| 활성/비활성 | 생성 시 active | 상태 조회 | active 변경 | 삭제 | 번역 품질 관리 |

## 13.8 UsageLog CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Provider 사용량 기록 | 요청 완료 시 생성 | 일/월별 조회 | 비용 추정 업데이트 | 로그 삭제 | 비용 관리 |
| 기능별 사용량 기록 | 번역/STT/TTS별 생성 | 기능별 조회 | 상태 업데이트 | 로그 삭제 | BM 설계에 필요 |
| 실패 로그 기록 | 실패 시 생성 | 에러 분석 조회 | 해결 상태 업데이트 | 오래된 로그 삭제 | 안정성 개선 |

---

# 14. 싱크 더빙 정책 설계

## 14.1 기본 원칙

완전 실시간 동시통역을 목표로 하지 않는다.  
초기 목표는 **3~5초 지연을 허용하는 안정적 한국어 더빙 경험**이다.

## 14.2 싱크 제어 정책

| 상태 | 조건 | 동작 |
|---|---|---|
| 정상 | TTS 큐가 충분함 | 영상 정상 재생 |
| 약간 지연 | 다음 TTS 준비가 1~2초 늦음 | 재생속도 0.9배 |
| 중간 지연 | 다음 TTS 준비가 2~4초 늦음 | 재생속도 0.75~0.85배 |
| 심한 지연 | 다음 TTS 준비가 4초 이상 늦음 | 영상 일시정지 |
| 반복 지연 | 지연이 반복됨 | 자막 모드로 자동 전환 제안 |

## 14.3 TTS 번역 정책

TTS용 번역은 자막용 번역과 다르게 처리한다.

| 구분 | 목표 |
|---|---|
| 자막용 번역 | 정확하고 자연스러운 한국어 |
| TTS용 번역 | 짧고 말하기 쉬운 한국어 |
| 요약형 TTS | 긴 문장을 짧게 압축 |
| 강의형 TTS | 설명을 조금 더 자연스럽게 보완 |

---

# 15. 인증 및 과금 전략

## 15.1 기본 원칙

제품의 핵심은 특정 AI Provider가 아니라 AI 브라우저 경험이다.

따라서 Codex/ChatGPT 로그인 기반 Provider를 메인 진입로로 둘 수는 있지만, 전체 제품 구조는 멀티 Provider 기반이어야 한다.

## 15.2 Provider 전략

| Provider | 역할 | 우선순위 | 리스크 |
|---|---|---|---|
| Codex Login | 초기 메인 Provider | P0 | 정책 변경 가능성 |
| OpenAI API Key | 안정적 보조 Provider | P0 | 사용자가 Key 발급 필요 |
| Gemini API Key | 보조 Provider | P2 | 품질/정책 차이 |
| Claude API Key | 보조 Provider | P2 | API 과금 필요 |
| DeepL | 번역 특화 | P2 | 번역 외 기능 제한 |
| ElevenLabs | TTS 특화 | P2 | 비용 발생 |
| Local Model | 오프라인/프라이버시 | P3 | 품질/설치 난이도 |

## 15.3 금지 전략

- ChatGPT 웹 세션 쿠키 탈취
- 비공식 토큰 추출
- 사용량 제한 우회
- “무제한 무료 AI 번역” 마케팅
- 사용자 계정 프록시화

## 15.4 권장 BM

### 초기

- 무료 PoC
- Codex Login 실험 지원
- OpenAI API Key BYOK 지원

### 베타

- BYOK 무료 사용
- 자체 크레딧 선택 구매
- 고급 TTS/싱크 더빙 유료화

### 상용

- Free: 선택 영역 번역, 제한된 자막 번역
- Pro: 긴 영상, TTS, 싱크 더빙
- Business: 팀 용어집, 중앙 관리, 보안 설정

---

# 16. 우선순위 로드맵

## Phase 0: 기술 검증

- Electron 브라우저 셸 생성
- URL 로드
- DOM 텍스트 추출
- Provider Adapter 기본 구조
- 선택 영역 번역

## Phase 1: 웹 번역 MVP

- 문단 번역
- 번역 패널
- 캐시 저장
- API Key 등록
- Codex Login Provider 실험

## Phase 2: YouTube 자막 MVP

- YouTube 감지
- 자막 추출
- 자막 번역
- 자막 오버레이
- 자막 캐시

## Phase 3: TTS 더빙 MVP

- TTS 생성
- TTS 큐 관리
- 원본 볼륨 낮춤
- 한국어 음성 출력
- 자막 기반 더빙

## Phase 4: 싱크 제어 MVP

- 영상 재생속도 제어
- 영상 일시정지 제어
- 지연 상태 분석
- 싱크 정책 적용

## Phase 5: 확장

- STT 기반 자막 없는 영상 대응
- 일반 HTML5 video 지원
- 국가별 언어팩
- 용어집
- 요약/질의응답

---

# 17. 성공 지표

## 17.1 사용성 지표

| 지표 | 목표 |
|---|---|
| 선택 영역 번역 완료 시간 | 3초 이내 |
| 문단 번역 첫 응답 시간 | 5초 이내 |
| YouTube 자막 오버레이 표시 성공률 | 80% 이상 |
| 번역 캐시 재사용률 | 30% 이상 |
| 영상 더빙 모드 이탈률 | 점진 개선 |

## 17.2 제품 지표

| 지표 | 목표 |
|---|---|
| 첫 실행 후 첫 번역까지 시간 | 1분 이내 |
| 7일 재방문율 | 베타 기준 20% 이상 |
| 주 사용 기능 | 웹 번역 / 자막 번역 / TTS 더빙 중 확인 |
| Provider 연결 성공률 | 80% 이상 |

## 17.3 데모 지표

| 지표 | 목표 |
|---|---|
| YouTube 한국어 더빙 데모 완성 | Phase 3 |
| 영상 싱크 제어 데모 완성 | Phase 4 |
| SNS 공유 가능한 30초 데모 | Phase 4 |

---

# 18. 주요 리스크와 대응

## 18.1 Codex 토큰 정책 리스크

### 리스크

Codex/ChatGPT 로그인 기반 사용이 제한될 수 있다.

### 대응

- Provider Adapter 구조 필수
- OpenAI API Key 모드 병행
- BYOK 지원
- 자체 크레딧 모델 준비

## 18.2 영상 싱크 품질 리스크

### 리스크

TTS 생성 지연으로 영상이 자주 멈추면 UX가 나빠질 수 있다.

### 대응

- 자막 모드 우선 제공
- TTS는 선택 기능으로 제공
- strict sync와 soft sync 분리
- 반복 지연 시 자막 모드 전환

## 18.3 사용자의 브라우저 전환 장벽

### 리스크

사용자가 기존 크롬/엣지를 버리고 새 브라우저를 쓰기 어렵다.

### 대응

- 범용 브라우저가 아니라 AI 콘텐츠 브라우저로 포지셔닝
- 영어 영상/문서 볼 때만 쓰는 특수 목적 브라우저로 시작
- 향후 크롬 확장 버전 보조 제공 가능

## 18.4 AI 비용 리스크

### 리스크

STT/TTS/긴 영상 처리 비용이 높다.

### 대응

- 캐시 적극 활용
- BYOK 지원
- 무료 기능 제한
- 긴 영상은 Pro 기능화
- TTS는 옵션화

## 18.5 사이트 호환성 리스크

### 리스크

YouTube 외 사이트, DRM 사이트, 커스텀 플레이어에서 제어가 어려울 수 있다.

### 대응

- 1차 YouTube 집중
- 2차 HTML5 video 지원
- 3차 사이트별 어댑터 추가
- 제어 실패 시 자막/패널 모드로 fallback

---

# 19. 개발 태스크 초안

## 19.1 Frontend / Electron

- Electron 프로젝트 생성
- BrowserWindow / BrowserView 구성
- URL Bar 구현
- 기본 Navigation 구현
- Translation Panel 구현
- Subtitle Overlay 구현
- Settings Page 구현

## 19.2 Browser Engine Layer

- DOM Extractor 구현
- Selection Extractor 구현
- Video Detector 구현
- YouTube Detector 구현
- Subtitle Extractor 구현
- Playback Controller 구현

## 19.3 AI Layer

- Provider Adapter Interface 설계
- OpenAI API Provider 구현
- Codex Login Provider 실험 구현
- Translation Engine 구현
- Summary Engine 구현
- TTS Engine 구현
- STT Engine 추후 구현

## 19.4 Storage Layer

- SQLite 또는 local database 구성
- ProviderCredential 암호화 저장
- TranslationCache 저장
- SubtitleSegment 저장
- UserSetting 저장
- UsageLog 저장

## 19.5 Sync Layer

- TTS Queue Manager 구현
- Delay Analyzer 구현
- Sync Policy Engine 구현
- Volume Ducking 구현
- Playback Rate Controller 구현

---

# 20. 최종 요약

FlowBrowser AI는 단순 번역기가 아니라, AI가 웹과 영상을 사용자의 언어 경험으로 재구성하는 브라우저다.

초기 MVP는 Electron/Chromium 기반 AI 콘텐츠 브라우저로 시작한다.

가장 먼저 검증해야 할 기능은 다음이다.

1. 웹페이지 DOM 번역
2. 선택 영역 번역
3. YouTube 자막 번역
4. 한국어 TTS 더빙
5. TTS 싱크 기반 영상 재생 제어

Codex/ChatGPT 로그인 기반 사용은 초기 진입장벽을 낮추는 매력적인 전략이지만, 정책 변경 가능성이 있으므로 OpenAI API Key, Gemini, Claude, DeepL, 로컬 모델 등 멀티 Provider 구조가 필수다.

제품의 핵심은 특정 모델이 아니라 다음 자산이다.

- AI 브라우저 경험
- DOM/자막/오디오 통합 인식 구조
- 번역 캐시
- TTS 큐
- 영상 싱크 제어 엔진
- 국가별 언어팩
- 사용자 맞춤 번역 UX

최종 포지셔닝은 다음과 같다.

**영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저**

또는

**AI가 번역 속도에 맞춰 영상까지 조절하는 한국어 싱크 브라우저**

