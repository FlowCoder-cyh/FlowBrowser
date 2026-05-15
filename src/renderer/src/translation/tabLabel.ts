/**
 * Sprint 013 M3 — TabBar formatTabLabel 순수 함수 추출.
 * Sprint 008 M2부터 inline이던 라벨 포맷 로직.
 *
 * 우선순위: title > URL hostname > URL 원본 > '새 탭'
 */

export interface TabLabelInput {
  url: string
  title: string
}

export function formatTabLabel(t: TabLabelInput): string {
  if (t.title) return t.title
  if (!t.url || t.url === 'about:blank') return '새 탭'
  try {
    const u = new URL(t.url)
    return u.hostname || t.url
  } catch {
    return t.url
  }
}
