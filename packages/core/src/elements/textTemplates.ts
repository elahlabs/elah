/**
 * textTemplates — named, reusable text looks that bundle a STYLE and a MOTION
 * into one thing an author can apply in a single click.
 *
 * Pure data plus one pure function. No React, no stores, no renderer imports:
 * `applyTextTemplate` takes a template and the clip it is being dropped on and
 * returns a `Partial<Clip>` patch. Everything downstream — GPU preview, the
 * 2D export worker, undo/redo, project save — already knows how to handle
 * ordinary clip fields, so a template inherits playback/export parity for free
 * rather than needing a second rendering path. That is the whole design.
 *
 * ---------------------------------------------------------------------------
 * Why this is not just another TextStylePreset
 * ---------------------------------------------------------------------------
 * `TextStylePreset` (stores/textStylePresets.store.ts) is six style fields and
 * nothing else — it deliberately cannot express motion, placement, or a
 * background chip, and it is user-saveable. A template is the production-ready
 * unit: the look AND the entry/exit animation AND the box treatment, shipped by
 * us and tuned so the result is usable without further editing. The two
 * coexist; presets stay the quick "restyle these glyphs" affordance.
 *
 * ---------------------------------------------------------------------------
 * Ramps are FRACTIONS here, frames on the clip
 * ---------------------------------------------------------------------------
 * `TextAnimation.durationFrames` is absolute, which is correct for a stored
 * clip but wrong for a template: a fixed 15-frame ramp applied to a 9-frame
 * clip produces an entry that never completes, so the text never reaches its
 * resting position or full opacity before the clip ends — visible as text that
 * flickers in half-faded and vanishes. Templates therefore describe their ramp
 * as a fraction of clip length, and `resolveTemplateRamp` turns that into a
 * legal frame count for the specific clip it lands on. See that function for
 * the two clamps and why each exists.
 *
 * ---------------------------------------------------------------------------
 * Templates never touch `content`
 * ---------------------------------------------------------------------------
 * Applying a template to a clip the author has already typed into must not
 * discard their words, so `content` is not in the patch. A template restyles;
 * it does not rewrite.
 *
 * ---------------------------------------------------------------------------
 * `stagger` and `tracking` are not this module's business to execute
 * ---------------------------------------------------------------------------
 * Two fields here describe something a single clip cannot express: breaking one
 * line of copy into several clips that enter one after another (`stagger`), and
 * faking letterspacing by respacing the characters (`tracking`). Both are read
 * by the caller that builds a timeline from a template — `lib/motion/overlay.ts`
 * in the web app — and both are IGNORED by `applyTextTemplate`, which patches
 * exactly one clip and stays a pure restyle.
 *
 * That split is deliberate. Executing a stagger means knowing the stage height,
 * the clip's start frame and how many pieces there are; none of that belongs in
 * a function whose contract is "here is a patch for this clip". Describing it
 * still belongs here, because it is part of what makes a look that look — a
 * Brand Drop with its words arriving together is not a Brand Drop.
 */

