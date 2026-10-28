/**
 * The editing assistant's op vocabulary (EDX-P11).
 *
 * One declarative language for "change the edit": an agent (or a script, or
 * later an MCP client) produces a list of ops; `sanitizeOps` checks it
 * against the project and the registries; `applyOps` runs it as ONE engine
 * batch — one undo step — and reports what it did, what it skipped and why.
 *
 * Conventions an op author relies on:
 *   - Times are SECONDS on the timeline (`at`, `duration`), or seconds from a
 *     clip's own start for keyframes. Models reason in seconds; apply converts.
 *   - A clip is addressed by its id from `describeProject`, or by `$name` for
 *     a clip an earlier op in the same plan created with `ref: "name"`.
 *   - Everything optional is optional: omitted = a sensible default.
 *   - Kinds, presets and looks are registry names, so the vocabulary grows
 *     with the registries (effects, generators, transitions, motion presets,
 *     speed presets, text templates).
 */

import type { BlendMode, Clip, TextAnimationEasing, TransitionDirection } from '../types'
import type { StaggerFrom } from '../elements/stagger'
import type { PropDef } from '../composition/types'
import type { ComponentItem } from '../spec/components/types'

export type Seconds = number
/**
 * A clip id, or `$ref` for a clip created earlier in the same plan. The ops
 * `setClipProps`, `setKeyframes`, `applyMotionPreset`, `setExpression` and
 * `setStyle` also take a PATH `'compoundId/childId'` (EG-P4), which edits one
 * part inside a compound; every other op refuses a path.
 */
export type ClipRef = string

