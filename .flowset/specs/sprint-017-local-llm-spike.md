# Sprint 017 M3 Spike — 로컬 LLM / 임베딩 통합

> Phase 3 진입 spike 산출물. T14 (Ollama provider, 본 PR 박힘) + T15 (sentence-transformers, spec only) 종합.
> 작성: 2026-05-22 (Sprint 017 M3 T14/T15 동반)

## 1. 목표

PRD §15.2 정합 — BYOK 옵션 외에 **로컬 실행** (offline + 비용 0) provider 추가. 사용자가 OpenAI API Key 부재 시 또는 privacy 요구 시 로컬 모델로 chat + embedding 수행.

## 2. T14 — Ollama provider (구현 완료)

### 2.1 산출물

- `src/ai/providers/OllamaProvider.ts` — `ProviderAdapter` 인터페이스 구현 (`providerType='local'`, `supportsChat=true`, `supportsEmbed=false`)
- raw `fetch` + `fetchImpl` 주입 패턴 (codex 019e500b Q1 권고 — npm 의존성 회피)
- REST endpoint — `/api/chat` (POST, non-streaming). `/api/tags` 로 validate.
- 디폴트 모델 `llama3.2:3b` (작고 빠름). available: `llama3.1:8b` / `qwen2.5:7b` / `mistral:7b`.
- responseFormat='json_object' → Ollama `format='json'` 매핑.
- 비용 0 + 토큰은 `prompt_eval_count` / `eval_count` 매핑.

### 2.2 미포함 (의도적)

- **embed()** — T15 sentence-transformers 통합 spec 종합 결정 후. 현재는 `ProviderError('unsupported')` throw.
- **chatStream()** — Ollama NDJSON 지원하나 본 spike scope 외. M4 또는 M5 ChatService 분기 시점 결정.
- **`ollama` npm package** — 도입 안 함. raw fetch + fetchImpl 주입이 기존 provider 패턴 정합.

### 2.3 사용자 사전 조건

