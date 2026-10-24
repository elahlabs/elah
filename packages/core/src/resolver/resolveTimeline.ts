import type { Project, Clip, ClipCompound, Transform, TransitionEasing } from '../types'
import { MAX_COMPOUND_DEPTH } from '../types'
import { embeddedAudioId } from './scene'
import { passesAudioSolo } from '../export/audioMix'
import { activeEnhance, clipAudioGain } from '../audio/clipAudio'
import type {
  Scene,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
  ActiveShapeClip,
  ActiveFreehandClip,
  ActiveAdjustmentClip,
  ActiveGeneratorClip,
  ActiveCompoundClip,
  ActiveSequenceClip,
} from './scene'
import { createExpressionContext, type ExpressionContext } from './expr/channels'
import {
  DEFAULT_SHAPE_TRANSFORM,
  DEFAULT_TEXT_TRANSFORM,
  sampleTextAnimation,
} from './textAnimation'
import {
  sampleChannel,
  sampleEffectColors,
  sampleExtendedChannels,
  sampleKeyframes,
  sampleTypedChannels,
  typeDefaultTransform,
  type TypedSample,
} from './keyframes'
import { resolveCompositing, type ResolvedCompositing, type ResolvedEffect } from '../effects/resolveEffects'
import { MOTION_BLUR_INPUTS } from '../effects/registry'
import { resolveRotoMasks } from './rotoMasks'
import { hasTimeRemap, lastSourceFrame, sourceFrameFor } from './sourceTime'
import { clampGeneratorParams } from '../generators/registry'
import { solveLayout, type LayoutHost } from './layout'
import { applyMotionPath } from './motionPath'
import { DEFAULT_SCRAMBLE_CHANGE_EVERY, resolveScrambleCharset } from '../elements/scramble'
import { isDrawableSequence, sequenceFrameIndex } from './sequence'
import type { TextMeasurer } from '../renderer/gpu/layers/textMeasure'

/**
 * Options for one resolve (PV-P3b). `measure` powers the layout pass: without
 * it, a constraint that needs a text box is skipped, never estimated.
 */
export interface ResolveOptions {
  measure?: TextMeasurer
}

/** `gen.<param>` samples → a params overlay. Undefined when none are keyed. */
function generatorKeys(extended: Record<string, number>): Record<string, number> | undefined {
  let out: Record<string, number> | undefined
  for (const [name, v] of Object.entries(extended)) {
    if (name.startsWith('gen.')) (out ??= {})[name.slice(4)] = v
  }
  return out
}

/**
 * A shape's draw-on window at this frame (EDX-P9): `shapeDraw` with the
 * `draw` channel overriding its end. Spread-ready; `{}` when unused so an
 * ordinary shape resolves exactly as before.
 */
function shapeDrawAt(clip: Clip, localFrame: number): { shapeDraw?: { start: number; end: number } } {
  const keys = clip.keyframes?.channels?.draw?.keys
  const keyed = keys?.length ? sampleChannel(keys, localFrame) : undefined
  const startKeys = clip.keyframes?.channels?.['draw.start']?.keys
  const keyedStart = startKeys?.length ? sampleChannel(startKeys, localFrame) : undefined
  if (!clip.shapeDraw && keyed === undefined && keyedStart === undefined) return {}
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)
  const start = clamp(keyedStart ?? clip.shapeDraw?.start ?? 0)
  const end = clamp(keyed ?? clip.shapeDraw?.end ?? 1)
  return { shapeDraw: { start, end: Math.max(start, end) } }
}

/**
 * MC-2d: a keyed `anchor.x` / `anchor.y` replaces that half of the transform's
 * anchor for this frame. Returns `transform` untouched (same object, so a clip
 * with no anchor keys resolves exactly as before) when neither is keyed.
 */
function withKeyedAnchor(
  transform: Transform | undefined,
  base: Transform,
  extended: Readonly<Record<string, number>>,
): Transform | undefined {
  const ax = extended['anchor.x']
  const ay = extended['anchor.y']
  if (ax === undefined && ay === undefined) return transform
  const t = transform ?? base
  return { ...t, anchor: { x: ax ?? t.anchor.x, y: ay ?? t.anchor.y } }
}

/**
 * MOT-1: while `clip.motionPath` is set, the path position (at the keyed `motion.progress`, 0 with
 * no keys) replaces x/y and, with `orient`, the tangent joins the rotation. Same object back when
 * the clip has no path, so an ordinary clip resolves exactly as before.
 */
function withMotionPath(
  clip: Clip,
  transform: Transform | undefined,
  base: Transform,
  progress: number | undefined,
  stage: { width: number; height: number } | undefined,
): Transform | undefined {
  if (!clip.motionPath || !stage) return transform
  return applyMotionPath(clip.motionPath, transform, base, progress, stage)
}

/** MC-2d: a Tier B channel's sample at this frame, or `undefined` when it is not keyed. */
function keyedField(extended: Readonly<Record<string, number>>, channel: string, min?: number): number | undefined {
  const v = extended[channel]
  if (v === undefined || !Number.isFinite(v)) return undefined
  return min === undefined ? v : Math.max(min, v)
}

/** Elements tracks always render above every video/audio track. */
const ELEMENTS_ZINDEX_BASE = 1000000

/**
 * Depth of a track's clips, ascending toward the viewer.
 *
 * `track.order` is the lane's position in the timeline UI, 0 = topmost. The
 * topmost lane is the *bottom* layer: each lane below it composites on top,
 * so stacking reads the same way as the timeline reads top-to-bottom. Scaled
 * by 1000 to leave room for sub-layer offsets (transitions use +1).
 *
 * Elements tracks are lifted by ELEMENTS_ZINDEX_BASE so text/shapes/subtitles
 * stay above every video and image regardless of lane position, while keeping
 * the same order-based ranking among themselves.
 */
function trackZIndex(track: { kind: string; order: number }): number {
  const depth = track.order * 1000
  return track.kind === 'elements' ? ELEMENTS_ZINDEX_BASE + depth : depth
}


/**
 * A clip's authored visual state with its keyframes applied — the values the
 * entry/exit animation then layers on and the transition pass finally wins
 * over. Keyframes are ABSOLUTE: a keyed channel replaces the authored value
 * for that frame (resolver/keyframes.ts explains why, and how that differs
 * from `MotionSpec`, which is a delta).
 *
 * A clip with no `keyframes` takes the first branch and comes out exactly as
 * it always has — that is the parity guarantee GoldenFrameHash and
 * GeometryParity depend on, and it is an explicit early return rather than a
 * merge that happens to be a no-op.
 */
