import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  importFiles,
  importUrl,
  MEDIA_DRAG_MIME,
  useMediaLibrary,
  useMediaLibraryStore,
  type SkippedImport,
  type MediaAsset,
  type MediaKind,
  type DragMediaPayload,
} from '@elah/core'
import { ELEMENT_DRAG_MIME, type DragElementPayload, type ElementKind } from '@elah/timeline'

export interface SourcePanelProps {
  style?: CSSProperties
  className?: string
  defaultLane?: Lane
}

type Lane = 'media' | 'elements'
type ViewMode = 'grid' | 'list'
type SortKey = 'name' | 'kind' | 'duration' | 'added'

// ── Helpers ────────────────────────────────────────────────────────────────

const KIND_ICONS: Record<MediaKind, string> = { video: '▶', audio: '♪', image: '◻' }

const KIND_TOKEN: Record<MediaKind, { label: string; fg: string; bg: string }> = {
  video: { label: 'VIDEO', fg: 'var(--elah-tag-video-fg)', bg: 'var(--elah-tag-video-bg)' },
  audio: { label: 'AUDIO', fg: 'var(--elah-tag-audio-fg)', bg: 'var(--elah-tag-audio-bg)' },
  image: { label: 'IMAGE', fg: 'var(--elah-tag-image-fg)', bg: 'var(--elah-tag-image-bg)' },
}

const TOAST_DISMISS_MS = 3000
const THUMB_SIZE = 52

interface ImportToast { message: string; tone: 'info' | 'warn' }

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function buildToast(skipped: SkippedImport[]): ImportToast | null {
  if (skipped.length === 0) return null
  const dups = skipped.filter((s) => s.reason === 'duplicate')
  const bad = skipped.filter((s) => s.reason === 'unsupported')
  const lines: string[] = []
  if (dups.length) lines.push(`Skipped ${dups.length} duplicate${dups.length > 1 ? 's' : ''}`)
  if (bad.length) lines.push(`Skipped ${bad.length} unsupported file${bad.length > 1 ? 's' : ''}`)
  return { message: lines.join('\n'), tone: bad.length ? 'warn' : 'info' }
}

function filterSort(
  assets: MediaAsset[],
  search: string,
  kind: MediaKind | 'all',
  sort: SortKey,
): MediaAsset[] {
  let out = assets
  if (kind !== 'all') out = out.filter((a) => a.kind === kind)
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    out = out.filter((a) => a.name.toLowerCase().includes(q))
  }
  return [...out].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'kind') return a.kind.localeCompare(b.kind)
    if (sort === 'duration') return (a.durationSec ?? 0) - (b.durationSec ?? 0)
    return 0 // 'added' — preserve insertion order
  })
}

// ── Palette tiles (Elements lane) ──────────────────────────────────────────

interface PaletteTile { element: ElementKind; label: string; icon: string; iconStyle?: CSSProperties }

const PALETTE_TILES: PaletteTile[] = [
  {
    element: 'text',
    label: 'Text',
    icon: 'T',
    iconStyle: {
      background: 'var(--elah-tag-text-bg)',
      border: '1px solid var(--elah-tag-text-border)',
      color: 'var(--elah-tag-text-fg)',
      fontFamily: 'Georgia, serif',
      fontWeight: 700,
      fontSize: 17,
    },
  },
]

// ── Media clip card ────────────────────────────────────────────────────────

