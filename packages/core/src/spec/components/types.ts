/**
 * Motion components (AV-8) — the motion designer's library inside the document.
 *
 * ---------------------------------------------------------------------------
 * Why this layer exists
 * ---------------------------------------------------------------------------
 * A `VideoSpec` of raw elements gives a model complete freedom and no taste.
 * Measured on the first reference-style compile: of 31 clips, nearly every
 * animated channel was an ENTRANCE (opacity 18, scale 13); after that each
 * element sat still until it was cut; about three things were on screen at a
 * time; the background never moved; beats cut hard. That is what a slide deck
 * looks like, and it is what any model produces when every piece of craft —
 * stagger, overshoot, secondary motion, exits that hand off, depth, camera
 * drift — has to be reinvented on every generation.
 *
 * A component is a named, parametrised piece of motion design: the model says
 * WHAT (`chip-cloud` with these six phrases, two of them filled), and code says
 * HOW (fly-in paths, spring settle, 70 ms stagger, idle float, a blurred ring
 * behind, a staggered exit). The model keeps raw elements for anything the
 * library does not cover.
 *
 * ---------------------------------------------------------------------------
 * The layering, and why it is spec → spec
 * ---------------------------------------------------------------------------
 *   AuthoredSpec ──expandComponents──▶ VideoSpec ──polishSpec──▶ VideoSpec ──compileVideoSpec──▶ Project
 *
 * Components expand into ordinary `SpecElement`s — one `group` per component —
 * so the compiler never learns about them, `spec/types.ts` stays frozen, and a
 * generated component is, on the timeline, one compound clip whose parts are
 * all editable through "Edit contents". Nothing is hidden in a black box.
 *
 * `polishSpec` (AV-9) then applies craft rules that hold for EVERY element,
 * component-made or hand-written: nothing appears or vanishes without motion,
 * siblings stagger, beats overlap instead of cutting, the frame breathes.
 */

import type { ClipComponentInstance } from '../../types'
import type { SpecElement, SpecIssue, SpecSfx, VideoSpec, SpecFormat } from '../types'
import { SPEC_KINDS } from '../types'
import type { AuthoredFields, SpecSystem } from '../systems/types'

// ---------------------------------------------------------------------------
// Motion style — the whole piece's energy, chosen once
// ---------------------------------------------------------------------------

export const MOTION_ENERGIES = ['calm', 'standard', 'bold'] as const
export type MotionEnergy = (typeof MOTION_ENERGIES)[number]

/** What lives behind everything and never stops moving. */
export const AMBIENT_KINDS = ['none', 'orbs', 'grid', 'dots', 'grain', 'gradient'] as const
export type AmbientKind = (typeof AMBIENT_KINDS)[number]

/** How one beat hands off to the next. */
export const BEAT_TRANSITIONS = ['cut', 'crossfade', 'wipe', 'zoom', 'slide', 'mask'] as const
export type BeatTransition = (typeof BEAT_TRANSITIONS)[number]

export interface MotionStyle {
  /** Scales durations, overshoot and travel: calm is slower and softer, bold snaps. */
  energy: MotionEnergy
  /** A slow push on every beat, so no frame is ever perfectly still. */
  camera: boolean
  ambient: AmbientKind
  transition: BeatTransition
}

