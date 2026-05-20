# PR 제목 형식

`WI-NNN-[type] 한글 작업명`

- type: feat / fix / docs / style / refactor / test / chore / perf / ci / revert
- 예: `WI-001-feat 사용자 인증 추가`, `WI-S016M0-feat FlowSet hooks 자동화`

---

## 요약

(이 PR이 무엇을 / 왜 변경하는지 1~3줄)

## 변경 사항

- 변경 1
- 변경 2

## 산출물 매트릭스 (G-018 — `git diff --numstat HEAD` 실측, 추상 표기 금지)

| 파일 | + | - | 비고 |
|---|---|---|---|
| `path/to/file1` | 10 | 5 | 변경 의도 1줄 |
| `path/to/file2` | 20 | 0 | 신규 |

**총**: +N / -N / M 파일 (실측 수치, `+N` 같은 placeholder 금지)
**별도 보고** (PR diff 범위 외 변경, e.g. 사용자 메모리): 명시 강제

## 영향 영역

- [ ] 코드
- [ ] 문서 (PRD / docs / .flowset)
- [ ] CI / 빌드
- [ ] 의존성
- [ ] Privacy / 보안
- [ ] 데이터 모델

## Dual Review (학습 #8 + 학습 #13 — 매 PR 강제, 누락 절대 금지, read-only 강제)

CI `flowset-policy-check` 가 본 섹션 두 체크박스 누락 시 머지 차단한다. 사전 호출 후 체크.

**codex 호출 표준 (학습 #13 + #16, 2026-05-20 — 도구 분류 정합)**:
- **dual review 1순위 = `/codex:adversarial-review`** (review-only + **free-form focus text 지원**, dual review 케이스 정합)
- 2순위 = `/codex:review` (review-only, focus text 미지원 — 단순 git state native review)
- 3순위 = raw MCP `mcp__codex__codex` + **`sandbox: "read-only"` + `approval-policy: "never"` + model 생략** (config.toml `gpt-5.5` 자동) — git state 무관 자유 협의/평가
- **`/codex:rescue` 는 rescue/fix/investigation 의도 시 정합 도구** (workspace-write). dual review 본문에 사용 시 CI 차단 (dual review 케이스 한정, 도구 자체 금지 아님)

- [ ] evaluator (`.claude/agents/evaluator.md` 서브에이전트) — Pass 카운트 / NEEDS_CHANGES / BLOCKING 결과 기록
- [ ] codex (`/codex:adversarial-review` 1순위 또는 `/codex:review` 또는 raw MCP `sandbox=read-only`) — PASS / NEEDS_CHANGES / BLOCKING / NB 결과 기록 (`/codex:rescue` 는 dual review 본문에 사용 시 CI 차단 — rescue 작업 시 별도 호출, G-016)

**평가 요약** (간단히):
- evaluator: Pass __ / Partial __ / Fail __
- codex: PASS __ / NEEDS_CHANGES __ / BLOCKING __ / NB __
- 본 PR 내 hotfix 흡수: (있다면 commit hash + 항목)

## 가드레일 검증

- [ ] G-001 PRD 정합성 확인
- [ ] G-003 인증 금지선 위반 없음
- [ ] G-004 Privacy Filter 회피 코드 없음
- [ ] G-005 Secret 평문 저장 없음 (OS Keychain 위임)
- [ ] G-006 추측 표현 없음 (검증 후 단정만)
- [ ] G-007 main 직접 push 아님
- [ ] G-009 커밋 메시지 형식 준수 (WI-NNN-[type] 한글 작업명, NNN 한 분절)
- [ ] G-010 UTF-8 / LF 준수
- [ ] G-012 v04-direction.md SSOT 정합 (PRD 변경 시)
- [ ] G-013 단계별 PR 전략 (리팩토링 시)
- [ ] G-014 데이터 마이그레이션 dry-run + 백업 (schema 변경 시)
- [ ] G-015 Phase 2 cookies partition 격리 (워크스페이스 변경 시)

## 검증 결과

- [ ] `npm run lint` PASS
- [ ] `npm run typecheck` PASS
- [ ] `npm test` PASS (단위 수 기재)
- [ ] `npm run build` PASS (해당 시)
- [ ] CI 모든 job PASS

## 관련 문서 / KI 변동

- PRD: docs/prd/...
- Sprint contract: .flowset/contracts/sprint-NNN.md
- 핸드오프: .flowset/handoffs/YYYY-MM-DD.md
- KI 변동: (closed/신규 KI-NNN — 산식 명시)

## 스크린샷 / 데모 (UI 변경 시)

(이미지 / GIF)

## 리뷰어 메모

(특별히 봐줬으면 하는 부분)
