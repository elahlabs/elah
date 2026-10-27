import { label } from './tokens'

/**
 * Slate strip on a hairline: `SC 03 · BINDING` plus an optional kicker.
 * `onStage` swaps the ink/muted colours for use on the dark stage.
 */
export function Slate({
  n,
  label: text,
  kicker,
  onStage = false,
}: {
  n?: number
  label: string
  kicker?: string
  onStage?: boolean
}) {
  const ink = onStage ? 'text-[#F0EFEA]' : 'text-[var(--color-on-surface)]'
  const rule = onStage ? 'border-[#F0EFEA]' : 'border-[var(--color-on-surface)]'
  const muted = onStage ? 'text-[#9A9993]' : 'text-[var(--color-on-surface-variant)]'
  return (
    <div className={`flex items-center justify-between gap-4 border-t py-3 ${rule} ${ink} ${label}`}>
      <span>
        {n != null ? (
          <>
            SC {String(n).padStart(2, '0')} <span className={muted}>·</span>{' '}
          </>
        ) : null}
        {text}
      </span>
      {kicker ? <span className={`hidden sm:inline ${muted}`}>{kicker}</span> : null}
    </div>
  )
}
