# FlowBrowser AI — 누적 가드레일

> 작업 중 발견한 실패 패턴·금지 사항·강제 절차의 단일 누적 위치.
> 새로운 실패 발견 즉시 추가. 절대 삭제하지 않음 (관련성 잃은 항목은 `[deprecated]` 표기).

## 표기 규칙

- `[active]` 현재 적용 중
- `[deprecated]` 더 이상 적용 안 함 (이력 보존용)
- `[draft]` 검토 중
- 각 항목은 **규칙 / Why / How to apply** 3요소 포함

---

## 절대 규칙

### G-001 [active] PRD가 SSOT

- **규칙**: 요구사항 분쟁 시 PRD가 우선. requirements.md / state.md / handoff는 PRD를 인용·참조만 가능.
- **Why**: 다중 문서가 충돌하면 신뢰도 붕괴. SSOT가 없으면 매번 협의 비용.
- **How to apply**: PRD와 다른 사실을 발견하면 즉시 PRD 갱신 → 다른 파일은 동기화. 역방향 금지.

### G-002 [active] Phase 0 게이트

- **규칙**: Phase 0 Spike 5종 판정 전 본격 코드 착수 금지. Spike 자체 PoC 코드는 허용.
- **Why**: 치명 가설(Codex 인증 / YouTube 제어 / 오디오 캡처 / TTS 비용 / 사용자 선호) 미검증 상태에서 코드 진행 시 재작업 위험 큼.
- **How to apply**: Phase 1 본격 코드 작업 요청 시 거부 + state.md의 Spike 진행 상태 확인 안내.

### G-003 [active] 인증 금지선

- **규칙**: 다음은 어떤 경우에도 금지.
  - ChatGPT 웹 세션 / 쿠키 재사용
  - 비공식 토큰 추출 (Codex CLI 인증 우회 등)
  - 사용량 제한 우회
  - 사용자 계정 프록시화
- **Why**: PRD 15.3 / 법적·정책 리스크 / 사용자 신뢰. Codex Login 정체가 회색지대일 경우 즉시 OpenAI API Key로 폴백.
- **How to apply**: Spike 1 결과에 따라 Codex Login Provider 활성/제거 결정. 회색이면 Experimental 유지.

### G-004 [active] Privacy Filter는 P0 기능

- **규칙**: "민감 페이지 비전송"은 정책이 아니라 P0 기능 모듈로 구현. 코드 단계에서 password / 카드 / 도메인 블랙리스트 우회 불가능.
- **Why**: PRD 9.6 / 사용자 신뢰. AI 브라우저는 사용자 페이지를 외부 Provider로 보낼 수 있어 신뢰가 무너지면 제품 자체가 무너짐.
- **How to apply**: Phase 1 Privacy Filter 구현 전 다른 P0 기능(번역) 활성화 금지.

### G-005 [active] OS Keychain 위임

- **규칙**: API Key 등 secret은 앱이 직접 보관하지 않음. macOS Keychain / Windows DPAPI / Electron `safeStorage` API에 위임.
- **Why**: PRD 12.2 / 키 관리 책임 OS로 이전. 앱 자체 마스터 키는 또 다른 비밀이 되어 위험.
- **How to apply**: ProviderCredential 모델은 `keychainRef`만 보관. secret 평문 저장 코드 발견 시 즉시 차단.

### G-006 [active] 추측 금지

- **규칙**: 검증 안 된 사실을 단정으로 전달하지 않음. 메모리 / 이전 컨텍스트는 힌트일 뿐 — 실제 코드·문서로 대조 후 행동.
- **Why**: 사용자 글로벌 CLAUDE.md / 잘못된 단정이 누적되면 다음 작업이 그 위에 쌓여 정정 비용 폭증.
- **How to apply**: "확실한가?" 의심 시 Read / Grep / WebFetch로 사전 검증. 모르면 모른다고 명시.

### G-007 [active] main 직접 push 금지

- **규칙**: 모든 변경은 `feature/` `fix/` `chore/` `docs/` `refactor/` 브랜치 → PR → 머지. 첫 셋업 커밋만 main 직접 (예외).
- **Why**: 사용자 글로벌 wi-global.md / 변경 추적 + CI 게이트.
- **How to apply**: 셋업 이후 모든 작업은 브랜치 분기. main 직접 푸시 시도 거부.

### G-008 [active] 한국어 우선

