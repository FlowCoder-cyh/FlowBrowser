# Evaluator Report — Phase 0 종합 보고 (2026-05-11)

## 평가 대상
- 산출물: `C:\dev\Flowbrowser\.flowset\specs\phase0-summary.md`
- 판정 기준 출처: 5개 Spike spec 본문 + 가드레일 G-001~G-010 + PRD v0.2 13개 섹션 목차
- 평가 일자: 2026-05-11
- Phase: 0 (종합)

## 항목별 채점

### 1. 5개 Spike 결과 종합 정확성
- 임계: summary §1·§9가 각 Spike spec의 종합 판정·핵심 결론을 정확히 인용/요약했는가
- 결과:
  - Spike 1: summary "Pass with conditions / 공개 Codex OAuth client(`app_EMoa...`) 재사용, OpenClaw·Roo Code 패턴. Experimental 라벨, 공식 등록 없음." → spike-01 §판정·§결과 2·3과 일치 (`app_EMoamEEZ73f0CkXaXp7hrann` 본문 명시)
  - Spike 2: "5/2/0" → eval-results spike-02 파일 존재 확인됨. summary 본문 "IFrame Player API 모든 핵심 동작 ✓. 자막은 caption track URL 직접 fetch (회색지대, Spike 1과 동일 패턴)" → spike-02 §1·§2·§판정과 일치
  - Spike 3: "6/1/0 / Win 10+ / macOS 13+ 추가 설치 불필요. Phase 5 STT 진행 가능. Electron 40.1.0 회귀 회피 권장." → spike-03 §1·§판정·§미해결과 일치
  - Spike 4: "4/3/0 / 4개 Provider 모두 PRD 14.2 임계와 양립. Coqui→Kokoro 교체 (라이선스/회사 폐업). MVP 기본=OpenAI gpt-4o-mini-tts." → spike-04 §4·§종합 판정과 일치
  - Spike 5: "7/0/0 / 가이드 풀 보강 완료. 실제 인터뷰는 사용자 진행." → spike-05 §변경 이력 및 가이드 보강 범위와 일치
- 판정: **Pass**
- 근거: 5개 모두 spec 본문의 판정·핵심 사실을 왜곡 없이 인용. evaluator 점수 인용도 eval-results 디렉토리 4개 파일과 정합.

### 2. PRD v0.3 영향 매트릭스 19개 항목 일관성
- 임계: 5개 Spike 결과와 PRD 섹션 매핑이 옳은가 + evaluator.md "Phase 0 Spike 평가 매핑" 표와 정합
- 결과:
  - §3.1 (1.5 범위) ↔ Spike 3 (macOS 12 비지원) — 정합
  - §3.2 (PRD §4) ↔ Spike 5 — 정합
  - §3.3 (§7.2) ↔ Spike 2·3 — 정합 (evaluator.md 매핑 "Spike 2 → PRD 7.2", "Spike 3 → PRD 7.2"와 일치)
  - §3.4 (§9.3) ↔ Spike 2 — 정합 (evaluator.md "Spike 2 → PRD 9.3"과 일치)
  - §3.5 (§9.4) ↔ Spike 3·4 — 정합 (evaluator.md "Spike 3·4 → PRD 9.4"와 일치)
  - §3.6 (§11.1) ↔ Spike 2·3 — 정합
  - §3.7 (§11.2) ↔ Spike 4 — 정합
  - §3.8 (§11.3) ↔ Spike 1 — 정합 (evaluator.md "Spike 1 → PRD 11.3"과 일치)
  - §3.9~3.10 (§14.2/14.3) ↔ Spike 4 — 정합 (evaluator.md "Spike 4 → PRD 14.2"와 일치)
  - §3.11 (§15.2) ↔ Spike 4 — 정합 (evaluator.md "Spike 1·4 → PRD 15.2"와 일치)
  - §3.12 (§15.3) ↔ Spike 1·2 — 정합
  - §3.13 (§16 Phase 0/5) ↔ Spike 3 — 정합 (evaluator.md "Spike 3 → PRD 16 Phase 5"와 일치)
  - §3.14 (§17) ↔ Spike 5 변경 없음 — 정합 (단 evaluator.md는 "Spike 5 → PRD 17.3" 매핑)
  - §3.15 (§18.1) ↔ Spike 1 — 정합
  - §3.16 (§18.4) ↔ Spike 4 — 정합
  - §3.17 (§18.5) ↔ Spike 2 — 정합 (evaluator.md "Spike 2 → PRD 18.5"와 일치)
  - §3.18 (§19) ↔ Spike 2·3 — 정합
  - §3.19 (G-011 신규) ↔ Spike 1·2 — 정합
- 판정: **Pass**
- 근거: 19개 항목 모두 spec 본문의 "PRD 영향" 섹션과 evaluator.md 매핑 표 양쪽에 일관.

