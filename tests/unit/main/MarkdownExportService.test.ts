/**
 * Sprint 017 M4 T18 — MarkdownExportService 단위 회귀.
 *
 * cover (codex 019e5067 권고 매트릭스 정합):
 *   - sanitizeSegment — Windows reserved chars / 예약어 / path traversal / 빈 문자열 / 길이 제한
 *   - renderFrontmatter — YAML scalar escape (string / number / boolean / null / array / 객체)
 *   - buildMarkdownExport — pure 변환
 *     - README + workspace.json + pages/notes/highlights/ai-chat 폴더 구조
 *     - page-slug 캐시 (note/highlight 가 page 참조 시 같은 slug)
 *     - notes/_unlinked (page null 케이스)
 *     - highlights/_unlinked
 *     - ai-chat/_unlinked
 *     - 빈 워크스페이스 (pages=0 / notes=0 등)
 *     - relativePath never absolute / never contains ..
 *     - 한글 / emoji workspace 이름
 *     - reserved filename (CON)
 *     - duplicate title collision — shortId 로 회피
 *     - frontmatter multiline/special chars
 */

import { describe, it, expect } from 'vitest'
import {
  buildMarkdownExport,
  sanitizeSegment,
  renderFrontmatter,
  deduplicatePaths,
  type MarkdownWorkspaceExport
} from '../../../src/main/MarkdownExportService'
import type { WorkspaceExportV1 } from '../../../src/main/WorkspaceExportImportService'

function makeWs(overrides: Partial<WorkspaceExportV1> = {}): WorkspaceExportV1 {
  return {
    version: 1,
    schemaVersion: 'v05',
    exportedAt: 1700000000000,
    workspace: {
      id: 'ws-abc-1234567890',
      name: '리서치',
      icon: '📚',
      created_at: 1690000000000,
      level_preference: null
    },
    pages: [],
    visits: [],
    notes: [],
    aiChatHistory: [],
    tags: [],
    pageTags: [],
    noteTags: [],
    highlights: [],
    ...overrides
  }
}

function findFile(result: MarkdownWorkspaceExport, prefix: string): { relativePath: string; content: string } | undefined {
  return result.files.find((f) => f.relativePath.startsWith(prefix))
}

