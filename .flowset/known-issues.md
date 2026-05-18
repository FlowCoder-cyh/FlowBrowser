# FlowBrowser AI — Known Issues 누적

> Sprint·Phase 종료 evaluator에서 발견된 약점 / 시나리오 cover 부족 / 정량 임계 미달 / 회귀 가능성 항목을 KI-NNN 형식으로 누적.
> 가드레일(`guardrails.md`)과 같은 단일 파일 패턴. 절대 삭제하지 않음 (해소 시 상태만 `closed`로 변경).

## 등록 정책 (Sprint 015 진입 시 활성)

### KI 번호 규칙
- 형식: `KI-NNN` (NNN = 3자리 0-pad 숫자, 등록 순서)
- 첫 등록부터 순차 (KI-001, KI-002, ...)

### Severity 정의

| Severity | 정의 | 처리 시점 |
|---|---|---|
| **HIGH** | 핵심 시나리오 불가능 / 보안·프라이버시 위협 / 데이터 손실 위험 | **즉시 다음 Sprint M1**에 처리 (별도 작업 우선) |
| **MEDIUM** | 시나리오 동작하지만 UX 불편 / 정량 임계 미달 / 성능 저하 | **5개 누적 또는 Phase 종료 시 batch** (다음 Sprint M1~M2에 흡수) |
| **LOW** | 정성적 개선 / 마이너 버그 / 코드 정리 | **Phase 3 종료 후 MVP 직전 정리** |

### 등록 형식

각 KI는 다음 메타를 가짐:

```
### KI-NNN [status] 한 줄 제목

- **Severity**: HIGH / MEDIUM / LOW
- **Phase**: 1 / 2 / 3
- **Sprint**: 015 / 016 / ...
- **Component**: 파일 또는 모듈 경로 (예: `src/storage/IndexedPageStore.ts`)
- **영향**: 어떤 시나리오·사용자 흐름에 영향
- **발견 출처**: evaluator 보고서 인용 또는 사용자 보고
- **재현 절차**: (선택, HIGH/MEDIUM은 필수)
- **권고 해소 방향**: (선택)
- **처리 예정 Sprint**: NNN (또는 "Phase X batch")
- **상태**: `open` / `in-progress` / `closed`
```

### 상태 표기

- `[open]` 등록만 됨, 아직 처리 시작 안 됨
- `[in-progress]` 처리 Sprint 진행 중
- `[closed]` 해소 완료 (해소 PR 번호 + Sprint 인용)

### 누적 정리 트리거

- **HIGH 즉시**: 발견 즉시 다음 Sprint M1 작업으로 격상
- **MEDIUM 5개**: MEDIUM 누적 5개 도달 시 다음 Sprint M1~M2 batch 처리
- **Phase 종료 batch**: 각 Phase 종료 evaluator 시점에 MEDIUM/LOW 누적분 정리 plan 수립
- **MVP 최종**: Phase 3 종료 후 남은 LOW까지 모두 정리

---

## KI 누적

### KI-001 [open] sqlite-vec macOS native 빌드 미검증

- **Severity**: MEDIUM
- **Phase**: 1
- **Sprint**: 015 (M3-6 codex/evaluator 핫픽스 시점 등록)
- **Component**: `package.json` (sqlite-vec optional dep) + `src/storage/Database.ts` (sqlite-vec 로드 호출)
- **영향**: macOS 사용자 install 시 `sqlite-vec-darwin-x64` / `sqlite-vec-darwin-arm64` prebuilt 동작 미검증. `better-sqlite3@12.10` Electron 39 macOS ABI rebuild 도 PoC 부재. M4 인덱싱 hook 시점에 macOS 사용자에서 sqlite-vec load 실패 시 인덱싱 전체 차단 가능.
- **발견 출처**: M3-spike (`.flowset/specs/m3-spike-decisions.md` §1 "macOS 검증: 본 세션 환경 한정 → 미검증") + 핸드오프 2026-05-18 §13.8 + 2026-05-18 M3 종합 evaluator §3 KI 후보 1 권고
- **재현 절차**: macOS x64 또는 arm64 환경에서 `npm install` + `npx electron-rebuild -f -w better-sqlite3 -v 39.x.x` 실행 후 `spike/m3-poc/electron-main.cjs` 동일 PoC 재실행
- **권고 해소 방향**: (1) macOS CI runner 추가 (`.github/workflows/*.yml` 에 `runs-on: macos-latest` 매트릭스) (2) 또는 사용자 macOS 환경에서 PoC 1회 수동 실행 후 결과 본 KI 에 기록
- **처리 예정 Sprint**: 016 (macOS CI 추가 시 해소) — Phase 1 종료 전 권고
- **상태**: `open`

### KI-002 [open] PageCachePanel PARTIAL — v0.3 어댑터 의존 잔존

- **Severity**: LOW
- **Phase**: 1
- **Sprint**: 015 (M3-7 PARTIAL 적용 + codex/evaluator 핫픽스 시점 등록)
- **Component**: `src/renderer/src/settings/PageCachePanel.tsx` + `src/storage/PageResultStore.ts` 어댑터
- **영향**: 본 패널은 M3-7 에서 copy 만 "페이지 본문 캐시" 로 갱신되었으나 컴포넌트 자체는 v0.3 `pageResultApi` 의존. M5-8 어댑터 일괄 제거 시점에 본 패널도 동반 폐기 (MemoryStatsPanel 흡수 contract). 현재 UX 영향 없음 (정상 동작).
- **발견 출처**: PR #138 본문 + 2026-05-18 M3 종합 evaluator §3 KI 후보 2 권고
- **권고 해소 방향**: M5-8 ChatService 도입 시점에 `pageResultApi` + `PageResultStore` 어댑터 + 본 패널 동시 제거 + 신규 `MemoryStatsPanel` (M6) 으로 흡수
- **처리 예정 Sprint**: 015 M5-8 (정합 contract) 또는 Phase 3 종료 후 MVP 직전 정리
- **상태**: `open`

---

## 통계 (Phase 단위)

| Phase | HIGH 누적 | MEDIUM 누적 | LOW 누적 | 해소 | 잔여 |
|---|---|---|---|---|---|
| Phase 1 | 0 | 1 | 1 | 0 | 2 |
| Phase 2 | — | — | — | — | — |
| Phase 3 | — | — | — | — | — |

---

## 참조

- 가드레일: `.flowset/guardrails.md` (KI vs 가드레일 구분 — 가드레일 = 절대 규칙, KI = 일시적 약점)
- 검증 정책: `.flowset/specs/v04-direction.md` §12 (검증 흐름 + Severity 정의)
- Sprint 015 contract: `.flowset/contracts/sprint-015.md` §6 (evaluator 통과 기준)

## 변경 이력

- 2026-05-16: 등록 정책 + Severity 정의 + KI 형식 초기 등록 (Sprint 015 진입 시점, KI 0건)
- 2026-05-18 (M3 종료 핫픽스): KI-001 MEDIUM (sqlite-vec macOS 미검증) + KI-002 LOW (PageCachePanel PARTIAL) 등록. evaluator + codex 병렬 평가에서 추출. Sprint 015 누적 0건 → 2건 (KI 등록 정책 본격 발동).
