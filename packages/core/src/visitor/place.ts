import { current, isDraft, type Draft } from 'immer'
import type { Clip, Project } from '../types'
import { generateId } from '../utils/id'
import { toFrame } from '../utils/frames'
import { insertGap, overwriteRange } from './overwrite'
import { pruneOrphanedTransitions } from './remove'

/**
 * Placing clips (PV-T1): the one edit behind a timeline drag, a paste, a
 * duplicate and an agent's move. Several clips, possibly on several tracks,
 * land at once with their offsets preserved, as one commit or not at all.
 */

/** Where one clip should end up. */
export interface ClipPlacement {
  clipId: string
  toTrackId: string
  /** Absolute timeline frame of the clip's new start. */
  startFrame: number
}

/**
 * What happens to clips already where the placed ones land:
 * - `reject` — nothing; the placement fails if anything is in the way
 *   (today's `moveClip` rule, applied to the whole set at once);
 * - `overwrite` — the landing ranges are cleared (Premiere's default drag);
 * - `insert` — later clips on each target track move right to make room
 *   (Premiere's Ctrl-drag).
 */
export type PlacementMode = 'reject' | 'overwrite' | 'insert'

export interface PlaceOptions {
  mode?: PlacementMode
  /** Place copies with fresh ids and leave the originals where they are. */
  copy?: boolean
}

export type PlacementFailure =
  | 'no-moves'
  | 'clip-not-found'
  | 'track-not-found'
  | 'track-locked'
  | 'duplicate-clip'
  | 'overlap'

/** Thrown inside the draft so the whole commit is abandoned; never escapes the engine. */
export class PlacementRejected extends Error {
  readonly reason: PlacementFailure
  constructor(reason: PlacementFailure) {
    super(`Placement rejected: ${reason}`)
    this.name = 'PlacementRejected'
    this.reason = reason
  }
}

interface Item {
  /** The draft clip for a move; a plain snapshot for a copy. */
  clip: Draft<Clip> | Clip
  fromTrackId: string
  toTrackId: string
  start: number
  duration: number
  delta: number
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Run a placement against a draft. Returns the ids of the clips as placed
 * (the originals for a move, the new copies for a copy), in `moves` order.
 *
 * @throws {PlacementRejected} when it cannot run; the draft is then discarded
 * by the caller's `produce`, so nothing partial survives.
 */
export function placeClipsInDraft(
  draft: Draft<Project>,
  moves: ReadonlyArray<ClipPlacement>,
  options: PlaceOptions = {},
): string[] {
  const mode = options.mode ?? 'reject'
  const copy = options.copy === true
  if (moves.length === 0) throw new PlacementRejected('no-moves')

  const tracks = new Map(draft.tracks.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const items: Item[] = []

  for (const move of moves) {
    if (seen.has(move.clipId)) throw new PlacementRejected('duplicate-clip')
    seen.add(move.clipId)

    let fromTrackId: string | null = null
    let clip: Draft<Clip> | undefined
    for (const [trackId, list] of Object.entries(draft.clips)) {
      clip = list.find((c) => c.id === move.clipId)
      if (clip) {
        fromTrackId = trackId
        break
      }
    }
    if (!clip || fromTrackId === null) throw new PlacementRejected('clip-not-found')

    const to = tracks.get(move.toTrackId)
    if (!to) throw new PlacementRejected('track-not-found')
    // A copy only reads its source, so a locked source may be copied from.
    if (to.locked || (!copy && tracks.get(fromTrackId)?.locked)) throw new PlacementRejected('track-locked')

    const start = toFrame(move.startFrame)
    items.push({
      clip: copy ? ((isDraft(clip) ? current(clip) : clip) as Clip) : clip,
      fromTrackId,
      toTrackId: move.toTrackId,
      start,
      duration: clip.durationFrames,
      delta: start - clip.startFrame,
    })
  }

  // 1. Lift the moving clips out, so they never collide with themselves.
  if (!copy) {
    for (const item of items) {
      const list = draft.clips[item.fromTrackId]!
      const idx = list.findIndex((c) => c.id === (item.clip as Clip).id)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  // 2. The placed clips must not overlap one another on a track.
  const byTrack = new Map<string, Item[]>()
  for (const item of items) {
    const list = byTrack.get(item.toTrackId) ?? []
    list.push(item)
    byTrack.set(item.toTrackId, list)
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.start < list[i - 1]!.start + list[i - 1]!.duration) throw new PlacementRejected('overlap')
    }
  }

  // 3. Make room, or refuse.
  for (const [trackId, list] of byTrack) {
    if (!draft.clips[trackId]) draft.clips[trackId] = []
    if (mode === 'reject') {
      for (const item of list) {
        const span = { start: item.start, end: item.start + item.duration }
        const blocked = draft.clips[trackId]!.some((c) =>
          spansOverlap(span, { start: c.startFrame, end: c.startFrame + c.durationFrames }),
        )
        if (blocked) throw new PlacementRejected('overlap')
      }
    } else if (mode === 'overwrite') {
      for (const item of list) overwriteRange(draft, trackId, item.start, item.start + item.duration)
    } else {
      const at = list[0]!.start
      const end = Math.max(...list.map((i) => i.start + i.duration))
      insertGap(draft, trackId, at, end - at)
    }
  }

  // 4. Put the clips down. Copies that were linked to each other stay linked
  // to each other, under a new id; a copy of one half of a pair is unlinked.
  const linkCounts = new Map<string, number>()
  if (copy) {
    for (const item of items) {
      const link = item.clip.linkId
      if (link) linkCounts.set(link, (linkCounts.get(link) ?? 0) + 1)
    }
  }
  const relinked = new Map<string, string>()
  const placedIds: string[] = []
  const placedById = new Map<string, Item>()

  for (const item of items) {
    let clip: Draft<Clip> | Clip
    if (copy) {
      const next: Clip = { ...(item.clip as Clip), id: generateId() }
      const link = next.linkId
      if (link && (linkCounts.get(link) ?? 0) >= 2) {
        let id = relinked.get(link)
        if (!id) {
          id = generateId()
          relinked.set(link, id)
        }
        next.linkId = id
      } else {
        delete next.linkId
      }
      clip = next
    } else {
      clip = item.clip
    }
    clip.trackId = item.toTrackId
    clip.startFrame = item.start
    draft.clips[item.toTrackId]!.push(clip as Draft<Clip>)
    placedIds.push(clip.id)
    placedById.set(clip.id, item)
  }
  for (const trackId of byTrack.keys()) {
    draft.clips[trackId]!.sort((a, b) => a.startFrame - b.startFrame)
  }

  // 5. Transitions. One whose two clips moved together, by the same amount
  // onto the same track, moves with them; one whose clips now sit on
  // different tracks has nothing left to join.
  if (!copy) {
    const trackOf = new Map<string, string>()
    for (const [trackId, list] of Object.entries(draft.clips)) for (const c of list) trackOf.set(c.id, trackId)
    draft.transitions = draft.transitions.filter((t) => {
      const from = placedById.get(t.fromClipId)
      const to = placedById.get(t.toClipId)
      if (from && to && from.toTrackId === to.toTrackId && from.delta === to.delta) {
        t.startFrame += to.delta
        t.trackId = to.toTrackId
        return true
      }
      if (!from && !to) return true
      const a = trackOf.get(t.fromClipId)
      const b = trackOf.get(t.toClipId)
      return a !== undefined && a === b
    })
  }
  pruneOrphanedTransitions(draft)

  return placedIds
}