- **규칙**: 모든 문서 / 커밋 메시지 본문 / PR 본문 한국어 기본. 코드 식별자 / 표준 영어 표현은 그대로.
- **Why**: 사용자 선호.
- **How to apply**: 영어로 답변하지 않음. 사용자가 영어로 명시 요청 시에만 영어.

### G-009 [active] 커밋 형식

- **규칙**: `WI-NNN-[type] 한글 작업명` 형식.
  - type: feat / fix / docs / style / refactor / test / chore / perf / ci / revert
  - NNN: 숫자(`001`) / 영숫자(`A2a`) / 서브넘버(`001-1`)
  - 시스템 커밋: `WI-chore` / `WI-docs` (번호 없음 허용)
- **NNN 한 분절 강화 (학습 29 + 30)**:
  - 학습 29: `-` 추가 분절 금지 — `WI-C3-content` ❌ → `WI-C3content` ✓
  - **학습 30 (2026-05-16, Sprint 015)**: Sprint milestone + Task 조합 시 T 번호를 별도 분절로 붙이지 않는다. T 번호는 한글 작업명 본문에 박거나 milestone과 한 분절로 합친다.
    - ❌ `WI-S015M0-T01-docs ...` (T01이 추가 분절)
    - ✓ `WI-S015M0-docs T01 ...` (T 번호는 본문, **권장**)
    - ✓ `WI-S015M0T01-docs ...` (한 분절 합성, 학습 29 예시 패턴)
- **Why**: 사용자 글로벌 wi-global.md / 일관성. commit-check.yml 정규식 `^WI-([0-9A-Za-z]+(-[0-9]+)?-(type))` 는 milestone 자리에 영숫자 1+ 글자만 허용하고 `-T 영숫자` 추가 분절은 허용 안 함.
- **How to apply**: 커밋 전 형식 검증. `.github/workflows/commit-check.yml`이 자동 검증. Sprint·Task 조합 시 본문에 T 번호 박는 패턴 권장 (Sprint 014 `WI-S014M1-feat ...` 일관성 유지).

### G-010 [active] UTF-8 / LF

- **규칙**: 모든 텍스트 파일 UTF-8 (BOM 없음), 줄바꿈 LF. Windows 환경에서도 동일.
- **Why**: 사용자 글로벌 wi-utf8.md / Git Bash·MSYS2 환경에서 한글 깨짐 방지.
- **How to apply**: `.gitattributes`로 강제 + `.editorconfig`로 에디터 동기화.

---

## Phase 0에서 발견한 패턴

### G-011 [active] 공개 endpoint 회색지대 허용

- **규칙**: 다음은 허용한다.
  - 공개 OAuth 클라이언트 ID 재사용 (예: Codex `app_EMoamEEZ73f0CkXaXp7hrann` + PKCE — OpenClaw / Roo Code / 다수 3rd-party 사례)
  - 공개 caption track URL 직접 fetch (`timedtext.googlevideo.com` 등)
  - 비공식 transcript 라이브러리 (`youtube-transcript-api` 등)
- **금지** (G-003에 따른 절대 금지):
  - ChatGPT 웹 세션 / 쿠키 재사용
  - 사용자 자격증명 / 세션 모방
  - 비공식 토큰 추출 (Codex CLI 인증 우회 등)
  - 사용량 한도 우회
- **Why**: Spike 1·2 1차 조사 결과 — 공개 endpoint 재사용은 다수 3rd-party 사례 (OpenClaw / Roo Code / youtube-transcript-api)와 함께 OpenAI / Google 모두 명시 차단 안 함. 회색지대지만 사실상 묵인 패턴. PRD 11.3 / 15.3 / 18.1과 정합.
- **How to apply**: 코드 작성 시 "공개" 여부 명확히 구분. 사용자 자격증명 / 세션 / 쿠키를 다루는 코드 발견 시 즉시 차단. 회색지대 사용 시 UI에 "비공식 호환 모드, 차단 가능성 있음" 고지 + OpenAI API Key / 공식 자막 모드 폴백 항상 유지.
- **출처**: Spike 1 spec / Spike 2 spec / phase0-summary §2, §8

---

## 변경 이력

- 2026-05-11: G-001 ~ G-010 초기 등록 (PRD v0.2 + 사용자 글로벌 규칙 기반)
- 2026-05-11: G-011 추가 (Phase 0 종합 보고 §8 권고 반영, Spike 1·2 회색지대 패턴 명문화)
- 2026-05-16: G-009 강화 — 학습 30 추가 (Sprint milestone + Task 조합 시 T 번호 분절 금지, Sprint 015 T01 amend 사례 반영)
