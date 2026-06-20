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
          className="elah-media-card"
          onDragStart={onDragStart}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
          title={asset.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 'var(--elah-radius-sm)',
            cursor: 'grab',
            userSelect: 'none',
            background: 'var(--elah-bg-card)',
            border: '1px solid var(--elah-border)',
            transition: 'background 0.12s, border-color 0.12s',
          }}
        >
          <span style={{ fontSize: 14, color: 'var(--elah-text-muted)', flexShrink: 0, width: 18, textAlign: 'center' }}>
            {KIND_ICONS[asset.kind]}
          </span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--elah-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.name}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '1px 4px', borderRadius: 3, color: tag.fg, background: tag.bg, flexShrink: 0 }}>
            {tag.label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--elah-text-muted)', fontFamily: 'var(--elah-font-mono)', flexShrink: 0 }}>
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
        className="elah-media-card"
        onDragStart={onDragStart}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        title={asset.name}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          borderRadius: 'var(--elah-radius-md)',
          cursor: 'grab',
          userSelect: 'none',
          background: 'var(--elah-bg-card)',
          border: '1px solid var(--elah-border)',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            flexShrink: 0,
            background: 'var(--elah-bg)',
            borderRadius: 'var(--elah-radius-sm)',
            border: '1px solid var(--elah-border-subtle)',
            overflow: 'hidden',
          }}
        >
          {asset.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--elah-text-muted)' }}>
              {KIND_ICONS[asset.kind]}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--elah-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.name}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 5px', borderRadius: 3, color: tag.fg, background: tag.bg }}>
              {tag.label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--elah-text-muted)', fontFamily: 'var(--elah-font-mono)' }}>
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={onClose} />
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
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          fontFamily: 'var(--elah-font-ui)',
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onDelete}
          style={{ display: 'block', width: '100%', padding: '7px 14px', textAlign: 'left', background: 'none', border: 'none', color: 'var(--elah-color-error)', fontSize: 13, cursor: 'pointer' }}
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
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'transparent',
        ...style,
      }}
    >
      {/* ── Lane selector ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px',
          borderBottom: '1px solid var(--elah-border)',
          gap: 4,
          flexShrink: 0,
        }}
      >
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
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*" style={{ display: 'none' }} onChange={onFileChange} data-testid="source-file-input" />

          {/* Ingestion bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              borderBottom: '1px solid var(--elah-border)',
              flexShrink: 0,
            }}
          >
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
            <div style={{ flex: 1 }} />
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
            <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--elah-border)', flexShrink: 0 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--elah-border)', flexShrink: 0 }}>
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
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--elah-border)', flexShrink: 0, overflowX: 'auto' }}>
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
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 8,
              outline: isDragOver ? '2px dashed var(--elah-accent)' : 'none',
              outlineOffset: -4,
              borderRadius: 4,
              position: 'relative',
            }}
          >
            {toast && (
              <div
                role="status"
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  right: 8,
                  zIndex: 2,
                  padding: '8px 10px',
                  borderRadius: 'var(--elah-radius-sm)',
                  fontSize: 10,
                  fontFamily: 'var(--elah-font-mono)',
                  lineHeight: 1.4,
                  whiteSpace: 'pre-line',
                  color: toast.tone === 'warn' ? '#f5d0a9' : '#c8d8f0',
                  background: toast.tone === 'warn' ? '#3a2418' : '#1a2433',
                  border: `1px solid ${toast.tone === 'warn' ? '#7a4a2a' : '#355070'}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                }}
              >
                {toast.message}
              </div>
            )}

            {assets.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 120,
                  padding: 16,
                  textAlign: 'center',
                  color: 'var(--elah-text-muted)',
                  fontSize: 11,
                  border: '1px dashed var(--elah-border)',
                  borderRadius: 'var(--elah-radius-md)',
                }}
              >
                <span style={{ marginBottom: 8, fontSize: 24, opacity: 0.5 }}>↓</span>
                Drop files here<br />or click Add
              </div>
            ) : visibleAssets.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--elah-text-muted)', fontSize: 11, paddingTop: 32 }}>
                No matches
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* Elements search (no chips, no filmstrip) */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--elah-border)', flexShrink: 0 }}>
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
          <div
            style={{
              padding: 10,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
            }}
          >
            {PALETTE_TILES.map(({ element, label, icon, iconStyle }) => (
              <div
                key={element}
                draggable
                className="elah-element-card"
                onDragStart={makeDragStart(element)}
                title={`Drag ${label} onto the timeline`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '12px 8px',
                  borderRadius: 'var(--elah-radius-md)',
                  cursor: 'grab',
                  userSelect: 'none',
                  background: 'var(--elah-bg-card)',
                  border: '1px solid var(--elah-border)',
                  transition: 'background 0.15s, border-color 0.15s',
                  minHeight: 72,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--elah-radius-sm)',
                    ...iconStyle,
                  }}
                >
                  {icon}
                </span>
                <span style={{ fontSize: 11, color: 'var(--elah-text)', fontWeight: 500 }}>{label}</span>
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
