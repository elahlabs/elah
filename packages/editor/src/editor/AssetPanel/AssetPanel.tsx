import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from 'react'
import {
  importFiles,
  MEDIA_DRAG_MIME,
  useMediaLibrary,
} from '../../core/assets'
import type { SkippedImport } from '../../core/assets'
import type { DragMediaPayload, MediaAsset, MediaKind } from '../../core/assets/types'

export interface AssetPanelProps {
  style?: CSSProperties
  className?: string
}

const KIND_ICONS: Record<MediaKind, string> = {
  video: '▶',
  audio: '♪',
  image: '◻',
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

function AssetThumbnail({ asset }: { asset: MediaAsset }) {
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const payload: DragMediaPayload = { kind: 'media-asset', assetId: asset.id }
      e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [asset.id],
  )

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={asset.name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 5,
        cursor: 'grab',
        userSelect: 'none',
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          flexShrink: 0,
          background: '#111',
          borderRadius: 4,
          border: '1px solid #333',
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
              color: '#555',
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
            fontSize: 10,
            color: '#ccc',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {asset.name}
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: 'monospace',
            color: '#666',
          }}
        >
          {formatDuration(asset.durationSec)}
        </span>
      </div>
    </div>
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<ImportToast | null>(null)

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
        background: '#121212',
        borderRight: '1px solid #2a2a2a',
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
          padding: '8px 10px',
          borderBottom: '1px solid #2a2a2a',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#888', fontFamily: 'monospace' }}>
          Media
        </span>
        <button
          type="button"
          onClick={onBrowseClick}
          disabled={importing}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            background: importing ? '#333' : '#2a2a2a',
            color: importing ? '#666' : '#ddd',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            cursor: importing ? 'wait' : 'pointer',
          }}
        >
          {importing ? '…' : '+ Add'}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 8,
          outline: isDragOver ? '2px dashed #4a7fd4' : 'none',
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
              borderRadius: 6,
              fontSize: 10,
              fontFamily: 'monospace',
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
              color: '#666',
              fontSize: 11,
              fontFamily: 'monospace',
              border: '1px dashed #333',
              borderRadius: 8,
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
              gap: 4,
            }}
          >
            {assets.map((asset) => (
              <AssetThumbnail key={asset.id} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
