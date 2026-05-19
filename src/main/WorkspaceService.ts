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
  constructor(public readonly code: 'invalid_name' | 'invalid_icon' | 'not_found' | 'no_change') {
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
 * `icon` 검증 — preset 12종 또는 사용자 이모지 1자 (코드포인트 1~4 — ZWJ sequence 포함).
 * UTF-16 surrogate pair / variation selector (U+FE0F) 모두 1 이모지로 취급.
 *
 * 정책: preset 그대로 허용 / 그 외에는 grapheme 단위 1개 + emoji 코드포인트 범위 검사.
 * Node 18+ `Intl.Segmenter('en', { granularity: 'grapheme' })` 사용 — 한 grapheme cluster 만 허용.
 */
export function validateWorkspaceIcon(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkspaceValidationError('invalid_icon')
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new WorkspaceValidationError('invalid_icon')
  if ((WORKSPACE_PRESET_ICONS as readonly string[]).includes(trimmed)) return trimmed

  // grapheme 1개 만 허용 (사용자 이모지). 한글 1자도 grapheme 1 — 정책상 emoji codepoint 필요.
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
    // Fallback — Array.from (코드포인트 단위, ZWJ sequence 는 분할).
    const cps = Array.from(trimmed)
    if (cps.length === 0 || cps.length > 4) throw new WorkspaceValidationError('invalid_icon')
    grapheme = trimmed
  }
  if (grapheme === null || count !== 1) throw new WorkspaceValidationError('invalid_icon')

  // emoji codepoint 범위 검사 (BMP emoji + SMP emoji + variation selector + ZWJ).
  // 한글/라틴 알파벳/숫자는 거부.
  let hasEmojiCp = false
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)!
    if (
      (cp >= 0x1f000 && cp <= 0x1ffff) || // SMP emoji block (대부분)
      (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats
      (cp >= 0x2300 && cp <= 0x23ff) || // misc technical
      cp === 0xfe0f || // variation selector-16
      cp === 0x200d || // ZWJ
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) // regional indicators (국기)
    ) {
      hasEmojiCp = true
    }
  }
  if (!hasEmojiCp) throw new WorkspaceValidationError('invalid_icon')
  return grapheme
}

function validateLevelPreference(raw: unknown): LevelPreference {
  if (raw === undefined || raw === null) return null
  if (raw === 'novice' || raw === 'intermediate' || raw === 'advanced') return raw
  throw new WorkspaceValidationError('invalid_name') // PRD 미정 — 'novice/intermediate/advanced/null' 만 허용
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
    const row = this.db.createWorkspace({ name, icon, level_preference })
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