interface ResolvedVisual {
  opacity: number
  /** Before track gain. */
  volume: number
  transform: Transform | undefined
  cornerRadius: number | undefined
  /**
   * Effects, blend, mask and matte for this frame, ready to spread into an
   * Active clip. `{}` for a clip that uses none of them.
   */
  compositing: ResolvedCompositing
  /**
   * Extended channels sampled for this frame (fx.*, mask.*, gen.*, …);
   * `NO_EXTENDED` when the clip has no keyframes.
   *
   * Carried on the visual rather than re-sampled by the generator branch: an
   * expression would then be evaluated twice per frame and its errors reported
   * twice.
   */
  extended: Readonly<Record<string, number>>
  /**
   * Typed channel values for this frame (PV-P5c): `color`/`shape.fill`/
   * `shape.stroke`/`shape.path`. `NO_TYPED` when the clip has no keyframes.
   */
  typed: Readonly<TypedSample>
}

/** Shared frozen empty so a clip with no keyframes allocates nothing per frame. */
const NO_EXTENDED: Readonly<Record<string, number>> = Object.freeze({})
const NO_TYPED: Readonly<TypedSample> = Object.freeze({})

function resolveClipVisual(
  clip: Clip,
  localFrame: number,
  exprCtx: ExpressionContext,
  // Stage size, so a clip under an automatic `motionBlur` can have its velocity
  // measured in stage px (MI-P8). Omitted = never measured.
  stage?: { width: number; height: number },
): ResolvedVisual {
  const vis = resolveClipVisualBase(clip, localFrame, exprCtx, stage)
  return stage ? withMotionVelocity(clip, localFrame, exprCtx, vis, stage) : vis
}

function resolveClipVisualBase(
  clip: Clip,
  localFrame: number,
  exprCtx: ExpressionContext,
  stage?: { width: number; height: number },
): ResolvedVisual {
  if (!clip.keyframes) {
    return {
      opacity: clip.opacity ?? 1,
      volume: clip.volume ?? 1,
      transform: withMotionPath(clip, clip.transform, typeDefaultTransform(clip.type), undefined, stage),
      cornerRadius: clip.cornerRadius,
      compositing: resolveCompositing(clip),
      extended: NO_EXTENDED,
      typed: NO_TYPED,
    }
  }
  const base = clip.transform ?? typeDefaultTransform(clip.type)
  // Undefined for a clip with no expression channel, which is the fast path and
  // the reason the hook is a parameter rather than a field on the context.
  const expr = exprCtx.evaluatorFor(clip, localFrame, base)
  const kf = sampleKeyframes(clip.keyframes, localFrame, base, expr)
  const extended = sampleExtendedChannels(clip.keyframes, localFrame, expr)
  return {
    opacity: kf.opacity ?? clip.opacity ?? 1,
    volume: kf.volume ?? clip.volume ?? 1,
    transform: withMotionPath(clip, withKeyedAnchor(kf.transform ?? clip.transform, base, extended), base, extended['motion.progress'], stage),
    cornerRadius: kf.cornerRadius ?? clip.cornerRadius,
    compositing: resolveCompositing(clip, extended, sampleEffectColors(clip.keyframes, localFrame)),
    extended,
    typed: sampleTypedChannels(clip.keyframes, localFrame),
  }
}

/** The enabled, resolved `motionBlur` effects that follow the clip's own motion. */
function isAutoMotionBlur(e: ResolvedEffect): boolean {
  return e.kind === 'motionBlur' && e.params.auto === true
}

/**
 * A clip's placement at `localFrame` as the renderer will see it: the keyed
 * transform, with a text/shape entry-exit animation applied on top exactly as
 * `buildActive` does. `undefined` = the clip has no transform of its own then.
 */
function placementAt(
  clip: Clip,
  localFrame: number,
  exprCtx: ExpressionContext,
  stage?: { width: number; height: number },
): Transform | undefined {
  const vis = resolveClipVisualBase(clip, localFrame, exprCtx, stage)
  const animation = clip.type === 'text' ? clip.textAnimation : clip.type === 'shape' ? clip.shapeAnimation : undefined
  if (!animation) return vis.transform
  const sample = sampleTextAnimation({
    animation,
    localFrame,
    clipDurationFrames: clip.durationFrames,
    transform: vis.transform,
    defaultTransform: clip.type === 'text' ? DEFAULT_TEXT_TRANSFORM : DEFAULT_SHAPE_TRANSFORM,
  })
  return sample.transform ?? vis.transform
}

/**
 * Velocity of a clip at `localFrame` for `motionBlur` (MI-P8): its resolved
 * placement one frame either side, central difference. Pure in `localFrame`,
 * so the preview and every export frame measure the same thing.
 *
 *  - Neighbours are clamped to the clip's own frames, so on its first frame
 *    this is the forward difference and on its last the backward one (the
 *    divisor is the real gap, 1 there instead of 2). A one-frame clip is at rest.
 *  - `x`, `y`: stage px per frame the ANCHOR point moves (transform x/y are
 *    stage fractions).
 *  - `spin`: radians per frame. `zoom`: fractional scale change per frame,
 *    the mean of the x and y stretch rates (`scale * scaleX|scaleY`), taken
 *    against the mid-point of the two samples so it is symmetric in time.
 *  - The corner reduction (a box rotating or scaling moves its four corners
 *    in four directions) is done where the box size is known, in the effect:
 *    see renderer/gpu/effects/motionBlur.ts.
 *  - A clip with no placement at either sample is reported at rest; with one
 *    it is compared against its type's default placement.
 */
function clipVelocity(
  clip: Clip,
  localFrame: number,
  exprCtx: ExpressionContext,
  stage: { width: number; height: number },
): { x: number; y: number; spin: number; zoom: number } {
  const last = Math.max(0, clip.durationFrames - 1)
  const a = Math.max(0, localFrame - 1)
  const b = Math.min(last, localFrame + 1)
  const gap = b - a
  const rest = { x: 0, y: 0, spin: 0, zoom: 0 }
  if (!(gap > 0)) return rest
  const ta = placementAt(clip, a, exprCtx, stage)
  const tb = placementAt(clip, b, exprCtx, stage)
  if (!ta && !tb) return rest
  const fallback =
    clip.type === 'text' ? DEFAULT_TEXT_TRANSFORM : clip.type === 'shape' ? DEFAULT_SHAPE_TRANSFORM : typeDefaultTransform(clip.type)
  const from = ta ?? fallback
  const to = tb ?? fallback
  const stretch = (t: Transform, axis: 'scaleX' | 'scaleY') => t.scale * (t[axis] ?? 1)
  const rate = (axis: 'scaleX' | 'scaleY') => {
    const sa = stretch(from, axis)
    const sb = stretch(to, axis)
    const mid = (sa + sb) / 2
    return mid > 0 ? (sb - sa) / mid : 0
  }
  return {
    x: ((to.x - from.x) * stage.width) / gap,
    y: ((to.y - from.y) * stage.height) / gap,
    spin: (to.rotation - from.rotation) / gap,
    zoom: (rate('scaleX') + rate('scaleY')) / 2 / gap,
  }
}

