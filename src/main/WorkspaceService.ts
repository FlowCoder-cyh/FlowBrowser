/**
 * Sprint 015 M6 T28 — WorkspaceService.
 *
 * 책임:
 *   - FlowbrowserDatabase workspaces 테이블 CRUD 위임 (create / list / get / update / delete)
 *   - UserSettingStore.activeWorkspaceId 영속 + getter
 *   - preset 12종 아이콘 상수 (PRD §11 + state.md L68)
 *   - 사용자 이모지 입력 검증 (UTF-8 emoji 1자)
 *   - 마지막 워크스페이스 삭제 시 "📥 기본" 자동 재생성 (§11.5.5)
 *   - 워크스페이스 cascade DELETE 후 vec_pages / vec_notes 명시 정리 (FK ON DELETE CASCADE + trigger 정합)
 *
 * 비책임 (Phase 2+):
 *   - 탭 그룹 stash/restore (§11.3.1) — Phase 2 TabManager workspace_id 메타 통합 시점
 *   - cookies/storage partition (§11.2.2) — Phase 2 WorkspacePartitionManager
 *   - JSON Import/Export (§11.5.6) — 본 PR 미포함, 별도 milestone
 *
 * 호출 패턴:
 *   const fb = FlowbrowserDatabase.bootstrap({ path })
 *   const svc = new WorkspaceService({ db: fb, userSettingStore })
 *   const ws = await svc.create({ name: 'GraphQL', icon: '💻' })
 *   await svc.setActive(ws.id)
 *   const active = svc.getActiveId()
 */

import type { FlowbrowserDatabase, LevelPreference, WorkspaceRow } from '../storage/Database'
import { DEFAULT_WORKSPACE_ICON, DEFAULT_WORKSPACE_NAME } from '../storage/Database'
import type { UserSettingStore } from '../storage/UserSettingStore'
// Sprint 018 M2 T17d — 워크스페이스 생성 시 사용자 선택 임베딩 모델 검증 (SSOT 정합).
import { isSupportedEmbeddingModel, type EmbeddingModelId } from '../storage/embeddingModel'

/**
 * PRD §11 + state.md L68 + v04-direction.md §17 P2-7 정합 — preset 12종.
 * 사용자가 입력 모달에서 1-click 선택. 순서: 학술 / 개발 / 작업 / 일상 / 연구 / 글쓰기 / 디자인 / 데이터 / 일반 / 법무 / 아이디어 / 쇼핑.
 */
export const WORKSPACE_PRESET_ICONS = [
  '📚',
  '💻',
  '🎯',
  '🏠',
  '🔬',
  '✍️',
  '🎨',
  '📊',
  '🌍',
  '⚖️',
  '💡',
  '🛒'
] as const

export type WorkspacePresetIcon = (typeof WORKSPACE_PRESET_ICONS)[number]

export interface WorkspaceServiceOptions {
  db: FlowbrowserDatabase
  userSettingStore: UserSettingStore
  /** 디폴트 워크스페이스 row (보통 ensureDefaultWorkspace 결과). 미주입 시 lazy ensureDefaultWorkspace. */
  defaultWorkspace?: WorkspaceRow
}

export interface CreateWorkspaceArgs {
  name: string
  icon: string
  level_preference?: LevelPreference
  /**
   * Sprint 018 M2 T17d — 사용자 선택 임베딩 모델 (full id). 미주입/null 시 DB DEFAULT.
   * 미지원 id 는 `WorkspaceValidationError('invalid_embedding_model')`.
   */
  embedding_model?: string | null
}

export interface UpdateWorkspaceArgs {
  id: string
  patch: {
    name?: string
    icon?: string
    level_preference?: LevelPreference
  }
}

export interface DeleteResult {
  deleted: boolean
  /** 마지막 1개 삭제 시 자동 생성된 신규 디폴트 워크스페이스 (있을 때만). */
  replacement?: WorkspaceRow
  /** 삭제 후 활성 워크스페이스 (id). */
  newActiveId: string
}

