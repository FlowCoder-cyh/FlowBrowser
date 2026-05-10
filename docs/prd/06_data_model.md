> [← PRD 목차](./README.md)

# 12. 데이터 모델 초안

## 12.1 UserSetting

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 설정 ID |
| defaultLanguage | string | 기본 번역 대상 언어 |
| sourceLanguage | string | 원문 언어 |
| translationMode | enum | panel / overlay / replace |
| subtitleMode | enum | translated / bilingual / original |
| ttsEnabled | boolean | TTS 사용 여부 |
| syncMode | enum | off / soft / strict |
| defaultProviderId | string | 기본 Provider |
| privacyFilterEnabled | boolean | Privacy Filter 활성 여부 (기본 true) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.2 ProviderCredential (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | Provider Credential ID |
| providerType | enum | codex / openai / claude / gemini / deepl / local |
| displayName | string | 사용자 표시명 |
| authType | enum | oauth / api_key / local |
| keychainRef | string | OS Keychain 항목 식별자 (실제 secret 미보관) |
| status | enum | active / expired / invalid / disabled |
| lastValidatedAt | datetime | 마지막 검증일 |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### 키 관리 방식 (v0.2 결정)

- **secret 자체는 앱이 보관하지 않는다.**
- macOS: Keychain Services
- Windows: DPAPI (Data Protection API)
- 통합 인터페이스: Electron `safeStorage` API
- 앱은 `keychainRef`만 보관, 실제 호출 시 OS에서 secret을 fetch
- 마스터 패스워드 없이도 OS 사용자 세션 보호에 위임

## 12.3 TranslationRequest

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 요청 ID |
| sourceText | text | 원문 |
| sourceLanguage | string | 원문 언어 |
| targetLanguage | string | 번역 언어 |
| context | json | 페이지/영상 문맥 |
| requestType | enum | selection / paragraph / page / subtitle / tts_script |
| providerId | string | 사용 Provider |
| privacyDecision | enum | allowed / blocked / user_approved | (v0.2 신규) |
| status | enum | pending / processing / completed / failed |
| createdAt | datetime | 생성일 |
| completedAt | datetime | 완료일 |

## 12.4 TranslationCache (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 캐시 ID |
| sourceHash | string | 원문 해시 (sha256) |
| sourceText | text | 원문 |
| translatedText | text | 번역문 |
| sourceLanguage | string | 원문 언어 |
| targetLanguage | string | 대상 언어 |
| providerType | string | 사용 Provider |
| glossaryVersion | string | 적용 시 용어집 버전 |
| domain | string | 도메인 |
| hitCount | number | 재사용 횟수 |
| expiresAt | datetime | 만료일 (TTL) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### 조회 키 (v0.2 결정)

복합 unique 키: `(sourceHash, sourceLanguage, targetLanguage, providerType, glossaryVersion)`

### TTL 정책

- 기본 번역 캐시: 90일
- 자막 캐시 (videoSessionId 연결): 365일
- 용량 한도: 사용자 디스크 1GB, 초과 시 LRU 만료
- glossaryVersion 변경 시 해당 용어집 적용 캐시 자동 무효화

## 12.5 VideoSession (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 영상 세션 ID |
| url | string | 영상 URL |
| platform | enum | youtube_direct / youtube_embedded / html5 / other |
| embedHost | string | iframe 임베디드 시 호스트 도메인 |
| title | string | 영상 제목 |
| duration | number | 영상 길이 |
| currentTime | number | 현재 재생 위치 (메모리 상태, 5분/세션종료 시 영속화) |
| subtitleStatus | enum | none / detected / extracted / translated |
| ttsStatus | enum | off / preparing / playing / failed |
| syncStatus | enum | normal / delayed / paused / resyncing |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

### currentTime 영속화 정책

- 메모리 상태로 1초 단위 갱신
- 디스크 영속화는 5분 간격 또는 세션 종료 시
- 디스크 I/O 폭증 방지

## 12.6 SubtitleSegment (v0.2 보강)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 세그먼트 ID |
| videoSessionId | string | 영상 세션 ID |
| startTime | number | 시작 시간 |
| endTime | number | 종료 시간 |
| sourceText | text | 원문 자막 |
| translatedText | text | 번역 자막 |
| sourceType | enum | human / asr / generated (v0.2 신규) |
| ttsAudioPath | string | 생성된 TTS 파일 경로 |
| ttsDuration | number | TTS 길이 |
| status | enum | pending / translated / tts_ready / played / failed |

### sourceType 의미

- `human`: 영상 제작자 또는 사람이 작성한 수동 자막 (품질 신뢰 가능)
- `asr`: YouTube 자동 생성 자막 (품질 가변, 번역 시 보정 필요)
- `generated`: STT로 생성한 자막 (Phase 5)

## 12.7 GlossaryTerm

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 용어 ID |
| sourceTerm | string | 원문 용어 |
| targetTerm | string | 번역 용어 |
| description | text | 설명 |
| domain | string | 적용 도메인 |
| isActive | boolean | 사용 여부 |
| version | string | 용어집 버전 (캐시 무효화 키) |
| createdAt | datetime | 생성일 |
| updatedAt | datetime | 수정일 |

## 12.8 UsageLog (v0.2 신규)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 로그 ID |
| providerId | string | 사용 Provider |
| feature | enum | translation / stt / tts / summary / explanation |
| inputTokens | number | 입력 토큰 |
| outputTokens | number | 출력 토큰 |
| audioSeconds | number | TTS/STT 시 오디오 길이 |
| estimatedCost | decimal | 예상 비용 (Provider 단가 기반 추정) |
| domain | string | 요청 발생 도메인 |
| privacyDecision | enum | allowed / user_approved (blocked는 기록되지 않음) |
| status | enum | success / failed |
| errorCode | string | 실패 코드 |
| createdAt | datetime | 생성일 |

### 활용

- 사용자에게 일/월별 사용량 표시 (9.5)
- BM 설계용 단가/비용 시뮬레이션
- 실패 패턴 분석 (안정성 개선)
- 외부 전송 감사 로그 (10.3)

---

# 13. CRUD 상세 매트릭스

## 13.1 UserSetting CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 기본 설정 생성 | 최초 실행 시 기본값 생성 | 설정 페이지에서 조회 | 언어/표시방식/Provider 변경 | 초기화 가능 | 로컬 저장 |
| 번역 언어 설정 | 기본 언어 생성 | 현재 대상 언어 조회 | 한국어/일본어 등 변경 | 기본값 복원 | 언어팩과 연결 |
| 자막 표시 설정 | 기본 자막 모드 생성 | 현재 모드 조회 | 원문/번역/병렬 변경 | 기본값 복원 | 영상 기능에서 사용 |
| TTS 설정 | 기본 OFF 생성 | 사용 여부 조회 | ON/OFF 변경 | 기본값 복원 | 더빙 모드와 연결 |
| 싱크 설정 | 기본 soft 생성 | 현재 싱크 정책 조회 | off/soft/strict 변경 | 기본값 복원 | 재생 제어 정책 |
| Privacy Filter 설정 | 기본 ON 생성 | 활성 여부 조회 | ON/OFF 변경 | 기본값 복원 | v0.2 신규 |

## 13.2 ProviderCredential CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Codex Login 연결 | OAuth/공식 인증 토큰 OS Keychain 저장 | keychainRef로 상태 조회 | 토큰 갱신 | Keychain 항목 삭제 | Spike 1 통과 시에만 노출 |
| OpenAI API Key 등록 | API Key OS Keychain 저장 | keychainRef로 존재 확인 | Key 교체 | Keychain 항목 삭제 | BYOK 핵심 |
| Claude API Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 보조 Provider |
| Gemini API Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 보조 Provider |
| DeepL Key 등록 | API Key OS Keychain 저장 | Provider 상태 조회 | Key 교체 | Keychain 항목 삭제 | 번역 특화 |
| Provider 활성화 | Provider 생성 시 active | 현재 활성 Provider 조회 | 기본 Provider 변경 | 비활성화 | 멀티 Provider 구조 |

## 13.3 TranslationRequest CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 선택 영역 번역 요청 | 드래그 후 요청 생성 | 요청 상태 조회 | pending → completed 변경 | 기록 삭제 | P0 |
| 문단 번역 요청 | 문단 단위 요청 생성 | 진행률 조회 | 실패/완료 상태 변경 | 기록 삭제 | P0 |
| 페이지 번역 요청 | 페이지 전체 요청 생성 | 요청 목록 조회 | 부분 완료 업데이트 | 기록 삭제 | P1 |
| 자막 번역 요청 | 자막 세그먼트별 생성 | 세그먼트 상태 조회 | 번역 결과 업데이트 | 기록 삭제 | P0 |
| TTS 스크립트 요청 | 번역문 기반 생성 | TTS 준비 상태 조회 | 음성 경로 업데이트 | 기록 삭제 | P1 |
| Privacy 차단 요청 | Privacy Filter가 차단 시 기록 | 차단 이력 조회 | — | 사용자 삭제 | v0.2 신규 |

## 13.4 TranslationCache CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 번역 캐시 저장 | 번역 완료 시 생성 | 복합 키로 조회 | hitCount 증가, expiresAt 갱신 | TTL 만료 시 LRU 삭제 | 비용 절감 핵심 |
| 도메인별 캐시 | 도메인 정보 포함 생성 | 도메인별 조회 | 만료일 갱신 | 도메인 캐시 삭제 | 사이트별 최적화 |
| 자막 캐시 | 영상 자막 번역 저장 (TTL 365일) | 영상 재방문 시 조회 | 수정 번역 반영 | 영상 캐시 삭제 | YouTube 핵심 |
| Provider별 캐시 | Provider 정보 포함 저장 | Provider별 조회 | 품질 점수 업데이트 | Provider 캐시 삭제 | 품질 비교 가능 |
| 용어집 버전 변경 | — | — | glossaryVersion 불일치 캐시 무효화 | 자동 만료 | v0.2 신규 |

## 13.5 VideoSession CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 영상 세션 생성 | YouTube/Video 감지 시 생성 (direct/embedded 구분) | 현재 세션 조회 | currentTime/status 갱신 | 세션 종료 시 삭제/보관 | P0 |
| 자막 상태 관리 | 세션 생성 시 none | 상태 조회 | detected/extracted/translated 변경 | 세션 삭제 시 정리 | P0 |
| TTS 상태 관리 | 더빙 모드 ON 시 생성/갱신 | 현재 TTS 상태 조회 | preparing/playing/failed 변경 | 더빙 OFF 시 정리 | P1 |
| 싱크 상태 관리 | 세션 생성 시 normal | 현재 싱크 상태 조회 | delayed/paused/resyncing 변경 | 세션 종료 시 정리 | P2 |

## 13.6 SubtitleSegment CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 자막 세그먼트 생성 | 자막 추출 시 sourceType 포함 생성 | 현재 시간대 세그먼트 조회 | 번역문 업데이트 | 세그먼트 삭제 | P0 |
| 번역 자막 저장 | 번역 완료 시 업데이트 | 번역 자막 조회 | 수정 번역 반영 | 캐시 삭제 | P0 |
| TTS 오디오 연결 | TTS 생성 시 경로 저장 | 재생할 오디오 조회 | 재생 상태 업데이트 | 오디오 삭제 | P1 |
| 재생 상태 관리 | 초기 pending | 현재 상태 조회 | played/failed 변경 | 세션 종료 시 정리 | P1 |

## 13.7 GlossaryTerm CRUD

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 용어 등록 | 사용자가 용어 추가 (version 증가) | 용어 목록 조회 | 번역어 수정 (version 증가) | 용어 삭제 | P2 |
| 도메인 용어집 | 도메인별 용어 생성 | 도메인별 조회 | 적용 범위 변경 | 도메인 용어 삭제 | 전문 번역 강화 |
| 활성/비활성 | 생성 시 active | 상태 조회 | active 변경 | 삭제 | 번역 품질 관리 |

## 13.8 UsageLog CRUD (v0.2 명세 추가)

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| Provider 사용량 기록 | 요청 완료 시 토큰/오디오/비용 기록 | 일/월별 조회 | 비용 추정 갱신 | 사용자 수동 삭제 | 비용 관리 |
| 기능별 사용량 기록 | 번역/STT/TTS별 생성 | 기능별 조회 | 상태 업데이트 | 90일 이후 자동 정리 | BM 설계 |
| 실패 로그 기록 | 실패 시 errorCode 포함 생성 | 에러 분석 조회 | 해결 상태 업데이트 | 오래된 로그 삭제 | 안정성 개선 |
| 외부 전송 감사 | privacyDecision 기록 | 사용자 감사 조회 | — | 사용자 수동 삭제 | v0.2 보안 |

## 13.9 PrivacyFilter CRUD (v0.2 신규)

| 기능 | Create | Read | Update | Delete | 비고 |
|---|---|---|---|---|---|
| 도메인 화이트리스트 | 사용자 추가 | 목록 조회 | 항목 수정 | 항목 삭제 | P1 |
| 도메인 블랙리스트 | 사용자 추가 | 목록 조회 | 항목 수정 | 항목 삭제 | P1 |
| 차단 이력 조회 | Privacy Filter 차단 시 자동 기록 | 사용자 조회 | — | 일괄 삭제 | UsageLog 연동 |
| 수동 승인 토큰 | 사용자 승인 시 생성 (세션 한정) | 활성 토큰 조회 | — | 세션 종료 시 자동 삭제 | P0 |
