> [← PRD 목차](./README.md)

# 9. 기능 요구사항

## 9.1 브라우저 기본 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| URL 입력 | 사용자가 웹사이트 주소 입력 | P0 |
| 페이지 로드 | Chromium WebView/BrowserView로 웹페이지 표시 | P0 |
| 뒤로가기/앞으로가기 | 기본 탐색 기능 — Sprint 006 M1: did-navigate broadcast + canGoBack/canGoForward 동기화로 UrlBar 버튼 disabled 자동 반영 | P1 |
| 새로고침 | 현재 페이지 새로고침 — Sprint 006 M1 동일 흐름 | P1 |
| 탭 관리 | 복수 탭 열기/닫기 | P2 |
| 히스토리 | 방문 기록 저장 | P2 |
| 북마크 | 자주 쓰는 사이트 저장 | P3 |

## 9.2 AI 번역 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| DOM 텍스트 추출 | 현재 페이지 텍스트 노드 추출 | P0 |
| 선택 영역 번역 | 드래그한 텍스트 번역 | P0 |
| 문단 번역 | 페이지 문단 단위 번역 (9개 블록 선택자 ParagraphExtractor) | P0 |
| 페이지 전체 번역 | 전체 페이지 번역 — Sprint 003 M2: 16종 블록 선택자 PageNodeExtractor + 4000자 청크 + abort 지원 + pageWideBlock=true 시 즉시 중단 | P1 |
| 원문/번역 토글 | 원문과 번역 표시 방식 변경 — Sprint 006 M1/M2: TranslationRenderer (replace = DOM 치환 + data-fbai-orig 백업, overlay = sibling 박스). UserSetting translationMode = panel/replace/overlay 3종 + Settings DisplayModePanel. paragraphs/page 흐름이 mode 따라 자동 render. 페이지 이동 시 자동 restore | P1 |
| 쉬운 설명 | 어려운 문장을 쉽게 설명 — Sprint 004 M2: 컨텍스트 메뉴 "쉽게 설명" + system prompt 분기 (tutor / unpack jargon) + popup mode 표시. 캐시 우회 | P1 |
| 요약 | 선택 영역/페이지 요약 — Sprint 004 M3: 선택 영역은 컨텍스트 메뉴 통합 흐름, 페이지는 `translate:summarize-page` 전용 IPC + SummarizationPlanner (청크 분할 → 통합 요약) | P1 |
| 용어집 적용 | 사용자 정의 용어 반영 — Sprint 005 M2: GlossaryStore (PRD §12.7 1:1) + GlossaryPanel UI + glossaryVersion 자동 invalidation. 활성 용어 + 도메인 일치 최대 50개를 prompt 컨텍스트로 주입. explanation/summary는 의역이라 적용 제외 | P2 |

## 9.3 YouTube/영상 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| 영상 감지 | 페이지 내 video 요소 감지 | P0 |
| YouTube 감지 | YouTube URL/플레이어 감지 (직접 + 임베디드) | P0 |
| 자막 감지 | 영상 자막 존재 여부 확인 | P0 |
| 자막 추출 | 영어 자막 데이터 추출 — caption track URL 직접 fetch + 비공식 transcript 라이브러리 (회색지대, G-011 적용). 수동/자동 sourceType 구분. | P0 |
| 자막 번역 | 한국어 자막 생성 | P0 |
| 자막 오버레이 | 영상 하단에 번역 자막 표시 | P0 |
| 병렬 자막 | 원문+번역 동시 표시 | P1 |
| 자막 캐시 | 동일 영상 자막 재사용 | P1 |

## 9.4 AI 싱크 더빙 기능

