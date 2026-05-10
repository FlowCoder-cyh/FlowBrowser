> [← PRD 목차](./README.md)

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
