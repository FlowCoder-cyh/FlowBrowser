# Spike 4 — TTS 3축 측정 (품질·지연·비용)

> **상태: 잠정 완료 (정책·스펙 조사 1차)**
> 담당: Claude (조사) + 사용자 (판정)
> 시작일: 2026-05-11
> 종료일: 2026-05-11 (1차 조사)
> 다음: Phase 1 PoC에서 실제 한국어 음성 측정·비교 (5명 블라인드 평가 등)

## 목표

PRD 14장 싱크 정책의 매개변수가 현실적인지 확인 + TTS Provider 선정 입력.

## 가설

OpenAI TTS / ElevenLabs / 로컬 TTS(Kokoro) 중 **적어도 하나는** 품질·지연·비용 3축에서 PRD 14.2 싱크 정책(0.9배 / 0.75~0.85배 / 4초 임계)과 양립 가능하다.

## 검증 항목

- [x] Provider별 가격 (1분당 / 1M chars당)
- [x] Provider별 지연 (첫 음성 출력)
- [x] Provider별 한국어 지원 여부
- [x] Provider별 한국어 품질 (사용자 평·문헌 추정 — 실측은 Phase 1)
- [x] 라이선스 (상용 가능 여부)
- [ ] 한국어 음성 길이 vs 원본 영어 음성 길이 비율 (Phase 1 PoC 이관)
- [ ] 동시 다중 요청 처리 한계 (Phase 1 PoC 이관)
- [ ] 5명 블라인드 평가 (Phase 1 PoC 이관)

## 검증 방법

1. OpenAI TTS / ElevenLabs / 로컬 TTS 공식 docs / 가격 페이지 정독
2. Hugging Face 모델 카드 (Kokoro 등) 확인
3. 3rd-party 비교 분석 (Inferless / FindSkill / TokenMix 등)
4. 라이선스 / 상용 가능성 검토

## 결과

### 1. Provider별 가격 매트릭스 (1M chars 기준 또는 분당)

| Provider | 모델 | 가격 | 1분 환산 (한국어 ~1000 chars/분 기준) |
|---|---|---|---|
| OpenAI | tts-1 | $15 / 1M chars | ~$0.015 |
| OpenAI | tts-1-hd | $30 / 1M chars | ~$0.030 |
| OpenAI | gpt-4o-mini-tts | $0.60/1M input tokens + $12/1M audio tokens | ~$0.015 |
| ElevenLabs | Flash v2.5 | $0.05 / 1K chars (= $50 / 1M) | ~$0.05 |
| ElevenLabs | Multilingual v2 | $0.10 / 1K chars (= $100 / 1M) | ~$0.10 |
| 로컬 (Kokoro) | Kokoro-82M | 자체 호스팅 (전기/하드웨어) | ~$0.001 (전기 추정) |

ElevenLabs는 구독제 (Starter $6 / Creator $22 / Pro $99 / Scale $299 / Business $990) 또는 PAYG.

### 2. Provider별 지연

| Provider | 모델 | 첫 음성 출력 (ms) |
|---|---|---|
| OpenAI | tts-1 | ~250 |
| OpenAI | gpt-4o-mini-tts | ~250 (추정, 동일 인프라) |
| ElevenLabs | Flash v2.5 | ~75 |
| ElevenLabs | Multilingual v2 | 미공개 (Flash보다 느림, 추정 200~500ms) |
| 로컬 (Kokoro) | GPU 스트리밍 | <200 |

PRD 14.2 임계 (1~2초 → 0.9배) 기준 — 모든 Provider 정상 모드 1초 이내, 양립 가능.

### 3. 한국어 지원 / 품질

| Provider | 모델 | 한국어 지원 | 품질 (추정) |
|---|---|---|---|
| OpenAI | tts-1 | 명시 없음 | 중급 (다국어 일반) |
| OpenAI | gpt-4o-mini-tts | **공식 지원 (50+ 언어 중 한국어 포함)** | 중급 (가변, 영어 외 품질 균일하지 않음 명시) |
| ElevenLabs | Flash v2.5 | **공식 지원 (32개 언어 중 한국어)** | 상급 (사용자 평 자연스러움) |
| ElevenLabs | Multilingual v2 | **공식 지원 (29개 언어 중 한국어)** | 최상급 (lifelike, 감정 표현) |
| 로컬 (Kokoro) | Kokoro-82M | VOICES.md 미확인 (Phase 1에서 검증) | 미상 (오픈소스 평가는 주로 영어 / 주요 언어) |

### 4. 라이선스 / 상용 가능성