/**
 * Give every automatic `motionBlur` on the clip its measured velocity, in its
 * RESOLVED params (`MOTION_BLUR_INPUTS`). Returns `vis` itself, untouched,
 * for the overwhelming case of a clip without one: no velocity is computed,
 * no key is added, the scene is what it always was (GoldenFrameHash).
 * Carried on the resolved effect rather than a new scene field because every
 * layer, the compound path and the export worker already hand `effects`
 * through unchanged, so preview and export cannot see different velocities.
 */
function withMotionVelocity(
  clip: Clip,
  localFrame: number,
  exprCtx: ExpressionContext,
  vis: ResolvedVisual,
  stage: { width: number; height: number },
): ResolvedVisual {
  const effects = vis.compositing.effects
  if (!effects || !effects.some(isAutoMotionBlur)) return vis
  const v = clipVelocity(clip, localFrame, exprCtx, stage)
  return {
    ...vis,
    compositing: {
      ...vis.compositing,
      effects: effects.map((e) =>
        isAutoMotionBlur(e)
          ? {
              ...e,
              params: {
                ...e.params,
                [MOTION_BLUR_INPUTS.x]: v.x,
                [MOTION_BLUR_INPUTS.y]: v.y,
                [MOTION_BLUR_INPUTS.spin]: v.spin,
                [MOTION_BLUR_INPUTS.zoom]: v.zoom,
              },
            }
          : e,
      ),
    },
  }
}

/**
 * Clip-relative frame for a clip the transition pass reaches OUTSIDE its own
 * range (the incoming clip before its start, the outgoing one after its end).
 * Clamped so keyframes hold their first/last value there rather than
 * extrapolating.
 */
function clampedLocalFrame(clip: Clip, frame: number): number {
  return Math.min(Math.max(0, frame - clip.startFrame), Math.max(0, clip.durationFrames - 1))
}

function applyEasing(t: number, easing: TransitionEasing = 'linear'): number {
  const c = Math.max(0, Math.min(1, t))
  if (easing === 'ease-in') return c * c
  if (easing === 'ease-out') return c * (2 - c)
  return c
}

function findClipById(
  clips: Project['clips'],
  clipId: string,
): { clip: Clip; trackId: string } | null {
  for (const [trackId, trackClips] of Object.entries(clips)) {
    const clip = trackClips.find((c) => c.id === clipId)
    if (clip) return { clip, trackId }
  }
  return null
}

/**
 * resolveTimeline — pure, deterministic frame resolver.
 *
 * Given a frame number and the current project state, returns a Scene
 * describing exactly which clips are active and what their playback state is.
 *
 * Guarantees:
 *  - Deterministic: same (frame, project) always produces structurally equal output
 *  - No side-effects: safe in tests, Web Workers, WASM pipelines, export flows
 *  - No DOM, no React, no Zustand — plain data in, plain data out
 *
 * Exclusion rules:
 *  - Tracks with `disabled: true` are skipped entirely
 *  - Clips with `disabled: true` are skipped
 *  - Clips that do not overlap `frame` are skipped
 *  - Muted tracks produce audio/video clips with `volume: 0`
 *  - Tracks with solo enabled exclude all other tracks of the same kind from
 *    the scene. Image clips live on video tracks and follow video solo rules.
 *
 * zIndex semantics:
 *  Higher zIndex = closer to the viewer (front / on top), matching CSS/canvas
 *  conventions. Arrays are sorted ascending so renderers iterate forward and
 *  the last element (highest zIndex) renders on top.
 *  The `* 1000` multiplier reserves space for future sub-layer offsets
 *  (e.g. text overlays always +100 above their base video layer).
 *  Elements tracks (text/shape/freehand) are offset above every video/audio
 *  track by ELEMENTS_ZINDEX_BASE, but still ordered by track.order relative to
 *  each other — so when multiple elements tracks overlap in time, the one
 *  placed higher in the UI (lower order) still renders on top, matching the
 *  video-track convention instead of collapsing to one flat value.
 *
 * @example
 * ```ts
 * const scene = resolveTimeline(currentFrame, engine.getProject())
 * for (const v of scene.videos) {
 *   videoEl.src = v.src
 *   videoEl.currentTime = v.sourceFrame / project.fps
 * }
 * ```
 */
export function resolveTimeline(frame: number, project: Project, opts: ResolveOptions = {}): Scene {
  return resolveSceneAt(frame, project, 0, opts)
}

/** A compound clip at `sourceFrame` (PV-P1): its nested project resolved one level down. */
function compoundActive(
  clip: Clip & { compound: ClipCompound },
  sourceFrame: number,
  vis: ResolvedVisual,
  opacity: number,
  zIndex: number,
  depth: number,
  opts: ResolveOptions,
): ActiveCompoundClip {
  const child = clip.compound.project
  return {
    type: 'compound',
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    scene: resolveSceneAt(sourceFrame, child, depth + 1, opts),
    contentSize: { width: child.stage.width, height: child.stage.height },
    sourceFrame,
    opacity,
    zIndex,
    ...(vis.transform ? { transform: vis.transform } : {}),
    ...(vis.cornerRadius ? { cornerRadius: vis.cornerRadius } : {}),
    ...(clip.crop ? { crop: clip.crop } : {}),
    ...vis.compositing,
  }
}

/**
 * Nested audio is heard in preview (PV-P1): each audio clip of the compound
* scene joins the parent's `audios` under a namespaced id, on the compound's
 * track, with the compound gain folded in. Not for a retimed compound - the
 * same rule as `flattenAudioClips`, so preview and export agree.
 */
function hoistCompoundAudio(scene: Scene, clip: Clip, active: ActiveCompoundClip, gain: number): void {
  if ((clip.speed ?? 1) !== 1 || hasTimeRemap(clip)) return
  for (const a of active.scene.audios) {
    scene.audios.push({ ...a, id: `${clip.id}/${a.id}`, trackId: clip.trackId, volume: a.volume * gain })
  }
}

/**
 * The sound of a merged video clip (`Clip.embeddedAudio === true`) as a scene
 * audio entry, or null. THE emission guard: a video clip with a `src` that
 * opted in, and not time-remapped (the same rule `hoistCompoundAudio` and
 * `flattenAudioClips` apply, so preview and export agree). Built from values
 * `buildActive` already resolved - nothing is resolved a second time.
 */
function embeddedAudioTwin(clip: Clip, sourceFrame: number, volume: number, zIndex: number): ActiveAudioClip | null {
  if (clip.type !== 'video' || clip.embeddedAudio !== true || !clip.src) return null
  if (hasTimeRemap(clip)) return null
  return {
    type: 'audio',
    id: embeddedAudioId(clip.id),
    trackId: clip.trackId,
    name: clip.name,
    src: clip.src,
    sourceFrame,
    opacity: 1,
    volume,
    zIndex,
    ...(clip.speed !== undefined && clip.speed !== 1 ? { speed: clip.speed } : {}),
    ...enhanceOf(clip),
  }
}

/** `{ enhance }` when the clip's Enhance does anything, else nothing, so an untouched scene entry is unchanged. */
function enhanceOf(clip: Clip): { enhance?: NonNullable<ReturnType<typeof activeEnhance>> } {
  const enhance = activeEnhance(clip)
  return enhance ? { enhance } : {}
}

