# Phase 0 — 종합 보고 (5개 Spike 1차 조사)

> **상태: Phase 0 1차 조사 종료 / Phase 1 진입 결정 대기**
> 작성: 2026-05-11
> 입력: 5개 Spike spec + 4개 evaluator 결과
> 출력: PRD v0.3 영향 매트릭스 + Phase 1 진입 결정 항목

## 0. 요약

Phase 0 치명 가설 5종(Codex 인증 / YouTube 자막·제어 / 시스템 오디오 캡처 / TTS 3축 / 사용자 인터뷰)에 대해 정책·스펙 조사 및 가이드 작성을 완료. **5개 모두 차단 사유 없음 = Phase 0 게이트 통과 가능**.

단, 일부는 Phase 1 PoC에서 실 코드 검증 필요. 본 보고는 1차 정책·스펙 조사의 종합으로, **실 환경 측정·인터뷰 결과·실 음성 비교 등은 본 단계의 범위가 아님**.

## 1. Spike 결과 종합

| # | Spike | 1차 판정 | evaluator | 핵심 결론 |
|---|---|---|---|---|
| 1 | Codex/ChatGPT 인증 | **Pass with conditions** | (미실행) | 공개 Codex OAuth client(`app_EMoa...`) 재사용, OpenClaw·Roo Code 패턴. Experimental 라벨, 공식 등록 없음. |
| 2 | YouTube 자막/제어 | **Pass with conditions** | 5/2/0 | IFrame Player API 모든 핵심 동작 ✓. 자막은 caption track URL 직접 fetch (회색지대, Spike 1과 동일 패턴). |
| 3 | 시스템 오디오 캡처 | **Pass with conditions** | 6/1/0 | Win 10+ / macOS 13+ 추가 설치 불필요. Phase 5 STT 진행 가능. Electron 40.1.0 회귀 회피 권장. |
| 4 | TTS 3축 | **Pass with conditions** | 4/3/0 | 4개 Provider 모두 PRD 14.2 임계와 양립. Coqui→Kokoro 교체 (라이선스/회사 폐업). MVP 기본=OpenAI gpt-4o-mini-tts. |
| 5 | 사용자 인터뷰 | **Pass** | 7/0/0 | 가이드 풀 보강 완료. 실제 인터뷰는 사용자 진행. |

**Phase 0 게이트 통과 가능** = 5개 모두 Pass 또는 Pass with conditions, 차단 사유 없음.

## 2. 회색지대 패턴 (Spike 1·2 일관성)

Spike 1과 Spike 2가 동일한 회색지대 패턴을 보임:

| 차원 | Spike 1 (Codex) | Spike 2 (YouTube) |
|---|---|---|
| 공식 등록 | 부재 (3rd-party 앱 등록 경로 없음) | 부재 (3rd-party 영상 자막 다운로드 안 됨) |
| 공개 endpoint | `app_EMoa…` 클라이언트 ID + `/deviceauth/...` | caption track URL `timedtext.googlevideo.com` |
| 사용자 자격증명 우회 | **금지** (G-003) | **금지** (G-003) — 쿠키/세션 우회 안 함 |
| 표준 OAuth/HTTP 흐름 | 사용 (PKCE) | 사용 (공개 fetch) |
| 다른 3rd-party 사례 | OpenClaw, Roo Code | youtube-transcript-api 라이브러리 |
| 명시적 차단 | 없음 (OpenAI) | 없음 (Google) |

**가드레일 G-011 권고**: "공개 endpoint 재사용은 회색지대 허용 / 사용자 자격증명 우회·쿠키 추출·세션 모방은 절대 금지" — 명문화 권고.

## 3. PRD v0.3 영향 매트릭스

5개 Spike 결과를 PRD v0.2에 반영하기 위한 변경 항목.

### 3.1 PRD §1.5 범위 제외
- 변경: 없음 (현재 정의 유지)
- 보강 가능: macOS 12 이하 비지원 명시 (Spike 3 결과)

### 3.2 PRD §4 핵심 가설
- 4.1 / 4.3은 Spike 5 인터뷰 결과 후 검증 → **실 인터뷰 진행 후 갱신**

### 3.3 PRD §7.2 MVP 2 범위
- "자막 접근 가능한 YouTube 영상에 한정" → **유지 + 보강**: "공개 + 자막 있는 (수동/자동) + 임베드 허용 + 비-DRM" (Spike 2)
- "자막 없는 영상은 Phase 5의 STT" → **STT 가용성 검증 완료** (Spike 3)