- Ollama 데스크탑 앱 설치 (https://ollama.com/download)
- `ollama pull llama3.2:3b` (또는 다른 모델) — 사용자 책임
- 디폴트 endpoint `http://localhost:11434` 도달성

### 2.4 통합 시점 (T16)

`UserSetting.providerPreference: 'ollama'` 옵션 추가 + ChatService 분기 — 별도 PR (사용자 승인 후).
ChatService 호출 path 가 provider 추상화돼 있어 wiring 자체 변경량 적음 — 1~2 시간 내외 추정.

## 3. T15 — sentence-transformers 로컬 임베딩 (spec only)

### 3.1 의사결정 매트릭스

세 옵션 비교 (codex 019e500b 동반 정합):

| 옵션 | dependency | dimension | 비용 | 지연 | 메모리 | 호환성 |
|---|---|---|---|---|---|---|
| **A. Ollama `nomic-embed-text`** | (이미 박힘) | 768 | 0 | ~50ms/100tok | ~1GB | T14 와 동일 endpoint, embed REST `/api/embed` |
| **B. Python sidecar (`sentence-transformers`)** | Python 3.10+ + subprocess + JSON-RPC | 384 (`all-MiniLM-L6-v2`) ~ 768 (`all-mpnet-base-v2`) | 0 | ~30ms/100tok | ~500MB~1.5GB | Electron-shell 외부 process 관리 부담 (start/stop/health-check) |
| **C. `onnxruntime-node` + ONNX 모델** | `onnxruntime-node` npm + 모델 파일 (~200MB) | 384 (`all-MiniLM-L6-v2`) | 0 | ~40ms/100tok | ~600MB | Electron 안에서 직접 실행, native 의존성 (sqlite-vec 와 비슷) |

### 3.2 권고

**옵션 A (Ollama `nomic-embed-text`) 우선 통합 권고.**

근거:
1. T14 가 이미 박은 endpoint 재사용 — dependency 추가 0.
2. Python sidecar 의 process lifecycle 관리 부담 (start/stop/zombie 차단) 회피.
3. `onnxruntime-node` 는 native binary — sqlite-vec 처럼 OS 별 PoC (KI-001 과 유사한 matrix CI 부담) 필요.

### 3.3 BLOCKER — embedding space 분리 정책

OpenAI `text-embedding-3-small` (1024 dim) 와 Ollama `nomic-embed-text` (768 dim) 는 **dimension + semantic space 모두 다름**. 같은 `vec_pages` 테이블에 박을 수 없음 (sqlite-vec 의 `vec_pages.embedding float[1024]` 고정).

해소 옵션 3종:

#### B1. Schema v06 — `embedding_space_id` 컬럼 도입

- `vec_pages` / `vec_notes` 에 `embedding_space_id TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small:1024'` 추가
- query 시점에 `WHERE embedding_space_id = ?` 박음
- 한 워크스페이스 안 여러 space 공존 가능 (점진 마이그레이션 지원)
- **단점**: sqlite-vec 의 vec0 가 dimension 고정이라 다중 space 박으려면 `vec_pages_768` 같은 별도 vec0 table 도 필요

#### B2. Schema v06 — 별도 vec0 table per dimension

- `vec_pages_1024` (OpenAI) + `vec_pages_768` (nomic-embed-text) 분리
- IndexingService 가 provider 별 분기 INSERT
- SearchService 가 active embedding model 의 table 만 query
- **단점**: 같은 워크스페이스에서 한 space 만 가능 (이전 데이터 무효화 또는 재계산 필요)

#### B3. 워크스페이스 별 embedding model 고정

- `Workspace.embedding_model TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small'` 추가
- 워크스페이스 생성 시 모델 선택 + 변경 불가 (또는 변경 시 전체 재계산)
- 마이그레이션 단순 (기존 데이터 그대로, 새 워크스페이스부터 선택)
- **단점**: 사용자가 mid-stream 으로 provider 전환 시 새 워크스페이스 생성 필요

**권고: B3 + B2 조합.** Workspace.embedding_model 박고 dimension 별 vec0 table — 가장 격리 강력 + migration 단순.

### 3.4 진입 조건

T16 (Ollama chat 통합) 박은 후 + 사용자 별도 승인 후 B 옵션 결정 + Schema v06 마이그레이션 (G-014 dry-run + 자동 백업 강제) 진행.

본 spec 박은 시점에는 T17 (로컬 임베딩 통합) 자체는 **Sprint 018+ 위임** 권고.

## 4. Dependency 추가 정책 (G-020 후보)

본 spike 의 학습:
- npm package 추가 시 **별도 사용자 승인 + 패키지 검증** (audit / 라이선스 / 유지보수)
- 본 PR (T14) 은 raw fetch 로 dep 추가 0 — 가장 보수적 선택
- Python sidecar / native binary 도입 시 OS 별 PoC + CI matrix 부담 명시 필수

→ **G-020 정식화** — Sprint 017 M5 T25 종합 evaluator 시점에 박음 권고.

## 5. 후속 작업

| 작업 | 진입 시점 |
|---|---|
| T16 — Ollama chat 통합 (`UserSetting.providerPreference: 'ollama'` + ChatService 분기) | 사용자 별도 승인 후 |
| T17 — 로컬 임베딩 통합 | Sprint 018+ (B 옵션 결정 후) |
| Schema v06 — `Workspace.embedding_model` + dimension 별 vec0 table | Sprint 018+ |

## 6. 참조

- Ollama 공식: https://ollama.com/ + https://github.com/ollama/ollama-js
- Ollama API docs: https://docs.ollama.com/api/ + `/api/chat` / `/api/embed`
- sentence-transformers: https://huggingface.co/sentence-transformers
- ONNX runtime node: https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- codex 사전 협의 threadId: 019e500b (T14 7 권고 흡수)
- T14 산출물: `src/ai/providers/OllamaProvider.ts` + `tests/unit/ai/OllamaProvider.test.ts` (22 회귀)

## 7. 변경 이력

- 2026-05-22: Sprint 017 M3 T14 + T15 동반 spec 작성. T14 = 코드 박음 (Ollama provider), T15 = 본 spec 만 (sentence-transformers 옵션 매트릭스 + Schema v06 권고).
