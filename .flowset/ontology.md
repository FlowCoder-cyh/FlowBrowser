# FlowBrowser AI — 도메인 온톨로지

> 본 문서는 FlowBrowser AI의 도메인 개념 정의(글로서리)와 개념 간 관계(관계 사전)를 통합한 단일 사전이다.
> PRD 12장 데이터 모델을 확장하여, 데이터 모델에 직접 등장하지 않는 추상 개념·정책·프로세스 명사도 포함한다.
> 본 문서는 코드/PRD와 함께 진화한다. 새로운 개념·관계 발견 시 즉시 추가.

## 0. 표기 약속

- 표제어는 **굵게**, 영문 표기는 괄호 병기
- "→" 는 단방향 관계, "↔" 는 양방향 관계
- "[PRD 12.X]"는 PRD 데이터 모델 출처
- 개념 간 의존이 있으면 `참조: 다른개념` 명시

---

## 1. 핵심 개념 (Core Concepts)

### 1.1 제품 / 범위

#### **FlowBrowser AI**
영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저. Electron/Chromium 기반 데스크톱 앱.
- 범위: Windows / macOS, 데스크톱
- 비범위: Linux MVP, 모바일 (PRD 1.5)

#### **MVP**
Minimum Viable Product. PRD 7장에서 MVP 1~3 정의.
- MVP 1: AI 웹 번역 브라우저
- MVP 2: YouTube 자막 번역 브라우저 (자막 접근 가능 영상 한정)
- MVP 3: AI 싱크 더빙

#### **Phase**
프로젝트 진행 단계. Phase 0~5.
- Phase 0: 치명 가설 검증 Spike (현재)
- Phase 1: 웹 번역 MVP (코드 착수)
- Phase 2: YouTube 자막 MVP
- Phase 3: TTS 더빙 MVP
- Phase 4: 싱크 제어 MVP
- Phase 5: 확장 (STT, 다국어 등)

#### **Spike**
Phase 0의 치명 가설 검증 단위. 5종 (Codex 인증 / YouTube / 오디오 캡처 / TTS 3축 / 사용자 인터뷰).

---

### 1.2 Provider 계층

#### **Provider**
AI 모델 제공자. OpenAI, Anthropic, Google(Gemini), DeepL, ElevenLabs, 로컬 모델 등.

#### **ProviderAdapter** [PRD 11.2]
Provider별 API 호출을 통일된 인터페이스로 추상화한 모듈. 교체 가능 구조.
- 종류: CodexLoginProvider / OpenAIApiKeyProvider / AnthropicApiKeyProvider / GeminiApiKeyProvider / DeepLProvider / ElevenLabsProvider / LocalModelProvider

#### **ProviderCredential** [PRD 12.2]
Provider 인증 정보. secret 자체는 OS Keychain에 위임 저장.
- 필드: `keychainRef` (실제 secret 미보관), authType, status
- 관계: Provider 1—N ProviderCredential

#### **Codex Login Provider** (Experimental)
Codex/ChatGPT 로그인 기반 Provider. Phase 0 Spike 1 검증 통과 시에만 활성화.
- 미통과 시: Experimental 유지 또는 제거, 기본 Provider는 OpenAI API Key

#### **BYOK** (Bring Your Own Key)
사용자가 직접 발급한 API Key를 등록하는 방식. OpenAI / Claude / Gemini / DeepL 모두 BYOK 지원.

---

### 1.3 Privacy 계층

#### **Privacy Filter** [PRD 9.6, 11.1]
민감 페이지를 외부 Provider로 전송하지 않도록 차단하는 P0 기능 모듈.
- 구성: Sensitive Field Detector / Domain Filter / Consent Gate / Transmission Logger
- 위치: AI Perception → AI Processing → Provider 게이트

#### **Sensitive Field**
페이지 내 민감 입력 요소.
- password input: `<input type="password">`
- 카드 입력 필드: Payment Request API, 카드 패턴(번호/CVC/만료일)

#### **Domain Blacklist / Whitelist**
도메인 단위 차단/허용 목록.
- 기본 블랙리스트: `mail.*` `accounts.*` `banking.*` `payment.*` `login.*` `signin.*` `oauth.*` `id.*` 등 (PRD 9.6)
- 사용자 추가 가능

#### **Consent Gate**
사용자의 명시적 동의 없이는 외부 전송 금지.
- 첫 실행 동의
- 민감 페이지 수동 승인 토큰 (세션 한정)

#### **수동 승인 토큰의 무력화 범위 (Sprint 001 결정)**
수동 승인 토큰(`manualApprovalToken`)은 다음을 **우회할 수 있다**:
- `password field` 차단
- `card field` 차단
- 도메인 블랙리스트 차단

수동 승인 토큰으로도 **우회 불가능한** 안전 정책:
- **본문 카드 번호 패턴 감지** (`detectCardPatternInText`) — 전송 텍스트 자체에 13~19자리 카드 번호 패턴이 포함되면 차단. 토큰 보유 여부와 무관.

이유: 사용자가 페이지를 승인해도, 실제 전송 본문에 카드 번호가 들어가는 것은 사용자 실수일 가능성이 더 높음. 의도된 강제 안전 정책.

