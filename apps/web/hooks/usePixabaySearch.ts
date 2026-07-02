import { useCallback, useEffect, useRef, useState } from 'react'
import type { PixabayPhoto, PixabayPhotoSearchResponse, PixabayVideo, PixabayVideoSearchResponse } from '@/lib/pixabay/types'

const DEBOUNCE_MS = 400
const PER_PAGE = 20

type PixabayKind = 'photos' | 'videos'

type ItemFor<K extends PixabayKind> = K extends 'photos' ? PixabayPhoto : PixabayVideo
type ResponseFor<K extends PixabayKind> = K extends 'photos' ? PixabayPhotoSearchResponse : PixabayVideoSearchResponse

export interface UsePixabaySearchResult<K extends PixabayKind> {
  items: ItemFor<K>[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  /** True while showing the default (query-less) popular/curated feed. */
  isDefaultFeed: boolean
}

/**
 * Debounced, paginated, cancellable Pixabay search over our own `/api/pixabay/*`
 * proxy routes (keeps the API key server-side). Shared by the Photos and
 * Stock panels — only the `kind` (and therefore the endpoint + item type)
 * differs between them. When `query` is empty, falls back to Pixabay's popular
 * (videos) / curated (photos) feed so the panel never starts out empty.
 */
export function usePixabaySearch<K extends PixabayKind>(kind: K, query: string): UsePixabaySearchResult<K> {
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
        const queryPart = q ? `query=${encodeURIComponent(q)}&` : ''
        const url = `/api/pixabay/${kind}?${queryPart}page=${pageToFetch}&per_page=${PER_PAGE}`
        const res = await fetch(url, { signal: controller.signal })
        const data = (await res.json()) as ResponseFor<K> & { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Pixabay search failed.')

        const results = (kind === 'photos' ? (data as PixabayPhotoSearchResponse).hits : (data as PixabayVideoSearchResponse).hits) as ItemFor<K>[]
        setTotalResults(data.totalHits)
        setPage(pageToFetch)
        setItems((prev) => (replace ? results : [...prev, ...results]))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Pixabay search failed.')
        if (replace) setItems([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [kind],
  )

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
