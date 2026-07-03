'use client'

import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { Loader2, Music, Play, Pause } from 'lucide-react'
import { MEDIA_DRAG_MIME, mediaDragKindMime, type DragMediaPayload, type MediaAsset } from '@elah/editor'
import { useFreesoundSearch } from '@/hooks/useFreesoundSearch'
import { importFreesoundSound } from '@/lib/freesound/importFreesoundAsset'
import { proxyFreesoundPreview } from '@/lib/freesound/proxyPreview'
import type { FreesoundSound } from '@/lib/freesound/types'
import { cn } from '@/lib/utils'

function fmtDuration(sec: number): string {
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Single shared preview element so starting one sound's preview stops any other. */
let activePreview: HTMLAudioElement | null = null

const SoundCard = memo(function SoundCard({
  sound,
  onActivate,
}: {
  sound: FreesoundSound
  onActivate: (asset: MediaAsset) => void
}) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => audioRef.current?.pause()
  }, [])

  const togglePreview = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      if (!audioRef.current) {
        // Same proxied URL the timeline will decode — previewing warms its cache.
        const src = proxyFreesoundPreview(
          sound.previews['preview-hq-mp3'] || sound.previews['preview-lq-mp3'],
        )
        const audio = new Audio(src)
        audio.addEventListener('ended', () => setPlaying(false))
        audioRef.current = audio
      }
      const audio = audioRef.current
      if (playing) {
        audio.pause()
        setPlaying(false)
        return
      }
      if (activePreview && activePreview !== audio) activePreview.pause()
      activePreview = audio
      void audio.play()
      setPlaying(true)
    },
    [playing, sound],
  )

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const asset = importFreesoundSound(sound)
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(mediaDragKindMime('audio'), '')
      e.dataTransfer.effectAllowed = 'copy'
    },
    [sound],
  )

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => onActivate(importFreesoundSound(sound))}
      title={sound.name}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        {sound.images?.waveform_m ? (
          <img
            src={sound.images.waveform_m}
            alt=""
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover opacity-70"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ed-text-muted">
            <Music size={20} />
          </div>
        )}

        <button
          type="button"
          onClick={togglePreview}
          className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30"
        >
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-opacity',
              playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </span>
        </button>

        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono text-white">
          {fmtDuration(sound.duration)}
        </span>
      </div>
      <span className="truncate text-[11px] text-ed-text-muted">
        {sound.name} · {sound.username}
      </span>
    </div>
  )
})

export function FreesoundResults({
  query,
  onActivate,
}: {
  query: string
  onActivate: (asset: MediaAsset) => void
}) {
  const { items, loading, loadingMore, error, hasMore, loadMore, isDefaultFeed } = useFreesoundSearch(query)

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
      {error && <p className="text-[11px] text-ed-error">{error}</p>}

      {loading ? (
        <div className="mt-1 flex items-center justify-center gap-1.5 py-6 text-ed-text-muted">
          <Loader2 size={13} className="animate-spin" />
          <span className="text-[11px]">{isDefaultFeed ? 'Loading…' : 'Searching…'}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-1 flex flex-col items-center gap-1.5 py-6 text-center text-ed-text-muted">
          <Music size={18} />
          <span className="text-[11px]">
            {isDefaultFeed ? 'No Freesound results available.' : `No results for "${query.trim()}"`}
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((s) => (
              <SoundCard key={s.id} sound={s} onActivate={onActivate} />
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

export default FreesoundResults
