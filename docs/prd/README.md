# FlowBrowser AI PRD v0.3.1 — 목차

본 문서는 FlowBrowser AI 제품 요구사항 명세(PRD)의 **v0.3.1** 버전이며, 13개 섹션 파일로 분할되어 있다.
v0.2 통합본은 [archive/flowbrowser_ai_prd_crud_v0.2.md](../../archive/flowbrowser_ai_prd_crud_v0.2.md)에 보관되며, v0.3.x 통합본은 작성하지 않고 분할 SSOT로 운영한다.

## 섹션 구성

| # | 섹션 | 파일 | 핵심 내용 |
|---|---|---|---|
| 0 | 변경 이력 | [00_change_history.md](./00_change_history.md) | 문서 목적 + v0.2 변경 사항 |
| 1 | 제품 | [01_product.md](./01_product.md) | 제품 개요 / 문제 정의 / 목표 / 가설 |
| 2 | 사용자 | [02_users.md](./02_users.md) | 타깃 / 페르소나 / 경쟁 분석 / 포지셔닝 |
| 3 | MVP & 시나리오 | [03_mvp_and_scenarios.md](./03_mvp_and_scenarios.md) | MVP 범위 / 사용자 시나리오 / 온보딩 |
| 4 | 요구사항 | [04_requirements.md](./04_requirements.md) | 기능 요구사항 / Privacy Filter / 비기능 |
| 5 | 아키텍처 | [05_architecture.md](./05_architecture.md) | 권장 아키텍처 / Provider Adapter |
| 6 | 데이터 모델 | [06_data_model.md](./06_data_model.md) | 데이터 모델 / CRUD 매트릭스 |
| 7 | 싱크 더빙 정책 | [07_sync_policy.md](./07_sync_policy.md) | 싱크 제어 / TTS 번역 정책 |
| 8 | 인증 / 과금 | [08_auth_billing.md](./08_auth_billing.md) | Provider 전략 / 금지 / BM |
| 9 | 로드맵 / Phase 0 | [09_roadmap_phase0.md](./09_roadmap_phase0.md) | Phase 0 Spike 5종 / Phase 1~5 |
| 10 | 지표 / 리스크 | [10_metrics_and_risks.md](./10_metrics_and_risks.md) | 성공 지표 / 리스크 대응 |
| 11 | 개발 / 운영 | [11_dev_tasks_and_ops.md](./11_dev_tasks_and_ops.md) | 개발 태스크 / 운영 인프라 |
| 12 | 요약 | [12_summary.md](./12_summary.md) | 최종 요약 |

## 현재 상태

**Phase 1 진행 중 — Sprint 001·002·003 완료**

Phase 0 5종 Spike + Phase 1 Sprint 001 (Electron 셸 + Privacy + Provider + 선택 영역 번역) + Sprint 002 (TranslationCache + 문단 번역 + 우측 패널 + UsageLog UI + ESLint) + Sprint 003 (LRU trim 테스트 + BlockReason enum + 페이지 전체 번역 + 도메인 정책 UI) 완료. 본 v0.3.1에 반영됨.
Spike 5 (사용자 인터뷰) 실제 진행은 사용자 직접 작업으로 코드 작업과 병렬 진행 가능.

## 버전 이력

| 버전 | 일자 | 비고 |
|---|---|---|
| v0.1 | 초안 | [archive/flowbrowser_ai_prd_crud_v0.1.md](../../archive/flowbrowser_ai_prd_crud_v0.1.md) |
| v0.2 | 2026-05-11 | GPT/Claude 교차 검토 반영 |
| v0.3 | 2026-05-11 | Phase 0 1차 조사 (5개 Spike) 반영 |
| **v0.3.1** | **2026-05-15** | **Sprint 002·003 실측 반영 (페이지 전체 번역 / 도메인 정책 UI / BlockReason enum / LRU trim), 현재** |
