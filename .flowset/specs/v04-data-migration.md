# A3 — 데이터 마이그레이션 분석 (v0.3 → v0.4)

> **M0 사전 분석 산출물 3/4**
> Sprint 015 contract `S015-T03` 산출물.
> 입력: `.flowset/specs/v04-direction.md` (방향 SSOT, P0-1·P0-2) + `.flowset/specs/v04-migration-matrix.md` (A1) + `.flowset/specs/v04-test-classification.md` (A2)
> 출력: PRD §19 (migration) + Sprint 015 M3 T15 (`src/storage/migrations/v03_to_v04.ts`) 구현 입력

## 메타

- **작성일**: 2026-05-16
- **사용자 데이터 위치 (Electron `app.getPath('userData')`)**:
  - Windows: `%APPDATA%/flowbrowser-ai/`
  - macOS: `~/Library/Application Support/flowbrowser-ai/`
  - Linux: `~/.config/flowbrowser-ai/`
- **자동 백업 위치**: `<userDataDir>/backup/v03/{ISO_timestamp}/` (v04-direction §15 S4의 `~/.flowbrowser/backup/v03/` 표기 정정 — Electron userDataDir 사용이 OS 호환에 정확)
- **마이그레이션 로그**: `<userDataDir>/migration-v04.log`
- **결정 SSOT**: `.flowset/specs/v04-direction.md` §17 데이터 마이그레이션 + P0-1 (Glossary) + P0-2 (settings)

## 영속 대상 인벤토리 (v0.3, 5개 파일)

| # | 파일 | Store | Schema 핵심 | 분류 (A1) |
|---|---|---|---|---|
| 1 | `<userDataDir>/translation-cache.json` | TranslationCache | `{ entries: { [key]: { sourceText, targetText, sourceLanguage, targetLanguage, providerType, glossaryVersion, requestType, createdAt, lastAccess, ... } }, version }` | GENERALIZE → AIResponseCache |
| 2 | `<userDataDir>/page-results.json` | PageResultStore | `{ entries: [{ id, key, url, targetLanguage, providerType, glossaryVersion, nodesSignature, selectorPreset, instructions, createdAt, ... }], version }` | GENERALIZE → IndexedPageStore |
| 3 | `<userDataDir>/glossary.json` | GlossaryStore | `{ policyVersion, currentVersion, terms: [{ id, sourceTerm, targetTerm, description, domain, isActive, version, createdAt, updatedAt }] }` | DEPRECATE → Note 자동 이전 (P0-1) |
| 4 | `<userDataDir>/user-setting.json` | UserSettingStore | `{ translationMode, defaultLanguage, sourceLanguage, defaultProviderId, privacyFilterEnabled, cancelOnTabSwitch, onboardingShown }` | PARTIAL → 폐기 키 자동 제거 (P0-2) |
| 5 | `<userDataDir>/tabs.json` | TabStateStore | `{ tabs: [{ id, url, title, ... }], activeId }` | PARTIAL → workspace_id 메타 추가 |

추가 신규 (v0.4):
- `<userDataDir>/flowbrowser.db` — **신규 SQLite 통합 DB** (Workspace / Page / Visit / Note / AiChatHistory / Tag / Embedding 테이블)
- `<userDataDir>/page-content/` — 페이지 본문 캐시 디렉토리 (선택, content_hash로 dedupe)
- safeStorage 보호 secret (기존 유지 — Codex OAuth 토큰 / OpenAI API Key)

---

## A. 마이그레이션 매핑 (v0.3 → v0.4)

### A1. TranslationCache → AIResponseCache

