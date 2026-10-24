import { Check, ChevronRight, X } from 'lucide-react'

/**
 * The bar shown above the stage while a compound is open: breadcrumb (video > compound > ...), Done and Cancel.
 * Pure presentation; App.tsx owns the session and the engine.
 */
export function CompoundBar({
  title,
  crumbs,
  dirty,
  confirmingCancel,
  onFold,
  onDone,
  onCancel,
}: {
  title: string
  /** Names of the open compounds, outermost first. */
  crumbs: string[]
  dirty: boolean
  confirmingCancel: boolean
  /** Fold to this many open levels (1..crumbs.length). */
  onFold: (depth: number) => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <div className="cbar" role="navigation" aria-label="Compound breadcrumb" data-testid="compound-bar">
      <ol className="crumbs">
        <li>
          <button type="button" className="crumb" onClick={onDone} title="Save and go back to the video" data-testid="crumb-root">
            {title}
          </button>
        </li>
        {crumbs.map((name, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={i}>
              <ChevronRight size={13} aria-hidden className="sep" />
              {last ? (
                <span className="crumb current" aria-current="location" data-testid="crumb-current">{name}</span>
              ) : (
                <button type="button" className="crumb" onClick={() => onFold(i + 1)} title={`Go up to ${name}`} data-testid={`crumb-${i}`}>
                  {name}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <span className="cbar-note">{dirty ? 'Unsaved changes' : 'No changes yet'}</span>
      <span className="spacer" />
      <button type="button" className="btn" onClick={onCancel} data-testid="compound-cancel" title="Discard the changes made inside this compound">
        <X size={14} /> {confirmingCancel ? 'Discard changes?' : 'Cancel'}
      </button>
      <button type="button" className="btn primary" onClick={onDone} data-testid="compound-done" title="Save the changes and return to the video">
        <Check size={14} /> Done
      </button>
    </div>
  )
}
