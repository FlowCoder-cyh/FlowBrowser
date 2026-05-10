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
