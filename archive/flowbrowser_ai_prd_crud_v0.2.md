# FlowBrowser AI PRD & CRUD 상세 매트릭스 (v0.2)

## 0. 문서 목적 및 변경 이력

### 0.1 문서 목적

이 문서는 **AI 네이티브 브라우저 / 콘텐츠 번역·더빙 브라우저** 아이디어를 제품 기획 수준으로 정리한 PRD다.
핵심 목적은 기존 크롬/엣지 위에 AI를 얹는 방식이 아니라, 처음부터 AI 접목을 전제로 한 브라우저형 제품을 설계하는 것이다.

### 0.2 v0.2 변경 이력 (2026-05-11)

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

## 1.5 범위 제외 (v0.2 신규)

본 PRD의 MVP 범위는 다음으로 한정한다.

| 구분 | 포함 | 제외 |
|---|---|---|
| OS | Windows / macOS | Linux (개발자 타깃 확장 단계에서 별도 검토) |
| 디바이스 | 데스크톱 | 모바일 브라우저 / 모바일 앱 |
| 폼팩터 | Electron 데스크톱 앱 | 크롬 확장 / 웹 SaaS |

### 모바일 장기 옵션

모바일은 본 PRD 범위 외이며, 장기적으로 다음 중 별도 의사결정한다.

- 클라우드 자막 변환 서비스
- 독립 모바일 앱(자막+TTS 한정)
- 모바일 브라우저 확장

이 결정은 Phase 6 이후 별도 검토한다.

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

"영어 YouTube를 한국어 더빙처럼 볼 수 있는 AI 브라우저"라는 데모는 입소문을 만들 수 있다.

## 4.4 리스크 가설

Codex/ChatGPT 로그인 토큰 기반 사용은 초기 진입장벽을 낮출 수 있지만, 정책 변경 가능성이 있으므로 멀티 Provider 구조가 필요하다.

> v0.2 보강: 4.1 / 4.3은 Phase 0 Spike 5(사용자 인터뷰)에서 검증 후 확정한다.

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

## 5.4 경쟁 제품 분석 (v0.2 신규)

각 카테고리별 비교 대상과 FlowBrowser AI의 차별점(가설). 차별점은 Phase 0 Spike 5에서 사용자 인터뷰로 검증한다.

| 카테고리 | 제품 | 강점 | 한계 | FlowBrowser AI 차별점(가설) |
|---|---|---|---|---|
| AI 브라우저 | Microsoft Edge Copilot | 기존 브라우저 통합, 무료 | 영상 싱크 더빙 약함, 한국어 콘텐츠 특화 부재 | AI 번역/더빙 전용 브라우저 |
| AI 브라우저 | Brave Leo | 브라우저 내장 AI | 한국어 번역 품질 낮음, 영상 더빙 없음 | 한국어 영상 더빙 + 싱크 제어 |
| AI 브라우저 | DIA / Comet (Perplexity) | AI 우선 UX | 검색 중심, 콘텐츠 소비 특화 부재 | 영상/문서 콘텐츠 소비 특화 |
| 번역 확장 | DeepL Web / Google 번역 / 파파고 | 텍스트 번역 품질 | 영상 재생 제어 없음, DOM 통합 한계 | DOM + 자막 + TTS + 재생 제어 통합 |
| YouTube 학습툴 | Language Reactor / Trancy / eJOY | 병렬 자막, 학습 도구 | TTS 더빙/재생 제어 제한 | 한국어 TTS 싱크 더빙 |
| YouTube 공식 | 자동 한국어 더빙 | 플랫폼 내장 | 일부 채널만, 다른 사이트/문서 미적용 | 사용자 단말 중심, 사이트 무관 |

### 차별점 가설 요약

- **유일한 차별점 가설**: "한국어 TTS 더빙 + 영상 재생 싱크 제어"
- 이 가설이 무너지면 (사용자가 자막을 더 선호하면) 차별화 축이 약해짐
- → Phase 0 Spike 5에서 우선 검증

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
- Codex Login Provider 실험 지원 (Phase 0 Spike 1 통과 시)
- OpenAI API Key Provider 지원
- **Privacy Filter (P0, 9.6 참조)**

### 제외 기능

- 완전한 크롬 대체 기능
- 확장 프로그램 호환
- 비밀번호 관리자
- 북마크 동기화
- 멀티 프로필
- OCR
- 실시간 음성 더빙

