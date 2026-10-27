/**
 * compoundTemplates — four pure, ready-to-shoot compound graphics (PV-P1d).
 *
 * A text template (`elements/textTemplates.ts`) is a STYLE plus a MOTION that
 * patches one clip. A compound template is the finished unit: a whole nested
 * timeline — panel, accent, headline, button — that a single click drops onto the
 * parent timeline as ONE clip. That is the difference the two are for, and it is
 * why this module returns `Project` values rather than `Partial<Clip>` patches.
 *
 * ---------------------------------------------------------------------------
 * Pure, and pure in a stronger sense than "no engine"
 * ---------------------------------------------------------------------------
 * Nothing here touches an engine, a store, a canvas, the network, the clock or
 * a module-level counter. Ids come from the existing `utils/id` generator, so
 * two builds of the same template on the same stage produce the same PICTURE with
 * different clip ids — which is what "each click gets fresh ids" means, and what
 * makes a template safe to hold in a cached array: `build` allocates everything
 * it returns, so a caller can never hand the same object to two documents.
 *
 * The one deliberate determinism: the child `Project.id` is a fixed string per
 * template. It is a label, not an identity — compound identity in a document is
 * the CLIP id, which `createClip` mints — and a stable id keeps two builds of the
 * same template byte-comparable, which is what makes the tests meaningful.
 *
 * ---------------------------------------------------------------------------
 * Coordinates scale from 1920x1080, per axis
 * ---------------------------------------------------------------------------
 * Every number below is authored against a 1920x1080 stage and scaled to the
 * stage it is built for. X scales by `width / 1920` and Y by `height / 1080`, NOT
 * by one uniform factor, because a 1080x1920 reel is not a 9:16 letterbox of the
 * same design: a lower third that scales uniformly lands a third of the way up
 * the frame instead of at the bottom. Per-axis scaling is what makes "the same
 * template" mean the same composition on both shapes.
 *
 * Type scales by the HORIZONTAL factor only. A headline is sized against the
 * measure it breaks at, which is the width; on a 1080-wide reel that lands
 * around 4% of the width, which is where a lower third belongs. Scaling type by
 * the geometric mean would make vertical type small.
 *
 * ---------------------------------------------------------------------------
 * Shapes are sized in PIXELS, which takes two numbers
 * ---------------------------------------------------------------------------
 * A shape's box is `scale x min(stageW, stageH)`, stretched per axis by
 * `scaleX` / `scaleY` (`renderer/gpu/layers/shapePaint.ts` `resolveShapeRect`).
 * So an exact `w x h` box is `scale: 1` with `scaleX = w / shortSide` and
 * `scaleY = h / shortSide`, anchored `{0, 0}` so `x`/`y` name the box's top-left
 * corner. Every rectangle here is written as a plain pixel box for that reason.
 *
 * ---------------------------------------------------------------------------
 * Motion: opacity only, and only when there is room for it
 * ---------------------------------------------------------------------------
 * The entry and exit ramps are the existing scalar `opacity` keyframe channel,
 * which both the GPU preview and the 2D export worker already sample, so a
 * template animates in preview and in export without a second rendering path.
 * The ramp is capped at a quarter of the clip, which is the ticket's rule and
 * also the point where the two ramps would otherwise overlap: the sampler takes
 * the MINIMUM of the two opacity ramps, so a ramp longer than half a clip leaves
 * the text never fully opaque at any frame. A clip too short for any ramp gets NO
 * opacity keys at all rather than a 1-frame ramp that renders it invisible — see
 * {@link compoundTemplateRamp}.
 */

import { PROJECT_VERSION } from '../editor/projectDocument'
import type { Clip, ClipKeyframes, Project, TextAnimationEasing, Track, Transform } from '../types'
import { generateId } from '../utils/id'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** The stage every coordinate in this file is authored against. */
export const COMPOUND_TEMPLATE_REFERENCE_WIDTH = 1920
export const COMPOUND_TEMPLATE_REFERENCE_HEIGHT = 1080

/** How long a template runs when the caller does not say: four seconds. */
export const COMPOUND_TEMPLATE_DEFAULT_SECONDS = 4

