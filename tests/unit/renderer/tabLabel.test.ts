/**
 * Sprint 013 M3 — formatTabLabel 순수 함수 단위 테스트.
 * Sprint 016 M0 T03b (KI-017) — 워크스페이스 컨텍스트 +2 회귀.
 */
import { describe, it, expect } from 'vitest'
import { formatTabLabel } from '../../../src/renderer/src/translation/tabLabel'

describe('formatTabLabel (Sprint 013 M3)', () => {
  it('title 있으면 title 우선', () => {
    expect(formatTabLabel({ url: 'https://example.com', title: 'Example' })).toBe('Example')
  })

  it('빈 url → "새 탭"', () => {
    expect(formatTabLabel({ url: '', title: '' })).toBe('새 탭')
  })

  it('about:blank → "새 탭"', () => {
    expect(formatTabLabel({ url: 'about:blank', title: '' })).toBe('새 탭')
  })

  it('정상 URL → hostname 반환', () => {
    expect(formatTabLabel({ url: 'https://example.com/path', title: '' })).toBe('example.com')
  })

  it('잘못된 URL → 원본 반환', () => {
    expect(formatTabLabel({ url: 'not-a-url', title: '' })).toBe('not-a-url')
  })

  // Sprint 016 M0 T03b (KI-017) — 워크스페이스 컨텍스트
  describe('workspace context (Sprint 016 M0 T03b)', () => {
    it('탭 workspace_id 가 활성 ws 와 매칭 시 아이콘 prefix + 이름 라벨 박힘', () => {
      expect(
        formatTabLabel(
          { url: 'https://x.test/path', title: 'X', workspace_id: 'ws_alpha' },
          { id: 'ws_alpha', icon: '📚', name: '학술' }
        )
      ).toBe('📚 X')
      // base hostname 도 동일 prefix 패턴
      expect(
        formatTabLabel(
          { url: 'https://x.test/path', title: '', workspace_id: 'ws_alpha' },
          { id: 'ws_alpha', icon: '💻', name: '개발' }
        )
      ).toBe('💻 x.test')
    })

    it('미매칭 / null / context 미주입 시 디폴트 라벨 fallback (회귀 안전성)', () => {
      // workspace context 미주입 — 기존 동작 보존
      expect(formatTabLabel({ url: 'https://x.test', title: 'X', workspace_id: 'ws_alpha' })).toBe('X')
      // 탭 workspace_id null — V1 마이그레이션 직후 backfill 전. context 있어도 prefix 없음.
      expect(
        formatTabLabel(
          { url: 'https://x.test', title: 'X', workspace_id: null },
          { id: 'ws_alpha', icon: '📚', name: '학술' }
        )
      ).toBe('X')
      // 다른 ws 의 탭 — prefix 없음 (격리 표시 정합)
      expect(
        formatTabLabel(
          { url: 'https://x.test', title: 'X', workspace_id: 'ws_beta' },
          { id: 'ws_alpha', icon: '📚', name: '학술' }
        )
      ).toBe('X')
    })
  })
})