/**
 * A sequence clip at `sourceFrame` (PV-P8): which frame of its source to
 * show, loop/hold already applied by `sequenceFrameIndex`.
 */
function activeSequence(
  clip: Clip,
  vis: ResolvedVisual,
  sourceFrame: number,
  opacity: number,
  zIndex: number,
  fps: number,
): ActiveSequenceClip {
  const seq = clip.sequence!
  return {
    type: 'sequence',
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    kind: seq.kind,
    ...(seq.kind === 'animated-image' ? { src: clip.src! } : { frameUrlTemplate: seq.frameUrlTemplate! }),
    ...(seq.startNumber ? { startNumber: seq.startNumber } : {}),
    frameCount: seq.frameCount,
    frameIndex: sequenceFrameIndex(seq, sourceFrame, fps),
    ...(seq.loop ? { loop: true as const } : {}),
    sourceFrame,
    opacity,
    zIndex,
    ...(vis.transform ? { transform: vis.transform } : {}),
    ...(vis.cornerRadius ? { cornerRadius: vis.cornerRadius } : {}),
    ...(clip.crop ? { crop: clip.crop } : {}),
    ...vis.compositing,
  }
}

/**
 * One resolved clip, tagged by which scene array it belongs in (PV-P3b). The
 * main loop used to build-and-push an Active object per branch inline;
 * `buildActive` now does the building alone, so the layout pass can rebuild
 * one clip from a different base transform and swap it into the scene
 * without duplicating every branch's field list a second time.
 */
type ActiveEntry =
  // `embeddedAudio` is the merged clip's own sound (Clip.embeddedAudio), built
  // from the same resolved values as the picture; see `embeddedAudioTwin`.
  | { bucket: 'videos'; item: ActiveVideoClip; embeddedAudio?: ActiveAudioClip }
  | { bucket: 'audios'; item: ActiveAudioClip }
  | { bucket: 'texts'; item: ActiveTextClip }
  | { bucket: 'images'; item: ActiveImageClip }
  | { bucket: 'shapes'; item: ActiveShapeClip }
  | { bucket: 'freehand'; item: ActiveFreehandClip }
  | { bucket: 'adjustments'; item: ActiveAdjustmentClip }
  | { bucket: 'generators'; item: ActiveGeneratorClip }
  | { bucket: 'sequences'; item: ActiveSequenceClip }
  // A compound entry carries the clip and the pre-track-gain volume too:
  // `pushActive` needs both to hoist the nested project's audio, exactly as
  // the main loop used to do right after pushing.
  | { bucket: 'compounds'; item: ActiveCompoundClip; clip: Clip; volume: number }

/**
 * Build the Active item for an in-range clip, or `null` where the old
 * inline chain pushed nothing at all (video/audio/image without `src`, a
 * shape without `shapeKind`, an adjustment with nothing to apply, an unknown
 * generator kind) or `continue`d past a compound at the depth limit. Every
 * expression here is copied from the branch it replaces — this is code
 * motion, not a behaviour change.
 */
