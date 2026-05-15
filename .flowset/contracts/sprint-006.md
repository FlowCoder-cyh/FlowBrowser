# Sprint 006 — Phase 1 / Navigation + 번역 표시 모드 + 페이지 캐시

> **상태: 정의 완료, M1부터 자율 착수**
> Phase: 1 (웹 번역 MVP 확장)
> 시작 예정: 본 정의 PR 머지 직후
> 목표 기간: 2~3주

## 0. 사전 조건

- [x] Sprint 005 종료 (PR #30~#34 머지)
- [x] 단위 테스트 158/158 PASS / lint 0/0 / typecheck / build 모두 PASS
- [x] Sprint 005 종합 evaluator Pass 9 / 0 / 0
- [x] PRD v0.3.3 발행

## 1. Sprint 목표

PRD 잔여 P1 항목 + Sprint 005 evaluator 권고 (페이지 캐시).

1. **Navigation UI** (PRD §9.1 P1) — URL Bar에 뒤로/앞으로/새로고침 버튼
2. **원문/번역 표시 모드 3종** (PRD §9.2 P1) — replace / panel(기존) / overlay
3. **표시 모드 사용자 선택** — Settings 안 UserSetting + 페이지 번역/문단 번역 흐름에 적용
4. **페이지 캐시** (PageResultStore) — 페이지 URL 기반 번역 결과 저장 + 재방문 복원

## 2. 범위

### 포함

| # | 작업 | 산출물 |
|---|---|---|
| S006-T01 | URL Bar 뒤/앞/새로고침 버튼 + can-go-back / can-go-forward 상태 동기화 | `src/renderer/src/UrlBar.tsx`, preload `browserApi` |
| S006-T02 | 원문/번역 replace 모드 — DOM 치환 (executeJavaScript) + 토글 원복 | `src/perception/TranslationRenderer.ts` (신규 IIFE) |
| S006-T03 | replace 모드 IPC — `translate:render-mode` 페이로드에 모드 + 결과 노드 ID/번역문 | main + preload |
| S006-T04 | 원문/번역 overlay 모드 — 노드 옆에 인접 박스 부착 (position: relative + DOM 추가) | TranslationRenderer 확장 |
| S006-T05 | 표시 모드 UserSetting — `translationDisplayMode: 'panel' \| 'replace' \| 'overlay'` | `src/storage/UserSettingStore.ts` (신규 or 기존 통합) |
| S006-T06 | Settings UI 모드 선택 (라디오) | `src/renderer/src/settings/DisplayModePanel.tsx` 또는 통합 |
| S006-T07 | 페이지 번역 / 문단 번역 흐름이 현재 모드에 따라 분기 (panel-only / DOM render) | main/index.ts |
| S006-T08 | PageResultStore — 페이지 URL + 노드 해시 기반 저장 + TTL 30일 | `src/storage/PageResultStore.ts` |
| S006-T09 | 페이지 재방문 시 복원 — load 완료 시 store lookup → 자동 적용 | main + 사용자 토글 UI |
| S006-T10 | 단위 테스트 (TranslationRenderer pure 함수 + PageResultStore) | `tests/unit/perception/TranslationRenderer.test.ts`, `tests/unit/storage/PageResultStore.test.ts` |
| S006-T11 | PRD v0.3.4 패치 + Sprint 종합 evaluator + handoff/state | docs/prd, .flowset/* |

### 제외 (Sprint 007+)

- 다중 탭 / BrowserView (PRD §9.1 P2) — 별도 큰 작업
- Codex Login Provider Spike (별도 spike 브랜치)
- 사용자 수동 QA 결과 반영 (사용자 직접)
- Phase 2 진입 (자막 / TTS / 싱크)

## 3. 수용 기준

### AC-1 Navigation UI (S006-T01)
- URL Bar에 뒤로/앞으로/새로고침 버튼 (← / → / ↻)
- 버튼 활성/비활성 상태가 history 동기화 (canGoBack/canGoForward)
- 클릭 시 기존 IPC (`go-back`/`go-forward`/`reload`) 호출

### AC-2 replace 모드 (S006-T02 / T03)
- 각 노드 텍스트가 번역문으로 DOM 교체 (data-fbai-orig 속성에 원문 백업)
- "원문 보기" 토글 시 원문 복원
- WebContentsView가 페이지 이동/리로드 시 자동 초기화

### AC-3 overlay 모드 (S006-T04)
- 각 노드 아래에 번역 박스 (position: relative + sibling div) 추가
- 토글 시 overlay 박스 제거
- 페이지 이동/리로드 시 자동 정리

### AC-4 표시 모드 UserSetting (S006-T05 / T06 / T07)
- `translationDisplayMode: 'panel' | 'replace' | 'overlay'` 유저 설정 영속
- Settings UI에서 라디오 선택 가능
- 페이지 번역 / 문단 번역 흐름이 모드 따라 분기:
  - `panel`: 기존 TranslationPanel (Sprint 002~005)
  - `replace`: DOM 치환
  - `overlay`: 인접 박스
- 모드 변경 시 진행 중 결과는 유지, 다음 호출부터 새 모드 적용

### AC-5 PageResultStore (S006-T08 / T09)
- 페이지 URL 정규화 (쿼리/프래그먼트 제외) + 노드 해시 기반 저장
- TTL 30일 (기본), 사용자 디스크 한도 500MB
- JSON 영속
- 페이지 재방문 시 load 완료 → store lookup → 자동 복원 (사용자 설정으로 on/off)
- "원문으로" 토글로 복원 결과 제거

### AC-6 단위 테스트 (S006-T10)
- TranslationRenderer pure 함수 (script 직렬화 / 노드 매핑) ≥ 5
- PageResultStore CRUD + TTL + 정규화 ≥ 8
- 누적 단위 테스트 ≥ 170 (Sprint 005 158 + 12 이상)

### AC-7 통과 기준
- 각 M evaluator Pass + Pass 카운트 ≥ 8
- lint / typecheck / test / build 모두 PASS

## 4. 마일스톤

| M | 산출물 | 기간 |
|---|---|---|
| M1 | T01 Navigation UI + T02 replace 모드 + T03 IPC | 3~4일 |
| M2 | T04 overlay 모드 + T05 UserSetting + T06 Settings UI + T07 흐름 분기 | 3~5일 |
| M3 | T08 PageResultStore + T09 재방문 복원 | 3~5일 |
| M4 | T10 단위 테스트 보강 + T11 PRD v0.3.4 + Sprint 종합 | 2~3일 |

총 11~17일.

## 5. 가드레일 적용

- G-001 PRD 정합 (§9.1 / §9.2)
- G-004 Privacy Filter — replace/overlay 모드도 evaluatePrivacy 게이트 통과한 결과만 DOM 적용 (이미 executeTranslateRequest 흐름 안)
- G-006 추측 금지 — 단위 테스트 + 실측
- G-007 main 직접 push 금지
- G-009 커밋 형식 `WI-S006-Mn-feat ...`
- G-010 UTF-8 / LF

## 6. evaluator 통과 기준

**각 M evaluator Pass + Pass 카운트 ≥ 8.**

## 7. 리스크 / 미지수

1. **DOM 치환 시 페이지 JS와 충돌**: 페이지가 자체 DOM mutation을 일으키면 치환 효과가 사라질 수 있음. data-fbai-orig 속성으로 백업 + 토글 시 원본 복원.
2. **외부 페이지 sandbox 제약**: executeJavaScript는 가능하지만 페이지가 CSP / iframe 정책으로 텍스트 노드 변경을 막을 수 있음. 동작 안 하면 panel 모드로 fallback.
3. **PageResultStore 디스크 폭주**: 노드 N개 × 페이지 M개 빠르게 누적. TTL 30일 + LRU + 500MB 한도로 보호.
4. **재방문 복원 시 페이지 변경 감지**: 노드 해시가 일치하지 않으면 복원 안 함 (안전).

## 8. Sprint 종료 후 다음 (Sprint 007 후보)

1. 다중 탭 / BrowserView (PRD §9.1 P2)
2. Codex Login Provider Spike (Phase 1 PoC 4종)
3. 사용자 수동 QA 결과 반영
4. Phase 2 진입 — Spike 2/3/4 PoC 임계 정량화 우선

## 9. 참조

- PRD: `docs/prd/04_requirements.md` §9.1 (Navigation P1) / §9.2 (원문/번역 토글 P1)
- PRD: `docs/prd/06_data_model.md` §12.10 UserSetting / §12.4 TranslationCache
- Sprint 005 종합: `.flowset/eval-results/sprint-005-2026-05-15.md`
- 가드레일: `.flowset/guardrails.md`

## 변경 이력

- 2026-05-15: Sprint 006 정의 작성
