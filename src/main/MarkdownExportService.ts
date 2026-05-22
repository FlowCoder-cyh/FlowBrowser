/**
 * Sprint 017 M4 T18 — Workspace Markdown Export (PRD §11.5.6 Phase 3).
 *
 * 책임:
 *   - `WorkspaceExportImportService.exportWorkspace` 결과를 받아 Markdown 폴더 구조로 변환
 *   - YAML frontmatter (직접 생성, 외부 dep 0) + page/note/highlight/chat MD 본문 합성
 *   - service 는 위치를 모름 — `{ rootName, files: [{relativePath, content}] }` 반환만
 *   - 호출자 (IPC handler / dialog) 가 사용자 선택 폴더 + fs.writeFile 책임 분리
 *
 * 비책임:
 *   - 실제 디스크 쓰기 (호출자)
 *   - 압축 / 아카이브 (사용자 폴더 그대로)
 *   - vec_pages / vec_notes 임베딩 (export 대상 외, KI-022 동일 정책)
 *
 * codex 019e5067 사전 협의 권고 흡수:
 *   - JSON Export SSOT 재사용 — DB 직접 조회 X
 *   - category-first 폴더 구조 (`pages/` / `notes/` / `highlights/` / `ai-chat/` + `_unlinked/`)
 *   - `{title-slug}-{shortId}.md` 파일명 (UX + 충돌 회피)
 *   - YAML frontmatter 직접 생성 (js-yaml dep 0)
 *   - Windows reserved 문자 / 예약어 / path traversal / 길이 제한 sanitize 강제
 *   - aiChatHistory 포함 (portability)
 */

import type {
  WorkspaceExportV1,
  WorkspaceExportImportService
} from './WorkspaceExportImportService'
import { WorkspaceExportImportError } from './WorkspaceExportImportService'

/** 단일 출력 파일. relativePath 는 root 기준 ('/' 또는 OS-agnostic 구분자). */
export interface MarkdownExportFile {
  relativePath: string
  content: string
}

export interface MarkdownWorkspaceExport {
  /** root 폴더명 (workspace slug + shortId). 사용자 선택 위치 아래 본 이름으로 생성. */
  rootName: string
  files: MarkdownExportFile[]
}

export interface MarkdownExportServiceOptions {
  exportImport: WorkspaceExportImportService
}

export class MarkdownExportService {
  private readonly exportImport: WorkspaceExportImportService

  constructor(opts: MarkdownExportServiceOptions) {
    this.exportImport = opts.exportImport
  }

  /**
   * 워크스페이스를 Markdown 폴더 구조로 변환.
   *
   * workspace_not_found 는 `WorkspaceExportImportError` 그대로 전파 (caller 가 매핑).
   */
  exportWorkspaceMarkdown(workspaceId: string): MarkdownWorkspaceExport {
    const payload = this.exportImport.exportWorkspace(workspaceId)
    return buildMarkdownExport(payload)
  }
}

/**
 * pure 변환 — 단위 회귀에서 직접 호출 가능. JSON payload → Markdown files.
 */
