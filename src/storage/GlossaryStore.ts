/**
 * Sprint 005 M2 — GlossaryStore.
 * PRD §12.7 GlossaryTerm 1:1 정합.
 *
 * 사용자 정의 용어집. 번역 system/user prompt에 활성 용어 컨텍스트로 주입.
 * 용어집 mutation 시 version 갱신 → TranslationCache.invalidateByGlossaryVersion 호출 트리거.
 * JSON 영속 (콘텐츠 아님 → G-005 적용 외).
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

export interface GlossaryTerm {
  id: string
  sourceTerm: string
  targetTerm: string
  description: string
  domain: string
  isActive: boolean
  version: string
  createdAt: number
  updatedAt: number
}

export interface GlossaryExport {
  policyVersion: number
  currentVersion: string
  terms: GlossaryTerm[]
}

export type GlossaryValidationError =
  | 'empty_source'
  | 'empty_target'
  | 'too_long_source'
  | 'too_long_target'
  | 'duplicate'

export interface GlossaryValidationResult {
  ok: boolean
  error?: GlossaryValidationError
  normalized?: { sourceTerm: string; targetTerm: string }
}

export const GLOSSARY_POLICY_VERSION = 1
const MAX_TERM_LENGTH = 200
const MAX_ACTIVE_TERMS = 50

export function validateTerm(
  rawSource: string,
  rawTarget: string,
  existing: GlossaryTerm[] = []
): GlossaryValidationResult {
  const sourceTerm = (rawSource ?? '').trim()
  const targetTerm = (rawTarget ?? '').trim()
  if (!sourceTerm) return { ok: false, error: 'empty_source' }
  if (!targetTerm) return { ok: false, error: 'empty_target' }
  if (sourceTerm.length > MAX_TERM_LENGTH) return { ok: false, error: 'too_long_source' }
  if (targetTerm.length > MAX_TERM_LENGTH) return { ok: false, error: 'too_long_target' }
  const normalizedSource = sourceTerm.toLowerCase()
  if (
    existing.some(
      (t) => t.sourceTerm.toLowerCase() === normalizedSource && t.targetTerm === targetTerm
    )
  ) {
    return { ok: false, error: 'duplicate' }
  }
  return { ok: true, normalized: { sourceTerm, targetTerm } }
}

interface ListFilter {
  domain?: string
  activeOnly?: boolean
}

export class GlossaryStore {
  private terms: GlossaryTerm[] = []
  private currentVersion: string = 'default'
  private versionCounter = 0
  private loaded = false

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(buf) as Partial<GlossaryExport>
      this.currentVersion =
        typeof parsed.currentVersion === 'string' ? parsed.currentVersion : 'default'
      this.terms = Array.isArray(parsed.terms)
        ? parsed.terms.filter(
            (t): t is GlossaryTerm =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as GlossaryTerm).id === 'string' &&
              typeof (t as GlossaryTerm).sourceTerm === 'string' &&
              typeof (t as GlossaryTerm).targetTerm === 'string'
          )
        : []
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.terms = []
        this.currentVersion = 'default'
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  getVersion(): string {
    return this.currentVersion
  }

  list(filter: ListFilter = {}): GlossaryTerm[] {
    this.ensureLoaded()
    return this.terms.filter((t) => {
      if (filter.activeOnly && !t.isActive) return false
      if (filter.domain && t.domain && t.domain !== filter.domain) return false
      return true
    })
  }

  /**
   * 활성 용어 + 도메인 일치 (도메인 일치하거나 빈 도메인) 최대 N개.
   * 번역 prompt에 주입할 용도.
   */
  getActiveForDomain(domain: string | null, limit: number = MAX_ACTIVE_TERMS): GlossaryTerm[] {
    this.ensureLoaded()
    const matched = this.terms.filter((t) => {
      if (!t.isActive) return false
      if (!t.domain) return true // 도메인 없음 = 모든 도메인 적용
      if (!domain) return false
      return t.domain === domain
    })
    return matched.slice(0, limit)
  }

  async add(args: {
    sourceTerm: string
    targetTerm: string
    description?: string
    domain?: string
    isActive?: boolean
  }): Promise<{ ok: boolean; error?: GlossaryValidationError; term?: GlossaryTerm }> {
    this.ensureLoaded()
    const v = validateTerm(args.sourceTerm, args.targetTerm, this.terms)
    if (!v.ok || !v.normalized) return { ok: false, error: v.error }
    const now = Date.now()
    const term: GlossaryTerm = {
      id: `gt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      sourceTerm: v.normalized.sourceTerm,
      targetTerm: v.normalized.targetTerm,
      description: (args.description ?? '').trim(),
      domain: (args.domain ?? '').trim(),
      isActive: args.isActive ?? true,
      version: this.bumpVersion(),
      createdAt: now,
      updatedAt: now
    }
    this.terms.push(term)
    await this.persist()
    return { ok: true, term }
  }

  async update(
    id: string,
    patch: Partial<Pick<GlossaryTerm, 'sourceTerm' | 'targetTerm' | 'description' | 'domain' | 'isActive'>>
  ): Promise<{ ok: boolean; term?: GlossaryTerm }> {
    this.ensureLoaded()
    const idx = this.terms.findIndex((t) => t.id === id)
    if (idx < 0) return { ok: false }
    const now = Date.now()
    const updated: GlossaryTerm = {
      ...this.terms[idx],
      ...patch,
      version: this.bumpVersion(),
      updatedAt: now
    }
    this.terms[idx] = updated
    await this.persist()
    return { ok: true, term: updated }
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded()
    const before = this.terms.length
    this.terms = this.terms.filter((t) => t.id !== id)
    if (this.terms.length === before) return false
    this.bumpVersion()
    await this.persist()
    return true
  }

  async clearAll(): Promise<void> {
    this.terms = []
    this.bumpVersion()
    await this.persist()
  }

  /**
   * 외부 JSON import. 정책 버전 검증 + 전체 교체.
   */
  async importTerms(
    raw: unknown
  ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> {
    this.ensureLoaded()
    if (!raw || typeof raw !== 'object') {
      return { ok: false, accepted: 0, rejected: 0, error: 'invalid_root' }
    }
    const obj = raw as Partial<GlossaryExport>
    if (typeof obj.policyVersion !== 'number') {
      return { ok: false, accepted: 0, rejected: 0, error: 'missing_version' }
    }
    if (obj.policyVersion !== GLOSSARY_POLICY_VERSION) {
      return {
        ok: false,
        accepted: 0,
        rejected: 0,
        error: `unsupported_version_${obj.policyVersion}`
      }
    }
    if (!Array.isArray(obj.terms)) {
      return { ok: false, accepted: 0, rejected: 0, error: 'invalid_terms' }
    }
    const accepted: GlossaryTerm[] = []
    let rejected = 0
    const now = Date.now()
    for (const t of obj.terms) {
      if (!t || typeof t !== 'object') {
        rejected++
        continue
      }
      const term = t as Partial<GlossaryTerm>
      const v = validateTerm(term.sourceTerm ?? '', term.targetTerm ?? '', accepted)
      if (!v.ok || !v.normalized) {
        rejected++
        continue
      }
      accepted.push({
        id:
          typeof term.id === 'string'
            ? term.id
            : `gt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        sourceTerm: v.normalized.sourceTerm,
        targetTerm: v.normalized.targetTerm,
        description: typeof term.description === 'string' ? term.description : '',
        domain: typeof term.domain === 'string' ? term.domain : '',
        isActive: term.isActive !== false,
        version: typeof term.version === 'string' ? term.version : 'imported',
        createdAt: typeof term.createdAt === 'number' ? term.createdAt : now,
        updatedAt: now
      })
    }
    this.terms = accepted
    this.bumpVersion()
    await this.persist()
    return { ok: true, accepted: accepted.length, rejected }
  }

  exportTerms(): GlossaryExport {
    return {
      policyVersion: GLOSSARY_POLICY_VERSION,
      currentVersion: this.currentVersion,
      terms: [...this.terms]
    }
  }

  private bumpVersion(): string {
    this.versionCounter++
    // Sprint 009 M1 — 같은 ms 내 mutation 시에도 항상 다른 version 보장하기 위해
    // 단조 증가 counter를 stamp에 포함. (Sprint 008 evaluator flaky 직접 해소)
    const stamp = `${Date.now()}-${this.terms.length}-${this.versionCounter}`
    this.currentVersion = createHash('sha256').update(stamp).digest('hex').slice(0, 12)
    return this.currentVersion
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const payload = this.exportTerms()
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('GlossaryStore.load() not called')
    }
  }
}

export function defaultGlossaryPath(userDataDir: string): string {
  return join(userDataDir, 'glossary.json')
}

/**
 * 활성 용어들을 prompt 컨텍스트 블록으로 직렬화.
 * 빈 배열이면 빈 문자열.
 */
export function formatGlossaryContext(terms: GlossaryTerm[]): string {
  if (terms.length === 0) return ''
  const lines = terms.map((t) => {
    const note = t.description ? ` — ${t.description}` : ''
    return `- ${t.sourceTerm} → ${t.targetTerm}${note}`
  })
  return `Glossary (use these terms consistently):\n${lines.join('\n')}`
}