| 항목 | v0.3 | v0.4 | 매핑 정책 |
|---|---|---|---|
| 위치 | `translation-cache.json` | `<userDataDir>/flowbrowser.db` (SQLite 테이블 `ai_response_cache`) 또는 별도 `ai-response-cache.json` (Sprint 015 M2 결정) | SQLite 통합 권고 (성능 + 일관성) |
| 키 구조 | `{sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion}` | `{kind: 'translation', sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion}` + `{kind: 'embedding'\|'ai_response'\|'tag', ...}` | `kind: 'translation'` 강제 부여 후 그대로 이전 |
| 데이터 | `sourceText` / `targetText` / `requestType` / TTL / LRU 메타 | 동일 + `kind` 추가 | 1:1 이전 + `kind` 부여 |
| TTL | 90/365일 차등 | 동일 정책 유지 (`kind: 'translation'`은 90일 / `'embedding'`은 영구 / `'ai_response'`는 30일 / `'tag'`는 90일) | 마이그레이션 시 TTL 재계산 |
| 마이그레이션 액션 | — | **자동 이전 (사용자 데이터 0건이라도 코드는 작성, 회귀 테스트 포함)**. 일부 무효 항목 (`requestType: 'summary'` 등 폐기 use case)은 차단 후 로그 기록 | M3 T15 구현 |

### A2. PageResultStore → IndexedPageStore

| 항목 | v0.3 | v0.4 | 매핑 정책 |
|---|---|---|---|
| 위치 | `page-results.json` | `flowbrowser.db` (Page + Visit 테이블) | SQLite 통합 |
| Page 매핑 | `{ url, targetLanguage, providerType, ... }` | `{ id, workspace_id, url, title, content, content_hash, embedding, lang, ... }` | URL 기반 page_id 생성 / workspace_id = "📥 기본" 부여 / title = url에서 추출 또는 빈 값 / content는 v0.3에 없음 (재방문 시 인덱싱) / embedding은 마이그레이션 후 백그라운드 큐 등록 |
| Visit 매핑 | `createdAt` | `{ id, page_id, workspace_id, visited_at, dwell_ms }` | createdAt → visited_at, dwell_ms = 0 (v0.3에 없음) |
| 본문 캐시 | (없음, instructions만 보존) | `<userDataDir>/page-content/{content_hash}.txt` | v0.3 instructions는 마이그레이션 시점에 폐기 (translation 결과 폐기 정책과 일치) |
| 마이그레이션 액션 | — | URL → Page + Visit 레코드 생성. content는 빈 값 (재방문 시 인덱싱). embedding 백그라운드 큐 등록 (Provider 활성 시) | M3 T15 + M4 T16 인덱싱 hook이 후속 처리 |

### A3. GlossaryStore → Note (P0-1)

| 항목 | v0.3 | v0.4 | 매핑 정책 |
|---|---|---|---|
| 위치 | `glossary.json` | `flowbrowser.db` (Note 테이블) | SQLite 통합 |
| 매핑 | `{ id, sourceTerm, targetTerm, description, domain, ... }` | `{ id, page_id: null, visit_id: null, workspace_id: "📥 기본", selected_text: "{sourceTerm}", body: "{targetTerm}\n\n{description}", ai_tags: ["glossary", domain] }` | `selected_text` = sourceTerm / `body` = `${targetTerm}\n\n${description}` / `ai_tags` = `["glossary", ...domain ? [domain] : []]` |
| anchor 키 | (페이지 무관) | page_id / visit_id 모두 NULL (3중 anchor에서 workspace_id만 박힘) | nullable 정합 |
| 임베딩 | (없음) | 마이그레이션 후 임베딩 백그라운드 큐 등록 (BYOK 호출, G-003 강화) | M3 T14 EmbeddingClient 호출 |
| 마이그레이션 액션 | — | 각 GlossaryTerm을 Note 1개로 변환 + 임베딩 큐 등록 + 검색 retrieval 대상 자동 포함 (R1) | M3 T15 구현 + M4 T18 자동 태깅은 skip (이미 ai_tags 박힘) |

### A4. UserSettingStore 폐기 키 제거 (P0-2)