export function buildMarkdownExport(payload: WorkspaceExportV1): MarkdownWorkspaceExport {
  const wsSlug = sanitizeSegment(payload.workspace.name, 60)
  const wsShortId = shortId(payload.workspace.id)
  const rootName = `${wsSlug}-${wsShortId}`
  const files: MarkdownExportFile[] = []

  // page-slug 캐시 — note/highlight 가 page 참조 시 같은 slug 재사용 (collision-safe).
  const pageSlugById = new Map<string, string>()
  for (const p of payload.pages) {
    const slug = `${sanitizeSegment(p.title || p.url || 'untitled', 80)}-${shortId(p.id)}`
    pageSlugById.set(p.id, slug)
  }

  // 1. README.md — 통계 + 폴더 안내
  files.push({
    relativePath: 'README.md',
    content: renderReadme(payload, rootName)
  })

  // 2. workspace.json — 원본 JSON payload (round-trip 가능, KI-008 정합)
  files.push({
    relativePath: 'workspace.json',
    content: JSON.stringify(payload, null, 2) + '\n'
  })

  // 3. pages/{slug}.md
  for (const p of payload.pages) {
    const slug = pageSlugById.get(p.id)!
    const tagsForPage = collectTagsForPage(payload, p.id)
    files.push({
      relativePath: `pages/${slug}.md`,
      content: renderPage(p, tagsForPage)
    })
  }

  // 4. notes/{page-slug}/{note-snippet-shortId}.md (or notes/_unlinked/...)
  for (const n of payload.notes) {
    const noteSnippet = sanitizeSegment(noteSnippetFor(n), 40)
    const noteFileBase = `${noteSnippet}-${shortId(n.id)}.md`
    const parent = n.page_id && pageSlugById.has(n.page_id)
      ? `notes/${pageSlugById.get(n.page_id)!}`
      : 'notes/_unlinked'
    files.push({
      relativePath: `${parent}/${noteFileBase}`,
      content: renderNote(n, payload, pageSlugById)
    })
  }

  // 5. highlights/{page-slug}/{snippet-shortId}.md (or highlights/_unlinked/...)
  for (const h of payload.highlights) {
    const hSnippet = sanitizeSegment(highlightSnippetFor(h), 40)
    const hFileBase = `${hSnippet}-${shortId(h.id)}.md`
    const parent = h.page_id && pageSlugById.has(h.page_id)
      ? `highlights/${pageSlugById.get(h.page_id)!}`
      : 'highlights/_unlinked'
    files.push({
      relativePath: `${parent}/${hFileBase}`,
      content: renderHighlight(h, payload, pageSlugById)
    })
  }

  // 6. ai-chat/{createdAt}-{shortId}.md — page-slug-aware grouping
  for (const c of payload.aiChatHistory) {
    const stamp = new Date(c.created_at).toISOString().replace(/[:]/g, '-').slice(0, 19)
    const safeStamp = sanitizeSegment(stamp, 30)
    const fileBase = `${safeStamp}-${shortId(c.id)}.md`
    const parent = c.page_id && pageSlugById.has(c.page_id)
      ? `ai-chat/${pageSlugById.get(c.page_id)!}`
      : 'ai-chat/_unlinked'
    files.push({
      relativePath: `${parent}/${fileBase}`,
      content: renderChat(c)
    })
  }

  // codex 019e5072 NEEDS_CHANGES #2 hotfix — relativePath collision deterministic resolution.
  //   shortId (UUID 첫 8 char) 가 10K 페이지 시 ~1.16% birthday collision 가능. 같은
  //   sanitized title + 같은 shortId → 동일 relativePath → 후속 writer 가 overwrite 위험.
  //   service 가 files[] 소유 — collision 발견 시 `-{n}` suffix 박음 (n=2,3,...).
  return { rootName, files: deduplicatePaths(files) }
}

/**
 * 같은 `relativePath` 가 둘 이상이면 두 번째부터 `-{n}` suffix 박음 (확장자 보존).
 * 예: `pages/foo.md` 중복 → `pages/foo.md`, `pages/foo-2.md`, `pages/foo-3.md` ...
 *
 * pure helper — 단위 회귀 cover.
 */
export function deduplicatePaths(files: MarkdownExportFile[]): MarkdownExportFile[] {
  const seen = new Map<string, number>()
  return files.map((f) => {
    const count = seen.get(f.relativePath) ?? 0
    seen.set(f.relativePath, count + 1)
    if (count === 0) return f
    // 확장자 보존
    const dot = f.relativePath.lastIndexOf('.')
    const slash = f.relativePath.lastIndexOf('/')
    if (dot > slash && dot >= 0) {
      const stem = f.relativePath.slice(0, dot)
      const ext = f.relativePath.slice(dot)
      return { ...f, relativePath: `${stem}-${count + 1}${ext}` }
    }
    return { ...f, relativePath: `${f.relativePath}-${count + 1}` }
  })
}

// ============================================================================
// Renderers
// ============================================================================

function renderReadme(payload: WorkspaceExportV1, rootName: string): string {
  const counts = {
    pages: payload.pages.length,
    visits: payload.visits.length,
    notes: payload.notes.length,
    highlights: payload.highlights.length,
    tags: payload.tags.length,
    aiChat: payload.aiChatHistory.length
  }
  return `# ${escapeMarkdown(payload.workspace.name)}

> FlowBrowser AI Markdown Export — ${rootName}
> Exported at: ${new Date(payload.exportedAt).toISOString()}
> Schema version: ${payload.schemaVersion}

## 통계

- 페이지: ${counts.pages}
- 방문: ${counts.visits}
- 노트: ${counts.notes}
- 하이라이트: ${counts.highlights}
- 태그: ${counts.tags}
- AI 채팅: ${counts.aiChat}

## 폴더 구조

- \`pages/\` — 페이지 본문 + YAML frontmatter (url, tags)
- \`notes/{page-slug}/\` — 페이지 별 노트. 페이지 미연결 노트는 \`notes/_unlinked/\`
- \`highlights/{page-slug}/\` — 페이지 별 하이라이트 (selected_text + anchor metadata)
- \`ai-chat/{page-slug}/\` — 페이지 별 AI 채팅 기록
- \`workspace.json\` — 원본 JSON payload (round-trip Import 가능)
`
}

