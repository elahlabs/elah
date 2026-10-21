/**
 * Compound clips: a clip whose picture is a nested timeline (PV-P1).
 *
 * A compound holds its project BY VALUE, so a document with compounds is
 * self-contained - nothing points outside itself. The engine treats a compound
 * like media for length purposes: the nested timeline's length is the compound's
 * source length, which is what makes trims and split halves stop at its end
 * (the PV-T5-1 rules apply without knowing the type).
 *
 * Nothing here touches an engine or a DOM. `flattenAudioClips` is pure so the
 * export mix and any future stem renderer can agree on what is audible.
 */

import { getTotalFrames } from '../utils/frames'
import { hasTimeRemap } from '../resolver/sourceTime'
import { generateId } from '../utils/id'
import { documentVersionFor } from '../editor/projectDocument'
import { MAX_COMPOUND_DEPTH, type Clip, type ClipKeyframes, type Project, type Track, type TrackGroup, type Transform, type Transition } from '../types'
import { createClip } from './base'

/** Length of a nested timeline in frames; at least 1. */
export function compoundLength(project: Pick<Project, 'clips'>): number {
  return Math.max(1, getTotalFrames(project.clips))
}

export interface CreateCompoundClipOptions {
  trackId: string
  startFrame: number
  project: Project
  /** Default: the nested timeline's whole length. */
  durationFrames?: number
  /** Default: 'Compound'. */
  name?: string
  transform?: Transform
}

/**
 * A compound clip showing `project` from its first frame.
 *
 * Pure: it adds nothing to any engine, so a caller can build one and decide
 * later whether to commit it.
 */
export function createCompoundClip(opts: CreateCompoundClipOptions): Clip {
  return createClip({
    type: 'compound',
    trackId: opts.trackId,
    name: opts.name ?? 'Compound',
    startFrame: opts.startFrame,
    durationFrames: opts.durationFrames ?? compoundLength(opts.project),
    compound: { project: opts.project },
    ...(opts.transform ? { transform: opts.transform } : {}),
  })
}

/** One audible audio clip, wherever it sits (PV-P1). */
export interface FlatAudioClip {
  /**
   * The clip, positioned in its OWN project's frames. A top-level clip is the
   * document's object itself. A nested clip is a copy cut to the part its
   * compounds show (`startFrame`, `sourceStartFrame`, `durationFrames`
   * adjusted) with `volume` multiplied by every ancestor compound's `volume`
   * and every ancestor compound's track `volume`. Its own track's volume is
   * NOT folded in: the consumer applies `track.volume` itself.
   */
  clip: Clip
  /** The clip's own track (in its own project). */
  track: Track
  /** Add to `clip.startFrame` to get the absolute timeline frame. 0 at top level. */
  offsetFrames: number
  /** Ids of the compound clips that contain it, outermost first. [] at top level. */
  parentChain: string[]
  /** Nested-only metadata for P10a; not serialized into the Project. */
  automation?: { originalClip: Clip; localFrameOffset: number; ancestorGain: number }
}

interface Window {
  start: number
  end: number
}

/**
 * A clip the export mix can play: an `audio` clip, or a merged video clip
 * (`embeddedAudio === true`, the sound its own file carries) - either way with
 * a `src`. A video clip without the flag stays silent, which is what keeps a
 * legacy video + separate audio pair from being mixed twice. A time-remapped
 * merged clip is silent too, exactly as in the preview (`resolveTimeline`).
 * One predicate for collection (`flattenAudioClips`) and the mix.
 */
export function isMixableAudioClip(clip: Clip): boolean {
  if (!clip.src) return false
  if (clip.type === 'audio') return true
  return clip.type === 'video' && clip.embeddedAudio === true && !hasTimeRemap(clip)
}

/**
 * Every audio clip the export mix should play, through compounds (PV-P1).
 *
 * Order is `Object.values(project.clips).flat()` order, a compound's audio
 * listed where the compound is, so a flat project returns exactly what the old
 * top-level filter produced - PV-P1b-2 relies on that.
 *
 * Excluded exactly as the mix excluded them before: disabled clips, clips
 * without `src`, muted or disabled tracks, at every level. Audio inside a
 * compound with `speed !== 1` or a time remap is excluded too, because v1 nested
 * audio does not follow a retimed compound - and the preview does the same, so
 * what you hear matches what you export.
 *
 * `onSkippedCompound` is called once per retimed ancestor whose audio is dropped,
 * which is how the export reports it rather than losing it quietly. It is optional
 * and additive: every existing caller passes one argument and is unaffected.
 */