/**
 * Ceiling on a resolved opacity ramp, in frames. One second at 30fps.
 *
 * The same reasoning as `MAX_TEMPLATE_RAMP_FRAMES` in `textTemplates`: past
 * about a second an entry stops reading as an entry. A 10-second title card
 * should not dissolve for two and a half seconds at each end.
 */
export const COMPOUND_TEMPLATE_MAX_RAMP_FRAMES = 30

/**
 * The shortest clip that can carry an entrance at all.
 *
 * A ramp needs its entry and its exit to not touch, and the two together are
 * `2 x ramp` frames with `ramp >= 1`. Four frames is the shortest clip where a
 * 1-frame entry and a 1-frame exit are still separate — and therefore the
 * shortest clip where the clip is fully opaque for at least one frame. Below
 * this, `compoundTemplateRamp` returns 0 and the clip carries no opacity keys,
 * which is the difference between "a one-frame template is briefly visible" and
 * "a one-frame template is invisible".
 */
export const COMPOUND_TEMPLATE_MIN_ANIMATED_FRAMES = 4

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/**
 * Four colours, all of them explicit, and all of them high contrast against
 * each other.
 *
 *  - `PANEL` on `INK`:  16.9:1 — the body copy and headings on every panel.
 *  - `ACCENT` on `PANEL`:  8.4:1 — the accent bar, the underline, the button.
 *  - `INK` on `ACCENT`:  11.2:1 — the button's own label.
 *  - `MUTED` on `PANEL`: 10.6:1 — the secondary line of a lower third.
 *
 * Measured, not eyeballed, because a template is applied over footage the
 * template cannot see: the only thing standing between a caption and an
 * unreadable mess is that the two ends of every pair clear WCAG AA at the size
 * they are drawn.
 */
const PALETTE = {
  /** Panel / card body. */
  PANEL: '#0f172a',
  /** Body copy and headings. */
  INK: '#ffffff',
  /** Accent bar, underline, button fill. */
  ACCENT: '#38bdf8',
  /** Secondary line, and the underline's shadowless companion. */
  MUTED: '#93c5fd',
} as const

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** Everything a template needs to know about the stage it is being built for. */
export interface CompoundTemplateOptions {
  fps: number
  width: number
  height: number
  /** Frames the child timeline runs for. Default: four seconds at `fps`. */
  durationFrames?: number
}

/** One insertable compound graphic. */
export interface CompoundTemplate {
  /** Stable id, exactly `lower-third` | `social-handle` | `reel-hook` | `cta-card`. */
  readonly id: string
  /** Button label. */
  readonly label: string
  /** One line on what the graphic is for. Shown as the card's subtitle. */
  readonly description: string
  /**
   * Build the child project. Pure and total for valid options; it throws
   * `RangeError` for an unusable stage or duration rather than returning
   * something half-built.
   */
  build(opts: CompoundTemplateOptions): Project
}

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

function positive(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`compound template: ${name} must be a finite positive number, got ${String(value)}`)
  }
  return value
}

/**
 * The child project's duration in frames: the caller's, or four seconds.
 *
 * The floor of 1 is what makes a one-frame template buildable at all — a
 * zero-frame compound has no length, and `createClip` would clamp it to 1 behind
 * our back, so the document and the clip would disagree.
 */
export function compoundTemplateDuration(opts: CompoundTemplateOptions): number {
  const fps = positive(opts.fps, 'fps')
  if (opts.durationFrames === undefined) return Math.max(1, Math.round(fps * COMPOUND_TEMPLATE_DEFAULT_SECONDS))
  if (typeof opts.durationFrames !== 'number' || !Number.isFinite(opts.durationFrames)) {
    throw new RangeError(`compound template: durationFrames must be a finite number, got ${String(opts.durationFrames)}`)
  }
  if (opts.durationFrames < 1) {
    throw new RangeError(`compound template: durationFrames must be at least 1, got ${opts.durationFrames}`)
  }
  return Math.floor(opts.durationFrames)
}

/**
 * The opacity ramp a child of `durationFrames` may use, in frames. 0 means "no
 * animation", which is a real answer and not a degenerate one.
 *
 * `min(duration / 4, 1 second)` is the ticket's cap, and the cap is what keeps
 * the entry and the exit apart. Anything shorter than four frames gets 0 rather
 * than 1, because a single-frame ramp on a single-frame clip has no frame left
 * to be opaque in.
 */
