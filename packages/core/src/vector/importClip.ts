/**
 * Assembling and inserting an imported vector project (PV-P6b-2).
 *
 * `projectFromClips` is shared by every vector importer (SVG here, Lottie in
 * PV-P6c-*): a flat, bottom-to-top list of clips becomes a one-track-per-clip
 * child `Project`. `compoundClipFor` and `importedVectorClip` build the one
 * clip the editor actually inserts.
 */

import type { Clip, Project, Transform, TrackKind } from '../types'
import { generateId } from '../utils/id'
import { getTotalFrames } from '../utils/frames'
import { PROJECT_VERSION } from '../editor/projectDocument'
import { createTrack } from '../track/track'
import { createCompoundClip } from '../elements/compound'
import { resolveShapeRect } from '../renderer/gpu/layers/shapePaint'
import { fitTransform, VECTOR_IMPORT_FIT } from './place'

/**
 * Every shape clip holds one stage-sized RGBA texture in the preview
 * (`ShapeLayer` acquires `stage.width × stage.height` per clip), so an import
 * is bounded by bytes rather than by an arbitrary shape count.
 */
export const VECTOR_TEXTURE_BUDGET_BYTES = 128 * 1024 * 1024

/** clamp(floor(VECTOR_TEXTURE_BUDGET_BYTES / (width · height · 4)), 8, 128). */
export function maxShapesForStage(stage: { width: number; height: number }): number {
  const bytesPerShape = Math.max(1, stage.width * stage.height * 4)
  const n = Math.floor(VECTOR_TEXTURE_BUDGET_BYTES / bytesPerShape)
  return Math.min(128, Math.max(8, n))
}

/**
 * The track kind a compound clip is placed on. `isClipAllowedOnTrack` lives in
 * `packages/timeline/src/trackCompat.ts`, which core cannot import; read there
 * once (PV-P1a): `isClipAllowedOnTrack('compound', kind)` is true for both
 * 'video' and 'elements', and an imported vector's own tracks are never video,
 * so 'elements' is used here. The web inserter (PV-P6b-5) uses this same
 * constant rather than a second guess.
 */
export const COMPOUND_TRACK_KIND: TrackKind = 'elements'

/**
 * One track per item, bottom-to-top in the order given — the LAST item is on
 * top (highest `order`) — each clip re-parented onto its own fresh track.
 * Shared by every vector importer (SVG, and PV-P6c's Lottie).
 */
export function projectFromClips(
  items: Clip[],
  opts: { fps: number; stage: { width: number; height: number } },
): Project {
  const tracks = []
  const clips: Record<string, Clip[]> = {}
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const track = createTrack({
      kind: item.type === 'compound' ? COMPOUND_TRACK_KIND : 'elements',
      name: `Layer ${i + 1}`,
      order: i,
    })
    tracks.push(track)
    clips[track.id] = [{ ...item, trackId: track.id }]
  }
  return {
    id: generateId(),
    fps: opts.fps,
    stage: opts.stage,
    tracks,
    clips,
    transitions: [],
    version: PROJECT_VERSION,
  }
}

/** A compound clip wrapping `child` (P1a's factory). `trackId` is `''` until inserted. */
export function compoundClipFor(
  child: Project,
  opts: {
    name: string
    startFrame: number
    durationFrames: number
    sourceStartFrame?: number
    transform?: Transform
    opacity?: number
  },
): Clip {
  const clip = createCompoundClip({
    trackId: '',
    name: opts.name,
    startFrame: opts.startFrame,
    durationFrames: opts.durationFrames,
    project: child,
    ...(opts.transform ? { transform: opts.transform } : {}),
  })
  return {
    ...clip,
    ...(opts.sourceStartFrame !== undefined ? { sourceStartFrame: opts.sourceStartFrame } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
  }
}

/** `child` has exactly one clip, of type `shape`, and it carries no keyframes. */
function soleShapeClip(child: Project): Clip | null {
  const all = Object.values(child.clips).flat()
  if (all.length !== 1) return null
  const [clip] = all
  if (clip.type !== 'shape') return null
  if (clip.keyframes !== undefined) return null
  return clip
}

/** The one clip the editor inserts for an imported vector project. */
export function importedVectorClip(
  child: Project,
  opts: {
    name: string
    startFrame: number
    parentStage: { width: number; height: number }
    /** Default: `VECTOR_IMPORT_FIT`. */
    fit?: number
  },
): Clip {
  const fit = opts.fit ?? VECTOR_IMPORT_FIT
  const durationFrames = getTotalFrames(child.clips)

  const sole = soleShapeClip(child)
  if (sole !== null) {
    const rect = resolveShapeRect(sole.transform, child.stage)
    const maxSide = Math.max(rect.width, rect.height)
    const L = fit * Math.min(opts.parentStage.width, opts.parentStage.height)
    const f = maxSide > 0 ? L / maxSide : 1

    const transform: Transform = {
      x: 0.5,
      y: 0.5,
      rotation: rect.rotation,
      anchor: { x: 0.5, y: 0.5 },
      scale: fit,
      scaleX: maxSide > 0 ? rect.width / maxSide : 1,
      scaleY: maxSide > 0 ? rect.height / maxSide : 1,
    }

    return {
      ...sole,
      id: generateId(),
      trackId: '',
      startFrame: opts.startFrame,
      name: opts.name,
      sourceStartFrame: 0,
      sourceDurationFrames: durationFrames,
      transform,
      ...(sole.shapeStrokeWidth !== undefined ? { shapeStrokeWidth: sole.shapeStrokeWidth * f } : {}),
      ...(sole.shapeStrokeDash !== undefined ? { shapeStrokeDash: sole.shapeStrokeDash.map((d) => d * f) } : {}),
      ...(sole.shapeStrokeDashOffset !== undefined
        ? { shapeStrokeDashOffset: sole.shapeStrokeDashOffset * f }
        : {}),
    }
  }

  return compoundClipFor(child, {
    name: opts.name,
    startFrame: opts.startFrame,
    durationFrames,
    transform: fitTransform(child.stage, opts.parentStage, fit),
  })
}
