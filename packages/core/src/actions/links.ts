/**
 * Linked clips (PV-T1): helpers over `Clip.linkId` for the timeline's linked
 * selection and for splitting a group as one.
 */

import type { Project } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import type { ActionResult } from './types'

/**
 * `clipIds` plus every clip linked to any of them. The given ids come first
 * in their own order, then partners in track order and start frame, each id
 * once. Unknown ids are dropped.
 */
export function expandLinked(project: Project, clipIds: Iterable<string>): string[] {
  const all = project.tracks
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((t) => project.clips[t.id] ?? [])
  const byId = new Map(all.map((c) => [c.id, c]))

  const out: string[] = []
  const seen = new Set<string>()
  const links = new Set<string>()
  for (const id of clipIds) {
    const clip = byId.get(id)
    if (!clip || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (clip.linkId) links.add(clip.linkId)
  }
  for (const clip of all) {
    if (clip.linkId && links.has(clip.linkId) && !seen.has(clip.id)) {
      seen.add(clip.id)
      out.push(clip.id)
    }
  }
  return out
}

/**
 * Split a clip's whole link group at `atFrame`, as one undo step. Every
 * member strictly containing the frame is split; the left halves stay in
 * the original group and the right halves become a new group of their own,
 * so the two sides of the cut stay linked side to side.
 */
export function splitLinked(
  engine: TimelineEngine,
  clipId: string,
  atFrame: number,
): ActionResult<{ left: string[]; right: string[] }> {
  const group = engine.getLinked(clipId)
  if (group.length === 0) return { ok: false, reason: 'clip-not-found' }
  const f = Math.round(atFrame)
  const members = group.filter((c) => f > c.startFrame && f < c.startFrame + c.durationFrames)
  if (members.length === 0) return { ok: false, reason: 'playhead-outside-clip' }
  if (members.some((c) => engine.isTrackLocked(c.trackId))) return { ok: false, reason: 'track-locked' }

  const left: string[] = []
  const right: string[] = []
  engine.batch(() => {
    for (const c of members) {
      const parts = engine.splitClip(c.id, c.trackId, f)
      if (!parts) continue
      left.push(parts[0])
      right.push(parts[1])
    }
    if (right.length >= 2) engine.linkClips(right)
  }, 'Split clips')
  if (right.length === 0) return { ok: false, reason: 'engine-rejected' }
  return { ok: true, data: { left, right } }
}