export const DEFAULT_MOTION_STYLE: Readonly<MotionStyle> = {
  energy: 'standard',
  camera: true,
  ambient: 'orbs',
  transition: 'wipe',
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * The library. Each name is a piece of motion design a person would recognise
 * from explainer and social work. `COMPONENT_REGISTRY` (./index.ts) must have
 * an entry for every name here — a test enforces it.
 */
export const COMPONENT_NAMES = [
  // type
  'kinetic-title', // headline with staggered word reveal, emphasis words in accent/serif, underline draw
  'word-hits', // single words one after another, each punching in and handing off
  'typewriter-line', // typed line with caret, optional ghosted text behind
  'circled-phrase', // a phrase with a hand-drawn ellipse, underline scribble or marker sweep
  'quote-card', // pull quote with big quote marks and attribution
  // data
  'stat-ring', // ring draws while a counter counts; caption types in
  'stat-bars', // bars grow with values and labels
  'big-number', // a huge number counting up with a label
  // lists and groups
  'icon-row', // N icons in a row, one highlighted, optional bracket corners
  'badge-callouts', // hex/circle badges with icons, elbow lines drawn on, labels
  'chip-cloud', // pills flying in and settling into a loose cloud, filled/outlined mix
  'checklist', // items with check marks drawing on, one by one
  'testimonial-cards', // floating cards: avatar, name, stars, quote
  'comparison', // two columns, before/after or us/them, with a divider
  // devices
  'clock-sweep', // clock face, sweeping hand, arc and orbiting dots
  'logo-outro', // wordmark/logo reveal with a burst and tagline
  // structure
  'section-break', // a full-frame wipe of accent colour carrying one word
] as const
export type ComponentName = (typeof COMPONENT_NAMES)[number]

/** One row of a component's content: a chip, a badge, a stat, a list item. */
export interface ComponentItem {
  text?: string
  /** A second, smaller line. */
  sub?: string
  /** An icon name from `ICON_NAMES`. */
  icon?: string
  /** A number, for stats and bars. */
  value?: number
  /**
   * How this item stands out. `accent` — accent colour; `filled` / `outline` —
   * for chips and badges; `highlight` — the one that matters in a row;
   * `muted` — recedes; `serif` — the emphasis face.
   */
  style?: string
}

/**
 * A component in the document. Deliberately shaped like `SpecElement` —
 * `id`, `at`, `duration`, `layer`, a box — so the flat JSON "bag" the model
 * answers with needs only a few extra keys.
 */
export interface SpecComponent {
  id: string
  kind: 'component'
  component: string
  /** Seconds from the start of the video, or of the group that holds it. */
  at: number
  duration: number
  layer?: number

  /** The region the component lays itself out in. Fractions of the stage; default: the whole safe area. */
  x?: number
  y?: number
  /** Region size in stage px. */
  w?: number
  h?: number

  /** A named layout or look the component offers (`hexagon` / `circle`, `left` / `centre`...). */
  variant?: string
  /** Main text: a headline, a phrase, a quote. */
  text?: string
  /** Secondary text: a kicker, a caption, an attribution. */
  sub?: string
  /** Words inside `text` to set in the emphasis treatment. */
  emphasis?: string[]
  items?: ComponentItem[]
  /** Per-component override of the piece's energy. */
  energy?: string
  /** Anything else a component documents, as `{ name, value }` rows. */
  params?: Array<{ name: string; value: number | string | boolean }>
}

/**
 * An element as AUTHORED: a raw element (whose group children may be components
 * or systems too, and which may carry `matte` / `fxKeys`, applied after
 * compile by `lowerAuthoredFields`), a component, or a system (MI-P3).
 */
export type AuthoredElement =
  | (Omit<SpecElement, 'children'> & AuthoredFields & { children?: AuthoredElement[] })
  | SpecComponent
  | SpecSystem
  | SpecVector

/**
 * A drawn asset placed in a scene (MI-P5). Every raw-element field applies (box `w`/`h`, `x`/`y`, `layer`, `keys`,
 * `expressions`, `effects`, `enter`/`exit`, `matte`, `fxKeys`, ...); `asset` names an SVG the asset call returned.
 * `w`/`h` set the fit box: the SVG's long edge becomes `max(w, h)` px (default 30% of the stage's short side).
 * `expandComponents` lowers it to a placeholder rect and `lowerVectors` (../vectorLowering.ts) replaces that clip, after the
 * compile, with the imported compound of path clips named by the SVG's ids.
 */
export type SpecVector = Omit<SpecElement, 'kind' | 'children'> & AuthoredFields & { kind: 'vector'; asset: string }

/**
 * Every `kind` an authored element may have: the compiler's `SPEC_KINDS` plus the three
 * the expander lowers away (`vector`: MI-P5). The model-facing JSON schema reads this, so the
 * lists cannot drift.
 */
export const AUTHORED_KINDS = [...SPEC_KINDS, 'component', 'system', 'vector'] as const

/** When, on an element's own clock, a sound cue fires (MI-P6). */
export type SfxEvent = 'arrive' | 'exit' | 'key'

/**
 * A sound cue bound to an element's motion instead of a second count (MI-P6). Lowered to `SpecSfx` by
 * `lowerSfx` (../sfxLowering.ts) from the element's keys and presets, so a retimed scene keeps its sound.
 * `at` is ignored when `on` is present.
 */
export interface AuthoredEventSfx {
  cue: string
  /** 0..1. Default 0.6. */
  gain?: number
  on: {
    /** The id of any element in the document, including one a component or system made. */
    element: string
    event: SfxEvent
    /** `key` only: restrict to this channel (default: all the element's keys). */
    channel?: string
    /** `key` only: 0-based, among the keys of that channel, in the element's own key order. Default 0. */
    index?: number
    /** Seconds added after the event, -0.5..0.5. */
    offset?: number
  }
  /** Ignored. */
  at?: number
}

/** A seconds cue (the frozen `SpecSfx`) or an event-bound one. */
export type AuthoredSfx = SpecSfx | AuthoredEventSfx

/** The document the model writes. `expandComponents` lowers it to a `VideoSpec`. */
export interface AuthoredSpec extends Omit<VideoSpec, 'elements' | 'sfx'> {
  elements: AuthoredElement[]
  /** Seconds cues pass through; event cues are lowered by `buildVideo` (MI-P6). */
  sfx?: AuthoredSfx[]
  motion?: Partial<MotionStyle>
}

// ---------------------------------------------------------------------------
// The builder contract
// ---------------------------------------------------------------------------

export interface ComponentContext {
  format: SpecFormat
  /** The piece's resolved style, with any per-component energy applied. */
  style: MotionStyle
  /**
   * A colour reference for a role: `$accent` when the design defines it, else a
   * sensible literal. Builders emit TOKENS where they can, so a later "make the
   * accent blue" still recolours every part a component made.
   */
  color: (role: 'bg' | 'ink' | 'muted' | 'accent' | 'accentSoft' | 'surface') => string
  /** A font reference for a role: `$serif` when defined, else a bundled id. */
  font: (role: 'sans' | 'serif' | 'display' | 'mono' | 'hand') => string
  /** Deterministic randomness for organic layouts (a chip cloud, a wobbly ellipse). */
  random: () => number
  /** Energy-scaled seconds: `t(0.4)` is 0.4 s at standard, longer when calm, shorter when bold. */
  t: (seconds: number) => number
  /** Where this component sits in the spec, for issue paths. */
  path: string
  issues: SpecIssue[]
}

/**
 * One editable field of a component, for the Inspector (EG-P2). `key` is always
 * a key of `SpecComponent`; a test enforces it. Defs rarely declare these:
 * `componentFields(def)` (../instance.ts) derives the schema from `items`,
 * `variants` and `duration`.
 */
export interface ComponentFieldSpec {
  key: keyof SpecComponent
  label: string
  kind: 'text' | 'textarea' | 'select' | 'number' | 'list' | 'strings'
  hint?: string
  /** `number`: the value bounds. `list` / `strings`: the row-count bounds. */
  min?: number
  max?: number
  /** `select`: the allowed values. */
  options?: ReadonlyArray<string>
  /** Shown but not editable (a duration would resize the compound on the parent timeline). */
  readOnly?: boolean
  /** `number`: the value a fresh instance starts with. */
  defaultValue?: number
  /** `list`: the shape of one row (`ComponentItem` keys). */
  itemFields?: ReadonlyArray<{
    key: keyof ComponentItem
    label: string
    kind: 'text' | 'number' | 'select'
    options?: ReadonlyArray<string>
  }>
}

export interface ComponentDef {
  name: ComponentName
  label: string
  /** One line for the prompt: what it is and when to reach for it. */
  hint: string
  /** What `items` means for this component, if it takes any. */
  items?: { min: number; max: number; hint: string }
  variants?: ReadonlyArray<string>
  /** Seconds, when the author gives a duration outside it: clamped with a warn. */
  duration: { min: number; max: number; default: number }
  /** Optional hand-written Inspector schema; absent = derived by `componentFields`. Additive (EG-P2). */
  fields?: ReadonlyArray<ComponentFieldSpec>
  /**
   * The parts, timed relative to the component's own start, positioned in
   * stage fractions. `expandComponents` wraps them in one `group`. Every id must
   * be prefixed with the component's id so two instances never collide.
   */
  build(component: SpecComponent, ctx: ComponentContext): SpecElement[]
}

export interface ExpandResult {
  spec: VideoSpec
  issues: SpecIssue[]
  style: MotionStyle
  /**
   * One provenance record per expanded component, keyed by the CLAIMED group
   * element id (a duplicate id is renamed first). Stamped onto the compound
   * clip by the compiler (EG-P1).
   */
  componentInstances: Record<string, ClipComponentInstance>
}
