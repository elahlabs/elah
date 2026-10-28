'use client'

import { useEffect, useState } from 'react'
import { useTimelineEngine } from '@elah/editor'
import {
  clearKeyframeChannel,
  motionPathIssue,
  parsePathToCubics,
  serializeCubics,
  setKeyframe,
  type BaselineContext,
  type Clip,
  type CubicSubpath,
} from '@elah/core'
import { Field, inputCls } from './propertiesShared'

/**
 * Motion along a path (MOT-1) for the Animate panel. The clip travels an SVG path (stage px) as the
 * keyed `motion.progress` channel runs 0..1; the resolver turns that into an ordinary position, so
 * the keys here are native keys the curve editor and the timeline already handle. While a path is
 * set it REPLACES the clip's own x/y.
 *
 * Every write goes through the panel's `write` (one `engine.updateClip` = one undo step).
 */

const fmt = (n: number) => String(Math.round(n * 10) / 10)

/** A gentle arc across the middle of the stage, in stage px. */
function arcPath(stage: { width: number; height: number }): string {
  const { width: w, height: h } = stage
  return `M ${fmt(w * 0.1)} ${fmt(h * 0.7)} C ${fmt(w * 0.3)} ${fmt(h * 0.1)} ${fmt(w * 0.7)} ${fmt(h * 0.1)} ${fmt(w * 0.9)} ${fmt(h * 0.7)}`
}

/**
 * A drawing's path in stage px. A v2 freehand clip keeps its path re-based to (0,0) and is placed by
 * its transform (centre x/y and scale), so the placement is applied here; an older one is already stage px.
 */
function drawingPathInStage(clip: Clip, stage: { width: number; height: number }): string | null {
  if (!clip.pathData) return null
  if (clip.transformModel !== 'v2') return clip.pathData
  const subs = parsePathToCubics(clip.pathData)
  if (!subs) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  for (const s of subs) {
    see(s.x, s.y)
    for (let i = 0; i + 1 < s.segs.length; i += 2) see(s.segs[i]!, s.segs[i + 1]!)
  }
  if (!Number.isFinite(minX)) return null
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const t = clip.transform
  const k = t?.scale ?? 1
  const tx = (t?.x ?? 0.5) * stage.width
  const ty = (t?.y ?? 0.5) * stage.height
  const mx = (x: number) => tx + (x - cx) * k
  const my = (y: number) => ty + (y - cy) * k
  const moved: CubicSubpath[] = subs.map((s) => ({
    x: mx(s.x),
    y: my(s.y),
    closed: s.closed,
    segs: s.segs.map((v, i) => (i % 2 === 0 ? mx(v) : my(v))),
  }))
  return serializeCubics(moved)
}

export function MotionPathSection({
  clip,
  ctx,
  write,
}: {
  clip: Clip
  ctx: BaselineContext
  write: (patch: Partial<Clip>) => void
}) {
  const engine = useTimelineEngine()
  const path = clip.motionPath
  const [draft, setDraft] = useState(path?.d ?? '')
  // Follow the stored path when it changes from outside (undo, a preset, another panel).
  useEffect(() => setDraft(path?.d ?? ''), [path?.d])
  const issue = draft.trim() ? motionPathIssue(draft.trim()) : undefined
  const keyCount = clip.keyframes?.channels?.['motion.progress']?.keys.length ?? 0
  const project = engine.getProject()
  const drawings = Object.values(project.clips)
    .flat()
    .filter((c) => c.type === 'freehand' && c.id !== clip.id && !!c.pathData)

  const setPath = (d: string, extra: Partial<NonNullable<Clip['motionPath']>> = {}) => {
    const next = d.trim()
    if (!next || motionPathIssue(next) === 'the path is not valid SVG path data') return
    write({ motionPath: { ...path, ...extra, d: next } })
  }
  const keyProgress = () => {
    const last = Math.max(1, clip.durationFrames - 1)
    const cleared = { ...clip, ...clearKeyframeChannel(clip, 'motion.progress') }
    const first = setKeyframe(cleared, 'motion.progress', 0, ctx, 0)
    const both = setKeyframe({ ...cleared, ...first }, 'motion.progress', last, ctx, 1, { easing: 'sine-in-out' })
    write(both)
  }

  return (
    <Field
      label="Motion path"
      action={
        path ? (
          <button
            type="button"
            onClick={() => write({ motionPath: undefined, ...clearKeyframeChannel(clip, 'motion.progress') })}
            className="text-[11px] text-ed-text-muted hover:text-ed-text transition-colors"
          >
            Remove
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2" data-testid="motion-path">
        {!path && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPath(arcPath(ctx.stage))}
              className="rounded-md border border-ed-border bg-ed-elevated px-2 py-1.5 text-[12px] text-ed-text-muted transition-colors hover:bg-ed-highest hover:text-ed-text"
            >
              Arc across the stage
            </button>
            {drawings.length > 0 && (
              <select
                value=""
                aria-label="Use a drawing's path"
                onChange={(e) => {
                  const src = drawings.find((c) => c.id === e.target.value)
                  const d = src ? drawingPathInStage(src, ctx.stage) : null
                  if (d) setPath(d)
                }}
                className="min-w-0 rounded-md border border-ed-border bg-ed-elevated px-2 py-1.5 text-[12px] text-ed-text-muted"
              >
                <option value="">Use a drawing&apos;s path…</option>
                {drawings.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <textarea
          value={draft}
          rows={3}
          spellCheck={false}
          placeholder="SVG path in stage px, e.g. M 100 900 C 300 200 700 200 900 900"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() === '' && path) write({ motionPath: undefined })
            else if (draft.trim() !== (path?.d ?? '')) setPath(draft)
          }}
          className={`${inputCls} font-mono text-[11px] leading-snug`}
        />
        {issue && <p className="text-[11px] leading-snug text-[var(--elah-danger-text)]">Path: {issue}.</p>}

        {path && (
          <>
            <label className="flex items-center gap-2 text-[12px] text-ed-text">
              <input
                type="checkbox"
                checked={path.orient === true}
                onChange={(e) => write({ motionPath: { ...path, orient: e.target.checked || undefined } })}
              />
              Face direction of travel
            </label>
            {path.orient && (
              <label className="flex items-center gap-2 text-[12px] text-ed-text-muted">
                Turn extra
                <input
                  type="number"
                  step={5}
                  value={path.offsetRotation ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    write({ motionPath: { ...path, offsetRotation: Number.isFinite(n) && n !== 0 ? n : undefined } })
                  }}
                  className={`${inputCls} w-20`}
                />
                degrees
              </label>
            )}
            <button
              type="button"
              onClick={keyProgress}
              className="w-full rounded-md border border-ed-border bg-ed-elevated px-2 py-1.5 text-[12px] text-ed-text-muted transition-colors hover:bg-ed-highest hover:text-ed-text"
            >
              Key progress 0 → 1 over the clip
            </button>
            <p className="text-[11px] leading-snug text-ed-text-muted">
              {keyCount > 0
                ? `Progress has ${keyCount} key${keyCount === 1 ? '' : 's'}; they sit with the other keys above.`
                : 'With no progress keys the clip rests at the start of the path.'}{' '}
              The path replaces this clip&apos;s own position.
            </p>
          </>
        )}
      </div>
    </Field>
  )
}
