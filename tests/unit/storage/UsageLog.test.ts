import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UsageLog } from '../../../src/storage/UsageLog'

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
})