### 3.4 PRD §9.3 YouTube/영상 기능
- "자막 추출" 항목에 **"caption track URL 직접 fetch + 비공식 transcript 라이브러리 (회색지대 인지)"** 명시 (Spike 2)

### 3.5 PRD §9.4 AI 싱크 더빙 / TTS / STT
- TTS 생성: **Provider 3종 명시** (OpenAI gpt-4o-mini-tts / ElevenLabs Flash v2.5 / Kokoro-82M) — Spike 4
- STT 처리 (P3): "Spike 3 가용성 검증 완료, STT API 선정은 Phase 5 별도 작업" (Spike 3)

### 3.6 PRD §11.1 아키텍처
- **Subtitle Extractor**: 구현 = postMessage IFrame API + caption track URL fetch (Spike 2)
- **Audio Capture**: 구현 = `desktopCapturer` + `getDisplayMedia` 또는 `electron-audio-loopback` (Spike 3)

### 3.7 PRD §11.2 Provider Adapter
- **ElevenLabsProvider** 명시 (Spike 4)
- **`~~Coqui XTTS-v2~~` → Kokoro-82M** 교체 (Spike 4)

### 3.8 PRD §11.3 Provider 전략
- "Spike 1 검증을 통과한 경우에만 활성화" → **"Spike 1 1차 조사 통과, Experimental 활성화"** (Spike 1)
- 보강: "공식 등록 부재, 공개 Codex 클라이언트 재사용, OpenAI 차단 시 즉시 폴백" (Spike 1)

### 3.9 PRD §14.2 싱크 제어 정책
- 임계값(0.9배 / 0.75~0.85배 / 4초) 유지
- **"Phase 1 PoC에서 실측 후 캘리브레이션"** 명시 (Spike 4)

### 3.10 PRD §14.3 TTS 번역 정책
- 변경 없음 (Phase 1 PoC 검증 항목으로 이관됨)

### 3.11 PRD §15.2 Provider 전략표
- ElevenLabs **P2 유지** (Spike 4 evaluator 지적, 정합)
- 로컬 모델: **Kokoro-82M** 명시 (P3)
- ~~Coqui~~ 제거

### 3.12 PRD §15.3 금지 전략
- 기존 항목 유지
- 보강: "공개 Codex OAuth 클라이언트 재사용 + caption track URL fetch는 회색지대 허용. 단, 사용자 자격증명 우회·쿠키 추출·세션 모방은 절대 금지" (Spike 1·2)

### 3.13 PRD §16 Phase 0 / Phase 5
- Phase 0 결과 명시: "5개 Spike 모두 1차 조사 완료, 차단 사유 없음" → **PRD v0.3에서 Phase 0 종료 선언**
- Phase 5 STT: "Spike 3 통과 시" → **"Spike 3 통과 — Phase 5 진행 가능, STT API 선정 별도"**

### 3.14 PRD §17 성공 지표
- 변경 없음 (실측 없음)
- Phase 1 진입 시 베이스라인 측정으로 갱신

### 3.15 PRD §18.1 Codex 토큰 정책 리스크
- "공식 등록 부재 → OpenAI 측 단순 차단(클라이언트 ID 무효화)으로 즉시 정지 가능. 폴백 즉시 동작 필수" (Spike 1)

### 3.16 PRD §18.4 AI 비용 리스크
- TTS 비용 시뮬레이션: **gpt-4o-mini-tts 기준 1시간 영상 = 60분 × $0.015 = $0.90**, 캐시 365일로 재방문 시 0 (Spike 4)

### 3.17 PRD §18.5 사이트 호환성 리스크
- "광고 fallback / DRM 영구 제외" 명시 (Spike 2)

### 3.18 PRD §19 개발 태스크
- 19.2 Subtitle Extractor: caption track URL fetch 추가
- 19.4 STT Engine: "Phase 5에서 진행 (STT API 선정 별도)"
- 19.6 운영 인프라: Electron 버전 고정 정책 (40.1.0 회귀 회피) 보강 권장

### 3.19 신규 / 보강 항목

- **가드레일 G-011 신규** (또는 G-003 보강): 회색지대 패턴 통합 명문화 — Spike 1·2 evaluator 권고

## 4. Phase 0 → Phase 1 전환 결정 항목

Phase 1 (웹 번역 MVP) 진입을 위해 사용자가 결정해야 할 항목:

### 4.1 PRD v0.3 발행
- **(a) 즉시 발행** — 본 보고서를 입력으로 PRD v0.2 → v0.3 갱신, Phase 0 종료 선언
- **(b) 인터뷰 결과까지 기다림** — Spike 5 실제 인터뷰 (5~10명) 결과 반영 후 v0.3 발행
- 권장: **(a)** — 인터뷰는 별도 v0.3.1 패치로 가능, Phase 1 진입 차단할 필요 없음