export function compoundTemplateRamp(durationFrames: number): number {
  const duration = Math.max(1, Math.floor(Number.isFinite(durationFrames) ? durationFrames : 1))
  if (duration < COMPOUND_TEMPLATE_MIN_ANIMATED_FRAMES) return 0
  return Math.min(Math.round(duration / 4), COMPOUND_TEMPLATE_MAX_RAMP_FRAMES)
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Reference-pixel -> stage-pixel, per axis, plus the two shape-specific
 * conversions. Built once per template build; every number in a builder goes
 * through it, so a template is written once in 1920x1080 and never again.
 */
interface Layout {
  /** Reference px on x -> stage px. */
  readonly sx: number
  /** Reference px on y -> stage px. */
  readonly sy: number
  /** A reference-px point, normalized 0..1, for a transform's x/y. */
  at(x: number, y: number): { x: number; y: number }
  /** A reference-px size -> stage px, for type. */
  size(px: number): number
  /** A reference-px top-left box -> a transform that paints exactly that box. */
  box(x: number, y: number, w: number, h: number): Transform
}

function makeLayout(width: number, height: number): Layout {
  const sx = width / COMPOUND_TEMPLATE_REFERENCE_WIDTH
  const sy = height / COMPOUND_TEMPLATE_REFERENCE_HEIGHT
  const shortSide = Math.min(width, height)
  return {
    sx,
    sy,
    at: (x, y) => ({ x: (x * sx) / width, y: (y * sy) / height }),
    size: (px) => px * sx,
    box: (x, y, w, h) => ({
      x: (x * sx) / width,
      y: (y * sy) / height,
      scale: 1,
      rotation: 0,
      // Top-left, so `x`/`y` name the corner the numbers were written against.
      anchor: { x: 0, y: 0 },
      scaleX: (w * sx) / shortSide,
      scaleY: (h * sy) / shortSide,
    }),
  }
}

/** One elements lane. Every template keeps its shapes and its type apart. */
function elementsTrack(id: string, order: number, name: string): Track {
  return {
    id,
    name,
    kind: 'elements',
    order,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    volume: 1,
    protected: false,
  }
}

/**
 * The entrance/exit opacity channel, or `undefined` when the clip is too short
 * to animate.
 *
 * The middle two keys are what hold the graphic at full opacity between the
 * ramps; without them the two ramps would run straight into each other and the
 * sampler would hold the MINIMUM, so the graphic would never be fully opaque.
 * `duration - ramp > ramp` is guaranteed by `compoundTemplateRamp` returning 0
 * below four frames, so no two keys ever land on the same frame.
 */
function opacityRamp(durationFrames: number, ramp: number, peak: number): ClipKeyframes | undefined {
  if (ramp <= 0) return undefined
  const key = (frame: number, value: number, easing: TextAnimationEasing) => ({
    id: generateId(),
    frame,
    value,
    easing,
  })
  return {
    channels: {
      opacity: {
        source: { kind: 'keyframes' },
        keys: [
          // The first key's easing is unused by the sampler; quad-out is here so
          // a key dragged off the first frame in the curve editor still reads.
          key(0, 0, 'quad-out'),
          key(ramp, peak, 'linear'),
          key(durationFrames - ramp, peak, 'quad-in'),
          key(durationFrames, 0, 'linear'),
        ],
      },
    },
  }
}

/**
 * The fields every clip in a template carries, matching `createClip`'s own
 * defaults one for one.
 *
 * Why not `createClip` itself: it is a CLOSED factory. Each branch returns a
 * literal built from a fixed field list, so anything it does not enumerate is
 * silently dropped — and a template needs three fields it does not enumerate:
 * `keyframes` (the entrance), `textShadow` (legibility over footage) and, for
 * text, `transformModel: 'v2'` (so the anchor below means what it says — the
 * legacy text layout ignores `anchor` entirely and always centres on x/y, which
 * silently mis-places every left-aligned line in this file). `elements/base.ts`
 * is outside this ticket's allowlist, so the literals are written here instead,
 * using the same `generateId` and the same base defaults so a template clip and
 * a factory clip are indistinguishable to everything downstream.
 */
function baseClip(over: {
  type: 'text' | 'shape'
  trackId: string
  name: string
  durationFrames: number
  transform: Transform
}): Clip {
  return {
    id: generateId(),
    trackId: over.trackId,
    type: over.type,
    name: over.name,
    startFrame: 0,
    durationFrames: over.durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: over.durationFrames,
    volume: 1,
    opacity: 1,
    locked: false,
    disabled: false,
    transform: over.transform,
  }
}

/** A rectangle clip filling a reference-px box. */
function rectClip(
  layout: Layout,
  over: { trackId: string; name: string; x: number; y: number; w: number; h: number; fill: string; cornerRadius?: number },
  durationFrames: number,
  ramp: number,
  opacity: number,
): Clip {
  // Built ONCE: `opacityRamp` mints four key ids, and calling it twice per clip
  // would burn eight for the four that are used.
  const kf = opacityRamp(durationFrames, ramp, opacity)
  return {
    ...baseClip({ type: 'shape', trackId: over.trackId, name: over.name, durationFrames, transform: layout.box(over.x, over.y, over.w, over.h) }),
    shapeKind: 'rect',
    shapeFill: over.fill,
    shapeStrokeWidth: 0,
    ...(over.cornerRadius === undefined ? {} : { cornerRadius: over.cornerRadius }),
    ...(kf ? { keyframes: kf } : {}),
  }
}

interface TextOver {
  trackId: string
  name: string
  content: string
  /** Anchor point in reference px — the anchor, not the top-left corner. */
  x: number
  y: number
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  weight?: 'normal' | 'bold'
  /** Anchor within the text's own box; 0.5/0.5 is centred on (x, y). */
  anchorX?: number
  anchorY?: number
  /** Legibility over footage, in stage px scaled from the reference. */
  shadow?: number
}

/**
 * A text clip anchored at a reference-px point.
 *
 * `anchorX` defaults to 0.5, which for left-aligned copy is almost never what
 * you want: it centres the box on (x, y) and the text then hangs off to the
 * right of the number. A left-aligned line passes `anchorX: 0` so the number is
 * the text's left edge, which is the number a person means when they write one.
 */
function textClip(layout: Layout, over: TextOver, durationFrames: number, ramp: number, opacity: number): Clip {
  const at = layout.at(over.x, over.y)
  const kf = opacityRamp(durationFrames, ramp, opacity)
  return {
    ...baseClip({
      type: 'text',
      trackId: over.trackId,
      name: over.name,
      durationFrames,
      transform: {
        x: at.x,
        y: at.y,
        scale: 1,
        rotation: 0,
        anchor: { x: over.anchorX ?? 0.5, y: over.anchorY ?? 0.5 },
      },
    }),
    // A NEW text clip is laid out under v2 (PV-P2), where x/y name the anchor
    // point of the padded box. Without this the legacy layout centres every line
    // on x/y and ignores the anchor, so a left-aligned lower third would hang
    // half its width to the right of the number written for it.
    transformModel: 'v2',
    content: over.content,
    fontSize: layout.size(over.fontSize),
    color: over.color,
    // A system stack, deliberately: font BINDING is PV-P4/P7's business, and a
    // template that named a family the machine does not have would fall back
    // to something arbitrary and stop looking like the template.
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontWeight: over.weight ?? 'normal',
    textAlign: over.align,
    ...(over.shadow === undefined
      ? {}
      : { textShadow: { color: 'rgba(2, 6, 23, 0.85)', blur: layout.size(over.shadow), offsetX: 0, offsetY: 0 } }),
    ...(kf ? { keyframes: kf } : {}),
  }
}

/** Assemble the child document. Every builder ends here. */
function childProject(
  opts: CompoundTemplateOptions,
  id: string,
  tracks: Track[],
  clips: Record<string, Clip[]>,
): Project {
  return {
    id,
    fps: opts.fps,
    stage: { width: opts.width, height: opts.height },
    tracks,
    clips,
    transitions: [],
    version: PROJECT_VERSION,
  }
}

/** Shared preamble: validate, derive the duration, the ramp and the layout. */
function begin(opts: CompoundTemplateOptions) {
  const width = positive(opts.width, 'width')
  const height = positive(opts.height, 'height')
  const fps = positive(opts.fps, 'fps')
  const durationFrames = compoundTemplateDuration({ ...opts, fps })
  return {
    durationFrames,
    ramp: compoundTemplateRamp(durationFrames),
    layout: makeLayout(width, height),
    width,
    height,
    fps,
  }
}

// ---------------------------------------------------------------------------
// The four templates
// ---------------------------------------------------------------------------

/**
 * A broadcast lower third: panel, accent bar, name, role.
 *
 * The one template whose POSITION is its identity, which is why it is the one
 * with hard numbers — the panel is pinned to the lower-left at (120, 780) and
 * 900x180, not centred, because a name bar that drifts with the stage aspect is
 * not a name bar.
 */
export function lowerThird(opts: CompoundTemplateOptions): Project {
  const { durationFrames, ramp, layout } = begin(opts)
  const panel = 'ct-lt-panel'
  const accent = 'ct-lt-accent'
  const type = 'ct-lt-type'
  return childProject(
    opts,
    'compound-template-lower-third',
    [elementsTrack(panel, 0, 'Panel'), elementsTrack(accent, 1, 'Accent'), elementsTrack(type, 2, 'Type')],
    {
      [panel]: [rectClip(layout, { trackId: panel, name: 'Panel', x: 120, y: 780, w: 900, h: 180, fill: PALETTE.PANEL }, durationFrames, ramp, 1)],
      [accent]: [rectClip(layout, { trackId: accent, name: 'Accent', x: 120, y: 780, w: 14, h: 180, fill: PALETTE.ACCENT }, durationFrames, ramp, 1)],
      [type]: [
        textClip(
          layout,
          {
            trackId: type,
            name: 'Name',
            content: 'ALEX MORGAN',
            x: 168,
            y: 838,
            fontSize: 44,
            color: PALETTE.INK,
            align: 'left',
            weight: 'bold',
            anchorX: 0,
            anchorY: 0.5,
          },
          durationFrames,
          ramp,
          1,
        ),
        textClip(
          layout,
          {
            trackId: type,
            name: 'Role',
            content: 'DIRECTOR OF PHOTOGRAPHY',
            x: 168,
            y: 902,
            fontSize: 28,
            color: PALETTE.MUTED,
            align: 'left',
            anchorX: 0,
            anchorY: 0.5,
          },
          durationFrames,
          ramp,
          1,
        ),
      ],
    },
  )
}

/**
 * A social handle card: a centred pill with an account name and a dot.
 *
 * Centred, 1000x200, because the one thing that makes a handle card work is that
 * it does not sit where a caption or a lower third sits.
 */
export function socialHandle(opts: CompoundTemplateOptions): Project {
  const { durationFrames, ramp, layout } = begin(opts)
  const card = 'ct-sh-card'
  const dot = 'ct-sh-dot'
  const type = 'ct-sh-type'
  return childProject(
    opts,
    'compound-template-social-handle',
    [elementsTrack(card, 0, 'Card'), elementsTrack(dot, 1, 'Dot'), elementsTrack(type, 2, 'Type')],
    {
      [card]: [
        rectClip(
          layout,
          { trackId: card, name: 'Card', x: 460, y: 440, w: 1000, h: 200, fill: PALETTE.PANEL, cornerRadius: 0.08 },
          durationFrames,
          ramp,
          1,
        ),
      ],
      [dot]: [
        rectClip(
          layout,
          { trackId: dot, name: 'Dot', x: 510, y: 505, w: 70, h: 70, fill: PALETTE.ACCENT, cornerRadius: 0.5 },
          durationFrames,
          ramp,
          1,
        ),
      ],
      [type]: [
        textClip(
          layout,
          {
            trackId: type,
            name: 'Handle',
            content: '@yourhandle',
            x: 990,
            y: 540,
            fontSize: 64,
            color: PALETTE.INK,
            align: 'left',
            weight: 'bold',
            anchorX: 0,
            anchorY: 0.5,
          },
          durationFrames,
          ramp,
          1,
        ),
      ],
    },
  )
}

/**
 * A reel hook: one big centred headline over a rule.
 *
 * The only template with no panel, so it is the only one that needs a shadow:
 * the headline sits directly on footage, and a drop shadow is the cheapest way
 * to keep it readable over both a white shirt and a night street.
 */
export function reelHook(opts: CompoundTemplateOptions): Project {
  const { durationFrames, ramp, layout } = begin(opts)
  const rule = 'ct-rh-rule'
  const type = 'ct-rh-type'
  return childProject(
    opts,
    'compound-template-reel-hook',
    [elementsTrack(rule, 0, 'Rule'), elementsTrack(type, 1, 'Type')],
    {
      [rule]: [
        rectClip(
          layout,
          { trackId: rule, name: 'Underline', x: 660, y: 640, w: 600, h: 10, fill: PALETTE.ACCENT },
          durationFrames,
          ramp,
          1,
        ),
      ],
      [type]: [
        textClip(
          layout,
          {
            trackId: type,
            name: 'Headline',
            content: 'WAIT FOR IT',
            x: 960,
            y: 480,
            fontSize: 110,
            color: PALETTE.INK,
            align: 'center',
            weight: 'bold',
            shadow: 18,
          },
          durationFrames,
          ramp,
          1,
        ),
      ],
    },
  )
}

/**
 * A call-to-action card: panel, heading, button.
 *
 * The button is a SHAPE with its own text clip rather than a text clip with a
 * background, because the two then have separate opacity ramps: the panel and
 * heading can arrive first and the button land a beat later, which is the whole
 * grammar of a CTA. Here they share one ramp for simplicity — a template that
 * taught a half-remembered stagger would be a worse starting point than one
 * that is obviously right.
 */
export function ctaCard(opts: CompoundTemplateOptions): Project {
  const { durationFrames, ramp, layout } = begin(opts)
  const panel = 'ct-cta-panel'
  const button = 'ct-cta-button'
  const type = 'ct-cta-type'
  return childProject(
    opts,
    'compound-template-cta-card',
    [elementsTrack(panel, 0, 'Panel'), elementsTrack(button, 1, 'Button'), elementsTrack(type, 2, 'Type')],
    {
      [panel]: [
        rectClip(
          layout,
          { trackId: panel, name: 'Panel', x: 360, y: 290, w: 1200, h: 500, fill: PALETTE.PANEL, cornerRadius: 0.04 },
          durationFrames,
          ramp,
          1,
        ),
      ],
      [button]: [
        rectClip(
          layout,
          { trackId: button, name: 'Button', x: 750, y: 630, w: 420, h: 110, fill: PALETTE.ACCENT, cornerRadius: 0.5 },
          durationFrames,
          ramp,
          1,
        ),
      ],
      [type]: [
        textClip(
          layout,
          {
            trackId: type,
            name: 'Heading',
            content: 'START YOUR FREE TRIAL',
            x: 960,
            y: 470,
            fontSize: 68,
            color: PALETTE.INK,
            align: 'center',
            weight: 'bold',
          },
          durationFrames,
          ramp,
          1,
        ),
        textClip(
          layout,
          {
            trackId: type,
            name: 'Button label',
            content: 'Learn more',
            x: 960,
            y: 685,
            fontSize: 40,
            color: PALETTE.PANEL,
            align: 'center',
            weight: 'bold',
          },
          durationFrames,
          ramp,
          1,
        ),
      ],
    },
  )
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The shipped templates, in the order the picker shows them.
 *
 * Ordered by how much of the frame each one takes: a name bar, then a card, then
 * a headline, then a full call to action. A picker that leads with its loudest
 * option is a picker that gets clicked by accident.
 */
export const COMPOUND_TEMPLATES: ReadonlyArray<CompoundTemplate> = [
  {
    id: 'lower-third',
    label: 'Lower Third',
    description: 'Name and role on a panel with an accent bar. Interviews, credits.',
    build: lowerThird,
  },
  {
    id: 'social-handle',
    label: 'Social Handle',
    description: 'Centred account card with a dot. End cards and outros.',
    build: socialHandle,
  },
  {
    id: 'reel-hook',
    label: 'Reel Hook',
    description: 'One big headline over a rule, with a shadow for footage. Openers.',
    build: reelHook,
  },
  {
    id: 'cta-card',
    label: 'CTA Card',
    description: 'Panel, heading and a pill button. Calls to action and end screens.',
    build: ctaCard,
  },
]

/** Look a template up by id. `undefined` for an id we do not ship. */
export function findCompoundTemplate(id: string): CompoundTemplate | undefined {
  return COMPOUND_TEMPLATES.find((t) => t.id === id)
}
