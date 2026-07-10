import { TimelineEngine } from '@elah/core'
import { CliError, usageError } from '../lib/errors'
import { parseFramePosition } from '../lib/timecode'
import { readProject, writeProject, findClipTrack } from '../lib/project-io'
import { requireUnlockedTrack } from './split'

export interface TrimArgs {
  project: string
  clip: string
  start?: string
  duration?: string
  out?: string
}

export function runTrim(args: TrimArgs): void {
  if (args.start === undefined && args.duration === undefined) {
    throw usageError('trim requires at least one of --start or --duration')
  }

  const { project } = readProject(args.project)
  const { clip, trackId } = findClipTrack(project, args.clip)

  const startFrame =
    args.start !== undefined ? parseFramePosition(args.start, project.fps) : clip.startFrame
  const durationFrames =
    args.duration !== undefined ? parseFramePosition(args.duration, project.fps) : clip.durationFrames

  if (durationFrames < 1) throw usageError('--duration must be at least 1 frame')

  requireUnlockedTrack(project, trackId)

  const engine = new TimelineEngine({ fps: project.fps })
  engine.loadProject(project)
  engine.trimClip(args.clip, trackId, startFrame, durationFrames)

  const after = engine.getProject().clips[trackId]?.find((c) => c.id === args.clip)
  if (!after) throw new CliError(`Clip '${args.clip}' disappeared during trim — this is a bug`)

  const requestedChange = startFrame !== clip.startFrame || durationFrames !== clip.durationFrames
  const changed = after.startFrame !== clip.startFrame || after.durationFrames !== clip.durationFrames
  if (requestedChange && !changed) {
    // trimClip commits nothing in two cases we cannot distinguish from out here:
    // the trimmed range overlaps a neighbouring clip, or the engine clamped the
    // request back to exactly the current values (source-bounds limits).
    throw new CliError(
      `Trim of clip '${args.clip}' to start=${startFrame} duration=${durationFrames} did not apply: ` +
        `it would overlap a neighbouring clip, or the source bounds clamp the edit back to the ` +
        `current values (start=${clip.startFrame} duration=${clip.durationFrames}).`
    )
  }

  writeProject(engine.getProject(), args.out)
  if (after.startFrame !== startFrame || after.durationFrames !== durationFrames) {
    process.stderr.write(
      `note: trim was clamped by source bounds → start=${after.startFrame} duration=${after.durationFrames}\n`
    )
  }
  process.stderr.write(
    `trimmed clip '${args.clip}' → start=${after.startFrame} duration=${after.durationFrames}\n`
  )
}
