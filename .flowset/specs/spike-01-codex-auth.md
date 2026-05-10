# Spike 1 — Codex/ChatGPT 인증 방식 검증

> 상태: **미시작**
> 담당: TBD
> 시작일: TBD
> 종료 목표: 1~2주

## 목표

정책 위반 없이 Codex/ChatGPT 로그인 기반 Provider를 구현할 수 있는지 확인.

## 가설

OpenAI가 공식적으로 허용하는 인증 흐름을 통해 ChatGPT/Codex 로그인 사용자가 본 앱에서 동일 계정으로 AI 기능을 쓸 수 있다.

## 검증 항목

- [ ] **공식 인증 경로 존재 여부**
  - OpenAI OAuth 2.0 공식 지원
  - API 파트너 프로그램 가입 요건
  - 3rd-party 앱 사용 약관
- [ ] **토큰 저장/갱신 방식**
  - access token 수명
  - refresh token 정책
  - 사용자 동의 흐름
- [ ] **사용량 제한 정책**
  - ChatGPT 구독자가 API 호출 시 어디로 차감되는가
  - rate limit 적용 방식
- [ ] **약관/법적 검토**
  - OpenAI Terms of Service 검토
  - 필요시 OpenAI 개발자 지원 직접 문의
  - 회색지대 발견 시 법무 자문

## 검증 방법

1. OpenAI 공식 문서 / API reference / partner program 페이지 조사
2. 실제 OAuth 흐름 PoC (있는 경우)
3. ToS / 개발자 약관 정독 + 위반 가능성 항목 추출
4. 필요시 OpenAI 지원에 정책 문의

## 판정 기준

| 결과 | 판정 | 후속 조치 |
|---|---|---|
| 공식 인증 경로 확인됨 | **Pass** | Codex Login Provider 활성화, MVP 메인 |
| 공식 경로 없으나 회색지대 | **Partial** | Experimental 모드 유지, 기본은 OpenAI API Key |
| 정책 위반 가능성 있음 | **Fail** | Codex Login Provider 영구 제거, 기본은 OpenAI API Key |

## 결과 (TBD)

### 조사 결과
(작성 예정)

### 약관 발췌
(작성 예정)

### 의사결정
(작성 예정)

### PRD 영향
- PRD 11.3 Provider 전략 / 메인 (조건부) — 확정 필요
- PRD 15.2 / 15.3 — 확정 필요

## 평가 (evaluator 입력)

본 Spike 결과는 evaluator에게 제출하여 채점한다.
- 입력: 본 파일 + PRD 11.3 / 15.2 / 15.3
- 출력: `.flowset/eval-results/spike-01-{date}.md`
- 채점 기준: 위 판정 기준 충족 여부 + 근거 강도

## 변경 이력

- 2026-05-11: placeholder 생성