| 키 (v0.3) | 운명 | 매핑 정책 |
|---|---|---|
| `translationMode` ('panel' / 'replace' / 'overlay') | **폐기** | 자동 제거. ChatPanel은 우측 패널 디폴트 (사용자 설정 불요) |
| `defaultLanguage` | **유지** (rename) | `targetLanguage`로 rename (필드명 명확화) |
| `sourceLanguage` | **유지** | 그대로 |
| `defaultProviderId` | **유지** | 그대로. 단 자동 인덱싱·태깅·임베딩은 BYOK 디폴트 (G-003 강화) — 별도 키 추가 X |
| `privacyFilterEnabled` | **유지** | 그대로 |
| `cancelOnTabSwitch` | **폐기** | paragraphs/page 작업 자체 폐기. 신규 인덱싱·임베딩 abort는 IndexingService 내부 정책 (사용자 설정 불요) |
| `onboardingShown` | **유지** | 그대로 |
| (신규) `workspaceDefault` | **추가** | "📥 기본" 워크스페이스 ID (마이그레이션 시 자동 생성 후 박힘) |
| (신규) `userLevelPreference` | **추가** | 워크스페이스별 (또는 글로벌 디폴트) "novice" / "intermediate" / "advanced". 디폴트 null (system prompt 분기 X) |
| (신규) `shortcutOverride` | **추가** | `{ "openSearch": "Cmd+K" }` 디폴트. 사용자 설정 가능 (Cmd+Shift+K 등) |
| (신규) `privacyExclusions[]` | **추가** | 인덱싱 차단 사용자 추가·제외 list (디폴트 빈 배열, Privacy Filter 디폴트 list와 union) |

### A5. TabStateStore (PARTIAL)

| 키 | v0.3 | v0.4 | 매핑 정책 |
|---|---|---|---|
| `tabs[].id` | string | string | 그대로 |
| `tabs[].url` | string | string | 그대로 |
| `tabs[].title` | string | string | 그대로 |
| `tabs[].workspaceId` | (없음) | string | **"📥 기본" 자동 부여** |
| `activeId` | string | string | 그대로 |

마이그레이션 액션: 모든 기존 탭에 `workspaceId: "📥 기본 워크스페이스 ID"` 추가.

### A6. safeStorage secret (변경 없음)

| 항목 | 운명 |
|---|---|
| OpenAI API Key (`<userDataDir>/credentials/openai-*.bin`) | KEEP (G-005 OS Keychain 위임) |
| Codex OAuth 토큰 묶음 (`<userDataDir>/credentials/codex-*.bin`) | KEEP |

변경 없음. v0.4 인덱싱·태깅·임베딩 신규 BYOK 호출도 동일 credential 재사용.

---

## B. 마이그레이션 절차 (M3 T15 구현 spec)

### B1. 트리거 조건

```
앱 시작 시 (services.ts rebuildAllStores 직전):
  if (exists(<userDataDir>/flowbrowser.db)) → already migrated, skip
  if (exists(<userDataDir>/translation-cache.json) || 
      exists(<userDataDir>/page-results.json) || 
      exists(<userDataDir>/glossary.json) || 
      exists(<userDataDir>/user-setting.json) || 
      exists(<userDataDir>/tabs.json)) → trigger migration
  else → fresh install, create empty flowbrowser.db + 📥 기본 워크스페이스
```

### B2. 절차 (5단계, G-014 적용)