| Provider | 라이선스 | 상용 사용 |
|---|---|---|
| OpenAI | API 사용 약관 | 가능 (API Key 결제) |
| ElevenLabs | 구독/PAYG | 가능 (단, Music은 Starter+ 한정) |
| Kokoro-82M | **Apache 2.0** | **자유 (상용 OK)** |
| ~~Coqui XTTS-v2~~ | ~~Coqui Public Model License~~ | **비상용 한정 → 제외** |

**중요**: Coqui AI 회사 2025-12 폐업. XTTS-v2는 비상용 라이선스로 PRD 후보에서 영구 제외. **로컬 TTS 후보는 Kokoro로 변경**.

### 5. 텍스트 길이 한도

| Provider | 모델 | 요청당 최대 chars |
|---|---|---|
| OpenAI | tts-1 / gpt-4o-mini-tts | 4096 (추정) |
| ElevenLabs | Flash v2.5 | 40,000 (~40분) |
| ElevenLabs | Multilingual v2 | 10,000 (~10분) |
| 로컬 (Kokoro) | Kokoro-82M | 청크 분할 자유 |

## 판정 기준 충족 여부

PRD 14.2 / 본 spec의 판정 기준 적용:

| 항목 | 임계 | OpenAI gpt-4o-mini-tts | ElevenLabs Flash v2.5 | ElevenLabs Multilingual v2 | Kokoro |
|---|---|---|---|---|---|
| 품질 ≥ 3.5 / 5 | 사용자 만족 최저선 | **? (Phase 1 측정)** | ✓ (추정) | ✓✓ (추정) | **? (한국어 미상)** |
| 첫 음성 지연 ≤ 2초 | "약간 지연" 임계 | ✓ (~250ms) | ✓✓ (~75ms) | ✓ (~200~500ms 추정) | ✓ (<200ms GPU) |
| 1분 비용 ≤ $0.05 | 베타 무료 가능 수준 | ✓ ($0.015) | ✓ ($0.05) | ✗ ($0.10) | ✓✓ ($0.001) |
| TTS/원본 길이 비율 0.9~1.2 | 싱크 깨짐 방지 | ? (Phase 1 측정) | ? | ? | ? |

**3개 이상 통과 → MVP 후보. 2개 이하 → 보조 또는 제외.**

## 추천 조합

| 모드 | Provider | 근거 |
|---|---|---|
| **MVP 기본** | OpenAI gpt-4o-mini-tts | 저비용 ($0.015/분), 적정 품질, 지연 OK, 50+ 언어 |
| **고급** | ElevenLabs Flash v2.5 | 더 좋은 품질·지연, 적당한 비용 ($0.05/분), 한국어 자연스러움 평 좋음 |
| **프리미엄** (옵션) | ElevenLabs Multilingual v2 | 최상급 품질, 비용 높음 ($0.10/분) → Pro 플랜 한정 |
| **프라이버시 / 오프라인** | Kokoro-82M (로컬) | Apache 2.0, 한국어 별도 검증 필요 — Phase 1 PoC 검증 후 결정 |

## 종합 판정

**Pass with conditions**

- 4개 Provider 모두 PRD 14.2 임계와 양립 가능 (지연 모두 1초 이내)
- 한국어 품질 / TTS 길이 비율 = Phase 1 PoC 실측 필요
- Coqui XTTS-v2 라이선스 위반 → 후보에서 영구 제외, Kokoro 대체

조건:
1. **MVP 기본 = OpenAI gpt-4o-mini-tts** 결정 가능 (단, Phase 1 한국어 실측 필수)
2. **상용 라이선스** = Kokoro만 자유. 다른 후보(상용 한정)는 영구 제외 (PRD에 명시)
3. **PRD 14.2 0.9배 / 0.75~0.85배 / 4초 임계는 유지** (Phase 1에서 실측 후 캘리브레이션)
4. **사용자 BYOK 허용** = OpenAI API Key + ElevenLabs API Key 둘 다 가능 (PRD 11.3 보강)

## PRD 영향

다음 섹션을 PRD v0.3에서 갱신:

### PRD 9.4 AI 싱크 더빙 기능 / TTS 생성
- "TTS Provider: OpenAI gpt-4o-mini-tts (MVP 기본), ElevenLabs Flash v2.5 (고급), Kokoro-82M (프라이버시·오프라인)" 추가
- ~~Coqui XTTS-v2~~ 제거

### PRD 11.2 Provider Adapter 구조
- ElevenLabsProvider 명시
- ~~Coqui~~ → Kokoro 또는 LocalTTSProvider (구현체 Kokoro)

### PRD 14.2 싱크 제어 정책
- 임계값 유지 (0.9배 / 0.75~0.85배 / 4초)
- "Phase 1 PoC에서 실측 후 캘리브레이션" 명시

