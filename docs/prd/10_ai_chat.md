# 10. AI 채팅 (AI Chat)

> [← PRD 목차](./README.md)

본 섹션은 ChatPanel — 워크스페이스 메모리 retrieval 기반 RAG 채팅 + Markdown/JSON 메타 표 출력 + 출처 인용 + 사용자 수준 옵션. [§07 §7.4.4 ChatPanel](./07_ui_layout.md#744-chatpanel-m5-translationpanel-대체) UI spec + [§04 §4.3.5 AiChatHistory](./04_data_model.md#435-aichathistory-ai-메모) 정합.

## 10.1 채팅 파이프라인

```
[사용자 ChatPanel 메시지 전송 (Cmd/Ctrl+Enter)]
   ↓
[chat:request IPC → Main]
   ↓
[ChatService.request(workspace_id, content, optional page_id)]
   ↓
[TX#1: AiChatHistory (C, role='user', status='ok')]
   ↓
[SearchService retrieval (§09)]
   ├─ workspace_id partition
   ├─ Page + Note top-k = 5 (Phase 1 디폴트)
   └─ 시간 필터 없음 (사용자 질의에 자연어 시간 있으면 TimeRangeParser 호출)
   ↓
[PromptComposer.compose (§10.4)]
   ├─ system prompt (사용자 수준 분기 + RAG 가이드)
   ├─ retrieved_items 컨텍스트 주입
   └─ user content
   ↓
[TX#2: AiChatHistory (C, role='assistant', status='pending', retrieved_items=[...])]
   ↓
[Provider Adapter 호출 (TX 외부)]
   ├─ 사용자 선택 Provider (능동 호출 = 자유)
   ├─ OpenAI: gpt-4o-mini 디폴트 (Phase 1, M5 PoC에서 정확 모델 박힘)
   ├─ Codex OAuth: gpt-5.5 reasoning low (사용자 명시 동의 시)
   └─ Streaming (SSE 파서 재활용, src/ai/codex/SseStreamParser.ts)
   ↓
[응답 streaming]
   ├─ Markdown 본문 (사용자 표시용)
   ├─ JSON 메타 (chat_meta, 표 출력 시)
   └─ 사용자 UI 에 chunk 단위 갱신
   ↓
[응답 완료]
   ├─ 성공 → TX#3: AiChatHistory (U content + chat_meta + status='ok')
   └─ 실패 → TX#3: AiChatHistory (U content=에러 메시지 + status='failed')
   ↓
[chat:response broadcast (Renderer 갱신)]
```

핵심:
- **3 TX 분리** ([§05 §5.5](./05_crud_matrix.md#55-트랜잭션-단위)): user / assistant pending / assistant final
- **Provider 호출 = TX 외부** (b3.1 학습)
- **사용자 능동 호출 = Provider 자유 선택** (b4.1 학습) — 자동 인덱싱·태깅의 BYOK 디폴트와 구별

## 10.2 retrieval 정책

[§09 §9.3](./09_search.md#93-retrieval--sqlite-vec-top-k) 패턴 재활용. 채팅 컨텍스트 차이:

| 항목 | 검색 (§09) | AI 채팅 (§10) |
|---|---|---|
| top-k | 20 → 정렬 후 10 표시 | **Phase 1 디폴트 5, 사용자 능동 호출 시 10/15 adaptive** (PR b6.1 정정 — 5 만으로 recall 부족 우려 해소) — page_id 강제 포함 옵션 시 일반 retrieval 4개로 감소 |
| Page + Note 결합 | ✓ | ✓ |
| 시간 필터 | 자연어 시간 있으면 적용 | 사용자 질의에 시간 표현 있으면 적용 (TimeRangeParser 호출) |
| 워크스페이스 격리 | partition_key | partition_key 동일 |
| 사용자 명시 페이지 | X | optional page_id (활성 탭 컨텍스트 주입 옵션) |

### 10.2.1 page_id 옵션

사용자가 ChatPanel 에서 "활성 페이지 컨텍스트 첨부" 토글 ON 시:
- 활성 탭의 Page 가 retrieved_items 최상단에 강제 포함
- 나머지 top-k - 1 = 4 개는 일반 retrieval

### 10.2.2 retrieval 제외

비밀번호 필드 감지된 페이지 / Privacy 차단 도메인 페이지는 [§08 §8.6](./08_indexing.md#86-privacy-indexinggate-m4) 정책에 따라 인덱싱 X → retrieval 대상 X (자동 격리).

## 10.3 출력 schema (Markdown + JSON 메타)

v04-direction §17 P0-4 박힘. [§04 §4.3.5 AiChatHistory.chat_meta](./04_data_model.md#435-aichathistory-ai-메모) 정합.

### 10.3.1 표시용 Markdown

assistant 응답의 `content` 컬럼 — 사용자에게 표시하는 본문. Markdown 표 / 인용 / 코드 블록 자유.

### 10.3.2 JSON 메타 (chat_meta)

비교 매트릭스 / 출처 인용 / 인터랙션 지원 데이터:

```json
{
  "rows": ["가격", "주요기능", "약점"],
  "columns": ["Linear", "Notion", "Asana"],
  "cells": [
    {"value": "월 $8", "sources": [{"page_id": "uuid", "visit_id": "uuid"}]},
    {"value": "월 $10", "sources": [{"page_id": "uuid"}]},
    {"value": "월 $13", "sources": [{"page_id": "uuid", "visit_id": "uuid"}]},
    {"value": "이슈 트래킹 강함", "sources": [{"page_id": "uuid"}]},
    ...
  ]
}
```

- **rows / columns**: 표 header
- **cells**: row-major 순서 (rows.length × columns.length 개)
- **sources**: 각 셀의 출처 — **통일 형식 `[{type, id, page_id?, visit_id?}]`** (§04 §4.3.5 정합, PR b6.1 통일). `type ∈ {'page', 'note'}` 강제. page 출처 = `{type:'page', id:page_id, page_id, visit_id?}` / note 출처 = `{type:'note', id:note_id, page_id?, visit_id?}`

### 10.3.3 Provider 응답 강제 schema

system prompt 에 명시:

```
응답 형식:
1. 본문은 Markdown (인용 / 코드 / 표 자유).
2. 비교·종합 질의 시 표 schema 포함 — 본문 마지막에 다음 JSON 블록 추가:
   ```json
   {"rows": [...], "columns": [...], "cells": [{"value": "...", "sources": [{"page_id": "..."}]}]}
   ```
3. 출처는 retrieved_items 의 page_id / note_id 만 사용 (외부 출처 X).
```

응답 파싱 (PR b6.1 보강):

- **권장 방식**: OpenAI **Structured Outputs API** (response_format json_schema) 사용 — gpt-4o-mini / gpt-4o 등 지원. JSON schema 강제 + Hallucination 위험 감소
- **fallback 방식** (Structured Outputs 미지원 시): Markdown 본문 + 마지막 JSON 코드 블록 분리 (정규식 `/```json\n([\s\S]+?)\n```/`). 정규식은 trailing text / 다중 JSON 블록에 취약하므로 **JSON schema validation** 추가 권고
- JSON 파싱 성공 + schema 검증 통과 → chat_meta 컬럼에 저장
- 실패 → chat_meta=NULL (Markdown 만 표시), KI-NNN 등록 검토

M5 PoC 시 Structured Outputs API vs system prompt 강제 결정 — 현재 fetch 기반 OpenAIApiKeyProvider 는 Structured Outputs response_format 파라미터 추가로 지원 가능.

### 10.3.4 출처 인용 표시

UI 표시 ([§07 §7.4.4](./07_ui_layout.md#744-chatpanel-m5-translationpanel-대체)):
- Markdown 표 셀에 출처 chip (작은 숫자/badge) — 클릭 시 `search:get-content` IPC → 본문 캐시 표시
- 본문 인용 [1] [2] 형식 — chat_meta.cells 외 retrieved_items 의 일반 인용 (별도 footnote 영역)

## 10.4 PromptComposer (system prompt 분기)

[§04 §4.3.1 Workspace.level_preference](./04_data_model.md#431-workspace) 반영.

### 10.4.1 사용자 수준 옵션 (R3-A, Phase 1 직접 선택)

| level_preference | system prompt 분기 |
|---|---|
| `novice` ("초보") | "사용자는 이 분야 초보. 어려운 용어는 풀어 설명. 비유 활용." |
| `intermediate` ("중급") | "사용자는 기본 개념 익숙. 핵심만 간결히. 코드/수식 자유." |
| `advanced` ("고급") | "사용자는 전문가. 세부 기술 / 한계 / trade-off 명시." |
| `NULL` ("미설정") | 분기 없음 (디폴트 톤) |

### 10.4.2 자동 수준 추정 (R3-B, Phase 2)

[§16 로드맵](./16_roadmap.md) Phase 2 — UserLevelEstimator 메타 학습 기반 자동 추정. Phase 1 시점 mock (회귀 셋 통과만).

### 10.4.3 시스템 prompt 구조

```
[SYSTEM]
당신은 FlowBrowser AI 의 워크스페이스 채팅 어시스턴트.
현재 워크스페이스: {workspace.name} ({workspace.icon})
{level_prompt_branch}

{retrieved_items_context}
  — Page 1: {title} ({url}, visited {N}일 전)
  — Page 2: ...
  — Note 1: {selected_text + body}

응답 형식:
1. 본문은 Markdown.
2. 비교·종합 질의 시 chat_meta JSON 블록 추가.
3. 출처는 위 retrieved_items 만 사용.

[USER]
{user_content}
```

## 10.5 재시도 (chat:retry)

[§07 §7.4.4 chat:retry 동작](./07_ui_layout.md#744-chatpanel-m5-translationpanel-대체) 정합.

### 10.5.1 트리거

`status='failed'` 메시지에 "재시도" 버튼 → Renderer 가 `chat:retry` IPC 호출:

```typescript
chat:retry({
  failed_assistant_message_id: string,
  retry_strategy: 'reuse_prompt' | 'edit_prompt'
})
```

### 10.5.2 동작

| strategy | 동작 |
|---|---|
| `reuse_prompt` (디폴트) | 기존 user prompt 재사용. **신규 assistant row INSERT** (기존 failed/error row 보존, role='assistant', status='pending' → ok/failed). retrieved_items 재계산 옵션. PR b6.1 정정 — 기존 row UPDATE는 감사 추적 위험. |
| `edit_prompt` | 기존 user prompt 편집 가능 — **신규 user row INSERT** (기존 user row 보존 + revision_of 필드로 chain). 새 assistant row INSERT. 대화 history 에 모든 revision 표시. |

### 10.5.3 재시도 횟수 임계

- 동일 user prompt 재시도 5회 → 자동 차단 (Provider 비용 보호)
- 임계 도달 시 [§17 Known Issue](./17_known_issues_policy.md) HIGH 등록 + 사용자 알림

## 10.6 streaming (SSE)

streaming 정책은 Provider 별로 분리 (PR b6.1 정정):

- **Codex OAuth (gpt-5.5)**: `src/ai/codex/SseStreamParser.ts` 재활용 — Codex Responses API `response.output_text.delta` / `response.output_text.completed` 이벤트 파싱
- **OpenAI API Key (gpt-4o-mini)**: 별도 SSE 파서 도입 — `chat/completions` SSE 스트림 `data: {"choices":[{"delta":{...}}]}` 형식. PR b6 표기 "SseStreamParser 재활용"은 부정확 정정 (실제 OpenAIApiKeyProvider 는 현재 `stream:false` fetch — M5 SDK 도입 또는 fetch SSE 파서 신규 작성). M5 PoC 시 결정 (OpenAI Node SDK 도입 또는 fetch + 신규 SSE 파서)

### 10.6.1 streaming 정책

- 응답 시작 후 chunk 단위 (보통 5~50ms 간격) UI 갱신
- Markdown 부분 파싱 (incremental render)
- JSON 메타 블록은 응답 완료 후 일괄 파싱 (chunk 단위 JSON 파싱 X)

### 10.6.2 streaming 취소

사용자가 ChatPanel "취소" 버튼 클릭 → `chat:abort` IPC → fetch AbortController 호출 → AiChatHistory.status='aborted' 마킹 (§04 §4.3.5 enum 'aborted' 추가, PR b6.1).

`chat:abort` IPC 는 [§05 §5.3.1](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개) chat 그룹 4개 (request/retry/history/clear) 외 **5번째 chat:abort 추가** (PR b6.1 — 신규 IPC 총 24개 → 25개 정정 동반).

### 10.6.3 multi-turn 대화 컨텍스트

Phase 1 정책 (PR b6.1 신규):
- **이전 대화 turn 누적**: 같은 워크스페이스의 최근 N=5 turn (user+assistant 쌍) 을 PromptComposer 컨텍스트에 자동 주입
- **토큰 한도 관리**: 5 turn 누적이 8k tokens 초과 시 가장 오래된 turn 부터 제거 (sliding window)
- **새 세션 명시**: 사용자가 "새 채팅" 버튼 클릭 시 다음 chat:request 부터 turn 누적 리셋
- Phase 2+: 요약 기반 압축 (긴 대화 자동 요약 + 요약 turn 으로 대체)

### 10.6.4 streaming 도중 추가 메시지 입력

- **차단**: streaming 응답 도중 사용자가 새 메시지 입력 → ChatPanel 인풋 disable + "응답 완료 후 입력 가능" 표시
- **사용자 명시 abort**: "응답 중단 후 새 질문" 버튼 → chat:abort → 인풋 활성화
- **큐잉 X** (Phase 1): 자동 큐잉은 응답 우선순위·취소·재시도 복잡도 큼. Phase 2+ 옵션

## 10.7 Provider 선택 (사용자 능동 호출)

[§01 §1.4.2](./01_overview.md#142-동작-원칙) BYOK vs 능동 호출 구별.

| 호출 종류 | Provider 디폴트 | 사용자 변경 |
|---|---|---|
| 자동 인덱싱·임베딩 (§08) | **BYOK (API Key)** 디폴트 | Codex OAuth 사용은 사용자 명시 동의 시 (G-003 강화) |
| 자동 태깅 (§08) | **BYOK** 디폴트 | 동상 |
| **사용자 능동 AI 채팅 (본 §10)** | 사용자 선택 (UserSetting.defaultProviderId) | API Key 또는 Codex OAuth 자유 선택. ChatPanel UI 에 현재 Provider 인디케이터 표시 |

### 10.7.1 Provider별 비용·한도

- **OpenAI API Key (BYOK)**: 사용자 직접 결제. Phase 1 **저가 디폴트 모델** `gpt-4o-mini` (input **$0.15/M tokens** / output **$0.60/M tokens**, 2026-05-16 기준 OpenAI 공식 가격). "Phase 1 최신 default" 표현 X — 단순 저가 디폴트, M5 PoC 시 GPT-5 계열 등 최신 모델로 변경 검토
- **Codex OAuth**: ChatGPT 구독 한도 (5h/주) — 사용자 명시 동의 시. gpt-5.5 reasoning low 호출

## 10.8 정량 임계 (Phase 1 종료 evaluator 입력)

v04-direction §12.3 AI 채팅 관련:

| 지표 | 임계 | 측정 방법 (M5 종료) |
|---|---|---|
| AI 응답 출처 정확도 | ≥ 90% | 회귀 셋 30 케이스 — chat_meta.cells 의 sources 가 실제 retrieved_items 내 page_id 와 일치 |

[§18 §F4](./18_evaluation.md) 측정 protocol + KI 등록.

## 10.9 SSOT 인용

- `.flowset/specs/v04-direction.md` §6 (AI 채팅 흐름) + §17 P0-4 (Markdown + JSON 메타) + R3-A (사용자 수준 직접 선택)
- `.flowset/specs/v04-test-classification.md` §E1 S1-C3 / S2-C3 (비교 매트릭스 + 출처 인용 회귀 셋)
- [§04 §4.3.5 AiChatHistory](./04_data_model.md#435-aichathistory-ai-메모)
- [§05 §5.3.1 chat:* IPC](./05_crud_matrix.md#531-phase-1-신규-ipc-m3m6-도입-총-약-24개) + [§05 §5.4.3 RAG 라이프사이클](./05_crud_matrix.md#543-ai-chat-라이프사이클-rag)
- [§07 §7.4.4 ChatPanel UI](./07_ui_layout.md#744-chatpanel-m5-translationpanel-대체)
- [§08 §8.3 EmbeddingClient](./08_indexing.md#83-embeddingclient-byok-openai-text-embedding-3-small)
- [§09 §9.3 retrieval](./09_search.md#93-retrieval--sqlite-vec-top-k)

본 §10 와 SSOT 충돌 시 SSOT 우선 (G-012).

## 10.10 변경 이력

- 2026-05-16 (PR b6): stub → 본문 작성. 채팅 파이프라인 9 step (3 TX 분리 + Provider 호출 TX 외부) + retrieval 정책 (top-k=5 + page_id 옵션) + Markdown + JSON 메타 chat_meta schema 정확 형식 + PromptComposer 사용자 수준 4분기 (R3-A) + chat:retry 2 strategy (reuse_prompt / edit_prompt) + 5회 임계 + SSE streaming + Provider 선택 (BYOK 자동 vs 능동 자유) + 모델·비용 추정 + 정량 임계 (출처 정확도 ≥ 90%).
- 2026-05-16 (PR b6.1): codex·evaluator 핫픽스. (1) **sources 형식 §04 통일** — `{type, id, page_id?, visit_id?}`. (2) **SseStreamParser Provider 분리** — Codex 재활용 / OpenAI Chat Completions 별도 SSE 파서 (M5 PoC). (3) **Structured Outputs API** 권고 (system prompt 강제 fallback). (4) **gpt-4o-mini input/output 분리** ($0.15 / $0.60 per 1M). (5) **top-k 5 → 5/10/15 adaptive** (능동 호출 시 increase). (6) **chat:retry 정책 정정** — UPDATE 아닌 신규 INSERT (감사 추적, revision_of chain). (7) **chat:abort §05 IPC 추가** (chat 그룹 5번째). (8) **multi-turn 5 turn sliding window** + 토큰 초과 시 oldest 제거. (9) **streaming 도중 추가 메시지 차단** (Phase 1).
