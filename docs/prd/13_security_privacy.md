# 13. 보안·프라이버시 (Security & Privacy)

> [← PRD 목차](./README.md)

본 섹션은 Privacy Filter 5단계 + OS Keychain 위임 + UA 정체성 + 결격사유 0 원칙 + 인덱싱 차단 정책. [§01 §1.3·§1.4](./01_overview.md#13-정체성--자체-브라우저-정직한-식별) + 가드레일 G-003·G-004·G-005·G-011 정합.

## 13.1 G-NNN 가드레일 매핑

본 §13 가 책임지는 가드레일:

| ID | 정의 | 적용 위치 |
|---|---|---|
| **G-003** | 인증 금지선 (ChatGPT 웹 세션·쿠키 / 비공식 토큰 추출 / 사용량 우회 / 계정 프록시 X) + 자동 호출 BYOK 디폴트 | §13.3 + §12.3 BYOK |
| **G-004** | Privacy Filter P0 (민감 페이지 비전송) | §13.2 5단계 |
| **G-005** | OS Keychain 위임 (secret 평문 저장 X) | §13.4 |
| **G-011** | 공개 endpoint 회색지대 허용 (Codex OAuth 등 — 단 G-003 금지선 준수) | §13.3.3 |

## 13.2 Privacy Filter 5단계 (v0.3 KEEP, G-004)

v0.3 `src/privacy/` 디렉토리 7 모듈 KEEP. 5단계 게이트 순차 통과해야 외부 Provider 호출 허용.

```
[사용자 페이지 + AI 호출 요청]
   ↓
[Step 1: ConsentGate]
   ├─ getState().consented === false → 차단 + Consent 모달 표시
   └─ true → 다음
   ↓
[Step 2: DomainFilter (DomainPolicyStore)]
   ├─ 차단 도메인 list 매칭 → 차단 + 인디케이터
   ├─ 사용자 명시 허용 (allowlist) → 다음
   └─ 디폴트 정책 (allow / require_approve) → 다음
   ↓
[Step 3: SensitiveFieldDetector]
   ├─ <input type="password"> 감지 → 차단 (Privacy 우선)
   └─ 통과 → 다음
   ↓
[Step 4: require_approve 정책 시]
   ├─ 사용자 1회 승인 dialog → 승인 시 통과
   └─ 거절 시 차단
   ↓
[Step 5: TransmissionLogger]
   ├─ 외부 호출 직전 로그 기록 (privacy_decision = 'allowed' / 'user_approved')
   ├─ 차단 케이스는 별도 카운터 (blocked_stats)
   └─ Provider Adapter 호출
```

### 13.2.1 실제 모듈 (v0.3 KEEP, A1 §C 정합)

| 모듈 | 책임 (실제 코드 grep 검증) |
|---|---|
| `src/privacy/ConsentGate.ts` | 첫 실행 동의 + 전역 ON/OFF (`getState()` / `giveGlobalConsent()` / `revokeGlobalConsent()`) |
| `src/privacy/DomainFilter.ts` | 도메인 패턴 매칭 (`*.bank` / `mail.*` / `accounts.*` / `signin.*` / `oauth.*` 등) |
| `src/privacy/DomainPolicyStore.ts` | 사용자 도메인 정책 영속 (allow / require_approve / deny) |
| `src/privacy/SensitiveFieldDetector.ts` | DOM `<input type="password">` 감지 |
| `src/privacy/TransmissionLogger.ts` | 외부 호출 로그 + blocked_stats |
| `src/privacy/types.ts` | PrivacyDecision / DomainPolicy 타입 |
| `src/privacy/index.ts` | barrel export |

### 13.2.2 v0.4 신규 (M4) — IndexingGate

[§08 §8.6](./08_indexing.md#86-privacy-indexinggate-m4) 정합. 자동 인덱싱 경로 Privacy 차단 (위 5단계 외 별도 — 인덱싱은 외부 호출 아니지만 메모리 누적 자체가 Privacy 결정).

`src/privacy/IndexingGate.ts` (NEW, A1 §E):
- 디폴트 차단 list 11 패턴 (§08 §8.6.1)
- `<input type="password">` 감지 시 차단
- 사용자 명시 override (1회)

## 13.3 결격사유 0 원칙 (정체성 + UA, G-003 + G-011)

[§01 §1.3·§1.4](./01_overview.md#13-정체성--자체-브라우저-정직한-식별) 본문. 본 §13 은 운영 정책 명시.

### 13.3.1 User-Agent (Brave/Edge/Vivaldi 패턴)

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 FlowBrowserAI/0.1.0
```

- Chromium 호환 토큰 유지 → 사이트 표준 응답
- `FlowBrowserAI/0.1.0` 자체 식별 토큰 추가 → 정직한 정체성
- 위장 X — Electron 토큰 제거 hack 금지

### 13.3.2 금지선 (G-003 강화)

| 항목 | 금지 |
|---|---|
| ChatGPT 웹 세션·쿠키 재사용 | 절대 금지 |
| 비공식 토큰 추출 (Codex CLI 인증 우회 등) | 절대 금지 |
| 사용량 한도 우회 | 절대 금지 |
| 사용자 계정 프록시화 | 절대 금지 |
| 헤드리스 모드 | 절대 금지 |
| fingerprint 변조 / 위장 | 절대 금지 |
| 자동 prefetch / 크롤링 | 절대 금지 |
| AI 자동 페이지 조작 (에이전트) | 절대 금지 |
| **자동 백그라운드 호출 = BYOK 디폴트** | Codex OAuth 자동 호출은 사용자 명시 동의 시만 (G-003 강화, [§12.3](./12_provider_adapter.md#123-byok-디폴트-정책-g-003-강화)) |

### 13.3.3 공개 endpoint 회색지대 허용 (G-011)

| 항목 | 허용 사유 |
|---|---|
| 공개 OAuth client ID (Codex `app_EMoamEEZ73f0CkXaXp7hrann`) 재사용 + PKCE | 3rd-party 사례 다수 (OpenClaw / Roo Code 등), OpenAI 명시 차단 안 함. G-003 금지선 준수 시 허용 |
| 공개 caption track URL fetch | v0.3 YouTube 폐기로 v0.4 미사용 |
| 비공식 transcript 라이브러리 | v0.4 미사용 |

## 13.4 OS Keychain 위임 (G-005)

### 13.4.1 위임 대상

| Secret | 저장 위치 | 보호 메커니즘 |
|---|---|---|
| OpenAI API Key | `<userDataDir>/credentials/openai-*.bin` | Electron `safeStorage.encryptString()` (실제 코드 `src/storage/Credentials.ts:78` 정합) |
| Codex OAuth 토큰 묶음 (access_token + refresh_token + id_token + expires_at) | `<userDataDir>/credentials/codex-*.bin` | 동상 (JSON 묶음을 safeStorage 암호화) |

### 13.4.2 OS별 메커니즘

| OS | safeStorage 백엔드 |
|---|---|
| macOS | Keychain Services |
| Windows | DPAPI (Data Protection API) |
| Linux | kwallet / Secret Service API / libsecret |

`safeStorage.isEncryptionAvailable()` 검증 (실제 코드 정합). 미지원 환경 (예: Linux headless, 일부 SSH 세션) 에서는 secret 저장 불가 — 사용자에게 명시 알림 + API Key 미저장 모드 (메모리만, 세션 한정).

### 13.4.3 토큰 refresh 정책

| Provider | refresh 정책 |
|---|---|
| OpenAI API Key | refresh X (사용자 직접 갱신) — 만료 / 무효 시 401 → 사용자 재입력 유도 |
| Codex OAuth | 만료 **60초 전** 자동 refresh (실제 코드 `CodexLoginProvider.ts` refresh 흐름). refresh_token rotation 처리. refresh 실패 → status='expired' 마킹 + BYOK 자동 fallback (사용자 명시 동의 시) |

## 13.5 인덱싱 차단 정책 (G-004 강화, M4)

[§08 §8.6](./08_indexing.md#86-privacy-indexinggate-m4) 정합. 본 §13 는 보안 관점 추가 명시.

### 13.5.1 차단 vs 외부 호출 차단 구별

| 차단 종류 | 게이트 | 범위 |
|---|---|---|
| **외부 Provider 호출 차단** | Privacy Filter 5단계 (§13.2) | API Key / Codex OAuth / Local LLM 모든 외부 호출 |
| **인덱싱 차단** (M4 NEW) | IndexingGate (§13.2.2) | Page·Visit·Embedding 누적 자체 차단 (외부 호출과 별개) |

### 13.5.2 디폴트 차단 list (11 패턴, [§08 §8.6.1](./08_indexing.md#861-디폴트-차단-list-v04-direction-§17-p1-9-pr-b61-강화) 인용)

본 list 는 v0.3 `DomainFilter.ts` 패턴과 정합 + v0.4 확장:

`*.bank.*` / `mail.*` / `gmail.com` / `*.paypal.com` / `*.icloud.com` / `accounts.*` / `signin.*` / `login.*` / `oauth.*` / `id.*` / `payment.*` / `pay.*` / `checkout.*` / `*.naver.com/mail/*` (path glob, M3 PathMatcher 도입)

### 13.5.3 사용자 명시 override

- 컨텍스트 메뉴 "이 페이지 인덱싱" 클릭 시 1회 override
- override 결정 영속 X (재방문 시 다시 차단) — Phase 2+ "이 도메인 항상 인덱싱" 옵션 검토
- override 시 [§07 §7.4.2 MemoryStatsPanel](./07_ui_layout.md#742-memorystatspanel-m6) 에 차단 해제 인디케이터 + 감사 로그 (TransmissionLogger)

## 13.6 데이터 위치 + 백업·복구

[§04 §4.6](./04_data_model.md#46-실패재시도-시나리오) + [§19](./19_migration_v03_v04.md) 정합.

### 13.6.1 사용자 데이터 위치

```
<userDataDir>/
├── flowbrowser.db              # SQLite 통합 DB (Workspace/Page/Visit/Note/AiChatHistory/Tag/Embedding)
├── page-content/               # 본문 캐시 디렉토리 (content_hash 기반)
├── credentials/                # safeStorage 보호 secret
│   ├── openai-*.bin
│   └── codex-*.bin
├── backup/v03/<ISO_ts>/        # v0.3 → v0.4 마이그레이션 자동 백업
├── migration-v04.log           # 마이그레이션 로그
└── usage-log.json              # UsageLog (v0.3 KEEP → v0.4 GENERALIZE schema M3, §12.6)
```

OS 별 userDataDir:
- Windows: `%APPDATA%/flowbrowser-ai/`
- macOS: `~/Library/Application Support/flowbrowser-ai/`
- Linux: `~/.config/flowbrowser-ai/`

### 13.6.2 백업·복구 정책

| 시나리오 | 정책 |
|---|---|
| v0.3 → v0.4 마이그레이션 | 자동 백업 + dry-run + revert (G-014, [§19](./19_migration_v03_v04.md)) |
| 워크스페이스 단위 백업 | Phase 1 JSON Export ([§11 §11.5.6](./11_workspace.md#1156-import--export-phase-1-base--pr-b71-추가)) |
| 전체 DB 백업 | 사용자 수동 (`<userDataDir>/flowbrowser.db` 복사) — Phase 2+ 자동 백업 옵션 검토 |

## 13.7 외부 통신 감사

[§12.6 UsageLog](./12_provider_adapter.md#126-cost-tracking-usagelog-generalize--pr-b71-정정) 정합 — 모든 외부 호출 로그:

| 로그 필드 (v0.4 M3 schema 후) | 사용처 |
|---|---|
| providerId / model | 호출 출처 추적 |
| feature (v0.4 chat / embed / tag / background_translation) | use case 분류 |
| domain | 어떤 사이트 컨텍스트에서 호출 |
| privacyDecision ('allowed' / 'user_approved') | Privacy Filter 통과 경로 |
| status / errorCode | 실패 분석 |
| workspaceId (M3 신규) | 워크스페이스별 감사 |

사용자가 SettingsPage > UsagePanel 에서 전수 조회 가능. 외부 노출 X (로컬 only).

## 13.8 보안 위협 모델

본 시스템이 방어 / 비방어 위협:

| 위협 | 방어 여부 | 메커니즘 / 비고 |
|---|---|---|
| **API Key 디스크 평문 노출** | ✓ | safeStorage (OS Keychain 위임) |
| **민감 페이지 외부 전송** | ✓ | Privacy Filter 5단계 |
| **민감 페이지 인덱싱 (메모리 누적)** | ✓ | IndexingGate (M4) |
| **워크스페이스간 데이터 누출** | ✓ Phase 1 메타 격리 / Phase 2 cookies·storage 격리 | sqlite-vec workspace_id partition_key + Phase 2 session.fromPartition |
| **사용자 디스크 접근 시 데이터 평문 노출** | ✗ Phase 1 / 검토 Phase 2+ | SQLite 평문. Phase 2+ at-rest encryption 옵션 검토 (better-sqlite3 + SQLCipher 등) |
| **악성 확장 / Electron 취약점** | ⚠️ 부분 | 사용자 설치 확장 부재 (Chrome 확장 미지원), Electron 최신 (`^39.0.0`) 유지 |
| **fingerprint 추적** | ⚠️ Chromium 디폴트 (변조 X) | Brave 수준 fingerprint 보호 X — Phase 3+ 검토 |
| **악성 사이트 RCE / XSS** | Chromium sandbox | site isolation + sandbox 의존 |

## 13.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §2 (정체성 + 결격사유 0) + §17 (Privacy 11 패턴)
- `.flowset/guardrails.md` G-003 / G-004 / G-005 / G-011
- [§01 §1.3·§1.4](./01_overview.md)
- [§08 §8.6 IndexingGate](./08_indexing.md#86-privacy-indexinggate-m4)
- [§11 §11.2.2 Phase 2 Partition](./11_workspace.md#1122-phase-2-격리-electron-partition)
- [§12 §12.3 BYOK 디폴트](./12_provider_adapter.md#123-byok-디폴트-정책-g-003-강화) + [§12.4.4 fallback 제한](./12_provider_adapter.md#1244-fallback-제한-비용-폭주-방지)
- 실제 코드:
  - `src/privacy/` (7 모듈) — ConsentGate / DomainFilter / DomainPolicyStore / SensitiveFieldDetector / TransmissionLogger / types / index
  - `src/storage/Credentials.ts:78` (safeStorage)
  - `src/ai/providers/CodexLoginProvider.ts` (refresh 60초)

본 §13 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 13.10 변경 이력

- 2026-05-16 (PR b8): stub → 본문 작성. G-NNN 가드레일 매핑 4종 + Privacy Filter 5 step + 실제 모듈 7개 (코드 grep 검증) + IndexingGate (M4 NEW) + 정체성 (UA / 금지선 9종 / G-011 회색지대) + OS Keychain 위임 (OS별 메커니즘 + 토큰 refresh 60초) + 인덱싱 차단 정책 (11 패턴 + override) + 데이터 위치 + 백업·복구 + 외부 통신 감사 + 보안 위협 모델 (방어 4 / 부분 3 / 비방어 1).