function renderPage(p: WorkspaceExportV1['pages'][number], tags: string[]): string {
  const fm: Record<string, unknown> = {
    id: p.id,
    type: 'page',
    title: p.title,
    url: p.url,
    lang: p.lang,
    visited_count: p.visited_count,
    created_at: new Date(p.created_at).toISOString(),
    updated_at: new Date(p.updated_at).toISOString(),
    content_hash: p.content_hash,
    tags
  }
  return `${renderFrontmatter(fm)}# ${escapeMarkdown(p.title || p.url)}

${p.content || ''}
`
}

function renderNote(
  n: WorkspaceExportV1['notes'][number],
  payload: WorkspaceExportV1,
  pageSlugById: Map<string, string>
): string {
  const page = n.page_id ? payload.pages.find((p) => p.id === n.page_id) ?? null : null
  const pageLink = page ? `pages/${pageSlugById.get(page.id)}.md` : null
  const fm: Record<string, unknown> = {
    id: n.id,
    type: 'note',
    page_id: n.page_id,
    visit_id: n.visit_id,
    page_url: page?.url,
    page_title: page?.title,
    selected_text: n.selected_text,
    created_at: new Date(n.created_at).toISOString(),
    created_by: n.created_by
  }
  const linkSection = pageLink ? `\n[원본 페이지](../../${pageLink})\n` : ''
  const selSection = n.selected_text
    ? `\n## 선택 텍스트\n\n> ${escapeMarkdown(n.selected_text)}\n`
    : ''
  return `${renderFrontmatter(fm)}# Note${linkSection}${selSection}
${n.body || ''}
`
}

function renderHighlight(
  h: WorkspaceExportV1['highlights'][number],
  payload: WorkspaceExportV1,
  pageSlugById: Map<string, string>
): string {
  const page = h.page_id ? payload.pages.find((p) => p.id === h.page_id) ?? null : null
  const pageLink = page ? `pages/${pageSlugById.get(page.id)}.md` : null
  // anchor JSON parse 가능성만 보장 — 본 export 는 raw 보존
  let anchorPreview = h.anchor
  try {
    const parsed = JSON.parse(h.anchor) as { selectedText?: string }
    if (parsed && typeof parsed.selectedText === 'string') {
      anchorPreview = parsed.selectedText
    }
  } catch {
    // raw 그대로
  }
  const fm: Record<string, unknown> = {
    id: h.id,
    type: 'highlight',
    note_id: h.note_id,
    page_id: h.page_id,
    page_url: page?.url,
    url: h.url,
    content_hash: h.content_hash,
    created_at: new Date(h.created_at).toISOString()
  }
  const linkSection = pageLink ? `\n[원본 페이지](../../${pageLink})\n` : ''
  return `${renderFrontmatter(fm)}# Highlight${linkSection}
> ${escapeMarkdown(anchorPreview)}
`
}

function renderChat(c: WorkspaceExportV1['aiChatHistory'][number]): string {
  const fm: Record<string, unknown> = {
    id: c.id,
    type: 'ai-chat',
    role: c.role,
    page_id: c.page_id,
    visit_id: c.visit_id,
    status: c.status,
    created_at: new Date(c.created_at).toISOString()
  }
  return `${renderFrontmatter(fm)}# ${capitalize(c.role)}

${c.content}
`
}

// ============================================================================
// YAML frontmatter (직접 생성, dep 0)
// ============================================================================

/**
 * pure helper. value 가 string/number/boolean/null/array<scalar> 만 지원.
 * 객체 / nested array 는 JSON inline 처리.
 */
