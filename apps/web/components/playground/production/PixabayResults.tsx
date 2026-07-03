'use client'

import { memo, useCallback, useEffect, useRef, type DragEvent } from 'react'
import { Loader2, ImageOff } from 'lucide-react'
import { MEDIA_DRAG_MIME, mediaDragKindMime, type DragMediaPayload } from '@elah/editor'
import { usePixabaySearch } from '@/hooks/usePixabaySearch'
import { importPixabayPhoto, importPixabayVideo } from '@/lib/pixabay/importPixabayAsset'
import { proxyPixabayImage } from '@/lib/pixabay/proxyImage'
import type { PixabayPhoto, PixabayVideo } from '@/lib/pixabay/types'
import { cn } from '@/lib/utils'

function fmtDuration(sec: number): string {
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** First tag in Pixabay's comma-separated `tags` string reads best as a caption. */
function primaryTag(tags: string): string {
  return tags.split(',')[0]?.trim() ?? ''
}

/**
 * Pixabay wordmark — Pixabay's brand green with the two-tone "pixa/bay"
 * treatment used on pixabay.com, drawn inline so the credit never depends on
 * an external asset request (Pixabay's API terms require attributing the
 * source; this keeps that link visible wherever results are shown).
 */
export function PixabayLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 22"
      height={size}
      className={className}
      role="img"
      aria-label="Pixabay"
    >
      <rect x="0" y="3" width="16" height="16" rx="3.5" fill="#1a9c37" />
      <path d="M8 6.5l4.2 2.4v4.8L8 16.1l-4.2-2.4V8.9L8 6.5z" fill="#fff" opacity="0.92" />
      <text x="20" y="16.5" fontSize="15" fontFamily="Arial, sans-serif" fontWeight="700">
        <tspan fill="currentColor">pixa</tspan>
        <tspan fill="#1a9c37">bay</tspan>
      </text>
    </svg>
  )
}

/** Small "powered by Pixabay" credit, linked back per Pixabay's API attribution terms. */
function PixabayCredit() {
  return (
    <a
      href="https://pixabay.com/"
      target="_blank"
      rel="noreferrer noopener"
      className="mb-2 inline-flex items-center gap-1.5 self-start text-[10px] text-ed-text-muted transition-colors hover:text-ed-text"
      title="Media provided by Pixabay"
    >
      <span>Powered by</span>
      <PixabayLogo size={11} />
    </a>
  )
}

const PhotoCard = memo(function PhotoCard({ photo }: { photo: PixabayPhoto }) {
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const asset = importPixabayPhoto(photo)
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
      onClick={() => importPixabayPhoto(photo)}
      title={primaryTag(photo.tags) || 'Pixabay photo'}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        <img
          // previewURL (~150px) is sized for this grid tile; webformatURL (640px)
          // is the size actually imported onto the timeline (importPixabayAsset),
          // so using it here just to share a cache entry meant every tile in the
          // grid pulled a 640px image through the proxy at once — exactly the
          // burst pattern that trips Pixabay's anti-hotlink throttling on
          // pixabay.com/get/. Importing still costs one extra fetch on drop/click,
          // but the grid no longer needs N full-size images just to render.
          src={proxyPixabayImage(photo.previewURL)}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <span className="truncate text-[11px] text-ed-text-muted">
        {primaryTag(photo.tags) || `Photo by ${photo.user}`}
      </span>
    </div>
  )
})

const VideoCard = memo(function VideoCard({ video }: { video: PixabayVideo }) {
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const asset = importPixabayVideo(video)
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(mediaDragKindMime('video'), '')
      e.dataTransfer.effectAllowed = 'copy'
    },
    [video],
  )

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => importPixabayVideo(video)}
      title={`Video by ${video.user}`}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        <img
          src={proxyPixabayImage(video.videos.medium.thumbnail)}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono text-white">
          {fmtDuration(video.duration)}
        </span>
      </div>
      <span className="truncate text-[11px] text-ed-text-muted">by {video.user}</span>
    </div>
  )
})

export function PixabayResults({ kind, query }: { kind: 'photos' | 'videos'; query: string }) {
  const { items, loading, loadingMore, error, hasMore, loadMore, isDefaultFeed } =
    usePixabaySearch(kind, query)

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
      <PixabayCredit />

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
            {isDefaultFeed ? 'No Pixabay results available.' : `No results for "${query.trim()}"`}
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {kind === 'photos'
              ? (items as PixabayPhoto[]).map((p) => <PhotoCard key={p.id} photo={p} />)
              : (items as PixabayVideo[]).map((v) => <VideoCard key={v.id} video={v} />)}
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

export default PixabayResults
