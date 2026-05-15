/**
 * Sprint 003 M3 / S003-T07 — DomainPolicyStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DomainFilter } from '../../../src/privacy/DomainFilter'
import {
  DomainPolicyStore,
  POLICY_VERSION,
  validatePattern
} from '../../../src/privacy/DomainPolicyStore'

describe('validatePattern', () => {
  it('rejects empty pattern', () => {
    expect(validatePattern('', 'blacklist').error).toBe('empty')
    expect(validatePattern('   ', 'whitelist').error).toBe('empty')
  })

  it('rejects invalid type', () => {
    expect(validatePattern('example.com', 'invalid' as 'blacklist').error).toBe('invalid_type')
  })

  it('accepts simple domain', () => {
    const r = validatePattern('Example.COM', 'blacklist')
    expect(r.ok).toBe(true)
    expect(r.normalized).toBe('example.com')
  })

  it('accepts leading wildcard', () => {
    const r = validatePattern('*.example.com', 'whitelist')
    expect(r.ok).toBe(true)
    expect(r.normalized).toBe('*.example.com')
  })

  it('rejects mid-string wildcard', () => {
    expect(validatePattern('foo.*.bar.com', 'blacklist').error).toBe('invalid_wildcard')
    expect(validatePattern('foo*bar.com', 'blacklist').error).toBe('invalid_wildcard')
  })

  it('rejects invalid chars', () => {
    expect(validatePattern('example com', 'blacklist').error).toBe('invalid_chars')
    expect(validatePattern('example_com', 'blacklist').error).toBe('invalid_chars')
  })

  it('rejects too-long pattern', () => {
    const long = 'a'.repeat(254) + '.com'
    expect(validatePattern(long, 'blacklist').error).toBe('too_long')
  })

  it('rejects wildcard with empty body', () => {
    expect(validatePattern('*.', 'blacklist').error).toBe('invalid_wildcard')
  })
})

describe('DomainPolicyStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `dp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('loads empty state when file missing', async () => {
    const state = await DomainPolicyStore.loadFromDisk(path)
    expect(state.userRules).toEqual([])
  })

  it('addRule persists to disk and is idempotent', async () => {
    const filter = new DomainFilter()
    const store = new DomainPolicyStore(path, filter)
    const r1 = await store.addRule({ pattern: 'docs.example.com', type: 'whitelist' })
    expect(r1.ok).toBe(true)
    const r2 = await store.addRule({ pattern: 'docs.example.com', type: 'whitelist' })
    expect(r2.ok).toBe(true) // 이미 존재해도 ok
    expect(store.getState().userRules.length).toBe(1)

    // 디스크 영속
    const onDisk = JSON.parse(await fs.readFile(path, 'utf-8'))
    expect(onDisk.policyVersion).toBe(POLICY_VERSION)
    expect(onDisk.userRules.length).toBe(1)
  })

  it('addRule rejects invalid pattern', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    const r = await store.addRule({ pattern: 'bad*pattern', type: 'blacklist' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_wildcard')
    expect(store.getState().userRules.length).toBe(0)
  })

  it('removeRule normalizes pattern (case + whitespace)', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    await store.addRule({ pattern: 'mail.example.com', type: 'blacklist' })
    expect(store.getState().userRules.length).toBe(1)
    await store.removeRule({ pattern: '  Mail.Example.com  ', type: 'blacklist' })
    expect(store.getState().userRules.length).toBe(0)
  })

  it('setRules accepts valid, rejects invalid, dedupes', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    const result = await store.setRules([
      { pattern: 'a.example.com', type: 'whitelist' },
      { pattern: 'a.example.com', type: 'whitelist' }, // 중복
      { pattern: 'b.example.com', type: 'whitelist' },
      { pattern: 'bad*x', type: 'blacklist' }, // 거절
      { pattern: 'mail.example.com', type: 'blacklist' }
    ])
    expect(result.accepted).toBe(3)
    expect(result.rejected).toBe(1)
    expect(store.getState().userRules.length).toBe(3)
  })

  it('whitelist bypasses blacklist via DomainFilter priority', async () => {
    const filter = new DomainFilter()
    const store = new DomainPolicyStore(path, filter)
    await store.addRule({ pattern: '*.example.com', type: 'whitelist' })
    await store.addRule({ pattern: '*.example.com', type: 'blacklist' })
    const eval1 = filter.evaluate('mail.example.com')
    expect(eval1.blocked).toBe(false)
    expect(eval1.matchedBy).toBe('whitelist')
  })

  it('exportPolicy includes policyVersion + rules', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    await store.addRule({ pattern: 'a.example.com', type: 'whitelist' })
    const exported = store.exportPolicy()
    expect(exported.policyVersion).toBe(POLICY_VERSION)
    expect(exported.userRules.length).toBe(1)
  })

  it('importPolicy validates version and replaces rules', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    await store.addRule({ pattern: 'old.example.com', type: 'whitelist' })

    const result = await store.importPolicy({
      policyVersion: POLICY_VERSION,
      userRules: [
        { pattern: 'new.example.com', type: 'blacklist' },
        { pattern: 'invalid*pattern', type: 'blacklist' }
      ]
    })
    expect(result.ok).toBe(true)
    expect(result.accepted).toBe(1)
    expect(result.rejected).toBe(1)
    expect(store.getState().userRules).toEqual([
      { pattern: 'new.example.com', type: 'blacklist' }
    ])
  })

  it('importPolicy rejects wrong version / invalid root / missing fields', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    expect((await store.importPolicy(null)).error).toBe('invalid_root')
    expect((await store.importPolicy({ userRules: [] })).error).toBe('missing_version')
    expect(
      (await store.importPolicy({ policyVersion: 999, userRules: [] })).error
    ).toBe(`unsupported_version_999`)
    expect(
      (await store.importPolicy({ policyVersion: POLICY_VERSION, userRules: 'nope' })).error
    ).toBe('invalid_userRules')
  })

  it('clearAll removes all and persists', async () => {
    const store = new DomainPolicyStore(path, new DomainFilter())
    await store.addRule({ pattern: 'a.example.com', type: 'whitelist' })
    await store.addRule({ pattern: 'b.example.com', type: 'blacklist' })
    await store.clearAll()
    expect(store.getState().userRules).toEqual([])
    const onDisk = JSON.parse(await fs.readFile(path, 'utf-8'))
    expect(onDisk.userRules).toEqual([])
  })

  it('loadFromDisk parses existing policy file', async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        policyVersion: POLICY_VERSION,
        userRules: [
          { pattern: 'a.example.com', type: 'whitelist' },
          { pattern: 'b.example.com', type: 'blacklist' },
          { pattern: 'invalid', type: 'wrong' } // 거절
        ]
      })
    )
    const state = await DomainPolicyStore.loadFromDisk(path)
    expect(state.userRules.length).toBe(2)
    expect(state.userRules.map((r) => r.pattern)).toEqual(['a.example.com', 'b.example.com'])
  })
})