```
Step 1: 자동 백업
  - mkdir -p <userDataDir>/backup/v03/<ISO_timestamp>/
  - cp <userDataDir>/{translation-cache,page-results,glossary,user-setting,tabs}.json → backup/v03/<ts>/
  - 로그: `[backup] copied 5 files to backup/v03/{timestamp}/`

Step 2: Dry-run 시뮬레이션
  - 임시 SQLite (in-memory) 생성
  - 5개 파일 읽기 → v0.4 매핑 → in-memory에 INSERT
  - 통계 로그: glossary terms N → notes N / cache entries M (translation kind) → ai_response_cache M / page-results K → pages K + visits K
  - 매핑 오류 발생 시 throw + 백업 보존, 사용자에게 알림 (Notification + 콘솔)

Step 3: 실제 마이그레이션
  - <userDataDir>/flowbrowser.db 생성 + v04.sql 스키마 적용
  - "📥 기본" 워크스페이스 INSERT (id 생성, name="기본", icon="📥", created_at=now)
  - 5개 매핑 (A1~A5) 순차 INSERT
  - settings UPSERT (폐기 키 제거 + 신규 키 디폴트)
  - 임베딩 백그라운드 큐 등록 (Provider 활성 시, Note + Page 모두)

Step 4: 원본 처리
  - <userDataDir>/{translation-cache,page-results,glossary,user-setting,tabs}.json → .deprecated 접미사 추가 (즉시 삭제 X, 사용자 안전망)
  - 30일 후 자동 삭제 정책 권고 (Phase 2+에서 cron 또는 시작 시 체크)

Step 5: 로그 + 통지
  - <userDataDir>/migration-v04.log 기록 (B3 형식)
  - 사용자 알림 (Notification API): "이전 데이터를 v0.4로 마이그레이션 완료 (Glossary N개 → 노트 / 캐시 M개 / 페이지 K개)"
```

### B3. 로그 형식 (`<userDataDir>/migration-v04.log`)

```
[2026-05-XX HH:MM:SS] migration v03 → v04 start
[backup] <userDataDir>/backup/v03/2026-05-XX_HHMMSS/ created
[backup] copied translation-cache.json (12.3 KB) / page-results.json (8.7 KB) / glossary.json (4.1 KB) / user-setting.json (0.5 KB) / tabs.json (1.2 KB)
[dry-run] simulating in-memory SQLite
[dry-run] glossary: 23 terms → 23 notes (ai_tags=['glossary', ...domain])
[dry-run] cache: 347 entries (kind=translation, TTL 재계산) / 5 entries 무효 (requestType=summary 폐기, skip)
[dry-run] page-results: 89 pages → 89 Page + 89 Visit (workspace_id=<default_ws_id>, content=빈값, embedding 큐 등록)
[dry-run] user-setting: translationMode 폐기 / cancelOnTabSwitch 폐기 / workspaceDefault·userLevelPreference·shortcutOverride·privacyExclusions 신규
[dry-run] tabs: 7 tabs → workspace_id=<default_ws_id> 부여
[dry-run] OK — proceed
[migrate] creating flowbrowser.db with v04.sql schema
[migrate] inserted workspace 📥 기본 (id=<uuid>)
[migrate] inserted 23 notes / 342 cache entries / 89 pages / 89 visits / settings updated / 7 tabs updated
[migrate] 5 cache entries skipped (requestType=summary 폐기): keys=[...]
[migrate] queued 23 note embeddings + 89 page embeddings (BYOK provider)
[rename] .json files → .deprecated.json (30일 후 자동 삭제 예정)
[2026-05-XX HH:MM:SS] migration v03 → v04 complete (총 N초)
```

### B4. revert 경로 (오류 발생 시)

```
오류 발생 시 자동 revert:
  - <userDataDir>/flowbrowser.db 삭제
  - .deprecated.json → .json 복원 (또는 backup/v03/<ts>/ 에서 복사)
  - migration-v04.log에 [error] + stack trace + revert 완료 기록
  - 사용자 알림: "마이그레이션 실패, 이전 데이터로 복구됨. 자세한 내용은 migration-v04.log 참조"
  - 다음 앱 시작 시 다시 트리거 (idempotent)
```

### B5. dry-run 회귀 테스트 (T02 NEW)

`tests/unit/storage/migrations/v03_to_v04.test.ts` (8 케이스):

1. **빈 데이터** — 5개 파일 모두 없음, fresh install → flowbrowser.db만 생성 + 📥 기본 워크스페이스
2. **GlossaryStore 마이그레이션** — 3 terms → 3 notes, ai_tags 정확성
3. **TranslationCache 마이그레이션** — translation kind 부여, 폐기 requestType skip
4. **PageResultStore 마이그레이션** — Page + Visit 정확 매핑, workspace_id 부여
5. **UserSettingStore 마이그레이션** — 폐기 키 제거 + 신규 키 디폴트
6. **TabStateStore 마이그레이션** — 모든 탭 workspace_id 부여
7. **dry-run 오류 시 revert** — 일부 매핑 throw → flowbrowser.db 생성 X + 백업 보존
8. **idempotent** — 동일 마이그레이션 두 번 실행 시 두 번째는 skip (flowbrowser.db 이미 존재)

