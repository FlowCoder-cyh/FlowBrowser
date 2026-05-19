# FlowBrowser AI

**본 페이지를 자동 기억하면서, 프로젝트별로 환경이 격리되는 AI 리서치 브라우저.**

## 한 줄 정의

방문한 페이지를 자동으로 로컬 인덱싱(SQLite + 임베딩)하고, 시간축·의미 검색·AI 채팅으로 다시 꺼내 쓰는 워크스페이스 격리형 브라우저. Chrome 확장으로 못 하는 영역 (대용량 로컬 인덱스 / 다중 워크스페이스 / 시스템 통합) 만 자체 브라우저로.

## 현재 상태

**Phase 1 형식적 종료 + Sprint 016 M0 진행 중** — PRD v0.4.0 정식 발행 / 누적 단위 테스트 1101 / 76 PR 머지.

- Phase 0 (치명 가설 검증 Spike 5종) — 완료
- Phase 1 (실시간 페이지 번역 MVP) — **방향 전환 (2026-05-16)**: 페이지 번역 폐기 + "AI 콘텐츠 메모리 + 워크스페이스 브라우저" 로 재정의
- Sprint 015 M0~M6 (v0.4 재정의 + 신규 인프라) — 완료
- Sprint 016 M0 (KI MEDIUM batch + perf bench infra) — 진행 중 (T03/T05 완료, T01/T02/T04/T06 잔여)

자세한 진행 상태는 [`.flowset/state.md`](./.flowset/state.md), 최신 핸드오프 [`.flowset/handoffs/`](./.flowset/handoffs/).

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
   - **Codex Login (Experimental)**: ChatGPT 구독 계정으로 로그인 (별도 API Key 비용 없음, OpenAI 차단 가능성 사전 고지)
   - **OpenAI API Key (BYOK)**: 직접 발급한 sk-... 키 등록
3. 페이지를 평소처럼 방문하면 자동 인덱싱 시작 — `Ctrl+K` 로 검색바, AI 채팅 패널, 노트 패널 진입

상세 사용법은 [`docs/USAGE.md`](./docs/USAGE.md) 참고.

## 주요 기능 (PRD v0.4)

- **자동 페이지 인덱싱** — 방문한 페이지 본문을 로컬 SQLite + 임베딩 (sqlite-vec) 으로 자동 저장. did-finish-load 시점에 Privacy Gate 평가 후 통과 시 recordVisit
- **워크스페이스 격리** — 프로젝트별 탭/메모리/AI/노트 완전 분리. 워크스페이스 전환 시 탭 그룹 stash/restore + 메모리 격리
- **시간축 + 의미 검색** — `Ctrl+K` 검색바. 자연어 시간 파싱 ("지난주", "이번달 화요일") + 의미 검색 (top-10 retrieval). 결과 카드에 시간 시그널 + 매칭 발췌
- **AI 채팅** — `ChatService.chat()` + `AiChatHistoryStore` 영속. PromptComposer 가 시스템 프롬프트 + retrieved_items + 사용자 질문 조립. 호출자가 명시 retrieval 주입 시 출처 인용 (chat_meta.cells.sources) — 자동 retrieval wiring (ChatPanel → SearchService 자동 호출) 은 Sprint 016 M_ 또는 후속 hotfix 예정
- **노트 + 자동 임베딩** — 페이지에서 선택 텍스트 → 노트 생성 → EmbeddingQueue 자동 등록 → 검색 대상 포함
- **다중 탭 + 워크스페이스 컨텍스트** — 워크스페이스 아이콘 prefix 라벨, 컬러 라벨, 핀, 미리보기 (hover), 닫은 탭 복원 (Ctrl+Shift+T), 워크스페이스 전환 시 stash/restore
- **메모리 통계 패널** — 워크스페이스별 페이지/방문/노트/채팅 카운트 + 마지막 인덱싱 시각 (broadcast 자동 갱신)
- **백그라운드 장시간 번역** — 논문/PDF 등 시간 걸려도 백그라운드 처리 + 완료 알림 (Sprint 016 M4 예정, 유일하게 유지된 번역 기능)

## 보안

- 모든 secret은 OS Keychain (Windows DPAPI / macOS Keychain) 위임 — Electron safeStorage, 평문 보관 안 함
- **Privacy Filter (G-004 P0 기능)**: 비밀번호 / 카드 필드 / 본문 카드 패턴 자동 차단. 사용자 토글로 우회 불가
- **IndexingGate (PRD §8.6)**: 자동 인덱싱 전 도메인/path/password 검사. 13 디폴트 RegExp + icloud + naver mail path glob + 사용자 `privacyExclusions` (block/allow)
- 도메인 정책 + 사용자 동의 매트릭스
- 모든 외부 전송 로그 (TransmissionLogger)

## 문서

- [사용자 가이드](./docs/USAGE.md) — 빌드/실행/Provider 등록/기능별 사용법/FAQ
- [PRD 목차](./docs/prd/README.md) — 제품 요구사항 명세 v0.4.0 (19 섹션)
- [현재 상태](./.flowset/state.md) — Phase / Sprint / 다음 작업
- [최신 핸드오프](./.flowset/handoffs/) — 일자별 작업 종결 기록
- [가드레일 (누적 규칙)](./.flowset/guardrails.md) — G-001 ~ G-015
- [Known Issues](./.flowset/known-issues.md) — KI-NNN 본문 + 잔여/해소 통계
- [Sprint 계약](./.flowset/contracts/) — Sprint 별 수용 기준 + 작업 매트릭스
- [방향 SSOT](./.flowset/specs/v04-direction.md) — v0.4 재정의 결정 38건

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
| `npm run build` | production 빌드 (typecheck + electron-vite) |
| `npm start` | 빌드된 앱 미리보기 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict check (main + renderer) |
| `npm test` | Vitest 단위 테스트 |

### 기술 스택

- **Electron** ≥ 39.0.0
- **Build**: electron-vite (Vite 6)
- **UI**: React 18 + TypeScript 5 (strict)
- **Storage**: better-sqlite3 12.10 + sqlite-vec (벡터 검색)
- **AI**: OpenAI API + Codex OAuth (device-code grant)
- **Test**: Vitest (단위 1101 + 시나리오 통합 8 + perf bench Sprint 016 M0 T06 예정)
- **Format / Lint**: Prettier + ESLint

## 프로젝트 메타

| 항목 | 값 |
|---|---|
| PROJECT_CLASS | hybrid (PRD/문서가 코드만큼 핵심 자산) |
| FlowSet 버전 | v4.0.4 (점진 활성화) |
| 현재 Phase | 1 형식적 종료 + Sprint 016 M0 진행 |
| PRD 버전 | v0.4.0 정식 발행 |
| 지원 OS | Windows 10+, macOS 13+ (Ventura) — sqlite-vec macOS CI matrix 후속 |

## 라이선스 / 기여

(추가 예정)
