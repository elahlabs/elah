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

const KIND_TAG: Record<MediaKind, { label: string; color: string; bg: string }> = {
  video: { label: 'VIDEO', color: '#93C5FD', bg: 'rgba(37, 99, 235, 0.2)' },
  audio: { label: 'AUDIO', color: '#86EFAC', bg: 'rgba(22, 163, 74, 0.2)' },
  image: { label: 'IMAGE', color: '#FCD34D', bg: 'rgba(245, 158, 11, 0.2)' },
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

  const tag = KIND_TAG[asset.kind]

  return (
    <div
      draggable
      className="elah-media-card"
      onDragStart={onDragStart}
      title={asset.name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        cursor: 'grab',
        userSelect: 'none',
        background: '#171D2B',
        border: '1px solid #232938',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          flexShrink: 0,
          background: '#06070A',
          borderRadius: 6,
          border: '1px solid #1A1F2B',
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
            fontSize: 11,
            color: '#F3F4F6',
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
              color: tag.color,
              background: tag.bg,
            }}
          >
            {tag.label}
          </span>
          <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
            {formatDuration(asset.durationSec)}
          </span>
        </div>
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
          borderBottom: '1px solid #232938',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em' }}>
          MEDIA
        </span>
        <button
          type="button"
          onClick={onBrowseClick}
          disabled={importing}
          style={{
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            background: importing ? '#121722' : '#171D2B',
            color: importing ? '#6B7280' : '#E11D48',
            border: '1px solid #232938',
            borderRadius: 6,
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
          outline: isDragOver ? '2px dashed #E11D48' : 'none',
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
              color: '#6B7280',
              fontSize: 11,
              border: '1px dashed #232938',
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
              gap: 6,
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