#### **BlockReason** (Sprint 003 결정)
Privacy Filter 차단 사유 enum. `evaluatePrivacy()` 반환의 `blockReason` 필드.
- `none`: 차단 아님 (`allowed | user_approved`)
- `consent`: 전역 동의 미보유
- `password`: password input 필드 존재 (수동 승인 없음)
- `card_field`: 카드 입력 필드 존재 (수동 승인 없음)
- `card_pattern`: 본문 카드 번호 패턴 (수동 승인 무력)
- `domain`: 도메인 블랙리스트 매치 (수동 승인 없음)

평가 우선순위는 위에서 아래로. 첫 매치 사유로 즉시 차단 반환.

기존 `blockedBy` 필드는 호환 유지 (`password_field | card_field | domain_blacklist | consent_revoked`).

#### **pageWideBlock** (Sprint 003 결정)
차단 시 페이지 전체 차단 여부 boolean. `evaluatePrivacy()` 반환의 `pageWideBlock` 필드.
- 모든 `BlockReason !== 'none'` 시 true (사용자가 명시 차단 가능한 모든 사유는 page-wide로 통일)
- `allowed | user_approved` 시 false
- 호출자(예: paragraph/page 번역 반복문)는 본 필드 true 시 후속 청크/문단을 즉시 중단해야 함

Sprint 002까지는 reason 문자열(`'전역 동의' | '비밀번호' | '결제'`)을 매칭해 page-wide 판정했으나, Sprint 003에서 enum + boolean으로 구조화.

---

### 1.4 번역 계층

#### **TranslationRequest** [PRD 12.3]
번역 요청 단위.
- requestType: selection / paragraph / page / subtitle / tts_script
- privacyDecision: allowed / blocked / user_approved

#### **TranslationCache** [PRD 12.4]
번역 결과 캐시.
- 복합 키: `(sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion)`
- TTL: 기본 90일 / 자막 365일
- 만료: TTL + LRU

#### **GlossaryTerm** [PRD 12.7]
사용자 정의 용어집 항목.
- version 변경 시 해당 캐시 자동 무효화

#### **자막용 번역 vs TTS용 번역** [PRD 14.3]
- 자막용: 정확하고 자연스러운 한국어
- TTS용: 짧고 말하기 쉬운 한국어 (별도 처리)

---

### 1.5 영상 / 자막 계층

#### **VideoSession** [PRD 12.5]
영상 재생 세션.
- platform: youtube_direct / youtube_embedded / html5 / other
- subtitleStatus: none / detected / extracted / translated
- ttsStatus: off / preparing / playing / failed
- syncStatus: normal / delayed / paused / resyncing

#### **SubtitleSegment** [PRD 12.6]
자막 단위 세그먼트.
- sourceType:
  - **human** — 수동 자막, 신뢰 높음
  - **asr** — 자동 생성, 가변 품질
  - **generated** — STT (Phase 5)

#### **YouTube 직접 vs 임베디드**
- 직접: youtube.com에서 재생
- 임베디드: 다른 사이트의 iframe에 삽입된 YouTube
- Phase 0 Spike 2에서 두 환경 모두 검증

---

### 1.6 TTS / 싱크 계층

#### **TTS Queue**
생성된 한국어 음성 파일을 순서대로 관리하는 큐.

#### **Volume Ducking**
TTS 재생 시 원본 영상 음량을 낮추는 기능.

#### **Sync Policy** [PRD 14.2]
TTS 큐 상태에 따라 영상 재생을 제어하는 정책.
- 정상 / 약간 지연(0.9배) / 중간 지연(0.75~0.85배) / 심한 지연(일시정지) / 반복 지연(자막 모드)
- 모드: off / soft / strict

#### **Soft Sync vs Strict Sync**
- soft: 사용자 경험 우선, 자막 모드 fallback 적극
- strict: 더빙 우선, 영상 일시정지 적극

---

### 1.7 운영 / 관측

#### **UsageLog** [PRD 12.8]
Provider 사용량 기록 + 외부 전송 감사 로그.
- 토큰 / 오디오 사용량
- 예상 비용
- privacyDecision 기록 (감사 가능)

#### **Sample Mode** (샘플 체험 모드) [PRD 8.0]
Provider 연결 없이 내장 샘플로 제품 경험을 제공하는 온보딩 모드.

---

## 2. 관계 다이어그램 (Relations)

### 2.1 인증 흐름

```
사용자
  → Onboarding
  → ProviderCredential 생성
  → OS Keychain (secret 저장)
  → ProviderAdapter (호출 시 secret fetch via safeStorage)
  → Provider (외부 API)
```

### 2.2 번역 요청 흐름

```
사용자 액션 (선택 / 페이지 / 자막)
  → TranslationRequest 생성
  → Privacy Filter 평가
    ├─ blocked → UsageLog 미기록 → 종료
    └─ allowed / user_approved
        → TranslationCache 조회
          ├─ hit → 캐시 반환 → hitCount++
          └─ miss
              → ProviderAdapter 호출
              → 결과 → TranslationCache 저장
              → UsageLog 기록 (토큰 / 비용 / privacyDecision)
              → 사용자에게 표시
```

