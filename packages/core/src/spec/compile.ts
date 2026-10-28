/**
 * compile.ts — `compileVideoSpec(spec, opts) -> CompileResult` (AV-1).
 *
 * Pure. Never throws. Turns the author-unit `VideoSpec` into an engine
 * `Project`, plus every issue it had to work around.
 *
 * The heart of it is `compileLevel`, run once for the root document and once
 * per `group` element (recursively, one nesting level deeper each time):
 *
 *   1. Assign every element at this level a clip id UP FRONT, before any
 *      clip is built, so a forward reference (element 3 anchors to element 7)
 *      resolves exactly like a backward one.
 *   2. Compute each element's frame timing and layer, and pack the layers
 *      into non-overlapping tracks (`layers.ts`) — the engine THROWS on an
 *      overlapping track, and a throw here would roll back everything.
 *   3. Build each element's `Clip` through its kind's builder
 *      (`elements/*.ts`), which resolves every reference through this
 *      level's id map, so `anchorTo`/`fitTo`/`clip("id")` all land on real
 *      clip ids or become an `error` issue — never a dangling name.
 *
 * `opts.seed`, when given, wraps the whole compile in `withSeededIds` so two
 * compiles of one spec produce byte-identical ids — and therefore a
 * byte-comparable document.
 */

import type { Clip, ClipComponentInstance, Project, Track } from '../types'
import { MAX_COMPOUND_DEPTH } from '../types'
import { generateId, withSeededIds } from '../utils/id'
import { createTrack } from '../track/track'
import { documentVersionFor } from '../editor/projectDocument'
import type { CompileOptions, CompileResult, SpecDesign, SpecElement, SpecIssue, VideoSpec } from './types'
import {
  AT_SEC_RANGE,
  clampIssue,
  designColorMap,
  designFontMap,
  DURATION_SEC_RANGE,
  pixelBox,
  resolveToken,
  toDurationFrames,
  toFrames,
} from './units'
import { packLayers, type LayerInput } from './layers'
import type { BuildContext } from './elements/common'
import { buildTextClip } from './elements/text'
import { buildShapeClip } from './elements/shape'
import { buildIconClip } from './elements/icon'
import { buildImageClip } from './elements/image'
import { buildAudioClip } from './elements/audio'
import { buildGeneratorClip } from './elements/generator'
import { buildGroupClip, type CompileChildren } from './elements/group'

/**
 * `CompileOptions` plus the provenance stamping seam (EG-P1). `CompileOptions`
 * lives in the frozen `spec/types.ts`, so the stamping fields are declared
 * here: an additive widening in a non-frozen file.
 */
export interface CompileStampOptions extends CompileOptions {
  /**
   * Component records keyed by the group element id they were expanded under
   * (`expandComponents().componentInstances`). The matching compound clip
   * gets it as `Clip.component`. Every compiled clip also gets
   * `partId` = its spec element id; neither field is read by the renderer.
   */
  componentInstances?: Record<string, ClipComponentInstance>
}

interface LevelFormat {
  fps: number
  width: number
  height: number
}

/**
 * `elements`, but with any `group` that would exceed `MAX_COMPOUND_DEPTH`
 * replaced by its own children (offset onto this level's clock), recursively
 * — rather than a document with a level-5 compound the reader would refuse.
 */
function flattenDeepGroups(elements: ReadonlyArray<SpecElement>, depth: number, issues: SpecIssue[], pathPrefix: string): SpecElement[] {
  if (depth < MAX_COMPOUND_DEPTH) return [...elements]
  const out: SpecElement[] = []
  elements.forEach((el, i) => {
    if (el.kind !== 'group') {
      out.push(el)
      return
    }
    issues.push({
      severity: 'warn',
      path: `${pathPrefix}[${i}]`,
      code: 'max-depth-flattened',
      message: `group nesting exceeds the maximum compound depth (${MAX_COMPOUND_DEPTH}); its children were flattened into the parent level`,
    })
    const offsetChildren = (el.children ?? []).map((c) => ({ ...c, at: c.at + el.at }))
    out.push(...flattenDeepGroups(offsetChildren, depth, issues, pathPrefix))
  })
  return out
}

