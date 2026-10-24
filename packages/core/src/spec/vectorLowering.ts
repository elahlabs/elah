/**
 * Drawn assets in a scene (MI-P5): the `vector` authored kind.
 *
 * A model can write an SVG (an asset call) but it cannot place one: the compiler knows
 * nothing of SVG, and `spec/types.ts` is frozen. So a `vector` element goes through the
 * same two-step the motion systems use (MI-P3):
 *
 *   1. EXPAND (`vectorPlaceholder`, called by `expandComponents`): the element becomes an
 *      ordinary `rect` shape that carries the asset name in a `vector` field. Everything the
 *      author wrote about the element (box, layer, keys, expressions, effects, enter/exit,
 *      matte, fxKeys) rides on that rect, so polish and the compiler treat it like any shape
 *      and `lowerAuthoredFields` can still matte it.
 *   2. LOWER (`lowerVectors`, called by `buildVideo` after the compile and after
 *      `lowerAuthoredFields`): each placeholder CLIP is replaced by the imported SVG as a
 *      compound of path clips (the importer's own, `svgToProject` + `importedVectorClip`),
 *      named by the SVG's ids. The compound keeps the placeholder's clip id, track, keys,
 *      matte, effects, blend and `partId`, so everything that named the element still works.
 *
 * `compiled.project` is changed in place, like `lowerAuthoredFields`. A document with no
 * `vector` is returned untouched with no issue, so every existing document compiles to
 * exactly what it did.
 *
 * Failure policy: a vector whose asset is missing (or unreadable, or has no drawable part)
 * gets an `error` issue and its placeholder is REMOVED. The transparent-looking rect is never
 * left on screen. Too many parts is a `warn`; the asset is still placed.
 *
 * Scale. The placeholder's `scale` is a multiplier on the authored box (1 = as authored). The
 * compound's base scale is the fit that makes the SVG's long edge equal the box's long edge,
 * so every `scale` key (and a `scale` expression) is multiplied by that base. `scaleX` and
 * `scaleY` keys have no meaning on a compound and are dropped with a `warn`.
 */

import type { Clip, ClipKeyframes, Project, Transform } from '../types'
import { compoundClipFor, importedVectorClip } from '../vector/importClip'
import { svgToProject } from '../vector/svg/svgToProject'
import type { SvgNode } from '../vector/svg/types'
import type { SpecVector } from './components/types'
import type { CompileResult, SpecElement, SpecFormat, SpecIssue, VideoSpec } from './types'

/** Parts (drawn shapes) an asset may have. More is a `vector-parts` warn: each part is a stage-sized texture in the preview. */
export const MAX_VECTOR_PARTS = 10
/** Long edge, in px, of the stage the SVG is imported on (`svgToProject`'s own default). */
export const VECTOR_STAGE_SIZE = 1024
/** With no `w`/`h`, a vector's long edge is this fraction of the stage's short side. */
export const VECTOR_DEFAULT_FRACTION = 0.3
/** The longest expression the engine accepts (`SpecExpression.source`). */
const MAX_EXPRESSION_CHARS = 512

/** The field a placeholder carries. Present on a compiled spec's element, read by `lowerVectors`. */
export interface VectorFields {
  /** The name of the asset this placeholder stands for. */
  vector?: string
}

type Carrier = SpecElement & VectorFields

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/**
 * The raw element a `vector` lowers to at expand time: a `rect` with the authored box (a square of the long edge,
 * or `VECTOR_DEFAULT_FRACTION` of the short side), every other authored field untouched, and the asset name.
 */
export function vectorPlaceholder(el: SpecVector, id: string, format: Pick<SpecFormat, 'width' | 'height'>): SpecElement & VectorFields {
  const { kind: _kind, asset, ...rest } = el
  const short = Math.min(format.width, format.height)
  const edge = Math.max(positive(el.w) ? el.w : 0, positive(el.h) ? el.h : 0) || Math.max(1, Math.round(short * VECTOR_DEFAULT_FRACTION))
  return {
    ...(rest as Omit<SpecElement, 'kind'>),
    id,
    kind: 'shape',
    shape: 'rect',
    w: edge,
    h: edge,
    fill: '#000000',
    name: el.name ?? asset,
    vector: asset,
  }
}

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

interface Slot {
  project: Project
  list: Clip[]
}

function indexProject(project: Project, slots: Map<string, Slot>): void {
  for (const list of Object.values(project.clips)) {
    for (const clip of list) {
      slots.set(clip.id, { project, list })
      if (clip.compound?.project) indexProject(clip.compound.project, slots)
    }
  }
}

interface Found {
  el: Carrier
  path: string
}

