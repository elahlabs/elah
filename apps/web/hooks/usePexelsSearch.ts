import { useCallback, useEffect, useRef, useState } from 'react'
import type { PexelsPhoto, PexelsPhotoSearchResponse } from '@/lib/pexels/types'

const DEBOUNCE_MS = 400
const PER_PAGE = 20

export interface UsePexelsSearchResult {
  items: PexelsPhoto[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  /** True while showing the default (query-less) curated feed. */
  isDefaultFeed: boolean
}

/**
 * Debounced, paginated, cancellable Pexels photo search over our own
 * `/api/pexels/photos` proxy route (keeps the API key server-side). Mirrors
 * usePixabaySearch's photos path. When `query` is empty, falls back to
 * Pexels' curated feed so the panel never starts out empty.
 */
export function usePexelsSearch(query: string): UsePexelsSearchResult {
  const [items, setItems] = useState<PexelsPhoto[]>([])
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
      const url = `/api/pexels/photos?${queryPart}page=${pageToFetch}&per_page=${PER_PAGE}`
      const res = await fetch(url, { signal: controller.signal })
      const data = (await res.json()) as PexelsPhotoSearchResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Pexels search failed.')

      setTotalResults(data.total_results)
      setPage(pageToFetch)
      setItems((prev) => (replace ? data.photos : [...prev, ...data.photos]))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Pexels search failed.')
      if (replace) setItems([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

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
