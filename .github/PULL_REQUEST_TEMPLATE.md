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

## 영향 영역

- [ ] 코드
- [ ] 문서 (PRD / docs / .flowset)
- [ ] CI / 빌드
- [ ] 의존성
- [ ] Privacy / 보안
- [ ] 데이터 모델

## Dual Review (학습 #8 — 매 PR 강제, 누락 절대 금지)

CI `flowset-policy-check` 가 본 섹션 두 체크박스 누락 시 머지 차단한다. 사전 호출 후 체크.

- [ ] evaluator (`.claude/agents/evaluator.md` 서브에이전트) — Pass 카운트 / NEEDS_CHANGES / BLOCKING 결과 기록
- [ ] codex (raw MCP `mcp__codex__codex` model 생략 또는 `/codex:rescue` slash) — PASS / NEEDS_CHANGES / BLOCKING / NB 결과 기록

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