export class WorkspaceValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_name'
      | 'invalid_icon'
      | 'not_found'
      | 'no_change'
      | 'invalid_embedding_model'
  ) {
    super(code)
    this.name = 'WorkspaceValidationError'
  }
}

/**
 * `name` 검증 — NOT NULL, 1~50자, 공백만 거부.
 * 좌우 공백 trim 후 길이 측정 (Array.from 으로 코드포인트 카운트).
 */
function validateName(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkspaceValidationError('invalid_name')
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new WorkspaceValidationError('invalid_name')
  const codepoints = Array.from(trimmed)
  if (codepoints.length > 50) throw new WorkspaceValidationError('invalid_name')
  return trimmed
}

/**
 * `icon` 검증 — preset 12종 또는 사용자 이모지 1 grapheme cluster.
 *
 * 정책 (codex hotfix — NEEDS_CHANGES #2):
 *   1. preset 그대로 허용
 *   2. Intl.Segmenter 로 grapheme 1개만 허용
 *   3. base codepoint 가 반드시 emoji-presentation codepoint 여야 함 (Extended_Pictographic 근사)
 *   4. variation selector (U+FE0F) / ZWJ (U+200D) / skin tone modifier (U+1F3FB~1F3FF) 는
 *      **단독으로** emoji 자격 부여 X — base 가 반드시 emoji codepoint 여야 함
 *   5. 한글 / latin / 숫자 / control char 거부
 *
 * Node 18+ `Intl.Segmenter` 가 ZWJ family, regional indicator pair 를 1 grapheme 으로 정확 분할.
 * fallback path 는 Node 18 미만 또는 jsdom 환경 — Sprint 015 vitest 환경에서 Intl.Segmenter 보장.
 */
export function validateWorkspaceIcon(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkspaceValidationError('invalid_icon')
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new WorkspaceValidationError('invalid_icon')
  if ((WORKSPACE_PRESET_ICONS as readonly string[]).includes(trimmed)) return trimmed

  let grapheme: string | null = null
  let count = 0
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const part of seg.segment(trimmed)) {
      grapheme = part.segment
      count++
      if (count > 1) throw new WorkspaceValidationError('invalid_icon')
    }
  } else {
    // Fallback (Intl.Segmenter 부재) — 보수적 1~4 codepoint 검사. ZWJ family (5~7 cp) 거부.
    const cps = Array.from(trimmed)
    if (cps.length === 0 || cps.length > 4) throw new WorkspaceValidationError('invalid_icon')
    grapheme = trimmed
  }
  if (grapheme === null || count !== 1) throw new WorkspaceValidationError('invalid_icon')

  // 첫 codepoint 가 base emoji 여야 함 (Extended_Pictographic 근사).
  // FE0F / ZWJ / skin tone 단독은 base 자격 X.
  const baseCp = grapheme.codePointAt(0)!
  if (!isBaseEmojiCodepoint(baseCp)) {
    throw new WorkspaceValidationError('invalid_icon')
  }
  // 잔여 codepoint 는 FE0F / ZWJ / skin tone / 또 다른 base 만 허용.
  // (호환성: 'A️' 같은 latin + VS 는 base 검사에서 이미 거부됨).
  let i = baseCp > 0xffff ? 2 : 1 // skip first codepoint (surrogate pair = 2 utf16 unit)
  while (i < grapheme.length) {
    const cp = grapheme.codePointAt(i)!
    if (
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin tone modifier
      isBaseEmojiCodepoint(cp) || // ZWJ sequence 의 추가 base
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) // regional indicator (국기 second half)
    ) {
      i += cp > 0xffff ? 2 : 1
    } else {
      throw new WorkspaceValidationError('invalid_icon')
    }
  }
  return grapheme
}

/**
 * base emoji codepoint 검사 (Extended_Pictographic 의 보수적 근사).
 * Unicode Emoji 15.1 기준 주요 block.
 */
