import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TransmissionLogger } from '../../../src/privacy/TransmissionLogger'

describe('TransmissionLogger', () => {
  let logPath: string

  beforeEach(async () => {
    logPath = join(tmpdir(), `transmission-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(logPath)
    } catch {
      // ignore
    }
  })

  it('appends allowed entries to disk', async () => {
    const logger = new TransmissionLogger(logPath)
    await logger.append({
      timestamp: 1,
      url: 'https://www.example.com',
      domain: 'www.example.com',
      decision: 'allowed',
      feature: 'translation',
      providerId: 'openai'
    })
    const raw = await fs.readFile(logPath, 'utf-8')
    expect(raw.trim().length).toBeGreaterThan(0)
    const parsed = JSON.parse(raw.trim())
    expect(parsed.decision).toBe('allowed')
    expect(parsed.feature).toBe('translation')
  })

  it('does not persist blocked entries, only updates counter', async () => {
    const logger = new TransmissionLogger(logPath)
    await logger.append({
      timestamp: 1,
      url: 'https://mail.example.com',
      domain: 'mail.example.com',
      decision: 'blocked',
      feature: 'translation',
      reason: 'domain_blacklist'
    })
    const stats = logger.getBlockedStats()
    expect(stats.total).toBe(1)
    expect(stats.byDomain['mail.example.com']).toBe(1)
    expect(stats.byReason['domain_blacklist']).toBe(1)
    let raw = ''
    try {
      raw = await fs.readFile(logPath, 'utf-8')
    } catch {
      raw = ''
    }
    expect(raw.trim()).toBe('')
  })

  it('recordBlock increments counters even without I/O call', () => {
    const logger = new TransmissionLogger(logPath)
    logger.recordBlock({
      timestamp: 1,
      url: 'https://mail.example.com',
      domain: 'mail.example.com',
      decision: 'blocked',
      feature: 'translation',
      reason: 'password_field'
    })
    logger.recordBlock({
      timestamp: 2,
      url: 'https://accounts.google.com',
      domain: 'accounts.google.com',
      decision: 'blocked',
      feature: 'translation',
      reason: 'password_field'
    })
    const stats = logger.getBlockedStats()
    expect(stats.total).toBe(2)
    expect(stats.byReason['password_field']).toBe(2)
    expect(Object.keys(stats.byDomain).length).toBe(2)
  })

  it('loadFromDisk reads previously persisted entries', async () => {
    const initial = new TransmissionLogger(logPath)
    await initial.append({
      timestamp: 1,
      url: 'https://www.example.com',
      domain: 'www.example.com',
      decision: 'allowed',
      feature: 'translation',
      providerId: 'openai'
    })

    const next = new TransmissionLogger(logPath)
    await next.loadFromDisk()
    const snap = next.getMemorySnapshot()
    expect(snap.length).toBe(1)
    expect(snap[0].domain).toBe('www.example.com')
  })

  it('clearAll wipes memory + blocked counters + disk', async () => {
    const logger = new TransmissionLogger(logPath)
    await logger.append({
      timestamp: 1,
      url: 'https://www.example.com',
      domain: 'www.example.com',
      decision: 'allowed',
      feature: 'translation',
      providerId: 'openai'
    })
    logger.recordBlock({
      timestamp: 2,
      url: 'https://mail.example.com',
      domain: 'mail.example.com',
      decision: 'blocked',
      feature: 'translation',
      reason: 'domain_blacklist'
    })
    await logger.clearAll()
    expect(logger.getMemorySnapshot().length).toBe(0)
    expect(logger.getBlockedStats().total).toBe(0)
    await expect(fs.readFile(logPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
