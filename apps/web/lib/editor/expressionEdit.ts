/**
 * Expression rows in the Animate panel: what to say under an input, and what to
 * write when the author presses Enter (PV-P5b-3).
 *
 * Pure and DOM-free on purpose. `apps/web` vitest runs in Node and covers
 * `lib/**` only, so a component file has no test harness at all — every decision
 * that can be wrong lives here, and `ExpressionRows.tsx` is left as wiring.
 *
 * The status order in `expressionStatus` is the whole design. It answers, in
 * sequence: is there anything typed, does it parse, has it been applied, and what
 * does it evaluate to. A half-typed expression is therefore `pending` and shows a
 * neutral hint, while a PARSE error is red — the two look nothing alike, which is
 * the point: the common case must not look like a failure.
 */

import {
  channelExpression,
  MAX_EXPRESSION_LENGTH,
  parseExpression,
  sampleChannelExpression,
  setChannelExpression,
  type AnyKeyframeChannel,
  type BaselineContext,
  type Clip,
  type Project,
} from '@elah/core'

export type ExpressionStatus =
  | { kind: 'empty' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }
  | { kind: 'value'; text: string; notice?: string }

/**
 * `= 0.400` — three decimals, so the width does not jitter as the playhead
 * moves. `v + 0` normalises `-0` (which `Object.is` distinguishes from `0` and
 * which would otherwise print as `-0.000`).
 */
export function formatExpressionValue(v: number): string {
  // Two different sources of "-0.000", and `v + 0` only handles the first:
  //   - an exact `-0` (IEEE negative zero, which `Object.is` distinguishes), and
  //   - a small NEGATIVE number that rounds to zero at three decimals.
  // The second survives the addition, so the formatted text is normalised too.
  // A playhead readout that flickers between "0.000" and "-0.000" reads as a
  // bug to whoever is watching it.
  const text = (v + 0).toFixed(3)
  return `= ${text === '-0.000' ? '0.000' : text}`
}

/**
 * The line under one expression input.
 *
 * Note that this EVALUATES the expression on every call. The panel calls it once
 * per row per render, and a row is one `createExpressionContext` — fine for the
 * nine channels a clip can have. It must not be called in a loop over frames;
 * that is what `expressionSamples` in `curves.ts` is for, and it is capped.
 */
export function expressionStatus(
  project: Project,
  clip: Clip,
  channel: AnyKeyframeChannel,
  draft: string,
  localFrame: number,
): ExpressionStatus {
  const trimmed = draft.trim()
  if (trimmed === '') return { kind: 'empty' }

  const parsed = parseExpression(trimmed)
  if (!parsed.ok) return { kind: 'error', message: parsed.message }

  // Typed but not yet written. Checked before evaluating so the panel never
  // shows a value for something the clip is not actually running.
  if (trimmed !== (channelExpression(clip, channel) ?? '')) return { kind: 'pending' }

  const sampled = sampleChannelExpression(project, clip, channel, localFrame)
  if (sampled.value === undefined) {
    return { kind: 'error', message: sampled.error?.message ?? 'No value' }
  }
  return {
    kind: 'value',
    text: formatExpressionValue(sampled.value),
    ...(sampled.error ? { notice: sampled.error.message } : {}),
  }
}

/**
 * The write for Enter or blur: the trimmed draft, or `null` when it is blank
 * (which removes the expression). Returns the patch; the caller decides whether
 * it is empty and whether to write it.
 */
export function commitExpression(
  clip: Clip,
  channel: AnyKeyframeChannel,
  draft: string,
  ctx: BaselineContext,
): Partial<Clip> {
  const trimmed = draft.trim()
  return setChannelExpression(clip, channel, trimmed === '' ? null : trimmed, ctx)
}

/** Re-exported so `ExpressionRows.tsx` imports one module, not three. */
export { MAX_EXPRESSION_LENGTH, channelExpression, setChannelExpression }
export type { AnyKeyframeChannel, BaselineContext, Clip, Project }