function collect(elements: ReadonlyArray<SpecElement>, prefix: string, out: Found[]): void {
  elements.forEach((el, i) => {
    const path = `${prefix}[${i}]`
    if (typeof (el as Carrier).vector === 'string') out.push({ el: el as Carrier, path })
    if (el.children) collect(el.children, `${path}.children`, out)
  })
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** The keyframes with the `scale` channel multiplied by `factor` and `scaleX`/`scaleY` dropped. */
function rebaseKeyframes(keyframes: ClipKeyframes | undefined, factor: number, say: (issue: Omit<SpecIssue, 'path'>) => void): ClipKeyframes | undefined {
  if (!keyframes) return undefined
  const channels: ClipKeyframes['channels'] = { ...keyframes.channels }
  for (const dropped of ['scaleX', 'scaleY'] as const) {
    if (channels[dropped]) {
      delete channels[dropped]
      say({ severity: 'warn', code: 'vector-channel-dropped', message: `a drawn asset has no ${dropped}; its ${dropped} keys were dropped (use scale)` })
    }
  }
  const scale = channels.scale
  if (scale) {
    if (scale.source.kind === 'expression') {
      const wrapped = `(${scale.source.source}) * ${round6(factor)}`
      if (wrapped.length <= MAX_EXPRESSION_CHARS) channels.scale = { ...scale, source: { kind: 'expression', source: wrapped } }
      else say({ severity: 'warn', code: 'vector-scale-expression', message: 'the scale expression is too long to rebase onto a drawn asset, so it was left as written (it will read as a multiple of the asset\'s native size)' })
    } else {
      channels.scale = { ...scale, keys: scale.keys.map((k) => ({ ...k, value: round6(k.value * factor) })) }
    }
  }
  return { ...keyframes, channels }
}

/** The placeholder's identity and animation, laid over the imported compound. */
const CARRIED = ['id', 'trackId', 'partId', 'startFrame', 'durationFrames', 'locked', 'disabled', 'opacity', 'blend', 'effects', 'matte', 'mask', 'linkId', 'labelColor', 'transformModel'] as const

/**
 * Replace every placeholder clip of `compiled.project` with its imported asset, in place. `vectors` maps an asset name to
 * its parsed SVG. Returns the issues it raised (the caller appends them to the compile's). Never throws.
 */
export function lowerVectors(spec: VideoSpec, compiled: CompileResult, vectors: Readonly<Record<string, SvgNode>> | undefined): SpecIssue[] {
  const found: Found[] = []
  collect(spec.elements ?? [], 'elements', found)
  if (found.length === 0) return []

  const issues: SpecIssue[] = []
  const slots = new Map<string, Slot>()
  indexProject(compiled.project, slots)

  for (const { el, path } of found) {
    const clipId = compiled.elementClipIds[el.id]
    const slot = clipId ? slots.get(clipId) : undefined
    if (!clipId || !slot) continue // never compiled (a flattened or failed element): nothing to replace
    const index = slot.list.findIndex((c) => c.id === clipId)
    if (index < 0) continue
    const placeholder = slot.list[index]!
    const asset = el.vector as string
    const say = (issue: Omit<SpecIssue, 'path'>) => issues.push({ ...issue, path: `${path}.asset` })
    const remove = () => {
      slot.list.splice(slot.list.findIndex((c) => c.id === clipId), 1)
    }

    const node = vectors?.[asset]
    if (!node) {
      say({ severity: 'error', code: 'vector-missing', message: `no drawn asset named "${asset}"; the element was removed` })
      remove()
      continue
    }

    let imported: ReturnType<typeof svgToProject>
    try {
      imported = svgToProject(node, { fps: slot.project.fps > 0 ? slot.project.fps : 30, durationFrames: Math.max(1, placeholder.durationFrames), size: VECTOR_STAGE_SIZE })
    } catch (err) {
      say({ severity: 'error', code: 'vector-invalid', message: `the asset "${asset}" could not be read: ${err instanceof Error ? err.message : 'unknown error'}; the element was removed` })
      remove()
      continue
    }
    if (imported.shapeCount === 0) {
      say({ severity: 'error', code: 'vector-empty', message: `the asset "${asset}" has no drawn part; the element was removed` })
      remove()
      continue
    }
    if (imported.shapeCount > MAX_VECTOR_PARTS) {
      say({ severity: 'warn', code: 'vector-parts', message: `the asset "${asset}" has ${imported.shapeCount} parts (the budget is ${MAX_VECTOR_PARTS}); each is a stage-sized texture in the preview` })
    }
    for (const skip of imported.skipped) {
      say({ severity: 'info', code: 'vector-skipped', message: `the asset "${asset}": ${skip.feature} ×${skip.count} is not drawn` })
    }

    // The authored box: the placeholder is a rect `edge` px on its long side. Its long edge becomes the SVG's.
    const stage = slot.project.stage
    const short = Math.min(stage.width, stage.height)
    const t = placeholder.transform
    const edge = Math.max(t?.scaleX ?? 0, t?.scaleY ?? 0) * short
    const fit = (edge > 0 ? edge : short * VECTOR_DEFAULT_FRACTION) / short

    const name = placeholder.name
    let rep: Clip = importedVectorClip(imported.project, { name, startFrame: placeholder.startFrame, parentStage: stage, fit })
    // The importer returns a lone drawable as a bare shape; an asset is always a compound so its parts stay addressable.
    if (rep.type !== 'compound') {
      rep = compoundClipFor(imported.project, {
        name,
        startFrame: placeholder.startFrame,
        durationFrames: placeholder.durationFrames,
        transform: { x: 0.5, y: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 }, scale: (fit * short) / Math.max(imported.project.stage.width, imported.project.stage.height) },
      })
    }
    const baseScale = rep.transform?.scale ?? 1

    const transform: Transform = {
      x: t?.x ?? 0.5,
      y: t?.y ?? 0.5,
      rotation: t?.rotation ?? 0,
      anchor: t?.anchor ?? { x: 0.5, y: 0.5 },
      scale: (t?.scale ?? 1) * baseScale,
    }
    const keyframes = rebaseKeyframes(placeholder.keyframes, baseScale, say)

    const replacement: Clip = { ...rep, name, transform, durationFrames: placeholder.durationFrames, sourceDurationFrames: placeholder.durationFrames, assetFrames: placeholder.durationFrames }
    for (const key of CARRIED) {
      const value = placeholder[key]
      if (value !== undefined) (replacement as unknown as Record<string, unknown>)[key] = value
    }
    if (keyframes) replacement.keyframes = keyframes
    else delete replacement.keyframes
    slot.list[slot.list.findIndex((c) => c.id === clipId)] = replacement
  }
  return issues
}
