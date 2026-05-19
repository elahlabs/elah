import {
  useCallback,
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
} from '../../core/media'
import type { DragMediaPayload, MediaAsset, MediaKind } from '../../core/media/types'

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
        flexDirection: 'column',
        gap: 4,
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          background: '#1e1e1e',
          borderRadius: 6,
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
              fontSize: 28,
              color: '#555',
            }}
          >
            {KIND_ICONS[asset.kind]}
          </div>
        )}
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            fontSize: 9,
            fontFamily: 'monospace',
            color: '#ccc',
            background: 'rgba(0,0,0,0.65)',
            padding: '1px 4px',
            borderRadius: 3,
          }}
        >
          {formatDuration(asset.durationSec)}
        </span>
      </div>
      <span
        style={{
          fontSize: 10,
          color: '#aaa',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {asset.name}
      </span>
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

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setImporting(true)
    try {
      await importFiles(list)
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
        }}
      >
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
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
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