import type { Clip, MotionSpec, TextOutline, TextShadow, Transform } from '../types'
import { DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on a resolved ramp, in frames (1s at 30fps).
 *
 * Without it a fraction-based ramp scales with clip length, so a title card
 * parked on screen for 40s would fade for 6s at each end. Beyond about a second
 * an entry stops reading as an entry and starts reading as a slow dissolve, so
 * the fraction is really "ramp proportionally, up to a point".
 */
export const MAX_TEMPLATE_RAMP_FRAMES = 30

/**
 * Floor on a resolved ramp, in frames. One frame is the shortest ramp
 * `sampleTextAnimation` can express (`resolveRampFrames` clamps to >= 1), so
 * this matches the sampler rather than inventing a second minimum.
 */
export const MIN_TEMPLATE_RAMP_FRAMES = 1

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * The style half of a template. Every field maps 1:1 onto a `Clip` field of the
 * same name, so applying is a spread rather than a translation step.
 *
 * `backgroundColor` is optional and meaningful by its absence: a template that
 * omits it clears any chip the previous template left behind (see
 * `applyTextTemplate`), which is what makes switching between templates
 * idempotent instead of accumulating leftovers.
 */
export interface TextTemplateStyle {
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontSize: number
  textAlign: 'left' | 'center' | 'right'
  color: string
  backgroundColor?: string
  backgroundOpacity?: number
  padding?: number
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
  /** Glyph outline, drawn under the fill (the clip's own `textOutline`). */
  outline?: TextOutline
  /** Glyph shadow (the clip's own `textShadow`). */
  shadow?: TextShadow
}

/**
 * The motion half.
 *
 * Each end is a `MotionSpec`, so a template drives opacity, offset, scale and
 * rotation SIMULTANEOUSLY with its own easing curve. That is the difference
 * between a template that reads as designed and one that reads as a stock
 * transition: "rise 6% of stage height, scale up from 0.82, fade in, with an
 * overshoot on the geometry" is one entry, not four.
 *
 * The single-kind `TextAnimationKind` enum remains what the properties panel's
 * Entry/Exit selects write; templates use the layered form.
 */
export interface TextTemplateAnimation {
  in?: MotionSpec
  out?: MotionSpec
  /**
   * Ramp length as a fraction of the clip's `durationFrames`, e.g. 0.15 = the
   * entry covers the first 15% of the clip. Resolved by `resolveTemplateRamp`.
   */
  rampFraction: number
}

/**
 * How one line of copy is broken into several clips that enter in turn.
 *
 * The pieces are stacked VERTICALLY, one row each, centred on the template's
 * placement. Vertical rather than inline because laying words out side by side
 * means measuring glyphs, and a template is data — it has no canvas, no font
 * metrics and no stage to measure against. A column of words is also the look
 * the display templates here actually want: big type arriving line by line is
 * the fashion-reel idiom, not a sentence filling in left to right.
 *
 * `stepFrames` is the gap between consecutive pieces ENTERING. The pieces all
 * end together, so a stagger shortens the later pieces rather than pushing them
 * past the end of the clip.
 */
export interface TextTemplateStagger {
  /** What one clip holds: a single word, one line of the value, or all of it. */
  by: 'word' | 'line' | 'block'
  /** Frames between consecutive pieces entering. */
  stepFrames: number
  /**
   * Flip the sign of the entry/exit `offsetX` on every other piece, so a
   * two-line title arrives from opposite sides and meets in the middle.
   * Meaningless — and ignored — on a spec with no horizontal offset.
   */
  mirror?: boolean
}

/** A named, applyable text look. */
export interface TextTemplate {
  id: string
  name: string
  /** One line describing where the look is meant to be used. Shown as a tooltip. */
  description: string
  style: TextTemplateStyle
  animation: TextTemplateAnimation
  /** Omit for one clip holding the whole value — see {@link TextTemplateStagger}. */
  stagger?: TextTemplateStagger
  /**
   * Fake letterspacing, applied by the timeline builder rather than by the
   * renderer.
   *
   * `Clip` has no `letterSpacing` field and neither `computeTextLayout` nor the
   * GPU `TextLayer` measures one, so a template that wants tracking gets it by
   * respacing the characters of the string. That is a real compromise — it
   * breaks word-wrap and copy-paste of the rendered value — which is why it is
   * opt-in per template and, by convention, applied only to short accent lines.
   */
  tracking?: 'wide'
  /**
   * Where the block sits, normalized 0..1 of the stage, addressing the text
   * block's CENTRE (textLayout.ts reads `transform.x/y` that way).
   *
   * Omit to leave the clip exactly where the author dragged it. Templates that
   * only describe a look — a title, a quote — should omit it; templates whose
   * identity IS their position — a lower third, a subtitle — must set it, or
   * they land in the middle of frame and read as broken.
   */
  placement?: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Shipped templates. Ordered as they should appear in a picker: the general
 * looks first, the positional/decorative ones after.
 *
 * Sizes are stage-space pixels against a 1080-wide stage, matching the existing
 * built-in style presets (textStylePresets.store.ts) so the two sets look like
 * they came from the same product.
 */
export const BUILT_IN_TEXT_TEMPLATES: ReadonlyArray<TextTemplate> = [
  {
    id: 'template-title-card',
    name: 'Title Card',
    description: 'Display title that punches up into place and drifts away. Opens a section.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 84,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // Rise + grow + fade together, with the geometry overshooting slightly
      // past rest before settling. The overshoot is what separates this from a
      // plain slide; opacity stays linear underneath it so the text does not
      // appear to flicker as the block springs.
      in: { opacity: 0, offsetY: 0.05, scale: 0.86, ease: 'back-out' },
      // Leaves by continuing upward and shrinking a touch — an exit that
      // reverses the entry reads as a rewind, so it keeps travelling.
      out: { opacity: 0, offsetY: -0.04, scale: 0.96, ease: 'quad-in' },
      rampFraction: 0.18,
    },
  },
  {
    id: 'template-elegant-reveal',
    name: 'Elegant Reveal',
    description: 'Serif line that settles in slowly and widens away. Editorial.',
    style: {
      fontFamily: 'Georgia',
      fontWeight: 'normal',
      fontSize: 52,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // No overshoot here on purpose: expo-out decelerates hard without
      // springing, which is the restrained feel a serif face wants.
      in: { opacity: 0, offsetY: 0.035, scale: 0.94, ease: 'expo-out' },
      out: { opacity: 0, scale: 1.06, ease: 'quad-in' },
      rampFraction: 0.2,
    },
  },
  {
    id: 'template-kinetic-pop',
    name: 'Kinetic Pop',
    description: 'Display type that springs in off-axis and snaps flat. Social cuts.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 68,
      textAlign: 'center',
      color: '#ffde59',
    },
    animation: {
      // Scale, rotation and opacity at once — the combination is the effect.
      // elastic-out oscillates once before settling, so the block visibly
      // wobbles into its resting angle rather than easing onto it.
      in: {
        opacity: 0,
        scale: 0.5,
        rotation: -0.14,
        ease: 'elastic-out',
      },
      out: { opacity: 0, scale: 1.25, ease: 'back-in' },
      rampFraction: 0.15,
    },
  },
  {
    id: 'template-quote',
    name: 'Quote',
    description: 'Roomy serif pull-quote on a soft panel. Breathes in and out.',
    style: {
      fontFamily: 'Georgia',
      fontWeight: 'normal',
      fontSize: 46,
      textAlign: 'center',
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.35,
      padding: 32,
      borderRadius: 12,
    },
    animation: {
      // A very small scale move — 3% — is enough to feel like the panel settles
      // rather than appears. Larger would fight the long fade.
      in: { opacity: 0, scale: 0.97, ease: 'cubic-out' },
      out: { opacity: 0, scale: 1.03, ease: 'quad-in-out' },
      rampFraction: 0.25,
    },
  },
  {
    id: 'template-lower-third',
    name: 'Lower Third',
    description: 'Name bar that slides in from the left and snaps to a stop. Interviews.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontSize: 38,
      textAlign: 'left',
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.6,
      padding: 20,
      borderRadius: 6,
    },
    animation: {
      // Broadcast lower thirds arrive fast and stop hard. back-out gives the
      // small forward-and-settle that reads as a mechanical snap.
      in: { opacity: 0, offsetX: -0.14, ease: 'back-out' },
      out: { opacity: 0, offsetX: -0.1, ease: 'quad-in' },
      rampFraction: 0.12,
    },
    placement: { x: 0.3, y: 0.82 },
  },
  {
    id: 'template-subtitle',
    name: 'Subtitle',
    description: 'Legible caption line pinned near the bottom. Deliberately still.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontSize: 34,
      textAlign: 'center',
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.5,
      padding: 12,
      borderRadius: 4,
    },
    animation: {
      // Pure opacity, no geometry: subtitles are read, not watched, and any
      // movement under running dialogue is a distraction. The restraint is the
      // design decision.
      in: { opacity: 0 },
      out: { opacity: 0 },
      rampFraction: 0.1,
    },
    placement: { x: 0.5, y: 0.86 },
  },
  {
    id: 'template-callout',
    name: 'Callout',
    description: 'Outlined chip that drops in with a bounce and lifts away. Facts, stats.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontSize: 36,
      textAlign: 'center',
      color: '#ffffff',
      backgroundColor: '#111111',
      backgroundOpacity: 0.75,
      padding: 18,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: '#ffde59',
    },
    animation: {
      // Falls from above and bounces on landing — the one place a literal
      // bounce is not kitsch, because the chip reads as a physical object.
      in: { opacity: 0, offsetY: -0.09, scale: 0.9, ease: 'bounce-out' },
      out: { opacity: 0, offsetY: -0.06, scale: 0.92, ease: 'back-in' },
      rampFraction: 0.14,
    },
    placement: { x: 0.5, y: 0.2 },
  },
  {
    id: 'template-ticker',
    name: 'Ticker',
    description: 'Small line that drifts steadily leftward the whole time. Credits.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      fontSize: 28,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // Both ends travel the SAME direction, so the block drifts continuously
      // instead of reversing at the midpoint. Linear at both ends because a
      // ticker that accelerates stops reading as a constant crawl.
      in: { opacity: 0, offsetX: 0.16, ease: 'linear' },
      out: { opacity: 0, offsetX: -0.16, ease: 'linear' },
      rampFraction: 0.3,
    },
    placement: { x: 0.5, y: 0.92 },
  },

  // -------------------------------------------------------------------------
  // The fashion set.
  //
  // Written for a 9:16 reel of ten seconds or less, where the type is part of
  // the edit rather than a caption laid over it. Two things separate them from
  // the general looks above: they are sized against a 1080x1920 stage (the
  // workflow's own shape) rather than a 1080-wide one, and most of them stagger
  // — a headline that arrives all at once reads as a subtitle no matter how it
  // is styled.
  // -------------------------------------------------------------------------
  {
    id: 'template-editorial-stamp',
    name: 'Editorial Stamp',
    description: 'Fine tracked caps at the top of frame, settling line by line. Magazine masthead.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      fontSize: 34,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // Almost no travel and no overshoot: this look is about restraint, and
      // 2% of stage height is the smallest move that still reads as a settle
      // rather than a cut-in.
      in: { opacity: 0, offsetY: 0.02, ease: 'expo-out' },
      out: { opacity: 0, offsetY: -0.02, ease: 'quad-in' },
      rampFraction: 0.16,
    },
    stagger: { by: 'line', stepFrames: 6 },
    tracking: 'wide',
    placement: { x: 0.5, y: 0.13 },
  },
  {
    id: 'template-brand-drop',
    name: 'Brand Drop',
    description: 'Heavy display words stacking in one at a time with a snap. Hooks and drops.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 96,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // The snap IS the template. back-out lands each word slightly past its
      // row and pulls it back, which is what makes a stack of them read as
      // percussive instead of as a list appearing.
      in: { opacity: 0, offsetY: 0.05, scale: 0.78, ease: 'back-out' },
      out: { opacity: 0, scale: 1.18, ease: 'back-in' },
      rampFraction: 0.1,
    },
    // Four frames at 30fps — an eighth of a second between words. Slower and
    // the stack stops feeling like one gesture.
    stagger: { by: 'word', stepFrames: 4 },
    placement: { x: 0.5, y: 0.5 },
  },
  {
    id: 'template-runway-ticker',
    name: 'Runway Ticker',
    description: 'Small caps crawling steadily along the bottom. Credits, seasons, drop dates.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontSize: 26,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // Both ends travel the same way, so the line drifts for its whole life
      // instead of reversing at the midpoint — the same trick as `Ticker`, at
      // a smaller amplitude because this one sits under a moving figure.
      in: { opacity: 0, offsetX: 0.12, ease: 'linear' },
      out: { opacity: 0, offsetX: -0.12, ease: 'linear' },
      rampFraction: 0.3,
    },
    tracking: 'wide',
    placement: { x: 0.5, y: 0.93 },
  },
  {
    id: 'template-price-chip',
    name: 'Price Chip',
    description: 'Outlined pill that drops in high in frame. Prices, sizes, one-word facts.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontSize: 32,
      textAlign: 'center',
      color: '#ffffff',
      backgroundColor: '#0a0a0a',
      backgroundOpacity: 0.72,
      padding: 16,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: '#ffffff',
    },
    animation: {
      // A physical object falling in — the one place a literal bounce earns
      // its keep, for the same reason `Callout` uses one.
      in: { opacity: 0, offsetY: -0.07, scale: 0.9, ease: 'bounce-out' },
      out: { opacity: 0, offsetY: -0.05, scale: 0.92, ease: 'back-in' },
      rampFraction: 0.14,
    },
    placement: { x: 0.5, y: 0.2 },
  },
  {
    id: 'template-split-title',
    name: 'Split Title',
    description: 'Two lines closing in from opposite sides to meet mid-frame. Statement titles.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 72,
      textAlign: 'center',
      color: '#ffffff',
    },
    animation: {
      // A quarter of the stage width is a long way to travel, which is why the
      // curve decelerates hard rather than overshooting: two lines springing
      // past each other read as a collision, not a meeting.
      in: { opacity: 0, offsetX: -0.25, ease: 'expo-out' },
      out: { opacity: 0, offsetX: 0.1, ease: 'quad-in' },
      rampFraction: 0.18,
    },
    // `mirror` is what makes it a split: line two inherits +0.25 instead.
    stagger: { by: 'line', stepFrames: 3, mirror: true },
    placement: { x: 0.5, y: 0.5 },
  },
  {
    id: 'template-period-title',
    name: 'Period Title',
    description: 'Warm serif easing down out of nothing over a long dissolve. Film-title feel.',
    style: {
      fontFamily: 'Georgia',
      fontWeight: 'normal',
      fontSize: 58,
      // Bone rather than white: a period grade is warm, and pure white type on
      // top of it reads as a modern caption pasted onto old footage.
      color: '#f2e8d5',
      textAlign: 'center',
    },
    animation: {
      // Scale DOWN into rest, not up. Starting oversized and settling is how a
      // main title behaves; growing into frame is how a social sticker does.
      in: { opacity: 0, scale: 1.12, ease: 'expo-out' },
      out: { opacity: 0, scale: 0.97, ease: 'quad-in-out' },
      rampFraction: 0.28,
    },
    stagger: { by: 'line', stepFrames: 8 },
    tracking: 'wide',
    placement: { x: 0.5, y: 0.5 },
  },

  // -------------------------------------------------------------------------
  // The caption set (AGN-P20).
  //
  // Four styles a caption can wear. They are STYLE plus entry/exit motion like
  // every template above; how the words arrive (a reveal animator) and which
  // are lit as they are spoken (a caption mode) are chosen separately and
  // joined in `CAPTION_LOOKS` (elements/captions.ts). Sized for a 1080-wide
  // stage and pinned low in frame, where captions live.
  // -------------------------------------------------------------------------
  {
    id: 'caption-outline',
    name: 'Outline Caps',
    description: 'Heavy white caps with a thick black outline, low in frame. Readable on anything.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 72,
      textAlign: 'center',
      color: '#ffffff',
      outline: { color: '#000000', width: 7 },
      shadow: { color: '#000000', blur: 6, offsetX: 0, offsetY: 4 },
    },
    animation: {
      in: { opacity: 0, scale: 0.9, ease: 'back-out' },
      out: { opacity: 0 },
      rampFraction: 0.12,
    },
    placement: { x: 0.5, y: 0.78 },
  },
  {
    id: 'caption-social',
    name: 'Social Heavy',
    description: 'Oversized yellow caps, fat stroke and a hard drop shadow. Short-form social.',
    style: {
      fontFamily: 'Impact',
      fontWeight: 'bold',
      fontSize: 88,
      textAlign: 'center',
      color: '#ffde59',
      outline: { color: '#000000', width: 10 },
      shadow: { color: '#000000', blur: 0, offsetX: 0, offsetY: 7 },
    },
    animation: {
      in: { opacity: 0, scale: 0.7, rotation: -0.04, ease: 'elastic-out' },
      out: { opacity: 0, scale: 1.1, ease: 'back-in' },
      rampFraction: 0.14,
    },
    placement: { x: 0.5, y: 0.72 },
  },
  {
    id: 'caption-editorial',
    name: 'Editorial Line',
    description: 'Serif caption with a soft shadow, no box and no stroke. Interviews, documentary.',
    style: {
      fontFamily: 'Georgia',
      fontWeight: 'normal',
      fontSize: 46,
      textAlign: 'center',
      color: '#ffffff',
      shadow: { color: '#000000', blur: 14, offsetX: 0, offsetY: 2 },
    },
    animation: {
      in: { opacity: 0, offsetY: 0.02, ease: 'expo-out' },
      out: { opacity: 0, ease: 'quad-in' },
      rampFraction: 0.18,
    },
    placement: { x: 0.5, y: 0.84 },
  },
  {
    id: 'caption-quiet',
    name: 'Quiet Line',
    description: 'Small clean sans, fades in and out and never moves. Under dialogue.',
    style: {
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      fontSize: 32,
      textAlign: 'center',
      color: '#f1f1f1',
      shadow: { color: '#000000', blur: 8, offsetX: 0, offsetY: 1 },
    },
    animation: {
      in: { opacity: 0 },
      out: { opacity: 0 },
      rampFraction: 0.1,
    },
    placement: { x: 0.5, y: 0.9 },
  },
]

