'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Channel groups for display — order and names mirror trace.ts
const CHANNEL_GROUPS: { label: string; channels: string[] }[] = [
  { label: 'Audio', channels: ['AUDIO'] },
  { label: 'Playback', channels: ['SET_PLAYHEAD', 'PLAYHEAD', 'SEEK_GATE'] },
  { label: 'Media', channels: ['FEED', 'DECODE', 'CACHE_PUT', 'CACHE_GET'] },
  { label: 'Renderer', channels: ['UPLOAD', 'DRAW'] },
  { label: 'Export', channels: ['EXPORT', 'EXPORT_ASSETS', 'EXPORT_AUDIO', 'EXPORT_MUX', 'EXPORT_FRAMES'] },
]

function getTrace() {
  return typeof window !== 'undefined' ? window.__trace : undefined
}

export function TracePanel({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    const t = getTrace()
    return new Set(t?.status() ?? [])
  })

  // Keep a stable ref for the close handler so the keydown listener doesn't
  // need to be re-registered when onClose identity changes.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const toggle = useCallback((channel: string) => {
    const t = getTrace()
    if (!t) return
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(channel)) {
        t.off(channel as never)
        next.delete(channel)
      } else {
        t.on(channel as never)
        next.add(channel)
      }
      return next
    })
  }, [])

  const enableAll = useCallback(() => {
    const t = getTrace()
    if (!t) return
    const all = t.all()
    setEnabled(new Set(all))
  }, [])

  const disableAll = useCallback(() => {
    const t = getTrace()
    if (!t) return
    t.none()
    setEnabled(new Set())
  }, [])

  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-ed-border bg-ed-elevated shadow-[var(--elah-menu-shadow)]"
      style={{ minWidth: 240 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ed-border">
        <span className="text-[11px] font-mono font-semibold text-ed-text tracking-[0.04em]">
          Trace Channels
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={enableAll}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors cursor-pointer"
          >
            all
          </button>
          <button
            type="button"
            onClick={disableAll}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors cursor-pointer"
          >
            none
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Channel groups */}
      <div className="py-1.5 max-h-80 overflow-y-auto">
        {CHANNEL_GROUPS.map((group) => (
          <div key={group.label} className="px-3 pb-1.5">
            <div className="text-[9px] font-mono font-semibold text-ed-text-muted uppercase tracking-[0.08em] pt-1.5 pb-0.5">
              {group.label}
            </div>
            {group.channels.map((ch) => {
              const on = enabled.has(ch)
              return (
                <label
                  key={ch}
                  className="flex items-center gap-2 py-0.5 cursor-pointer group"
                >
                  <span
                    onClick={() => toggle(ch)}
                    className={cn(
                      'relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border transition-colors cursor-pointer shrink-0',
                      on
                        ? 'bg-[var(--elah-accent)] border-[var(--elah-accent)]'
                        : 'border-ed-border group-hover:border-ed-text-muted',
                    )}
                  >
                    {on && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span
                    onClick={() => toggle(ch)}
                    className={cn(
                      'text-[11px] font-mono select-none transition-colors',
                      on ? 'text-ed-text' : 'text-ed-text-muted group-hover:text-ed-text',
                    )}
                  >
                    {ch}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-ed-border">
        <p className="text-[9px] font-mono text-ed-text-muted leading-tight">
          Output appears in the browser console.
          State persists across reloads via localStorage.
        </p>
      </div>
    </div>
  )
}
