# PR 제목 형식

`WI-NNN-[type] 한글 작업명`

- type: feat / fix / docs / style / refactor / test / chore / perf / ci / revert
- 예: `WI-001-feat 사용자 인증 추가`, `WI-S01-spike Codex 인증 조사`

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

## 가드레일 검증

- [ ] G-001 PRD 정합성 확인
- [ ] G-002 Phase 0 게이트 위반 없음 (Phase 0인 경우)
- [ ] G-003 인증 금지선 위반 없음
- [ ] G-004 Privacy Filter 회피 코드 없음
- [ ] G-005 Secret 평문 저장 없음
- [ ] G-007 main 직접 push 아님
- [ ] G-009 커밋 메시지 형식 준수
- [ ] G-010 UTF-8 / LF 준수

## 테스트 / 검증

- [ ] 변경 동작 직접 확인
- [ ] CI 통과 (해당 시)
- [ ] evaluator 채점 (해당 시): `.flowset/eval-results/...`

## 관련 문서

- PRD: docs/prd/...
- Spike / Sprint: .flowset/specs/...
- 이슈 / 핸드오프: .flowset/handoffs/...

## 스크린샷 / 데모 (UI 변경 시)

(이미지 / GIF)

## 리뷰어 메모

(특별히 봐줬으면 하는 부분)
