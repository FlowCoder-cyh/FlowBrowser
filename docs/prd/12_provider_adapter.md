# 12. Provider 어댑터 (Provider Adapter)

> [← PRD 목차](./README.md)

본 섹션은 외부 AI Provider 추상화 — 실제 코드 `src/ai/ProviderAdapter.ts` 인터페이스 + 구현체 (OpenAIApiKeyProvider / CodexLoginProvider / Phase 3 `OllamaProvider` [로컬 chat+embed]). [§01 §1.4.2](./01_overview.md#142-동작-원칙) BYOK vs 능동 호출 정합.

## 12.1 ProviderAdapter 인터페이스 (v0.3 현재 + v0.4 마이그레이션)

### 12.1.1 v0.3 현재 인터페이스 (실제 코드)

```typescript
// src/ai/ProviderAdapter.ts (v0.3 KEEP / v0.4 GENERALIZE)
export interface ProviderAdapter {
  readonly info: ProviderInfo
  validate(): Promise<{ ok: boolean; reason?: string }>
  translate(input: TranslationInput): Promise<TranslationOutput>
  dispose?(): Promise<void>
}
```

### 12.1.2 v0.4 마이그레이션 spec (M2 PR 분류 변경: KEEP → GENERALIZE)

v04-migration-matrix §C KEEP 분류는 PR b7.1 시점 정정 — ProviderAdapter 는 **GENERALIZE** (translate → chat / embed 분리 + 재설계). v04-migration-matrix §B 갱신 동반.

```typescript
// v0.4 신규 인터페이스 (M2 PR 도입 spec)
export interface ProviderAdapter {
  readonly info: ProviderInfo
  validate(): Promise<{ ok: boolean; reason?: string }>

  // 채팅 호출 (M2 신규)
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<ChatResponse>
  chatStream?(messages: ChatMessage[], opts?: ChatOpts): AsyncIterable<ChatStreamChunk>

  // 임베딩 호출 (M3 신규)
  embed?(text: string, opts?: EmbedOpts): Promise<EmbedResponse>

  // 어댑터 호환 (v0.3 → v0.4 점진 마이그레이션, M5 종료 시 제거)
  translate?(input: TranslationInput): Promise<TranslationOutput>  // deprecated

  dispose?(): Promise<void>
}
```

### 12.1.3 도입 시점 (현 코드 vs 미래)

| 메서드 | v0.3 현재 | M2 도입 | M3 도입 | M5 도입 |
|---|---|---|---|---|
| `info` / `validate` / `dispose` | ✓ | (유지) | — | — |
| `translate` (deprecated) | ✓ | (유지, M5 종료 시 제거) | — | — |
| `chat()` (단발 호출) | ✗ | ✓ (CodexLoginProvider 가 v0.3 translate 내부 SSE 누적 — chat() 으로 wrap) | (유지) | (유지) |
| `chatStream()` | ✗ | ✗ | ✗ | ✓ (M5 PoC, ChatPanel streaming) |
| `embed()` | ✗ | ✗ | ✓ (OpenAIApiKeyProvider 신규 메서드, text-embedding-3-small) | (유지) |

**PR b7.1 시점 코드 사실 (Phase 1 도입 전)**:
- `CodexLoginProvider.translate()` 단일 메서드 — 내부에서 SSE 누적 후 `TranslationOutput` 반환 (`src/ai/providers/CodexLoginProvider.ts:123`, `accumulateResponsesStream`)
- `OpenAIApiKeyProvider.translate()` 단일 메서드 — `fetch /chat/completions stream:false` (`src/ai/providers/OpenAIApiKeyProvider.ts`)

> **v0.5.0 갱신 (도입 완료)**: 위 §12.1.3 의 M2/M3/M5 "도입 예정" 은 실 코드로 박힘 — OpenAI/Codex `chat()` (M2), OpenAI `embed()` (M3) 구현 완료. Phase 3 에서 `OllamaProvider.chat()`+`embed()` 추가 (§12.8). `chatStream()` 만 미도입 (defer). 본 §12.1.3 표는 도입 _순서_ 기록으로 유지.

## 12.2 Provider 구현체 매트릭스

| Provider | 모델 | Capability | 인증 | TX | Phase | 사용처 |
|---|---|---|---|---|---|---|
| **OpenAI API Key (BYOK)** | gpt-4o-mini (저가 디폴트) / text-embedding-3-small | translate (v0.3 현재) / chat·embed (M2/M3 신규) / chatStream (M5) | API Key (OS Keychain) | external | 1 | 자동 인덱싱·태깅·임베딩 (BYOK 디폴트) + 사용자 능동 채팅 옵션 |
| **Codex OAuth** | gpt-5.5 (디폴트) / gpt-5.4-mini / gpt-5.2 (`AVAILABLE_MODELS` 정합) — gpt-5 는 코드 주석에 "not supported" 명시 | translate (v0.3 현재, SSE 내부 누적) / chat (M2 신규 wrap) / chatStream (M5) | OAuth device-code (PKCE, OS Keychain) | external | 1 | 사용자 능동 채팅 (명시 동의). 자동 호출 X (G-003 강화) |
| **(Phase 3 ✅ wiring 박힘) Local LLM — `OllamaProvider`** | chat: `llama3.2:3b` 디폴트 (+ llama3.1:8b/qwen2.5:7b/mistral:7b) / embed: `nomic-embed-text` 768 | **chat ✅ (Sprint 017 T14) / embed ✅ (Sprint 018 T17c, `supportsEmbed=true`) / chatStream ✗ defer** | endpoint (Ollama 기본 `http://localhost:11434`, raw fetch — `ollama` npm 미사용) | local | 3 | 오프라인 / 민감 페이지 / Privacy First. `providerType='local'`, `defaultProviderId='local'` 시 OpenAI fallback 금지 |

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
- `AVAILABLE_MODELS` (실제 코드 `CodexLoginProvider.ts:33`): **`gpt-5.5` / `gpt-5.4-mini` / `gpt-5.2`** 3종 허용. `gpt-5` 는 코드 주석에 `"not supported when using Codex with a ChatGPT account"` 명시 → 거론 X (PR b7.1 정정)
- 사용자 변경: `modelHint` 파라미터로 위 3종 중 선택 가능 (M5 ChatPanel UI 도입 시 사용자 선택 노출). reasoning effort 는 현재 코드 `effort: 'low'` 하드코딩 — M5 PoC 시 UI 도입으로 사용자 선택 (`low / medium / high`) 가능

### 12.4.3 모델 fallback 체인 (능동 채팅 호출 한정)

**적용 범위**: 본 체인은 **사용자 능동 채팅 호출 (§10 ChatService)** 에만 적용. 자동 백그라운드 호출 (인덱싱·태깅·임베딩) 은 fallback X (§12.4.4 참조, G-003 강화).

**임베딩 호출**은 모델 단일 (text-embedding-3-small) 이라 fallback 적용 불가.

```
1. UserSetting.defaultProviderId 시도 (예: openai-key + gpt-4o-mini)
   ↓ 실패
2. error code 분류:
   ├─ 401 / auth_invalid → step 5 (인증 fallback 차단, 재로그인 유도)
   ├─ 429 (rate limit) → 동일 Provider retry 1회 (지수 백오프)
   └─ 5xx → 다음 step
   ↓ 실패
3. 같은 Provider 다른 모델 시도 (예: gpt-4o-mini → gpt-4o)
   └─ 모델별 retry 1회
   ↓ 실패
4. 다른 Provider 시도 (사용자 명시 동의 시) 
   └─ BYOK ↔ Codex OAuth 자동 전환은 비용·구독 한도 영향 — UI 알림 + 사용자 동의 토글
   ↓ 실패
5. AiChatHistory.status='failed' + KI-NNN 등록 + 사용자 "재시도" 버튼
```

### 12.4.4 fallback 제한 (비용 폭주 방지)

| 제한 | 기본값 | 사유 |
|---|---|---|
| max fallback attempts | 1 단발 호출당 **최대 3** (step 1+2+3 또는 step 1+3+4) | 비용 증폭 방지 |
| max estimated cost / 호출 | $0.10 (사용자 settings 조정 가능) | BYOK 호출 비용 cap |
| 401 자동 fallback | **차단** | 인증 실패는 재로그인 유도 (감사 추적 보호) |
| Codex OAuth 자동 전환 | **사용자 명시 동의 시만** | ChatGPT 한도 묵시 소진 방지 (G-003 강화) |
| **자동 호출 fallback** | **0** (큐 보류만) | BYOK 디폴트, Provider 미설정 시 큐 보류 |

월 한도 알림 (Phase 1):
- BYOK 월 사용량 사용자 설정 한도 도달 시 추가 호출 전 확인 dialog (M5 ChatService 도입 시)
- 워크스페이스별 비용 분석은 [§12.6](#126-cost-tracking-usagelog-재활용)

## 12.5 Rate Limit + Backoff

[§08 §8.3.3 EmbeddingQueue](./08_indexing.md#833-embeddingqueue-정책) 정합.

| Provider | Rate limit (2026-05-16 기준 OpenAI 공식 / Codex 추정) | Backoff | Timeout |
|---|---|---|---|
| OpenAI API Key tier 1 (PR b7.1 정정) | **chat gpt-4o-mini ≈ 500 RPM / 200K TPM**, **embedding text-embedding-3-small ≈ 3,000 RPM / 1M TPM** (정확 수치 OpenAI 공식 rate limits 페이지 [docs](https://platform.openai.com/docs/guides/rate-limits)) — tier 2~5 는 더 높음 | 5초 / 30초 / 5분 / 30분 / 포기 (5종) | **30초** (단발 호출) |
| Codex OAuth | ChatGPT 구독 한도 (Plus 추정 ~80 메시지/주, Pro 더 높음 — 2026-05-16 추정, 공식 공시 없음). 429 응답 시 fallback | 한도 초과 시 즉시 사용자 알림 + BYOK 자동 전환 동의 dialog | **60초** (Codex Responses API + SSE streaming) |
| (Phase 3) Local LLM | endpoint 부하 (사용자 하드웨어 의존) | endpoint 응답 timeout 30초 후 retry 1회 | **사용자 설정** (디폴트 30초) |

> **PR b7.1 정정**: PR b7 의 "tier 1: 3 RPM / 200 TPM" 은 외부 사실 오류 (실제 최소 1000배 차이). 정확 수치는 OpenAI 공식 rate limits 페이지 참조 — tier 1 기본은 sustainable 운영 가능 수준.

### 12.5.1 OpenAI tier 자동 감지

응답 헤더 4종 모니터링:
- `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests`
- `x-ratelimit-limit-tokens` / `x-ratelimit-remaining-tokens`

남은 한도 80% 도달 시 사용자 인디케이터 표시 (Phase 2+ 옵션, MemoryStatsPanel 또는 별도 alert).

## 12.6 Cost Tracking (UsageLog GENERALIZE — PR b7.1 정정)

v0.3 `src/storage/UsageLog.ts` 는 v04-migration-matrix §C KEEP 분류였으나 **PR b7.1 시점 GENERALIZE 재분류** — schema 확장 + feature enum 변경 필요.

### 12.6.1 v0.3 현재 schema (실제 코드)

```typescript
// src/storage/UsageLog.ts:13-29 실제 UsageLogEntry
export interface UsageLogEntry {
  id: string
  providerId: string
  feature: Feature  // 'translation' | 'summary' | 'tts' | 'stt' | 'explanation'
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number  // 호출 시점 OpenAIApiKeyProvider.MODEL_PRICING_PER_M_TOKENS 로 계산 후 전달
  domain: string
  privacyDecision: 'allowed' | 'user_approved'
  status: UsageStatus
  errorCode?: string
  createdAt: number
}
```

**현재 부재**:
- `workspaceId` 컬럼 (워크스페이스별 비용 추적 불가)
- `model` 컬럼 (모델별 비용 재계산 불가, `estimatedCostUsd` 만 저장)
- v0.4 feature `'chat' / 'embed' / 'tag'` enum 값 (현재 v0.3 use case 만)

### 12.6.2 v0.4 schema 마이그레이션 (M3 PR 진입 시)

```typescript
// v0.4 신규 UsageLogEntry (M3 schema 확장)
export interface UsageLogEntry {
  id: string
  providerId: string
  workspaceId?: string  // NEW (M3) — 워크스페이스별 분석. nullable (v0.3 데이터 호환)
  feature: Feature  // CHANGE: v0.3 enum 폐기 + v0.4 enum 추가 → 'chat' | 'embed' | 'tag' | 'background_translation' (P2)
  model?: string  // NEW (M3) — 'gpt-4o-mini' / 'text-embedding-3-small' / 'gpt-5.5' 등
  inputTokens: number
  outputTokens: number
  durationMs?: number  // NEW (M3, Codex Responses API duration 실측 저장) — "30초 추정" 대체
  estimatedCostUsd: number  // 호출 시점 계산 후 전달 (위치는 OpenAIApiKeyProvider.MODEL_PRICING_PER_M_TOKENS)
  domain: string
  privacyDecision: 'allowed' | 'user_approved'
  status: UsageStatus
  errorCode?: string
  createdAt: number
}
```

> v0.3 `feature: 'translation' / 'summary' / 'tts' / 'stt' / 'explanation'` 5종은 폐기 ([§19 마이그레이션](./19_migration_v03_v04.md) 동반). 마이그레이션 시 5종 이전 데이터는 archive (분석 retention 1년) 또는 폐기.

### 12.6.3 사용자 표시 (SettingsPage > UsagePanel, M3 schema 후)

- 워크스페이스별 월 비용 분포 (workspace_id 추가 후 가능)
- Provider 별 / 모델별 분포 (model 컬럼 추가 후 가능)
- 임계 알림 (사용자 설정 월 한도 도달 시 추가 호출 확인 dialog) — Phase 1 M5 도입

### 12.6.4 Codex OAuth 비용

Codex 는 ChatGPT 구독 한도 기반이라 USD 비용 0 (`CodexLoginProvider.translate` 결과 `estimatedCostUsd: 0`). 대신:
- **durationMs 실측 저장** (M3 schema 후) — Codex Responses API 응답의 duration 값 활용 (PR b7 "30초 추정" 정정)
- 워크스페이스별 사용 시간 분석 (M3 후)

## 12.7 G-003 강화 — 자동 호출 BYOK 디폴트

본 §12 의 핵심 정책. PR b3.1·b4.1·b5.1·b6.1 누적 학습 통합:

| 영역 | 정책 |
|---|---|
| 정체성 | UA 위장 X, 자체 브랜드 ([§01 §1.3](./01_overview.md#13-정체성--자체-브라우저-정직한-식별)) |
| ChatGPT 한도 | Codex OAuth 자동 호출 X (인덱싱·태깅·임베딩 BYOK) — 사용량 우회 회색지대 회피 |
| 사용자 동의 | 자동 호출에 Codex 사용은 UserSetting 명시 토글 필요 |
| 결격사유 0 | 사이트와 무관한 사용자 본인 credential 사용 (G-003 + G-011 정합) |

## 12.8 Local LLM — `OllamaProvider` (Phase 3, chat+embed wiring 박힘)

> **v0.5.0 갱신**: v0.4.x 의 "Phase 3 LocalLLMProvider (미래)" 는 실 구현에서 **`src/ai/providers/OllamaProvider.ts` 단일 클래스 (chat + embed)** 로 수렴. 로드맵 §16.4.1 의 미래 명칭 `LocalLLMProvider`/`LocalEmbeddingProvider` 분리는 채택 안 됨 (한 런타임이 chat·embed 모두 제공). chat=Sprint 017 T14 / embed=Sprint 018 T17c 머지. `chatStream` 만 defer (Phase 3 후속).

### 12.8.1 구현 현황 (실 코드)

| 메서드 | 상태 | 엔드포인트 |
|---|---|---|
| `chat()` | ✅ Sprint 017 T14 | `POST /api/chat` (non-streaming) — `llama3.2:3b` 디폴트 |
| `embed()` | ✅ Sprint 018 T17c (`supportsEmbed=true`) | `POST /api/embed` (batch) — `nomic-embed-text` 768 dim |
| `chatStream()` | ✗ defer | Ollama NDJSON streaming 지원하나 scope 외 (codex Q8) |
| `validate()` | ✅ | `GET /api/tags` (server 도달성 — 모델 설치 여부는 호출 시점 404 안내) |

- raw fetch + `fetchImpl` 주입 패턴 (`ollama` npm 의존성 회피, OpenAIApiKeyProvider/CodexLoginProvider 와 일치).
- localhost 신뢰 모델 — API key 없음, OS Keychain (G-005) 무관.
- 등록: `providers.set('local', new OllamaProvider())` (services.ts). 채팅 선택: `defaultProviderId='local'` 시 `['local']` 단독 (OpenAI fallback 금지 — 비용/프라이버시 surprise 회피). 검색 embed: searchHandlers 가 워크스페이스 `embedding_model` provider('ollama')→credential('local') 매핑.

### 12.8.2 도입 의의

- **오프라인 가능** — 인터넷 없이 AI 채팅 + 임베딩·검색 사용 (모델 다운로드 후)
- **민감 페이지** — 의료·법무·금융 콘텐츠 외부 API 미전송
- **무료** — API 비용 0 (전기료만)

### 12.8.3 도입 부담 / Phase 3 종료 검증 미완

- Ollama 등 외부 LLM 런타임 설치 + 모델 다운로드 (수 GB) — 사용자 책임 (`ollama pull`)
- 성능 — 사용자 하드웨어 의존 (M2 Mac 기본 / RTX 4090 강력 등)
- **Phase 3 종료 임계 미충족**: 오프라인 end-to-end 시연 + 모델별 정량 임계(로컬 LLM 응답 < 2초, §16.4.3) 측정은 **미완** — `.flowset/specs/phase3-exit-checklist.md` (S018-T11) 추적

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
- 2026-05-29 (v0.5.0, Sprint 018 M4 T10): **로컬 LLM 구현 현황 반영**. §12.2 매트릭스 Local LLM 행 — "(Phase 3 future)" → "(Phase 3 ✅ wiring 박힘) `OllamaProvider`" (chat ✅ Sprint 017 T14 / embed ✅ Sprint 018 T17c supportsEmbed=true / chatStream ✗ defer, `providerType='local'`, defaultProviderId='local' fallback 금지). §12.8 "Phase 3 LocalLLMProvider (간략·미래)" → "Local LLM `OllamaProvider` (chat+embed wiring 박힘)" + §12.8.1 구현 현황 표 (실 메서드/엔드포인트) + 명칭 수렴(로드맵 §16.4.1 LocalLLMProvider/LocalEmbeddingProvider 분리 미채택, 단일 클래스) + §12.8.3 Phase 3 종료 검증 미완 명시. codex 019e718f scope 협의.
- 2026-05-16 (PR b7.1): codex 32건 + evaluator Fail 핫픽스. **실제 코드 grep 정정**: (1) §12.1 ProviderAdapter 인터페이스 정정 — v0.3 현재 (`info / validate / translate / dispose`) vs v0.4 마이그레이션 spec (chat/embed/chatStream M2~M5 도입) 분리. v04-migration-matrix §C KEEP → GENERALIZE 재분류 동반. (2) §12.4.2 Codex 모델 `AVAILABLE_MODELS = gpt-5.5/gpt-5.4-mini/gpt-5.2` 정확 박힘 (gpt-5 코드 주석 "not supported" 충돌 제거). (3) §12.6 UsageLog GENERALIZE 재분류 + v0.3 schema (실제 UsageLogEntry 12 필드) vs v0.4 M3 schema 마이그레이션 (workspaceId/model/durationMs 추가, feature enum 변경). (4) §12.5 rate limit 수치 정정 — "3 RPM/200 TPM" 외부 사실 오류 → "tier 1 gpt-4o-mini ≈ 500 RPM/200K TPM, text-embedding-3-small ≈ 3,000 RPM/1M TPM" (OpenAI 공식). **fallback 안전화**: (5) §12.4.3 능동 채팅 한정 명시 (자동 호출 fallback X). (6) §12.4.4 fallback 제한 신규 (max 3 attempts / cost cap $0.10 / 401 차단 / Codex 명시 동의). **외부 사실**: (7) Codex 한도 "5h/주" → "추정, 429 검증" 시제. (8) Codex token refresh 60초 전 (실제 코드 정합). (9) Ollama endpoint `http://localhost:11434/api` 정확. (10) Local LLM 옵션 다양화 (Ollama + LM Studio + llama.cpp + vLLM). **Provider timeout**: (11) OpenAI 30s / Codex 60s / Local LLM 사용자 설정 명시. **§12.6 durationMs 실측**: (12) Codex "30초 추정" → durationMs 실측 저장 (M3 후).
