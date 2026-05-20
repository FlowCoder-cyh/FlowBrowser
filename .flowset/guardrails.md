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

## Phase 1 / v0.4 재정의 이후 신규 (Sprint 015~)

### G-012 [active] v0.4 방향 SSOT

- **규칙**: `.flowset/specs/v04-direction.md` 가 v0.4 방향 단일 출처. requirements / state / handoff / PRD §0 / README 모두 본 파일을 인용·참조만. 역방향 (PRD 변경 후 v04-direction 미동기화) 금지.
- **Why**: 방향 전환 (2026-05-16) 후 결정 38건 / 다층 갱신 14건 누적. SSOT 단일 출처가 없으면 폐기/유지/일반화 분류 흔들림.
- **How to apply**: v0.4 결정 변경 시 v04-direction.md 우선 갱신 → PRD / requirements / README 동기화. M1 활성 (Sprint 015 진입 시점).
- **출처**: Sprint 015 contract §5 신규 가드레일 선언

### G-013 [active] 단계별 PR 전략

- **규칙**: 모듈 리팩토링·일반화·폐기 시 (1) 신규 모듈 + 어댑터 신규 → (2) 신규 사용처 적용 → (3) 기존 호출지점 제거 순서 강제. 한 PR 내 신/구 동시 변경 금지.
- **Why**: 단계별 회귀 회피 + 머지 후 즉시 롤백 가능. Sprint 015 M2 어댑터 일괄 제거 시 호출자 충돌 사례 학습.
- **How to apply**: 신규 모듈 PR → 적용 PR → 폐기 PR 3편 분할. M2 활성 (Sprint 015).
- **출처**: Sprint 015 contract §5 신규 가드레일 선언

### G-014 [active] 데이터 마이그레이션 dry-run + 자동 백업

- **규칙**: schema 변경 / JSON V1→V2 마이그레이션 시 (1) dry-run 옵션 우선 + (2) `<userDataDir>/backup/v03/<ISO_ts>/` 자동 백업 + (3) idempotent path 보장 강제.
- **Why**: v0.3 → v0.4 마이그레이션 5단계 + Sprint 016 M0 T03a JSON V1→V2 백업 누락 codex BLOCKING 사례.
- **How to apply**: 신규 마이그레이션 PR 마다 백업 path + 회귀 적용 검증. M3 활성 (Sprint 015) + T03a 시점 강화.
- **출처**: Sprint 015 contract §5 신규 가드레일 선언 + M0 A3 정정

### G-015 [active] Phase 2 cookies partition 격리

- **규칙**: `session.fromPartition('persist:ws-<uuid>')` 로 워크스페이스 단위 cookies / localStorage / IndexedDB 격리 강제. 사용자 명시 동의 후 활성화.
- **Why**: 워크스페이스 격리 (PRD §11) 의 핵심 — Phase 2 cookies partition 부재 시 동일 사이트가 모든 워크스페이스에서 동일 세션 공유 → 격리 실효 0.
- **How to apply**: Sprint 016 M3 T14 WorkspacePartitionManager 신규 + T15/T16 cascade. 사용자 동의 UI 박힘 전까지 dry-run 만.
- **출처**: Sprint 016 contract §5 신규 가드레일 선언

### G-018 [active] PR 산출물 매트릭스 정확성 (학습 #15 본체)

