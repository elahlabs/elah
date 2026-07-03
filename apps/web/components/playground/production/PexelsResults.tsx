'use client'

import { memo, useCallback, useEffect, useRef, type DragEvent } from 'react'
import { Loader2, ImageOff } from 'lucide-react'
import { MEDIA_DRAG_MIME, mediaDragKindMime, type DragMediaPayload } from '@elah/editor'
import { usePexelsSearch } from '@/hooks/usePexelsSearch'
import { importPexelsPhoto } from '@/lib/pexels/importPexelsAsset'
import { proxyPexelsImage } from '@/lib/pexels/proxyImage'
import type { PexelsPhoto } from '@/lib/pexels/types'
import { cn } from '@/lib/utils'

/**
 * Pexels wordmark — drawn inline (mirrors PixabayLogo) so the credit never
 * depends on an external asset request. Pexels' API terms require
 * attributing the source when used prominently.
 */
export function PexelsLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 22"
      height={size}
      className={className}
      role="img"
      aria-label="Pexels"
    >
      <rect x="0" y="3" width="16" height="16" rx="3.5" fill="#05a081" />
      <text x="10.5" y="15.5" fontSize="12" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff" textAnchor="middle">
        P
      </text>
      <text x="20" y="16.5" fontSize="15" fontFamily="Arial, sans-serif" fontWeight="700">
        <tspan fill="currentColor">pe</tspan>
        <tspan fill="#05a081">xels</tspan>
      </text>
    </svg>
  )
}

/** Small "powered by Pexels" credit, linked back per Pexels' API attribution terms. */
function PexelsCredit() {
  return (
    <a
      href="https://www.pexels.com/"
      target="_blank"
      rel="noreferrer noopener"
      className="mb-2 inline-flex items-center gap-1.5 self-start text-[10px] text-ed-text-muted transition-colors hover:text-ed-text"
      title="Media provided by Pexels"
    >
      <span>Powered by</span>
      <PexelsLogo size={11} />
    </a>
  )
}

const PhotoCard = memo(function PhotoCard({ photo }: { photo: PexelsPhoto }) {
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const asset = importPexelsPhoto(photo)
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(mediaDragKindMime('image'), '')
      e.dataTransfer.effectAllowed = 'copy'
    },
    [photo],
  )

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => importPexelsPhoto(photo)}
      title={photo.alt || `Photo by ${photo.photographer}`}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        <img
          // `small` is sized for this grid tile; `large2x`/`large` are what's
          // actually imported onto the timeline (importPexelsAsset), so using
          // a smaller variant here avoids the grid pulling N full-size images
          // through the proxy at once.
          src={proxyPexelsImage(photo.src.small)}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <span className="truncate text-[11px] text-ed-text-muted">
        {photo.alt || `Photo by ${photo.photographer}`}
      </span>
    </div>
  )
})

export function PexelsResults({ query }: { query: string }) {
  const { items, loading, loadingMore, error, hasMore, loadMore, isDefaultFeed } = usePexelsSearch(query)

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <div className="flex flex-col">
      <PexelsCredit />

      {error && <p className="text-[11px] text-ed-error">{error}</p>}

      {loading ? (
        <div className="mt-1 flex items-center justify-center gap-1.5 py-6 text-ed-text-muted">
          <Loader2 size={13} className="animate-spin" />
          <span className="text-[11px]">{isDefaultFeed ? 'Loading…' : 'Searching…'}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-1 flex flex-col items-center gap-1.5 py-6 text-center text-ed-text-muted">
          <ImageOff size={18} />
          <span className="text-[11px]">
            {isDefaultFeed ? 'No Pexels results available.' : `No results for "${query.trim()}"`}
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((p) => (
              <PhotoCard key={p.id} photo={p} />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="mt-3 flex items-center justify-center py-2">
              {loadingMore && <Loader2 size={13} className={cn('animate-spin text-ed-text-muted')} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PexelsResults
