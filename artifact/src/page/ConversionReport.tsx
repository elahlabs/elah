import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import type { ConversionReport as Report, ChannelEntry, ReportEntry } from './convert'

interface Props {
  report: Report
  text: string
  /** True once the user has edited the converted project (Revert then asks first). */
  dirty: boolean
  onRevert: () => void
}

/**
 * "N elements, M animations -> native; K channels sampled; these could not convert: ...". Same copy button as the
 * Issues panel; lists carry the exact CSS (`where`) of each item.
 */
export function ConversionReport({ report, text, dirty, onRevert }: Props) {
  const [confirming, setConfirming] = useState(false)
  const r = report
  const revert = () => {
    if (dirty && !confirming) {
      setConfirming(true)
      return
    }
    onRevert()
  }
  return (
    <details className="issues conv-report" data-testid="conversion-report">
      <summary>
        Converted to keyframes: {r.elements} elements, {r.animations} animations → native; {r.channels.sampled} channels sampled; {r.unconverted.length} could not convert
      </summary>
      <div className="conv-actions">
        <button type="button" className="btn" onClick={revert} data-testid="revert-page" title="Back to the original programmatic video (export comes from it again)">
          <Undo2 size={14} /> {confirming ? 'Discard edits and revert?' : 'Revert to original'}
        </button>
        {confirming && (
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep editing
          </button>
        )}
        <span className="conv-meta">
          {r.clips} clips · {r.channels.native} channels exact · {r.channels.sampled} sampled · {r.channels.pinned} pinned · {r.ms} ms
        </span>
      </div>
      <Section title="Could not convert" items={r.unconverted} cls="err" />
      <Channels title="Sampled channels (per-frame keys, thinned)" items={r.sampledList} />
      <Section title="Notes" items={r.notes} cls="wrn" />
      <Channels title="Exact channels (native easing)" items={r.nativeList} collapsed />
      <button type="button" className="btn copy" onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}>
        Copy report
      </button>
    </details>
  )
}

function Section({ title, items, cls }: { title: string; items: ReportEntry[]; cls: string }) {
  if (items.length === 0) return null
  return (
    <>
      <h4 className="conv-h">{title} ({items.length})</h4>
      <ul>
        {items.map((u, i) => (
          <li key={i} className={cls}>
            {u.where}: {u.message}
          </li>
        ))}
      </ul>
    </>
  )
}

function Channels({ title, items, collapsed }: { title: string; items: ChannelEntry[]; collapsed?: boolean }) {
  if (items.length === 0) return null
  const list = (
    <ul>
      {items.map((u, i) => (
        <li key={i}>
          {u.where} · {u.channel} · {u.keys} keys · {u.detail}
        </li>
      ))}
    </ul>
  )
  if (collapsed) {
    return (
      <details className="conv-sub">
        <summary>{title} ({items.length})</summary>
        {list}
      </details>
    )
  }
  return (
    <>
      <h4 className="conv-h">{title} ({items.length})</h4>
      {list}
    </>
  )
}