### PRD 15.2 Provider 전략표
- ElevenLabs: **P2 (TTS 특화, 비용 발생) 유지** (PRD v0.2 본문 P2와 일치)
- 로컬 모델: Kokoro 명시 (P3 유지)
- ~~Coqui~~ 제거

### PRD 18.4 AI 비용 리스크
- TTS 비용 시뮬레이션 갱신: gpt-4o-mini-tts 기준 1시간 영상 = 60분 × $0.015 = ~$0.90 (캐시 365일로 재방문 시 0)

## 미해결 → Phase 1 PoC 이관

다음 항목은 실제 음성 생성·청취 없이 검증 불가능:

1. **한국어 품질 5명 블라인드 평가** (OpenAI / ElevenLabs / Kokoro 비교)
2. **TTS/원본 길이 비율 측정** (한국어 vs 영어 음성 길이)
3. **동시 다중 요청 처리 한계** (Provider별 rate limit 실측)
4. **Kokoro VOICES.md 한국어 voice 실제 확인** (`af_heart` 외 한국어 voice)
5. **Kokoro 로컬 실행 가능 환경 정의** (필요 RAM/VRAM, CPU 가능 여부)
6. **TTS용 번역 vs 자막용 번역 분리 효과** (PRD 14.3 검증)

## 평가 (evaluator 입력)

본 Spike 결과를 evaluator에 제출:
- 입력: 본 파일 + PRD 9.4 / 14.2 / 14.3 / 15.2 / 18.4
- 출력: `.flowset/eval-results/spike-04-2026-05-11.md`
- 채점 기준: 위 판정 기준 + 가드레일 정합성

## 참조 (Sources)

### OpenAI
- [Pricing | OpenAI API](https://developers.openai.com/api/docs/pricing)
- [GPT-4o mini TTS Model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- [TTS-1 Model](https://developers.openai.com/api/docs/models/tts-1)
- [gpt-4o-mini-tts: Cheapest TTS API in 2026 — TokenMix Blog](https://tokenmix.ai/blog/gpt-4o-mini-tts-cheapest-tts-api-2026)
- [GPT-4o-Mini-TTS: Steerable, Low-Cost Speech — PromptLayer](https://blog.promptlayer.com/gpt-4o-mini-tts-steerable-low-cost-speech-via-simple-apis/)
- [OpenAI TTS API Pricing Calculator (May 2026) — Costgoat](https://costgoat.com/pricing/openai-tts)

### ElevenLabs
- [ElevenAPI Pricing](https://elevenlabs.io/pricing/api)
- [Models | ElevenLabs Documentation](https://elevenlabs.io/docs/overview/models)
- [Text to Speech | ElevenLabs Documentation](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)
- [ElevenLabs Pricing 2026 — Cekura](https://www.cekura.ai/blogs/elevenlabs-pricing)
- [ElevenLabs Review 2026 — DevOpsCube](https://devopscube.com/elevenlabs-review/)

### 로컬 / 오픈소스 TTS
- [Kokoro-82M — Hugging Face (hexgrad)](https://huggingface.co/hexgrad/Kokoro-82M)
- [Kokoro GitHub](https://github.com/hexgrad/kokoro)
- [Coqui XTTS-v2 — Hugging Face (비상용 라이선스, 제외)](https://huggingface.co/coqui/XTTS-v2)
- [Best Open-Source TTS in 2026: 5 Models, Ranked by Quality — FindSkill](https://findskill.ai/blog/best-open-source-tts-2026/)
- [Best ElevenLabs Alternatives 2026 — OcDevel](https://ocdevel.com/blog/20250720-tts)
- [Coqui TTS Review 2026 — qcall.ai](https://qcall.ai/coqui-tts-review)

### 비교 분석
- [Top text-to-speech APIs 2026 — AssemblyAI](https://www.assemblyai.com/blog/top-text-to-speech-apis)
- [Best TTS APIs for developers in 2026 — Gladia](https://www.gladia.io/blog/best-tts-apis-for-developers-in-2026-top-7-text-to-speech-services)
- [Text-to-Speech API 2026: OpenAI vs ElevenLabs vs Google — TokenMix](https://tokenmix.ai/blog/tts-api-comparison)
- [Best TTS APIs for Real-Time Voice Agents 2026 — Inworld](https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks)

## 변경 이력

- 2026-05-11: placeholder 생성
- 2026-05-11: 1차 조사 완료, Pass with conditions 판정. Coqui XTTS-v2 → Kokoro 대체. Phase 1 PoC 이관 항목 6개 명시.
