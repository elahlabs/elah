import { TimelineEngine } from '@elah/core/engine'
import type { Clip, Track } from '@elah/core'
import type { GestureSnapshot } from '../types'

/**
 * A small three-lane project on a REAL engine, at 30 fps:
 *
 *   V1 (video, 60 px)      A [30, 90)   B [120, 180)
 *   V2 (video, 60 px)      (empty)
 *   Elements (60 px)       Title [30, 120)
 *
 * A has a trimmable source window (20 source frames before its in-point, 120
 * in total) so left trims have somewhere to go and somewhere to stop.
 */
export interface Fixture {
  engine: TimelineEngine
  v1: Track
  v2: Track
  elements: Track
  a: Clip
  b: Clip
  title: Clip
  /** Live clip by id (the engine's current state, not the creation-time copy). */
  clip(id: string): Clip
  /** A gesture snapshot of the engine's current project. */
  snapshot(zoom?: number, snapEnabled?: boolean): GestureSnapshot
}

export function buildFixture(): Fixture {
  const engine = new TimelineEngine({
    fps: 30,
    defaultTrackHeight: 60,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'video', name: 'V2' },
      { kind: 'elements', name: 'Elements' },
    ],
  })
  const [v1, v2, elements] = engine.getProject().tracks

  const a = engine.addClip({
    trackId: v1.id,
    type: 'video',
    name: 'A',
    src: 'a.mp4',
    startFrame: 30,
    durationFrames: 60,
  })
  engine.updateClip(a.id, v1.id, { sourceStartFrame: 20, sourceDurationFrames: 120 })

  const b = engine.addClip({
    trackId: v1.id,
    type: 'video',
    name: 'B',
    src: 'b.mp4',
    startFrame: 120,
    durationFrames: 60,
  })

  const title = engine.addClip({
    trackId: elements.id,
    type: 'text',
    name: 'Title',
    text: { content: 'Hi' },
    startFrame: 30,
    durationFrames: 90,
  })

  const clip = (id: string): Clip => {
    const found = engine.findClip(id)
    if (!found) throw new Error(`fixture: clip ${id} not found`)
    return found.clip
  }

  return {
    engine,
    v1,
    v2,
    elements,
    a: clip(a.id),
    b,
    title,
    clip,
    snapshot: (zoom = 4, snapEnabled = true) => {
      const project = engine.getProject()
      return { tracks: project.tracks, clips: project.clips, zoom, snapEnabled }
    },
  }
}
