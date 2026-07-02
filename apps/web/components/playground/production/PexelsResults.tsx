'use client'

import { memo, useCallback, useEffect, useRef, type DragEvent } from 'react'
import { Search, Loader2, ImageOff } from 'lucide-react'
import { MEDIA_DRAG_MIME, mediaDragKindMime, type DragMediaPayload } from '@elah/editor'
import { usePexelsSearch } from '@/hooks/usePexelsSearch'
import { importPexelsPhoto, importPexelsVideo } from '@/lib/pexels/importPexelsAsset'
import type { PexelsPhoto, PexelsVideo } from '@/lib/pexels/types'
import { cn } from '@/lib/utils'

function fmtDuration(sec: number): string {
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
      title={photo.alt || 'Pexels photo'}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        <img
          src={photo.src.medium}
          alt=""
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

const VideoCard = memo(function VideoCard({ video }: { video: PexelsVideo }) {
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const asset = importPexelsVideo(video)
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
      onClick={() => importPexelsVideo(video)}
      title={`Video by ${video.user.name}`}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        <img
          src={video.image}
          alt=""
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono text-white">
          {fmtDuration(video.duration)}
        </span>
      </div>
      <span className="truncate text-[11px] text-ed-text-muted">by {video.user.name}</span>
    </div>
  )
})

export function PexelsResults({ kind }: { kind: 'photos' | 'videos' }) {
  const { query, setQuery, items, loading, loadingMore, error, hasMore, loadMore } =
    usePexelsSearch(kind)

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
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ed-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={kind === 'photos' ? 'Search Pexels photos…' : 'Search Pexels videos…'}
          className="w-full rounded-md border border-ed-border bg-ed-bg-2 py-1.5 pl-7 pr-2.5 text-[12px] text-ed-text placeholder:text-ed-text-muted focus:border-[var(--elah-accent)] focus:outline-none"
        />
      </div>

      {error && <p className="mt-2 text-[11px] text-ed-error">{error}</p>}

      {!query.trim() ? (
        <p className="mt-3 text-center text-[11px] text-ed-text-muted">
          Search royalty-free {kind === 'photos' ? 'photos' : 'videos'} from Pexels.
        </p>
      ) : loading ? (
        <div className="mt-4 flex items-center justify-center gap-1.5 text-ed-text-muted">
          <Loader2 size={13} className="animate-spin" />
          <span className="text-[11px]">Searching…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-1.5 text-center text-ed-text-muted">
          <ImageOff size={18} />
          <span className="text-[11px]">No results for &quot;{query.trim()}&quot;</span>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {kind === 'photos'
              ? (items as PexelsPhoto[]).map((p) => <PhotoCard key={p.id} photo={p} />)
              : (items as PexelsVideo[]).map((v) => <VideoCard key={v.id} video={v} />)}
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
