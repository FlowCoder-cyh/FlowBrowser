> [← PRD 목차](./README.md)

# 0. 문서 목적 및 변경 이력

## 0.1 문서 목적

이 문서는 **AI 네이티브 브라우저 / 콘텐츠 번역·더빙 브라우저** 아이디어를 제품 기획 수준으로 정리한 PRD다.
핵심 목적은 기존 크롬/엣지 위에 AI를 얹는 방식이 아니라, 처음부터 AI 접목을 전제로 한 브라우저형 제품을 설계하는 것이다.

## 0.3 v0.3 변경 이력 (2026-05-11) — Phase 0 1차 조사 반영

Phase 0 치명 가설 5종 (Codex 인증 / YouTube 자막·제어 / 시스템 오디오 캡처 / TTS 3축 / 사용자 인터뷰) 1차 조사 결과를 PRD에 반영. **5개 모두 차단 사유 없음 = Phase 0 게이트 통과 가능**.

v0.2 대비 주요 변경:

1. **§1.5**: macOS 12 이하 비지원 명시 (Spike 3)
2. **§7.2**: MVP 2 범위 보강 — "공개 + 자막 있는 + 임베드 허용 + 비-DRM" (Spike 2)
3. **§9.3**: 자막 추출 방식 명시 — caption track URL fetch + 비공식 transcript 라이브러리 (회색지대 인지, G-011)
4. **§9.4**: TTS Provider 3종 명시 (OpenAI gpt-4o-mini-tts / ElevenLabs Flash v2.5 / Kokoro-82M). STT P3 비고 — "Spike 3 가용성 검증 완료, STT API 선정 Phase 5 별도"
5. **§11.1**: Subtitle Extractor 구현 (postMessage IFrame API + caption track URL fetch). Audio Capture 구현 (desktopCapturer + getDisplayMedia / electron-audio-loopback)
6. **§11.2**: ElevenLabsProvider 명시, ~~Coqui XTTS-v2~~ → Kokoro-82M 교체 (라이선스 + Coqui AI 회사 폐업)
7. **§11.3**: Codex Login Provider — "Phase 0 Spike 1 1차 조사 통과, Experimental 활성화" (공식 등록 부재 명시)
8. **§14.2**: 임계값(0.9배 / 0.75~0.85배 / 4초) 유지 + Phase 1 PoC 캘리브레이션 명시
9. **§15.2**: ElevenLabs P2 유지 (PRD 본문과 일치 확인). 로컬 모델 = Kokoro-82M 명시
10. **§15.3**: G-011 인용 추가 — "공개 endpoint 회색지대 허용 / 자격증명 우회 절대 금지"
11. **§16**: Phase 0 종료 선언. Phase 5 STT 진행 가능 (Spike 3 통과)
12. **§18.1**: Codex 클라이언트 ID 무효화로 즉시 정지 가능 → 폴백 즉시 동작 필수
13. **§18.4**: TTS 비용 시뮬레이션 갱신 — gpt-4o-mini-tts 기준 1시간 영상 = $0.90 (캐시 365일 재방문 시 0)
14. **§18.5**: 광고 fallback / DRM 영구 제외 명시 (Spike 2)
15. **§19.2 / §19.4 / §19.6**: 구현 태스크 보강 — Subtitle Extractor / STT Engine (Phase 5) / Electron 버전 고정

이 변경은 5개 Spike spec + 4개 evaluator + Phase 0 종합 보고 (`.flowset/specs/phase0-summary.md`)를 입력으로 작성됨.

## 0.2 v0.2 변경 이력 (2026-05-11)

v0.1 대비 주요 변경:

1. **Phase 0 전면 교체**: 개발 셸 착수 → 치명 가설 5종 Spike (16장)
2. **Codex Login Provider 격하**: 확정 메인 Provider → Phase 0 검증 통과 시에만 활성화 (11.3 / 15.3)
3. **MVP 2 범위 한정**: "자막 접근 가능한 YouTube 영상"으로 명시 (7.2)
4. **Privacy Filter 신설**: 정책 → P0 기능 모듈로 격상 (9.6 / 11장 / 10.3)
5. **15.3 금지 강화**: ChatGPT 웹 세션/쿠키 재사용 명시 금지
6. **데이터 모델 보강**: UsageLog 스키마(12.8), TranslationCache 키/TTL(12.4), ProviderCredential OS Keychain 위임(12.2), SubtitleSegment.sourceType(12.6)
7. **신규 섹션**:
   - 1.5 범위 제외 (Linux / 모바일)
   - 5.4 경쟁 제품 분석
   - 8.0 온보딩 시나리오 (샘플 모드 포함)
   - 19.6 운영 인프라

이 변경은 GPT/Claude 교차 검토 결과 합의 사항을 반영한 것이며, Phase 0 Spike 결과에 따라 v0.3에서 추가 조정될 수 있다.