| 기능 | 설명 | 우선순위 |
|---|---|---|
| TTS 생성 | 한국어 음성 생성 — Provider: OpenAI gpt-4o-mini-tts (MVP 기본, $0.015/분), ElevenLabs Flash v2.5 (고급, $0.05/분), Kokoro-82M (Apache 2.0, 프라이버시·오프라인). v0.3 Spike 4 결과. | P1 |
| TTS 큐 관리 | 생성된 음성을 순서대로 관리 | P1 |
| 원본 볼륨 낮춤 | 영상 음량 자동 조절 | P1 |
| TTS 재생 | 한국어 음성 출력 | P1 |
| 재생속도 제어 | TTS 큐 상태에 따라 영상 속도 조절 | P2 |
| 일시정지 제어 | TTS 준비가 늦을 때 영상 일시정지 | P2 |
| 싱크 상태 표시 | 현재 싱크 지연/정상 상태 표시 | P2 |
| STT 처리 | 자막 없는 영상 음성 인식 | P3 — Spike 3 가용성 검증 완료 (Win 10+ / macOS 13+ 추가 설치 불필요). STT API 선정은 Phase 5 별도 작업 |

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

## 9.6 Privacy Filter (v0.2 신규, v0.3.1 BlockReason / 도메인 정책 UI 실측)

AI 브라우저는 사용자가 보는 페이지를 외부 Provider로 전송할 수 있어, 민감 페이지 차단을 **정책이 아닌 기능 모듈**로 구현한다.

| 기능 | 설명 | 우선순위 |
|---|---|---|
| password input 감지 | `<input type="password">` 존재 시 페이지 자동 번역 비활성 | P0 |
| 카드 입력 필드 감지 | Payment Request API, 카드 패턴(번호/CVC/만료일) 감지 | P0 |
| 도메인 블랙리스트 (기본) | 메일/은행/결제/계정 도메인 키워드 기반 차단 | P0 |
| 사용자 도메인 블랙리스트 | 사용자가 추가한 도메인 차단 (Sprint 003 M3 UI 구현) | P1 |
| 사용자 도메인 화이트리스트 | 사용자가 명시 허용한 도메인 (블랙리스트 우회, Sprint 003 M3) | P1 |
| 수동 승인 요구 | 민감 페이지에서 번역 시도 시 명시적 사용자 승인 다이얼로그 | P0 |
| 전송 로그 | 어떤 도메인의 어떤 콘텐츠가 어느 Provider로 전송됐는지 기록 (UsageLog 연결) | P1 |

### 기본 도메인 블랙리스트 키워드

`mail.*`, `accounts.*`, `account.*`, `*.bank`, `banking.*`, `pay.*`, `checkout.*`, `payment.*`, `login.*`, `signin.*`, `oauth.*`, `id.*`, `gmail.com`, `paypal.com`

(정규 운영 시 사용자 피드백 기반 갱신)

### BlockReason enum + pageWideBlock (v0.3.1 / Sprint 003 M1)

evaluatePrivacy 반환 구조에 차단 사유를 enum으로 도입.

```
BlockReason: 'none' | 'consent' | 'password' | 'card_field' | 'card_pattern' | 'domain'
pageWideBlock: boolean  // 차단 시 페이지 전체 차단 여부
```

- 평가 우선순위: consent → password → card_field → card_pattern → domain
- 모든 차단 사유는 `pageWideBlock=true` (사용자 명시 차단 의도 통일)
- `allowed | user_approved` 시 `blockReason='none'`, `pageWideBlock=false`
- 호출자(paragraph / page 번역 반복문)는 `pageWideBlock=true` 감지 시 즉시 중단
- v0.3까지의 reason 문자열 매칭은 v0.3.1에서 deprecate (호환 `blockedBy` 유지)

### 사용자 도메인 정책 영속 (v0.3.1 / Sprint 003 M3)

`domain-policy.json` 파일에 JSON 영속.

```json
{
  "policyVersion": 1,
  "userRules": [
    { "pattern": "*.example.com", "type": "whitelist" },
    { "pattern": "mail.example.com", "type": "blacklist" }
  ]
}
```

- 패턴: 도메인 문자(`a-z`, `0-9`, `-`, `.`)만 허용, 선두 와일드카드 `*.` 만 허용
- 정책 우선순위: **사용자 화이트리스트 > 사용자 블랙리스트 > 기본 블랙리스트**
- Settings UI에서 import/export 가능 (DomainPolicyPanel)
- secret 아님 → 평문 JSON 영속 (G-005 적용 외)

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