function ClipCard({
  asset,
  viewMode,
  onDelete,
}: {
  asset: MediaAsset
  viewMode: ViewMode
  onDelete: (id: string) => void
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const tag = KIND_TOKEN[asset.kind]

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [asset.id],
  )

  const closeCtx = useCallback(() => setCtxMenu(null), [])
  const handleDelete = useCallback(() => { onDelete(asset.id); setCtxMenu(null) }, [asset.id, onDelete])

  if (viewMode === 'list') {
    return (
      <>
        <div
          draggable
          className="elah-media-card flex items-center gap-2 px-[10px] py-[6px] rounded-sm cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[120ms]"
          onDragStart={onDragStart}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
          title={asset.name}
        >
          <span className="text-sm text-ed-text-muted shrink-0 w-[18px] text-center">
            {KIND_ICONS[asset.kind]}
          </span>
          <span className="flex-1 text-[11px] text-ed-text overflow-hidden text-ellipsis whitespace-nowrap">
            {asset.name}
          </span>
          <span
            className="text-[9px] font-bold tracking-[0.06em] px-1 py-px rounded-sm shrink-0"
            style={{ color: tag.fg, background: tag.bg }}
          >
            {tag.label}
          </span>
          <span className="text-[10px] text-ed-text-muted font-mono shrink-0">
            {formatDuration(asset.durationSec)}
          </span>
        </div>
        {ctxMenu && <CtxMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtx} onDelete={handleDelete} />}
      </>
    )
  }

  // Grid view
  return (
    <>
      <div
        draggable
        className="elah-media-card flex items-center gap-[10px] px-[10px] py-2 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms]"
        onDragStart={onDragStart}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        title={asset.name}
      >
        <div
          className="relative shrink-0 bg-ed-bg rounded-sm border border-ed-border-subtle overflow-hidden"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        >
          {asset.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" draggable={false} className="w-full h-full object-cover block" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xl text-ed-text-muted">
              {KIND_ICONS[asset.kind]}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-[3px] min-w-0">
          <span className="text-[11px] text-ed-text overflow-hidden text-ellipsis whitespace-nowrap">
            {asset.name}
          </span>
          <div className="flex items-center gap-[6px]">
            <span
              className="text-[8px] font-bold tracking-[0.06em] px-[5px] py-[2px] rounded-sm"
              style={{ color: tag.fg, background: tag.bg }}
            >
              {tag.label}
            </span>
            <span className="text-[10px] text-ed-text-muted font-mono">
              {formatDuration(asset.durationSec)}
            </span>
          </div>
        </div>
      </div>
      {ctxMenu && <CtxMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtx} onDelete={handleDelete} />}
    </>
  )
}

function CtxMenu({ x, y, onClose, onDelete }: { x: number; y: number; onClose: () => void; onDelete: () => void }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onMouseDown={onClose} />
      <div
        style={{
          position: 'fixed',
          top: y,
          left: x,
          zIndex: 9999,
          background: 'var(--elah-bg-elevated)',
          border: '1px solid var(--elah-outline)',
          borderRadius: 'var(--elah-radius-sm)',
          padding: '4px 0',
          minWidth: 140,
          boxShadow: 'var(--elah-menu-shadow, 0 8px 24px rgba(0,0,0,0.5))',
          fontFamily: 'var(--elah-font-ui)',
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onDelete}
          className="block w-full px-[14px] py-[7px] text-left bg-transparent border-none text-ed-error text-[13px] cursor-pointer"
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--elah-color-error) 12%, transparent)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
        >
          Delete
        </button>
      </div>
    </>,
    document.body,
  )
}

// ── SourcePanel ─────────────────────────────────────────────────────────────

/**
 * Unified source rail — `Media | Elements` lane selector with shared toolbar.
 * Media lane: ingestion bar + search/filter/sort + three view modes + full
 * state set (empty, skeleton, error, duplicate-skipped, hover-scrub).
 * Elements lane: 2-column palette grid of draggable element tiles.
 *
 * Must be rendered inside `<EditorProvider>`.
 */