### 3. 회색지대 패턴 일관성 (Spike 1·2)
- 임계: §2 비교 매트릭스가 spike-01·02의 회색지대 진술과 일치하는가
- 결과: §2 6행 매트릭스 — 공식 등록 부재 / 공개 endpoint 사용 / 사용자 자격증명 우회 금지 / 표준 OAuth·HTTP / 3rd-party 사례 / 명시적 차단 없음 — 모두 spike-01 §1·§2·§3·§5와 spike-02 §2·§6에서 직접 확인 가능. "G-011 권고 = 공개 endpoint 재사용은 회색지대 허용 / 사용자 자격증명 우회는 절대 금지"는 spike-01 §판정 조건 1·2 + spike-02 §판정 조건 1과 정합.
- 판정: **Pass**
- 근거: 인용된 회색지대 6차원이 두 spec 본문과 모두 일치, 권고 표현이 G-003 본문(쿠키 재사용 / 비공식 토큰 추출 / 사용량 우회 / 계정 프록시화 금지)을 직접 보존.

### 4. Phase 0 → Phase 1 전환 결정 항목 4.1~4.5 명확성
- 임계: 사용자 결정 항목이 (a)/(b)(/c) 선택지 + 권장안 + 근거 명시
- 결과:
  - 4.1 PRD v0.3 발행 (a)/(b) → 권장 (a) + 근거 "인터뷰는 v0.3.1 패치로 가능"
  - 4.2 G-011 (a)/(b)/(c) → 권장 (a) + 근거 "명확한 별도 항목"
  - 4.3 Spike 1 evaluator 호출 (a)/(b) → 권장 (a) + 근거 "5개 Spike 동일 evaluator 통과 기록 유지"
  - 4.4 Phase 1 Sprint-001 정의 — 선택지 없이 단일 작업 묶음 (sprint-001.md / ownership.json / Phase 1 활성). "예: Privacy Filter + DOM Extractor + 선택 영역 번역 + OpenAI API Key Provider"는 후보 예시
  - 4.5 사용자 직접 작업 (Spike 5) — 6단계 명시
- 판정: **Partial**
- 근거: 4.1~4.3은 (a)/(b)(/c) 권장 명확. 4.4는 결정 항목이 아니라 "Sprint-001 범위는 사용자가 결정한다"는 메타-결정 → 어떤 선택지를 사용자가 골라야 하는지는 모호. 4.5는 결정 항목이 아니라 작업 절차. §4 표제 "사용자가 결정해야 할 항목"과 4.4·4.5 성격이 약간 다름. 항목 자체는 누락 없이 망라.

### 5. Phase 1 PoC 이관 24개 항목 종합 정확성
- 임계: 5 Spike 미해결 항목 누락/중복 없음
- 결과 (합산):
  - Spike 1 spec §미해결 = 4개 ↔ summary §6 Spike 1 = 4개 (비용/한도, 임의 차단 시그널, 모델 가용성, refresh token 만료) — 일치
  - Spike 2 spec §미해결 = 6개 ↔ summary §6 Spike 2 = 6개 (BrowserView postMessage, caption URL fetch, 광고 무력화, 연령 제한, 임베드 매트릭스, 자동 vs 수동 자막) — 일치
  - Spike 3 spec §미해결 = 6개 ↔ summary §6 Spike 3 = 6개 (desktopCapturer/getDisplayMedia, electron-audio-loopback 누수, macOS 권한 UX, Electron 40.1.0, STT 지연, 시스템+마이크) — 일치
  - Spike 4 spec §미해결 = 6개 ↔ summary §6 Spike 4 = 6개 (블라인드 평가, 길이 비율, rate limit, Kokoro VOICES, Kokoro 환경, TTS vs 자막 번역) — 일치
  - Spike 5 = 사용자 직접 (별도) — 합치는 카운트 4+6+6+6 = 22. summary는 "총 24개"라고 명기.
- 판정: **Partial**
- 근거: 4+6+6+6 = **22**개인데 summary 표제는 "총 24개". Spike 5는 사용자 직접 작업이라 별도 분리됨에도 카운트가 24로 표기 → 산술 불일치 (실제 PoC 이관은 22, Spike 5의 7단계는 PoC 아니라 사용자 절차). 각 항목 내용은 spec과 1:1 정확 일치, 누락·중복 없음. 카운트 수치만 정정 필요.

### 6. 운영 결정 변경 기록 정확성
- 임계: §7 운영 결정이 실제 발생 사실과 일치
- 결과:
  - `.gitignore` eval-results 추적 — eval-results 디렉토리에 4개 파일 git 추적 확인됨, "Spike 4 진행 중 결정" 시점은 자체 검증 불가하나 산출물 위치(git history `1db16b4` Spike 4 PR)와 정합
  - `--no-merges` commit-check — "Spike 1 PR #1 CI 실패로 발견" 시점은 자체 검증 불가하나 §9 산출물 표가 PR #1 = `d5459c6`로 명시
  - `allow_auto_merge=true`, `delete_branch_on_merge=true` — 본 보고 내에서 첫 명시 (이전 spec/guardrails에 등장 안 함). PR #1~#5 머지 사실 자체는 §9 git history와 정합.