function isBaseEmojiCodepoint(cp: number): boolean {
  // skin tone modifier (U+1F3FB ~ U+1F3FF) 는 base 자격 X — 단독 거부.
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return false
  // SMP emoji block 의 base 만 (modifier / skin tone 제외).
  if (cp >= 0x1f300 && cp <= 0x1f5ff) return true // misc symbols + pictographs
  if (cp >= 0x1f600 && cp <= 0x1f64f) return true // emoticons
  if (cp >= 0x1f680 && cp <= 0x1f6ff) return true // transport + map
  if (cp >= 0x1f700 && cp <= 0x1f77f) return true // alchemical
  if (cp >= 0x1f780 && cp <= 0x1f7ff) return true // geometric ext
  if (cp >= 0x1f800 && cp <= 0x1f8ff) return true // supplemental arrows
  if (cp >= 0x1f900 && cp <= 0x1f9ff) return true // supplemental symbols
  if (cp >= 0x1fa00 && cp <= 0x1faff) return true // symbols and pictographs ext-A
  if (cp >= 0x2600 && cp <= 0x26ff) return true // misc symbols
  if (cp >= 0x2700 && cp <= 0x27bf) return true // dingbats
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true // regional indicator (국기 first half)
  // 일부 BMP 추가 emoji (예: ☺ U+263A 는 misc symbols 범위 안에 이미 포함)
  // 일부 misc technical (예: ⌚ U+231A, ⌛ U+231B)
  if (cp === 0x231a || cp === 0x231b) return true
  if (cp >= 0x23e9 && cp <= 0x23ec) return true
  if (cp === 0x23f0 || cp === 0x23f3) return true
  return false
}

function validateLevelPreference(raw: unknown): LevelPreference {
  if (raw === undefined || raw === null) return null
  if (raw === 'novice' || raw === 'intermediate' || raw === 'advanced') return raw
  throw new WorkspaceValidationError('invalid_name') // PRD 미정 — 'novice/intermediate/advanced/null' 만 허용
}

/**
 * Sprint 018 M2 T17d — 임베딩 모델 검증. undefined/null 시 undefined 반환 (DB DEFAULT 의존).
 * 비어 있지 않은 미지원 id 는 throw (silent corruption 차단 — EMBEDDING_MODELS SSOT 정합).
 */
function validateEmbeddingModel(raw: unknown): EmbeddingModelId | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'string' && isSupportedEmbeddingModel(raw)) return raw
  throw new WorkspaceValidationError('invalid_embedding_model')
}

export class WorkspaceService {
  private readonly db: FlowbrowserDatabase
  private readonly userSettingStore: UserSettingStore
  /** 캐시 — list() 결과를 mutation 시 invalidate. 단일 main 프로세스라 lock 불필요. */
  private cachedList: WorkspaceRow[] | null = null

  constructor(opts: WorkspaceServiceOptions) {
    this.db = opts.db
    this.userSettingStore = opts.userSettingStore
    // defaultWorkspace 가 명시되면 첫 호출 시 list 캐시 미사용 — invalidate 만.
    if (opts.defaultWorkspace) {
      this.cachedList = null
    }
  }

  /** 전체 워크스페이스 목록 (created_at ASC). */
  list(): WorkspaceRow[] {
    if (this.cachedList === null) {
      this.cachedList = this.db.listWorkspaces()
    }
    return this.cachedList.map((r) => ({ ...r }))
  }

  /**
   * 활성 워크스페이스 ID.
   * UserSetting.activeWorkspaceId 우선 → 미설정 시 첫 워크스페이스 (보통 "📥 기본").
   * 첫 워크스페이스도 없으면 ensureDefaultWorkspace 호출 (fresh install 안전망).
   */
  getActiveId(): string {
    const state = this.userSettingStore.getState() as { activeWorkspaceId?: string }
    if (state.activeWorkspaceId) {
      const row = this.db.findWorkspaceById(state.activeWorkspaceId)
      if (row) return row.id
    }
    const all = this.list()
    if (all.length > 0) return all[0].id
    const fallback = this.db.ensureDefaultWorkspace()
    this.cachedList = null
    return fallback.id
  }

