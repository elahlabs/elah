/**
 * FrameSequence → Project.
 *
 * The bridge that makes a frame sequence editable media rather than a dead
 * image strip: every frame becomes an image clip laid end to end on one track,
 * so the result loads into `TimelineEngine.loadProject()` and can be trimmed,
 * split, reordered, transitioned and exported like any other composition.
 *
 * Pure — it builds a `Project` and touches no engine, no store, no DOM.
 */

import type { Clip, Project, Track } from '../types'
import { createImageClip } from '../elements/image'
import { generateId } from '../utils/id'
import type { FrameSequence } from './frameSequence'

export interface FrameSequenceToProjectOptions {
  /** Project fps. Defaults to the sequence's own fps. */
  fps?: number
  /**
   * Timeline frames each sequence frame occupies. 1 (the default) makes
   * timeline time and sequence index the same number, which is what a scrubbed
   * 360° viewer wants. Raise it to hold each angle on screen longer — e.g. 6
   * turns a 36-frame orbit into a 7.2s slideshow at 30fps.
   */
  holdFrames?: number
  /** Output canvas. Defaults to 1920×1080. */
  stage?: { width: number; height: number }
  trackName?: string
  projectId?: string
}

const DEFAULT_STAGE = { width: 1920, height: 1080 }

/**
 * Build a single-track `Project` from a sequence.
 *
 * @example
 * ```ts
 * engine.loadProject(frameSequenceToProject(orbit, { holdFrames: 1 }))
 * ```
 */
export function frameSequenceToProject(
  sequence: FrameSequence,
  options: FrameSequenceToProjectOptions = {},
): Project {
  const holdFrames = Math.max(1, Math.round(options.holdFrames ?? 1))
  const trackId = generateId()

  const track: Track = {
    id: trackId,
    name: options.trackName ?? sequence.label ?? 'Frame sequence',
    kind: 'video',
    order: 0,
    height: 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
  }

  const clips: Clip[] = sequence.frames.map((frame, i) =>
    createImageClip({
      trackId,
      name: frame.id,
      startFrame: i * holdFrames,
      durationFrames: holdFrames,
      src: frame.src,
    }),
  )

  return {
    id: options.projectId ?? generateId(),
    fps: options.fps ?? sequence.fps,
    stage: options.stage ?? DEFAULT_STAGE,
    tracks: [track],
    clips: { [trackId]: clips },
    transitions: [],
    version: 1,
  }
}
