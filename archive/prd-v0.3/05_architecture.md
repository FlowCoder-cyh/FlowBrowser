> [← PRD 목차](./README.md)

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
│  ├─ Subtitle Extractor (postMessage IFrame API + caption track URL fetch — v0.3 Spike 2)
│  ├─ Video Detector (direct + iframe — postMessage)
│  ├─ Audio Capture (desktopCapturer + getDisplayMedia / electron-audio-loopback — v0.3 Spike 3)
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
├─ CodexLoginProvider (Experimental — Spike 1 1차 통과, 공식 등록 부재, 공개 클라이언트 재사용)
├─ OpenAIApiKeyProvider (MVP 기본 — Codex 폴백 포함)
├─ AnthropicApiKeyProvider
├─ GeminiApiKeyProvider
├─ DeepLProvider
├─ ElevenLabsProvider (TTS 특화 — Flash v2.5 / Multilingual v2)
└─ LocalModelProvider (Kokoro-82M 등 Apache 2.0 라이선스만 — Coqui XTTS-v2는 비상용 라이선스로 영구 제외)
```

## 11.3 Provider 전략 (v0.3 갱신)

### 메인 (조건부)

**Codex Login Provider는 Phase 0 Spike 1 1차 조사를 통과하여 Experimental 라벨로 활성화된다.** 단, 다음 조건:

- 공식 OAuth 등록 / 파트너 프로그램 부재 — 공개 Codex 클라이언트(`app_EMoamEEZ73f0CkXaXp7hrann`) + PKCE device-code flow 재사용 (OpenClaw·Roo Code 패턴)
- OpenAI 측 명시 차단 없음 (회색지대) — G-011 적용
- UI에 "OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드, OpenAI가 차단할 가능성 있음" 고지
- 정책 변경 / 클라이언트 ID 무효화 감지 시 OpenAI API Key 모드로 즉시 자동 폴백 (§18.1)
- Phase 1 PoC에서 실제 비용 / 한도 / 차단 시그널 / 모델 가용성 / refresh token 만료 측정 후 v0.3.1 갱신

ChatGPT 웹 세션 쿠키 재사용 / 비공식 토큰 추출 / 사용량 우회 / 계정 프록시화는 어떤 경우에도 금지 (§15.3 / G-003).

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