  /** 활성 워크스페이스 row (id + name + icon + level_preference + created_at). */
  getActive(): WorkspaceRow {
    const id = this.getActiveId()
    const row = this.db.findWorkspaceById(id)
    if (!row) {
      // race — defensive recreate
      const def = this.db.ensureDefaultWorkspace()
      this.cachedList = null
      return def
    }
    return row
  }

  async setActive(workspaceId: string): Promise<WorkspaceRow> {
    const row = this.db.findWorkspaceById(workspaceId)
    if (!row) throw new WorkspaceValidationError('not_found')
    await this.userSettingStore.update({
      activeWorkspaceId: workspaceId
    } as never)
    return row
  }

  async create(args: CreateWorkspaceArgs): Promise<WorkspaceRow> {
    const name = validateName(args.name)
    const icon = validateWorkspaceIcon(args.icon)
    const level_preference = validateLevelPreference(args.level_preference)
    // Sprint 018 M2 T17d — undefined 면 db.createWorkspace 가 컬럼 미지정(DEFAULT) path.
    const embedding_model = validateEmbeddingModel(args.embedding_model)
    const row = this.db.createWorkspace({ name, icon, level_preference, embedding_model })
    this.cachedList = null
    return row
  }

  async update(args: UpdateWorkspaceArgs): Promise<WorkspaceRow> {
    const existing = this.db.findWorkspaceById(args.id)
    if (!existing) throw new WorkspaceValidationError('not_found')
    const patch = args.patch ?? {}
    const next: WorkspaceRow = { ...existing }
    if (patch.name !== undefined) next.name = validateName(patch.name)
    if (patch.icon !== undefined) next.icon = validateWorkspaceIcon(patch.icon)
    if (patch.level_preference !== undefined)
      next.level_preference = validateLevelPreference(patch.level_preference)

    if (
      next.name === existing.name &&
      next.icon === existing.icon &&
      next.level_preference === existing.level_preference
    ) {
      throw new WorkspaceValidationError('no_change')
    }

    this.db
      .getDb()
      .prepare(
        'UPDATE workspaces SET name = ?, icon = ?, level_preference = ? WHERE id = ?'
      )
      .run(next.name, next.icon, next.level_preference, next.id)
    this.cachedList = null
    return next
  }

  /**
   * Cascade DELETE — pages / visits / notes / ai_chat_history / tags / embedding_queue 모두 FK CASCADE.
   * vec_pages / vec_notes 는 pages/notes AFTER DELETE trigger 가 정리 (v04.sql 정합).
   *
   * §11.5.5 마지막 1개 삭제 시 자동 "📥 기본" 재생성.
   */
  async delete(workspaceId: string): Promise<DeleteResult> {
    const existing = this.db.findWorkspaceById(workspaceId)
    if (!existing) throw new WorkspaceValidationError('not_found')

    const all = this.list()
    const isLast = all.length === 1
    const wasActive = this.getActiveId() === workspaceId

    this.db.getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
    this.cachedList = null

    let replacement: WorkspaceRow | undefined
    if (isLast) {
      replacement = this.db.createWorkspace({
        name: DEFAULT_WORKSPACE_NAME,
        icon: DEFAULT_WORKSPACE_ICON
      })
      this.cachedList = null
    }

    let newActiveId: string
    if (wasActive) {
      // 활성이었다면 첫 잔여 워크스페이스 (또는 replacement) 로 자동 전환.
      const remaining = this.list()
      newActiveId = remaining[0]?.id ?? replacement!.id
      await this.userSettingStore.update({ activeWorkspaceId: newActiveId } as never)
    } else {
      newActiveId = this.getActiveId()
    }

    return { deleted: true, replacement, newActiveId }
  }

  /** 테스트 / 인프라 재시작 후 캐시 강제 무효화. */
  invalidateCache(): void {
    this.cachedList = null
  }
}
