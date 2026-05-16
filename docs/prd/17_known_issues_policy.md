# 17. Known Issue 정책 (Known Issues Policy)

> [← PRD 목차](./README.md)

본 섹션은 KI-NNN 등록 정책 + Severity 정의 + 처리 정책 + 누적 정리 정책. `.flowset/known-issues.md` (Sprint 015 진입 시 신설) 와 정합.

## 17.1 KI-NNN 등록 형식

| 필드 | 형식 |
|---|---|
| ID | `KI-NNN` (NNN = 3자리 0-pad 숫자, 등록 순서) |
| Severity | `HIGH` / `MEDIUM` / `LOW` |
| Phase | `1` / `2` / `3` |
| Sprint | `015` / `016` / ... |
| Component | 파일 또는 모듈 경로 (예: `src/storage/IndexedPageStore.ts`) |
| 영향 | 어떤 시나리오·사용자 흐름에 영향 |
| 발견 출처 | evaluator 보고서 인용 또는 사용자 보고 |
| 재현 절차 | (선택, HIGH/MEDIUM은 필수) |
| 권고 해소 방향 | (선택) |
| 처리 예정 Sprint | NNN (또는 "Phase X batch") |
| 상태 | `open` / `in-progress` / `closed` |

## 17.2 Severity 정의

| Severity | 정의 | 처리 |
|---|---|---|
| **HIGH** | 핵심 시나리오 불가능 / 보안·프라이버시 위협 / 데이터 손실 위험 | **즉시 다음 Sprint M1** 에 처리 (별도 작업 우선) |
| **MEDIUM** | 시나리오 동작하지만 UX 불편 / 정량 임계 미달 / 성능 저하 | **5개 누적 또는 Phase 종료 시 batch** (다음 Sprint M1~M2에 흡수) |
| **LOW** | 정성적 개선 / 마이너 버그 / 코드 정리 | **Phase 3 종료 후 MVP 직전 정리** |

## 17.3 누적 정리 트리거

- **HIGH 즉시**: 발견 즉시 다음 Sprint M1 작업으로 격상 → 별도 PR + 회귀 테스트
- **MEDIUM 5개 누적**: 다음 Sprint M1~M2 batch 처리. 신규 기능 Sprint M1~M2 에 흡수 (별도 정리 Sprint X)
- **Phase 종료 batch**: 각 Phase 종료 evaluator 시점에 MEDIUM/LOW 누적분 정리 plan 수립
- **MVP 최종**: Phase 3 종료 후 남은 LOW 까지 모두 정리 + 시나리오 4개 100% 재검증

## 17.4 KI vs 가드레일 (G-NNN) 구분

| 구분 | KI-NNN | G-NNN (가드레일) |
|---|---|---|
| 정의 | **일시적 약점** (해소 가능) | **절대 규칙** (위반 금지) |
| 위치 | `.flowset/known-issues.md` | `.flowset/guardrails.md` |
| 처리 | Severity 정책에 따라 해소 → 상태 `closed` | 해소 X (위반 시 즉시 차단) |
| 등록 | evaluator 약점 / 사용자 보고 | 누적 학습 / Sprint 진행 중 발견된 패턴 |
| 예시 | "M3 sqlite-vec native build Windows 실패" | "G-003 인증 금지선" |

## 17.5 등록 흐름

```
[evaluator 보고서 약점 또는 사용자 보고]
   ↓
[Severity 분류 (자동 또는 evaluator 추천)]
   ├─ HIGH → 다음 Sprint M1 작업 우선 등록 + 신규 brnach
   ├─ MEDIUM → known-issues.md 누적 + 5개 도달 모니터링
   └─ LOW → known-issues.md 누적 + Phase 3 정리 대기
   ↓
[처리 시점 도래]
   ├─ HIGH → 즉시 처리 PR + closed 마킹
   ├─ MEDIUM batch → Sprint M1~M2 묶음 처리 + closed
   └─ LOW → Phase 3 종료 정리
```

## 17.6 본 시점 누적 (PR b10 시점)

`.flowset/known-issues.md` 본문 — PR b10 작성 시점 KI 누적 **0건**.

Sprint 015 진행 중 evaluator + codex 평가에서 발견된 약점은 **즉시 핫픽스 PR (b1.1, b2.1, b3.1, b4.1, b5.1, b6.1, b7.1)** 로 해소 → KI 등록 회피. 본 패턴은 M2~M6 진행 시에도 적용 (HIGH 약점은 PR 안에 즉시 정정).

향후 발견 예상 KI:
- **M3 sqlite-vec native build** — 환경별 (Windows/macOS/Linux) ABI 호환 문제 (HIGH 위험, v04-direction §15 R1 in-memory fallback 대안 있음)
- **M3 임베딩 비용 임계** — $3/월 초과 시 (MEDIUM, 청크 정책 조정 또는 KI)
- **M5 검색 정확도** — top-10 hit rate 80% 미달 시 (MEDIUM)
- **Codex token refresh 충돌** — refresh_token rotation 처리 실패 (HIGH 위험, BYOK fallback 있음)

## 17.7 SSOT 인용

- `.flowset/specs/v04-direction.md` §12 (검증 흐름) + §12.1 (Severity 정의)
- `.flowset/known-issues.md` (Sprint 015 진입 시 신설)
- `.flowset/contracts/sprint-015.md` §6 (evaluator 통과 기준 + KI 정책)
- [§18 평가](./18_evaluation.md) (KI 등록 시점·protocol)

본 §17 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 17.8 변경 이력

- 2026-05-16 (PR b10): stub → 본문 작성. KI-NNN 형식 11 필드 + Severity 3종 (HIGH·MEDIUM·LOW) + 처리 정책 + 누적 정리 트리거 + KI vs 가드레일 구분 + 등록 흐름 + 본 시점 누적 0건 + 향후 예상 KI 4종.
