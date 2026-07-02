'use client'

/**
 * MediaPanel — revamped source panel matching the Figma editor reference.
 *
 * App-side replacement for the SDK's <SourcePanel>: same MediaLibrary wiring
 * (import + drag-to-timeline) but a new layout — Import/Record tabs, a prominent
 * upload dropzone, All/Sort dropdowns, and a 2-column thumbnail grid.
 *
 * Kept separate from the published @elah/editor component so the two can be
 * compared side by side; the old panel is commented out in ProductionEditor and
 * will be discarded once this is approved.
 */

import { useCallback, useRef, useState, type DragEvent } from 'react'
import {
  Plus,
  Search,
  ChevronDown,
  Play,
  Music,
  Image as ImageIcon,
  Trash2,
  Link2,
} from 'lucide-react'
import {
  useMediaLibrary,
  useMediaLibraryStore,
  importFiles,
  importUrl,
  MEDIA_DRAG_MIME,
  mediaDragKindMime,
  type MediaAsset,
  type MediaKind,
  type DragMediaPayload,
} from '@elah/editor'
import { cn } from '@/lib/utils'
import { PexelsResults } from './PexelsResults'

export type PanelMode = 'stock' | 'photos' | 'audio'

type MediaSource = 'pexel' | 'uploads'

function fmtDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return ''
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function sortByRecent(list: MediaAsset[]): MediaAsset[] {
  return [...list].sort((a, b) => b.addedAt - a.addedAt)
}

/** Minimal dropdown — label ▾ with a popover list. */
function Dropdown({
  value,
  options,
  onChange,
  align = 'left',
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[12px] text-ed-text-muted hover:text-ed-text transition-colors"
      >
        {current?.label}
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute z-20 mt-1 min-w-[140px] rounded-lg border border-ed-border bg-ed-elevated py-1 shadow-xl',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-[12px] transition-colors',
                  o.value === value
                    ? 'text-ed-text bg-ed-bg-2'
                    : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-bg-2',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AssetCard({ asset }: { asset: MediaAsset }) {
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const duration = fmtDuration(asset.durationSec)

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(mediaDragKindMime(asset.kind), '')
      e.dataTransfer.effectAllowed = 'copy'
    },
    [asset.id],
  )

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={asset.name}
      className="group flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ed-border bg-ed-bg-2">
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ed-text-muted">
            {asset.kind === 'audio' ? (
              <Music size={20} />
            ) : asset.kind === 'image' ? (
              <ImageIcon size={20} />
            ) : (
              <Play size={20} />
            )}
          </div>
        )}

        {asset.kind === 'video' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
              <Play size={13} fill="currentColor" />
            </span>
          </div>
        )}

        {duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono text-white">
            {duration}
          </span>
        )}

        <button
          type="button"
          onClick={() => removeAsset(asset.id)}
          title="Remove from library"
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <span className="truncate text-[11px] text-ed-text">{asset.name}</span>
    </div>
  )
}

const PANEL_CONFIG: Record<
  PanelMode,
  {
    title: string
    accept: string
    hasUrlImport: boolean
    hasStockSearch: boolean
    expectedKind: MediaKind | null
    emptyLabel: string
    emptyHint: string
  }
> = {
  stock: {
    title: 'Videos',
    accept: 'video/*',
    hasUrlImport: false,
    hasStockSearch: true,
    expectedKind: 'video',
    emptyLabel: 'No video clips yet',
    emptyHint: 'Upload a video file',
  },
  photos: {
    title: 'Photos',
    accept: 'image/*',
    hasUrlImport: false,
    hasStockSearch: true,
    expectedKind: 'image',
    emptyLabel: 'No images yet',
    emptyHint: 'Upload image files',
  },
  audio: {
    title: 'Audio',
    accept: 'audio/*',
    hasUrlImport: true,
    hasStockSearch: false,
    expectedKind: 'audio',
    emptyLabel: 'No audio yet',
    emptyHint: 'Upload or add an audio URL',
  },
}

const SOURCE_OPTIONS: { value: MediaSource; label: string }[] = [
  { value: 'pexel', label: 'Pexel' },
  { value: 'uploads', label: 'Uploads' },
]

const PANEL_LABEL: Record<MediaKind, string> = {
  video: 'Stock',
  audio: 'Audio',
  image: 'Photos',
}

function filterByMode(asset: MediaAsset, mode: PanelMode): boolean {
  if (mode === 'stock') return asset.kind === 'video'
  if (mode === 'photos') return asset.kind === 'image'
  if (mode === 'audio') return asset.kind === 'audio'
  return true
}

