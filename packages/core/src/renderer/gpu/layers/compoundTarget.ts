/**
 * How big a render target a compound needs (PV-P1).
 *
 * A compound's nested scene is rendered into a texture and then placed on the
 * parent stage like an image. The only judgement is the texture's size: big
 * enough that a screen pixel is not a smear, small enough that nesting four
 * deep does not exhaust the framebuffer pool (the plan's Risks table).
 *
 * The scale is quantised to powers of two for a reason that is easy to miss: an
 * animated scale would otherwise reallocate a target every single frame, which
 * is both slow and enough on its own to exhaust the pool. Preview and export
 * call this with the same numbers, so the two agree on every size.
 *
 * Pure, so the whole policy is testable without a GL context.
 */

/** Long-edge cap for a compound's target, px (same as the effect chain's cap). */
export const MAX_COMPOUND_SIDE = 2048

/**
 * The fraction of its content size a compound renders at: the smallest power of
 * two (1, 1/2, 1/4, 1/8) that still gives at least one target pixel per screen
 * pixel.
 *
 * `drawn` is the size of the WHOLE (uncropped) content on the stage, in stage
 * units; `pxPerStage` is device pixels per stage unit where the compound is
 * drawn. Quantised so an animated scale does not reallocate a target every
 * frame. Preview and export call this with the same numbers.
 */
export function compoundRenderScale(
  content: { width: number; height: number },
  drawn: { width: number; height: number },
  pxPerStage: number,
): number {
  const w = Math.abs(drawn.width)
  const h = Math.abs(drawn.height)
  if (!(content.width > 0) || !(content.height > 0) || !(w > 0) || !(h > 0) || !(pxPerStage > 0)) {
    // A degenerate size would ask for a zero-pixel target; render it 1:1.
    return 1
  }
  // How much of the content's own resolution the compound actually needs: the
  // axis that is scaled down hardest sets it, and extra device pixels scale it
  // up. Below 1 there is resolution to spare, so the target can shrink with it.
  const ratio = Math.max(w / content.width, h / content.height) * pxPerStage
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  if (ratio >= 1) return 1
  // Down to the nearest power of two that is still at or above what is needed,
  // so the target never goes under-resourced and never drifts.
  let s = 1
  while (s > 1 / 8 && s / 2 >= ratio) s /= 2
  return s
}

/** Target size in px for `content` at `scale`, long edge capped at MAX_COMPOUND_SIDE, each side at least 1, rounded. */
export function compoundTargetSize(
  content: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.round((content.width > 0 ? content.width : 0) * scale))
  const h = Math.max(1, Math.round((content.height > 0 ? content.height : 0) * scale))
  const longest = Math.max(w, h)
  if (longest <= MAX_COMPOUND_SIDE) return { width: w, height: h }
  // Cap the long edge and keep the aspect, so a 4K stage does not become a
  // 4K-by-2K target.
  const k = MAX_COMPOUND_SIDE / longest
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}