export function flattenAudioClips(project: Project, onSkippedCompound?: (clipId: string) => void): FlatAudioClip[] {
  const out: FlatAudioClip[] = []
  walk(project, 0, [], null, 1, out, onSkippedCompound)
  return out
}

function walk(
  p: Project,
  offset: number,
  chain: string[],
  span: Window | null,
  gain: number,
  out: FlatAudioClip[],
  onSkippedCompound?: (clipId: string) => void,
): void {
  for (const list of Object.values(p.clips)) {
    for (const clip of list) {
      if (clip.disabled) continue
      const track = p.tracks.find((t) => t.id === clip.trackId)
      if (!track || track.muted || track.disabled) continue

      if (isMixableAudioClip(clip)) {
        // The flat, un-nested case: hand back the stored object itself rather
        // than a copy, so existing consumers keep object identity.
        if (span === null && gain === 1) {
          out.push({ clip, track, offsetFrames: offset, parentChain: chain })
          continue
        }
        const absStart = clip.startFrame + offset
        const absEnd = absStart + clip.durationFrames
        const start = Math.max(absStart, span!.start)
        const end = Math.min(absEnd, span!.end)
        if (end <= start) continue
        const head = start - absStart
        const copy: Clip = {
          ...clip,
          startFrame: clip.startFrame + head,
          // Speed maps timeline frames to source frames, so a head of N frames
          // consumes N * speed of the source.
          sourceStartFrame: clip.sourceStartFrame + head * (clip.speed ?? 1),
          durationFrames: end - start,
        }
        if (gain !== 1) copy.volume = (clip.volume ?? 1) * gain
        out.push({
          clip: copy,
          track,
          offsetFrames: offset,
          parentChain: chain,
          automation: { originalClip: clip, localFrameOffset: head, ancestorGain: gain },
        })
        continue
      }

      if (clip.type === 'compound' && clip.compound && chain.length < MAX_COMPOUND_DEPTH) {
        // Same rule as the preview: a retimed compound's audio is not offered.
        if ((clip.speed ?? 1) !== 1 || hasTimeRemap(clip)) {
          // PV-P1b-2: tell the caller which ancestor was dropped, so the export
          // can say "one issue per skipped ancestor" instead of silently losing
          // audio. The retime rule stays HERE rather than being re-tested in the
          // mix, because a second copy of this predicate is how preview and
          // export would come to disagree about what is audible.
          onSkippedCompound?.(clip.id)
          continue
        }
        const cStart = clip.startFrame + offset
        const cEnd = cStart + clip.durationFrames
        const w: Window = span
          ? { start: Math.max(span.start, cStart), end: Math.min(span.end, cEnd) }
          : { start: cStart, end: cEnd }
        if (w.end <= w.start) continue
        walk(
          clip.compound.project,
          // The compound shows its nested frame `sourceStartFrame` at its own
          // first frame, so that is what offsets the nested timeline.
          offset + clip.startFrame - clip.sourceStartFrame,
          [...chain, clip.id],
          w,
          gain * (clip.volume ?? 1) * (track.volume ?? 1),
          out,
          onSkippedCompound,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Editing: nest and unnest
// ---------------------------------------------------------------------------

/**
 * Why a nest or unnest was refused.
 *
 * A code for a caller to branch on and a `message` a user can be shown. Nest and
 * unnest refuse rather than approximate: a compound that quietly lost a matte, a
 * link or a transform would look right until the moment it was opened, which is
 * the one moment the user cannot check anything.
 */
export type CompoundEditErrorCode =
  | 'empty-selection'
  | 'clip-not-found'
  | 'not-a-compound'
  | 'track-locked'
  | 'track-disabled'
  | 'adjustment-clip'
  | 'crossing-transition'
  | 'crossing-matte'
  | 'crossing-link'
  | 'non-contiguous'
  | 'too-deep'
  | 'overlap'
  | 'not-lossless'

export interface CompoundEditError {
  code: CompoundEditErrorCode
  /** What a user is shown. */
  message: string
}

export type CompoundEditResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CompoundEditError }

function refuse<T>(code: CompoundEditErrorCode, message: string): CompoundEditResult<T> {
  return { ok: false, error: { code, message } }
}

/** A track kind that carries a picture, i.e. anything a compound stands in for. */
function isVisualTrack(track: Track): boolean {
  return track.kind === 'video' || track.kind === 'elements'
}

/** Where a clip sits, resolved once so the rules below read as plain data. */
interface Placement {
  clip: Clip
  track: Track
}

/** Every clip in the project, with the track it is on. */
function allPlacements(project: Project): Placement[] {
  const out: Placement[] = []
  for (const track of project.tracks) {
    for (const clip of project.clips[track.id] ?? []) out.push({ clip, track })
  }
  return out
}

/**
 * How many compound levels a clip's own subtree holds, itself included. 0 for
 * anything that is not a compound.
 */
function compoundSubtreeLevels(clip: Clip): number {
  if (clip.type !== 'compound' || !clip.compound) return 0
  let deepest = 0
  for (const nested of allPlacements(clip.compound.project)) {
    deepest = Math.max(deepest, compoundSubtreeLevels(nested.clip))
  }
  return 1 + deepest
}

/** Whether a clip carries any keyframe at all. */
function hasKeyframes(keyframes: ClipKeyframes | undefined): boolean {
  if (!keyframes?.channels) return false
  return Object.values(keyframes.channels).some((channel) => (channel?.keys.length ?? 0) > 0)
}

/** The one message every unnest refusal shares, because they are all one mistake. */
const RESET_BEFORE_UNNEST = 'Reset compound transforms and trim before unnesting'

function notLossless(detail: string): CompoundEditResult<never> {
  return refuse('not-lossless', `${RESET_BEFORE_UNNEST} (${detail})`)
}

export interface NestOptions {
  /** Name for the compound clip. Default 'Compound'. */
  name?: string
}

export interface NestResult {
  project: Project
  compoundId: string
}

/**
 * Replace a set of clips with one compound clip holding them as a nested
 * timeline. Pure: `project` is not touched, and every id the child keeps is one
 * it already had.
 *
 * The interval is the selection's own extent - `start` is the earliest start and
 * the compound runs to the latest end - and everything inside the child is
 * expressed relative to `start`, so the nested timeline starts at frame 0 the
 * way an authored one does. Clip-local time (source starts, keyframes, speed) is
 * never shifted: those describe the media, not the timeline.
 *
 * Nothing else on the timeline moves. A nest re-parents the selection; it is not
 * an edit to the rest of the document, so magnetic mode has nothing to ripple and
 * no unselected start frame changes.
 */
export function nestProject(
  project: Project,
  clipIds: Iterable<string>,
  options: NestOptions = {},
): CompoundEditResult<NestResult> {
  const ids = [...new Set(clipIds)]
  if (ids.length === 0) {
    return refuse('empty-selection', 'Select at least one clip to nest')
  }

  const everything = allPlacements(project)
  const selected: Placement[] = []
  for (const id of ids) {
    const found = everything.find((p) => p.clip.id === id)
    if (!found) return refuse('clip-not-found', `No clip "${id}" in this timeline`)
    selected.push(found)
  }

  const wanted = new Set(ids)

  for (const { clip, track } of selected) {
    if (track.locked) {
      return refuse('track-locked', `"${track.name}" is locked; unlock it to nest its clips`)
    }
    if (track.disabled) {
      return refuse('track-disabled', `"${track.name}" is hidden; a compound cannot hold a hidden lane`)
    }
    if (clip.type === 'adjustment') {
      return refuse(
        'adjustment-clip',
        'An adjustment applies to everything below it, which a nested timeline cannot express',
      )
    }
    // The new child project sits one level down, so a compound already
    // MAX_COMPOUND_DEPTH levels deep would push past the limit.
    const levels = compoundSubtreeLevels(clip)
    if (levels > 0 && 1 + levels > MAX_COMPOUND_DEPTH) {
      return refuse(
        'too-deep',
        `A compound nested ${levels} deep cannot go inside another one; the limit is ${MAX_COMPOUND_DEPTH}`,
      )
    }
  }

  // A transition, matte or link that reaches outside the selection cannot be
  // represented inside a nested timeline: its other end would have to be a clip
  // the child does not have.
  for (const tr of project.transitions) {
    if (wanted.has(tr.fromClipId) !== wanted.has(tr.toClipId)) {
      return refuse(
        'crossing-transition',
        'A transition joins a selected clip to one that is not selected',
      )
    }
  }
  for (const { clip } of everything) {
    const source = clip.matte?.sourceClipId
    if (source && wanted.has(source) && !wanted.has(clip.id)) {
      return refuse(
        'crossing-matte',
        `"${clip.name}" uses a selected clip as its matte; select it too, or the matte is lost`,
      )
    }
  }
  for (const { clip } of selected) {
    if (!clip.linkId) continue
    for (const other of everything) {
      if (other.clip.linkId === clip.linkId && !wanted.has(other.clip.id)) {
        return refuse('crossing-link', `"${clip.name}" is linked to a clip that is not selected`)
      }
    }
  }

  // A compound is one picture in one place on the stack, so a lane holding
  // unselected clips between two selected lanes would have to come along or be
  // left behind - and leaving it behind silently reorders the result.
  const visualOrders = selected
    .map((p) => (isVisualTrack(p.track) ? p.track.order : null))
    .filter((o): o is number => o !== null)
  if (visualOrders.length > 0) {
    const top = Math.max(...visualOrders)
    const bottom = Math.min(...visualOrders)
    for (const track of project.tracks) {
      if (!isVisualTrack(track) || track.order <= bottom || track.order >= top) continue
      if ((project.clips[track.id] ?? []).some((c) => !wanted.has(c.id))) {
        return refuse(
          'non-contiguous',
          `"${track.name}" sits between the selected lanes and holds clips that are not selected`,
        )
      }
    }
  }

  // --- The interval ---------------------------------------------------------
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const { clip } of selected) {
    start = Math.min(start, clip.startFrame)
    end = Math.max(end, clip.startFrame + clip.durationFrames)
  }
  const duration = Math.max(1, end - start)

  // --- The child project ----------------------------------------------------
  const usedTrackIds = new Set(selected.map((p) => p.track.id))
  const childTracks = project.tracks.filter((t) => usedTrackIds.has(t.id))
  const childClips: Record<string, Clip[]> = {}
  for (const track of childTracks) {
    childClips[track.id] = selected
      .filter((p) => p.track.id === track.id)
      .map((p) => ({ ...p.clip, startFrame: p.clip.startFrame - start }))
      .sort((a, b) => a.startFrame - b.startFrame)
  }
  const isInternal = (tr: Transition): boolean =>
    wanted.has(tr.fromClipId) && wanted.has(tr.toClipId) && usedTrackIds.has(tr.trackId)
  const childTransitions = project.transitions
    .filter(isInternal)
    .map((tr) => ({ ...tr, startFrame: tr.startFrame - start }))
  // A group is either wholly inside the child or it stays whole in the parent;
  // half a group is not a thing.
  const childGroups = (project.trackGroups ?? []).filter((g) =>
    g.trackIds.every((id) => usedTrackIds.has(id)),
  )

  const child: Project = {
    id: generateId(),
    fps: project.fps,
    // The same stage, so the compound's default image-like placement is identity
    // and a nest changes nothing about how the picture looks.
    stage: { ...project.stage },
    tracks: childTracks.map((t) => ({ ...t })),
    clips: childClips,
    transitions: childTransitions,
    version: 4,
    ...(childGroups.length > 0 ? { trackGroups: childGroups.map((g) => ({ ...g })) } : {}),
  }

  // --- Where the compound goes ----------------------------------------------
  // The topmost selected visual lane is where the selection composited, so that
  // is where its replacement belongs.
  const visualSelected = selected.filter((p) => isVisualTrack(p.track))
  let tracks = project.tracks
  let destinationId: string
  if (visualSelected.length > 0) {
    destinationId = visualSelected.reduce((a, b) => (a.track.order >= b.track.order ? a : b)).track.id
  } else {
    // Audio only: a compound is a picture, so it needs a video lane at the
    // matching stack position - the topmost selected audio lane's own order.
    const order = Math.max(...selected.map((p) => p.track.order))
    const id = generateId()
    tracks = project.tracks.map((t) => (t.order >= order ? { ...t, order: t.order + 1 } : t))
    tracks.push({
      id,
      name: 'Track 1',
      kind: 'video',
      order,
      height: 54,
      locked: false,
      disabled: false,
      muted: false,
      solo: false,
      volume: 1,
      protected: false,
    })
    tracks.sort((a, b) => a.order - b.order)
    destinationId = id
  }

  const destination = tracks.find((t) => t.id === destinationId)!
  const collides = (project.clips[destinationId] ?? [])
    .filter((c) => !wanted.has(c.id))
    .some((c) => c.startFrame < start + duration && start < c.startFrame + c.durationFrames)
  if (collides) {
    return refuse(
      'overlap',
      `"${destination.name}" already has a clip there; the compound would overlap it`,
    )
  }

  const compound = createCompoundClip({
    trackId: destinationId,
    startFrame: start,
    durationFrames: duration,
    project: child,
    ...(options.name ? { name: options.name } : {}),
  })

  // --- The parent -----------------------------------------------------------
  const clips: Record<string, Clip[]> = {}
  for (const track of tracks) {
    const source = project.clips[track.id]
    const kept = source === undefined ? [] : source.filter((c) => !wanted.has(c.id))
    clips[track.id] =
      track.id === destinationId
        ? [...kept, compound as Clip].sort((a, b) => a.startFrame - b.startFrame)
        : kept
  }

  const next: Project = {
    ...project,
    tracks,
    clips,
    transitions: project.transitions.filter((tr) => !isInternal(tr)),
    // A document holding a compound is version 4. Stamped here as well as in the
    // engine's commit so the pure result is a readable document on its own.
    version: Math.max(project.version, 4),
  }
  const keptGroups = (project.trackGroups ?? []).filter(
    (g) => !g.trackIds.every((id) => usedTrackIds.has(id)),
  )
  if (keptGroups.length > 0) next.trackGroups = keptGroups
  else delete next.trackGroups

  return { ok: true, data: { project: next, compoundId: compound.id } }
}

export interface UnnestResult {
  project: Project
  /** The restored clips, in nested track order then by start frame. */
  clipIds: string[]
}

/**
 * Put a compound's clips back on the parent timeline and remove the compound.
 * Pure: `project` is not touched, and every restored object gets a fresh id.
 *
 * **v1 is lossless or it refuses.** A compound that has been moved, scaled,
 * trimmed, retimed, faded or given effects carries state that exists only in the
 * compound, and restoring its clips would drop it silently. Baking a transform
 * into a nested timeline is real work and a separate design, so each of those is
 * a refusal with a message rather than a best-effort edit. What does survive is
 * the whole timeline: frame occupancy, relative z order, source times,
 * keyframes, links, transitions and groups.
 */
export function unnestProject(
  project: Project,
  compoundId: string,
): CompoundEditResult<UnnestResult> {
  const found = allPlacements(project).find((p) => p.clip.id === compoundId)
  if (!found) return refuse('clip-not-found', `No clip "${compoundId}" in this timeline`)
  const clip = found.clip
  if (clip.type !== 'compound' || !clip.compound) {
    return refuse('not-a-compound', 'Only a compound clip can be un-nested')
  }

  if (clip.transform) return notLossless('it is moved or scaled')
  if (clip.opacity !== undefined && clip.opacity !== 1) return notLossless('its opacity is not 1')
  if (clip.volume !== undefined && clip.volume !== 1) return notLossless('its volume is not 1')
  if (clip.cornerRadius !== undefined && clip.cornerRadius !== 0) {
    return notLossless('its corners are rounded')
  }
  if (clip.crop) return notLossless('it is cropped')
  if (clip.effects && clip.effects.length > 0) return notLossless('it has effects')
  if (clip.mask) return notLossless('it has a mask')
  if (clip.matte) return notLossless('it has a matte')
  if (hasKeyframes(clip.keyframes)) return notLossless('it has keyframes')
  if (hasTimeRemap(clip)) return notLossless('it is time-remapped')
  if ((clip.speed ?? 1) !== 1) return notLossless('its speed is not 1')

  const child = clip.compound.project
  // Untrimmed and whole: the compound shows the nested timeline from its first
  // frame to its last, which is the only case where putting the clips back means
  // the same picture.
  if (clip.sourceStartFrame !== 0) return notLossless('its in point is not the nested first frame')
  if (
    clip.sourceDurationFrames !== undefined &&
    clip.sourceDurationFrames !== clip.durationFrames
  ) {
    return notLossless('it is trimmed')
  }
  if (clip.durationFrames !== compoundLength(child)) return notLossless('it is trimmed')
  if (child.fps !== project.fps) return notLossless('the nested frame rate differs')
  if (child.stage.width !== project.stage.width || child.stage.height !== project.stage.height) {
    return notLossless('the nested stage size differs')
  }

  // --- Fresh ids ------------------------------------------------------------
  // A restored clip must not collide with anything already in the parent, which
  // includes the compound's own id and every id an earlier un-nest minted.
  const trackIdById = new Map<string, string>()
  const nested = [...child.tracks].sort((a, b) => a.order - b.order)
  const restoredTracks: Track[] = nested.map((t) => {
    const id = generateId()
    trackIdById.set(t.id, id)
    return { ...t, id }
  })

  const clipIdById = new Map<string, string>()
  const linkIdById = new Map<string, string>()
  for (const list of Object.values(child.clips)) {
    for (const c of list) {
      clipIdById.set(c.id, generateId())
      if (c.linkId && !linkIdById.has(c.linkId)) linkIdById.set(c.linkId, generateId())
    }
  }

  // --- The restored lanes ----------------------------------------------------
  // At the compound's own compositing position, so everything above or below it
  // keeps its relative order. Every track is COPIED, never mutated: the input
  // project has to come back out of a pure function unchanged.
  const at = found.track.order
  const offset = clip.startFrame
  const shift = restoredTracks.length
  const tracks = project.tracks.map((t) => ({
    ...t,
    order: t.order >= at ? t.order + shift : t.order,
  }))
  restoredTracks.forEach((t, index) => {
    tracks.push({ ...t, order: at + index })
  })
  tracks.sort((a, b) => a.order - b.order)

  const restored: Array<{ trackId: string; clip: Clip }> = []
  for (const source of nested) {
    const trackId = trackIdById.get(source.id)!
    const list = [...(child.clips[source.id] ?? [])].sort((a, b) => a.startFrame - b.startFrame)
    for (const c of list) {
      const next: Clip = {
        ...c,
        id: clipIdById.get(c.id)!,
        trackId,
        // Only the position on the parent timeline moves. Clip-local time -
        // source starts, keyframes, speed - belongs to the media, not the
        // timeline, and is never shifted.
        startFrame: c.startFrame + offset,
      }
      if (c.linkId) next.linkId = linkIdById.get(c.linkId)!
      // A disabled compound showed nothing; its clips must not appear either.
      if (clip.disabled) next.disabled = true
      restored.push({ trackId, clip: next })
    }
  }

  const clips: Record<string, Clip[]> = {}
  for (const track of tracks) {
    const source = project.clips[track.id]
    clips[track.id] =
      source === undefined
        ? []
        : track.id === found.track.id
          ? source.filter((c) => c.id !== compoundId)
          : [...source]
  }
  for (const { trackId, clip: c } of restored) {
    clips[trackId] = [...(clips[trackId] ?? []), c].sort((a, b) => a.startFrame - b.startFrame)
  }

  const transitions: Transition[] = [
    // Whatever the parent had that pointed at the compound is now orphaned.
    ...project.transitions.filter((tr) => tr.fromClipId !== compoundId && tr.toClipId !== compoundId),
    ...child.transitions.map((tr) => ({
      ...tr,
      id: generateId(),
      fromClipId: clipIdById.get(tr.fromClipId) ?? tr.fromClipId,
      toClipId: clipIdById.get(tr.toClipId) ?? tr.toClipId,
      trackId: trackIdById.get(tr.trackId) ?? tr.trackId,
      startFrame: tr.startFrame + offset,
    })),
  ]

  const trackGroups: TrackGroup[] = [
    ...(project.trackGroups ?? []),
    ...(child.trackGroups ?? []).map((g) => ({
      ...g,
      id: generateId(),
      trackIds: g.trackIds.map((id) => trackIdById.get(id) ?? id),
    })),
  ]

  const next: Project = {
    ...project,
    tracks,
    clips,
    transitions,
    // The compound is gone, so the stamp drops back to whatever the rest of the
    // document needs.
    version: documentVersionFor({ clips, transitions }),
    ...(trackGroups.length > 0 ? { trackGroups } : {}),
  }
  if (trackGroups.length === 0) delete next.trackGroups

  return { ok: true, data: { project: next, clipIds: restored.map((r) => r.clip.id) } }
}