- **규칙**: PR body 의 산출물 표 (변경 파일 + 변경량 + 비고) 가 실측 `git diff --stat` 와 정합해야 함. 누락된 파일이 있으면 dual review 가 cover 외라 강제 검증 불가 (학습 #15 본체).
- **금지**:
  - PR body 산출물 표에 누락된 파일 (변경됐는데 본문 미명시)
  - 변경량 추상 표기 (`+N` 또는 "약 N 줄") — 실측 `git diff --stat` 수치 박음 강제
  - 메타 변경 PR (가드레일 / 학습 / 자동 강제 path 변경 등) 에서 `.flowset/state.md` 동기화 누락
- **Why**: Sprint 016 M0 PR #189/#190 사건 (2026-05-20) — 본인이 산출물 목록에 `.flowset/state.md` 미포함 → evaluator/codex 가 cover 외 강제 검증 불가 → L12/L13 §10 시점 잔존 → PR #191 사후 정정. 학습 #15 §13.3 #3 에서 본인이 G-018 후보 직접 명시.
- **How to apply**:
  - PR body 작성 직전 `git diff --stat <base>..HEAD` 출력을 산출물 표 base 로 사용 (변경량 정확)
  - 메타 변경 PR (가드레일 / 학습 #N / 자동 강제 path) 시 반드시 `.flowset/state.md` L12-L13 + 최근 핸드오프 한 줄 갱신 산출물 포함
  - 본 사항 검출 path 후보: PR template 의 산출물 표 양식 보강 + flowset-policy-check.yml 의 산출물 표 존재 grep + Stop hook 의 산출물 vs diff 대조 (본 PR 범위는 PR template + flowset-policy-check.yml 까지, Stop hook 자동 대조는 mini-milestone δ 후보로 위임)
- **출처**: 학습 #15 (2026-05-20 PR #191) §13.3 #3 본인 직접 명시 후보 → 본 PR (mini-milestone γ) 정식 등록

### G-017 [active] PR 닫음/머지 후 원격 브랜치 즉시 정리

- **규칙**: 모든 PR 의 head 브랜치는 PR 종결 (MERGED 또는 CLOSED) 시점에 원격에서 즉시 삭제. 정책 path:
  - **MERGED**: `gh pr merge --delete-branch` 옵션 강제. GitHub repo `delete_branch_on_merge: true` 설정 활성 (현재 적용).
  - **CLOSED (머지 안 함)**: GitHub 정책상 자동 삭제 안 됨 → 닫는 즉시 `git push origin --delete <branch>` 수동 실행 강제.
  - **검출 path**: `.flowset/hooks/stop.mjs` 가 세션 종료 시 잔존 원격 브랜치 점검 + 경고 (gh CLI 사용, MERGED/CLOSED 분류).
- **금지**: PR 닫음/머지 후 원격에 head 브랜치 잔존 24h 이상.
- **Why**: Sprint 016 M0 PR #189 직후 점검 시 PR #178 (CLOSED, 학습 #5 정정 시도 흡수) + PR #141 (MERGED, Sprint 015 M4-4 `feature/` prefix 시점 `--delete-branch` 누락) 2종 잔존 발견. 원격 브랜치 누적 시 (1) main 외 브랜치 잡음 (2) `git fetch --prune` 무효 (3) 사용자/팀원 혼동. mini-milestone β 4-layer 자동 강제 path 가 닫힘 PR 의 head 브랜치 정리는 cover 안 함.
- **How to apply**:
  - PR 머지: `gh pr merge --auto --squash --delete-branch` 표준 (본 세션 본인 PR #176~#189 모두 적용)
  - PR 닫음: `gh pr close <num>` 직후 `git push origin --delete <branch>` 즉시 실행
  - 세션 종료 시 Stop hook 의 G-017 경고 항목 확인 후 잔존 브랜치 cleanup
  - GitHub repo Settings → "Automatically delete head branches" 활성 유지 (`delete_branch_on_merge: true`)
- **출처**: 본 세션 학습 #14 (2026-05-20 PR #190 시점) — 사용자 본질 지적 "원격에 보면 브렌치가 여러개있는데 왜 머지후에 브렌치정리가 안된건지 검토해" + 옵션 B/C 채택

### G-016 [active] Dual review = read-only 강제 (도구 분류 정합, 학습 #16 보강)

- **규칙**: codex 도구는 각자 용도. dual review (read-only 평가) 시 review-only 도구만 사용. rescue/fix/investigation 의도 시 `/codex:rescue` 정합 도구.

**도구 분류 (실측 본문 인용 + 학습 #16 보강)**:

| 도구 | 권한 | 적합 시나리오 | 본문 인용 |
|---|---|---|---|
| **`/codex:adversarial-review`** | review-only | **dual review 1순위 (free-form focus text 지원, git state review)** | "Unlike `/codex:review`, it can still take extra focus text after the flags" (`adversarial-review.md` L45) |
| `/codex:review` | review-only | git state native review (focus text 미지원, 단순 코드 review) | "This command is native-review only. It does not support ... extra focus text" (`review.md` L39) |
| raw MCP `mcp__codex__codex` + `sandbox: "read-only"` + `approval-policy: "never"` + model 생략 | review-only | **git state 무관 자유 협의/평가** (working tree 없거나 free-form prompt) | (Claude Code MCP tool, sandbox 옵션으로 강제) |
| raw MCP + `sandbox: "workspace-write"` | write | 명시적 write 의도 시 (특수 케이스) | — |
| **`/codex:rescue`** | workspace-write | **rescue / fix / investigation 의도 시 정합 도구** (write 권한 필요) | (codex-rescue subagent forwarder, fix request) |

- **dual review 본문에 사용 금지** (도구 자체 금지가 아닌 **dual review 케이스 한정**): `/codex:rescue` 를 dual review 체크박스 행에 명시 시 CI `flowset-policy-check` 차단. write 권한이라 codex agent 가 직접 commit/push 가능 → review-only 본질 위반.

- **`/codex:rescue` 정합 사용**: rescue/fix/investigation 명시 의도 있을 때 정상 path (별도 작업으로). dual review 와 다른 호출 시점.

- **Why**: Sprint 016 M0 PR #188 (2026-05-20) 사건 — 본인이 `/codex:rescue` 로 dual review 호출 시 codex agent 가 백그라운드 write + commit `6ddf09e` + push 진행. 학습 #13 박음. 본 세션 추가 학습 #16 (2026-05-20 본 turn) — 본인이 G-016 박을 때 `/codex:review` 1순위로 박았으나 실측 본문에 따르면 **`/codex:adversarial-review` 가 free-form focus text 지원 → dual review 1순위 정합**. 본인이 PR #189/#190/#191 dual review 모두 raw MCP 사용 (slash 무시) — 도구 분류 부정확.

- **How to apply**:
  - 매 PR / 핸드오프 / Milestone 종료 시 evaluator + **`/codex:adversarial-review`** (1순위) 병렬 호출 강제
  - git state 무관 자유 협의 시 raw MCP `sandbox=read-only` (3순위)
  - codex 호출 결과 = 평가 보고서만, codex 자체는 파일 수정 / commit / push 절대 안 함
  - Claude 가 dual review 결과 취합 → hotfix 흡수 → commit / push / PR 단독 진행
  - PR body Dual Review 섹션의 codex 행은 `/codex:adversarial-review` 또는 `/codex:review` 또는 raw MCP `sandbox=read-only` 명시
  - **`/codex:rescue` 는 별도 호출 (rescue/fix 의도 시) — dual review 본문에 박지 않음**
- **출처**: 학습 #13 (PR #188 사건) + 학습 #16 (본 turn 도구 분류 정확화) + `/codex:adversarial-review.md` L45 본문 인용

---

## 변경 이력

- 2026-05-11: G-001 ~ G-010 초기 등록 (PRD v0.2 + 사용자 글로벌 규칙 기반)
- 2026-05-11: G-011 추가 (Phase 0 종합 보고 §8 권고 반영, Spike 1·2 회색지대 패턴 명문화)
- 2026-05-16: G-009 강화 — 학습 30 추가 (Sprint milestone + Task 조합 시 T 번호 분절 금지, Sprint 015 T01 amend 사례 반영)
- 2026-05-20: G-012 / G-013 / G-014 / G-015 정식 등록 (Sprint 015 / 016 contracts §5 선언 분리분 본체 흡수, mini-milestone α evaluator Partial NB-1 정합)
- 2026-05-20 (PR #188 후속): G-016 신규 등록 — Dual review = read-only 강제 표준. 본 세션 §10 핸드오프 PR #188 시점에 `/codex:rescue` slash 가 dual review 표준으로 박혀 codex agent 가 백그라운드 write + commit + push 진행 사건 (force-with-lease 로 복구). slash command 분류 명문화 + 자동 강제 path (hooks + PR template + memory) 모두 정정.
- 2026-05-20 (PR #189 후속): G-017 신규 등록 — PR 닫음/머지 후 원격 브랜치 즉시 정리 강제. 사용자 본질 지적 "원격에 보면 브렌치가 여러개있는데 왜 머지후에 브렌치정리가 안된건지 검토해" + 옵션 B/C 채택 — Stop hook G-017 점검 path 추가 + 가드레일 정식 등록.
- 2026-05-20 (mini-milestone γ, PR #192): **G-016 본문 보강 (학습 #16, 도구 분류 정합)** — `/codex:adversarial-review` 1순위 정합 + `/codex:rescue` 정합 사용 시나리오 별도 명시 + 도구 자체 금지 어조 제거. **G-018 신규 등록** — PR 산출물 매트릭스 정확성 강제 (학습 #15 §13.3 #3 본인 직접 명시 후보 정식화). 사용자 본질 지적 "슬래쉬스킬과 다른게 뭔데? 슬래시가 더 정확한거아니냐" + "rescue 는 금지할게아니라 쓰기가 필요할떈 써야될거아냐 용도를 구분해놓고 뭔 금지야".
