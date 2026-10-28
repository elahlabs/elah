/**
 * layProject.ts — lay a compiled `Project` onto a LIVE `TimelineEngine`
 * (AV-1), as ONE undo step.
 *
 * `engine.addClip` always mints a fresh clip id (`elements/base.ts`'s
 * `createClip`): the id compile.ts stamped is not the id the clip ends up
 * with on the live timeline. Every cross-reference the compiled document
 * carries — `layout.anchorTo.clip`, `layout.fitTo.clip`, an expression's
 * `clip("id")` — is therefore remapped through the old-id -> new-id table
 * this function builds while it inserts, so a reference that was correct in
 * the compiled document is still correct once it lands.
 *
 * `addClip` also runs the CLOSED factory (`createClip`), which silently
 * drops `keyframes`, `layout`, `textAnimator`, `shapeFillPaint`, `generator`,
 * `compound` and more. So every clip is inserted with `addClip` (minimal,
 * type-discriminated options — this gets it onto the right track at the
 * right position, validated by the engine's own overlap check) and then
 * immediately finished with `updateClip` carrying everything else — the same
 * two-call pattern a compound insert uses, generalised to a whole project's worth of tracks and
 * clips in one `engine.batch`.
 *
 * `loadProject` is not used: it wipes the undo stack unless `history: 'keep'`
 * and does not go through `discardLast`, which the assistant's Discard
 * button depends on.
 */

import type { AnyKeyframeChannel, Clip, Project, ProjectAuthored } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import type { CreateClipOptions } from '../elements/base'
import { getTotalFrames } from '../utils/frames'
import type { ApplyResult } from '../ops/types'

export interface LayProjectOptions {
  /** Undo label. Default: "Add generated video". */
  description?: string
  /** The authored document the piece came from; stored on `Project.authored` inside the same undo step (EG-P1). */
  authored?: ProjectAuthored
}

