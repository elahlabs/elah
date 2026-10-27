'use client'

/** Reusable estimated-progress bar, shared by the chat pending bubble and the gallery pending card. */
export function ProgressBar({
  percent = 0,
  label,
  className,
  indeterminate = false,
}: {
  percent?: number
  /** e.g. "Generating… ~12s left" or "Queued…" — full replacement for the '%' text. */
  label?: string
  className?: string
  /**
   * For work with no estimate to count down — image conversion, which finishes
   * in a second or two on a laptop and rather less predictably on a phone.
   * Ignores `percent` and shows no text unless a `label` is given, so the bar
   * fits inside a thumbnail tile.
   */
  indeterminate?: boolean
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  const fill = 'linear-gradient(90deg, var(--elah-accent), var(--elah-accent-hover))'
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-ed-elevated">
        {indeterminate ? (
          <div
            className="h-full w-1/3 rounded-[3px] animate-indeterminate"
            style={{ background: fill }}
          />
        ) : (
          <div
            // 500ms, matched by COMPLETION_SWEEP_MS's hold: the last transition
            // this bar runs is the sweep from wherever the estimate had reached
            // to 100%, and that one has to be watchable rather than a snap.
            className="h-full rounded-[3px] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%`, background: fill }}
          />
        )}
      </div>
      {(label || !indeterminate) && (
        <div className="mt-1 truncate font-mono text-[11px] text-ed-text-muted">{label ?? `${pct}%`}</div>
      )}
    </div>
  )
}

function formatRemaining(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000)
  if (seconds >= 90) return `${Math.ceil(seconds / 60)}m`
  return `${seconds}s`
}

/**
 * Display percent for one in-flight generation. COMPLETED overrides the
 * estimate outright — the bar must be full before the result it belongs to is
 * allowed on screen (see `sweepGenerationToComplete`), and `elapsed` caps at 99
 * by design so it can never get there on its own.
 */
export function progressPercent(status: string, elapsedPercent: number): number {
  return status === 'COMPLETED' ? 100 : elapsedPercent
}

/** Countdown derived from the time-based estimate; terminal completion snaps elsewhere. */
export function progressLabel(status: string, estimatedMs: number, elapsedMs: number): string {
  if (status === 'COMPLETED') return 'Done'
  const remainingMs = Math.max(0, estimatedMs - elapsedMs)
  if (remainingMs === 0) return status === 'PENDING' || status === 'QUEUED' ? 'Queued…' : 'Generating…'
  const remaining = formatRemaining(remainingMs)
  return status === 'PENDING' || status === 'QUEUED'
    ? `Queued… ~${remaining} left`
    : `Generating… ~${remaining} left`
}

export default ProgressBar