## 7.2 MVP 2: YouTube 자막 번역 브라우저

### 범위 제한 (v0.2)

**MVP 2는 자막 접근 가능한 YouTube 영상에 한정한다.**
자막 없는 영상은 Phase 5의 STT 기반 기능으로 분리하며, STT 가용성은 Phase 0 Spike 3에서 선검증한다.
또한 임베디드 YouTube(iframe) 환경에서의 동작은 Phase 0 Spike 2에서 별도 검증한다.

### 포함 기능

- YouTube URL 로드
- 영상 플레이어 감지
- 자막 존재 여부 감지
- 영어 자막 추출 (수동/자동 자막)
- 한국어 자막 번역
- 하단 오버레이 자막 표시
- 원문/번역 토글
- 자막 캐시

### 제외 기능

- 자막 없는 영상의 STT (Phase 5)
- 한국어 TTS 더빙 (MVP 3)
- 영상 재생 자동 제어 (MVP 3)
- 광고 구간 제어 (Spike 2 결과에 따라 결정)
- DRM 콘텐츠 / Premium 전용 영상

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

## 8.0 온보딩 시나리오 (v0.2 신규)

### 흐름

1. **첫 실행** — 앱 시작
2. **데이터 처리 / AI 전송 동의** — 사용자가 보는 페이지 콘텐츠가 외부 Provider로 전송될 수 있음을 명시. 동의 없이는 AI 기능 비활성
3. **Privacy Filter 기본 정책 안내** — 로그인 폼/결제/메일/은행/계정 페이지는 자동 번역 비활성화됨을 안내
4. **Provider 선택**
   - Codex Login (Experimental — Phase 0 Spike 1 통과 시에만 노출)
   - OpenAI API Key
   - **나중에 설정 (샘플 체험 모드)**
5. **샘플 체험 모드** — Provider 연결 없이 내장 샘플 영어 문서/영상으로 제품 경험 제공
6. **선택 영역 번역 체험** — 샘플 텍스트에서 드래그 → 번역
7. **YouTube 샘플 영상 자막 번역 체험** — 미리 캐시된 결과로 자막 오버레이 시연

### 핵심 원칙

- **Provider 연결 전에도 제품 가치를 체험할 수 있어야 한다**
- BYOK 마찰(API Key 발급, 결제등록)을 우회할 수 있는 샘플 모드 필수
- Codex Login이 차단되더라도 첫 경험이 무너지지 않아야 한다

### 17.2 지표 연결

"첫 실행 후 첫 번역까지 1분 이내" 지표는 샘플 체험 모드 기준으로 측정한다.

## 8.1 시나리오 1: 영어 웹사이트 읽기

1. 사용자가 FlowBrowser AI를 실행한다.
2. 영어 웹사이트 URL을 입력한다.
3. 브라우저가 페이지를 로드한다.
4. **Privacy Filter가 페이지를 검사한다 (로그인 폼/결제 필드 감지 시 자동 번역 비활성)**
5. 사용자가 "페이지 번역" 버튼을 누른다.
6. 브라우저가 DOM 텍스트를 추출한다.
7. AI Provider가 문단 단위로 번역한다.
8. 번역 결과가 우측 패널 또는 페이지 오버레이에 표시된다.
9. 사용자는 원문/번역을 토글한다.

## 8.2 시나리오 2: 선택 영역 번역

1. 사용자가 웹페이지에서 영어 문장을 드래그한다.
2. 미니 번역 버튼이 나타난다.
3. 사용자가 버튼을 누른다.
4. 선택 문장이 번역된다.
5. 사용자는 번역, 쉬운 설명, 요약 중 하나를 선택할 수 있다.

## 8.3 시나리오 3: YouTube 자막 번역

1. 사용자가 YouTube 영상을 연다.
2. 브라우저가 영상과 자막 존재 여부를 감지한다.
3. 영어 자막이 있으면 자막을 추출한다 (자동 생성 자막은 sourceType=asr로 표기).
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
| YouTube 감지 | YouTube URL/플레이어 감지 (직접 + 임베디드) | P0 |
| 자막 감지 | 영상 자막 존재 여부 확인 | P0 |
| 자막 추출 | 영어 자막 데이터 추출 (수동/자동 구분) | P0 |
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
| STT 처리 | 자막 없는 영상 음성 인식 | P3 (Phase 0 Spike 3에서 가용성만 선검증) |

