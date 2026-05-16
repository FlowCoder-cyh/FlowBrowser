# 14. 백그라운드 번역 (Translation Background)

> [← PRD 목차](./README.md)

본 섹션은 **Phase 2 신규** 백그라운드 장시간 번역 기능. v0.3 실시간 페이지 번역 (replace/overlay) 폐기 후 재정의 — 논문/PDF 등 시간 걸려도 백그라운드 처리 + 알림 + 워크스페이스 메모리 저장.

> **Phase 2 명시**: 본 §14 는 Phase 2 (Sprint 016+) 도입 spec. Phase 1 시점 (Sprint 015) 미구현. PR b8 작성 시점에는 spec 만 박힘, 실제 구현은 Sprint 016+ contract 진입 시.

## 14.1 배경 — v0.3 실시간 번역 폐기 → v0.4 백그라운드 재정의

[§00 §0.1](./00_change_history.md#01-v040--방향-전환-2026-05-16) + [§01 §1.2.1](./01_overview.md#121-폐기된-패러다임-v03) 정합.

| v0.3 (폐기) | v0.4 Phase 2 (재정의) |
|---|---|
| 실시간 페이지 텍스트 교체 (replace/overlay) | 백그라운드 작업 큐 (논문/PDF 우클릭 → 큐 추가) |
| 페이지당 49+ 호출 / 수십 초~분 사용자 대기 | 시간 무관 — 사용자는 다른 작업 |
| Chrome 내장 번역 대비 차별 약함 | 워크스페이스 메모리 저장 + 별도 한국어 뷰 |
| ChatGPT 한도 5h/주 즉시 소진 | reasoning medium/high 가능 (시간 무관) |
| ToS 회색지대 | BYOK 디폴트 + 사용자 명시 동의 시 Codex |

## 14.2 핵심 컨셉

> **"논문 같은 거 시간 좀 걸려도 백그라운드로 뽑아내고 완료 알림"** (이전 세션 핸드오프 L2622 사용자 결정)

사용자가 영문 논문 페이지 → 우클릭 "백그라운드 번역 작업 추가" → 시스템 알림 트레이로 진행 → 완료 시 시스템 알림 + 워크스페이스 메모리 저장 + ChatPanel "번역 결과" 인용 가능.

## 14.3 Phase 2 도입 spec (Sprint 016+ contract 진입 시 확정)

### 14.3.1 데이터 모델 (Phase 2 추가)

[§04 §4.4](./04_data_model.md#44-forward-compatibility-phase-23-외래키-nullable) Phase 2 신규 테이블:

```sql
-- v0.4.x Phase 2 schema 신규 (Sprint 016+ 도입)
CREATE TABLE TranslationJob (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES Workspace(id) ON DELETE CASCADE,
  page_id UUID REFERENCES Page(id) ON DELETE CASCADE,  -- nullable, page 컨텍스트 없이 가능
  source_text TEXT NOT NULL,          -- 원본 (PDF 추출 등)
  source_lang TEXT,
  target_lang TEXT NOT NULL DEFAULT 'ko',
  translated_text TEXT,               -- 번역 결과 (완료 시 INSERT)
  provider_id TEXT NOT NULL,          -- 'openai-key' 디폴트
  model TEXT,                          -- 'gpt-4o-mini' 디폴트 (M? PoC 결정)
  reasoning_effort TEXT,               -- 'low' / 'medium' / 'high' (Codex OAuth 시)
  status TEXT NOT NULL CHECK ('queued', 'in_progress', 'completed', 'failed', 'cancelled'),
  progress_pct INTEGER DEFAULT 0,      -- 0~100
  estimated_cost_usd REAL,
  created_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_code TEXT,
  error_message TEXT
);
```

[§04 §4.4](./04_data_model.md#44-forward-compatibility-phase-23-외래키-nullable) Page.translation_job_id (Phase 3) 는 본 TranslationJob 과 연결 — 페이지 → 번역 작업 참조.

### 14.3.2 컴포넌트 (Sprint 016+ 신규)

| 컴포넌트 | 위치 | 책임 |
|---|---|---|
| `TranslationJobStore` | `src/storage/TranslationJobStore.ts` | TranslationJob CRUD |
| `TranslationJobRunner` | `src/main/TranslationJobRunner.ts` | 큐 worker + Provider 호출 + 진행률 |
| `TranslationJobPanel` | `src/renderer/src/translation/TranslationJobPanel.tsx` | UI (활성 작업 list + 진행률 + 결과 미리보기) |

## 14.4 흐름 (Sprint 016+)

```
[사용자 영문 페이지 → 우클릭 "백그라운드 번역"]
   ↓
Renderer: translation-job:create IPC (page_id, target_lang='ko')
   ↓
Main: ParagraphExtractor 또는 PDF 추출기 (Phase 2+) → source_text
   ↓
Main: TranslationJob (C, status='queued')
   ↓
Main: TranslationJobRunner 큐에 enqueue (FIFO + 동시성 limit, Phase 2 M? PoC)
   ↓
[큐 worker]
   ├─ TranslationJob (U status='in_progress', started_at=now)
   ├─ Provider Adapter chat() 호출 (BYOK 디폴트, OpenAI gpt-4o-mini 또는 사용자 명시 Codex)
   ├─ 청크 단위 진행 (긴 본문은 청크 분할 + 청크별 progress_pct 갱신)
   └─ 완료 → TranslationJob (U translated_text, status='completed', completed_at)
   ↓
[Electron Notification API — 시스템 알림]
   "📚 논문 번역 완료 — '<page.title>' (워크스페이스: <ws.name>)"
   ↓
[사용자 알림 클릭]
   ├─ TranslationJobPanel 표시 (활성 워크스페이스 전환 시 자동)
   └─ ChatPanel "번역 결과 첨부" 옵션 활성 — chat:request 시 retrieved_items 에 자동 포함
```

## 14.5 결과 저장 — 워크스페이스 메모리 + 별도 한국어 뷰

본 컴포넌트의 핵심 가치: **번역 결과를 워크스페이스 메모리에 인덱싱** → 한국어로 검색·AI 채팅 가능.

### 14.5.1 워크스페이스 메모리 통합

| 옵션 | spec | 결정 시점 |
|---|---|---|
| (a) 원본 Page 와 동일 URL, 별도 lang='ko' Page 신규 | translated_text 를 별도 Page 로 INSERT (URL 동일 + lang 다름) | Sprint 016+ M? PoC |
| (b) 원본 Page 에 translated_content 컬럼 추가 | Phase 2 Page schema 확장 | 동상 |
| (c) TranslationJob 만 별도 보관, retrieval 시 join | Page 변경 X, 검색 시 join | 동상 |

**디폴트 추정 (a)** — 한국어 검색·임베딩이 자연. 결정은 Sprint 016 contract 시.

### 14.5.2 별도 뷰 (Phase 2 M? PoC 결정)

| 옵션 | spec |
|---|---|
| (a) 활성 탭에서 원본·번역 토글 (Chrome 번역 UI 패턴) | 원본 페이지 위 overlay 또는 side-by-side |
| (b) 새 탭에 번역 결과 페이지 (마크다운 또는 HTML) | 영구 URL `flowbrowser://translation/<job_id>` |
| (c) ChatPanel "번역 보기" 옵션 | retrieval 우선, 별도 뷰 부수 |

Phase 2 contract 진입 시 사용자 시연 후 결정.

## 14.6 Provider 선택 (BYOK 디폴트, G-003 강화)

[§12 §12.3](./12_provider_adapter.md#123-byok-디폴트-정책-g-003-강화) 정합. 백그라운드 번역은 **자동 호출이 아닌 사용자 명시 요청** (우클릭 트리거) 이지만 시간이 길어 호출량 큼 → BYOK 디폴트 유지:

| Provider | 사용 조건 | 모델 |
|---|---|---|
| **OpenAI API Key (BYOK)** | 디폴트 | gpt-4o-mini (저가) — input $0.15/M, output $0.60/M (2026-05-16) |
| **Codex OAuth** | 사용자 명시 선택 | gpt-5.5 reasoning **medium / high** 가능 (시간 무관, 품질 우선). ChatGPT 한도 소진 인지 동의 필요 |

### 14.6.1 비용 추정 (긴 논문 — 5,000 tokens 입력)

| 모델 | 비용 추정 |
|---|---|
| gpt-4o-mini (BYOK) | ~$0.001 (input) + ~$0.003 (output, 5,000 출력 가정) = **~$0.004 / 논문** |
| gpt-5.5 medium (Codex) | ChatGPT 구독 한도 차감 — 한 작업 ≈ 1~3분 (추정) |

## 14.7 진행률 + 알림 UI

### 14.7.1 TranslationJobPanel

| 항목 | spec |
|---|---|
| 위치 | 사이드바 또는 별도 트레이 (Phase 2 contract 시 결정) |
| 표시 | 활성 작업 list (status / progress_pct / page.title / 추정 완료 시간) |
| 인터랙션 | 클릭 시 결과 미리보기 / 취소 버튼 / 재시도 버튼 |
| 알림 통합 | 완료 시 Electron `Notification` API + 작업 list 자동 갱신 |

### 14.7.2 시스템 알림 (Electron Notification API)

```typescript
// Electron Main 프로세스
import { Notification } from 'electron'

new Notification({
  title: '📚 논문 번역 완료',
  body: `'${page.title}' (워크스페이스: ${workspace.name})`,
  silent: false,
}).show()

// 사용자 클릭 시 TranslationJobPanel 표시
notification.on('click', () => {
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('translation-job:show', job.id)
})
```

## 14.8 큐 + 동시성 정책

| 항목 | Phase 2 디폴트 (M? PoC 결정) |
|---|---|
| 동시 작업 | 1 (직렬 처리) — rate limit 보수 + 사용자 시각 단순화 |
| 큐 길이 | 무제한 (사용자가 우클릭 N회 등록 가능) |
| 우선순위 | FIFO. 동일 페이지 중복 요청 시 기존 작업 cancel + 신규 enqueue |
| 진행률 갱신 | 5초마다 progress_pct UPDATE (chunk 진행 기준) |
| 앱 재시작 후 | TranslationJob.status='queued' / 'in_progress' 항목 재개 (in_progress 는 처음부터) |
| 사용자 취소 | TranslationJob.status='cancelled' + AbortController fetch 호출 |

## 14.9 시나리오 cover (학술 P1)

[§02 §2.2 시나리오 1 학술](./02_personas_scenarios.md#22-시나리오-1--학술-리서치-페르소나-p1) 강화:

```
[사용자가 영문 논문 PDF 페이지 → 우클릭 "백그라운드 번역"]
   ↓
[알림: "📚 논문 번역 진행 중"]
   ↓
[5분 후 알림: "📚 논문 번역 완료 — 'IL-2 Variant for CAR-T Resistance'"]
   ↓
[클릭 → TranslationJobPanel → 번역 결과 표시]
   ↓
[ChatPanel "이번 주 본 논문들 CAR-T 저항성 비교 정리" → 한국어 번역 결과도 retrieval 대상]
   ↓
[비교 매트릭스에 한국어 번역 출처 포함]
```

**Phase 2 cover %**: §02 §2.2 시나리오 1 의 "PDF 논문" use case 가 Phase 1 부분 cover (시간 시그널만) → Phase 2 백그라운드 번역 도입 후 완전 cover.

## 14.10 Phase 1 시점 미구현 명시

PR b8 시점 (Phase 1 Sprint 015 M1) 본 §14 spec 은 박힘 / 실제 구현 X:

| 항목 | Phase 1 (현재) | Phase 2 (Sprint 016+) |
|---|---|---|
| TranslationJob 테이블 | schema 미생성 | 신규 |
| TranslationJobStore / Runner / Panel | 미존재 | 신규 모듈 |
| 우클릭 메뉴 "백그라운드 번역" | 미노출 | 추가 (NotePanel 컨텍스트 메뉴와 별도 항목) |
| PDF 추출 | 미지원 (HTML only) | pdf-extract 라이브러리 도입 ([§08 §8.7](./08_indexing.md#87-dom-추출-실패-영역-정책)) |

Phase 1 사용자가 PR b8 본문을 보고 "백그라운드 번역" 시도 시 기능 미존재 — Sprint 016 contract 도입 후 활성. README 명시 ([§00 §0.3 Phase 분할](./00_change_history.md#03-phase-분할-phase별-출시--phase별-검증)) 정합.

## 14.11 SSOT 인용

- `.flowset/specs/v04-direction.md` §10.2 Phase 2 (백그라운드 번역) + §17 R3 (재정의)
- [§00 §0.1 v0.4.0 방향 전환](./00_change_history.md#01-v040--방향-전환-2026-05-16)
- [§01 §1.2.1 폐기된 패러다임](./01_overview.md#121-폐기된-패러다임-v03)
- [§02 §2.2 학술 시나리오](./02_personas_scenarios.md#22-시나리오-1--학술-리서치-페르소나-p1)
- [§04 §4.4 Phase 2 forward-compat](./04_data_model.md#44-forward-compatibility-phase-23-외래키-nullable)
- [§06 §6.7.1 Phase 2 추가 모듈](./06_architecture.md#671-phase-2-추가-모듈)
- [§12 §12.3 BYOK 디폴트](./12_provider_adapter.md#123-byok-디폴트-정책-g-003-강화)
- Electron 공식 [Notification API](https://www.electronjs.org/docs/latest/api/notification)
- 이전 세션 핸드오프 L2622 사용자 결정 (백그라운드 번역 재정의)

본 §14 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 14.12 변경 이력

- 2026-05-16 (PR b8): stub → 본문 작성. v0.3 → v0.4 재정의 (실시간 폐기 → 백그라운드) + Phase 2 도입 spec 명시 (현재 Phase 1 미구현). TranslationJob 테이블 schema + 3 신규 컴포넌트 (Store/Runner/Panel) + 흐름 (우클릭 → 큐 → Provider → 알림 → 결과 저장) + 결과 저장 옵션 3종 (a/b/c) + 별도 뷰 옵션 3종 (M? PoC 결정 위임) + BYOK 디폴트 (gpt-4o-mini) vs Codex (medium/high) + 비용 추정 (논문 1편 ~$0.004) + 시스템 Notification API + 큐 동시성 1 + 시나리오 1 학술 강화.
