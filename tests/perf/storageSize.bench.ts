/**
 * Sprint 016 M0 T06 — perf bench (KI-016 저장 용량 < 200MB / 1만 페이지).
 *
 * PRD §15.4 #5 / §15.3 — 1만 페이지 시드 후 SQLite 파일 크기 측정 (현재 추정 ~150MB).
 *
 * 본 bench 는 실측 셋업이 무거워서 (1만 페이지 + 임베딩 시드) 측정 자체만 1회 진행.
 * vitest bench 가 자동으로 반복 시도하나 setup 안에서 페이지 시드 1회 + size 측정.
 *
 * 임계: < 200MB. 미달 시: schema 압축 옵션 또는 임베딩 차원 축소 검토 (KI-016 status `open` 유지).
 *
 * 측정 모드:
 *   - tmpdir 파일 DB 생성 (in-memory 는 파일 크기 의미 없음)
 *   - applySchema → 1만 페이지 recordVisit + 임베딩 upsert
 *   - statSync(dbPath).size 측정
 *   - close + cleanup
 *
 * 환경: dev 머신 SSD 가정. CI runner 에서는 시드 시간 60초 이상 가능 — 본 bench 는 dev local + Sprint 종료 시 실측 보고서에만 활용.
 */

import { bench, describe, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { FlowbrowserDatabase } from '../../src/storage/Database'
import { IndexedPageStoreSqlite } from '../../src/storage/IndexedPageStoreSqlite'
import { VectorIndex, EMBEDDING_DIMENSIONS } from '../../src/storage/VectorIndex'
import { applyV06Schema } from '../helpers/v06Schema'

interface Fx {
  dbPath: string
  tmpDir: string
  fileSizeBytes: number
  fileSizeMb: number
}

function randomVec(seed: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
  let s = seed
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    s = (s * 9301 + 49297) % 233280
    v[i] = (s / 233280) * 2 - 1
  }
  return v
}

async function seedAndMeasure(pagesCount: number): Promise<Fx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'fb-perf-'))
  const dbPath = join(tmpDir, 'storage-bench.db')
  // Sprint 018 M2 T17b — v06 schema (VectorIndex 가 dimension 별 테이블 타깃). bootstrap(v05) 대신 open + applyV06Schema.
  const fb = FlowbrowserDatabase.open({ path: dbPath, enableWal: true })
  applyV06Schema(fb)
  const ws = fb.ensureDefaultWorkspace()
  const pageStore = new IndexedPageStoreSqlite(fb, { defaultWorkspaceId: ws.id })
  const vec = new VectorIndex(fb)

  const base = Date.now() - pagesCount * 60_000
  const body = 'lorem ipsum dolor sit amet, '.repeat(150) // ~4KB
  for (let i = 0; i < pagesCount; i++) {
    const { page } = await pageStore.recordVisit({
      workspace_id: ws.id,
      url: `https://size-bench.example/p${i}`,
      title: `Page ${i}`,
      content: body,
      visited_at: base + i * 60_000
    })
    vec.upsertPageEmbedding(page.id, ws.id, randomVec(i + 1), 1024)
  }
  fb.close()
  const fileSizeBytes = statSync(dbPath).size
  const fileSizeMb = fileSizeBytes / (1024 * 1024)
  return { dbPath, tmpDir, fileSizeBytes, fileSizeMb }
}

describe('KI-016 저장 용량 < 200MB / 1만 페이지', () => {
  let fx: Fx
  beforeAll(async () => {
    fx = await seedAndMeasure(10_000)
  }, 300_000)
  afterAll(() => {
    rmSync(fx.tmpDir, { recursive: true, force: true })
  })

  bench('SQLite 파일 크기 측정 (10K pages + 임베딩)', () => {
    // 본 bench 는 측정 결과 노출용 — 실제 시드는 beforeAll 에서 1회만.
    // bench 본문은 statSync 만 호출하여 fx.fileSizeBytes 가 결과 보고서에 박힘.
    if (fx.fileSizeMb >= 200) {
      throw new Error(`임계 초과: ${fx.fileSizeMb.toFixed(2)}MB >= 200MB`)
    }
  })
})