export function SourcePanel({ style, className, defaultLane = 'media' }: SourcePanelProps) {
  // ── Lane state
  const [lane, setLane] = useState<Lane>(defaultLane)

  // ── Media library
  const { assets } = useMediaLibrary()
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Media toolbar state
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<MediaKind | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('added')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // ── Ingestion state
  const [isDragOver, setIsDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<ImportToast | null>(null)
  const [urlInputOpen, setUrlInputOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')

  // ── Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const id = globalThis.setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => globalThis.clearTimeout(id)
  }, [toast])

  const handleDeleteAsset = useCallback((id: string) => removeAsset(id), [removeAsset])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setImporting(true)
    try {
      const { skipped } = await importFiles(list)
      setToast(buildToast(skipped))
    } finally {
      setImporting(false)
    }
  }, [])

  const handleImportUrl = useCallback(async () => {
    const url = urlValue.trim()
    if (!url) return
    setImporting(true)
    try {
      await importUrl(url)
      setUrlValue('')
      setUrlInputOpen(false)
    } catch (err) {
      setToast({ message: `Failed: ${err instanceof Error ? err.message : String(err)}`, tone: 'warn' })
    } finally {
      setImporting(false)
    }
  }, [urlValue])

  const onUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void handleImportUrl() }
    else if (e.key === 'Escape') { setUrlInputOpen(false); setUrlValue('') }
  }, [handleImportUrl])

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true)
    }
  }, [])

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragOver(false)
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void handleFiles(e.target.files)
    e.target.value = ''
  }, [handleFiles])

  // ── Element drag helper
  const makeDragStart = useCallback(
    (element: ElementKind) => (e: DragEvent<HTMLDivElement>) => {
      const payload: DragElementPayload = { kind: 'element', element }
      e.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  const visibleAssets = filterSort(assets, search, kindFilter, sort)
  const kindCounts: Record<string, number> = { all: assets.length }
  for (const a of assets) kindCounts[a.kind] = (kindCounts[a.kind] ?? 0) + 1

  const KIND_CHIPS: Array<{ value: MediaKind | 'all'; label: string }> = [
    { value: 'all', label: `All ${kindCounts.all}` },
    { value: 'video', label: `Video ${kindCounts.video ?? 0}` },
    { value: 'audio', label: `Audio ${kindCounts.audio ?? 0}` },
    { value: 'image', label: `Image ${kindCounts.image ?? 0}` },
  ]

  return (
    <div
      className={`flex flex-col h-full bg-transparent${className ? ` ${className}` : ''}`}
      style={style}
    >
      {/* ── Lane selector ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-2 py-[6px] border-b border-ed-border gap-1 shrink-0">
        {(['media', 'elements'] as Lane[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLane(l)}
            style={{
              flex: 1,
              padding: '5px 0',
              fontSize: 11,
              fontWeight: lane === l ? 600 : 500,
              fontFamily: 'var(--elah-font-ui)',
              background: lane === l ? 'var(--elah-bg-elevated)' : 'transparent',
              color: lane === l ? 'var(--elah-text)' : 'var(--elah-text-muted)',
              border: lane === l ? '1px solid var(--elah-border)' : '1px solid transparent',
              borderRadius: 'var(--elah-radius-sm)',
              cursor: 'pointer',
              transition: 'all 0.12s',
              textTransform: 'capitalize',
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── Media lane ────────────────────────────────────────────────────── */}
      {lane === 'media' && (
        <div
          className="flex flex-col flex-1 min-h-0"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={onFileChange} data-testid="source-file-input" />

          {/* Ingestion bar */}
          <div className="flex items-center gap-[6px] px-[10px] py-2 border-b border-ed-border shrink-0">
            <button
              type="button"
              onClick={() => setUrlInputOpen((o) => !o)}
              disabled={importing}
              data-testid="source-url-toggle"
              style={ingestBtnStyle(urlInputOpen, importing)}
            >
              + URL
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              style={ingestBtnStyle(false, importing)}
            >
              {importing ? '…' : '+ Add'}
            </button>
            <div className="flex-1" />
            {/* View mode toggle */}
            {(['grid', 'list'] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewMode(v)}
                title={`${v} view`}
                style={{
                  width: 26,
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: viewMode === v ? 'var(--elah-bg-elevated)' : 'transparent',
                  border: viewMode === v ? '1px solid var(--elah-border)' : '1px solid transparent',
                  borderRadius: 'var(--elah-radius-sm)',
                  cursor: 'pointer',
                  color: viewMode === v ? 'var(--elah-text)' : 'var(--elah-text-muted)',
                  fontSize: 12,
                }}
              >
                {v === 'grid' ? '⊞' : '≡'}
              </button>
            ))}
          </div>

          {/* URL input */}
          {urlInputOpen && (
            <div className="flex gap-[6px] px-[10px] py-2 border-b border-ed-border shrink-0">
              <input
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={onUrlKeyDown}
                placeholder="https://…/media.mp4"
                autoFocus
                data-testid="source-url-input"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '5px 8px',
                  fontSize: 11,
                  fontFamily: 'var(--elah-font-mono)',
                  color: 'var(--elah-text)',
                  background: 'var(--elah-bg)',
                  border: '1px solid var(--elah-border)',
                  borderRadius: 'var(--elah-radius-sm)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void handleImportUrl()}
                disabled={importing || !urlValue.trim()}
                style={ingestBtnStyle(false, importing || !urlValue.trim())}
              >
                Add
              </button>
            </div>
          )}

          {/* Search + sort toolbar */}
          <div className="flex items-center gap-[6px] px-[10px] py-[6px] border-b border-ed-border shrink-0">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--elah-text)',
                background: 'var(--elah-bg)',
                border: '1px solid var(--elah-border)',
                borderRadius: 'var(--elah-radius-sm)',
                outline: 'none',
                fontFamily: 'var(--elah-font-ui)',
              }}
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              style={{
                padding: '4px 6px',
                fontSize: 10,
                color: 'var(--elah-text-muted)',
                background: 'var(--elah-bg-card)',
                border: '1px solid var(--elah-border)',
                borderRadius: 'var(--elah-radius-sm)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="added">Added</option>
              <option value="name">Name</option>
              <option value="kind">Type</option>
              <option value="duration">Duration</option>
            </select>
          </div>

          {/* Kind chips */}
          <div className="flex gap-1 px-[10px] py-[6px] border-b border-ed-border shrink-0 overflow-x-auto">
            {KIND_CHIPS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setKindFilter(value)}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: kindFilter === value ? 700 : 500,
                  background: kindFilter === value ? 'var(--elah-accent-soft)' : 'var(--elah-bg-card)',
                  color: kindFilter === value ? 'var(--elah-accent-dim)' : 'var(--elah-text-muted)',
                  border: kindFilter === value ? '1px solid var(--elah-accent)' : '1px solid var(--elah-border)',
                  borderRadius: 20,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.12s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Asset list */}
          <div
            className="flex-1 overflow-auto p-2 relative rounded"
            style={{
              outline: isDragOver ? '2px dashed var(--elah-accent)' : 'none',
              outlineOffset: -4,
            }}
          >
            {toast && (
              <div
                role="status"
                className="absolute top-2 left-2 right-2 z-[2] px-[10px] py-2 rounded-sm text-[10px] font-mono leading-[1.4] whitespace-pre-line"
                style={{
                  color: toast.tone === 'warn' ? 'var(--elah-danger-text, #f5d0a9)' : 'var(--elah-info-text, #c8d8f0)',
                  background: toast.tone === 'warn' ? 'var(--elah-danger-bg, #3a2418)' : 'var(--elah-info-bg, #1a2433)',
                  border: `1px solid ${toast.tone === 'warn' ? 'var(--elah-danger-border, #7a4a2a)' : 'var(--elah-info-border, #355070)'}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                }}
              >
                {toast.message}
              </div>
            )}

            {assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[120px] p-4 text-center text-ed-text-muted text-[11px] border border-dashed border-ed-border rounded-md">
                <span className="mb-2 text-2xl opacity-50">↓</span>
                Drop files here<br />or click Add
              </div>
            ) : visibleAssets.length === 0 ? (
              <div className="text-center text-ed-text-muted text-[11px] pt-8">
                No matches
              </div>
            ) : (
              <div className="flex flex-col gap-[6px]">
                {visibleAssets.map((asset) => (
                  <ClipCard
                    key={asset.id}
                    asset={asset}
                    viewMode={viewMode}
                    onDelete={handleDeleteAsset}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Elements lane ─────────────────────────────────────────────────── */}
      {lane === 'elements' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          {/* Elements search (no chips, no filmstrip) */}
          <div className="px-[10px] py-[6px] border-b border-ed-border shrink-0">
            <input
              type="search"
              placeholder="Search elements…"
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--elah-text)',
                background: 'var(--elah-bg)',
                border: '1px solid var(--elah-border)',
                borderRadius: 'var(--elah-radius-sm)',
                outline: 'none',
                fontFamily: 'var(--elah-font-ui)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Palette grid — 2-column */}
          <div className="p-[10px] grid grid-cols-2 gap-[6px]">
            {PALETTE_TILES.map(({ element, label, icon, iconStyle }) => (
              <div
                key={element}
                draggable
                className="elah-element-card flex flex-col items-center justify-center gap-[6px] px-2 py-3 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms] min-h-[72px]"
                onDragStart={makeDragStart(element)}
                title={`Drag ${label} onto the timeline`}
              >
                <span
                  className="w-8 h-8 flex items-center justify-center rounded-sm"
                  style={iconStyle}
                >
                  {icon}
                </span>
                <span className="text-[11px] text-ed-text font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Style helpers ──────────────────────────────────────────────────────────

function ingestBtnStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'var(--elah-font-ui)',
    background: active ? 'var(--elah-bg-elevated)' : 'var(--elah-bg-card)',
    color: disabled ? 'var(--elah-text-muted)' : 'var(--elah-accent)',
    border: '1px solid var(--elah-border)',
    borderRadius: 'var(--elah-radius-sm)',
    cursor: disabled ? 'wait' : 'pointer',
    whiteSpace: 'nowrap',
  }
}