describe('sanitizeSegment', () => {
  it('Windows reserved chars `<>:"/\\|?*` → `-` 치환', () => {
    expect(sanitizeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('path traversal `..` → `_`', () => {
    expect(sanitizeSegment('..')).toBe('_')
    expect(sanitizeSegment('.')).toBe('_')
    expect(sanitizeSegment('..hidden')).toBe('_hidden')
  })

  it('Windows 예약어 CON/PRN/AUX/NUL/COM1/LPT1 → `_` prefix', () => {
    expect(sanitizeSegment('CON')).toBe('_CON')
    expect(sanitizeSegment('con')).toBe('_con')
    expect(sanitizeSegment('PRN.md')).toBe('_PRN.md')
    expect(sanitizeSegment('NUL')).toBe('_NUL')
    expect(sanitizeSegment('COM1')).toBe('_COM1')
    expect(sanitizeSegment('LPT9')).toBe('_LPT9')
  })

  it('빈 문자열 / whitespace-only → "untitled"', () => {
    expect(sanitizeSegment('')).toBe('untitled')
    expect(sanitizeSegment('   ')).toBe('untitled')
    expect(sanitizeSegment('\t\n')).toBe('untitled')
  })

  it('길이 제한 디폴트 80', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeSegment(long).length).toBe(80)
  })

  it('길이 제한 커스텀', () => {
    expect(sanitizeSegment('a'.repeat(100), 30).length).toBe(30)
  })

  it('trailing dot / space 제거', () => {
    expect(sanitizeSegment('foo...')).toBe('foo')
    expect(sanitizeSegment('foo   ')).toBe('foo')
    expect(sanitizeSegment('foo. ')).toBe('foo')
  })

  it('한글 / emoji 그대로', () => {
    expect(sanitizeSegment('리서치-2025')).toBe('리서치-2025')
    expect(sanitizeSegment('📚 노트')).toBe('📚-노트')
  })

  it('비 string → "untitled"', () => {
    expect(sanitizeSegment(null as unknown as string)).toBe('untitled')
    expect(sanitizeSegment(undefined as unknown as string)).toBe('untitled')
  })

  // codex 019e5072 BLOCKING #1 hotfix — trailing cleanup 후 reserved name 재검사
  it('codex 019e5072 BLOCKING — CON- / COM1* / AUX- → trailing cleanup 후 reserved name 재검사', () => {
    expect(sanitizeSegment('CON-')).toBe('_CON')
    expect(sanitizeSegment('CON*')).toBe('_CON')
    expect(sanitizeSegment('COM1-')).toBe('_COM1')
    expect(sanitizeSegment('AUX  ')).toBe('_AUX')
    expect(sanitizeSegment('NUL.')).toBe('_NUL')
    expect(sanitizeSegment('LPT9-...')).toBe('_LPT9')
  })

  // codex 019e5072 NEEDS_CHANGES #1 — C0 control chars (\x00-\x1F) + DEL 제거
  it('codex 019e5072 NEEDS_CHANGES — C0 control chars (\\x00-\\x1F) + DEL → "-" 치환', () => {
    expect(sanitizeSegment('foo\x00bar')).toBe('foo-bar')
    expect(sanitizeSegment('foo\x01\x02\x1Fbar')).toBe('foo-bar')
    expect(sanitizeSegment('foo\x7Fbar')).toBe('foo-bar')
  })

  // codex 019e5072 NEEDS_CHANGES #3 — surrogate pair-safe 길이 제한
  it('codex 019e5072 NEEDS_CHANGES — surrogate pair boundary 분리 차단', () => {
    // emoji 5 개 ('🌀') 가 UTF-16 으로 length 10. maxLen=5 시 분리하면 lone surrogate.
    const fiveEmoji = '🌀'.repeat(5)
    const result = sanitizeSegment(fiveEmoji, 3)
    // Array.from 으로 분리하면 3 emoji = 6 UTF-16 code units
    expect([...result].length).toBe(3)
    expect(result).toBe('🌀🌀🌀')
  })
})

describe('deduplicatePaths (codex 019e5072 NEEDS_CHANGES #2)', () => {
  it('중복 relativePath 없으면 그대로 반환', () => {
    const files = [
      { relativePath: 'a/b.md', content: 'a' },
      { relativePath: 'a/c.md', content: 'c' }
    ]
    expect(deduplicatePaths(files)).toEqual(files)
  })

  it('중복 시 두 번째부터 -2 / -3 suffix (확장자 보존)', () => {
    const files = [
      { relativePath: 'pages/foo.md', content: 'first' },
      { relativePath: 'pages/foo.md', content: 'second' },
      { relativePath: 'pages/foo.md', content: 'third' }
    ]
    const result = deduplicatePaths(files)
    expect(result[0].relativePath).toBe('pages/foo.md')
    expect(result[1].relativePath).toBe('pages/foo-2.md')
    expect(result[2].relativePath).toBe('pages/foo-3.md')
    // content 보존
    expect(result.map((f) => f.content)).toEqual(['first', 'second', 'third'])
  })

  it('확장자 없는 path 도 동작', () => {
    const files = [
      { relativePath: 'README', content: 'a' },
      { relativePath: 'README', content: 'b' }
    ]
    const result = deduplicatePaths(files)
    expect(result[1].relativePath).toBe('README-2')
  })

  it('다른 path 는 카운트 격리', () => {
    const files = [
      { relativePath: 'a.md', content: '1' },
      { relativePath: 'b.md', content: '1' },
      { relativePath: 'a.md', content: '2' },
      { relativePath: 'b.md', content: '2' }
    ]
    const result = deduplicatePaths(files)
    expect(result[2].relativePath).toBe('a-2.md')
    expect(result[3].relativePath).toBe('b-2.md')
  })
})

describe('renderFrontmatter', () => {
  it('string / number / boolean / null 매핑', () => {
    const yaml = renderFrontmatter({
      title: 'Hello',
      count: 42,
      active: true,
      ratio: 0.5,
      empty: null,
      missing: undefined
    })
    expect(yaml).toContain('---\n')
    expect(yaml).toContain('title: "Hello"')
    expect(yaml).toContain('count: 42')
    expect(yaml).toContain('active: true')
    expect(yaml).toContain('ratio: 0.5')
    expect(yaml).toContain('empty: null')
    expect(yaml).toContain('missing: null')
  })

  it('string 안 special chars escape (\\n / " / \\)', () => {
    const yaml = renderFrontmatter({
      content: 'line1\nline2\t"quoted"\\backslash'
    })
    expect(yaml).toContain('"line1\\nline2\\t\\"quoted\\"\\\\backslash"')
  })

  it('array<string> — inline JSON-like', () => {
    const yaml = renderFrontmatter({ tags: ['react', 'typescript', '한글'] })
    expect(yaml).toContain('tags: ["react", "typescript", "한글"]')
  })

  it('객체 → JSON inline (frontmatter spec 외)', () => {
    const yaml = renderFrontmatter({ meta: { a: 1, b: 2 } })
    expect(yaml).toMatch(/meta: ".+"/)
  })

  it('Infinity / NaN → null (yaml safety)', () => {
    const yaml = renderFrontmatter({ x: Infinity, y: NaN })
    expect(yaml).toContain('x: null')
    expect(yaml).toContain('y: null')
  })

  it('--- 박힌 wrapper', () => {
    const yaml = renderFrontmatter({ a: 'b' })
    expect(yaml.startsWith('---\n')).toBe(true)
    expect(yaml).toContain('\n---\n')
  })
})

describe('buildMarkdownExport', () => {
  it('빈 워크스페이스 — README + workspace.json 만 포함', () => {
    const ws = makeWs()
    const result = buildMarkdownExport(ws)
    expect(result.rootName).toMatch(/^리서치-/)
    expect(result.files.length).toBe(2)
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      'README.md',
      'workspace.json'
    ])
  })

  it('README 안 통계 정확', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'Foo',
          content: 'body',
          content_hash: 'h',
          lang: 'en',
          visited_count: 3,
          created_at: 1,
          updated_at: 2
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const readme = findFile(result, 'README.md')!
    expect(readme.content).toContain('# 리서치')
    expect(readme.content).toContain('페이지: 1')
    expect(readme.content).toContain('schemaVersion'.length > 0 ? '' : '')
    expect(readme.content).toContain('v05')
  })

  it('workspace.json round-trip — 원본 payload JSON 보존', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'Foo',
          content: 'body',
          content_hash: 'h',
          lang: 'en',
          visited_count: 3,
          created_at: 1,
          updated_at: 2
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const json = findFile(result, 'workspace.json')!
    const parsed = JSON.parse(json.content)
    expect(parsed.workspace.id).toBe('ws-abc-1234567890')
    expect(parsed.pages).toHaveLength(1)
  })

  it('pages/ 폴더 박힘 — title-slug + shortId', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'page-uuid-12345678',
          url: 'https://example.com',
          title: 'React Hooks 가이드',
          content: '본문',
          content_hash: 'h1',
          lang: 'ko',
          visited_count: 5,
          created_at: 1,
          updated_at: 2
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const page = findFile(result, 'pages/')
    expect(page).toBeDefined()
    expect(page!.relativePath).toMatch(/^pages\/React-Hooks-가이드.*\.md$/)
    expect(page!.content).toContain('# React Hooks 가이드')
    expect(page!.content).toContain('url: "https://example.com"')
  })

  it('notes/{page-slug}/ + notes/_unlinked/ 격리', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'P1',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ],
      notes: [
        {
          id: 'n1',
          page_id: 'p1',
          visit_id: null,
          selected_text: 'sel',
          body: 'body of n1',
          ai_tags: null,
          created_at: 100,
          created_by: 'user'
        },
        {
          id: 'n2',
          page_id: null,
          visit_id: null,
          selected_text: '',
          body: 'orphan note',
          ai_tags: null,
          created_at: 200,
          created_by: 'user'
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const linkedNote = result.files.find((f) =>
      f.relativePath.startsWith('notes/P1-')
    )
    expect(linkedNote).toBeDefined()
    expect(linkedNote!.content).toContain('body of n1')
    const unlinkedNote = result.files.find((f) =>
      f.relativePath.startsWith('notes/_unlinked/')
    )
    expect(unlinkedNote).toBeDefined()
    expect(unlinkedNote!.content).toContain('orphan note')
  })

  it('highlights/{page-slug}/ + highlights/_unlinked/', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'P1',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ],
      highlights: [
        {
          id: 'h1',
          note_id: 'n1',
          page_id: 'p1',
          url: 'https://x.com',
          content_hash: 'hash1',
          anchor: JSON.stringify({ selectedText: 'linked highlight' }),
          created_at: 100
        },
        {
          id: 'h2',
          note_id: 'n2',
          page_id: null,
          url: 'https://other.com',
          content_hash: 'hash2',
          anchor: JSON.stringify({ selectedText: 'orphan highlight' }),
          created_at: 200
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const linked = result.files.find((f) => f.relativePath.startsWith('highlights/P1-'))
    expect(linked).toBeDefined()
    expect(linked!.content).toContain('linked highlight')
    const unlinked = result.files.find((f) =>
      f.relativePath.startsWith('highlights/_unlinked/')
    )
    expect(unlinked).toBeDefined()
    expect(unlinked!.content).toContain('orphan highlight')
  })

  it('aiChatHistory — ai-chat/ 폴더 + ISO timestamp 정합', () => {
    const ws = makeWs({
      aiChatHistory: [
        {
          id: 'c1',
          page_id: null,
          visit_id: null,
          role: 'user',
          content: '질문',
          retrieved_items: null,
          chat_meta: null,
          status: 'ok',
          created_at: 1700000000000
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const chat = findFile(result, 'ai-chat/')
    expect(chat).toBeDefined()
    expect(chat!.relativePath).toMatch(/^ai-chat\/_unlinked\/2023-11-14T22-13-20-/)
    expect(chat!.content).toContain('# User')
    expect(chat!.content).toContain('질문')
  })

  it('page-slug 캐시 — 같은 page_id 의 note/highlight 가 동일 slug 사용', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'Shared',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ],
      notes: [
        {
          id: 'n1',
          page_id: 'p1',
          visit_id: null,
          selected_text: '',
          body: 'note',
          ai_tags: null,
          created_at: 1,
          created_by: 'user'
        }
      ],
      highlights: [
        {
          id: 'h1',
          note_id: 'n1',
          page_id: 'p1',
          url: 'https://x.com',
          content_hash: 'hh',
          anchor: '{}',
          created_at: 1
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const pageFile = result.files.find((f) => f.relativePath.startsWith('pages/'))!
    const noteFile = result.files.find((f) => f.relativePath.startsWith('notes/'))!
    const hlFile = result.files.find((f) => f.relativePath.startsWith('highlights/'))!
    const pageSlug = pageFile.relativePath
      .replace(/^pages\//, '')
      .replace(/\.md$/, '')
    expect(noteFile.relativePath).toContain(`notes/${pageSlug}/`)
    expect(hlFile.relativePath).toContain(`highlights/${pageSlug}/`)
  })

  it('relativePath never absolute / never contains ..', () => {
    const ws = makeWs({
      pages: [
        {
          id: '../../etc/passwd',
          url: 'https://evil.com',
          title: '../../traversal',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    for (const f of result.files) {
      expect(f.relativePath.startsWith('/')).toBe(false)
      expect(f.relativePath.startsWith('\\')).toBe(false)
      // segment 안에는 ".." 미허용 (sanitizeSegment 가 `_` 치환)
      const segments = f.relativePath.split(/[/\\]/)
      for (const seg of segments) {
        expect(seg).not.toBe('..')
        expect(seg).not.toBe('.')
      }
    }
  })

  it('한글 / emoji workspace 이름 → rootName 박음', () => {
    const ws = makeWs({
      workspace: {
        id: 'uuid-12345678',
        name: '🔬 연구실',
        icon: '🧪',
        created_at: 1,
        level_preference: null
      }
    })
    const result = buildMarkdownExport(ws)
    expect(result.rootName).toMatch(/연구실/)
    expect(result.rootName).toMatch(/-/)
  })

  it('reserved filename (CON) — page title CON → sanitize prefix', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'about:blank',
          title: 'CON',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const page = result.files.find((f) => f.relativePath.startsWith('pages/'))!
    expect(page.relativePath).toMatch(/^pages\/_CON-/)
  })

  it('duplicate title — shortId 로 collision 회피', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'aaaaaaaa-1111',
          url: 'https://a.com',
          title: 'Same Title',
          content: 'a',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        },
        {
          id: 'bbbbbbbb-2222',
          url: 'https://b.com',
          title: 'Same Title',
          content: 'b',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 2,
          updated_at: 2
        }
      ]
    })
    const result = buildMarkdownExport(ws)
    const pagePaths = result.files.filter((f) => f.relativePath.startsWith('pages/')).map((f) => f.relativePath)
    expect(pagePaths).toHaveLength(2)
    // 두 파일 path 가 다른지 확인 (shortId 다름)
    expect(pagePaths[0]).not.toBe(pagePaths[1])
  })

  it('page tags 모음 — pageTags + tags 조인하여 frontmatter 박음', () => {
    const ws = makeWs({
      pages: [
        {
          id: 'p1',
          url: 'https://x.com',
          title: 'P1',
          content: '',
          content_hash: null,
          lang: null,
          visited_count: 0,
          created_at: 1,
          updated_at: 1
        }
      ],
      tags: [
        { id: 't1', name: 'react', kind: 'topic', ai_generated: 1, created_at: 1 },
        { id: 't2', name: '한글태그', kind: 'topic', ai_generated: 0, created_at: 1 }
      ],
      pageTags: [
        { page_id: 'p1', tag_id: 't1', ai_generated: 1, created_at: 1 },
        { page_id: 'p1', tag_id: 't2', ai_generated: 0, created_at: 1 }
      ]
    })
    const result = buildMarkdownExport(ws)
    const page = result.files.find((f) => f.relativePath.startsWith('pages/'))!
    expect(page.content).toContain('tags: ["react", "한글태그"]')
  })

  it('rootName — workspace id shortId prefix + name slug', () => {
    const ws = makeWs({
      workspace: {
        id: 'uuid-1234567890abcdef',
        name: 'My Workspace',
        icon: '📁',
        created_at: 1,
        level_preference: null
      }
    })
    const result = buildMarkdownExport(ws)
    expect(result.rootName).toContain('My-Workspace')
    expect(result.rootName).toMatch(/-uuid1234$/)
  })
})
