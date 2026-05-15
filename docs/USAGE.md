# FlowBrowser AI — 사용자 가이드

본 문서는 FlowBrowser AI를 처음 빌드/실행하여 직접 테스트하는 사용자를 위한 단계별 가이드.

## 목차

1. [빌드 / 실행](#1-빌드--실행)
2. [Provider 등록](#2-provider-등록)
3. [기본 사용법](#3-기본-사용법)
4. [고급 기능](#4-고급-기능)
5. [설정](#5-설정)
6. [FAQ](#6-faq)
7. [알려진 한계](#7-알려진-한계)

---

## 1. 빌드 / 실행

### 사전 조건

- Node.js ≥ 20 (개발 검증: v24)
- npm ≥ 10
- Git
- 지원 OS: Windows 10+, macOS 13+ (Ventura)

### 의존성 설치

```
npm install
```

### 개발 모드 (Hot Reload)

```
npm run dev
```

코드 변경 시 자동 재시작.

### Production 빌드 + 실행

```
npm run build
npm start
```

빌드 산출물:
- `out/main/index.js` — Electron main process
- `out/preload/index.js` — preload bridge
- `out/renderer/index.html` + assets — React UI

---

## 2. Provider 등록

번역/요약 기능을 사용하려면 AI Provider 등록이 필요합니다. 두 가지 방식 중 선택:

### 방식 A: Codex Login (Experimental, 추천)

**ChatGPT 구독 계정으로 로그인**하면 별도 API Key 비용 없이 사용 가능합니다.

⚠️ **주의**: OpenAI 공식 등록 파트너십이 아닌 비공식 호환 모드입니다. OpenAI가 차단할 가능성이 있으며, 그 경우 자동으로 OpenAI API Key 모드로 폴백됩니다.

**절차**:
1. 앱 실행 → 우상단 **설정** 버튼 클릭
2. **Codex Login (Experimental)** 섹션 → **Codex Login 시작** 버튼
3. 화면에 표시된 **user_code** (예: `ABCD-EFGH`) 확인
4. 표시된 URL (`https://auth.openai.com/codex/device`)을 브라우저에서 열고 ChatGPT 로그인
5. user_code 입력 → 인증 완료
6. 앱은 자동으로 토큰을 받아 OS Keychain에 안전 저장 (15분 내 완료)

**보안**:
- Device code는 피싱 표적이 되기 쉬우니 절대 다른 사람에게 공유 금지
- access_token은 만료 60초 이내 자동 refresh
- 토큰은 OS Keychain (Electron safeStorage)에 위임 저장 — 앱이 평문 보관 안 함
- 로그아웃 시 토큰 즉시 제거

### 방식 B: OpenAI API Key (BYOK)

**OpenAI 콘솔에서 발급한 API Key를 직접 등록**. 사용량 별 청구.

**절차**:
1. https://platform.openai.com/api-keys 에서 API Key 발급 (sk-... 형식)
2. 앱 실행 → 우상단 **설정** 버튼 클릭
3. **AI Provider** 섹션 → API Key 입력 → **저장 + 검증**
4. 자동 검증 성공 메시지 확인

**보안**: OS Keychain 위임 저장. 평문 미보관.

---

## 3. 기본 사용법

### URL 이동

상단 URL Bar에 영문 URL 입력 후 Enter. 또는:
- 첫 실행 온보딩에서 추천 URL 클릭
- 컨텍스트 메뉴 또는 키보드 단축키

추천 시작 URL:
- https://en.wikipedia.org/wiki/Artificial_intelligence — 문단 번역 시연
- https://news.ycombinator.com/news — 뉴스 페이지
- https://arxiv.org/abs/1706.03762 — 학술 논문 요약

### 선택 영역 번역

1. 텍스트를 드래그하여 선택
2. 우클릭 → **한국어로 번역**
3. 미니 팝업이 선택 위치에 표시

### 우클릭 컨텍스트 메뉴 (텍스트 선택 시)

- **한국어로 번역** — 선택 영역 즉시 번역
- **쉽게 설명** — 어려운 용어 풀어서 한국어로 설명
- **이 부분 요약** — 선택 영역 요약

### 번역 패널 열기

상단 우측 **패널** 버튼 클릭 또는 키보드:
- **문단 번역** — 현재 페이지 모든 문단을 순차 번역, 진행률 표시
- **페이지 전체 번역** — 더 광범위한 블록 노드 포함
- **페이지 요약** — 페이지를 청크로 분할 후 통합 요약 (8000자 limit, 폭주 보호)

각 작업은 **취소** 버튼으로 중단 가능.

---

## 4. 고급 기능

### 표시 모드 (Display Mode)

설정 → **표시 모드**에서 선택:
- **patel** (기본) — 우측 패널에 결과 표시, 원본 페이지 유지
- **replace** — 원본 DOM 치환 (원본 텍스트는 보존, "원문으로" 버튼으로 복원)
- **overlay** — 원본 옆에 한국어 박스 추가

### 다중 탭

- **새 탭**: Ctrl+T 또는 TabBar `+` 버튼
- **탭 닫기**: Ctrl+W 또는 X 버튼
- **다음/이전 탭**: Ctrl+Tab / Ctrl+Shift+Tab
- **닫은 탭 복원**: Ctrl+Shift+T
- **드래그**로 순서 변경
- **우클릭 컨텍스트 메뉴**:
  - 탭 닫기
  - 다른 탭 닫기 / 오른쪽 탭 모두 닫기 (핀 탭은 자동 보존)
  - 탭 복제
  - 핀 고정 / 핀 해제 (핀 탭은 항상 좌측 + 닫기 X 숨김)
  - 색상 변경 (7색 + 없음)
- **hover 미리보기**: 600ms 호버 시 활성 탭 캡처 썸네일 + URL/title

탭 상태(URL/색상/핀/순서)는 앱 재시작 후 자동 복원.

### 용어집 (Glossary)

설정 → **용어집**:
- 원문/번역/설명/도메인 필드로 고정 번역 등록
- 활성/비활성 토글
- JSON import/export
- 등록 즉시 캐시 자동 invalidation

### 도메인 정책

설정 → **도메인 정책**:
- 블랙리스트: 해당 도메인 번역 차단
- 화이트리스트: 다른 차단 우회 (단, 안전 정책 password/카드는 항상 차단)
- 와일드카드 지원

### 페이지 캐시

자주 방문하는 페이지의 번역 결과를 자동 영속.
- 같은 URL 재방문 시 "복원" 배너 자동 표시
- 페이지 변경(nodesSignature 불일치) 감지 시 mismatch 알림
- 30일 TTL + 500MB LRU

---

## 5. 설정

설정 페이지 (우상단 ⚙️ 또는 단축키)에서:

| 섹션 | 기능 |
|---|---|
| **Codex Login** | Codex OAuth 로그인 / 로그아웃 |
| **OpenAI API Key** | BYOK 등록 / 삭제 |
| **일반 설정** | 기본 대상 언어 / 원문 언어 / 기본 Provider / Privacy Filter / 탭 전환 자동 취소 |
| **표시 모드** | panel / replace / overlay |
| **도메인 정책** | 블랙/화이트리스트 |
| **용어집** | 도메인별 고정 번역 |
| **페이지 캐시** | 캐시 통계 + 모두 삭제 |
| **사용량** | 토큰/비용/차단 통계 |

---

## 6. FAQ

**Q. Codex Login이 실패하거나 차단됐어요.**
A. OpenAI가 비공식 클라이언트를 차단할 가능성을 사전 고지한 상태입니다. 차단 시 OpenAI API Key 모드로 자동 폴백되므로 BYOK 등록을 권장합니다.

**Q. 토큰이 만료되었다고 나와요.**
A. access_token은 만료 60초 이내 자동 refresh됩니다. refresh도 실패하면 다시 로그인 필요. 설정 → Codex Login 시작 재실행.

**Q. 번역 결과가 이상하거나 짧아요.**
A. 표시 모드 또는 Provider 변경을 시도해 보세요. 페이지 요약은 limit 8000자 초과 시 truncate 폴백이 작동할 수 있습니다(메타에 표시됨).

**Q. 비밀번호 / 카드 번호 페이지에서 번역이 안 돼요.**
A. 의도된 안전 정책(G-004)입니다. Privacy Filter 토글로도 우회 불가. 사용자 데이터 보호.

**Q. 사용량/비용을 확인하고 싶어요.**
A. 설정 → **사용량** 패널. Provider별 토큰/비용/차단 로그.

**Q. 캐시를 초기화하고 싶어요.**
A. 설정 → **페이지 캐시** → 모두 삭제. 또는 캐시 stats에서 확인 후 선택.

**Q. 데이터는 어디에 저장되나요?**
A. 모두 사용자 로컬 디스크의 Electron `userData` 폴더:
- Windows: `%APPDATA%/flowbrowser-ai/`
- macOS: `~/Library/Application Support/flowbrowser-ai/`

파일: credentials.json (암호화) / user-setting.json / glossary.json / domain-policy.json / tabs.json / thumbnails.json / pageresult.json / cache.json / usage.json

---

## 7. 알려진 한계

- **Codex Login**: OpenAI 공식 등록 파트너십이 아닌 회색지대. OpenAI 측 차단 가능성 상존. BYOK 폴백 필수.
- **Phase 1 PoC 4종 (Phase 1.5 트랙)**: 실제 사용 후 측정 예정 — (1) Codex Login 비용 실측 / (2) 차단 시그널 / (3) 모델 가용성 차이 / (4) refresh token 만료 정책.
- **Phase 2~5 미진입**: YouTube 자막 / TTS 더빙 / 싱크 제어 / STT는 Phase 2+에서 활성. Phase 1 본 가이드 범위 외.
- **사용자 인터뷰 (Spike 5)**: 가이드만 작성된 상태, 실제 인터뷰는 사용자 직접 진행.
- **탭 미리보기**: 활성 탭으로 한 번이라도 표시된 적이 있어야 캡처됨. 새 탭 또는 한 번도 활성화 안 된 탭은 placeholder.

## 변경 이력

- 2026-05-15: v1 작성 (Sprint 014 M3, Phase 1 사용자 테스트 진입)