### 4.2 가드레일 G-011
- **(a) 신규 추가** — Spike 1·2 회색지대 패턴 명문화
- **(b) G-003 보강** — 기존 G-003에 회색지대 허용 항목 추가
- **(c) 보류** — 누적 후 정리
- 권장: **(a)** — 명확한 별도 항목

### 4.3 Spike 1 evaluator 호출
- **(a) 호출** — Spike 2~5와 일관성 위해 사후 평가
- **(b) 생략** — 이미 머지됨, 사용자 검토로 갈음
- 권장: **(a)** — 5개 Spike 모두 동일 evaluator 통과 기록 유지

### 4.4 Phase 1 Sprint-001 정의
- 첫 Sprint 범위 결정 (예: Privacy Filter + DOM Extractor + 선택 영역 번역 + OpenAI API Key Provider)
- `.flowset/contracts/sprint-001.md` 작성
- `.flowset/ownership.json` 작성
- Phase 1 활성: `lead-workflow.md` 워크플로우, CI lint+test, Stop hooks B1 등

### 4.5 사용자 직접 작업 (Spike 5 인터뷰)
- Google Form 생성 + 발송
- 시연 영상 2개 제작 (TTS Provider = OpenAI gpt-4o-mini-tts 또는 ElevenLabs Flash v2.5)
- 인터뷰 5~10명 진행
- 결과를 spec에 추가 + evaluator 재호출
- PRD §4.1 / §4.3 / §5.3 / §7.3 / §15.4 / §17.3 갱신

## 5. Phase 1 진입 권장 흐름

```
[현재] Phase 0 1차 조사 완료
  ↓
[1] PRD v0.3 발행 (본 보고서 입력)
  ↓
[2] 가드레일 G-011 추가 (Spike 1·2 회색지대 패턴 명문화)
  ↓
[3] Spike 1 evaluator 사후 평가 (선택)
  ↓
[4] sprint-001.md / ownership.json 작성
  ↓
[5] Phase 1 활성: lead-workflow / CI / Stop hooks
  ↓
[Phase 1] 웹 번역 MVP 코드 착수
  ↓ (병렬)
[사용자 작업] Spike 5 인터뷰 진행 → 결과 반영
```

## 6. Phase 1 PoC 이관 항목 종합 (총 22개 + 사용자 직접 작업)

본 Phase 0 1차 조사에서 실 코드/측정으로 검증해야 할 항목 모음 (Phase 1 sprint 계약 입력).
합산 기준: Spike 1·2·3·4의 PoC 이관 항목만 (4+6+6+6=22). Spike 5는 사용자 직접 작업으로 별도 분류.

### Spike 1 (Codex 인증) — 4개
1. ChatGPT Plus 사용자가 본 앱 사용 시 비용/한도 처리 (LumaDock 주장 검증)
2. OpenAI 측 임의 차단 시그널
3. 모델 가용성 차이 (Codex Login vs API Key)
4. Refresh token 만료 정책

### Spike 2 (YouTube) — 6개
1. Electron BrowserView 안에서 IFrame API postMessage 작동
2. caption track URL fetch 응답 안정성
3. 광고 구간 playbackRate 무력화 빈도
4. 연령 제한 영상 인증 흐름
5. 임베디드 환경 동작 매트릭스
6. 자동 vs 수동 자막 품질 차이

### Spike 3 (오디오 캡처) — 6개
1. desktopCapturer + getDisplayMedia 정상 작동 (Win/macOS)
2. electron-audio-loopback 1시간 누수
3. macOS 화면 녹화 권한 안내 UX
4. Electron 40.1.0 회귀 영향
5. 캡처 → STT 호출 지연
6. 시스템 오디오 + 마이크 동시 캡처

### Spike 4 (TTS) — 6개
1. 한국어 5명 블라인드 평가 (OpenAI vs ElevenLabs vs Kokoro)
2. TTS/원본 길이 비율 측정
3. 동시 다중 요청 처리 한계 (rate limit 실측)
4. Kokoro 한국어 voice 실확인 (VOICES.md)
5. Kokoro 로컬 실행 환경 정의 (RAM/VRAM/CPU)
6. TTS용 vs 자막용 번역 분리 효과