### 2.3 영상 더빙 흐름

```
VideoSession 감지 (direct / embedded 구분)
  → SubtitleSegment 추출 (sourceType 기록: human / asr)
  → 자막 번역 (TranslationCache 활용)
  → TTS용 번역 별도 생성 (자막 번역과 다름)
  → TTS Engine 호출 → ttsAudioPath
  → TTS Queue 적재
  → Sync Policy 실행
    ├─ TTS 준비 충분 → 정상 재생 + Volume Ducking
    ├─ 1~2초 지연 → playbackRate 0.9
    ├─ 2~4초 지연 → playbackRate 0.75~0.85
    ├─ 4초+ 지연 → pause
    └─ 반복 지연 → 자막 모드 전환 제안
```

### 2.4 데이터 모델 핵심 관계

- Provider 1—N ProviderCredential
- ProviderCredential 1—1 OS Keychain Item (`keychainRef`)
- VideoSession 1—N SubtitleSegment
- SubtitleSegment 1—0..1 TTSAudio (`ttsAudioPath`)
- TranslationRequest N—1 Provider (`providerId`)
- TranslationCache 무관계, 복합 키 조회만
- GlossaryTerm 1—N TranslationCache (`glossaryVersion`)
- UsageLog ←— 모든 외부 전송 (감사 출처)

---

## 3. 상태 머신 (State Machines)

### 3.1 SubtitleSegment.status

```
pending → translated → tts_ready → played
                                 → failed
       → failed
```

### 3.2 VideoSession.subtitleStatus

```
none → detected → extracted → translated
```

### 3.3 VideoSession.syncStatus [PRD 14.2]

```
normal ⇄ delayed ⇄ paused
                  → resyncing → normal
delayed (반복) → 자막 모드 전환 제안
```

### 3.4 ProviderCredential.status

```
active ⇄ expired
       ⇄ invalid
       → disabled (사용자 비활성화)
```

### 3.5 TranslationRequest.privacyDecision

```
(생성) → allowed (Filter 통과)
      → blocked (자동 차단, UsageLog 미기록)
      → user_approved (수동 승인 토큰 보유)
```

---

## 4. 정책 명사 (Policy Terms)

#### **PROJECT_CLASS = hybrid**
FlowSet v4.0.4의 프로젝트 분류. PRD/문서가 코드만큼 핵심 자산이라는 선언.

#### **Phase 0 게이트**
Spike 5종 미통과 시 본격 코드 착수 금지 (G-002).

#### **인증 금지선** (G-003)
ChatGPT 웹 쿠키 / 비공식 토큰 / 사용량 우회 / 계정 프록시화 절대 금지. PRD 15.3.

#### **OS Keychain 위임**
secret 자체를 앱이 보관하지 않음. macOS Keychain / Windows DPAPI / Electron `safeStorage`. PRD 12.2.

#### **30초 데모 시나리오** [PRD 17.3]
- 0~5초: 영어 영상 재생
- 5~10초: 더빙 모드 ON
- 10~25초: 한국어 TTS + 영상 싱크 (0.9배 → 정상 → pause → 재개)
- 25~30초: 로고 + 다운로드 링크

SNS 공유용 핵심 자산.

---

## 5. 외부 표준 / 호환

| 표준 | 용도 | 사용처 |
|---|---|---|
| **WebContentsView** | Electron 웹 콘텐츠 컨테이너 | BrowserView 후속 (PRD 19.1) |
| **safeStorage** | Electron OS Keychain 추상화 | ProviderCredential (PRD 12.2) |
| **WASAPI Loopback** | Windows 시스템 오디오 캡처 | Spike 3 |
| **Screen Capture Kit** | macOS 13+ 시스템 오디오 캡처 | Spike 3 |
| **Payment Request API** | 브라우저 결제 표준 | Privacy Filter 카드 감지 |
| **electron-updater** | 자동 업데이트 | 19.6 운영 인프라 |
| **Authenticode** | Windows 코드 사이닝 | 19.6 |
| **Apple Developer ID** | macOS 코드 사이닝 | 19.6 |

---

## 6. 미정의 / 검증 대기

다음 개념은 Phase 0 Spike 결과 후 정의 / 구체화:

- **Codex Login Provider 인증 흐름** — Spike 1 결과 (공식 OAuth / 파트너 / 제거 중 택일)
- **YouTube 광고 / DRM 제어 전략** — Spike 2 결과
- **STT 가용성 정책** — Spike 3 결과 (자체 캡처 / 자막 한정 / Phase 5 보류 중 택일)
- **TTS Provider 선정** — Spike 4 결과
- **Pro 가격 / 크레딧 단위** — Spike 5 결과

본 섹션은 Spike 결과 도출 시 해당 절로 이동/통합한다.

---

## 변경 이력

- 2026-05-11: 온톨로지 v1 초기 작성 (PRD v0.2 12장 데이터 모델 + 도메인 개념 + 관계 + 상태 머신 + 정책 명사 + 외부 표준 통합)