function buildActive(
  clip: Clip,
  frame: number,
  project: Project,
  zIndex: number,
  trackGain: number,
  exprCtx: ExpressionContext,
  depth: number,
  opts: ResolveOptions,
  // False when solo (or anything else) silences this clip's SOUND; the picture
  // is unaffected. Only the video branch reads it.
  audible = true,
): ActiveEntry | null {
  // How far into the source asset we are at this frame.
  const sourceFrame = sourceFrameFor(clip, frame)
  const vis = resolveClipVisual(clip, frame - clip.startFrame, exprCtx, project.stage)
  const opacity = vis.opacity
  // Fold track gain into effective volume; mute zeroes both. `clipAudioGain`
  // is the clip's own mute/boost/fades, the same envelope the export applies.
  const volume = vis.volume * trackGain * clipAudioGain(clip, frame - clip.startFrame, project.fps)

  if (clip.type === 'video' && clip.src) {
    const embeddedAudio = audible ? embeddedAudioTwin(clip, sourceFrame, volume, zIndex) : null
    return {
      bucket: 'videos',
      ...(embeddedAudio ? { embeddedAudio } : {}),
      item: {
        type: 'video',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        src: clip.src,
        sourceFrame,
        opacity,
        volume,
        zIndex,
        ...(vis.transform ? { transform: vis.transform } : {}),
        ...(vis.cornerRadius ? { cornerRadius: vis.cornerRadius } : {}),
        ...(clip.crop ? { crop: clip.crop } : {}),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'audio' && clip.src) {
    return {
      bucket: 'audios',
      item: {
        type: 'audio',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        src: clip.src,
        sourceFrame,
        opacity: 1,
        volume,
        zIndex,
        ...(clip.speed !== undefined && clip.speed !== 1 ? { speed: clip.speed } : {}),
        ...enhanceOf(clip),
        ...(clip.transform ? { transform: clip.transform } : {}),
      },
    }
  }
  if (clip.type === 'text') {
    // Resolve entry/exit animation into the scene primitives the renderers
    // already consume — opacity and transform — so neither renderer needs to
    // know about animations. See resolver/textAnimation.ts.
    const anim = sampleTextAnimation({
      animation: clip.textAnimation,
      localFrame: frame - clip.startFrame,
      clipDurationFrames: clip.durationFrames,
      // Keyframe-resolved, so the entry/exit ramp re-bases onto the
      // keyframed placement — the sampler treats this as "rest".
      transform: vis.transform,
      defaultTransform: DEFAULT_TEXT_TRANSFORM,
    })
    const resolvedOpacity = Math.min(opacity, anim.opacity)
    // `transform` absent means the animation is opacity-only: leave the
    // clip's own value exactly as authored, including leaving it undefined
    // so the renderer keeps applying its own default (scene.ts:37-38).
    const resolvedTransform = anim.transform ?? vis.transform
    const textFontSize = keyedField(vis.extended, 'text.fontSize', 1)
    const textLetterSpacing = keyedField(vis.extended, 'text.letterSpacing')
    // MOT-5: scramble applies to plain text only (a timed caption is refused). Unkeyed = progress 1, the real text.
    const scrambleOn = clip.textScramble !== undefined && !(clip.words?.length && clip.captionMode && clip.captionMode !== 'static')
    const scrambleProgress = Math.min(1, Math.max(0, keyedField(vis.extended, 'text.scramble') ?? 1))

    return {
      bucket: 'texts',
      item: {
        type: 'text',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        content: clip.content ?? '',
        sourceFrame,
        opacity: resolvedOpacity,
        zIndex,
        ...(resolvedTransform ? { transform: resolvedTransform } : {}),
        // PV-P2: the model this text's transform is read under. Conditional, so
        // a legacy clip's Active object gains no key at all.
        ...(clip.transformModel === 'v2' ? { transformModel: 'v2' as const } : {}),
        // PV-P3a: the text box, same rule. A legacy clip's Active object gains
        // no key at all, so the layout takes the untouched path.
        // MC-2d: a keyed `text.letterSpacing` rides on the box (a clip without
        // one gets the plain wrapping box, which lays out as the legacy block
        // plus tracking). Unkeyed, the stored box passes through untouched.
        ...(textLetterSpacing !== undefined
          ? { textBox: { overflow: 'wrap' as const, ...clip.textBox, letterSpacing: textLetterSpacing } }
          : clip.textBox
            ? { textBox: clip.textBox }
            : {}),
        // MC-2d: a keyed `text.fontSize` replaces the authored size for this frame.
        ...(textFontSize !== undefined
          ? { fontSize: textFontSize }
          : clip.fontSize !== undefined
            ? { fontSize: clip.fontSize }
            : {}),
        // PV-P5c: a keyed `color` replaces the authored value for this frame.
        ...(vis.typed.color !== undefined
          ? { color: vis.typed.color }
          : clip.color !== undefined
            ? { color: clip.color }
            : {}),
        ...(clip.fontFamily !== undefined ? { fontFamily: clip.fontFamily } : {}),
        // PV-P4a: the bundled font id. Conditional for the same reason as every
        // field above it — a legacy clip's Active object gains no key at all.
        ...(clip.fontId !== undefined ? { fontId: clip.fontId } : {}),
        ...(clip.fontWeight !== undefined ? { fontWeight: clip.fontWeight } : {}),
        // PV-P4b: italic. Conditional like every field above it, so a legacy
        // clip's Active object gains no key at all.
        ...(clip.fontStyle !== undefined ? { fontStyle: clip.fontStyle } : {}),
        ...(clip.textAlign !== undefined ? { textAlign: clip.textAlign } : {}),
        ...(clip.backgroundColor !== undefined ? { backgroundColor: clip.backgroundColor } : {}),
        ...(clip.backgroundOpacity !== undefined ? { backgroundOpacity: clip.backgroundOpacity } : {}),
        ...(clip.padding !== undefined ? { padding: clip.padding } : {}),
        ...(clip.borderRadius !== undefined ? { borderRadius: clip.borderRadius } : {}),
        ...(clip.borderWidth !== undefined ? { borderWidth: clip.borderWidth } : {}),
        ...(clip.borderColor !== undefined ? { borderColor: clip.borderColor } : {}),
        ...(clip.textOutline ? { textOutline: clip.textOutline } : {}),
        ...(clip.textShadow ? { textShadow: clip.textShadow } : {}),
        // MC-1d: background-box shadow and decoration. Conditional like every
        // field above, so a clip without them gains no key at all.
        ...(clip.shadow ? { shadow: clip.shadow } : {}),
        ...(clip.textDecoration ? { textDecoration: clip.textDecoration } : {}),
        // PV-P4c: the glyph fill. Conditional, so a clip without one gains no
        // key and paints from `color` exactly as before. PV-P5c: a keyed
        // `color` is a solid fill for this frame and wins over the stored
        // gradient/paint, exactly as it wins over the plain `color` string
        // just above.
        ...(clip.textFill && vis.typed.color === undefined ? { textFill: clip.textFill } : {}),
        // PV-P4c-2: styled runs. `.length` rather than truthiness so an EMPTY
        // array adds no key — a legacy clip and a clip whose spans were all
        // cleared must resolve identically.
        ...(clip.spans?.length ? { spans: clip.spans } : {}),
        ...(clip.textAnimator ? { textAnimator: clip.textAnimator } : {}),
        ...(scrambleOn
          ? {
              scramble: {
                progress: scrambleProgress,
                charset: resolveScrambleCharset(clip.textScramble!.charset),
                seed: clip.textScramble!.seed ?? 0,
                changeEvery: clip.textScramble!.changeEvery ?? DEFAULT_SCRAMBLE_CHANGE_EVERY,
                preserve: clip.textScramble!.preserve ?? 'spaces',
              },
            }
          : {}),
        ...(clip.words?.length ? { words: clip.words } : {}),
        ...(clip.captionMode ? { captionMode: clip.captionMode } : {}),
        ...(clip.captionHighlight ? { captionHighlight: clip.captionHighlight } : {}),
        ...(clip.textAnimator || scrambleOn || (clip.words?.length && clip.captionMode && clip.captionMode !== 'static')
          ? { localFrame: frame - clip.startFrame }
          : {}),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'image' && clip.src) {
    return {
      bucket: 'images',
      item: {
        type: 'image',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        src: clip.src,
        sourceFrame,
        opacity,
        zIndex,
        ...(vis.transform ? { transform: vis.transform } : {}),
        ...(vis.cornerRadius ? { cornerRadius: vis.cornerRadius } : {}),
        ...(clip.crop ? { crop: clip.crop } : {}),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'shape' && clip.shapeKind) {
    // Shapes share `TextAnimation` with text (types/index.ts:145-148), so
    // they resolve through the same module — including `spin`, since
    // `shapePaint.paintShape` reads `transform.rotation`.
    const sanim = sampleTextAnimation({
      animation: clip.shapeAnimation,
      localFrame: frame - clip.startFrame,
      clipDurationFrames: clip.durationFrames,
      transform: vis.transform,
      defaultTransform: DEFAULT_SHAPE_TRANSFORM,
    })
    const resolvedOpacity = Math.min(opacity, sanim.opacity)
    const resolvedTransform = sanim.transform ?? vis.transform
    return {
      bucket: 'shapes',
      item: {
        type: 'shape',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        shapeKind: clip.shapeKind,
        // PV-P5c: a keyed `shape.fill`/`shape.stroke` replaces the authored
        // colour for this frame, exactly as a keyed text `color` does.
        shapeFill: vis.typed.fill ?? clip.shapeFill ?? 'transparent',
        shapeStroke: vis.typed.stroke ?? clip.shapeStroke ?? '#ffffff',
        // MC-2d: a keyed `stroke.width` replaces the authored width for this frame.
        shapeStrokeWidth: keyedField(vis.extended, 'stroke.width', 0) ?? clip.shapeStrokeWidth ?? 2,
        sourceFrame,
        opacity: resolvedOpacity,
        zIndex,
        ...(resolvedTransform ? { transform: resolvedTransform } : {}),
        // Keyframed corner radius reaches shapes through the same channel
        // video/image use — `resolveClipVisual` already sampled it.
        ...(vis.cornerRadius ? { cornerRadius: vis.cornerRadius } : {}),
        // Per-variant geometry. Spread conditionally so a rect's resolved
        // clip stays the exact object shape existing tests assert on.
        ...(clip.shapeSides !== undefined ? { shapeSides: clip.shapeSides } : {}),
        ...(clip.shapeInnerRatio !== undefined ? { shapeInnerRatio: clip.shapeInnerRatio } : {}),
        ...(clip.shapeArrowHead !== undefined ? { shapeArrowHead: clip.shapeArrowHead } : {}),
        // PV-P5c: a keyed `shape.path` morph replaces the authored path for
        // this frame.
        ...(vis.typed.path !== undefined
          ? { shapePath: vis.typed.path }
          : clip.shapePath !== undefined
            ? { shapePath: clip.shapePath }
            : {}),
        ...(clip.shapeViewBox !== undefined ? { shapeViewBox: clip.shapeViewBox } : {}),
        ...(clip.shapeFillRule !== undefined ? { shapeFillRule: clip.shapeFillRule } : {}),
        // PV-P5c: a keyed solid colour wins over a stored gradient/paint for
        // this frame, exactly as it wins over the plain fill/stroke string.
        ...(clip.shapeFillPaint !== undefined && vis.typed.fill === undefined
          ? { shapeFillPaint: clip.shapeFillPaint }
          : {}),
        ...(clip.shapeStrokePaint !== undefined && vis.typed.stroke === undefined
          ? { shapeStrokePaint: clip.shapeStrokePaint }
          : {}),
        ...(clip.shapeStrokeDash !== undefined ? { shapeStrokeDash: clip.shapeStrokeDash } : {}),
        ...(clip.shapeStrokeDashOffset !== undefined ? { shapeStrokeDashOffset: clip.shapeStrokeDashOffset } : {}),
        ...(clip.shapeStrokeCap !== undefined ? { shapeStrokeCap: clip.shapeStrokeCap } : {}),
        ...(clip.shapeStrokeJoin !== undefined ? { shapeStrokeJoin: clip.shapeStrokeJoin } : {}),
        ...(clip.shapeStrokeAlign !== undefined ? { shapeStrokeAlign: clip.shapeStrokeAlign } : {}),
        // MC-1d: fill shadow and per-corner radii.
        ...(clip.shadow ? { shadow: clip.shadow } : {}),
        ...(clip.cornerRadii ? { cornerRadii: clip.cornerRadii } : {}),
        ...shapeDrawAt(clip, frame - clip.startFrame),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'freehand') {
    return {
      bucket: 'freehand',
      item: {
        type: 'freehand',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        pathData: clip.pathData ?? '',
        strokeColor: clip.strokeColor ?? '#ffffff',
        strokeWidth: clip.strokeWidth ?? 4,
        sourceFrame,
        opacity,
        zIndex,
        ...(vis.transform ? { transform: vis.transform } : {}),
        // PV-P2: the model the drawing's transform is read under. Conditional,
        // so a legacy clip's Active object gains no key at all.
        ...(clip.transformModel === 'v2' ? { transformModel: 'v2' as const } : {}),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'adjustment') {
    // Picture-less: only compositing matters. Skipped entirely when it
    // carries nothing to apply, so an empty adjustment clip costs nothing.
    if (!vis.compositing.effects && !vis.compositing.mask && !vis.compositing.blend && opacity >= 1) return null
    return {
      bucket: 'adjustments',
      item: {
        type: 'adjustment',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        sourceFrame,
        opacity,
        zIndex,
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'generator' && clip.generator) {
    const localFrame = frame - clip.startFrame
    // `vis.extended`, not a second sample: the sampler there is already
    // expression-aware, so sampling again would evaluate every expression
    // twice and report its errors twice.
    const keyed = generatorKeys(vis.extended)
    const params = clampGeneratorParams(clip.generator.kind, keyed ? { ...clip.generator.params, ...keyed } : clip.generator.params)
    // An unknown kind (a document from a newer build) draws nothing.
    if (!params) return null
    return {
      bucket: 'generators',
      item: {
        type: 'generator',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        kind: clip.generator.kind,
        params,
        seed: clip.generator.seed ?? 1,
        localFrame,
        durationFrames: clip.durationFrames,
        fps: project.fps,
        sourceFrame,
        opacity,
        zIndex,
        ...(vis.transform ? { transform: vis.transform } : {}),
        ...vis.compositing,
      },
    }
  }
  if (clip.type === 'compound' && clip.compound) {
    // A level-4 project may not nest further (the reader refuses it; this
    // guards hand-built projects).
    if (depth >= MAX_COMPOUND_DEPTH) return null
    const active = compoundActive(clip as Clip & { compound: ClipCompound }, sourceFrame, vis, opacity, zIndex, depth, opts)
    return { bucket: 'compounds', item: active, clip, volume }
  }
  if (clip.type === 'sequence' && isDrawableSequence(clip)) {
    return { bucket: 'sequences', item: activeSequence(clip, vis, sourceFrame, opacity, zIndex, project.fps) }
  }
  return null
}

/** Push a freshly built entry into its scene array, creating an optional array with `??=` exactly as the branch it replaces did. */
function pushActive(scene: Scene, entry: ActiveEntry): void {
  switch (entry.bucket) {
    case 'videos':
      scene.videos.push(entry.item)
      if (entry.embeddedAudio) scene.audios.push(entry.embeddedAudio)
      break
    case 'audios':
      scene.audios.push(entry.item)
      break
    case 'texts':
      scene.texts.push(entry.item)
      break
    case 'images':
      scene.images.push(entry.item)
      break
    case 'shapes':
      scene.shapes.push(entry.item)
      break
    case 'freehand':
      scene.freehand.push(entry.item)
      break
    case 'adjustments':
      (scene.adjustments ??= []).push(entry.item)
      break
    case 'generators':
      (scene.generators ??= []).push(entry.item)
      break
    case 'sequences':
      (scene.sequences ??= []).push(entry.item)
      break
    case 'compounds':
      (scene.compounds ??= []).push(entry.item)
      // Nested audio is heard in preview: hoisted right after the push, exactly
      // as the main loop used to do inline.
      hoistCompoundAudio(scene, entry.clip, entry.item, entry.volume)
      break
  }
}

/** Replace the item with the same id in its scene array (a no-op if it is not there). */
function replaceActive(scene: Scene, entry: ActiveEntry): void {
  const replaceIn = <T extends { id: string }>(arr: T[] | undefined, item: T): void => {
    if (!arr) return
    const i = arr.findIndex((x) => x.id === item.id)
    if (i !== -1) arr[i] = item
  }
  switch (entry.bucket) {
    case 'videos':
      replaceIn(scene.videos, entry.item)
      if (entry.embeddedAudio) replaceIn(scene.audios, entry.embeddedAudio)
      break
    case 'audios':
      replaceIn(scene.audios, entry.item)
      break
    case 'texts':
      replaceIn(scene.texts, entry.item)
      break
    case 'images':
      replaceIn(scene.images, entry.item)
      break
    case 'shapes':
      replaceIn(scene.shapes, entry.item)
      break
    case 'freehand':
      replaceIn(scene.freehand, entry.item)
      break
    case 'adjustments':
      replaceIn(scene.adjustments, entry.item)
      break
    case 'generators':
      replaceIn(scene.generators, entry.item)
      break
    case 'sequences':
      replaceIn(scene.sequences, entry.item)
      break
    case 'compounds':
      replaceIn(scene.compounds, entry.item)
      break
  }
}

/**
 * The resolver, with the compound nesting depth it is at. A compound resolves
 * its nested project by calling this one level down (PV-P1);
 * `resolveTimeline` stays the public entry point so nothing else changes.
 */
function resolveSceneAt(frame: number, project: Project, depth: number, opts: ResolveOptions): Scene {
  // ONE context for the whole resolve (PV-P5b). It owns the deduplicated error
  // list and the memoised clip views, so creating it per clip or per channel
  // would report the same problem many times over.
  const exprCtx = createExpressionContext(project, frame)
  const scene: Scene = {
    frame,
    fps: project.fps,
    stage: project.stage,
    videos: [],
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
  }

  // --- Solo pre-pass ---------------------------------------------------------
  // If any track of a given kind is solo'd, only that track (or those tracks)
  // will contribute clips. Image clips live on video tracks and share solo rules.
  const hasSolo = { video: false, audio: false, elements: false }
  for (const t of project.tracks) {
    if (t.solo) {
      if (t.kind === 'video' || t.kind === 'audio' || t.kind === 'elements') {
        hasSolo[t.kind] = true
      }
    }
  }

  // --- Main loop -------------------------------------------------------------
  // Clips carrying `layout` (PV-P3b), in scene order — the laid-out base is
  // solved once every eligible clip has been built, right below this loop.
  const laidOut: Array<{ clip: Clip; zIndex: number; trackGain: number; audible: boolean }> = []

  for (const track of project.tracks) {
    if (track.disabled) continue

    // Whether this lane's SOUND is heard (audio emission only - picture solo
    // keeps its per-kind rule below, so soloing an audio lane never blanks the
    // stage). Shared with the export mix so preview and export cannot drift.
    // (Mute is not part of this: a muted lane still emits, at volume 0, via
    // `trackGain`. This is only the solo half of `isClipAudioAudible`, which
    // the export mix applies.)
    const audible = passesAudioSolo(track, project.tracks)

    // Solo exclusion: skip this track if another track of the same kind is
    // solo'd and this one isn't.
    if (hasSolo[track.kind as 'video' | 'audio' | 'elements'] && !track.solo) continue

    const clips = project.clips[track.id]
    if (!clips || clips.length === 0) continue

    const zIndex = trackZIndex(track)

    for (const clip of clips) {
      if (clip.disabled) continue
      if (frame < clip.startFrame) continue
      if (frame >= clip.startFrame + clip.durationFrames) continue

      // Fold track gain into effective volume; mute zeroes both.
      const trackGain = track.muted ? 0 : (track.volume ?? 1)
      const entry = buildActive(clip, frame, project, zIndex, trackGain, exprCtx, depth, opts, audible)
      if (!entry) continue
      pushActive(scene, entry)
      if (clip.layout) laidOut.push({ clip, zIndex, trackGain, audible })
    }
  }

  // --- Layout pass (PV-P3b) ---------------------------------------------------
  // Only when an active clip carries `layout`: order the constrained clips by
  // dependency, solve each one's laid-out base transform from the rest boxes
  // of its targets, then re-resolve it from that base — keyframes and
  // entry/exit motion still apply on top, because `buildActive` runs again
  // with the SAME clip, just a different `transform`. A project without
  // `layout` never allocates `laidOut` beyond the empty array and never runs
  // this block, so it resolves to the identical scene.
  if (laidOut.length > 0) {
    const byId = new Map<string, Clip>()
    for (const list of Object.values(project.clips)) for (const c of list) byId.set(c.id, c)
    const host: LayoutHost = {
      stage: project.stage,
      measure: opts.measure,
      clipById: (id) => byId.get(id),
      restItem: (clip, transform) => {
        const e = buildActive(
          { ...clip, transform, keyframes: undefined, textAnimation: undefined, shapeAnimation: undefined },
          frame,
          project,
          0,
          1,
          exprCtx,
          depth,
          opts,
        )
        return e && (e.bucket === 'texts' || e.bucket === 'shapes' || e.bucket === 'freehand') ? e.item : null
      },
    }
    const { bases, errors } = solveLayout(host, laidOut.map((d) => d.clip))
    for (const d of laidOut) {
      const base = bases.get(d.clip.id)
      if (!base) continue
      const rebuilt = buildActive({ ...d.clip, transform: base }, frame, project, d.zIndex, d.trackGain, exprCtx, depth, opts, d.audible)
      if (rebuilt) replaceActive(scene, rebuilt)
    }
    if (errors.length > 0) scene.layoutErrors = errors
  }

  // --- Transition pass -------------------------------------------------------
  // For each transition whose window contains `frame`, BOTH clips are in the
  // scene at their resolved state (effects, keyframes, opacity) and keep
  // playing. `scene.transitions[]` tells the renderers to composite the pair
  // with the transition instead of drawing them one over the other: the GPU
  // TransitionPass (preview, and export on WebGL2) renders each clip into its
  // own target and blends them with the transition shader (EDX-P9c). The
  // Canvas2D export fallback hides the outgoing clip and paints its snapshot.

  for (const transition of project.transitions) {
    if (frame < transition.startFrame) continue
    if (frame >= transition.startFrame + transition.durationFrames) continue

    const rawT = (frame - transition.startFrame) / Math.max(1, transition.durationFrames)
    const t = applyEasing(rawT, transition.easing)

    const fromResult = findClipById(project.clips, transition.fromClipId)
    const toResult = findClipById(project.clips, transition.toClipId)
    if (!fromResult || !toResult) continue

    const { clip: fromClip } = fromResult
    const { clip: toClip } = toResult

    // zIndex: outgoing sits below incoming during the transition. Resolved
    // through the same helper as the main loop so an elements-track transition
    // keeps its ELEMENTS_ZINDEX_BASE lift instead of dropping behind media.
    const transitionTrack = project.tracks.find((tr) => tr.id === transition.trackId)
    const fromZIndex = trackZIndex(transitionTrack ?? { kind: 'video', order: 0 })
    const toZIndex = fromZIndex + 1

    // Source frames — clamped so we never seek past the clip's source bounds.
    const fromSourceFrame = Math.min(Math.max(0, sourceFrameFor(fromClip, frame)), lastSourceFrame(fromClip))
    const toSourceFrame = Math.max(0, Math.min(sourceFrameFor(toClip, frame), lastSourceFrame(toClip)))

    // Both clips at their RESOLVED opacity (keyframes + authored), never
    // clamped upward: the transition shader does the fading. (Before EDX-P9c
    // the outgoing clip was forced to 0 and shown as a frozen snapshot.)

    // Both clips may sit OUTSIDE their own range for half the window (the main
    // loop skipped them), so resolve them here with a clamped local frame.
    const fromVis = resolveClipVisual(fromClip, clampedLocalFrame(fromClip, frame), exprCtx, project.stage)
    const fromOpacity = fromVis.opacity
    const toVis = resolveClipVisual(toClip, clampedLocalFrame(toClip, frame), exprCtx, project.stage)

    const toTrackMuted = project.tracks.find((tr) => tr.id === toClip.trackId)?.muted ?? false

    // Video clips. The picture cross-fades, but a merged clip's SOUND
    // (`embeddedAudio` twin) is deliberately NOT mirrored here: it is built
    // only in `buildActive`, so each clip's audio runs to its own boundary
    // (the Premiere behaviour, and the only one the export mix can reproduce -
    // it is built from flattenAudioClips, which knows nothing of transitions).
    // `volume: 0` below silences the legacy `videos[].volume` field only.
    if (fromClip.type === 'video' && fromClip.src) {
      const existing = scene.videos.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
        existing.sourceFrame = fromSourceFrame
      } else {
        scene.videos.push({
          type: 'video',
          id: fromClip.id,
          trackId: fromClip.trackId,
          name: fromClip.name,
          src: fromClip.src,
          sourceFrame: fromSourceFrame,
          opacity: fromOpacity,
          volume: 0,
          zIndex: fromZIndex,
          ...(fromVis.transform ? { transform: fromVis.transform } : {}),
          ...(fromVis.cornerRadius ? { cornerRadius: fromVis.cornerRadius } : {}),
          ...(fromClip.crop ? { crop: fromClip.crop } : {}),
          ...fromVis.compositing,
        })
      }
    }
    if (toClip.type === 'video' && toClip.src) {
      const existing = scene.videos.find((v) => v.id === toClip.id)
      if (existing) {
        // Opacity already resolved by the main loop; only the seek changes.
        existing.sourceFrame = toSourceFrame
      } else {
        scene.videos.push({
          type: 'video',
          id: toClip.id,
          trackId: toClip.trackId,
          name: toClip.name,
          src: toClip.src,
          sourceFrame: toSourceFrame,
          opacity: toVis.opacity,
          volume: toTrackMuted ? 0 : toVis.volume,
          zIndex: toZIndex,
          ...(toVis.transform ? { transform: toVis.transform } : {}),
          ...(toVis.cornerRadius ? { cornerRadius: toVis.cornerRadius } : {}),
          ...(toClip.crop ? { crop: toClip.crop } : {}),
          ...toVis.compositing,
        })
      }
    }

    // Image clips
    if (fromClip.type === 'image' && fromClip.src) {
      const existing = scene.images.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
      } else {
        scene.images.push({
          type: 'image',
          id: fromClip.id,
          trackId: fromClip.trackId,
          name: fromClip.name,
          src: fromClip.src,
          sourceFrame: fromSourceFrame,
          opacity: fromOpacity,
          zIndex: fromZIndex,
          ...(fromVis.transform ? { transform: fromVis.transform } : {}),
          ...(fromVis.cornerRadius ? { cornerRadius: fromVis.cornerRadius } : {}),
          ...(fromClip.crop ? { crop: fromClip.crop } : {}),
          ...fromVis.compositing,
        })
      }
    }
    if (toClip.type === 'compound' && toClip.compound && depth < MAX_COMPOUND_DEPTH) {
      const existing = scene.compounds?.find((v) => v.id === toClip.id)
      if (!existing) {
        (scene.compounds ??= []).push(compoundActive(toClip as Clip & { compound: ClipCompound }, toSourceFrame, toVis, toVis.opacity, toZIndex, depth, opts))
      }
    }

    // Compound clips take a transition exactly as images do (PV-P1). No audio is
    // hoisted here: a transition fade is a picture, not a sound.
    if (fromClip.type === 'compound' && fromClip.compound && depth < MAX_COMPOUND_DEPTH) {
      const existing = scene.compounds?.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
      } else {
        (scene.compounds ??= []).push(compoundActive(fromClip as Clip & { compound: ClipCompound }, fromSourceFrame, fromVis, fromOpacity, fromZIndex, depth, opts))
      }
    }

    if (toClip.type === 'image' && toClip.src) {
      const existing = scene.images.find((v) => v.id === toClip.id)
      if (!existing) {
        scene.images.push({
          type: 'image',
          id: toClip.id,
          trackId: toClip.trackId,
          name: toClip.name,
          src: toClip.src,
          sourceFrame: toSourceFrame,
          opacity: toVis.opacity,
          zIndex: toZIndex,
          ...(toVis.transform ? { transform: toVis.transform } : {}),
          ...(toVis.cornerRadius ? { cornerRadius: toVis.cornerRadius } : {}),
          ...(toClip.crop ? { crop: toClip.crop } : {}),
          ...toVis.compositing,
        })
      }
    }

    // Sequence clips (PV-P8), mirroring the image blocks above. Unlike
    // video/image, a sequence is sourceless (its window grows freely), so its
    // source frame is only floored at 0 here — never clamped at the top by
    // `lastSourceFrame`, which would bound it by `sourceDurationFrames` rather
    // than by anything the sequence itself means. `sequenceFrameIndex` already
    // bounds the drawn frame.
    if (fromClip.type === 'sequence' && isDrawableSequence(fromClip)) {
      const existing = scene.sequences?.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
      } else {
        (scene.sequences ??= []).push(
          activeSequence(fromClip, fromVis, Math.max(0, sourceFrameFor(fromClip, frame)), fromOpacity, fromZIndex, project.fps),
        )
      }
    }
    if (toClip.type === 'sequence' && isDrawableSequence(toClip)) {
      const existing = scene.sequences?.find((v) => v.id === toClip.id)
      if (!existing) {
        (scene.sequences ??= []).push(
          activeSequence(toClip, toVis, Math.max(0, sourceFrameFor(toClip, frame)), toVis.opacity, toZIndex, project.fps),
        )
      }
    }

    scene.transitions.push({
      id: transition.id,
      kind: transition.kind,
      t,
      direction: transition.direction,
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
    })
  }

  // Sort ascending by zIndex: lower values = further back = earlier in array.
  // Higher zIndex = front; the last element in each array renders on top.
  const byDepth = (a: { zIndex: number }, b: { zIndex: number }) =>
    a.zIndex - b.zIndex

  scene.videos.sort(byDepth)
  scene.audios.sort(byDepth)
  scene.texts.sort(byDepth)
  scene.images.sort(byDepth)
  scene.shapes.sort(byDepth)
  scene.freehand.sort(byDepth)
  // A legacy scene must not gain the key at all, so this is conditional.
  if (scene.compounds) scene.compounds.sort(byDepth)
  if (scene.sequences) scene.sequences.sort(byDepth)

  // Roto review masks copy the resolved videos, so they run last. Only set
  // when non-empty: scenes without roto stay exactly as they were.
  const rotoMasks = resolveRotoMasks(scene.videos, project)
  if (rotoMasks.length > 0) scene.rotoMasks = rotoMasks

  // Expression problems, only when there are any (PV-P5b): a scene with no
  // expressions must stay byte-identical to one from before this ticket, so
  // the key is absent rather than an empty array.
  if (exprCtx.errors.length > 0) scene.expressionErrors = exprCtx.errors

  return scene
}
