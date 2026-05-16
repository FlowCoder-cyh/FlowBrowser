# 12. Provider 어댑터 (Provider Adapter)

> [← PRD 목차](./README.md)

본 섹션은 외부 AI Provider 추상화 — 실제 코드 `src/ai/ProviderAdapter.ts` 인터페이스 + 구현체 (OpenAIApiKeyProvider / CodexLoginProvider / Phase 3 LocalLLMProvider). [§01 §1.4.2](./01_overview.md#142-동작-원칙) BYOK vs 능동 호출 정합.

## 12.1 ProviderAdapter 인터페이스

```typescript
// src/ai/ProviderAdapter.ts (KEEP, A1 §C)
export interface ProviderAdapter {
  readonly providerId: string  // 'openai-key' | 'codex' | 'local-llm' (Phase 3)
  readonly providerType: 'openai-key' | 'codex' | 'local-llm'

  // 채팅 호출 (Phase 1 base — 텍스트 생성)
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<ChatResponse>
  chatStream?(messages: ChatMessage[], opts?: ChatOpts): AsyncIterable<ChatStreamChunk>

  // 임베딩 호출 (Phase 1 신규)
  embed?(text: string, opts?: EmbedOpts): Promise<EmbedResponse>
}
```

Phase 1 시점 (PR b7):
- **CodexLoginProvider**: `chat()` + `chatStream()` 구현. `embed()` 미지원 (Codex 임베딩 API 없음)
- **OpenAIApiKeyProvider**: `chat()` 구현 (현재 stream:false fetch). `chatStream()` M5 PoC 도입. `embed()` M3 도입
- **(Phase 3) LocalLLMProvider**: `chat()` + `chatStream()` (Ollama 패턴). `embed()` 옵션

## 12.2 Provider 구현체 매트릭스

| Provider | 모델 | Capability | 인증 | TX | Phase | 사용처 |
|---|---|---|---|---|---|---|
| **OpenAI API Key (BYOK)** | gpt-4o-mini (저가 디폴트) / text-embedding-3-small | chat / chatStream / embed | API Key (OS Keychain) | external | 1 | 자동 인덱싱·태깅·임베딩 (BYOK 디폴트) + 사용자 능동 채팅 옵션 |
| **Codex OAuth** | gpt-5.5 reasoning low (기본) / 사용자 명시 변경 | chat / chatStream (SSE Responses API) | OAuth device-code (PKCE, OS Keychain) | external | 1 | 사용자 능동 채팅 (명시 동의). 자동 호출 X (G-003 강화) |
| **(Phase 3) Local LLM** | Ollama 기본 모델 (llama 3.x / qwen 등) / 사용자 선택 | chat / chatStream / embed (옵션) | endpoint 설정 (localhost:11434) | local | 3 | 오프라인 / 민감 페이지 / Privacy First |

## 12.3 BYOK 디폴트 정책 (G-003 강화)

[§01 §1.4.2](./01_overview.md#142-동작-원칙) + [§08 §8.3.2](./08_indexing.md#832-byok-디폴트-정책-g-003-강화) 정합.

### 12.3.1 호출 종류별 Provider 선택

| 호출 | 디폴트 Provider | 사용자 변경 |
|---|---|---|
| 자동 인덱싱 임베딩 (§08) | **OpenAI API Key (BYOK)** | Codex OAuth 사용은 사용자 명시 동의 시 (`UserSetting.allowCodexForAuto = true`) |
| 자동 태깅 (§08) | **OpenAI API Key (BYOK)** | 동상 |
| 백그라운드 번역 (Phase 2) | **OpenAI API Key (BYOK)** | 동상 |
| **사용자 능동 AI 채팅 (§10)** | UserSetting.defaultProviderId (사용자 선택) | 자유 선택 — API Key / Codex OAuth / (Phase 3) Local LLM 모두 가능 |

### 12.3.2 사유

- ChatGPT 구독 한도 (5h/주) 보호 — 자동 백그라운드 호출이 한도 묵시 소진 시 사용자 능동 사용 불가
- G-003 인증 금지선 강화 — "사용량 한도 우회" 회색지대 회피
- 사용자가 명시 동의 시 Codex 사용 가능 (UI 옵션) — 사용자 결정권 유지

### 12.3.3 BYOK 미설정 시

- 자동 인덱싱·태깅: **임베딩 큐에서 보류** + "API Key 등록 필요" 인디케이터 표시 (MemoryStatsPanel)
- 사용자 능동 채팅: Codex OAuth credential 있으면 자동 fallback. 둘 다 없으면 SettingsPage 진입 유도

## 12.4 모델 선택 정책

### 12.4.1 OpenAI API Key 디폴트 모델

| 호출 | 모델 | 사유 |
|---|---|---|
| 채팅 (Phase 1 디폴트) | `gpt-4o-mini` | 저가 (input $0.15/M, output $0.60/M, 2026-05-16) — M5 PoC 시 GPT-5 계열로 변경 검토 |
| 임베딩 | `text-embedding-3-small` | $0.02/M = $0.00002/1k tokens (2026-05-16). 1024 차원 (`dimensions=1024` 축소) |
| 자동 태깅 (Phase 1) | `gpt-4o-mini` | JSON schema 강제 (Structured Outputs 지원) |

사용자 변경: SettingsPage > GeneralPanel 에서 모델 명 직접 입력 (UI 미정, M5 결정).

### 12.4.2 Codex OAuth 모델

- 기본: `gpt-5.5` reasoning effort `low` (M3-7 핫픽스 검증)
- 사용자 변경: 변경 불가 (Codex API 가 모델 자동 선택 — gpt-5.5 / gpt-5 / 등). reasoning effort 만 사용자 선택 (`low / medium / high`)

### 12.4.3 모델 fallback 체인

채팅 호출 실패 시 자동 fallback:

```
1. UserSetting.defaultProviderId 시도
   ↓ 실패 (rate limit / 401 / 5xx)
2. 같은 Provider 다른 모델 시도 (예: gpt-4o-mini 실패 → gpt-4o)
   └─ 모델별 retry 1회
   ↓ 실패
3. 다른 Provider 시도 (BYOK 실패 시 Codex OAuth, 또는 그 반대)
   └─ Provider 별 retry 1회
   ↓ 실패
4. AiChatHistory.status='failed' + KI-NNN 등록
```

자동 백그라운드 호출 (인덱싱·태깅·임베딩) 은 fallback X — BYOK 디폴트만 시도, 실패 시 큐 보류 (G-003 강화).

## 12.5 Rate Limit + Backoff

[§08 §8.3.3 EmbeddingQueue](./08_indexing.md#833-embeddingqueue-정책) 정합.

| Provider | Rate limit (2026-05-16 기준) | Backoff |
|---|---|---|
| OpenAI API Key | tier 1: 3 RPM / 200 TPM 임베딩 등 (tier 별로 다름, 공식 문서 참조) | 5초 / 30초 / 5분 / 30분 / 포기 (5종) |
| Codex OAuth | ChatGPT 구독 5h/주 | 한도 초과 시 즉시 fallback (사용자 알림) |
| (Phase 3) Local LLM | endpoint 부하 | endpoint 응답 timeout 30초 후 retry 1회 |

### 12.5.1 OpenAI tier 자동 감지

응답 헤더 `x-ratelimit-*` 파싱 — 남은 한도 모니터링 + 80% 도달 시 사용자 인디케이터 (Phase 2+ 옵션).

## 12.6 Cost Tracking (UsageLog 재활용)

v0.3 `src/storage/UsageLog.ts` (KEEP, A1 §C) 재활용 — 호출별 비용 누적.

| 로그 필드 | 비고 |
|---|---|
| timestamp | |
| provider_id | 'openai-key' / 'codex' / 'local-llm' |
| model | 'gpt-4o-mini' / 'text-embedding-3-small' / ... |
| operation | 'chat' / 'embed' / 'tag' |
| input_tokens / output_tokens | OpenAI 응답 `usage` 필드 |
| cost_usd | 모델별 가격 곱 (`OpenAIApiKeyProvider.MODEL_PRICING` 정합) |
| workspace_id | 워크스페이스 단위 비용 추적 |

### 12.6.1 사용자 표시 (SettingsPage > UsagePanel)

- 워크스페이스별 월 비용 분포
- Provider별 분포
- 임계 알림 (사용자 설정 월 한도 도달 시 추가 호출 차단 옵션)

### 12.6.2 Codex OAuth 비용

Codex 는 ChatGPT 구독 한도 (5h/주) 기반이라 USD 비용 X. 대신 "사용 시간" 추정 (호출당 ~30초 가정).

## 12.7 G-003 강화 — 자동 호출 BYOK 디폴트

본 §12 의 핵심 정책. PR b3.1·b4.1·b5.1·b6.1 누적 학습 통합:

| 영역 | 정책 |
|---|---|
| 정체성 | UA 위장 X, 자체 브랜드 ([§01 §1.3](./01_overview.md#13-정체성--자체-브라우저-정직한-식별)) |
| ChatGPT 한도 | Codex OAuth 자동 호출 X (인덱싱·태깅·임베딩 BYOK) — 사용량 우회 회색지대 회피 |
| 사용자 동의 | 자동 호출에 Codex 사용은 UserSetting 명시 토글 필요 |
| 결격사유 0 | 사이트와 무관한 사용자 본인 credential 사용 (G-003 + G-011 정합) |

## 12.8 Phase 3 LocalLLMProvider (간략)

상세는 [§06 §6.7.2 Phase 3](./06_architecture.md#672-phase-3-추가-모듈) + Phase 3 contract 작성 시. 본 §12 는 Phase 1 base.

### 12.8.1 도입 의의

- **오프라인 가능** — 인터넷 없이 AI 채팅 사용
- **민감 페이지** — 의료·법무·금융 콘텐츠 외부 API 미전송
- **무료** — API 비용 0 (전기료만)

### 12.8.2 도입 부담

- Ollama 등 외부 LLM 런타임 설치 + 모델 다운로드 (수 GB)
- 성능 — 사용자 하드웨어 의존 (M2 Mac 기본 / RTX 4090 강력 등)
- Phase 3 contract 진입 시 사용자 시연 + 모델별 정량 임계 측정

## 12.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §7 (임베딩 모델) + §10 (Phase 3 로컬 LLM) + §17 P0~P2 (Codex OAuth / BYOK 디폴트 / G-003 강화)
- `.flowset/specs/v04-migration-matrix.md` §C KEEP (Codex OAuth 4 모듈 / OpenAIApiKeyProvider / Credentials)
- [§01 §1.4.2 동작 원칙](./01_overview.md#142-동작-원칙)
- [§08 §8.3 EmbeddingClient + §8.3.2 BYOK](./08_indexing.md#83-embeddingclient-byok-openai-text-embedding-3-small)
- [§10 §10.7 Provider 선택](./10_ai_chat.md#107-provider-선택-사용자-능동-호출)
- 실제 코드:
  - `src/ai/ProviderAdapter.ts` (인터페이스)
  - `src/ai/providers/OpenAIApiKeyProvider.ts` (MODEL_PRICING / fetch 기반 chat)
  - `src/ai/providers/CodexLoginProvider.ts` (Codex Responses API + SSE)
  - `src/storage/Credentials.ts` (safeStorage)
  - `src/storage/UsageLog.ts` (비용 추적)

본 §12 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 12.10 변경 이력

- 2026-05-16 (PR b7): stub → 본문 작성. ProviderAdapter 인터페이스 + 구현체 3종 매트릭스 (OpenAI BYOK / Codex OAuth / Phase 3 Local LLM) + BYOK 디폴트 정책 (G-003 강화, 호출 종류별 매트릭스) + 모델 선택 (gpt-4o-mini 저가 디폴트 / text-embedding-3-small 1024 / Codex gpt-5.5) + 4 단계 fallback 체인 + Rate limit 5종 backoff + UsageLog 비용 추적 + Phase 3 LocalLLMProvider 의의·부담 명시.
