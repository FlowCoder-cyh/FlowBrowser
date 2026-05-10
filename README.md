# FlowBrowser AI

영어 웹과 영상을 한국어로 읽고 듣는 AI 콘텐츠 브라우저.

## 한 줄 정의

**영어 웹사이트와 영상을 한국어로 읽고, 보고, 들을 수 있게 해주는 AI 네이티브 브라우저**

## 현재 상태

**Phase 0 — 치명 가설 검증 Spike 단계**

본격 개발 착수 전에 다음 5종 가설을 검증한다.

1. Codex Login Provider를 정책 위반 없이 쓸 수 있는가
2. YouTube 자막 추출 / 재생 제어가 직접·임베디드 환경에서 안정적인가
3. 시스템 오디오 캡처가 추가 설치 없이 가능한가
4. TTS 품질·지연·비용이 싱크 정책과 양립 가능한가
5. 사용자가 한국어 TTS 더빙을 실제로 선호하며 지불 의사가 있는가

상세는 [PRD 09 로드맵 / Phase 0](./docs/prd/09_roadmap_phase0.md) 참고.

## 문서 구조

```
.
├── README.md                                     # 본 파일
├── CLAUDE.md                                     # Claude Code 프로젝트 지침
├── docs/
│   └── prd/                                      # PRD v0.2 (13개 섹션 파일)
│       └── README.md                             # PRD 목차
├── archive/
│   ├── flowbrowser_ai_prd_crud_v0.1.md           # v0.1 원본
│   └── flowbrowser_ai_prd_crud_v0.2.md           # v0.2 통합본 (인쇄/공유용)
├── .flowset/                                     # FlowSet v4.0.4 운영
│   ├── requirements.md                           # 요구사항 SSOT (PRD 링크)
│   ├── state.md                                  # 현재 Phase / 다음 작업
│   ├── guardrails.md                             # 누적 규칙 (G-NNN)
│   ├── ontology.md                               # 도메인 사전 + 관계
│   ├── PROMPT.md                                 # FlowSet 운영 프롬프트
│   ├── handoffs/                                 # 데일리 핸드오프
│   ├── specs/                                    # Spike 결과 / 기술 스펙
│   ├── eval-results/                             # evaluator 출력 (gitkeep)
│   ├── logs/                                     # 작업 로그 (gitkeep)
│   └── contracts/                                # Sprint 계약 (Phase 1+)
├── .claude/
│   ├── rules/project.md                          # 프로젝트별 규칙
│   ├── agents/
│   │   ├── evaluator.md                          # 평가자 (Phase 0~5 활용)
│   │   └── lead-workflow.md                      # 6단계 리드 (Phase 1+)
│   └── settings.json                             # SessionStart hook
└── .github/
    ├── workflows/
    │   ├── ci.yml                                # placeholder (Phase 1+ 활성)
    │   └── commit-check.yml                      # 커밋 형식 검증 (즉시 활성)
    └── PULL_REQUEST_TEMPLATE.md
```

## PRD 진입점

- [PRD 목차](./docs/prd/README.md)
- [최종 요약](./docs/prd/12_summary.md)
- [Phase 0 Spike 계획](./docs/prd/09_roadmap_phase0.md)
- [v0.2 변경 이력](./docs/prd/00_change_history.md)

## FlowSet 진입점

- [현재 상태](./.flowset/state.md)
- [요구사항 SSOT](./.flowset/requirements.md)
- [가드레일 (누적 규칙)](./.flowset/guardrails.md)
- [도메인 온톨로지](./.flowset/ontology.md)
- [FlowSet 운영 프롬프트](./.flowset/PROMPT.md)
- [최신 핸드오프](./.flowset/handoffs/2026-05-11.md)
- [Spike 1~5 placeholder](./.flowset/specs/)

## 프로젝트 메타

| 항목 | 값 |
|---|---|
| PROJECT_CLASS | hybrid (PRD/문서가 코드만큼 핵심 자산) |
| FlowSet 버전 | v4.0.4 (점진 활성화 적용) |
| 현재 Phase | 0 |
| PRD 버전 | v0.2 (2026-05-11) |
| 지원 OS (MVP) | Windows / macOS |
| 개발 언어 (예정) | TypeScript (Electron) |

## 라이선스 / 기여

(추가 예정)
