import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  IndexedPageStore,
  DEFAULT_WORKSPACE_ID,
  contentHashOf,
  normalizeIndexedUrl,
  defaultIndexedPagePath
} from '../../../src/storage/IndexedPageStore'

describe('IndexedPageStore', () => {
  let filePath: string

  beforeEach(() => {
    filePath = join(
      tmpdir(),
      `ips-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
  })

  afterEach(async () => {
    try {
      await fs.unlink(filePath)
    } catch {
      // ignore
    }
  })

  describe('helpers', () => {
    it('normalizeIndexedUrl drops query + fragment', () => {
      expect(normalizeIndexedUrl('https://example.com/foo?x=1#frag')).toBe(
        'https://example.com/foo'
      )
    })

    it('normalizeIndexedUrl returns trimmed input on parse failure', () => {
      expect(normalizeIndexedUrl('  not a url  ')).toBe('not a url')
    })

    it('contentHashOf returns null for empty content', () => {
      expect(contentHashOf('')).toBeNull()
    })

    it('contentHashOf returns 32 hex prefix for non-empty content', () => {
      const h = contentHashOf('hello world')
      expect(h).toMatch(/^[0-9a-f]{32}$/)
    })

    it('defaultIndexedPagePath joins userDataDir with indexed-pages.json', () => {
      expect(defaultIndexedPagePath('/tmp/foo')).toMatch(/indexed-pages\.json$/)
    })
  })

  describe('upsertPage', () => {
    it('creates new Page (action=created, visited_count=1)', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page, action } = await store.upsertPage({
        url: 'https://example.com/a',
        title: 'A',
        content: 'hello'
      })
      expect(action).toBe('created')
      expect(page.visited_count).toBe(1)
      expect(page.workspace_id).toBe(DEFAULT_WORKSPACE_ID)
      expect(page.title).toBe('A')
      expect(page.content).toBe('hello')
      expect(page.content_hash).toMatch(/^[0-9a-f]{32}$/)
      expect(page.created_at).toBe(page.updated_at)
    })

    it('uses explicit workspace_id when provided', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({
        workspace_id: 'ws-xyz',
        url: 'https://example.com/a',
        content: 'hello'
      })
      expect(page.workspace_id).toBe('ws-xyz')
    })

    it('same workspace + url + same content → action=unchanged (visited_count++)', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r1 = await store.upsertPage({ url: 'https://example.com/a', content: 'hello' })
      await new Promise((r) => setTimeout(r, 3))
      const r2 = await store.upsertPage({ url: 'https://example.com/a', content: 'hello' })
      expect(r2.action).toBe('unchanged')
      expect(r2.page.id).toBe(r1.page.id)
      expect(r2.page.visited_count).toBe(2)
      expect(r2.page.updated_at).toBe(r1.page.updated_at) // 본문 변경 X → updated_at 보존
    })

    it('same workspace + url + different content → action=updated_changed', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r1 = await store.upsertPage({ url: 'https://example.com/a', content: 'v1', title: 'T1' })
      await new Promise((r) => setTimeout(r, 3))
      const r2 = await store.upsertPage({ url: 'https://example.com/a', content: 'v2', title: 'T2' })
      expect(r2.action).toBe('updated_changed')
      expect(r2.page.id).toBe(r1.page.id)
      expect(r2.page.visited_count).toBe(2)
      expect(r2.page.content).toBe('v2')
      expect(r2.page.title).toBe('T2')
      expect(r2.page.content_hash).not.toBe(r1.page.content_hash)
      expect(r2.page.updated_at).toBeGreaterThan(r1.page.updated_at)
    })

    it('different workspace + same url → separate Page', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const a = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'hello'
      })
      const b = await store.upsertPage({
        workspace_id: 'ws-2',
        url: 'https://example.com/a',
        content: 'hello'
      })
      expect(a.page.id).not.toBe(b.page.id)
      expect(store.countPages()).toBe(2)
      expect(store.countPages('ws-1')).toBe(1)
      expect(store.countPages('ws-2')).toBe(1)
    })

    it('throws when url is empty', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      await expect(store.upsertPage({ url: '' })).rejects.toThrow('url required')
    })

    it('normalizes URL (query + fragment dropped)', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r1 = await store.upsertPage({ url: 'https://example.com/a?x=1', content: 'v' })
      const r2 = await store.upsertPage({ url: 'https://example.com/a#frag', content: 'v' })
      expect(r2.page.id).toBe(r1.page.id) // 같은 페이지로 인식
      expect(r2.action).toBe('unchanged')
    })

    it('empty content → content_hash=null, action=created', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r = await store.upsertPage({ url: 'https://example.com/a' })
      expect(r.page.content).toBe('')
      expect(r.page.content_hash).toBeNull()
    })
  })

  describe('createVisit', () => {
    it('creates Visit linked to page_id with workspace inherited from Page', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'v'
      })
      const visit = await store.createVisit({ page_id: page.id })
      expect(visit.page_id).toBe(page.id)
      expect(visit.workspace_id).toBe('ws-1')
      expect(visit.dwell_ms).toBe(0)
      expect(visit.visited_at).toBeGreaterThan(0)
    })

    it('throws when page_id does not exist', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      await expect(store.createVisit({ page_id: 'unknown' })).rejects.toThrow('page not found')
    })

    it('throws when explicit workspace_id mismatches Page workspace_id', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'v'
      })
      await expect(
        store.createVisit({ page_id: page.id, workspace_id: 'ws-2' })
      ).rejects.toThrow('workspace mismatch')
    })

    it('respects explicit visited_at and dwell_ms', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({ url: 'https://example.com/a', content: 'v' })
      const ts = Date.now() - 60000
      const visit = await store.createVisit({
        page_id: page.id,
        visited_at: ts,
        dwell_ms: 12345
      })
      expect(visit.visited_at).toBe(ts)
      expect(visit.dwell_ms).toBe(12345)
    })

    it('listVisits returns visits in chronological order', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({ url: 'https://example.com/a', content: 'v' })
      const v1 = await store.createVisit({ page_id: page.id, visited_at: 100 })
      const v2 = await store.createVisit({ page_id: page.id, visited_at: 50 })
      const v3 = await store.createVisit({ page_id: page.id, visited_at: 200 })
      const list = store.listVisits(page.id)
      expect(list.map((v) => v.id)).toEqual([v2.id, v1.id, v3.id])
    })
  })

  describe('lookupPage / getPage', () => {
    it('lookupPage by workspace + url', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'v'
      })
      const found = store.lookupPage('ws-1', 'https://example.com/a?x=1')
      expect(found?.id).toBe(page.id)
    })

    it('lookupPage returns null when not found', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.lookupPage('ws-1', 'https://nowhere.com')).toBeNull()
    })

    it('getPage by id', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({ url: 'https://example.com/a', content: 'v' })
      expect(store.getPage(page.id)?.id).toBe(page.id)
      expect(store.getPage('unknown')).toBeNull()
    })
  })

  describe('deleteByWorkspace (cascade)', () => {
    it('removes only Pages + Visits of given workspace', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page: p1 } = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'v'
      })
      await store.createVisit({ page_id: p1.id })
      await store.createVisit({ page_id: p1.id })
      const { page: p2 } = await store.upsertPage({
        workspace_id: 'ws-2',
        url: 'https://example.com/b',
        content: 'v'
      })
      await store.createVisit({ page_id: p2.id })
      const removed = await store.deleteByWorkspace('ws-1')
      expect(removed).toEqual({ pages: 1, visits: 2 })
      expect(store.countPages()).toBe(1)
      expect(store.countVisits()).toBe(1)
      expect(store.lookupPage('ws-1', 'https://example.com/a')).toBeNull()
      expect(store.lookupPage('ws-2', 'https://example.com/b')?.id).toBe(p2.id)
    })

    it('returns zeros when workspace has no pages', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r = await store.deleteByWorkspace('ws-nothing')
      expect(r).toEqual({ pages: 0, visits: 0 })
    })
  })

  describe('stats', () => {
    it('reports per-workspace pages + visits counts', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page: p1 } = await store.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        content: 'v'
      })
      await store.createVisit({ page_id: p1.id })
      await store.createVisit({ page_id: p1.id })
      const { page: p2 } = await store.upsertPage({
        workspace_id: 'ws-2',
        url: 'https://example.com/b',
        content: 'v'
      })
      await store.createVisit({ page_id: p2.id })
      const stats = store.stats()
      expect(stats.pages).toBe(2)
      expect(stats.visits).toBe(3)
      expect(stats.perWorkspace['ws-1']).toEqual({ pages: 1, visits: 2 })
      expect(stats.perWorkspace['ws-2']).toEqual({ pages: 1, visits: 1 })
    })
  })

  describe('persistence', () => {
    it('round-trips pages + visits through disk', async () => {
      const s1 = new IndexedPageStore(filePath)
      await s1.load()
      const { page } = await s1.upsertPage({
        workspace_id: 'ws-1',
        url: 'https://example.com/a',
        title: 'A',
        content: 'v1',
        lang: 'en'
      })
      await s1.createVisit({ page_id: page.id, dwell_ms: 5000 })
      await s1.flush()

      const s2 = new IndexedPageStore(filePath)
      await s2.load()
      const found = s2.lookupPage('ws-1', 'https://example.com/a')
      expect(found?.title).toBe('A')
      expect(found?.content).toBe('v1')
      expect(found?.lang).toBe('en')
      const visits = s2.listVisits(found!.id)
      expect(visits).toHaveLength(1)
      expect(visits[0].dwell_ms).toBe(5000)
    })

    it('parser rejects pages with invalid invariants (updated_at < created_at, non-integer visited_count, etc.)', async () => {
      const now = Date.now()
      await fs.writeFile(
        filePath,
        JSON.stringify({
          pages: [
            // updated_at < created_at
            {
              id: 'p-bad-1',
              workspace_id: 'w',
              url: 'u',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1,
              created_at: now,
              updated_at: now - 1000
            },
            // visited_count NaN
            {
              id: 'p-bad-2',
              workspace_id: 'w',
              url: 'u2',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: Number.NaN,
              created_at: now,
              updated_at: now
            },
            // visited_count float
            {
              id: 'p-bad-3',
              workspace_id: 'w',
              url: 'u3',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1.5,
              created_at: now,
              updated_at: now
            },
            // valid
            {
              id: 'p-good',
              workspace_id: 'w',
              url: 'https://ok.com/x',
              title: 'ok',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1,
              created_at: now,
              updated_at: now
            }
          ],
          visits: []
        }),
        'utf-8'
      )
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countPages()).toBe(1)
      expect(store.getPage('p-good')).not.toBeNull()
    })

    it('parser drops orphan visits (page_id not in pages set)', async () => {
      const now = Date.now()
      await fs.writeFile(
        filePath,
        JSON.stringify({
          pages: [
            {
              id: 'p1',
              workspace_id: 'w',
              url: 'https://u/1',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1,
              created_at: now,
              updated_at: now
            }
          ],
          visits: [
            {
              id: 'v1',
              page_id: 'p1',
              workspace_id: 'w',
              visited_at: now,
              dwell_ms: 0
            },
            {
              id: 'v2',
              page_id: 'p-orphan',
              workspace_id: 'w',
              visited_at: now,
              dwell_ms: 0
            }
          ]
        }),
        'utf-8'
      )
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countVisits()).toBe(1)
    })
  })

  describe('clearAll', () => {
    it('removes memory + disk', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const { page } = await store.upsertPage({ url: 'https://example.com/a', content: 'v' })
      await store.createVisit({ page_id: page.id })
      await store.clearAll()
      expect(store.countPages()).toBe(0)
      expect(store.countVisits()).toBe(0)
      await expect(fs.readFile(filePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('LRU (maxBytes)', () => {
    it('trims half of Pages by lastVisitedAt when serialized size exceeds maxBytes', async () => {
      const store = new IndexedPageStore(filePath, { maxBytes: 1500 })
      await store.load()
      const ids: string[] = []
      for (let i = 0; i < 8; i++) {
        const { page } = await store.upsertPage({
          url: `https://example.com/${i}`,
          title: 'x'.repeat(50),
          content: 'y'.repeat(50)
        })
        await store.createVisit({ page_id: page.id, visited_at: 1000 + i })
        ids.push(page.id)
        await new Promise((r) => setTimeout(r, 1))
      }
      expect(store.countPages()).toBeLessThan(8)
      expect(store.countPages()).toBeGreaterThan(0)
      // 가장 최근 visit 의 page 는 살아있어야 함
      expect(store.getPage(ids[ids.length - 1])).not.toBeNull()
    })
  })

  describe('error handling', () => {
    it('throws when methods called before load()', async () => {
      const store = new IndexedPageStore(filePath)
      await expect(store.upsertPage({ url: 'u' })).rejects.toThrow('load() not called')
      expect(() => store.lookupPage('w', 'u')).toThrow('load() not called')
    })
  })

  // M2-2 codex 핫픽스 — PRD §05.4.1 단일 TX 정합 원자 메서드
  describe('recordVisit (PRD §05.4.1 단일 TX)', () => {
    it('creates Page + Visit in a single call (action=created)', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r = await store.recordVisit({
        url: 'https://example.com/a',
        title: 'A',
        content: 'hello',
        lang: 'en',
        dwell_ms: 1000
      })
      expect(r.action).toBe('created')
      expect(r.page.visited_count).toBe(1)
      expect(r.visit.page_id).toBe(r.page.id)
      expect(r.visit.workspace_id).toBe(r.page.workspace_id)
      expect(r.visit.dwell_ms).toBe(1000)
      expect(store.countPages()).toBe(1)
      expect(store.countVisits()).toBe(1)
    })

    it('records subsequent visit: action=unchanged, visited_count++, new Visit row', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r1 = await store.recordVisit({ url: 'https://example.com/a', content: 'v' })
      const r2 = await store.recordVisit({ url: 'https://example.com/a', content: 'v' })
      expect(r2.action).toBe('unchanged')
      expect(r2.page.id).toBe(r1.page.id)
      expect(r2.page.visited_count).toBe(2)
      expect(r2.visit.id).not.toBe(r1.visit.id)
      expect(store.countVisits()).toBe(2)
    })

    it('content change: action=updated_changed, visited_count++, new Visit row', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      await store.recordVisit({ url: 'https://example.com/a', content: 'v1' })
      const r2 = await store.recordVisit({ url: 'https://example.com/a', content: 'v2' })
      expect(r2.action).toBe('updated_changed')
      expect(r2.page.content).toBe('v2')
      expect(r2.page.visited_count).toBe(2)
      expect(store.countVisits()).toBe(2)
    })

    it('workspace_id propagates from input to both Page and Visit', async () => {
      const store = new IndexedPageStore(filePath)
      await store.load()
      const r = await store.recordVisit({
        workspace_id: 'ws-xyz',
        url: 'https://example.com/a',
        content: 'v'
      })
      expect(r.page.workspace_id).toBe('ws-xyz')
      expect(r.visit.workspace_id).toBe('ws-xyz')
    })
  })

  // M2-2 codex 핫픽스 — load() workspace_id 동기화 검증
  describe('load() Visit ↔ Page workspace_id 동기화 (codex 핫픽스)', () => {
    it('drops Visit whose workspace_id differs from referenced Page.workspace_id', async () => {
      const now = Date.now()
      await fs.writeFile(
        filePath,
        JSON.stringify({
          pages: [
            {
              id: 'p1',
              workspace_id: 'ws-A',
              url: 'https://u/1',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1,
              created_at: now,
              updated_at: now
            }
          ],
          visits: [
            // valid: workspace_id 일치
            {
              id: 'v-ok',
              page_id: 'p1',
              workspace_id: 'ws-A',
              visited_at: now,
              dwell_ms: 0
            },
            // mismatch: page는 ws-A 인데 visit은 ws-B
            {
              id: 'v-mismatch',
              page_id: 'p1',
              workspace_id: 'ws-B',
              visited_at: now,
              dwell_ms: 0
            }
          ]
        }),
        'utf-8'
      )
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countVisits()).toBe(1)
      const visits = store.listVisits('p1')
      expect(visits.map((v) => v.id)).toEqual(['v-ok'])
    })
  })

  // M2-2 codex 핫픽스 — epoch-ms Integer 검증
  describe('parseEntry timestamp Integer 검증 (codex 핫픽스)', () => {
    async function writePages(pages: unknown[]) {
      await fs.writeFile(filePath, JSON.stringify({ pages, visits: [] }), 'utf-8')
    }

    it('rejects Page with fractional created_at (1.5)', async () => {
      await writePages([
        {
          id: 'p1',
          workspace_id: 'w',
          url: 'u',
          title: '',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 1,
          created_at: 1.5,
          updated_at: 100
        }
      ])
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countPages()).toBe(0)
    })

    it('rejects Page with Infinity updated_at', async () => {
      await writePages([
        {
          id: 'p1',
          workspace_id: 'w',
          url: 'u',
          title: '',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 1,
          created_at: 100,
          updated_at: Number.POSITIVE_INFINITY
        }
      ])
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countPages()).toBe(0)
    })

    it('rejects Visit with fractional visited_at (1.5)', async () => {
      const now = Date.now()
      await fs.writeFile(
        filePath,
        JSON.stringify({
          pages: [
            {
              id: 'p1',
              workspace_id: 'w',
              url: 'u',
              title: '',
              content: '',
              content_hash: null,
              lang: null,
              visited_count: 1,
              created_at: now,
              updated_at: now
            }
          ],
          visits: [
            {
              id: 'v-bad',
              page_id: 'p1',
              workspace_id: 'w',
              visited_at: 1.5,
              dwell_ms: 0
            },
            {
              id: 'v-good',
              page_id: 'p1',
              workspace_id: 'w',
              visited_at: now,
              dwell_ms: 0
            }
          ]
        }),
        'utf-8'
      )
      const store = new IndexedPageStore(filePath)
      await store.load()
      expect(store.countVisits()).toBe(1)
    })
  })
})
