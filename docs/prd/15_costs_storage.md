# 15. 비용·저장 (Costs & Storage)

> [← PRD 목차](./README.md)

본 섹션은 OpenAI / Codex / Local LLM 비용 추정 + SQLite·임베딩 저장 용량 + 정량 임계 6종 + Phase별 비용·저장 변화. 2026-05-16 기준 OpenAI 공식 가격 인용.

## 15.1 비용 모델 (BYOK 디폴트)

### 15.1.1 OpenAI 가격 (2026-05-16 공식)

| 모델 | input | output | 비고 |
|---|---|---|---|
| `gpt-4o-mini` | $0.15 / 1M tokens ($0.00015 / 1k) | $0.60 / 1M tokens ($0.0006 / 1k) | Phase 1 저가 디폴트 (M5 PoC 시 GPT-5 계열 변경 검토) |
| `text-embedding-3-small` | $0.02 / 1M tokens ($0.00002 / 1k) | — | 1024 차원 (`dimensions=1024` 축소) |
| (참고) `gpt-4o` | $2.50 / 1M tokens | $10.00 / 1M tokens | 사용자 선택 (능동 호출 시) |
| (참고) `gpt-4-turbo` | $10.00 / 1M tokens | $30.00 / 1M tokens | 동상 |

> **정확 가격 출처**: OpenAI 공식 [pricing 페이지](https://platform.openai.com/docs/pricing). 본 PRD 수치는 2026-05-16 기준 스냅샷, 가격 변동 시 OpenAI 공식 우선.

### 15.1.2 Codex OAuth 비용

- USD 비용 0 (ChatGPT 구독 기반 — Plus 또는 Pro)
- 사용 한도: Plus ≈ 주당 80 메시지 (추정, 공식 공시 없음). Pro 더 높음.
- 429 응답 시 BYOK 자동 fallback (사용자 명시 동의 시, [§12.4.3](./12_provider_adapter.md#1243-모델-fallback-체인-능동-채팅-호출-한정))
- durationMs 실측 저장 ([§12.6.4](./12_provider_adapter.md#1264-codex-oauth-비용)) — M3 schema 후

### 15.1.3 (Phase 3) Local LLM 비용

- API 과금 0 (사용자 하드웨어 + 전력 부담)
- 모델 다운로드 비용 (수 GB ~ 수십 GB 디스크)
- 성능 = 사용자 하드웨어 의존 (M2 Mac base / RTX 4090 강력)

## 15.2 호출별 비용 추정 (Phase 1 자동 호출)

### 15.2.1 자동 인덱싱 (BYOK)

페이지 평균 1k tokens 가정 (text-embedding-3-small dimensions=1024):

| 사용 패턴 | 페이지 / 월 | 임베딩 비용 |
|---|---|---|
| 가벼운 사용 (3,000 페이지/월) | 3,000 | **$0.06 / 월** ($0.00002 × 3,000) |
| 중간 사용 (10,000 페이지/월) | 10,000 | **$0.20 / 월** |
| 무거운 사용 (30,000 페이지/월) | 30,000 | **$0.60 / 월** |

> **PR b6.1 정정**: PR b6 의 "$1~3/월" 5배 과대 추정 정정 — 정확 가격 $0.02/1M × 1k/페이지 × 1만 = $0.20/월.

### 15.2.2 자동 태깅 (BYOK, AutoTagger M4)

페이지당 1회 호출 — gpt-4o-mini JSON output (보통 ~200 output tokens, system+input ~500 tokens):

| 사용 패턴 | 호출 / 월 | 태깅 비용 (input + output) |
|---|---|---|
| 가벼운 | 3,000 | input $0.00023 + output $0.00036 = $0.00059 → **~$0.001 / 월** ($0.000000196 × 3k 가량 미미) |
| 중간 | 10,000 | **~$0.003 / 월** |
| 무거운 | 30,000 | **~$0.009 / 월** |

자동 태깅 비용은 임베딩 대비 매우 작음 (gpt-4o-mini 가격이 embedding 보다 7~30배지만 호출 토큰 수가 page 본문보다 훨씬 적음).

### 15.2.3 사용자 능동 AI 채팅 (사용자 선택 Provider)

| Provider | 회당 비용 추정 |
|---|---|
| OpenAI gpt-4o-mini (BYOK) | input 1k tokens (질문+retrieval 5개 page snippets) + output 500 tokens = **~$0.00045 / 호출** |
| OpenAI gpt-4o (BYOK) | ~$0.00750 / 호출 |
| Codex OAuth gpt-5.5 (low reasoning) | $0 (구독 한도 차감) |

매일 10회 사용 가정 → BYOK gpt-4o-mini 약 $0.135/월. gpt-4o ~$2.25/월.

### 15.2.4 자동 호출 합계 (BYOK gpt-4o-mini)

가벼운 ~ 중간 사용 (월 3,000~10,000 페이지):
- 임베딩 $0.06 ~ $0.20
- 자동 태깅 $0.001 ~ $0.003
- **합계 BYOK 자동: $0.07 ~ $0.21 / 월**

사용자 능동 채팅 추가 시 $0.20 ~ $0.50 / 월 범위.

## 15.3 저장 용량

### 15.3.1 페이지 단위

| 데이터 | 크기 추정 |
|---|---|
| Page.content (본문 텍스트) | 평균 10KB / 페이지 |
| Page 메타 (title/url/lang/visited_count/timestamps) | ~200 bytes |
| Visit 1개 | ~100 bytes |
| 임베딩 (1024 차원 × 4 bytes = float32) | 4 KB |

**페이지 1개 합산: ~15KB**

### 15.3.2 1만 페이지 누적

| 데이터 | 크기 |
|---|---|
| SQLite Page 테이블 | ~10 MB |
| Visit 테이블 (페이지당 평균 1.5 visit) | ~1.5 MB |
| vec_pages (sqlite-vec) | ~40 MB |
| 본문 캐시 (`<userDataDir>/page-content/`) | ~100 MB |
| **합계** | **~150 MB / 만 페이지** (v04-direction §8 정합) |

### 15.3.3 다른 Entity 누적 (사용 패턴 추정)

| Entity | 누적 추정 |
|---|---|
| Note (페이지당 평균 1개, 1k tokens 본문) | ~5 KB / 노트 (본문 + 메타 + 임베딩) → 1만 노트 = ~50 MB |
| AiChatHistory (워크스페이스당 평균 100 메시지) | 워크스페이스 10개 × 100 = 1,000 메시지 × ~2KB = ~2 MB |
| Tag + PageTag/NoteTag | ~5 MB / 만 페이지 |
| Workspace | 무시 가능 |

### 15.3.4 1년 누적 추정

매일 100 페이지 방문 = 연 36,500 페이지:
- Page + Visit + 임베딩 + 본문 캐시: **~550 MB**
- Note (5,000개) + 임베딩: ~25 MB
- AiChatHistory (10,000 메시지) + chat_meta: ~30 MB
- Tag·M:N: ~20 MB
- 마이그레이션 백업 (`backup/v03/`): ~50 MB (1회성)
- 로그 (UsageLog / migration-v04.log): ~10 MB

**1년 합산: ~680 MB** (사용자 디스크 부담 거의 없음, 1TB SSD 0.07%)

## 15.4 정량 임계 6종 (v04-direction §12.3, Phase 1 종료 evaluator 입력)

| # | 지표 | 임계 | 측정 시점 | 측정 방법 |
|---|---|---|---|---|
| 1 | 인덱싱 속도 | < 500ms / 페이지 | M4 종료 | 100 페이지 모킹 인덱싱 + 시간 측정 ([§08 §8.10](./08_indexing.md#810-정량-임계-phase-1-종료-evaluator-입력)) |
| 2 | 검색 응답 | < 200ms (top-10 표시) | M5 종료 | 1000 페이지 인덱스 + retrieval × 100회 평균 ([§09 §9.7](./09_search.md#97-성능-임계-phase-1-종료-evaluator-입력)) |
| 3 | top-10 hit rate | ≥ 80% | M5 종료 | 회귀 셋 + 50 페어 자체 테스트 셋 |
| 4 | 임베딩 비용 | < $3 / 월 (1만 페이지 기준) | M3 종료 | 실측 페이지당 토큰 수 × $0.00002 × 1만 (현재 추정 $0.20/월, 임계 15배 여유) |
| 5 | 저장 용량 | < 200MB / 만 페이지 | M3 종료 | 1만 페이지 모킹 후 SQLite 파일 크기 (현재 추정 ~150MB) |
| 6 | AI 응답 출처 정확도 | ≥ 90% | M5 종료 | 회귀 셋 30 케이스 chat_meta.cells.sources 검증 ([§10 §10.8](./10_ai_chat.md#108-정량-임계-phase-1-종료-evaluator-입력)) |

임계 미달 → Known Issue (KI-NNN) 등록 ([§17](./17_known_issues_policy.md)) → Severity 정의에 따라 처리.

## 15.5 사용자 비용 보호 정책

[§12.4.4 fallback 제한](./12_provider_adapter.md#1244-fallback-제한-비용-폭주-방지) 정합. 사용자 BYOK 비용 폭주 방지:

### 15.5.1 호출당 cap

- 단일 호출 최대 추정 비용 $0.10 (사용자 settings 조정 가능)
- 임계 초과 시 호출 전 확인 dialog

### 15.5.2 월 cap (Phase 1 M5 도입)

- UserSetting 에 `monthlyCostCapUsd` (디폴트: 무제한 / 사용자 명시 설정 시)
- UsageLog 월 누적 비용 도달 시 추가 호출 전 확인 + 자동 호출 (인덱싱·태깅·임베딩) 일시 정지 옵션

### 15.5.3 사용자 표시 (SettingsPage > UsagePanel)

[§12.6.3](./12_provider_adapter.md#1263-사용자-표시-settingspage--usagepanel-m3-schema-후) 정합. 월 누적 비용 + 워크스페이스 분포 + 모델 분포 + 임계 알림.

## 15.6 Phase 별 비용·저장 변화

### 15.6.1 Phase 1 (현재)

- 비용: 자동 호출 (임베딩 + 태깅) BYOK $0.07 ~ $0.21 / 월 + 능동 채팅 ~$0.20 / 월 = **~$0.30 / 월** (중간 사용자)
- 저장: 1년 ~680 MB (가벼운 사용자)

### 15.6.2 Phase 2 (Sprint 016+)

- 비용 추가:
  - 백그라운드 번역 (논문 PDF 등) — 사용자 명시 호출, 작업당 ~$0.004 (gpt-4o-mini) 또는 Codex 한도
  - 자동 수준 추정 (UserLevelEstimator) — 워크스페이스 활동 기반 주기적 호출, 추정 ~$0.05 / 월
- 저장 추가:
  - TranslationJob 테이블 + 번역 결과 본문 — 논문 1편 ~30KB → 50편/년 = ~1.5MB (미미)
  - 하이라이트 (Note 확장) — 미미

### 15.6.3 Phase 3 (Sprint 017+)

- **비용 절감 가능**:
  - Local LLM 도입 시 BYOK 호출 비용 0 (자동 인덱싱 임베딩·태깅도 로컬 가능)
  - 단 로컬 모델 다운로드 + 디스크 (4~10GB / 모델) + 전력 부담
- 저장 추가:
  - Export artifact (Notion / Markdown / JSON) — 사용자 명시 작업, 일시적
  - 워크스페이스 공유 (포맷 정의)

## 15.7 비용 절감 옵션 (사용자 선택)

| 옵션 | 절감 효과 | 부담 |
|---|---|---|
| **자동 인덱싱 비활성** (수동 인덱싱만) | 임베딩 비용 0 | 검색·RAG retrieval 정확도 감소 |
| **자동 태깅 비활성** | 태깅 비용 0 | 카테고리 검색·필터 미작동 |
| **임베딩 모델 변경 (Phase 3 로컬 옵션)** | 임베딩 비용 0 | 로컬 임베딩 모델 품질 차이 |
| **Codex OAuth 사용** (자동 호출 명시 동의) | BYOK 비용 0 | ChatGPT 한도 소진 가속 (G-003 강화 정합) |
| **월 cap 설정** | 임계 도달 시 자동 정지 | 정지 후 수동 재개 필요 |

## 15.8 비교 — Chrome 확장 / ChatGPT 웹 대비 비용

### 15.8.1 Chrome 확장 (Sider / MaxAI 등)

- 월 구독료 (보통 $10~30 / 월) + 자체 LLM 호출 (확장 운영자가 마진 포함)
- BYOK 옵션 일부 제공 (Sider 등) — FlowBrowser BYOK 와 동등하나 인덱싱 부재로 절대 호출량 작음

### 15.8.2 ChatGPT Plus / Pro

- 월 구독료 ($20 Plus / $200 Pro, 2026-05-16 기준 — 정확 가격은 OpenAI 공식 페이지)
- 본 시스템 BYOK gpt-4o-mini 자동 호출 비용 (~$0.30/월) 대비 50배 차이 — Plus 구독 1개월 비용 ≈ 본 시스템 70개월 자동 호출 비용

### 15.8.3 Recall.ai / Rewind.ai

- 월 $25~30 (구독)
- 본 시스템: BYOK 시 ~$0.30 / 월 (자동) — 100배 차이

## 15.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §8 (비용·저장) + §12.3 (정량 임계 6종) + §17 (BYOK 디폴트)
- [§04 §4.6 마이그레이션](./04_data_model.md#46-실패재시도-시나리오)
- [§08 §8.9 비용·저장 추정](./08_indexing.md#89-비용저장-추정) + [§8.10 임계](./08_indexing.md#810-정량-임계-phase-1-종료-evaluator-입력)
- [§09 §9.7](./09_search.md#97-성능-임계-phase-1-종료-evaluator-입력) + [§10 §10.8](./10_ai_chat.md#108-정량-임계-phase-1-종료-evaluator-입력)
- [§12 §12.4 모델 선택](./12_provider_adapter.md#124-모델-선택-정책) + [§12.4.4 fallback 제한](./12_provider_adapter.md#1244-fallback-제한-비용-폭주-방지) + [§12.6 UsageLog](./12_provider_adapter.md#126-cost-tracking-usagelog-generalize--pr-b71-정정)
- [§14 §14.6 백그라운드 번역 비용](./14_translation_background.md#146-provider-선택-byok-디폴트-g-003-강화)
- OpenAI 공식 [pricing 페이지](https://platform.openai.com/docs/pricing) (2026-05-16 기준)

본 §15 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 15.10 변경 이력

- 2026-05-16 (PR b9): stub → 본문 작성. OpenAI 공식 가격 (gpt-4o-mini input·output 분리 + text-embedding-3-small 1024 차원) + Codex OAuth 한도 + Local LLM 비용 0 + 호출별 비용 추정 (가벼운/중간/무거운 사용 패턴) + 자동 합계 ~$0.30/월 + 저장 1만 페이지 ~150MB / 1년 ~680MB + 정량 임계 6종 측정 protocol + 사용자 비용 보호 (호출 cap / 월 cap / 알림) + Phase 1/2/3 변화 + 비용 절감 옵션 5종 + Chrome 확장·ChatGPT·Recall 비교.