## 9.5 AI Provider 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| Provider 선택 | 사용할 AI 엔진 선택 | P0 |
| Codex Login Provider | ChatGPT/Codex 로그인 기반 실험 Provider (Spike 1 통과 시) | P0 (조건부) |
| OpenAI API Key Provider | OpenAI API Key 기반 사용 | P0 |
| Provider 상태 확인 | 로그인/키 유효성 확인 | P0 |
| 사용량 표시 | Provider별 사용량 표시 (UsageLog 12.8) | P1 |
| Gemini API Provider | Gemini API 연동 | P2 |
| Claude API Provider | Anthropic API 연동 | P2 |
| DeepL Provider | 번역 특화 Provider | P2 |
| Local Model Provider | 로컬 모델 사용 | P3 |

## 9.6 Privacy Filter (v0.2 신규)

AI 브라우저는 사용자가 보는 페이지를 외부 Provider로 전송할 수 있어, 민감 페이지 차단을 **정책이 아닌 기능 모듈**로 구현한다.

| 기능 | 설명 | 우선순위 |
|---|---|---|
| password input 감지 | `<input type="password">` 존재 시 페이지 자동 번역 비활성 | P0 |
| 카드 입력 필드 감지 | Payment Request API, 카드 패턴(번호/CVC/만료일) 감지 | P0 |
| 도메인 블랙리스트 (기본) | 메일/은행/결제/계정 도메인 키워드 기반 차단 | P0 |
| 사용자 도메인 블랙리스트 | 사용자가 추가한 도메인 차단 | P1 |
| 사용자 도메인 화이트리스트 | 사용자가 명시 허용한 도메인 (블랙리스트 우회) | P1 |
| 수동 승인 요구 | 민감 페이지에서 번역 시도 시 명시적 사용자 승인 다이얼로그 | P0 |
| 전송 로그 | 어떤 도메인의 어떤 콘텐츠가 어느 Provider로 전송됐는지 기록 (UsageLog 연결) | P1 |

### 기본 도메인 블랙리스트 키워드

`mail.*`, `accounts.*`, `account.*`, `*.bank`, `banking.*`, `pay.*`, `checkout.*`, `payment.*`, `login.*`, `signin.*`, `oauth.*`, `id.*`

(정규 운영 시 사용자 피드백 기반 갱신)

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

## 10.3 보안 (v0.2 강화)

### 핵심 결정문

**FlowBrowser AI는 사용자의 명시적 요청 없이 로그인 폼, 결제 페이지, 메일함, 은행, 계정 설정 페이지의 내용을 외부 AI Provider로 전송하지 않는다.**

이 결정문은 9.6 Privacy Filter 기능 모듈로 구현된다.

### 추가 원칙

- API Key는 OS Keychain에 위임 저장한다 (12.2 참조). 앱 자체는 마스터 키를 보관하지 않는다.
- 사용자의 세션 쿠키 탈취, 비공식 토큰 추출은 금지한다.
- 공식 인증 흐름 또는 사용자가 직접 입력한 API Key만 사용한다.
- 첫 실행 시 데이터 처리 / AI 전송 동의 화면을 제공한다 (8.0 참조).
- 도메인 블랙리스트는 9.6의 기본 키워드를 포함한다.
- 모든 Provider 전송은 UsageLog(12.8)에 기록되어 사용자가 추후 감사 가능하다.

## 10.4 확장성

- AI Provider는 Adapter 구조로 교체 가능해야 한다.
- 언어팩은 독립 모듈로 추가 가능해야 한다.
- 번역, STT, TTS, 싱크 제어는 각각 독립 모듈로 분리한다.
- Privacy Filter는 다른 모듈과 독립 적용 가능해야 한다.

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
├─ Privacy Layer (v0.2 신규)
│  ├─ Sensitive Field Detector (password / card)
│  ├─ Domain Filter (blacklist / whitelist)
│  ├─ Consent Gate
│  └─ Transmission Logger
│
├─ AI Perception Layer
│  ├─ DOM Extractor
│  ├─ Selection Extractor
│  ├─ Subtitle Extractor
│  ├─ Video Detector (direct + iframe)
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
│  ├─ Onboarding / Sample Mode
│  └─ Settings Page
│
└─ Storage Layer
   ├─ Translation Cache
   ├─ Subtitle Cache
   ├─ Provider Credentials (OS Keychain 위임)
   ├─ User Preferences
   ├─ Glossary
   └─ Usage Logs