### Spike 5 (인터뷰) — 사용자 직접 작업 7단계 (PoC 합산 외)
1. 모집 채널 발송
2. Google Form 생성·운영
3. 시연 영상 2개 제작 (TTS Provider 결정 후)
4. 인터뷰 5~10명 진행
5. 응답 정리 (Google Sheets)
6. spec 결과 섹션 채움
7. evaluator 재호출 (`spike-05-results-{date}.md`)

## 7. 운영 결정 변경 (Phase 0 진행 중 발생)

- `.gitignore` 정책 변경: `.flowset/eval-results/` git 추적 (PR 검토·감사 로그) — Spike 4 진행 중 결정
- `.github/workflows/commit-check.yml` 머지 커밋 제외 (`--no-merges`) — Spike 1 PR #1 CI 실패로 발견
- 저장소 설정: `allow_auto_merge=true`, `delete_branch_on_merge=true` — 자율 진행 흐름 단축

## 8. 가드레일 변경 권고

### G-011 (신규 권고)

```markdown
### G-011 [draft] 공개 endpoint 회색지대 허용

- **규칙**: 다음은 허용한다.
  - 공개 OAuth 클라이언트 ID 재사용 (Codex `app_EMoa…` 등 다수 3rd-party가 사용)
  - 공개 caption track URL 직접 fetch (`timedtext.googlevideo.com` 등)
  - 비공식 transcript 라이브러리 (youtube-transcript-api 등)
- **금지**: 다음은 G-003에 따라 절대 금지.
  - ChatGPT 웹 세션 / 쿠키 재사용
  - 사용자 자격증명 / 세션 모방
  - 비공식 토큰 추출 (Codex CLI 인증 우회 등)
  - 사용량 한도 우회
- **Why**: Spike 1·2 결과 — 공개 endpoint 재사용은 다수 사례 (OpenClaw, Roo Code, 등)와 함께 OpenAI/Google 모두 명시 차단 안 함. 회색지대지만 사실상 묵인 패턴.
- **How to apply**: 코드 작성 시 "공개" 여부 명확히 구분. 사용자 자격증명을 다루는 코드 발견 시 즉시 차단.
```

## 9. 산출물 목록

### Phase 0 산출물 (git history)

| 산출물 | 위치 | 머지 |
|---|---|---|
| FlowSet v4.0.4 셋업 | 루트 / `.flowset/` / `.claude/` / `.github/` | `b97e748` (셋업 커밋, main 직접) |
| Spike 1 spec | `.flowset/specs/spike-01-codex-auth.md` | PR #1 (`d5459c6`) |
| Spike 4 spec + eval | `.flowset/specs/spike-04-tts-3axis.md`, `.flowset/eval-results/spike-04-2026-05-11.md` | PR #2 (`1db16b4`) |
| Spike 5 spec + eval | `.flowset/specs/spike-05-user-interview.md`, `.flowset/eval-results/spike-05-2026-05-11.md` | PR #3 (`cea9c0f`) |
| Spike 2 spec + eval | `.flowset/specs/spike-02-youtube.md`, `.flowset/eval-results/spike-02-2026-05-11.md` | PR #4 (`82886f8`) |
| Spike 3 spec + eval | `.flowset/specs/spike-03-audio-capture.md`, `.flowset/eval-results/spike-03-2026-05-11.md` | PR #5 (`7a3da83`) |
| Phase 0 종합 보고 (본 파일) | `.flowset/specs/phase0-summary.md` | PR (진행 중) |

### Phase 0 결정 / 변경

- **PROJECT_CLASS = hybrid** 확정
- **Codex Login Provider Experimental 라벨로 유지** (Spike 1)
- **Coqui XTTS-v2 → Kokoro-82M 교체** (Spike 4 / 라이선스 + 회사 폐업)
- **MVP 기본 TTS = OpenAI gpt-4o-mini-tts** 잠정 결정 (Spike 4)
- **Electron 40.1.0 회귀 회피** 운영 정책 (Spike 3)
- **macOS 12 이하 비지원** 권장 (Spike 3)
- **`.gitignore` eval-results 추적** 결정

## 10. 사용자에게 보고할 핵심

1. **5개 Spike 모두 차단 사유 없음** — Phase 0 게이트 통과 가능
2. **Phase 1 진입 가능** — 단, 4.1~4.5 결정 항목 5개 처리 후
3. **PRD v0.3 발행 권장** — 본 보고서 입력
4. **사용자 직접 작업 = Spike 5 인터뷰** — Phase 1 코드 진행과 병렬 가능
5. **가드레일 G-011 추가 권장** — 회색지대 패턴 명문화

## 변경 이력

- 2026-05-11: 5개 Spike 1차 조사 종료 후 종합 보고 v1 작성
