/**
 * kinetic-title (AV-8a) — a headline that arrives word by word, with
 * `emphasis` words broken out as their own serif-italic accent elements
 * anchored to their line (a span cannot change font family, and is ignored
 * while a reveal runs — see `spec/types.ts`'s `SpecSpan` doc — so the
 * emphasis treatment has to be a real, separate element). See
 * `AV-MOTION-CRAFT.md`'s per-component table for the brief this follows.
 *
 * What a viewer sees: an optional small caps kicker rises in above; then each
 * word of the headline rises into place left-to-right, ~90 ms apart. An
 * emphasis word pops in on a bounce, 150 ms after its place in the line would
 * otherwise have landed, in accent-coloured serif italic. Half a second after
 * that, a hand-drawn underline sketches itself in under the emphasis word.
 * Everything drifts very slightly once it has landed; the whole thing exits
 * together, staggered by the same order it arrived in.
 */

import type { SpecElement } from '../../types'
import type { ComponentDef } from '../types'
import { drawOn, exitOut, floatY, fy, mergeKeys, popIn, riseIn, staggerAt, underlinePath } from '../motion'
import { driftScaleX } from './idleMotion'
import { layoutWords } from './textMetrics'

const KICKER_SIZE = 34
const HEADLINE_SIZE = 116
const LINE_HEIGHT_PX = HEADLINE_SIZE * 1.14
const SAFE_WIDTH_FRAC = 0.84
/** Never let a part's slice of the component end shorter than this — a landed word needs a moment to read before it can exit cleanly. */
const MIN_PART_SEC = 0.35

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

export const kineticTitle: ComponentDef = {
  name: 'kinetic-title',
  label: 'Kinetic Title',
  hint: 'A headline that arrives word by word, with chosen words broken out in accent serif italic and a hand-drawn underline. The default way to open a beat with a message.',
  duration: { min: 2.2, max: 6, default: 3.4 },
  build(component, ctx) {
    const id = component.id
    const duration = component.duration
    const text = (component.text ?? '').trim()
    const words = text.length > 0 ? text.split(/\s+/) : []
    const emphasisSet = new Set((component.emphasis ?? []).map(normWord))
    const hasKicker = Boolean(component.sub && component.sub.trim().length > 0)

    const layout = layoutWords(ctx.format, words, HEADLINE_SIZE, {
      maxWidthFrac: SAFE_WIDTH_FRAC,
      lineHeightPx: LINE_HEIGHT_PX,
      centerYFrac: hasKicker ? 0.47 : 0.44,
    })

    /** Every part runs from its own arrival to the component's own end, so "ends by component.duration" is exact. */
    const partDuration = (at: number) => Math.max(MIN_PART_SEC, +(duration - at).toFixed(4))

    const parts: SpecElement[] = []

    let wordStart = 0
    if (hasKicker) {
      const at = 0
      const d = partDuration(at)
      const baseY = layout.top - fy(ctx.format, KICKER_SIZE * 1.6)
      parts.push({
        id: `${id}-kicker`,
        kind: 'text',
        text: (component.sub ?? '').trim().toUpperCase(),
        at,
        duration: d,
        x: 0.5,
        y: baseY,
        align: 'center',
        size: KICKER_SIZE,
        letterSpacing: 4,
        font: ctx.font('sans'),
        color: ctx.color('muted'),
        // riseIn keys y+opacity and exitOut adds scale, so idle motion has to live on a
        // channel neither uses — scaleX, not floatY's y (see idleMotion.ts's doc comment).
        keys: mergeKeys(riseIn(ctx, baseY, { at: 0 }), exitOut(ctx, d)),
        expressions: [driftScaleX(0.02, 3, 0)],
      })
      wordStart = ctx.t(0.3)
    }

    words.forEach((word, i) => {
      const at = staggerAt(ctx, wordStart, i, 0.09)
      const d = partDuration(at)
      const pos = layout.words[i]!
      const isEmphasis = emphasisSet.has(normWord(word))

      if (isEmphasis) {
        const popDelay = ctx.t(0.15)
        parts.push({
          id: `${id}-word-${i}`,
          kind: 'text',
          text: word,
          at,
          duration: d,
          x: pos.x,
          y: pos.y,
          align: 'center',
          size: HEADLINE_SIZE,
          italic: true,
          opacity: 0, // held at 0 until the pop's own keys take over at popDelay
          font: ctx.font('serif'),
          color: ctx.color('accent'),
          keys: mergeKeys(popIn(ctx, { at: popDelay }), exitOut(ctx, d)),
          expressions: [floatY(ctx, 5, 3.4, i * 0.31)],
        })

        const underlineW = Math.max(60, pos.widthPx * 1.12)
        const drawAt = popDelay + ctx.t(0.5)
        parts.push({
          id: `${id}-underline-${i}`,
          kind: 'shape',
          shape: 'path',
          path: underlinePath(ctx.random),
          viewBox: { x: 0, y: 0, width: 100, height: 12 },
          at,
          duration: d,
          x: pos.x,
          y: pos.y + fy(ctx.format, HEADLINE_SIZE * 0.62),
          w: underlineW,
          h: HEADLINE_SIZE * 0.16,
          stroke: ctx.color('accent'),
          strokeWidth: 7,
          cap: 'round',
          draw: drawOn(ctx, drawAt, 0.7),
          keys: exitOut(ctx, d),
          expressions: [floatY(ctx, 5, 3.4, i * 0.31)],
        })
      } else {
        parts.push({
          id: `${id}-word-${i}`,
          kind: 'text',
          text: word,
          at,
          duration: d,
          x: pos.x,
          y: pos.y,
          align: 'center',
          size: HEADLINE_SIZE,
          weight: 700, // Inter's heaviest static weight — 800 clamps here anyway, so ask for what we get
          font: ctx.font('sans'),
          color: ctx.color('ink'),
          keys: mergeKeys(riseIn(ctx, pos.y, { at: 0 }), exitOut(ctx, d)),
          expressions: [driftScaleX(0.02, 3.2, i * 0.27)],
        })
      }
    })

    return parts
  },
}