```

### 데이터 흐름 원칙

모든 외부 전송 경로는 **Privacy Layer를 반드시 거친다**. AI Perception → AI Processing → Provider 구간에 Privacy Layer가 게이트로 위치하며, 차단된 콘텐츠는 Provider Adapter에 도달하지 않는다.

## 11.2 Provider Adapter 구조

```text
ProviderAdapter
├─ CodexLoginProvider (Experimental — Phase 0 Spike 1 통과 시)
├─ OpenAIApiKeyProvider
├─ AnthropicApiKeyProvider
├─ GeminiApiKeyProvider
├─ DeepLProvider
├─ ElevenLabsProvider
└─ LocalModelProvider
```

## 11.3 Provider 전략 (v0.2 수정)

### 메인 (조건부)

**Codex Login Provider는 Phase 0 Spike 1 검증을 통과한 경우에만 메인 Provider로 활성화한다.**
공식 인증 경로(OpenAI 공식 OAuth 또는 정책 허용 흐름)가 확인되지 않을 경우, MVP 기본 Provider는 OpenAI API Key 방식으로 한다.

ChatGPT 웹 세션 쿠키 재사용 / 비공식 토큰 추출 / 사용량 우회는 어떤 경우에도 금지한다 (15.3 참조).

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
| privacyFilterEnabled | boolean | Privacy Filter 활성 여부 (기본 true) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.2 ProviderCredential (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | Provider Credential ID |
| providerType | enum | codex / openai / claude / gemini / deepl / local |
| displayName | string | 사용자 표시명 |
| authType | enum | oauth / api_key / local |
| keychainRef | string | OS Keychain 항목 식별자 (실제 secret 미보관) |
| status | enum | active / expired / invalid / disabled |
| lastValidatedAt | datetime | 마지막 검증일 |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### 키 관리 방식 (v0.2 결정)

- **secret 자체는 앱이 보관하지 않는다.**
- macOS: Keychain Services
- Windows: DPAPI (Data Protection API)
- 통합 인터페이스: Electron `safeStorage` API
- 앱은 `keychainRef`만 보관, 실제 호출 시 OS에서 secret을 fetch
- 마스터 패스워드 없이도 OS 사용자 세션 보호에 위임

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
| privacyDecision | enum | allowed / blocked / user_approved | (v0.2 신규) |
| status | enum | pending / processing / completed / failed |
| createdAt | datetime | 생성일 |
| completedAt | datetime | 완료일 |

## 12.4 TranslationCache (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 캐시 ID |
| sourceHash | string | 원문 해시 (sha256) |
| sourceText | text | 원문 |
| translatedText | text | 번역문 |
| sourceLanguage | string | 원문 언어 |
| targetLanguage | string | 대상 언어 |
| providerType | string | 사용 Provider |
| glossaryVersion | string | 적용 시 용어집 버전 |
| domain | string | 도메인 |
| hitCount | number | 재사용 횟수 |
| expiresAt | datetime | 만료일 (TTL) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### 조회 키 (v0.2 결정)

복합 unique 키: `(sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion)`

### TTL 정책

- 기본 번역 캐시: 90일
- 자막 캐시 (videoSessionId 연결): 365일
- 용량 한도: 사용자 디스크 1GB, 초과 시 LRU 만료
- glossaryVersion 변경 시 해당 용어집 적용 캐시 자동 무효화

## 12.5 VideoSession (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 영상 세션 ID |
| url | string | 영상 URL |
| platform | enum | youtube_direct / youtube_embedded / html5 / other |
| embedHost | string | iframe 임베디드 시 호스트 도메인 |
| title | string | 영상 제목 |
| duration | number | 영상 길이 |
| currentTime | number | 현재 재생 위치 (메모리 상태, 5분/세션종료 시 영속화) |
| subtitleStatus | enum | none / detected / extracted / translated |
| ttsStatus | enum | off / preparing / playing / failed |
| syncStatus | enum | normal / delayed / paused / resyncing |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### currentTime 영속화 정책

- 메모리 상태로 1초 단위 갱신
- 디스크 영속화는 5분 간격 또는 세션 종료 시
- 디스크 I/O 폭증 방지

## 12.6 SubtitleSegment (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 세그먼트 ID |
| videoSessionId | string | 영상 세션 ID |
| startTime | number | 시작 시간 |
| endTime | number | 종료 시간 |
| sourceText | text | 원문 자막 |
| translatedText | text | 번역 자막 |
| sourceType | enum | human / asr / generated (v0.2 신규) |
| ttsAudioPath | string | 생성된 TTS 파일 경로 |
| ttsDuration | number | TTS 길이 |
| status | enum | pending / translated / tts_ready / played / failed |

### sourceType 의미

- `human`: 영상 제작자 또는 사람이 작성한 수동 자막 (품질 신뢰 가능)
- `asr`: YouTube 자동 생성 자막 (품질 가변, 번역 시 보정 필요)
- `generated`: STT로 생성한 자막 (Phase 5)

## 12.7 GlossaryTerm

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 용어 ID |
| sourceTerm | string | 원문 용어 |
| targetTerm | string | 번역 용어 |
| description | text | 설명 |
| domain | string | 적용 도메인 |
| isActive | boolean | 사용 여부 |
| version | string | 용어집 버전 (캐시 무효화 키) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.8 UsageLog (v0.2 신규)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 로그 ID |
| providerId | string | 사용 Provider |
| feature | enum | translation / stt / tts / summary / explanation |
| inputTokens | number | 입력 토큰 |
| outputTokens | number | 출력 토큰 |
| audioSeconds | number | TTS/STT 시 오디오 길이 |
| estimatedCost | decimal | 예상 비용 (Provider 단가 기반 추정) |
| domain | string | 요청 발생 도메인 |
| privacyDecision | enum | allowed / user_approved (blocked는 기록되지 않음) |
| status | enum | success / failed |
| errorCode | string | 실패 코드 |
| createdAt | datetime | 생성일 |

### 활용

- 사용자에게 일/월별 사용량 표시 (9.5)
- BM 설계용 단가/비용 시뮬레이션
- 실패 패턴 분석 (안정성 개선)
- 외부 전송 감사 로그 (10.3)

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
| Privacy Filter 설정 | 기본 ON 생성 | 활성 여부 조회 | ON/OFF 변경 | 기본값 복원 | v0.2 신규 |

## 13.2 ProviderCredential CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Codex Login 연결 | OAuth/공식 인증 토큰 OS Keychain 저장 | keychainRef로 상태 조회 | 토큰 갱신 | Keychain 항목 삭제 | Spike 1 통과 시에만 노출 |
| OpenAI API Key 등록 | API Key OS Keychain 저장 | keychainRef로 존재 확인 | Key 교체 | Keychain 항목 삭제 | BYOK 핵심 |
| Claude API Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 보조 Provider |
| Gemini API Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 보조 Provider |
| DeepL Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 번역 특화 |
| Provider 활성화 | Provider 생성 시 active | 현재 활성 Provider 조회 | 기본 Provider 변경 | 비활성화 | 멀티 Provider 구조 |

## 13.3 TranslationRequest CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 선택 영역 번역 요청 | 드래그 후 요청 생성 | 요청 상태 조회 | pending → completed 변경 | 기록 삭제 | P0 |
| 문단 번역 요청 | 문단 단위 요청 생성 | 진행률 조회 | 실패/완료 상태 변경 | 기록 삭제 | P0 |
| 페이지 번역 요청 | 페이지 전체 요청 생성 | 요청 목록 조회 | 부분 완료 업데이트 | 기록 삭제 | P1 |
| 자막 번역 요청 | 자막 세그먼트별 생성 | 세그먼트 상태 조회 | 번역 결과 업데이트 | 기록 삭제 | P0 |
| TTS 스크립트 요청 | 번역문 기반 생성 | TTS 준비 상태 조회 | 음성 경로 업데이트 | 기록 삭제 | P1 |
| Privacy 차단 요청 | Privacy Filter가 차단 시 기록 | 차단 이력 조회 | — | 사용자 삭제 | v0.2 신규 |

## 13.4 TranslationCache CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 번역 캐시 저장 | 번역 완료 시 생성 | 복합 키로 조회 | hitCount 증가, expiresAt 갱신 | TTL 만료 시 LRU 삭제 | 비용 절감 핵심 |
| 도메인별 캐시 | 도메인 정보 포함 생성 | 도메인별 조회 | 만료일 갱신 | 도메인 캐시 삭제 | 사이트별 최적화 |
| 자막 캐시 | 영상 자막 번역 저장 (TTL 365일) | 영상 재방문 시 조회 | 수정 번역 반영 | 영상 캐시 삭제 | YouTube 핵심 |
| Provider별 캐시 | Provider 정보 포함 저장 | Provider별 조회 | 품질 점수 업데이트 | Provider 캐시 삭제 | 품질 비교 가능 |
| 용어집 버전 변경 | — | — | glossaryVersion 불일치 캐시 무효화 | 자동 만료 | v0.2 신규 |

## 13.5 VideoSession CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 영상 세션 생성 | YouTube/Video 감지 시 생성 (direct/embedded 구분) | 현재 세션 조회 | currentTime/status 갱신 | 세션 종료 시 삭제/보관 | P0 |
| 자막 상태 관리 | 세션 생성 시 none | 상태 조회 | detected/extracted/translated 변경 | 세션 삭제 시 정리 | P0 |
| TTS 상태 관리 | 더빙 모드 ON 시 생성/갱신 | 현재 TTS 상태 조회 | preparing/playing/failed 변경 | 더빙 OFF 시 정리 | P1 |
| 싱크 상태 관리 | 세션 생성 시 normal | 현재 싱크 상태 조회 | delayed/paused/resyncing 변경 | 세션 종료 시 정리 | P2 |

## 13.6 SubtitleSegment CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 자막 세그먼트 생성 | 자막 추출 시 sourceType 포함 생성 | 현재 시간대 세그먼트 조회 | 번역문 업데이트 | 세그먼트 삭제 | P0 |
| 번역 자막 저장 | 번역 완료 시 업데이트 | 번역 자막 조회 | 수정 번역 반영 | 캐시 삭제 | P0 |
| TTS 오디오 연결 | TTS 생성 시 경로 저장 | 재생할 오디오 조회 | 재생 상태 업데이트 | 오디오 삭제 | P1 |
| 재생 상태 관리 | 초기 pending | 현재 상태 조회 | played/failed 변경 | 세션 종료 시 정리 | P1 |

## 13.7 GlossaryTerm CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 용어 등록 | 사용자가 용어 추가 (version 증가) | 용어 목록 조회 | 번역어 수정 (version 증가) | 용어 삭제 | P2 |
| 도메인 용어집 | 도메인별 용어 생성 | 도메인별 조회 | 적용 범위 변경 | 도메인 용어 삭제 | 전문 번역 강화 |
| 활성/비활성 | 생성 시 active | 상태 조회 | active 변경 | 삭제 | 번역 품질 관리 |

## 13.8 UsageLog CRUD (v0.2 명세 추가)

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Provider 사용량 기록 | 요청 완료 시 토큰/오디오/비용 기록 | 일/월별 조회 | 비용 추정 갱신 | 사용자 수동 삭제 | 비용 관리 |
| 기능별 사용량 기록 | 번역/STT/TTS별 생성 | 기능별 조회 | 상태 업데이트 | 90일 이후 자동 정리 | BM 설계 |
| 실패 로그 기록 | 실패 시 errorCode 포함 생성 | 에러 분석 조회 | 해결 상태 업데이트 | 오래된 로그 삭제 | 안정성 개선 |
| 외부 전송 감사 | privacyDecision 기록 | 사용자 감사 조회 | — | 사용자 수동 삭제 | v0.2 보안 |

## 13.9 PrivacyFilter CRUD (v0.2 신규)

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 도메인 화이트리스트 | 사용자 추가 | 목록 조회 | 항목 수정 | 항목 삭제 | P1 |
| 도메인 블랙리스트 | 사용자 추가 | 목록 조회 | 항목 수정 | 항목 삭제 | P1 |
| 차단 이력 조회 | Privacy Filter 차단 시 자동 기록 | 사용자 조회 | — | 일괄 삭제 | UsageLog 연동 |
| 수동 승인 토큰 | 사용자 승인 시 생성 (세션 한정) | 활성 토큰 조회 | — | 세션 종료 시 자동 삭제 | P0 |

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

> 실제 적용 가능한 정책 매개변수(0.9배·0.75배·4초 임계)는 Phase 0 Spike 4의 TTS 지연 측정 결과로 캘리브레이션한다.

---

# 15. 인증 및 과금 전략

## 15.1 기본 원칙

제품의 핵심은 특정 AI Provider가 아니라 AI 브라우저 경험이다.

따라서 Codex/ChatGPT 로그인 기반 Provider를 메인 진입로로 둘 수는 있지만, 전체 제품 구조는 멀티 Provider 기반이어야 하며, **Codex Login은 Phase 0 Spike 1 통과 시에만 메인으로 활성화한다**.

## 15.2 Provider 전략

| Provider | 역할 | 우선순위 | 리스크 |
|---|---|---|---|
| Codex Login | 메인 진입로 후보 (Spike 1 통과 조건부) | P0 (조건부) | 정책 변경 가능성 |
| OpenAI API Key | 안정적 메인 Provider (Spike 1 미통과 시 기본) | P0 | 사용자가 Key 발급 필요 |
| Gemini API Key | 보조 Provider | P2 | 품질/정책 차이 |
| Claude API Key | 보조 Provider | P2 | API 과금 필요 |
| DeepL | 번역 특화 | P2 | 번역 외 기능 제한 |
| ElevenLabs | TTS 특화 | P2 | 비용 발생 |
| Local Model | 오프라인/프라이버시 | P3 | 품질/설치 난이도 |

## 15.3 금지 전략 (v0.2 강화)

다음은 어떤 경우에도 금지한다.

- **ChatGPT 웹 세션 / 쿠키 재사용** (v0.2 명시)
- **비공식 토큰 추출** (Codex CLI 인증 우회 등 비공식 접근)
- 사용량 제한 우회
- "무제한 무료 AI 번역" 마케팅
- 사용자 계정 프록시화

### Codex Login Provider의 허용 조건 (v0.2 결정문)

> Codex Login Provider는 OpenAI가 공식적으로 허용하는 인증 흐름이 Phase 0 Spike 1에서 확인된 경우에만 활성화한다.
> 공식 인증 흐름이 확인되지 않을 경우, 해당 Provider는 Experimental 단계에 머무르거나 제거하며, MVP 기본 Provider는 OpenAI API Key 방식으로 대체한다.

## 15.4 권장 BM

### 초기

- 무료 PoC
- 샘플 체험 모드 (Provider 연결 없이)
- Codex Login 실험 지원 (Spike 1 통과 시)
- OpenAI API Key BYOK 지원

### 베타

- BYOK 무료 사용
- 자체 크레딧 선택 구매
- 고급 TTS/싱크 더빙 유료화

### 상용

- Free: 선택 영역 번역, 제한된 자막 번역
- Pro: 긴 영상, TTS, 싱크 더빙
- Business: 팀 용어집, 중앙 관리, 보안 설정

> Pro 가격(월 4,900원 / 9,900원 / 크레딧 / BYOK 선호도)은 Phase 0 Spike 5 인터뷰의 지불 의사 응답으로 결정한다.

---

# 16. 우선순위 로드맵 (v0.2 전면 개편)

## Phase 0: 치명 가설 검증 Spike

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

- STT 기반 자막 없는 영상 대응 (Spike 3 통과 시)
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
| YouTube 자막 오버레이 표시 성공률 (수동 자막) | 90% 이상 |
| YouTube 자막 오버레이 표시 성공률 (자동 자막) | 70% 이상 |
| 번역 캐시 재사용률 | 30% 이상 (베이스라인 측정 후 재설정) |
| 영상 더빙 모드 이탈률 | 점진 개선 |

## 17.2 제품 지표

| 지표 | 목표 |
|---|---|
| 첫 실행 후 첫 번역까지 시간 (샘플 체험 모드 기준) | 1분 이내 |
| 7일 재방문율 | 베타 기준 15% 이상 (소비자 앱 평균 ~10% 대비 보수적 상향) |
| 주 사용 기능 | 웹 번역 / 자막 번역 / TTS 더빙 중 확인 |
| Provider 연결 성공률 | 90% 이상 |
| Privacy Filter 차단 정확도 (false positive 기준) | 사용자 불만 < 5% |

## 17.3 데모 지표

| 지표 | 목표 |
|---|---|
| YouTube 한국어 더빙 데모 완성 | Phase 3 |
| 영상 싱크 제어 데모 완성 | Phase 4 |
| SNS 공유 가능한 30초 데모 | Phase 4 |

### 30초 데모 시나리오 (v0.2 신규)

- 0~5초: 영어 YouTube 영상 재생 (한국어 시청자가 이해 못 하는 상태)
- 5~10초: AI 더빙 모드 ON 클릭
- 10~25초: 한국어 TTS가 영상에 맞춰 재생, 영상이 자연스럽게 0.9배 → 정상 → 일시정지 → 재개
- 25~30초: "FlowBrowser AI" 로고 + 다운로드 링크

---

# 18. 주요 리스크와 대응

## 18.1 Codex 토큰 정책 리스크

### 리스크
Codex/ChatGPT 로그인 기반 사용이 제한될 수 있다.

### 대응
- Phase 0 Spike 1로 사전 검증
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
- Phase 0 Spike 4로 임계값 사전 캘리브레이션

## 18.3 사용자의 브라우저 전환 장벽

### 리스크
사용자가 기존 크롬/엣지를 버리고 새 브라우저를 쓰기 어렵다.

### 대응
- 범용 브라우저가 아니라 AI 콘텐츠 브라우저로 포지셔닝
- 영어 영상/문서 볼 때만 쓰는 특수 목적 브라우저로 시작
- 향후 크롬 확장 버전 보조 제공은 1.3 핵심 컨셉(확장 한계)과의 정합성 재검토 후 결정

## 18.4 AI 비용 리스크

### 리스크
STT/TTS/긴 영상 처리 비용이 높다.

### 대응
- 캐시 적극 활용 (TTL 365일 자막 캐시)
- BYOK 지원
- 무료 기능 제한
- 긴 영상은 Pro 기능화
- TTS는 옵션화
- UsageLog로 사용자 비용 가시성 제공

## 18.5 사이트 호환성 리스크

### 리스크
YouTube 외 사이트, DRM 사이트, 커스텀 플레이어에서 제어가 어려울 수 있다.

### 대응
- 1차 YouTube 집중 (직접 + 임베디드)
- 2차 HTML5 video 지원
- 3차 사이트별 어댑터 추가
- 제어 실패 시 자막/패널 모드로 fallback

## 18.6 Privacy 리스크 (v0.2 신규)

### 리스크
사용자가 보는 민감 페이지가 외부 Provider로 전송될 경우 신뢰도 붕괴.

### 대응
- Privacy Filter P0 모듈 (9.6)
- 도메인 블랙리스트 기본 제공
- password / 카드 필드 자동 감지
- 첫 실행 동의 흐름
- UsageLog 감사 가능

---

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

---

# 20. 최종 요약

FlowBrowser AI는 단순 번역기가 아니라, AI가 웹과 영상을 사용자의 언어 경험으로 재구성하는 브라우저다.

초기 MVP는 Electron/Chromium 기반 AI 콘텐츠 브라우저로 시작하되, **본격 개발 착수 전에 5종 Spike로 치명 가설을 검증한다**.

가장 먼저 검증해야 할 가설은 다음이다.

1. Codex Login Provider를 정책 위반 없이 사용할 수 있는가 (Spike 1)
2. YouTube 자막 추출과 재생 제어가 직접/임베디드 환경에서 안정적인가 (Spike 2)
3. STT를 위한 시스템 오디오 캡처가 추가 설치 없이 가능한가 (Spike 3)
4. TTS 품질·지연·비용이 14장 싱크 정책과 양립 가능한가 (Spike 4)
5. 사용자가 자막보다 한국어 TTS 더빙을 실제로 선호하며 지불 의사가 있는가 (Spike 5)

가장 먼저 검증한 후 구현해야 할 핵심 기능은 다음이다.

1. 웹페이지 DOM 번역 (Privacy Filter 통과)
2. 선택 영역 번역
3. YouTube 자막 번역 (자막 접근 가능 영상 한정)
4. 한국어 TTS 더빙 (Spike 4 Provider)
5. TTS 싱크 기반 영상 재생 제어

Codex/ChatGPT 로그인 기반 사용은 초기 진입장벽을 낮추는 매력적인 전략이지만, 정책 변경 가능성과 공식 인증 경로 확인 여부에 따라 활성화하므로, OpenAI API Key, Gemini, Claude, DeepL, 로컬 모델 등 멀티 Provider 구조가 필수다.

제품의 핵심은 특정 모델이 아니라 다음 자산이다.

- AI 브라우저 경험
- DOM/자막/오디오 통합 인식 구조
- Privacy Filter 신뢰
- 번역 캐시
- TTS 큐
- 영상 싱크 제어 엔진
- 국가별 언어팩
- 사용자 맞춤 번역 UX

최종 포지셔닝은 다음과 같다.

**영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저**

또는

**AI가 번역 속도에 맞춰 영상까지 조절하는 한국어 싱크 브라우저**
