/**
 * Sprint 016 M4 T20 — HighlightStore (in-memory).
 *
 * PRD §11.2.1 highlights — 노트 선택 영역 anchor 메타데이터 영속.
 *
 * G-013 1단계 (옵션 A) — schema 변경 회피. SQLite swap (옵션 B) 은 후속 PR.
 *
 * 책임:
 *   1. add(input) — 신규 highlight 등록 (id 자체 발급)
 *   2. get(id) — 단일 조회
 *   3. listByPage({ workspaceId, pageId? | url? + contentHash? }) — 페이지 재방문 시 복원용
 *   4. listByNote(noteId) — 노트 패널 표시용 (1:N — 한 노트가 여러 highlight 가능)
 *   5. listByWorkspace(workspaceId) — 격리 확인용
 *   6. remove(id) — 삭제
 *   7. clear() — 단위 테스트 reset
 *
 * codex 사전 협의 (2026-05-21, threadId 019e4a06):
 *   - id 는 highlight 자체 id (noteId 1:1 강제 X — 한 노트가 여러 highlight 가능)
 *   - listByPage 는 workspaceId + (pageId 또는 url+contentHash) 필터 — cross-page 노출 차단
 *   - contentHash 단독 list 금지 (collision 위험)
 *
 * 본 store 는 in-memory — 프로세스 종료 시 휘발. 후속 SQLite swap 시 동일 interface 유지.
 */

import { randomUUID } from 'node:crypto'

import type { HighlightAnchor } from '../perception/highlightAnchor'

export interface HighlightRecord {
  /** highlight 자체 id (noteId 와 별개 — 한 노트가 여러 highlight 가능). */
  id: string
  /** 연결된 노트 id (필수 — highlight 는 항상 노트의 선택 영역 표현). */
  noteId: string
  /** 페이지 id (pages 테이블 FK 후보 — 현 in-memory 단계는 plain string). nullable 허용 (PDF 등 pageId 미발급 시). */
  pageId: string | null
  /** 페이지 URL (drift fallback 시 page 식별용). */
  url: string
  /** anchor 시점 root.textContent 해시 — listByPage 필터 + drift 판단. */
  contentHash: string
  /** anchor 메타데이터 (W3C Range serialize 결과). */
  anchor: HighlightAnchor
  /** 워크스페이스 격리 — listByPage 의 강제 필터. */
  workspaceId: string
  /** epoch ms. */
  createdAt: number
}

export interface CreateHighlightInput {
  noteId: string
  pageId?: string | null
  url: string
  contentHash: string
  anchor: HighlightAnchor
  workspaceId: string
  /** 명시 id (단위 테스트 / import 시) — 미지정 시 randomUUID. */
  id?: string
  /** 명시 createdAt (단위 테스트 / import 시) — 미지정 시 Date.now. */
  createdAt?: number
}

export interface ListByPageFilter {
  workspaceId: string
  /** pageId 또는 url + contentHash 중 하나 이상 필수 (cross-page 노출 차단). */
  pageId?: string | null
  url?: string
  contentHash?: string
}

export class HighlightStore {
  private readonly byId = new Map<string, HighlightRecord>()

  /**
   * 신규 highlight 등록. workspaceId / noteId / url / anchor / contentHash 필수.
   * id 미지정 시 randomUUID 발급. createdAt 미지정 시 Date.now.
   */
  add(input: CreateHighlightInput): HighlightRecord {
    if (!input.workspaceId) throw new Error('HighlightStore.add: workspaceId required')
    if (!input.noteId) throw new Error('HighlightStore.add: noteId required')
    if (!input.url) throw new Error('HighlightStore.add: url required')
    if (!input.contentHash) throw new Error('HighlightStore.add: contentHash required')
    if (!input.anchor) throw new Error('HighlightStore.add: anchor required')

    const record: HighlightRecord = {
      id: input.id ?? randomUUID(),
      noteId: input.noteId,
      pageId: input.pageId ?? null,
      url: input.url,
      contentHash: input.contentHash,
      anchor: input.anchor,
      workspaceId: input.workspaceId,
      createdAt: input.createdAt ?? Date.now()
    }
    if (this.byId.has(record.id)) {
      throw new Error(`HighlightStore.add: duplicate id=${record.id}`)
    }
    this.byId.set(record.id, record)
    return record
  }

  /** 단일 조회. 없으면 null. */
  get(id: string): HighlightRecord | null {
    return this.byId.get(id) ?? null
  }

  /**
   * 페이지 재방문 시 복원용 — workspaceId 강제 + (실 pageId 또는 url+contentHash) 필터.
   *
   * 필터 우선순위:
   *   1. 실 pageId 지정 (string + non-null): workspaceId + record.pageId === filter.pageId 일치
   *   2. pageId 가 null 또는 undefined: url 분기 — workspaceId + record.url === filter.url 일치
   *      (contentHash 지정 시 동반 일치 강제)
   *   3. pageId 가 null/undefined 인데 url 도 없으면: throw (cross-page 노출 차단)
   *
   * codex 사전 dual review hotfix (threadId 019e4a16) 흡수 — `pageId: null` 을
   * "pageId 없는 모든 record 매칭" 으로 해석하던 이전 버전은 cross-URL 노출 위험.
   * 본 hotfix 후 `pageId: null` 은 "pageId identity 미지정" 으로 해석 → url 분기 강제.
   *
   * 결과는 createdAt 오름차순 정렬.
   */
  listByPage(filter: ListByPageFilter): HighlightRecord[] {
    if (!filter.workspaceId) {
      throw new Error('HighlightStore.listByPage: workspaceId required')
    }
    const hasRealPageId = filter.pageId != null
    if (!hasRealPageId && !filter.url) {
      throw new Error('HighlightStore.listByPage: pageId or url required')
    }

    const result: HighlightRecord[] = []
    for (const record of this.byId.values()) {
      if (record.workspaceId !== filter.workspaceId) continue
      if (hasRealPageId) {
        if (record.pageId !== filter.pageId) continue
      } else {
        if (record.url !== filter.url) continue
        if (filter.contentHash && record.contentHash !== filter.contentHash) continue
      }
      result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 노트 패널 표시용 — 한 노트의 모든 highlight (1:N). createdAt 오름차순. */
  listByNote(noteId: string): HighlightRecord[] {
    const result: HighlightRecord[] = []
    for (const record of this.byId.values()) {
      if (record.noteId === noteId) result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 워크스페이스 격리 확인 — 전체 list. createdAt 오름차순. */
  listByWorkspace(workspaceId: string): HighlightRecord[] {
    const result: HighlightRecord[] = []
    for (const record of this.byId.values()) {
      if (record.workspaceId === workspaceId) result.push(record)
    }
    result.sort((a, b) => a.createdAt - b.createdAt)
    return result
  }

  /** 삭제. 존재 시 true, 없으면 false. */
  remove(id: string): boolean {
    return this.byId.delete(id)
  }

  /** 단위 테스트 reset. 운영 사용 금지. */
  clear(): void {
    this.byId.clear()
  }

  /** 단위 테스트용 — 현 보관 row 수. */
  size(): number {
    return this.byId.size
  }
}
