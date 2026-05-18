/**
 * Sprint 015 M5-1 — SearchBar.
 * PRD §7.4.3 — 상단 우측 240px / Cmd+K 포커스 / debounce 300ms / 결과 드롭다운.
 * 본 컴포넌트는 SearchService 미완 상태에서 search:query stub 호출 (빈 결과).
 * M5-3 SearchService 도입 시 결과 카드 + 키보드 네비게이션 + 클릭 동작 완성.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { SearchResultCard, type SearchResultMatch } from './search/SearchResultCard'

interface SearchResultPayload {
  pageId: string
  type: 'page' | 'note'
  title: string
  url: string
  visitedAt: number
  dwellMs: number
  excerpt: string
  matchPositions: SearchResultMatch[]
  score: number
}

type Status = 'idle' | 'loading' | 'ok' | 'empty' | 'error'

const DEBOUNCE_MS = 300

export default function SearchBar(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultPayload[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    const off = window.shortcutApi.onInvoke((id) => {
      if (id !== 'searchBar.focus') return
      setOpen(true)
      // 다음 tick 에 focus + select (state 반영 후 input 렌더링 보장)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    })
    return off
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setResults([])
      setStatus('idle')
      setSelectedIndex(0)
      return
    }
    setStatus('loading')
    debounceRef.current = setTimeout(() => {
      void runQuery(trimmed)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  async function runQuery(q: string): Promise<void> {
    const seq = ++requestSeqRef.current
    try {
      const response = await window.searchApi.query({ query: q, topN: 10 })
      // 동일 input 에서 새 query 가 들어왔으면 stale 응답 무시
      if (seq !== requestSeqRef.current) return
      if (response.status === 'error') {
        setStatus('error')
        setResults([])
        return
      }
      const list = response.results ?? []
      setResults(list)
      setSelectedIndex(0)
      // M5-1 stub 시점: status='stub' 도 빈 결과로 처리 (empty 상태)
      if (list.length === 0) {
        setStatus('empty')
      } else {
        setStatus('ok')
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      setStatus('error')
      setResults([])
      console.warn('[SearchBar] search:query failed', err)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
      setResults([])
      setStatus('idle')
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      if (results.length === 0) return
      e.preventDefault()
      setSelectedIndex((idx) => (idx + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      setSelectedIndex((idx) => (idx - 1 + results.length) % results.length)
      return
    }
    if (e.key === 'Enter') {
      if (results.length === 0) return
      e.preventDefault()
      const target = results[selectedIndex]
      if (target) selectResult(target)
    }
  }

  function selectResult(item: SearchResultPayload): void {
    void window.browserApi.navigate(item.url)
    setOpen(false)
    setQuery('')
    setResults([])
    setStatus('idle')
  }

  function handleBlur(): void {
    // 드롭다운 클릭 가능하도록 약간 지연
    setTimeout(() => setOpen(false), 150)
  }

  return (
    <div className={`search-bar${open ? ' search-bar-open' : ''}`}>
      <input
        ref={inputRef}
        type="search"
        className="search-bar-input"
        placeholder="기억 검색 (Cmd+K)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="검색"
        aria-haspopup="listbox"
        aria-expanded={open}
        spellCheck={false}
        autoComplete="off"
      />
      {open && query.trim().length > 0 && (
        <div className="search-bar-dropdown" role="listbox" aria-label="검색 결과">
          {status === 'loading' && (
            <div className="search-bar-message">검색 중…</div>
          )}
          {status === 'empty' && (
            <div className="search-bar-message">결과가 없습니다.</div>
          )}
          {status === 'error' && (
            <div className="search-bar-message search-bar-error">
              검색 중 오류가 발생했습니다.
            </div>
          )}
          {status === 'ok' &&
            results.map((item, idx) => (
              <div
                key={`${item.type}-${item.pageId}-${idx}`}
                role="option"
                aria-selected={idx === selectedIndex}
                onMouseEnter={() => setSelectedIndex(idx)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <SearchResultCard
                  pageId={item.pageId}
                  type={item.type}
                  title={item.title}
                  url={item.url}
                  visitedAt={item.visitedAt}
                  dwellMs={item.dwellMs}
                  excerpt={item.excerpt}
                  matchPositions={item.matchPositions}
                  score={item.score}
                  now={Date.now()}
                  selected={idx === selectedIndex}
                  onClick={() => selectResult(item)}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
