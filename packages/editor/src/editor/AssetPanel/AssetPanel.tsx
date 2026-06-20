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

export interface AssetPanelProps {
  style?: CSSProperties
  className?: string
}

const KIND_ICONS: Record<MediaKind, string> = {
  video: '▶',
  audio: '♪',
  image: '◻',
}

const KIND_TOKEN: Record<MediaKind, { label: string; fg: string; bg: string }> = {
  video: { label: 'VIDEO', fg: 'var(--elah-tag-video-fg)', bg: 'var(--elah-tag-video-bg)' },
  audio: { label: 'AUDIO', fg: 'var(--elah-tag-audio-fg)', bg: 'var(--elah-tag-audio-bg)' },
  image: { label: 'IMAGE', fg: 'var(--elah-tag-image-fg)', bg: 'var(--elah-tag-image-bg)' },
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
}

const THUMB_SIZE = 52
const TOAST_DISMISS_MS = 3000

interface ImportToast {
  message: string
  tone: 'info' | 'warn'
}

function formatFileNames(files: File[], maxNames = 3): string {
  const names = files.map((file) => file.name)
  if (names.length <= maxNames) return names.join(', ')
  const shown = names.slice(0, maxNames).join(', ')
  return `${shown} +${names.length - maxNames} more`
}

function buildImportToast(skipped: SkippedImport[]): ImportToast | null {
  if (skipped.length === 0) return null

  const duplicates = skipped.filter((entry) => entry.reason === 'duplicate')
  const unsupported = skipped.filter((entry) => entry.reason === 'unsupported')
  const lines: string[] = []

  if (duplicates.length > 0) {
    lines.push(
      `Skipped ${duplicates.length} duplicate file${duplicates.length === 1 ? '' : 's'}: ${formatFileNames(duplicates.map((entry) => entry.file))}`,
    )
  }

  if (unsupported.length > 0) {
    lines.push(
      `Skipped ${unsupported.length} unsupported file${unsupported.length === 1 ? '' : 's'}: ${formatFileNames(unsupported.map((entry) => entry.file))}`,
    )
  }

  return {
    message: lines.join('\n'),
    tone: unsupported.length > 0 ? 'warn' : 'info',
  }
}

function AssetThumbnail({ asset, onDelete }: { asset: MediaAsset; onDelete: (id: string) => void }) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [asset.id],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const handleDelete = useCallback(() => {
    onDelete(asset.id)
    setCtxMenu(null)
  }, [asset.id, onDelete])

  const tag = KIND_TOKEN[asset.kind]

  return (
    <>
      <div
        draggable
        className="elah-media-card"
        onDragStart={onDragStart}
        onContextMenu={handleContextMenu}
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
            <img
              src={asset.thumbnailUrl}
              alt=""
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                color: 'var(--elah-text-muted)',
              }}
            >
              {KIND_ICONS[asset.kind]}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--elah-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {asset.name}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '2px 5px',
                borderRadius: 3,
                color: tag.fg,
                background: tag.bg,
              }}
            >
              {tag.label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--elah-text-muted)', fontFamily: 'var(--elah-font-mono)' }}>
              {formatDuration(asset.durationSec)}
            </span>
          </div>
        </div>
      </div>

      {ctxMenu && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onMouseDown={closeCtxMenu}
          />
          <div
            style={{
              position: 'fixed',
              top: ctxMenu.y,
              left: ctxMenu.x,
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
              onClick={handleDelete}
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 14px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: 'var(--elah-color-error)',
                fontSize: 13,
                cursor: 'pointer',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--elah-color-error) 12%, transparent)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              Delete
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

/**
 * Media library panel: browse or drop files, display thumbnails, drag assets
 * onto the timeline (PR-09 consumes `MEDIA_DRAG_MIME` on drop).
 *
 * Must be rendered inside `<EditorProvider>`.
 */
export function AssetPanel({ style, className }: AssetPanelProps) {
  const { assets } = useMediaLibrary()
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<ImportToast | null>(null)
  const [urlInputOpen, setUrlInputOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')

  const handleDeleteAsset = useCallback((id: string) => {
    removeAsset(id)
  }, [removeAsset])

  useEffect(() => {
    if (!toast) return
    const timer = globalThis.setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => globalThis.clearTimeout(timer)
  }, [toast])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setImporting(true)
    try {
      const { skipped } = await importFiles(list)
      setToast(buildImportToast(skipped))
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
      setToast({
        message: `Failed to import URL: ${err instanceof Error ? err.message : String(err)}`,
        tone: 'warn',
      })
    } finally {
      setImporting(false)
    }
  }, [urlValue])

  const onUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleImportUrl()
      } else if (e.key === 'Escape') {
        setUrlInputOpen(false)
        setUrlValue('')
      }
    },
    [handleImportUrl],
  )

  const onBrowseClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        void handleFiles(files)
      }
      e.target.value = ''
    },
    [handleFiles],
  )

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = e.dataTransfer.files
      if (files.length > 0) {
        void handleFiles(files)
      }
    },
    [handleFiles],
  )

  return (
    <div
      className={className}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'transparent',
        borderRight: 'none',
        ...style,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: 'none' }}
        onChange={onFileInputChange}
        data-testid="asset-file-input"
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--elah-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--elah-text-muted)', letterSpacing: '0.08em' }}>
          MEDIA
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setUrlInputOpen((open) => !open)}
            disabled={importing}
            data-testid="asset-url-toggle"
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: urlInputOpen ? 'var(--elah-bg-elevated)' : 'var(--elah-bg-card)',
              color: importing ? 'var(--elah-text-muted)' : 'var(--elah-accent)',
              border: '1px solid var(--elah-border)',
              borderRadius: 'var(--elah-radius-sm)',
              cursor: importing ? 'wait' : 'pointer',
            }}
          >
            + URL
          </button>
          <button
            type="button"
            onClick={onBrowseClick}
            disabled={importing}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: importing ? 'var(--elah-bg-panel)' : 'var(--elah-bg-card)',
              color: importing ? 'var(--elah-text-muted)' : 'var(--elah-accent)',
              border: '1px solid var(--elah-border)',
              borderRadius: 'var(--elah-radius-sm)',
              cursor: importing ? 'wait' : 'pointer',
            }}
          >
            {importing ? '…' : '+ Add'}
          </button>
        </div>
      </div>

      {urlInputOpen && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 12px',
            borderBottom: '1px solid var(--elah-border)',
            flexShrink: 0,
          }}
        >
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={onUrlKeyDown}
            placeholder="https://…/media.mp4"
            autoFocus
            data-testid="asset-url-input"
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
            disabled={importing || urlValue.trim().length === 0}
            style={{
              padding: '5px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--elah-bg-card)',
              color: importing || urlValue.trim().length === 0 ? 'var(--elah-text-muted)' : 'var(--elah-accent)',
              border: '1px solid var(--elah-border)',
              borderRadius: 'var(--elah-radius-sm)',
              cursor: importing ? 'wait' : 'pointer',
            }}
          >
            Add
          </button>
        </div>
      )}

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
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
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
            Drop files here
            <br />
            or click Add
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {assets.map((asset) => (
              <AssetThumbnail key={asset.id} asset={asset} onDelete={handleDeleteAsset} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