/** Where a graphic sits on the stage. */
export type Region =
  | 'center'
  | 'top'
  | 'bottom'
  | 'lower-third'
  | 'upper-third'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export const REGIONS: ReadonlyArray<Region> = [
  'center',
  'top',
  'bottom',
  'lower-third',
  'upper-third',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

export type ShapeOpKind = 'rect' | 'circle' | 'line' | 'arrow' | 'triangle' | 'star'
export const SHAPE_OP_KINDS: ReadonlyArray<ShapeOpKind> = ['rect', 'circle', 'line', 'arrow', 'triangle', 'star']

export type OpParams = Record<string, number | string | boolean>

export interface KeyOp {
  /** Seconds from the clip's own start. */
  at: Seconds
  /** A number channel's value. `0` and unused when `vec` or `path` is set. */
  value: number
  /** AGN-P21: a colour key, `[r, g, b]` or `[r, g, b, a]`, each 0..1. Colour channels only. */
  vec?: number[]
  /** AGN-P21: SVG path data. The `shape.path` channel of a `path` shape only. */
  path?: string
  /**
   * A bezier preset id (`ease`, `snappy`, `overshoot`…), a named easing, or a
   * spring preset as `spring:<id>` (`gentle`, `snappy`, `bouncy`, `stiff`,
   * `wobbly`), or a staircase as `steps:<n>` (integer 1..64).
   */
  curve?: string
  hold?: boolean
}

export type EditorOp =
  // --- Motion graphics -------------------------------------------------------
  | {
      op: 'addText'
      ref?: string
      text: string
      at: Seconds
      duration: Seconds
      /** Text template id (`template-title-card`…). */
      template?: string
      color?: string
      /** Stage px. */
      size?: number
      region?: Region
      /** Motion preset applied after (fade-in, pop-in, slide-in-up…). */
      motion?: string
      /** Text reveal preset (typewriter, word-rise, word-pop, char-fade, line-rise). */
      reveal?: string
      outline?: boolean
      shadow?: boolean
    }
  | {
      op: 'addShape'
      ref?: string
      kind: ShapeOpKind
      at: Seconds
      duration: Seconds
      color?: string
      /** Outline only (no fill). */
      outline?: boolean
      region?: Region
      /** Fraction of the stage's short side. */
      size?: number
      drawOn?: boolean
      motion?: string
    }
  /**
   * `under` (background replacement): put the clip on a NEW video lane directly BEHIND the named clip's lane, so it
   * draws under that clip while every lane keeps its relative order. With `under`, `at` and `duration` default to
   * that clip's span; without it both are required. Not `setClipProps.under`, which anchors a text layout below a clip.
   */
  | { op: 'addGenerator'; ref?: string; kind: string; preset?: string; params?: OpParams; at?: Seconds; duration?: Seconds; region?: Region; under?: ClipRef }
  | { op: 'addLowerThird'; ref?: string; title: string; subtitle?: string; at: Seconds; duration: Seconds; accent?: string }
  | { op: 'addTitleCard'; ref?: string; title: string; subtitle?: string; at: Seconds; duration: Seconds }
  | { op: 'addCallout'; ref?: string; text: string; at: Seconds; duration: Seconds; region?: Region; accent?: string }
  | { op: 'setCaptionStyle'; mode: 'static' | 'karaoke' | 'highlight' | 'reveal'; highlight?: string }
  /**
   * Put real, word-timed captions on the timeline from a clip's transcript (AGN-P19). The planner names the
   * footage and a style; it never supplies words or timings. Resolved CLIENT-SIDE, before the final plan is
   * built: the web layer reads the transcript cached on the clip's asset, windows it to the clip and fills
   * `words`. An `addCaptions` with no `words` was never resolved and `applyOps` skips it. A missing
   * transcript drops the op; it never starts a (paid) transcription.
   */
  | {
      op: 'addCaptions'
      /** The footage clip the words come from. */
      clip: ClipRef
      /** A CAPTION_LOOKS id: sets the type, the reveal animator, the mode and the highlight together. Named `captionLook` because `look` is taken by applyLook. */
      captionLook?: string
      /** The caption mode on its own. Overrides the mode a `look` would set. */
      style?: 'static' | 'karaoke' | 'highlight' | 'reveal'
      /** Default bottom. */
      position?: 'bottom' | 'center' | 'top'
      /** Seconds from the clip's start on the timeline; limits the captions to a part of the clip. */
      from?: Seconds
      to?: Seconds
      /** Filled by the client resolver ONLY (stripped from planner output): words in seconds from the clip's start. */
      words?: Array<{ text: string; startSeconds: number; endSeconds: number }>
    }
  // --- Edit ------------------------------------------------------------------
  | { op: 'removeClip'; clip: ClipRef }
  | { op: 'moveClip'; clip: ClipRef; at: Seconds }
  | { op: 'trimClip'; clip: ClipRef; start?: Seconds; end?: Seconds }
  | { op: 'splitClip'; clip: ClipRef; at: Seconds }
  | { op: 'setSpeed'; clip: ClipRef; speed: number }
  | { op: 'applySpeedPreset'; clip: ClipRef; preset: string; at?: Seconds }
  /** PQ-1a: fit footage to the stage. `focusX`/`focusY` (0..1, source space, top-left origin) steer `cover` and are stored on the clip. */
  | { op: 'setFit'; clip: ClipRef; fit: 'contain' | 'cover' | 'blur-fill'; focusX?: number; focusY?: number }
  | {
      op: 'setClipProps'
      clip: ClipRef
      opacity?: number
      volume?: number
      x?: number
      y?: number
      scale?: number
      /** Degrees. */
      rotation?: number
      text?: string
      color?: string
      /** Transform anchor 0..1 (default 0.5): where scale and rotation pivot. `anchorX: 0` + a `scaleX` channel is a left-origin wipe. */
      anchorX?: number
      anchorY?: number
      /** Sit just below this clip (`layout.anchorTo`, bottom edge, centred). Text, shape and freehand clips only. */
      under?: ClipRef
    }
  | {
      op: 'applyMotionPreset'
      clip: ClipRef
      preset: string
      amount?: number
      /** Lands an enter/exit preset on the clip's first (or last) beat (PV-P10b). */
      syncTo?: 'beats'
      /** The audio clip whose beats to follow; omitted = every analysed audio clip. */
      audio?: ClipRef
    }
  /**
   * MG-P5: the same motion preset on several clips, each clip's keys `offsetFrames` later than the previous
   * clip's (a word-by-word or card-by-card build). Whole clips only: no part paths, no beat presets. One op, one
   * undo step; a clip that cannot be resolved skips the whole op.
   */
  | { op: 'staggerPreset'; clips: ClipRef[]; preset: string; amount?: number; offsetFrames: number; /** MOT-2: where the build starts (default start). A number is a clip index in `clips`. */ from?: StaggerFrom; /** MOT-2: spreads the offsets (a stored ease name). */ ease?: TextAnimationEasing; /** MOT-2: lay the clips out row-major in this many columns. */ grid?: number }
  | { op: 'setKeyframes'; clip: ClipRef; channel: string; keys: KeyOp[] }
  | { op: 'setExpression'; clip: ClipRef; channel: string; /** null removes it. */ source: string | null }
  /**
   * Style fields `setClipProps` cannot reach (EG-P4). Every field is optional;
   * at least one is set. Text: fill = glyph colour, stroke/strokeWidth = glyph
   * outline. Shapes: fill, stroke, strokeWidth, and cornerRadius on rectangles.
   * A field that does not apply to the clip's type skips the whole op.
   */
  | {
      op: 'setStyle'
      clip: ClipRef
      /** `#rrggbb`. Replaces a gradient fill. */
      fill?: string
      /** `#rrggbb`. */
      stroke?: string
      /** Stage px, 0..200. 0 on text removes the outline. */
      strokeWidth?: number
      /** A `FONT_REGISTRY` id. */
      fontId?: string
      /** 100..900, snapped to a weight the font ships. */
      fontWeight?: number
      /** Stage px, 8..600. */
      fontSize?: number
      /** Fraction of the shorter side, 0..0.5. */
      cornerRadius?: number
      textAlign?: 'left' | 'center' | 'right'
      /** Extra px between characters, -20..100. */
      letterSpacing?: number
    }
  | { op: 'addTransition'; from: ClipRef; to?: ClipRef; kind: string; duration?: Seconds; direction?: TransitionDirection }
  /**
   * AGT-4b: remove one transition, named by its id (`describeTransitions`) or by the two clips it joins. With only
   * `from`, the transition that leaves that clip. Resolved against the live project when it runs.
   */
  | { op: 'removeTransition'; transition?: string; from?: ClipRef; to?: ClipRef }
  // --- Beats (PV-P10b-3) -------------------------------------------------
  | { op: 'beatCuts'; clip: ClipRef; every?: number; audio?: ClipRef }
  | { op: 'silenceFreeze'; clip: ClipRef; minDuration?: Seconds; audio?: ClipRef }
  // --- Cuts and mix (CHAT-5a) -------------------------------------------------
  /**
   * Cut SOURCE-second ranges out of a video or audio clip (a merged A/V clip keeps its sound in step; a linked
   * partner is cut at the same timeline moments) and, with `ripple` (default true), close the gaps: later clips
   * on the clip's lane and its partners' lanes move left. Captions linked to the clip lose the words inside the
   * cuts and follow the picture. Ranges are sorted, merged when closer than 0.12 s, clamped to the clip's source
   * window and dropped under 0.05 s. Refused: a range wholly outside the clip's source, a locked lane, or
   * `ripple: false` on a magnetic main lane. One engine batch, so one undo step. The clip id survives as the
   * first kept piece unless a cut starts at the clip's first frame.
   */
  | { op: 'removeRanges'; clip: ClipRef; ranges: Array<{ from: Seconds; to: Seconds }>; ripple?: boolean }
  /**
   * Short volume fades at every join between back-to-back audio-bearing clips: the left clip fades out over `ms`
   * and the right fades in. Give `clips` (joins among them) or a `track` (id or name); neither = every lane.
   * Existing volume keys stay; the fade is added on top. `ms` is clamped to 2..200 (default 10).
   */
  | { op: 'crossfadeCuts'; clips?: ClipRef[]; track?: string; ms?: number }
  /**
   * Lower `music` under speech with volume keys. The speech is `segments` (timeline seconds, supplied by the
   * caller from the voice clip's transcript) or, without them, the whole span of the `voice` clip. The music sits
   * at `amountDb` (-40..0, default -12) during speech, with an attack ramp before it and a release ramp after.
   */
  | { op: 'duckUnder'; music: ClipRef; voice: ClipRef; amountDb?: number; attackSec?: Seconds; releaseSec?: Seconds; segments?: Array<{ from: Seconds; to: Seconds }> }
  /**
   * Place a LIBRARY audio asset as a short sound effect at `at` on the first audio lane named "SFX" (created
   * when missing). `volume` 0..1 (default 0.6); `duration` defaults to, and is capped at, the asset's length.
   * A non-audio asset is refused.
   */
  | { op: 'addSfx'; ref?: string; asset: string; at: Seconds; volume?: number; duration?: Seconds }
  // --- Look ------------------------------------------------------------------
  | { op: 'addEffect'; clip: ClipRef; kind: string; preset?: string; params?: OpParams }
  | { op: 'applyLook'; clip: ClipRef; look: string }
  | { op: 'setEffectParam'; clip: ClipRef; effect: string; param: string; value: number | string | boolean }
  | { op: 'removeEffects'; clip: ClipRef }
  /** AGT-4b: remove ONE effect (and the keys that drove it). `effect` is an effect id from `describeClipDetail`, or a kind when the clip has exactly one of it. */
  | { op: 'removeEffect'; clip: ClipRef; effect: string }
  | { op: 'setBlend'; clip: ClipRef; blend: BlendMode }
  | { op: 'setMask'; clip: ClipRef; shape: 'rect' | 'ellipse' | 'none'; feather?: number; invert?: boolean }
  | { op: 'addAdjustment'; ref?: string; at: Seconds; duration: Seconds; look?: string; effects?: Array<{ kind: string; preset?: string }> }
  // --- Structure -------------------------------------------------------------
  | { op: 'addMarker'; at: Seconds; name?: string }
  /**
   * AGT-4b: edit or remove a marker. `marker` is its id, or its exact name. `at` (seconds) moves it. `color` is a
   * `#rrggbb` or a label id (`label-1`…`label-8`). `remove` deletes it and cannot be combined with an edit.
   */
  | { op: 'setMarker'; marker: string; name?: string; at?: Seconds; color?: string; remove?: boolean }
  /** AGT-4b: the in/out range in seconds (`out` is exclusive); either end alone moves just that end. `clear` removes the range. */
  | { op: 'setInOut'; inSec?: Seconds; outSec?: Seconds; clear?: boolean }
  /** AGT-4b: link clips so they move, trim, split and delete together (at least two). */
  | { op: 'linkClips'; clips: ClipRef[] }
  | { op: 'unlinkClips'; clips: ClipRef[] }
  /** AGT-4b: rename a clip (≤ 80 characters). */
  | { op: 'renameClip'; clip: ClipRef; name: string }
  /** AGT-4b: rename, lock, hide or mute a lane, or remove it. `track` is its id or exact name; `hidden` is the lane's eye toggle. `remove` is refused while the lane holds clips. */
  | { op: 'setTrack'; track: string; name?: string; locked?: boolean; hidden?: boolean; muted?: boolean; remove?: boolean }
  // --- Compounds (PV-P1) ----------------------------------------------------
  // `nest` takes existing clip ids and makes one compound of them; `unnest` puts
  // a compound's clips back. Both are ONE undo step and both go through the
  // pure P1a-3 functions, so an assistant plan and a user gesture cannot disagree
  // about what a legal nest is.
  | {
      op: 'nest'
      /** The clips to combine, as ids or `$ref` names. At least two. */
      clips: ClipRef[]
      /** `$ref` name for the compound created, so a later op can address it. */
      ref?: string
      name?: string
    }
  | { op: 'unnest'; clip: ClipRef }
  // --- Composition (PV-P7) ---------------------------------------------------
  | {
      op: 'addComposition'
      /** Declared props; one with an existing name replaces it. */
      props: PropDef[]
      /** `clip` is a clip id, `$ref`, or 'compoundId/childId'. One binding per clip + path (a new one replaces it). */
      bindings?: Array<{ clip: ClipRef; path: string; prop: string; template?: string }>
    }
  | { op: 'setProp'; name: string; value: number | string | boolean }
  // --- Generated graphics (EG-P6) ---------------------------------------------
  /**
   * Change one field of a component instance (a graphic the director or the
   * gallery made). Re-expands through the instance method, so a part the user
   * moved by hand keeps its edit. `clip` is the compound's id, or a path
   * `'groupId/compoundId'` when the component sits inside a raw group.
   * `emphasis` is a list of words; `duration` is seconds and resizes the clip.
   */
  | {
      op: 'setComponentField'
      clip: ClipRef
      field: 'text' | 'sub' | 'variant' | 'energy' | 'emphasis' | 'duration'
      value: string | number | string[]
    }
  /** Replace a component's whole items list (chips, badges, stats, list rows). */
  | { op: 'setComponentItems'; clip: ClipRef; items: ComponentItem[] }
  // --- Generation (deferred: never runs inside the batch) --------------------
  /**
   * Regenerate ONE element from a brief (EG-P6): a component compound, or a
   * part inside a graphic. DEFERRED like `generateMedia`, but it writes nothing
   * at all: `applyOps` reports it in `regenerations` and the web layer runs the
   * director and shows the result as its own plan card.
   */
  | { op: 'regenerateElement'; clip: ClipRef; brief: string }
  /**
   * Place a range of a LIBRARY asset on the timeline as ONE merged clip: a
   * `video` clip that carries its own sound (`embeddedAudio`), trimmed to
   * `start..end` of the source, so picture and sound cannot desync. A rough
   * cut is a list of these.
   */
  | {
      op: 'insertSourceRange'
      ref?: string
      /** A `MediaAsset.id` from the library. */
      asset: string
      /** SOURCE seconds, not timeline seconds. */
      start: Seconds
      end: Seconds
      /** Timeline seconds; omitted appends after the last clip of the chosen lane. */
      at?: Seconds
      /** 0.25..4; the clip's own length shrinks or grows to match. */
      speed?: number
      /** Silence this clip's own sound (B-roll over a talking head). */
      mute?: boolean
      /** Place it above the base lane rather than on it. */
      overlay?: boolean
    }
  /**
   * Find stock footage by description and place it as B-roll (AGN-P9). Resolved CLIENT-SIDE, before
   * `sanitizeOps` sees the final list: the web layer searches, imports the result, and rewrites this op
   * into an `insertSourceRange`. It never reaches `applyOps`.
   */
  | {
      op: 'insertStock'
      ref?: string
      /** What to look for, in plain words. */
      query: string
      /** Timeline seconds; omitted appends. */
      at?: Seconds
      /** Seconds of the found clip to use; clamped to what the result actually has. */
      duration: Seconds
      kind?: 'video' | 'photo'
      /** Defaults true: B-roll sits above the base lane. */
      overlay?: boolean
      /** Defaults true: stock audio is never wanted. */
      mute?: boolean
    }
  /**
   * Place an IMAGE asset from the library as an `image` clip (AGN-P23). It has no range to cut: `duration` is how
   * long it holds (default 5s). A non-image or animated asset is refused. Stock photos arrive through this op.
   * `under`: as on `addGenerator` (a new lane directly behind that clip; default span = that clip; `overlay` is moot).
   */
  | { op: 'addImage'; ref?: string; asset: string; at?: Seconds; duration?: Seconds; overlay?: boolean; under?: ClipRef }
  /**
   * Place an imported SVG asset as editable vector shapes (AGN-P23), so path morphs, colour keys and masks have
   * something to act on. Resolved CLIENT-SIDE: the web layer reads the SVG and fills `clip` (never planner output).
   * An `insertVector` with no `clip` was never resolved and `applyOps` skips it; it never places a flat picture.
   * MI-P9: `query` is an alternative to `asset`: "find an open-source icon for this". The web layer searches,
   * imports the pick as a library SVG and rewrites the op to carry that `asset` and its `clip`; a `query` the
   * client never resolved has no `clip` and `applyOps` skips it. The sanitiser requires one of the two.
   */
  | { op: 'insertVector'; ref?: string; asset?: string; query?: string; at?: Seconds; clip?: Clip }
  /**
   * Place one converted HTML/CSS scene (MC-2a) as a single nested compound. Built by the client, like `insertVector`'s
   * `clip`: the agent tool `write_scene` validates, measures and converts the model's markup (`sceneToClip`) and fills
   * `clip`. It is NOT in `EDITOR_OP_NAMES`, so the model-facing schema never offers it and the sanitiser refuses a
   * forged one. No `clip`, or a clip that is not a compound, is skipped. One op = one undo step.
   */
  | { op: 'insertScene'; ref?: string; at?: Seconds; clip?: Clip }
  | { op: 'generateMedia'; ref?: string; media: 'image' | 'video'; prompt: string; at: Seconds; duration: Seconds }
  /**
   * Cut the person out of a VIDEO clip (MI-P7b, BG-2). A DEFERRED op the host application performs and may charge for,
   * over a source range of at most 60 s. It writes nothing at all; `applyOps` reports it in `backgroundRemovals`, and the
   * host application prices it (refusing a longer range), asks for Keep, runs ONE removal task (which finds the person
   * itself, so there is no subject field) and lands the result in one undo step:
   * - `land: 'matte'` (default): replace the background. The clip itself is cut; lanes below show through, so
   *   `under: <clip>` graphics (and anything on lower lanes) become the new background.
   * - `land: 'sandwich'`: the original stays whole; a cut copy goes on a new lane above it. `under: <the copy>`
   *   graphics sit behind the person and in front of the original background.
   * `idempotencyKey` and `projectId` are stamped by the host application, never by the model: the sanitiser drops them.
   */
  | {
      op: 'removeBackground'
      clip: ClipRef
      land?: 'matte' | 'sandwich'
      idempotencyKey?: string
      projectId?: string
    }

export type EditorOpName = EditorOp['op']

export const EDITOR_OP_NAMES: ReadonlyArray<EditorOpName> = [
  'addText',
  'addShape',
  'addGenerator',
  'addLowerThird',
  'addTitleCard',
  'addCallout',
  'setCaptionStyle',
  'addCaptions',
  'removeClip',
  'moveClip',
  'trimClip',
  'splitClip',
  'setSpeed',
  'applySpeedPreset',
  'setFit',
  'setClipProps',
  'applyMotionPreset',
  'staggerPreset',
  'setKeyframes',
  'setExpression',
  'setStyle',
  'addTransition',
  'removeTransition',
  'beatCuts',
  'silenceFreeze',
  'removeRanges',
  'crossfadeCuts',
  'duckUnder',
  'addSfx',
  'addEffect',
  'applyLook',
  'setEffectParam',
  'removeEffects',
  'removeEffect',
  'setBlend',
  'setMask',
  'addAdjustment',
  'addMarker',
  'setMarker',
  'setInOut',
  'linkClips',
  'unlinkClips',
  'renameClip',
  'setTrack',
  'addComposition',
  'setProp',
  'nest',
  'unnest',
  'setComponentField',
  'setComponentItems',
  'regenerateElement',
  'insertSourceRange',
  'insertStock',
  'addImage',
  'insertVector',
  'generateMedia',
  'removeBackground',
]

/** A plan as the model returns it (after sanitizing). */
export interface EditPlan {
  summary: string
  /** Short reasoning steps, shown while thinking and on the card. */
  steps: string[]
  ops: EditorOp[]
}

/** Generation the web layer must start after the plan is kept. */
export interface DeferredGeneration {
  index: number
  op: Extract<EditorOp, { op: 'generateMedia' }>
  /** The placeholder clip standing in for the media until it lands. */
  placeholderClipId: string
  trackId: string
  startFrame: number
  durationFrames: number
}

/**
 * A `removeBackground` op the web layer must price and run after Keep (MI-P7b). Nothing was written for it.
 * The source range is in SOURCE frames: the clip's trim window (`sourceStartFrame` / `sourceDurationFrames`);
 * a clip that carries neither reads as `0` and `durationFrames * speed` (rounded, at least 1).
 */
export interface DeferredBackgroundRemoval {
  index: number
  op: Extract<EditorOp, { op: 'removeBackground' }>
  clipId: string
  trackId: string
  startFrame: number
  durationFrames: number
  sourceStartFrame: number
  sourceDurationFrames: number
}

export interface ApplyResult {
  /** Indexes of ops that took effect. */
  applied: number[]
  skipped: Array<{ index: number; reason: string }>
  /** `$ref` names → the clip ids they created. */
  refs: Record<string, string>
  deferred: DeferredGeneration[]
  /**
   * `regenerateElement` ops (EG-P6): nothing was written for them. The web
   * layer runs each after Keep, as a plan card of its own. Absent when there are none.
   */
  regenerations?: Array<{ index: number; clip: ClipRef; brief: string }>
  /** `removeBackground` ops (MI-P7b): nothing was written for them. Absent when there are none. */
  backgroundRemovals?: DeferredBackgroundRemoval[]
  /** Clip ids the plan added, changed or removed — for the timeline's diff styling. */
  touched: { added: string[]; changed: string[]; removed: Array<{ id: string; name: string; trackId: string; startFrame: number; durationFrames: number }> }
  /** Timeline frames the plan touched, for "play the change". */
  range: { startFrame: number; endFrame: number } | null
}