/** `resolveColor` without a `BuildContext` — used for the one field (`background`) that exists outside any element. */
function resolveStandaloneColor(value: string, colorTokens: Readonly<Record<string, string>>, issues: SpecIssue[], path: string): string | undefined {
  const resolved = resolveToken(value, colorTokens)
  if (resolved === undefined) {
    issues.push({ severity: 'error', path, code: 'unknown-token', message: `unknown colour token "${value}"` })
  }
  return resolved
}

function compileLevel(
  elements: ReadonlyArray<SpecElement>,
  format: LevelFormat,
  durationSeconds: number,
  background: string | undefined,
  design: SpecDesign | undefined,
  depth: number,
  pathPrefix: string,
  issues: SpecIssue[],
  fontIds: Set<string>,
  elementClipIds: Record<string, string>,
  idPrefix: string,
  componentInstances: Readonly<Record<string, ClipComponentInstance>> = {},
): Project {
  const stage = { width: format.width, height: format.height }
  const fps = format.fps > 0 ? format.fps : 30
  const colorTokens = designColorMap(design)
  const fontTokens = designFontMap(design)
  const mkId = () => `${idPrefix}-${generateId()}`

  const flat = flattenDeepGroups(elements, depth, issues, pathPrefix)

  // --- pass 1: ids up front, so forward references resolve -----------------
  const clipIdOf = new Map<SpecElement, string>()
  const localIds: Record<string, string> = {}
  for (const el of flat) {
    const id = mkId()
    clipIdOf.set(el, id)
    localIds[el.id] = id
    elementClipIds[el.id] = id
  }

  // --- timing + layer packing -----------------------------------------------
  const timingOf = new Map<SpecElement, { startFrame: number; durationFrames: number }>()
  flat.forEach((el, i) => {
    const p = `${pathPrefix}[${i}]`
    const atSec = clampIssue(el.at, AT_SEC_RANGE[0], AT_SEC_RANGE[1], `${p}.at`, issues)
    const durSec = clampIssue(el.duration, DURATION_SEC_RANGE[0], DURATION_SEC_RANGE[1], `${p}.duration`, issues)
    timingOf.set(el, { startFrame: toFrames(atSec, fps), durationFrames: toDurationFrames(durSec, fps) })
  })

  const layerInputs: LayerInput[] = flat.map((el) => {
    const t = timingOf.get(el)!
    return { id: clipIdOf.get(el)!, layer: Number.isFinite(el.layer) ? (el.layer as number) : 0, startFrame: t.startFrame, durationFrames: t.durationFrames }
  })
  const hasBackground = background !== undefined
  const pack = packLayers(layerInputs, hasBackground ? 1 : 0)

  // --- tracks ----------------------------------------------------------------
  const tracks: Track[] = []
  const clips: Record<string, Clip[]> = {}
  const trackIdForOrder = new Map<number, string>()

  if (hasBackground) {
    const bg = createTrack({ kind: 'elements', order: 0, name: 'Background' })
    tracks.push(bg)
    clips[bg.id] = []
    const totalFrames = toDurationFrames(
      clampIssue(durationSeconds, DURATION_SEC_RANGE[0], DURATION_SEC_RANGE[1], `${pathPrefix}.duration`, issues),
      fps,
    )
    const box = pixelBox({ w: stage.width, h: stage.height }, stage)
    const resolvedBg = resolveStandaloneColor(background!, colorTokens, issues, `${pathPrefix}.background`)
    const bgClip: Clip = {
      id: mkId(),
      trackId: bg.id,
      type: 'shape',
      name: 'Background',
      startFrame: 0,
      durationFrames: totalFrames,
      sourceStartFrame: 0,
      sourceDurationFrames: totalFrames,
      volume: 1,
      opacity: 1,
      locked: false,
      disabled: false,
      transform: { x: 0.5, y: 0.5, scale: box.scale, rotation: 0, anchor: { x: 0.5, y: 0.5 }, scaleX: box.scaleX, scaleY: box.scaleY },
      shapeKind: 'rect',
      shapeFill: resolvedBg ?? '#000000',
      shapeStrokeWidth: 0,
    }
    clips[bg.id]!.push(bgClip)
  }

  for (const lane of pack.lanes) {
    const t = createTrack({ kind: 'elements', order: lane.order, name: `Layer ${lane.order}` })
    tracks.push(t)
    clips[t.id] = []
    trackIdForOrder.set(lane.order, t.id)
  }

  // --- pass 2: build clips -----------------------------------------------
  flat.forEach((el, i) => {
    const p = `${pathPrefix}[${i}]`
    const id = clipIdOf.get(el)!
    const timing = timingOf.get(el)!
    const order = pack.orderOf[id]
    const trackId = order === undefined ? undefined : trackIdForOrder.get(order)
    if (trackId === undefined) return // never happens: every element was packed into a lane above

    const ctx: BuildContext = {
      fps,
      stage,
      colorTokens,
      fontTokens,
      issues,
      fontIds,
      resolveRef: (elementId, refPath) => {
        const ref = localIds[elementId]
        if (!ref) {
          issues.push({ severity: 'error', path: refPath, code: 'bad-reference', message: `no element "${elementId}" at this level` })
        }
        return ref
      },
    }
    const input = { id, trackId, startFrame: timing.startFrame, durationFrames: timing.durationFrames }

    let clip: Clip
    switch (el.kind) {
      case 'text':
        clip = buildTextClip(el, input, ctx, p)
        break
      case 'shape':
        clip = buildShapeClip(el, input, ctx, p)
        break
      case 'icon':
        clip = buildIconClip(el, input, ctx, p)
        break
      case 'image':
        clip = buildImageClip(el, input, ctx, p)
        break
      case 'audio':
        clip = buildAudioClip(el, input, ctx, p)
        break
      case 'generator':
        clip = buildGeneratorClip(el, input, ctx, p)
        break
      case 'group': {
        const compileChildren: CompileChildren = (children, durationFrames, groupPath) =>
          compileLevel(children, format, durationFrames / fps, undefined, design, depth + 1, `${groupPath}.children`, issues, fontIds, elementClipIds, idPrefix, componentInstances)
        clip = buildGroupClip(el, input, ctx, p, compileChildren)
        break
      }
      default:
        issues.push({ severity: 'error', path: `${p}.kind`, code: 'unknown-kind', message: `unknown element kind "${String(el.kind)}"` })
        return
    }

    if (el.raw) {
      clip = { ...clip, ...el.raw }
      issues.push({ severity: 'info', path: `${p}.raw`, code: 'raw-fields', message: 'raw fields were spread onto the compiled clip' })
    }

    // Provenance (EG-P1). Stamped after the `raw` spread so a raw field cannot erase it.
    clip.partId = el.id
    const instance = el.kind === 'group' ? componentInstances[el.id] : undefined
    if (instance) clip.component = instance

    clips[trackId]!.push(clip)
  })

  for (const list of Object.values(clips)) list.sort((a, b) => a.startFrame - b.startFrame)

  return {
    id: mkId(),
    fps,
    stage,
    tracks,
    clips,
    transitions: [],
    version: documentVersionFor({ clips }),
  }
}

/** Pure, deterministic (given `opts.seed`), and never throws — every problem becomes a `SpecIssue`. */
export function compileVideoSpec(spec: VideoSpec, opts: CompileStampOptions = {}): CompileResult {
  const idPrefix = opts.idPrefix ?? 'av'
  const run = (): CompileResult => {
    const issues: SpecIssue[] = []
    const fontIds = new Set<string>()
    const elementClipIds: Record<string, string> = {}
    const project = compileLevel(
      spec.elements ?? [],
      spec.format,
      spec.duration,
      spec.background,
      spec.design,
      0,
      'elements',
      issues,
      fontIds,
      elementClipIds,
      idPrefix,
      opts.componentInstances,
    )
    return { project, issues, elementClipIds, fontIds: [...fontIds] }
  }
  return opts.seed === undefined ? run() : withSeededIds(opts.seed, run)
}
