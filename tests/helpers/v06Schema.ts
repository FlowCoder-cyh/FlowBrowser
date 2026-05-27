/**
 * Sprint 018 M2 T17b — 테스트 전용 v06 schema 적용 helper.
 *
 * **test-only** — 프로덕션 `FlowbrowserDatabase` 에 `applyV06Schema()` 를 추가하지 않는다 (codex 019e6898 —
 * applySchema 는 v05.sql 유지가 migrateV04ToV05 정합상 강제, 프로덕션 v06 진입은 마이그레이션 체인이 소유).
 * 본 helper 는 소비처 단위 테스트(VectorIndex/SearchService/EmbeddingClient/searchHandlers/integration)가
 * v06 schema(dimension 별 vec0 테이블) 위에서 fixture 를 세우기 위한 fresh apply 경로.
 *
 * v06.sql 직접 적용 ≠ 마이그레이션 경로 — 두 경로의 schema shape 동등성(drift)은
 * `tests/unit/storage/migrations/v05_to_v06.test.ts` 의 drift-check 회귀가 강제한다 (본 helper 의 책임 아님).
 *
 * services 부트 회귀(실 `migrateV04ToV05 → migrateV05ToV06` 체인)는
 * `tests/unit/main/services.bootstrap.test.ts` 가 별도로 검증한다.
 */

import v06SchemaSQL from '../../src/storage/schema/v06.sql?raw'
import { FlowbrowserDatabase, V06_SCHEMA_VERSION } from '../../src/storage/Database'

/**
 * fresh v06 schema 적용 — v06.sql canonical DDL exec + schema_meta.version=3.
 * `FlowbrowserDatabase.openInMemory()` 직후 호출 (applySchema 대체).
 *
 * 모든 DDL 이 `IF NOT EXISTS` 라 멱등 — v05 applySchema 후 호출해도 안전하나, 일반적으로 fresh DB 에 단독 적용.
 */
export function applyV06Schema(fb: FlowbrowserDatabase): void {
  fb.getDb().exec(v06SchemaSQL)
  fb.setSchemaMeta('version', String(V06_SCHEMA_VERSION))
}

/** openInMemory + applyV06Schema 단축 (테스트 fixture 편의). */
export function openInMemoryV06(): FlowbrowserDatabase {
  const fb = FlowbrowserDatabase.openInMemory()
  applyV06Schema(fb)
  return fb
}
