# Phase 3 종료 검토 체크리스트 (Sprint 018 M4 T11 / S018-T11)

> **작성**: 2026-05-29 (Sprint 018 M4 T11). PRD v0.5.0 발행(T10, PR #270) 직후.
> **사전 협의**: codex `019e718f-0901-7443-989a-320f2011b111` Q4 (Phase 3 종료 검토 방향 — "MVP 아직 아님" 결론 + 충족/미충족 표 + 미충족 항목 Sprint backlog 연결).
> **목적**: PRD §16.4.3 Phase 3 종료 임계 대비 **현재 충족/미충족을 정직히 평가**하여 MVP 진입 가능 여부를 판정. 충족이 아니라 **잔여 작업을 다음 Sprint backlog 로 연결**하는 게 핵심.
> **판정 원칙 (G-006)**: 모든 현황은 실 코드/파일/실측 기준. "wiring 박힘"과 "exit 검증 완료"를 구분한다 (wiring ≠ end-to-end 시연·정량 측정).

## 1. 결론 (먼저)

**MVP 아직 아님 — Phase 3 종료 임계 미충족.** 잔여 작업 = **Sprint 019~022**.

- Phase 3 컴포넌트의 **구현·wiring 은 상당히 진척** (로컬 LLM chat+embed / Schema v06 / JSON·Markdown Export / Notion·공유 설계 spec).
- 그러나 Phase 3 **종료 임계(§16.4.3) 5개 영역 중 0개 완전 충족** — 시나리오 100%·1주 실사용·오프라인 end-to-end 검증·Export 3종 round-trip·로컬 LLM 정량 임계 모두 미완/부분.
- MVP 최종 = Phase 3 종료 후 딥검증 (PRD §16.1). 본 시점은 **딥검증 진입 전**.

## 2. Phase 3 종료 임계 충족/미충족 (PRD §16.4.3)

| # | 임계 (§16.4.3) | 현황 | 판정 | 잔여 → Sprint |
|---|---|---|---|---|
| 1 | **4개 시나리오 모두 100% cover** (S1 학술 / S2 PM Notion Export / S3 학습 자동 수준 / S4 재발견) | Phase 1 평균 **95%** (S1 100 / S2 90 / S3 90 / S4 100 — PRD §16.5). S2 100% = Notion Export 필요(spec only) / S3 100% = 자동 수준 추정 실 학습 필요(UserLevelEstimator mock, T20 defer) | ❌ 미충족 | S020 (S2) + S019 (S3 T20) + S022 딥검증 |
| 2 | **사용자 실사용 1주** (매일 사용 + 일지 + issue ≤ 30) | 미수행 | ❌ 미충족 | S022 (MVP 최종 딥검증) |
| 3 | **Local LLM 오프라인** (인터넷 없이 검색 + 채팅 + 인덱싱) | `OllamaProvider` chat(S017 T14)+embed(S018 T17c) **wiring 박힘** + `providers.set('local')` + `defaultProviderId='local'` 경로 + 검색 embed 경로. **단 오프라인 end-to-end 시연·검증 미완**. (`chatStream` 은 defer이나 **본 임계 비필수** — §16.4.3 offline = 검색+채팅+인덱싱, streaming 불요) | ⚠️ 부분 (wiring O / exit 검증 X) | S019 (오프라인 E2E 검증 — chatStream 무관) |
| 4 | **Export 3종 round-trip** (Notion / Markdown / JSON) | JSON ✅(`WorkspaceExportImportService`, round-trip 회귀) + Markdown ✅(`MarkdownExportService`, projection+canonical 첨부). **Notion 미구현**(설계 spec only — `sprint-018-notion-export-spec.md`, 구현 S020) | ⚠️ 부분 (2/3) | S020 (Notion 구현 + round-trip 회귀) |
| 5 | **정량 임계 6종(§15.4) + 로컬 LLM 응답 < 2초** | 6종 Phase 1 **PASS** (perf bench — KI-011~016 closed: MemoryStats 0.447ms / Indexing 0.027ms / Search 1.404ms / WS switch 0.283ms / $0.20/월 / 90.32MB). **로컬 LLM < 2초 미측정** (사용자 하드웨어 base 필요) | ⚠️ 부분 (6종 O / 로컬 LLM 미측정) | S019 (로컬 LLM 정량 측정) |

**요약**: ❌ 2 (시나리오 / 1주 실사용) + ⚠️ 3 (오프라인 검증 / Export 3종 / 로컬 LLM 정량). **완전 충족 0/5.**

## 3. Phase 3 컴포넌트 구현 현황 (PRD §16.4.1 정합)

| 컴포넌트 | 상태 | 근거 (실 코드/spec) |
|---|---|---|
| **로컬 LLM chat** | ✅ wiring | `OllamaProvider.chat()` (`/api/chat`, `supportsChat=true`, S017 T14). `chatProviderSelect` defaultProviderId='local'→['local'] (OpenAI fallback 금지) |
| **로컬 임베딩** | ✅ wiring | `OllamaProvider.embed()` (`/api/embed`, `nomic-embed-text` 768, `supportsEmbed=true`, S018 T17c). Schema v06 `vec_pages_768` + searchHandlers provider-aware. E2E 격리 회귀(`t17e-embedding-isolation.test.ts`) |
| **Schema v06** | ✅ 구현 | `V06_SCHEMA_VERSION=3`, `workspaces.embedding_model` + vec0 dimension 분리 + `migrateV05ToV06` (G-014) |
| **chatStream (로컬)** | ❌ defer | Ollama NDJSON 지원하나 scope 외 (codex Q8). Phase 3 후속 |
| **JSON Export/Import** | ✅ 구현 | `WorkspaceExportImportService` (`WorkspaceExportV1` schemaVersion v06, round-trip + id remap) |
| **Markdown Export** | ✅ 구현 | `MarkdownExportService` (projection + canonical JSON 첨부) |
| **Notion Export** | 📝 spec only | `ExportArtifactBuilder` 미생성. 설계 spec `sprint-018-notion-export-spec.md` (옵션 C), 구현 S020 (S020-a~f) |
| **워크스페이스 공유** | 📝 spec only | `SharedWorkspaceFormat` 미생성. 설계 spec `v05-collab-spike.md` (gzip+Ed25519 TOFU+untrusted validator), 구현 S021 (S021-a~k) |
| **UserLevelEstimator 실 학습** | ⚠️ mock | Phase 2 mock 박힘. R3-B 실 학습 = T20 (학습 데이터셋 부재로 Sprint 019 defer — contract §155) |
| **Auto-Backup** | ❌ 미착수 | Sprint 021+ 검토 |

## 4. KI / 가드레일 게이트

- **KI 잔여 8** (HIGH 0 / MEDIUM 3 [KI-001 in-progress·KI-004·KI-006] / LOW 5). HIGH 0 → Phase 3 종료 차단 KI 없음. MEDIUM/LOW 는 **Phase 3 종료 후 MVP 직전 batch 정리** (PRD §17 정책). ⚠️ `known-issues.md` §통계 "총 잔여 9" off-by-one → T12 정정.
- 가드레일 위반 0. G-021 dual review / G-022 진입 게이트 / G-014 마이그레이션 백업 모두 정합.
- 단위 회귀 **1950 PASS** (104 파일). 시나리오 회귀 18+ cover 유지.

## 5. MVP 진입 가능 여부 판정

**불가 (아직).** Phase 3 종료 임계 5영역 완전 충족 0. MVP 최종 딥검증(§16.1 — 시나리오 4개 100% 시연 + 정량 임계 + 1주 실사용) 진입 전.

차단 요인 (우선순위):
1. **Notion Export 구현** (S020) — S2 시나리오 100% + Export 3종 round-trip 의 마지막 1종.
2. **로컬 LLM 오프라인 E2E 검증 + 정량 측정** (S019) — 오프라인 시연 + 응답 < 2초 (사용자 하드웨어).
3. **워크스페이스 공유 구현** (S021) — Phase 3 외부 통합 마지막 축.
4. **UserLevelEstimator 실 학습** (S019, T20) — S3 시나리오 100% (학습 데이터셋 확보 후).
5. **MVP 최종 딥검증** (S022) — 시나리오 4개 100% 시연 + 사용자 1주 실사용.

## 6. 잔여 작업 → Sprint backlog 연결

| Sprint | 작업 | 종료 임계 기여 |
|---|---|---|
| **S019** | 로컬 LLM 오프라인 E2E 검증 + 정량(<2초) 측정 + UserLevelEstimator 실 학습(T20, 데이터셋 후). (`chatStream` = 비필수 후속/defer — exit 임계 무관, 여유 시) | #3 #5(로컬LLM) + #1(S3) |
| **S020** | `ExportArtifactBuilder` Notion 경로 구현 (S020-a~f) + round-trip 회귀 | #4(Notion) + #1(S2) |
| **S021** | `SharedWorkspaceFormat` 구현 (S021-a~k) + Auto-Backup | Phase 3 외부 통합 완성 |
| **S022 (검토)** | Phase 3 종료 evaluator + MVP 최종 딥검증 (시나리오 4개 100% 시연 + 1주 실사용) | #1 #2 전부 |

## 7. 참조

- PRD §16.1 (MVP 정의) / §16.4 (Phase 3 컴포넌트·매핑·종료 임계) / §16.5 (시나리오 cover) / §15.4 (정량 임계 6종) / §12.8 (OllamaProvider) / §11.5.6·§11.12 (Export·공유)
- 설계 spec: `sprint-018-notion-export-spec.md` (Notion, S020) / `v05-collab-spike.md` (공유, S021) / `sprint-018-schema-v06-spec.md` (Schema v06)
- 실 코드: `src/ai/providers/OllamaProvider.ts` / `src/storage/schema/v06.sql` / `src/main/WorkspaceExportImportService.ts` / `src/main/MarkdownExportService.ts`
- Known Issues: `.flowset/known-issues.md` (잔여 8, §통계 off-by-one T12 정정)
- contract: `.flowset/contracts/sprint-018.md` AC-5 (T10) + T11 (본 산출물)
- 가드레일: G-006 (추측 금지 — wiring ≠ exit 검증 구분) / G-021 (dual review) / G-013 (단계별 — spec/구현 분리)

## 8. 변경 이력

- 2026-05-29 (Sprint 018 M4 T11): Phase 3 종료 검토 체크리스트 신규. PRD §16.4.3 임계 5영역 충족/미충족 표 + 컴포넌트 구현 현황 + MVP 진입 불가 판정 + 잔여 Sprint 019~022 backlog 연결. codex 019e718f Q4 협의 정합 ("MVP 아직 아님" + wiring ≠ exit 검증 구분).
