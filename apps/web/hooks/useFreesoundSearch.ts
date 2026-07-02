import { useCallback, useEffect, useRef, useState } from 'react'
import type { FreesoundSearchResponse, FreesoundSound } from '@/lib/freesound/types'

const DEBOUNCE_MS = 400
const PER_PAGE = 20

export interface UseFreesoundSearchResult {
  items: FreesoundSound[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  /** True while showing the default (query-less) popular feed. */
  isDefaultFeed: boolean
}

/**
 * Debounced, paginated, cancellable Freesound search over our own
 * `/api/freesound` proxy route (keeps the API key server-side). Mirrors
 * usePexelsSearch — when `query` is empty, falls back to Freesound's
 * downloads-sorted feed so the panel never starts out empty.
 */
export function useFreesoundSearch(query: string): UseFreesoundSearchResult {
  const [items, setItems] = useState<FreesoundSound[]>([])
  const [page, setPage] = useState(1)
  const [totalResults, setTotalResults] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const runSearch = useCallback(async (q: string, pageToFetch: number, replace: boolean) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (replace) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const queryPart = q ? `query=${encodeURIComponent(q)}&` : ''
      const url = `/api/freesound?${queryPart}page=${pageToFetch}&per_page=${PER_PAGE}`
      const res = await fetch(url, { signal: controller.signal })
      const data = (await res.json()) as FreesoundSearchResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Freesound search failed.')

      setTotalResults(data.count)
      setPage(pageToFetch)
      setItems((prev) => (replace ? data.results : [...prev, ...data.results]))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Freesound search failed.')
      if (replace) setItems([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Debounced search on query change; empty query loads the default feed immediately.
  useEffect(() => {
    const trimmed = query.trim()
    const timer = setTimeout(
      () => {
        void runSearch(trimmed, 1, true)
      },
      trimmed ? DEBOUNCE_MS : 0,
    )

    return () => clearTimeout(timer)
  }, [query, runSearch])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadMore = useCallback(() => {
    if (loading || loadingMore) return
    if (items.length >= totalResults) return
    void runSearch(query.trim(), page + 1, false)
  }, [query, loading, loadingMore, items.length, totalResults, page, runSearch])

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: items.length < totalResults,
    loadMore,
    isDefaultFeed: !query.trim(),
  }
}
