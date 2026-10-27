'use client'

import { useEffect, useRef, useState } from 'react'
import { useTimelineEngine } from '@elah/editor'
import { channelExpression, type BaselineContext, type Clip, type KeyframeChannel } from '@elah/core'
import { cn } from '@/lib/utils'
import { inputCls } from './propertiesShared'
import { commitExpression, expressionStatus, MAX_EXPRESSION_LENGTH } from '@/lib/editor/expressionEdit'

export interface ExpressionRowsProps {
  clip: Clip
  ctx: BaselineContext
  localFrame: number
  rows: ReadonlyArray<{ channel: KeyframeChannel; label: string }>
}

/**
 * One expression input per animatable property (PV-P5b-3).
 *
 * The component is deliberately thin: every decision lives in
 * `lib/editor/expressionEdit`, because `apps/web` vitest runs in Node and covers
 * `lib/**` only, so nothing here can be covered by a test.
 *
 * The one piece of state that is NOT in the pure module is the draft text, and
 * that is the point: the field must show what the author is typing, which by
 * definition is not what the clip is running yet. `expressionStatus` tells the
 * two apart and shows a neutral hint for the gap.
 */
export function ExpressionRows({ clip, ctx, localFrame, rows }: ExpressionRowsProps) {
  const engine = useTimelineEngine()
  const project = engine.getProject()
  const [drafts, setDrafts] = useState<Partial<Record<KeyframeChannel, string>>>({})
  // Escape sets this so the blur that follows does not commit the draft the
  // author just cancelled. React fires blur after the key handler, and by then
  // `drafts` has already been cleared, so without the ref the field would
  // silently write an empty expression (i.e. remove it) on cancel.
  const skipCommit = useRef<KeyframeChannel | null>(null)

  // Drafts belong to a clip; carrying them across a selection change would show
  // another clip's half-typed formula.
  useEffect(() => setDrafts({}), [clip.id])

  const commit = (channel: KeyframeChannel, stored: string) => {
    if (skipCommit.current === channel) {
      skipCommit.current = null
      return
    }
    const patch = commitExpression(clip, channel, drafts[channel] ?? stored, ctx)
    if (Object.keys(patch).length > 0) engine.updateClip(clip.id, clip.trackId, patch)
    setDrafts(({ [channel]: _dropped, ...rest }) => rest)
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ channel, label }) => {
        const stored = channelExpression(clip, channel) ?? ''
        const draft = drafts[channel] ?? stored
        const status = expressionStatus(project, clip, channel, draft, localFrame)
        return (
          <div key={channel} className="flex flex-col gap-1" data-expression-row={channel}>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-[11px] text-ed-text-muted">{label}</span>
              <input
                type="text"
                value={draft}
                spellCheck={false}
                maxLength={MAX_EXPRESSION_LENGTH}
                placeholder="value + wiggle(2, 0.02)"
                aria-label={`${label} expression`}
                onChange={(e) => setDrafts((d) => ({ ...d, [channel]: e.target.value }))}
                onBlur={() => commit(channel, stored)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    skipCommit.current = channel
                    setDrafts(({ [channel]: _dropped, ...rest }) => rest)
                    e.currentTarget.blur()
                  }
                }}
                className={cn(inputCls, 'font-mono text-[11px]')}
              />
            </div>
            {status.kind === 'error' && <p className="pl-[5.5rem] text-[11px] text-[var(--elah-danger-text)]">{status.message}</p>}
            {status.kind === 'pending' && (
              <p className="pl-[5.5rem] text-[11px] text-ed-text-muted">Enter to apply · Esc to cancel</p>
            )}
            {status.kind === 'value' && (
              <p className="pl-[5.5rem] text-[11px] tabular-nums text-ed-text-muted">
                {status.text} at the playhead{status.notice ? ` · ${status.notice}` : ''}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
