# FlowBrowser AI — 요구사항 SSOT

> 본 파일은 프로젝트 요구사항의 단일 출처(Single Source of Truth) 진입점이다.
> 실제 요구사항 본문은 PRD에 있으며, 본 파일은 PRD 링크와 핵심 요약만 제공한다.
> 분쟁 시 PRD가 우선한다 (G-001).

## PRD 진입점

- 목차: [docs/prd/README.md](../docs/prd/README.md)
- 통합본 (인쇄/공유용): [archive/flowbrowser_ai_prd_crud_v0.2.md](../archive/flowbrowser_ai_prd_crud_v0.2.md)
- 변경 이력: [docs/prd/00_change_history.md](../docs/prd/00_change_history.md)
- 현재 버전: **v0.3.11** (2026-05-15, Sprint 013 실측 반영)

## 한 줄 정의

영어 웹사이트와 영상을 한국어로 읽고, 보고, 들을 수 있게 해주는 AI 네이티브 브라우저.

## 핵심 요구 (요약)

PRD 본문 우선. 본 요약은 빠른 참조용.

### 1차 목표
영어 웹페이지 + YouTube 영상을 한국어 사용자가 자연스럽게 이해할 수 있는 AI 브라우저 MVP.

### 2차 목표
TTS 싱크 더빙 (3~5초 지연 허용).

### 3차 목표
다국어 언어팩 (한국어 → 일본어 / 스페인어 / 인도네시아어 등).

### 비범위 (PRD 1.5)
- Linux MVP 미지원 (개발자 확장 단계 별도 검토)
- 모바일 브라우저 / 앱 (Phase 6 이후 별도 결정)
- ChatGPT 웹 쿠키 재사용 / 비공식 토큰 추출 / 사용량 우회 (절대 금지, G-003)

## Phase 0 게이트 (G-002)

다음 5종 Spike 판정 완료 전 본격 코드 착수 금지:

| # | Spike | 결과물 |
|---|---|---|
| 1 | Codex/ChatGPT 인증 방식 검증 | [specs/spike-01-codex-auth.md](./specs/spike-01-codex-auth.md) |
| 2 | YouTube 자막/제어 PoC (직접 + 임베디드) | [specs/spike-02-youtube.md](./specs/spike-02-youtube.md) |
| 3 | 시스템 오디오 캡처 PoC (Win/macOS) | [specs/spike-03-audio-capture.md](./specs/spike-03-audio-capture.md) |
| 4 | TTS 3축 측정 (품질·지연·비용) | [specs/spike-04-tts-3axis.md](./specs/spike-04-tts-3axis.md) |
| 5 | 사용자 인터뷰 (5~10명) | [specs/spike-05-user-interview.md](./specs/spike-05-user-interview.md) |

상세: [docs/prd/09_roadmap_phase0.md](../docs/prd/09_roadmap_phase0.md)

## 변경 정책

- 본 파일 직접 수정 금지 (PRD가 SSOT)
- PRD 변경 시 본 파일의 링크/요약만 동기화
- 변경 이력은 [docs/prd/00_change_history.md](../docs/prd/00_change_history.md)에 기록
