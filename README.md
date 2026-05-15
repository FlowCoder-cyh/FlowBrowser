# FlowBrowser AI

영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저.

## 한 줄 정의

**영어 웹사이트와 영상을 한국어로 읽고, 보고, 들을 수 있게 해주는 AI 네이티브 브라우저**

## 현재 상태

**Phase 1 — 웹 번역 MVP** (사용자 테스트 진입 단계, PRD v0.3.11+, Sprint 014 진행 중)

Phase 0 5종 Spike 완료, Phase 1 MVP 구현 진행 (Sprint 001~014).

## 빠른 시작 (사용자 직접 테스트)

```
git clone https://github.com/FlowCoder-cyh/FlowBrowser.git
cd FlowBrowser
npm install
npm run dev          # 개발 모드 (HMR)
```

또는 production 빌드 후 실행:
```
npm run build
npm start
```

첫 실행:
1. **데이터 처리 동의** 화면에서 동의
2. **온보딩** 화면에서 Provider 선택
   - **Codex Login (추천, Experimental)**: ChatGPT 구독 계정으로 로그인 (별도 API Key 비용 없음)
   - **OpenAI API Key**: BYOK 모드
3. 추천 URL 클릭 또는 직접 URL 입력하여 번역 기능 체험

상세 사용법은 [`docs/USAGE.md`](./docs/USAGE.md) 참고.

## 주요 기능 (Phase 1)

- **선택 영역 번역** — 텍스트 드래그 + 우클릭 → "한국어로 번역"
- **문단 / 페이지 전체 번역** — 우측 패널에서 실행, 진행률 표시
- **쉬운 설명 / 페이지 요약** — 컨텍스트 메뉴 또는 우측 패널
- **표시 모드 3종** — panel / replace (DOM 치환) / overlay (인접 박스)
- **다중 탭** — 드래그/순서 변경, 컬러 라벨, 핀, 미리보기 (hover), 닫은 탭 복원 (Ctrl+Shift+T), 영속
- **키보드 단축키** — Ctrl+T 새 탭, Ctrl+W 닫기, Ctrl+Tab 순환
- **용어집** — 도메인별 고정 번역 + glossaryVersion 캐시 invalidation
- **도메인 화이트/블랙리스트** — 차단/허용 정책
- **번역 캐시** — 복합 키 + TTL 90/365일 + LRU
- **페이지 결과 영속** — URL+선택자 단위 재방문 복원

## Provider 전략

- **Codex Login** (Experimental, PRD §15.2 P0): ChatGPT 구독 계정 로그인. 공식 등록 파트너십이 아니며 OpenAI가 차단할 가능성 있음. 차단 시 자동으로 OpenAI API Key로 폴백.
- **OpenAI API Key** (BYOK, MVP 기본 폴백): OpenAI 콘솔에서 발급한 sk-... 키. OS Keychain (Electron safeStorage)에 위임 저장.
- 향후: Anthropic / Gemini / DeepL 등 (Phase 1.5+)

## 보안

- 모든 secret은 OS Keychain (Windows DPAPI / macOS Keychain) 위임 — 평문 보관 안 함
- Privacy Filter (P0 기능): 비밀번호 / 카드 필드 / 본문 카드 패턴 자동 차단 (사용자 토글로 우회 불가)
- 도메인 정책 + 사용자 동의 매트릭스
- 모든 전송 로그 (TransmissionLogger)

## 문서

- [사용자 가이드](./docs/USAGE.md) — 빌드/실행/Provider 등록/기능별 사용법/FAQ
- [PRD 목차](./docs/prd/README.md) — 제품 요구사항 명세 v0.3.11
- [Phase 0 Spike 결과](./docs/prd/09_roadmap_phase0.md)
- [현재 상태](./.flowset/state.md)
- [최신 핸드오프](./.flowset/handoffs/)
- [가드레일 (누적 규칙)](./.flowset/guardrails.md)

## 개발 환경

### 사전 조건

- Node.js ≥ 20
- npm ≥ 10
- Git

### 명령어

| 명령 | 용도 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | 개발 모드 (HMR) |
| `npm run build` | production 빌드 |
| `npm start` | 빌드된 앱 미리보기 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict check (main + renderer) |
| `npm test` | Vitest 단위 테스트 |

### 기술 스택

- **Electron** ≥ 39.0.0
- **Build**: electron-vite (Vite 6)
- **UI**: React 18 + TypeScript 5 (strict)
- **Test**: Vitest
- **Format / Lint**: Prettier + ESLint
- **OAuth**: device-code grant (Codex CLI 호환), Electron safeStorage

## 프로젝트 메타

| 항목 | 값 |
|---|---|
| PROJECT_CLASS | hybrid (PRD/문서가 코드만큼 핵심 자산) |
| FlowSet 버전 | v4.0.4 (점진 활성화) |
| 현재 Phase | 1 (웹 번역 MVP, 사용자 테스트 진입 단계) |
| PRD 버전 | v0.3.11+ (Sprint 014 진행 중) |
| 지원 OS | Windows 10+, macOS 13+ (Ventura) |

## 라이선스 / 기여

(추가 예정)
