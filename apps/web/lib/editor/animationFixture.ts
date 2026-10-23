/**
 * A synthetic project carrying one spring (PV-P5a), for `/dev/animation`.
 *
 * Pure and document-shaped on purpose: the harness must be able to show what a
 * spring LOOKS like on the real curve drawer and the real Animate panel, which
 * means the project has to be a real `Project` that `readProjectDocument` would
 * accept — not a mock the editor treats specially. The fill colour is document
 * data rather than UI chrome, so a literal is correct here.
 */

import { DEFAULT_SHAPE_TRANSFORM, sampleChannel, type Project, type SpringPresetId } from '@elah/core'
import { findSpringPreset } from '@elah/core'

export interface SpringFixtureOptions {
  preset: SpringPresetId
  /** Frames between the two keys. 60 reads; 3 is the degenerate short case. */
  span: number
}

export const SPRING_CLIP_ID = 'spring-clip'

/** One `elements` track and one shape clip whose `x` runs 0.3 → 0.7 on a spring. */
export function springFixture(opts: SpringFixtureOptions): { project: Project; clipId: string } {
  const { preset, span } = opts
  const spring = findSpringPreset(preset)!.spring
  const span2 = Math.max(1, Math.floor(span))

  const project: Project = {
    id: 'animation-harness',
    version: 1,
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [
      {
        id: 'el-1',
        name: 'Graphics',
        kind: 'elements',
        order: 0,
        height: 54,
        locked: false,
        disabled: false,
        muted: false,
        solo: false,
        volume: 1,
        protected: false,
      },
    ],
    clips: {
      'el-1': [
        {
          id: SPRING_CLIP_ID,
          trackId: 'el-1',
          type: 'shape',
          name: 'Spring',
          shapeKind: 'rect',
          shapeFill: '#4f8cff',
          shapeStroke: '#ffffff',
          shapeStrokeWidth: 0,
          startFrame: 0,
          durationFrames: span2 + 1,
          sourceStartFrame: 0,
          sourceDurationFrames: span2 + 1,
          transform: { ...DEFAULT_SHAPE_TRANSFORM },
          keyframes: {
            channels: {
              x: {
                source: { kind: 'keyframes' },
                keys: [
                  { id: 'k0', frame: 0, value: 0.3, easing: 'linear' },
                  { id: 'k1', frame: span2, value: 0.7, easing: 'linear', spring: { ...spring } },
                ],
              },
            },
          },
        },
      ],
    },
    transitions: [],
  } as unknown as Project

  return { project, clipId: SPRING_CLIP_ID }
}

/** The clip's `x` value at every frame, 0..durationFrames-1. What the drawer draws. */
export function springSamples(project: Project, clipId: string): number[] {
  const clip = Object.values(project.clips)
    .flat()
    .find((c) => c.id === clipId)
  const keys = clip?.keyframes?.channels?.x?.keys
  if (!clip || !keys) return []
  const out: number[] = []
  for (let f = 0; f < clip.durationFrames; f++) out.push(sampleChannel(keys, f) ?? Number.NaN)
  return out
}
