# Spike 2 — YouTube 자막/제어 PoC

> 상태: **미시작**
> 담당: TBD
> 시작일: TBD
> 종료 목표: 1~2주

## 목표

YouTube 영상에서 자막 추출과 재생 제어가 직접/임베디드 환경에서 안정적으로 가능한지 확인.

## 가설

Electron BrowserView/WebContentsView로 youtube.com 직접 또는 iframe 임베디드 영상 모두에서 자막 추출과 playbackRate / pause / volume 제어가 가능하다.

## 검증 환경 매트릭스

### 페이지 종류
- youtube.com 직접 접속
- iframe 임베디드 (블로그 / 강의 플랫폼 / 문서 페이지)

### 영상 종류
- 수동 자막 영상 (sourceType=human)
- 자동 생성 자막 영상 (sourceType=asr)
- 자막 없는 영상 (Phase 5 STT 대상)
- 광고 구간 포함 영상
- 로그인 필요 영상
- 연령 제한 영상
- DRM / Premium 콘텐츠

## 검증 동작

각 환경 × 영상 종류 조합에서:

- [ ] `<video>` element 접근
- [ ] `currentTime` 조회
- [ ] `play()` / `pause()` 제어
- [ ] `playbackRate` 변경 (0.5 ~ 2.0)
- [ ] `volume` / `muted` 제어
- [ ] 수동 자막 추출 (caption track URL)
- [ ] 자동 생성 자막 추출
- [ ] 광고 구간에서의 위 모든 동작

## 측정 항목

| 항목 | 방법 |
|---|---|
| 자막 추출 성공률 | 100개 샘플 영상 기준 % |
| 광고 차단 빈도 | 임의 100개 시청 중 광고 차단으로 제어 실패 % |
| iframe vs 직접 차이 | 동일 영상의 환경별 동작 차이 |
| API 응답 지연 | currentTime 갱신 lag |

## 판정 기준

| 결과 | 판정 | 후속 조치 |
|---|---|---|
| 모든 동작 안정 | **Pass** | MVP 2 전체 진행 |
| 일부 환경 제한 (광고/DRM 등) | **Partial** | 제한된 영상 종류 명시 + MVP 2 범위 조정 |
| 핵심 동작 불가 | **Fail** | 아키텍처 재검토 (확장 방식 또는 외부 API) |

## 결과 (TBD)

### 환경 × 영상 매트릭스
(작성 예정)

### 광고 / DRM 처리 전략
(작성 예정)

### iframe 임베디드 특이사항
(작성 예정)

### PRD 영향
- PRD 7.2 MVP 2 범위 한정 — 구체화 필요
- PRD 9.3 YouTube/영상 기능 — 우선순위 조정 가능
- PRD 18.5 사이트 호환성 리스크 — 대응 명시

## 평가 (evaluator 입력)

본 Spike 결과는 evaluator에게 제출하여 채점한다.
- 입력: 본 파일 + 측정 데이터 + PRD 7.2 / 9.3
- 출력: `.flowset/eval-results/spike-02-{date}.md`

## 변경 이력

- 2026-05-11: placeholder 생성