5 케이스는 GlossaryStore.test.ts에서 이전 (A2 참조), 3 신규.

---

## C. v04-direction §15 S4 표기 정정

v04-direction §15 S4 안전장치 본문 "자동 백업 + dry-run":
> 신규 SQLite 스키마 도입 시 자동 백업 (`~/.flowbrowser/backup/v03/`) + dry-run 결과 로그 + revert 경로

**정정 권고**: `~/.flowbrowser/backup/v03/` → **`<userDataDir>/backup/v03/{ISO_timestamp}/`**

이유: Electron `app.getPath('userData')` 위치는 OS별 다름. `~/.flowbrowser`는 macOS·Linux 패턴이지만 Windows에서는 `%APPDATA%/flowbrowser-ai/` 사용. 통일은 userDataDir 기준.

→ M1 PRD v0.4 작성 시 v04-direction.md §15 S4 본문 수정 PR 권고 (또는 본 T03 산출물을 SSOT로 우선 인용).

---

## D. 호환 모드 (feature flag)

`UserSetting.flowbrowser.v04.enabled` (S3 feature flag) 동작:

| flag | 동작 |
|---|---|
| `false` (디폴트, 초기 5일간) | v0.3 어댑터 경로 유지, 마이그레이션 트리거 X. 사용자가 v0.4 활성화 시 마이그레이션 진입. (M2~M5 동안 안전망) |
| `true` | 마이그레이션 트리거 + 신규 모듈 사용 |

M5 종료 시 어댑터 제거 + flag 강제 `true` 박힘 (모든 사용자 v0.4 진입).

---

## E. 리스크 / 미지수

1. **마이그레이션 실행 시간 (대용량 데이터)**: 사용자 데이터가 누적된 경우 (예: page-results.json 500MB) 마이그레이션이 수십 초 걸릴 수 있음. 진행률 UI 표시 + 백그라운드 진행 검토.
2. **임베딩 백그라운드 큐 폭주**: 마이그레이션 후 수백 개 페이지·노트 동시 임베딩 큐 등록 시 OpenAI rate limit 위험. 큐 우선순위 (활성 탭 우선) + rate limit 백오프 필수.
3. **safeStorage 호환**: v0.3 credential은 그대로 유지하지만, OS 환경 변경 (Windows 사용자 프로파일 이동 등) 시 복호화 실패 가능. 기존 동작 그대로 (변경 X).
4. **`.deprecated.json` 30일 자동 삭제**: Phase 2+에서 cron 또는 시작 시 체크 구현. Phase 1에서는 영구 보존 (사용자가 수동 정리).
5. **v04-direction §15 S4 표기 정정**: M1 PRD 작성 시 본 T03 결과로 갱신 — v04-direction.md 자체 수정 PR 별도 진행 (G-012 SSOT 갱신).
6. **GlossaryStore에 ai_tags 1개 (도메인이 비어있을 때)**: GlossaryTerm.domain이 빈 문자열인 경우 `ai_tags=["glossary"]`만 박힘. 도메인이 있으면 `["glossary", domain]`. 빈 도메인 케이스 회귀 테스트 포함.

---

## F. 다음 (T04 입력)

- **T04 의존 그래프**: 5개 store의 모든 호출지점 (services.ts / main/index.ts IPC / renderer 사용 hook) 전수 + 마이그레이션 트리거 위치 (services.ts rebuildAllStores 직전) 명시

## G. 변경 이력

- 2026-05-16: Sprint 015 M0 T03 작성. v0.3 5개 영속 파일 → v0.4 매핑 완료. dry-run + 자동 백업 + revert 절차 박힘. v04-direction §15 S4 표기 정정 권고. 회귀 테스트 8 케이스 정의.
