/**
 * Sprint 005 M2 / S005-T04 — GlossaryStore 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  GlossaryStore,
  GLOSSARY_POLICY_VERSION,
  validateTerm,
  formatGlossaryContext
} from '../../../src/storage/GlossaryStore'

describe('validateTerm', () => {
  it('rejects empty source / target', () => {
    expect(validateTerm('', 'foo').error).toBe('empty_source')
    expect(validateTerm('   ', 'foo').error).toBe('empty_source')
    expect(validateTerm('foo', '').error).toBe('empty_target')
    expect(validateTerm('foo', '   ').error).toBe('empty_target')
  })

  it('rejects too-long source / target', () => {
    const long = 'a'.repeat(201)
    expect(validateTerm(long, 'foo').error).toBe('too_long_source')
    expect(validateTerm('foo', long).error).toBe('too_long_target')
  })

  it('accepts and normalizes (trim, source casefold check)', () => {
    const result = validateTerm('  Serverless  ', '  서버리스  ')
    expect(result.ok).toBe(true)
    expect(result.normalized?.sourceTerm).toBe('Serverless')
    expect(result.normalized?.targetTerm).toBe('서버리스')
  })

  it('rejects duplicate (case-insensitive source + same target)', () => {
    const existing = [
      {
        id: 'gt_a',
        sourceTerm: 'AWS',
        targetTerm: 'AWS',
        description: '',
        domain: '',
        isActive: true,
        version: 'v1',
        createdAt: 0,
        updatedAt: 0
      }
    ]
    expect(validateTerm('aws', 'AWS', existing).error).toBe('duplicate')
    // 다른 번역은 허용
    expect(validateTerm('aws', '아마존 웹 서비스', existing).ok).toBe(true)
  })
})

describe('GlossaryStore', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `glossary-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    try {
      await fs.unlink(path)
    } catch {
      // ignore
    }
  })

  it('throws when used before load()', async () => {
    const store = new GlossaryStore(path)
    expect(() => store.list()).toThrow('GlossaryStore.load() not called')
  })

  it('empty load when file missing', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    expect(store.list().length).toBe(0)
    expect(store.getVersion()).toBe('default')
  })

  it('add persists to disk with policyVersion', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    const r = await store.add({
      sourceTerm: 'serverless',
      targetTerm: '서버리스',
      domain: 'aws.amazon.com'
    })
    expect(r.ok).toBe(true)
    expect(r.term?.sourceTerm).toBe('serverless')
    expect(r.term?.isActive).toBe(true)
    expect(store.getVersion()).not.toBe('default')

    const onDisk = JSON.parse(await fs.readFile(path, 'utf-8'))
    expect(onDisk.policyVersion).toBe(GLOSSARY_POLICY_VERSION)
    expect(onDisk.terms.length).toBe(1)
  })

  it('add bumps version each time', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    await store.add({ sourceTerm: 'AWS', targetTerm: '아마존' })
    const v1 = store.getVersion()
    await new Promise((r) => setTimeout(r, 5))
    await store.add({ sourceTerm: 'GCP', targetTerm: '구글 클라우드' })
    const v2 = store.getVersion()
    expect(v1).not.toBe(v2)
  })

  it('update modifies term and bumps version', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    const added = await store.add({ sourceTerm: 'k8s', targetTerm: 'K8s' })
    const id = added.term!.id
    const v1 = store.getVersion()
    const updated = await store.update(id, { targetTerm: '쿠버네티스', isActive: false })
    expect(updated.ok).toBe(true)
    expect(updated.term?.targetTerm).toBe('쿠버네티스')
    expect(updated.term?.isActive).toBe(false)
    expect(store.getVersion()).not.toBe(v1)
  })

  it('remove deletes and bumps version', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    const added = await store.add({ sourceTerm: 'k8s', targetTerm: '쿠버네티스' })
    const id = added.term!.id
    const v1 = store.getVersion()
    const removed = await store.remove(id)
    expect(removed).toBe(true)
    expect(store.list().length).toBe(0)
    expect(store.getVersion()).not.toBe(v1)
  })

  it('getActiveForDomain filters active + domain match (or empty domain)', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    await store.add({ sourceTerm: 'a', targetTerm: '에이', domain: '' }) // 모든 도메인
    await store.add({ sourceTerm: 'b', targetTerm: '비', domain: 'aws.com' })
    await store.add({ sourceTerm: 'c', targetTerm: '시', domain: 'gcp.com' })
    const added = await store.add({ sourceTerm: 'd', targetTerm: '디', domain: '' })
    await store.update(added.term!.id, { isActive: false })

    const aws = store.getActiveForDomain('aws.com')
    expect(aws.map((t) => t.sourceTerm).sort()).toEqual(['a', 'b'])

    const other = store.getActiveForDomain('foo.com')
    expect(other.map((t) => t.sourceTerm)).toEqual(['a'])

    const noDomain = store.getActiveForDomain(null)
    expect(noDomain.map((t) => t.sourceTerm)).toEqual(['a'])
  })

  it('list with activeOnly filter', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    await store.add({ sourceTerm: 'a', targetTerm: '에이' })
    const inactive = await store.add({ sourceTerm: 'b', targetTerm: '비' })
    await store.update(inactive.term!.id, { isActive: false })
    expect(store.list().length).toBe(2)
    expect(store.list({ activeOnly: true }).length).toBe(1)
  })

  it('importTerms replaces and validates', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    await store.add({ sourceTerm: 'old', targetTerm: '오래된' })

    const r = await store.importTerms({
      policyVersion: GLOSSARY_POLICY_VERSION,
      currentVersion: 'imported',
      terms: [
        { sourceTerm: 'new', targetTerm: '새로운' },
        { sourceTerm: '', targetTerm: '잘못된' } // 거절
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.accepted).toBe(1)
    expect(r.rejected).toBe(1)
    expect(store.list().map((t) => t.sourceTerm)).toEqual(['new'])
  })

  it('importTerms rejects wrong version / invalid root', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    expect((await store.importTerms(null)).error).toBe('invalid_root')
    expect((await store.importTerms({})).error).toBe('missing_version')
    expect((await store.importTerms({ policyVersion: 999, terms: [] })).error).toBe(
      'unsupported_version_999'
    )
  })

  it('clearAll removes all and bumps version', async () => {
    const store = new GlossaryStore(path)
    await store.load()
    await store.add({ sourceTerm: 'a', targetTerm: '에이' })
    await store.add({ sourceTerm: 'b', targetTerm: '비' })
    const v1 = store.getVersion()
    await store.clearAll()
    expect(store.list().length).toBe(0)
    expect(store.getVersion()).not.toBe(v1)
  })
})

describe('formatGlossaryContext', () => {
  it('returns empty string for empty list', () => {
    expect(formatGlossaryContext([])).toBe('')
  })

  it('formats terms with description', () => {
    const out = formatGlossaryContext([
      {
        id: 'gt_a',
        sourceTerm: 'serverless',
        targetTerm: '서버리스',
        description: 'FaaS 기반',
        domain: '',
        isActive: true,
        version: 'v1',
        createdAt: 0,
        updatedAt: 0
      },
      {
        id: 'gt_b',
        sourceTerm: 'k8s',
        targetTerm: '쿠버네티스',
        description: '',
        domain: '',
        isActive: true,
        version: 'v1',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    expect(out).toContain('Glossary')
    expect(out).toContain('serverless → 서버리스 — FaaS 기반')
    expect(out).toContain('k8s → 쿠버네티스')
    expect(out.split('\n').length).toBe(3)
  })
})