/** `clip("id")` / `clip('id')` — same grammar `spec/elements/common.ts` rewrites, so the two agree. */
const CLIP_REF_RE = /\bclip\(\s*(["'])((?:(?!\1)[^\n\r])*)\1\s*\)/g

function remapExpressionRefs(source: string, idMap: ReadonlyMap<string, string>): string {
  return source.replace(CLIP_REF_RE, (whole, quote: string, oldId: string) => {
    const mapped = idMap.get(oldId)
    return mapped ? `clip(${quote}${mapped}${quote})` : whole
  })
}

/** The minimal, type-discriminated options `engine.addClip` needs to create a same-shaped clip on `trackId`. */
function createOptionsFor(clip: Clip, trackId: string): CreateClipOptions {
  const base = {
    trackId,
    name: clip.name,
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    volume: clip.volume,
    opacity: clip.opacity,
  }
  switch (clip.type) {
    case 'text':
      return { ...base, type: 'text', text: { content: clip.content ?? '' } }
    case 'image':
      return { ...base, type: 'image', src: clip.src ?? '', assetId: clip.assetId }
    case 'audio':
      return { ...base, type: 'audio', src: clip.src ?? '', assetId: clip.assetId }
    case 'generator':
      return { ...base, type: 'generator', generator: clip.generator ?? { kind: '', params: {} } }
    case 'compound':
      return { ...base, type: 'compound', compound: clip.compound ?? { project: emptyChildProject(clip) } }
    case 'shape':
    default:
      return { ...base, type: 'shape', shape: { shapeKind: clip.shapeKind ?? 'rect' } }
  }
}

/** Never reached in practice — `compile.ts` always sets `compound` on a `compound` clip — but keeps `createOptionsFor` total. */
function emptyChildProject(clip: Clip): Project {
  return { id: `${clip.id}-empty`, fps: 30, stage: { width: 1, height: 1 }, tracks: [], clips: {}, transitions: [], version: 1 }
}

/**
 * `clip`, with its own id and `trackId` mapped through `idMap`/`trackIdMap`,
 * and every `layout`/expression reference to another clip in this same
 * batch mapped along with it.
 */
function remapClip(clip: Clip, idMap: ReadonlyMap<string, string>, newTrackId: string): Clip {
  const out: Clip = { ...clip, id: idMap.get(clip.id) ?? clip.id, trackId: newTrackId }

  if (out.layout) {
    const layout = { ...out.layout }
    if (layout.anchorTo) layout.anchorTo = { ...layout.anchorTo, clip: idMap.get(layout.anchorTo.clip) ?? layout.anchorTo.clip }
    if (layout.fitTo) layout.fitTo = { ...layout.fitTo, clip: idMap.get(layout.fitTo.clip) ?? layout.fitTo.clip }
    out.layout = layout
  }

  // A matte names its source by clip id (MI-P3), so it must follow the same remap or a top-level matte dangles.
  if (out.matte) out.matte = { ...out.matte, sourceClipId: idMap.get(out.matte.sourceClipId) ?? out.matte.sourceClipId }

  if (out.keyframes) {
    const channels = { ...out.keyframes.channels }
    for (const key of Object.keys(channels) as AnyKeyframeChannel[]) {
      const track = channels[key]
      if (track?.source.kind === 'expression') {
        channels[key] = { ...track, source: { kind: 'expression', source: remapExpressionRefs(track.source.source, idMap) } }
      }
    }
    out.keyframes = { ...out.keyframes, channels }
  }

  return out
}

/**
 * Lay `project` onto `engine` as one undo step. Every track becomes a new
 * live track (appended above whatever is already there, so an existing
 * timeline is never disturbed); every clip becomes a new live clip, with its
 * cross-references intact. The stage is only adopted when the live timeline
 * is empty of clips — a generated video should not silently resize a
 * timeline someone is already editing.
 */
export function layProject(engine: TimelineEngine, project: Project, opts: LayProjectOptions = {}): ApplyResult {
  const result: ApplyResult = {
    applied: [],
    skipped: [],
    refs: {},
    deferred: [],
    touched: { added: [], changed: [], removed: [] },
    range: null,
  }

  engine.batch(() => {
    const live = engine.getProject()
    const isEmpty = Object.values(live.clips).every((list) => list.length === 0)
    if (isEmpty) engine.setStage(project.stage.width, project.stage.height)

    const existingOrders = live.tracks.map((t) => t.order)
    let nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0

    const sortedTracks = [...project.tracks].sort((a, b) => a.order - b.order)
    const trackIdMap = new Map<string, string>()
    for (const t of sortedTracks) {
      const created = engine.addTrack(t.kind, {
        name: t.name,
        order: nextOrder++,
        height: t.height,
        ...(t.pinned ? { pinned: t.pinned } : {}),
        ...(t.protected ? { protected: t.protected } : {}),
      })
      trackIdMap.set(t.id, created.id)
    }

    const allClips: Clip[] = sortedTracks.flatMap((t) => project.clips[t.id] ?? [])

    const idMap = new Map<string, string>()
    const created: Array<{ clip: Clip; newId: string; newTrackId: string }> = []
    for (const clip of allClips) {
      const newTrackId = trackIdMap.get(clip.trackId)
      if (!newTrackId) continue // a clip on a track this project did not declare — cannot happen from compile.ts's own output
      const addedClip = engine.addClip(createOptionsFor(clip, newTrackId))
      idMap.set(clip.id, addedClip.id)
      created.push({ clip, newId: addedClip.id, newTrackId })
    }

    let index = 0
    for (const { clip, newId, newTrackId } of created) {
      const remapped = remapClip(clip, idMap, newTrackId)
      const { id: _id, ...rest } = remapped
      engine.updateClip(newId, newTrackId, rest)
      result.applied.push(index++)
      result.touched.added.push(newId)
    }

    // Inside the batch so Discard / one undo removes the clips and the document together.
    if (opts.authored) engine.setAuthored(opts.authored)
  }, opts.description ?? 'Add generated video')

  const total = getTotalFrames(project.clips)
  if (total > 0) result.range = { startFrame: 0, endFrame: total }
  return result
}
