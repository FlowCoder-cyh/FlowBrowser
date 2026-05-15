# FlowBrowser AI PRD v0.3.10 — 목차

본 문서는 FlowBrowser AI 제품 요구사항 명세(PRD)의 **v0.3.10** 버전이며, 13개 섹션 파일로 분할되어 있다.
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

**Phase 1 진행 중 — Sprint 001~012 완료**

Phase 0 5종 Spike + Phase 1 Sprint 001~012 완료. v0.3.10에서는 Sprint 012 (탭 미리보기 hover thumbnail + 키보드 단축키) 실측 반영.
Spike 5 (사용자 인터뷰) 실제 진행은 사용자 직접 작업으로 코드 작업과 병렬 진행 가능.

## 버전 이력

| 버전 | 일자 | 비고 |
|---|---|---|
| v0.1 | 초안 | [archive/flowbrowser_ai_prd_crud_v0.1.md](../../archive/flowbrowser_ai_prd_crud_v0.1.md) |
| v0.2 | 2026-05-11 | GPT/Claude 교차 검토 반영 |
| v0.3 | 2026-05-11 | Phase 0 1차 조사 (5개 Spike) 반영 |
| v0.3.1 | 2026-05-15 | Sprint 002·003 실측 반영 (페이지 전체 번역 / 도메인 정책 UI / BlockReason enum / LRU trim) |
| v0.3.2 | 2026-05-15 | Sprint 004 실측 반영 (IPC 채널 분리 / 쉬운 설명 / 페이지 요약 / SummarizationPlanner) |
| v0.3.3 | 2026-05-15 | Sprint 005 실측 반영 (캐시 키 확장 / 용어집 + invalidation / 요약 폭주 보호) |
| v0.3.4 | 2026-05-15 | Sprint 006 실측 반영 (Navigation 동기화 / 표시 모드 3종 / 페이지 캐시) |
| v0.3.5 | 2026-05-15 | Sprint 007 실측 반영 (UserSetting 잔여 4 필드 / 요약 메타 수치 / PageCachePanel / tsconfig·빌드 보강) |
| v0.3.6 | 2026-05-15 | Sprint 008 실측 반영 (다중 탭 / TabManager + TabBar + 활성 탭 라우팅) |
| v0.3.7 | 2026-05-15 | Sprint 009 실측 반영 (Glossary flaky 핫픽스 + sourceTabId 가드 + 탭 영속) |
| v0.3.8 | 2026-05-15 | Sprint 010 실측 반영 (탭 드래그/순서 + 탭 컨텍스트 메뉴 + cancel-on-switch UX + isCurrentTab 순수 함수 추출) |
| v0.3.9 | 2026-05-15 | Sprint 011 실측 반영 (summary abort API + 탭 컬러 라벨 + 탭 핀) |
| **v0.3.10** | **2026-05-15** | **Sprint 012 실측 반영 (탭 미리보기 hover thumbnail + 키보드 단축키), 현재** |
