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
  mediaDragKindMime,
  useMediaLibrary,
  useMediaLibraryStore,
  type SkippedImport,
  type MediaAsset,
  type MediaKind,
  type DragMediaPayload,
} from '@elah/core'
import { cn } from '@elah/timeline'
import { isActivationKey, useAssetActivation, type AssetActivationHandler } from '../activation'

export interface AssetPanelProps {
  style?: CSSProperties
  className?: string
  activateOnTap?: boolean
  onAssetActivate?: AssetActivationHandler
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

function AssetThumbnail({
  asset,
  onDelete,
  onActivate,
}: {
  asset: MediaAsset
  onDelete: (id: string) => void
  onActivate?: (asset: MediaAsset) => void
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(mediaDragKindMime(asset.kind), '')
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
  const handleActivate = useCallback(() => onActivate?.(asset), [asset, onActivate])
  const handleActivateKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onActivate || !isActivationKey(e.key)) return
      e.preventDefault()
      onActivate(asset)
    },
    [asset, onActivate],
  )

  const tag = KIND_TOKEN[asset.kind]

  return (
    <>
      <div
        draggable
        role={onActivate ? 'button' : undefined}
        tabIndex={onActivate ? 0 : undefined}
        className="elah-media-card flex items-center gap-[10px] px-[10px] py-2 rounded-md cursor-grab select-none bg-ed-card border border-ed-border transition-[background,border-color] duration-[150ms]"
        onDragStart={onDragStart}
        onClick={onActivate ? handleActivate : undefined}
        onKeyDown={onActivate ? handleActivateKey : undefined}
        onContextMenu={handleContextMenu}
        title={asset.name}
      >
        <div
          className="relative shrink-0 bg-ed-bg rounded-sm border border-ed-border-subtle overflow-hidden"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        >
          {asset.thumbnailUrl ? (
            <img
              src={asset.thumbnailUrl}
              alt=""
              draggable={false}
              className="w-full h-full object-cover block"
            />
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

      {ctxMenu &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={closeCtxMenu} />
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
                boxShadow: 'var(--elah-menu-shadow, 0 8px 24px rgba(0,0,0,0.5))',
                fontFamily: 'var(--elah-font-ui)',
              }}
            >
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleDelete}
                className="block w-full px-[14px] py-[7px] text-left bg-transparent border-none text-ed-error text-[13px] cursor-pointer tracking-[0.01em]"
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    'color-mix(in srgb, var(--elah-color-error) 12%, transparent)'
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
export function AssetPanel({ style, className, activateOnTap, onAssetActivate }: AssetPanelProps) {
  const { assets } = useMediaLibrary()
  const removeAsset = useMediaLibraryStore((s) => s.removeAsset)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<ImportToast | null>(null)
  const [urlInputOpen, setUrlInputOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const activationEnabled = activateOnTap === true || Boolean(onAssetActivate)
  const activateAsset = useAssetActivation({
    activateOnTap,
    onAssetActivate,
    setToast,
  })

  const handleDeleteAsset = useCallback(
    (id: string) => {
      removeAsset(id)
    },
    [removeAsset],
  )
  const handleAssetActivate = useCallback(
    (asset: MediaAsset) => {
      void activateAsset({ kind: 'media-asset', asset })
    },
    [activateAsset],
  )

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
      className={cn('flex flex-col h-full bg-transparent', className)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={style}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={onFileInputChange}
        data-testid="asset-file-input"
      />

      <div className="flex items-center justify-between px-3 py-[10px] border-b border-ed-border shrink-0">
        <span className="text-[10px] font-bold text-ed-text-muted tracking-[0.08em]">MEDIA</span>
        <div className="flex gap-[6px]">
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
        <div className="flex gap-[6px] px-3 py-2 border-b border-ed-border shrink-0">
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
              color:
                importing || urlValue.trim().length === 0
                  ? 'var(--elah-text-muted)'
                  : 'var(--elah-accent)',
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
              color:
                toast.tone === 'warn'
                  ? 'var(--elah-danger-text, #f5d0a9)'
                  : 'var(--elah-info-text, #c8d8f0)',
              background:
                toast.tone === 'warn'
                  ? 'var(--elah-danger-bg, #3a2418)'
                  : 'var(--elah-info-bg, #1a2433)',
              border: `1px solid ${toast.tone === 'warn' ? 'var(--elah-danger-border, #7a4a2a)' : 'var(--elah-info-border, #355070)'}`,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
            }}
          >
            {toast.message}
          </div>
        )}
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[120px] p-4 text-center text-ed-text-muted text-[11px] border border-dashed border-ed-border rounded-md">
            <span className="mb-2 text-2xl opacity-50">↓</span>
            Drop files here
            <br />
            or click Add
          </div>
        ) : (
          <div className="flex flex-col gap-[6px]">
            {assets.map((asset) => (
              <AssetThumbnail
                key={asset.id}
                asset={asset}
                onDelete={handleDeleteAsset}
                onActivate={activationEnabled ? handleAssetActivate : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
