import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UsageLog, V04_FEATURES } from '../../../src/storage/UsageLog'

describe('UsageLog', () => {
  let logPath: string

  beforeEach(() => {
    logPath = join(tmpdir(), `usage-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(logPath)
    } catch {
      // ignore
    }
  })

  it('appends entries and assigns id + createdAt', async () => {
    const log = new UsageLog(logPath)
    const entry = await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 10,
      outputTokens: 20,
      audioSeconds: 0,
      estimatedCostUsd: 0.00003,
      domain: 'www.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    expect(entry.id).toMatch(/^use_/)
    expect(entry.createdAt).toBeGreaterThan(0)
  })

  it('readAll returns persisted entries', async () => {
    const log = new UsageLog(logPath)
    await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 10,
      outputTokens: 20,
      audioSeconds: 0,
      estimatedCostUsd: 0.00003,
      domain: 'a.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 5,
      outputTokens: 8,
      audioSeconds: 0,
      estimatedCostUsd: 0.00001,
      domain: 'b.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    const all = await log.readAll()
    expect(all.length).toBe(2)
  })

  it('summarize aggregates by provider and feature', async () => {
    const log = new UsageLog(logPath)
    await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 10,
      outputTokens: 20,
      audioSeconds: 0,
      estimatedCostUsd: 0.01,
      domain: 'a.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    await log.append({
      providerId: 'openai',
      feature: 'summary',
      inputTokens: 5,
      outputTokens: 5,
      audioSeconds: 0,
      estimatedCostUsd: 0.02,
      domain: 'b.example.com',
      privacyDecision: 'allowed',
      status: 'failed',
      errorCode: 'network'
    })
    const summary = await log.summarize()
    expect(summary.total).toBe(2)
    expect(summary.successCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.totalCostUsd).toBeCloseTo(0.03, 6)
    expect(summary.byProvider.openai.count).toBe(2)
    expect(summary.byFeature.translation.count).toBe(1)
    expect(summary.byFeature.summary.count).toBe(1)
  })

  it('purgeOlderThan removes outdated entries', async () => {
    const log = new UsageLog(logPath)
    await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 1,
      outputTokens: 1,
      audioSeconds: 0,
      estimatedCostUsd: 0,
      domain: 'a.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    // Wait 5ms to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 5))
    const cutoff = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await log.append({
      providerId: 'openai',
      feature: 'translation',
      inputTokens: 2,
      outputTokens: 2,
      audioSeconds: 0,
      estimatedCostUsd: 0,
      domain: 'b.example.com',
      privacyDecision: 'allowed',
      status: 'success'
    })
    const removed = await log.purgeOlderThan(cutoff)
    expect(removed).toBe(1)
    const remaining = await log.readAll()
    expect(remaining.length).toBe(1)
    expect(remaining[0].domain).toBe('b.example.com')
  })

  // Sprint 015 M3-7 — v0.4 GENERALIZE 신규 케이스
  describe('M3-7 v0.4 GENERALIZE', () => {
    it('V04_FEATURES 4종 정합 (chat/embed/tag/background_translation)', () => {
      expect(V04_FEATURES).toEqual(['chat', 'embed', 'tag', 'background_translation'])
    })

    it('v0.4 feature 값 + 옵션 컬럼 (workspaceId/model/durationMs) 영속', async () => {
      const log = new UsageLog(logPath)
      const entry = await log.append({
        providerId: 'openai',
        feature: 'chat',
        inputTokens: 100,
        outputTokens: 50,
        audioSeconds: 0,
        estimatedCostUsd: 0.0001,
        domain: 'chatgpt.com',
        privacyDecision: 'allowed',
        status: 'success',
        workspaceId: 'ws-A',
        model: 'gpt-4o-mini',
        durationMs: 1230
      })
      expect(entry.feature).toBe('chat')
      expect(entry.workspaceId).toBe('ws-A')
      expect(entry.model).toBe('gpt-4o-mini')
      expect(entry.durationMs).toBe(1230)
      const all = await log.readAll()
      expect(all[0]).toMatchObject({
        feature: 'chat',
        workspaceId: 'ws-A',
        model: 'gpt-4o-mini',
        durationMs: 1230
      })
    })

    it('summarize byWorkspace + byModel 집계', async () => {
      const log = new UsageLog(logPath)
      await log.append({
        providerId: 'openai',
        feature: 'chat',
        inputTokens: 1,
        outputTokens: 1,
        audioSeconds: 0,
        estimatedCostUsd: 0.01,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success',
        workspaceId: 'ws-A',
        model: 'gpt-4o-mini'
      })
      await log.append({
        providerId: 'openai',
        feature: 'embed',
        inputTokens: 100,
        outputTokens: 0,
        audioSeconds: 0,
        estimatedCostUsd: 0.02,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success',
        workspaceId: 'ws-A',
        model: 'text-embedding-3-small'
      })
      await log.append({
        providerId: 'openai',
        feature: 'chat',
        inputTokens: 1,
        outputTokens: 1,
        audioSeconds: 0,
        estimatedCostUsd: 0.03,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success',
        workspaceId: 'ws-B',
        model: 'gpt-4o-mini'
      })
      const s = await log.summarize()
      expect(s.byWorkspace['ws-A'].count).toBe(2)
      expect(s.byWorkspace['ws-A'].costUsd).toBeCloseTo(0.03, 6)
      expect(s.byWorkspace['ws-B'].count).toBe(1)
      expect(s.byModel['gpt-4o-mini'].count).toBe(2)
      expect(s.byModel['text-embedding-3-small'].count).toBe(1)
    })

    it("workspaceId/model 미주입 entry → 'unknown' bucket", async () => {
      const log = new UsageLog(logPath)
      await log.append({
        providerId: 'openai',
        feature: 'translation',
        inputTokens: 1,
        outputTokens: 1,
        audioSeconds: 0,
        estimatedCostUsd: 0.01,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success'
      })
      const s = await log.summarize()
      expect(s.byWorkspace['unknown'].count).toBe(1)
      expect(s.byModel['unknown'].count).toBe(1)
    })

    it('migrateLegacyEntries — v0.3 entry 에 workspaceId 부여 (idempotent)', async () => {
      const log = new UsageLog(logPath)
      await log.append({
        providerId: 'openai',
        feature: 'translation',
        inputTokens: 1,
        outputTokens: 1,
        audioSeconds: 0,
        estimatedCostUsd: 0.01,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success'
      })
      await log.append({
        providerId: 'openai',
        feature: 'chat',
        inputTokens: 1,
        outputTokens: 1,
        audioSeconds: 0,
        estimatedCostUsd: 0.01,
        domain: 'x',
        privacyDecision: 'allowed',
        status: 'success',
        workspaceId: 'ws-explicit' // 이미 부여됨 — 보존 대상
      })
      const migrated1 = await log.migrateLegacyEntries('ws-default')
      expect(migrated1).toBe(1) // v0.3 entry 1건만 갱신
      const all = await log.readAll()
      const fromLegacy = all.find((e) => e.feature === 'translation')!
      expect(fromLegacy.workspaceId).toBe('ws-default')
      const fromV04 = all.find((e) => e.feature === 'chat')!
      expect(fromV04.workspaceId).toBe('ws-explicit') // 보존
      // 두 번째 호출 — idempotent (모두 workspaceId 있음 → 0건 갱신)
      const migrated2 = await log.migrateLegacyEntries('ws-default')
      expect(migrated2).toBe(0)
    })

    it('migrateLegacyEntries 빈 파일 → 0건', async () => {
      const log = new UsageLog(logPath)
      const migrated = await log.migrateLegacyEntries('ws-default')
      expect(migrated).toBe(0)
    })

    it('feature enum: v0.3 + v0.4 모두 허용 (감사 로그 보존성)', async () => {
      const log = new UsageLog(logPath)
      const features = [
        'translation',
        'summary',
        'tts',
        'stt',
        'explanation',
        'chat',
        'embed',
        'tag',
        'background_translation'
      ] as const
      for (const feat of features) {
        await log.append({
          providerId: 'openai',
          feature: feat,
          inputTokens: 1,
          outputTokens: 1,
          audioSeconds: 0,
          estimatedCostUsd: 0.001,
          domain: 'x',
          privacyDecision: 'allowed',
          status: 'success'
        })
      }
      const all = await log.readAll()
      expect(all.length).toBe(9)
      const s = await log.summarize()
      for (const feat of features) {
        expect(s.byFeature[feat].count).toBe(1)
      }
    })
  })
})
