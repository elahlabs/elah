import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ExternalLink, Film, Link2, X } from 'lucide-react'
import { tryElahHref } from './links'
import { formatBytes, type MissingFile } from './footageFiles'

/** The one sentence the page says about where footage goes. */
export const STAYS_LOCAL = 'Your clips stay in this browser. Nothing is uploaded.'

const ACCEPT = 'video/*,audio/*,.mov,.mkv,.m4v,.m4a'

/** A hidden file input and the function that opens it. */
export function useFilePicker(onFiles: (files: File[]) => void): { open: () => void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null)
  const open = useCallback(() => ref.current?.click(), [])
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      data-testid="footage-input"
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? [])
        e.currentTarget.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { open, input }
}

/** Header button: "Add footage" (narrow: "Footage"). */
export function AddFootageButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="btn" onClick={onClick} disabled={disabled} title={title ?? `Add your own video or audio at the playhead. ${STAYS_LOCAL}`} aria-label="Add footage" data-testid="add-footage">
      <Film size={14} /> <span className="lbl-wide">Add footage</span><span className="lbl-narrow">Footage</span>
    </button>
  )
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * Drag handlers for the whole page plus the overlay shown while files are over it. Only OS file drags react; the
 * timeline's own clip drags carry no `Files` type and pass straight through.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length) onFiles(files)
    },
  }
  const overlay = over ? (
    <div className="drop-overlay" data-testid="footage-drop" aria-hidden>
      <div>
        <Film size={22} />
        <b>Drop video or audio to add it at the playhead</b>
        <span>{STAYS_LOCAL}</span>
      </div>
    </div>
  ) : null
  return { handlers, overlay }
}

/** "Reconnect your clips": the files a saved project needs again, matched by name and size. */
export function ReconnectPrompt({ missing, onPick, onRemove, onDismiss }: { missing: MissingFile[]; onPick: () => void; onRemove: () => void; onDismiss: () => void }) {
  if (missing.length === 0) return null
  return (
    <section className="reconnect" aria-label="Reconnect your clips" data-testid="reconnect">
      <div className="reconnect-head">
        <Link2 size={14} />
        <b>Reconnect your clips</b>
        <span className="row-note">Clips are not stored or uploaded, so drop the same files here again. They are matched by name and size.</span>
        <button type="button" className="btn icon" aria-label="Hide" title="Hide (the clips stay missing)" onClick={onDismiss}>
          <X size={14} />
        </button>
      </div>
      <ul>
        {missing.map((m) => (
          <li key={m.id} data-testid="reconnect-row">
            <span className="fname">{m.name}</span>
            <span className="row-note">{formatBytes(m.byteSize)}{m.clips > 1 ? `, ${m.clips} clips` : ''}</span>
          </li>
        ))}
      </ul>
      <div className="reconnect-actions">
        <button type="button" className="btn primary" onClick={onPick} data-testid="reconnect-pick">Choose files</button>
        <button type="button" className="btn" onClick={onRemove} data-testid="reconnect-remove">Remove these clips</button>
      </div>
    </section>
  )
}

/** One dismissible line once the footage passes three minutes. Never blocks. */
export function CreatorNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="nudge" role="note" data-testid="footage-nudge">
      <span>Long footage projects, captions and background removal run better in Elah Creator.</span>
      <a className="btn" href={tryElahHref('footage')} target="_blank" rel="noopener noreferrer" data-testid="footage-try-elah">
        <ExternalLink size={14} /> Try Elah
      </a>
      <button type="button" className="btn icon" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  )
}