/** Look a template up by id. `undefined` for an id we do not ship. */
export function findTextTemplate(id: string): TextTemplate | undefined {
  return BUILT_IN_TEXT_TEMPLATES.find((t) => t.id === id)
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Turn a template's fractional ramp into a frame count that is legal for this
 * specific clip.
 *
 * Three things are enforced, in order:
 *
 *  1. **Half the clip, at most.** The entry ramp covers `[0, ramp]` and the exit
 *     ramp the last `ramp` frames, so at `ramp > duration/2` they overlap and
 *     `sampleTextAnimation` takes the MINIMUM of the two opacity ramps — the
 *     text never reaches full opacity at any frame. At exactly `duration/2`
 *     there is one frame where both ramps read 1, which is the shortest clip
 *     that can still show the text solid. That is the boundary, so that is the
 *     cap.
 *  2. **`MAX_TEMPLATE_RAMP_FRAMES`, at most.** Keeps a long-lived clip from
 *     inheriting a multi-second dissolve purely because it is long.
 *  3. **`MIN_TEMPLATE_RAMP_FRAMES`, at least.** Also catches the degenerate
 *     inputs — a 0, negative, fractional, `NaN` or `Infinity` `durationFrames`
 *     reaching us from a stored document, since nothing validates that field on
 *     load (projectDocument.ts spreads stored clip fields through untouched).
 *
 * Returns a whole number of frames >= 1 for every input, which is the contract
 * `resolveRampFrames` downstream also guarantees.
 */
export function resolveTemplateRamp(rampFraction: number, clipDurationFrames: number): number {
  const duration = Math.max(0, Math.floor(finiteOr(clipDurationFrames, 0)))
  const fraction = Math.max(0, finiteOr(rampFraction, 0))

  const wanted = Math.round(duration * fraction)
  const halfClip = Math.floor(duration / 2)

  const capped = Math.min(wanted, halfClip, MAX_TEMPLATE_RAMP_FRAMES)
  return Math.max(MIN_TEMPLATE_RAMP_FRAMES, capped)
}

/**
 * Build the `Partial<Clip>` patch that applies `template` to `clip`.
 *
 * Pure — it reads `clip` but never mutates it, and returns only fields the
 * template actually governs. Callers hand the result straight to
 * `engine.updateClip`, which is what puts the change on the undo stack and in
 * the saved document like any other edit.
 *
 * Two behaviours worth knowing:
 *
 * **Switching templates is clean, not cumulative.** Every optional box field is
 * present in the patch, set to `undefined` when the template does not use it.
 * Without that, applying Quote (a panel) and then Title Card (no panel) would
 * leave the panel behind, and the second template would not look like itself.
 * The author's own edits to those fields are lost by the same rule — which is
 * the expected meaning of "apply this template".
 *
 * **Placement merges rather than replaces.** A template that sets `placement`
 * overrides only x/y, keeping the clip's scale, rotation and anchor. Synthesizing
 * the rest from `DEFAULT_TEXT_TRANSFORM` is safe here because that constant is
 * exactly what the text renderer already applies to a clip with no transform, so
 * a clip that never had one does not jump. (That is only true for TEXT clips —
 * shapes default to `scale: 0.5`. See resolver/textAnimation.ts.)
 */
export function applyTextTemplate(template: TextTemplate, clip: Clip): Partial<Clip> {
  const { style, animation, placement } = template

  const patch: Partial<Clip> = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    textAlign: style.textAlign,
    color: style.color,
    // A template names a SYSTEM family, so applying one over a bundled font must
    // drop the id — otherwise the bundled face keeps winning over the family the
    // template just asked for, and the switch looks like it did nothing. Italic
    // goes with it: a template's `fontWeight` is a keyword, and leaving a stored
    // `fontStyle` behind would make the template's own styling partial (PV-P4b).
    fontId: undefined,
    fontStyle: undefined,
    // PV-P4c-1: a gradient REPLACES the fill colour, so a template that sets
    // `color` must drop it or the two fight and the gradient silently wins.
    textFill: undefined,

    // Explicitly `undefined` when unused — see "switching templates is clean".
    backgroundColor: style.backgroundColor,
    backgroundOpacity: style.backgroundOpacity,
    padding: style.padding,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    // Same rule as the box fields: absent on the template means cleared on the
    // clip, so a stroke from one look never survives into the next.
    textOutline: style.outline,
    textShadow: style.shadow,

    textAnimation: {
      inMotion: animation.in,
      outMotion: animation.out,
      durationFrames: resolveTemplateRamp(animation.rampFraction, clip.durationFrames),
    },
  }

  if (placement) {
    const rest: Transform = clip.transform ?? DEFAULT_TEXT_TRANSFORM
    patch.transform = {
      ...rest,
      anchor: { ...rest.anchor },
      x: placement.x,
      y: placement.y,
    }
  }

  return patch
}