export function MediaPanel({ style, mode = 'stock' }: { style?: React.CSSProperties; mode?: PanelMode }) {
  const { assets } = useMediaLibrary()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const [url, setUrl] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlFallback, setUrlFallback] = useState<string | null>(null)

  const cfg = PANEL_CONFIG[mode]
  const [source, setSource] = useState<MediaSource>(cfg.hasStockSearch ? 'pexel' : 'uploads')

  const onPick = useCallback(async (files: FileList | File[] | null) => {
    if (!files || ('length' in files && files.length === 0)) return
    await importFiles(files)
  }, [])

  const onAddUrl = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed || urlBusy) return
    setUrlBusy(true)
    setUrlError(null)
    setUrlFallback(null)
    try {
      const result = await importUrl(trimmed)
      setUrl('')
      setShowUrl(false)
      if (cfg.expectedKind && result.kind !== cfg.expectedKind) {
        setUrlFallback(`Imported as ${result.kind} — find it in the ${PANEL_LABEL[result.kind]} panel.`)
      }
    } catch {
      setUrlError('Could not import that URL.')
    } finally {
      setUrlBusy(false)
    }
  }, [url, urlBusy, cfg.expectedKind])

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files?.length) onPick(e.dataTransfer.files)
    },
    [onPick],
  )

  const showUploads = source === 'uploads' || !cfg.hasStockSearch
  const filtered = sortByRecent(
    assets.filter((a) => {
      if (!filterByMode(a, mode)) return false
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    }),
  )

  return (
    <div className="flex h-full flex-col bg-ed-panel text-ed-text" style={style}>
      {/* Header — panel title + upload action */}
      <div className="flex items-center justify-between border-b border-ed-border px-3.5 py-2.5">
        <span className="text-[13px] font-semibold text-ed-text">{cfg.title}</span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--elah-accent)' }}
        >
          <Plus size={12} />
          Upload
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden p-3.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={cfg.accept}
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />

        {/* Search + source selector */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ed-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${cfg.title.toLowerCase()}…`}
              className="w-full rounded-md border border-ed-border bg-ed-bg-2 py-1.5 pl-7 pr-2.5 text-[12px] text-ed-text placeholder:text-ed-text-muted focus:border-[var(--elah-accent)] focus:outline-none"
            />
          </div>
          {cfg.hasStockSearch && (
            <Dropdown
              value={source}
              options={SOURCE_OPTIONS}
              onChange={(v) => setSource(v as MediaSource)}
              align="right"
            />
          )}
        </div>

        {/* Add from URL — only for panels that support it (no stock search alternative) */}
        {cfg.hasUrlImport && (
          <>
            <button
              type="button"
              onClick={() => {
                setShowUrl((s) => !s)
                setUrlFallback(null)
              }}
              className="mt-2 inline-flex items-center gap-1.5 self-start text-[11px] text-ed-text-muted hover:text-ed-text transition-colors"
            >
              <Link2 size={12} />
              Add from URL
            </button>
            {showUrl && (
              <div className="mt-1.5 flex gap-1.5">
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setUrlError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && onAddUrl()}
                  placeholder="https://…/clip.mp3"
                  className="min-w-0 flex-1 rounded-md border border-ed-border bg-ed-bg-2 px-2.5 py-1.5 text-[12px] text-ed-text placeholder:text-ed-text-muted focus:border-[var(--elah-accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={onAddUrl}
                  disabled={urlBusy || !url.trim()}
                  className="shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--elah-accent)' }}
                >
                  {urlBusy ? '…' : 'Add'}
                </button>
              </div>
            )}
            {urlError && <span className="mt-1 text-[11px] text-ed-error">{urlError}</span>}
            {urlFallback && <span className="mt-1 text-[11px] text-ed-text-muted">{urlFallback}</span>}
          </>
        )}

        <div
          className={cn(
            'mt-3 flex-1 overflow-y-auto rounded-lg transition-colors',
            dragOver && 'outline outline-2 outline-dashed outline-[var(--elah-accent)]',
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {!showUploads ? (
            <PexelsResults
              key={mode === 'stock' ? 'videos' : 'photos'}
              kind={mode === 'stock' ? 'videos' : 'photos'}
              query={search}
            />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-6 text-center text-ed-text-muted">
              <span className="text-[12px]">{search ? 'No matches' : cfg.emptyLabel}</span>
              {!search && <span className="text-[11px]">{cfg.emptyHint}</span>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {filtered.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MediaPanel