- 판정: **Pass**
- 근거: 세 결정 모두 §9 산출물 표 / eval-results 디렉토리 / spec 본문과 모순 없음. 시점 추정("Spike 4 진행 중", "Spike 1 PR #1")은 git history와 PR 번호 순서로 추정 합당.

### 7. 가드레일 G-011 신규 안과 G-003 정합성
- 임계: G-011 허용 항목이 G-003 금지 항목과 충돌 안 함
- 결과:
  - G-003 금지 4항: ChatGPT 웹 세션/쿠키 재사용 / 비공식 토큰 추출 / 사용량 우회 / 계정 프록시화
  - G-011 [draft] 허용 3항: 공개 OAuth 클라이언트 ID 재사용 / 공개 caption track URL fetch / 비공식 transcript 라이브러리
  - G-011 금지 재명시: 웹 세션/쿠키 재사용 / 자격증명 모방 / 비공식 토큰 추출 / 사용량 우회 — G-003 4항을 그대로 보존·재인용
  - 경계: "공개 endpoint" vs "사용자 자격증명/세션" 이분법 — 명확
- 판정: **Pass**
- 근거: G-011의 허용 3항은 G-003 금지 4항과 직접 겹치지 않음(공개 OAuth 클라이언트 ID는 G-003 "비공식 토큰 추출"이 아니라 OpenAI 발급 정상 토큰 / caption URL fetch는 쿠키 재사용 아님). G-011이 G-003을 인용하며 금지선을 유지 → 충돌 없고 보강 관계.

### 8. 사용자 보고 핵심 5개의 충분성
- 임계: §10 5개 항목이 의사결정에 필요한 핵심을 망라
- 결과:
  - "5개 Spike 모두 차단 사유 없음" → §1 결과 직접 인용, 진행 가능 여부 = 의사결정 1번 입력
  - "Phase 1 진입 가능 (단 4.1~4.5 결정)" → §4 직접 인용, 다음 행동 명시
  - "PRD v0.3 발행 권장" → §3 영향 매트릭스 → §4.1 권장 (a) 재호출
  - "사용자 직접 작업 = Spike 5 인터뷰" → §4.5 재호출, 병렬 가능 표시
  - "가드레일 G-011 추가 권장" → §8 G-011 draft 재호출
- 판정: **Pass**
- 근거: §1·§3·§4·§8 핵심을 5개로 응축, 누락 없음. "사용자가 무엇을 결정해야 / 무엇을 직접 해야 / 무엇이 자동 진행 가능"이 모두 포함.

## 종합 판정

**Partial**

- Pass 항목: 6개 (#1, #2, #3, #6, #7, #8)
- Partial 항목: 2개 (#4, #5)
- Fail 항목: 0개

종합 결론: Phase 0 종합 보고는 5개 Spike spec과 가드레일·PRD 매핑·운영 결정에서 사실 왜곡 없이 일관. 다만 (a) §6 "Phase 1 PoC 이관 24개" 카운트가 실제 22개(Spike 1·2·3·4 = 4+6+6+6)와 불일치, (b) §4.4·4.5가 "결정 항목" 표제와 성격 차이 — 2건의 경미한 정확성 보강 후 PRD v0.3 입력으로 사용 권장.

## 후속 조치 권고

1. **§6 카운트 정정** — "총 24개" → "총 22개 (+ Spike 5 사용자 직접 7단계 별도)" 또는 Spike 5를 PoC 이관에 1개로 합산하여 23개로 표기. 어느 쪽이든 산술 일관성 확보.
2. **§4 표제 정정** — "사용자가 결정해야 할 항목" 4.1~4.3 / "Phase 1 진입 시 작업" 4.4 / "사용자 직접 병렬 작업" 4.5로 3구분, 표제와 항목 성격 일치시킴.
3. **Spike 1 evaluator 사후 호출** — §4.3 권장 (a) 이행, eval-results 5개 완전성 확보 (현재 4개만 존재: spike-02/03/04/05).
4. **PRD v0.3 발행 진행** — 위 1·2 정정 반영 후 §3 영향 매트릭스 19개 항목을 PRD 13개 섹션에 분산 반영.
5. **G-011 가드레일 정식 등록** — `.flowset/guardrails.md` Phase 0 발견 패턴 섹션에 추가 (현재 "아직 없음" 상태).

## 참조

- PRD 목차: `docs/prd/README.md` (v0.2, 13개 섹션)
- 가드레일: G-001 (PRD SSOT), G-002 (Phase 0 게이트), G-003 (인증 금지선), G-006 (추측 금지), G-007 (main 직접 push 금지), G-008 (한국어 우선), G-011 (신규 draft)
- 평가자 매핑: `.claude/agents/evaluator.md` "Phase 0 Spike 평가 매핑" 표 5행
- eval-results 디렉토리: spike-02 / 03 / 04 / 05 (Spike 1 누락)
- 산출물 git history: PR #1 (`d5459c6`) ~ PR #5 (`7a3da83`)