export function renderFrontmatter(record: Record<string, unknown>): string {
  const lines: string[] = ['---']
  for (const [key, val] of Object.entries(record)) {
    lines.push(`${key}: ${yamlScalar(val)}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

function yamlScalar(val: unknown): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null'
  if (Array.isArray(val)) {
    // 모든 항목 string scalar 가정 (collectTagsForPage 결과)
    return `[${val.map((v) => quoteYamlString(String(v))).join(', ')}]`
  }
  if (typeof val === 'string') return quoteYamlString(val)
  // 객체는 JSON inline (frontmatter spec 외 부분, 호환성 회피)
  return quoteYamlString(JSON.stringify(val))
}

function quoteYamlString(s: string): string {
  // 항상 double-quote escape (multiline / special char 안전 — Obsidian/Foam 호환).
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

// ============================================================================
// Path / filename sanitize (codex 019e5067 Q10 권고)
// ============================================================================

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

/**
 * 단일 path segment 정규화. 외부 export 함수 — 단위 회귀 cover.
 *
 * 정책:
 *   - Windows reserved chars `<>:"/\\|?*` 와 control chars 모두 `-` 로 치환
 *   - path traversal `..` → `_`
 *   - 길이 제한 (디폴트 80자)
 *   - 예약어 (CON / PRN 등) → `_` prefix
 *   - trailing dot/space 제거
 *   - 빈 문자열 → 'untitled'
 */
export function sanitizeSegment(raw: string, maxLen: number = 80): string {
  if (typeof raw !== 'string') return 'untitled'
  const trimmed = raw.trim()
  if (trimmed.length === 0) return 'untitled'
  // Windows reserved chars + whitespace 각 별도 (eslint no-control-regex 회피)
  let s = trimmed.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-')
  // codex 019e5072 NEEDS_CHANGES #1 hotfix — C0 control chars (\x00-\x1F) + DEL (\x7F) 제거.
  //   fs.writeFile 안전성 + 일부 OS 의 invalid filename 차단. eslint no-control-regex 룰은
  //   하단 disable 주석으로 명시 (의도된 control char 매칭).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]+/g, '-')
  // path traversal
  if (s === '..' || s === '.') s = '_'
  s = s.replace(/^\.\.+/g, '_')
  if (s.length === 0) return 'untitled'
  // codex 019e5072 NEEDS_CHANGES #3 hotfix — surrogate pair-safe 길이 제한.
  //   `slice(0, maxLen)` 는 UTF-16 code unit 기준이라 emoji boundary 분리 위험. Array.from
  //   이 surrogate pair 를 단일 entry 로 처리.
  if ([...s].length > maxLen) s = Array.from(s).slice(0, maxLen).join('')
  // trailing dot/space/dash 제거 (UX + Windows trailing dot 회피)
  s = s.replace(/[.\- ]+$/g, '')
  if (s.length === 0) return 'untitled'
  // codex 019e5072 BLOCKING #1 hotfix — 예약어 검사는 모든 mutation/truncation 후 수행.
  //   `CON-` / `COM1*` 같은 입력이 trailing dash 제거 + reserved punctuation 치환 후 `CON` /
  //   `COM1` 으로 압축되어 Windows-safe invariant 위반 차단.
  const upper = s.toUpperCase()
  const base = upper.split('.')[0] ?? upper
  if (WINDOWS_RESERVED_NAMES.has(base)) s = `_${s}`
  return s
}

// ============================================================================
// Helpers
// ============================================================================

function shortId(uuid: string): string {
  if (typeof uuid !== 'string') return 'xxx'
  // UUID 의 첫 8 char 사용 (충돌 가능성 매우 낮음 + 가독성)
  return uuid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'xxx'
}

function noteSnippetFor(n: WorkspaceExportV1['notes'][number]): string {
  const candidate = (n.body || n.selected_text || '').replace(/\s+/g, ' ').trim()
  return candidate.length === 0 ? 'note' : candidate.slice(0, 30)
}

function highlightSnippetFor(h: WorkspaceExportV1['highlights'][number]): string {
  try {
    const parsed = JSON.parse(h.anchor) as { selectedText?: string }
    if (parsed && typeof parsed.selectedText === 'string' && parsed.selectedText.length > 0) {
      return parsed.selectedText.replace(/\s+/g, ' ').trim().slice(0, 30)
    }
  } catch {
    // raw fallback
  }
  return 'highlight'
}

function collectTagsForPage(payload: WorkspaceExportV1, pageId: string): string[] {
  const tagIds = payload.pageTags.filter((pt) => pt.page_id === pageId).map((pt) => pt.tag_id)
  const tagNames: string[] = []
  for (const tid of tagIds) {
    const tag = payload.tags.find((t) => t.id === tid)
    if (tag) tagNames.push(tag.name)
  }
  return tagNames
}

function escapeMarkdown(s: string): string {
  // 본문 안 H1 표현용 — `#` 등 escape 안 함 (사용자 콘텐츠 보존). 단순 trim 만.
  return (s ?? '').trim()
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// re-export for caller mapping
export { WorkspaceExportImportError }
