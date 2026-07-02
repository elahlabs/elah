import { useCallback, useEffect, useRef, useState } from 'react'
import type { PexelsPhoto, PexelsPhotoSearchResponse, PexelsVideo, PexelsVideoSearchResponse } from '@/lib/pexels/types'

const DEBOUNCE_MS = 400
const PER_PAGE = 20

type PexelsKind = 'photos' | 'videos'

type ItemFor<K extends PexelsKind> = K extends 'photos' ? PexelsPhoto : PexelsVideo
type ResponseFor<K extends PexelsKind> = K extends 'photos' ? PexelsPhotoSearchResponse : PexelsVideoSearchResponse

export interface UsePexelsSearchResult<K extends PexelsKind> {
  query: string
  setQuery: (q: string) => void
  items: ItemFor<K>[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
}

/**
 * Debounced, paginated, cancellable Pexels search over our own `/api/pexels/*`
 * proxy routes (keeps the API key server-side). Shared by the Photos and
 * Stock panels — only the `kind` (and therefore the endpoint + item type)
 * differs between them.
 */
export function usePexelsSearch<K extends PexelsKind>(kind: K): UsePexelsSearchResult<K> {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ItemFor<K>[]>([])
  const [page, setPage] = useState(1)
  const [totalResults, setTotalResults] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const runSearch = useCallback(
    async (q: string, pageToFetch: number, replace: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (replace) setLoading(true)
      else setLoadingMore(true)
      setError(null)

      try {
        const url = `/api/pexels/${kind}?query=${encodeURIComponent(q)}&page=${pageToFetch}&per_page=${PER_PAGE}`
        const res = await fetch(url, { signal: controller.signal })
        const data = (await res.json()) as ResponseFor<K> & { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Pexels search failed.')

        const results = (kind === 'photos' ? (data as PexelsPhotoSearchResponse).photos : (data as PexelsVideoSearchResponse).videos) as ItemFor<K>[]
        setTotalResults(data.total_results)
        setPage(pageToFetch)
        setItems((prev) => (replace ? results : [...prev, ...results]))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Pexels search failed.')
        if (replace) setItems([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [kind],
  )

  // Debounced search on query change.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      abortRef.current?.abort()
      setItems([])
      setTotalResults(0)
      setError(null)
      setLoading(false)
      return
    }

    const timer = setTimeout(() => {
      void runSearch(trimmed, 1, true)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, runSearch])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadMore = useCallback(() => {
    const trimmed = query.trim()
    if (!trimmed || loading || loadingMore) return
    if (items.length >= totalResults) return
    void runSearch(trimmed, page + 1, false)
  }, [query, loading, loadingMore, items.length, totalResults, page, runSearch])

  return {
    query,
    setQuery,
    items,
    loading,
    loadingMore,
    error,
    hasMore: items.length < totalResults,
    loadMore,
  }
}
