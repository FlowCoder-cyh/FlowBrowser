# FlowBrowser AI — PRD v0.4

> **본 페이지를 자동 기억하면서, 프로젝트별로 환경이 격리되는 AI 리서치 브라우저**

PRD v0.4.0 **작성 시작** — Sprint 015 M1 진행 중 (PR b1 발행, 후속 PR b2~b10에서 §02~§19 점진 작성). 정식 발행은 Sprint 015 M6 종료 시점.

이전 버전 (v0.1 / v0.2 / v0.3) 은 [archive/](../../archive/) 디렉토리에 보존:
- `archive/flowbrowser_ai_prd_crud_v0.1.md` (v0.1 통합본)
- `archive/flowbrowser_ai_prd_crud_v0.2.md` (v0.2 통합본)
- `archive/prd-v0.3/` (v0.3 13 섹션 — Phase 0 Spike + Phase 1 실시간 번역 시기)

v0.3 → v0.4 방향 전환 배경은 [`00_change_history.md`](./00_change_history.md) 참조.

---

## 섹션 목차 (00~19 = 20행: README + 19개 섹션)

상태 표기: ✅ = 본문 작성 완료 / 📝 = stub (후속 PR 예정)

### 진입
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 00 | [변경 이력 (Change History)](./00_change_history.md) | ✅ | v0.3 → v0.4 방향 전환 기록 |
| 01 | [개요 (Overview)](./01_overview.md) | ✅ | 한 줄 정의 + 정체성 + 결격사유 0 원칙 |

### 사용자
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 02 | [페르소나·시나리오 (Personas & Scenarios)](./02_personas_scenarios.md) | ✅ | 4개 페르소나 (학술/PM/학습/우연재발견) + 시나리오 |
| 03 | [가치 제안 (Value Propositions)](./03_value_propositions.md) | ✅ | Chrome 확장 대비 차별 + 자체 브라우저 정당화 |

### 시스템
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 04 | [데이터 모델 (Data Model)](./04_data_model.md) | ✅ | Entity ERD + anchor 키 + forward-compatibility |
| 05 | [CRUD 매트릭스 (CRUD Matrix)](./05_crud_matrix.md) | ✅ | Entity × Actor + IPC 채널 + 라이프사이클 |
| 06 | [아키텍처 (Architecture)](./06_architecture.md) | 📝 (b4) | Main/Renderer + IPC + 컴포넌트 트리 + 의존 그래프 |
| 07 | [UI 레이아웃 (UI Layout)](./07_ui_layout.md) | 📝 (b5) | UI 스케치 + 컴포넌트 spec |

### 동작
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 08 | [인덱싱 (Indexing)](./08_indexing.md) | 📝 (b6) | 인덱싱 흐름 + 임베딩 + 캐시 + 재방문 정책 |
| 09 | [검색 (Search)](./09_search.md) | 📝 (b6) | 검색 흐름 + 자연어 시간 파싱 + retrieval 정책 |
| 10 | [AI 채팅 (AI Chat)](./10_ai_chat.md) | 📝 (b6) | 채팅 retrieval + 출력 schema + 출처 인용 + 수준 옵션 |
| 11 | [워크스페이스 (Workspace)](./11_workspace.md) | 📝 (b7) | 격리 모델 + 전환 UX |
| 12 | [Provider 어댑터 (Provider Adapter)](./12_provider_adapter.md) | 📝 (b7) | OpenAI / Codex OAuth / 로컬 LLM + 모델 fallback |

### 안전·통합
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 13 | [보안·프라이버시 (Security & Privacy)](./13_security_privacy.md) | 📝 (b8) | Privacy Filter + OS Keychain + UA 정체성 |
| 14 | [백그라운드 번역 (Translation Background)](./14_translation_background.md) | 📝 (b8) | 백그라운드 번역 (P2) + 작업 큐 + 알림 |

### 운영
| # | 섹션 | 상태 | 내용 |
|---|---|---|---|
| 15 | [비용·저장 (Costs & Storage)](./15_costs_storage.md) | 📝 (b9) | 비용 / 저장 / 임계 |
| 16 | [로드맵 (Roadmap)](./16_roadmap.md) | 📝 (b9) | Phase 1/2/3 + Sprint 매핑 + 시나리오 cover 매트릭스 |
| 17 | [Known Issue 정책 (Known Issues Policy)](./17_known_issues_policy.md) | 📝 (b10) | KI-NNN 정책 + Severity 정의 |
| 18 | [평가 (Evaluation)](./18_evaluation.md) | 📝 (b10) | 검증 layering + 정량 임계 셋 |
| 19 | [v0.3 → v0.4 마이그레이션 (Migration)](./19_migration_v03_v04.md) | 📝 (b10) | 모듈 매핑 + 데이터 마이그레이션 + 회귀 셋 |

---

## SSOT 참조

- 방향 SSOT: [`.flowset/specs/v04-direction.md`](../../.flowset/specs/v04-direction.md)
- 핸드오프: [`.flowset/handoffs/2026-05-16.md`](../../.flowset/handoffs/2026-05-16.md)
- Sprint 015 contract: [`.flowset/contracts/sprint-015.md`](../../.flowset/contracts/sprint-015.md)
- 가드레일: [`.flowset/guardrails.md`](../../.flowset/guardrails.md)
- M0 사전 분석 (A1~A4):
  - [`.flowset/specs/v04-migration-matrix.md`](../../.flowset/specs/v04-migration-matrix.md)
  - [`.flowset/specs/v04-test-classification.md`](../../.flowset/specs/v04-test-classification.md)
  - [`.flowset/specs/v04-data-migration.md`](../../.flowset/specs/v04-data-migration.md)
  - [`.flowset/specs/v04-dependency-graph.md`](../../.flowset/specs/v04-dependency-graph.md)

## 작성 원칙

- **추측 금지** (G-006): v04-direction.md SSOT를 인용. "TBD" 금지.
- **한국어 우선** (G-008): 코드 식별자·표준 영어 표현은 그대로.
- **단일 책임**: 각 섹션은 한 도메인. 중복은 cross-reference만.
- **Phase 매핑**: 컴포넌트는 본 섹션에 기술, Phase는 §16에 종합.

## 변경 이력 (메타)

- 2026-05-16: PRD v0.4.0 19 섹션 분할 신규 발행. v0.3 13 섹션은 archive 이동.
