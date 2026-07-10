import { TimelineEngine } from '@elah/core'
import { CliError, usageError } from '../lib/errors'
import { readProject, writeProject, findClipTrack } from '../lib/project-io'

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

  const startFrame = args.start !== undefined ? parseIntStrict(args.start, '--start') : clip.startFrame
  const durationFrames =
    args.duration !== undefined ? parseIntStrict(args.duration, '--duration') : clip.durationFrames

  if (durationFrames < 1) throw usageError('--duration must be at least 1 frame')
  if (startFrame < 0) throw usageError('--start must be >= 0')

  const engine = new TimelineEngine({ fps: project.fps })
  engine.loadProject(project)
  engine.trimClip(args.clip, trackId, startFrame, durationFrames)

  const after = engine.getProject().clips[trackId]?.find((c) => c.id === args.clip)
  if (!after) throw new CliError(`Clip '${args.clip}' disappeared during trim — this is a bug`)

  const requestedChange = startFrame !== clip.startFrame || durationFrames !== clip.durationFrames
  const changed = after.startFrame !== clip.startFrame || after.durationFrames !== clip.durationFrames
  if (requestedChange && !changed) {
    // trimClip rejects silently on overlap or locked track — surface that as a real error
    throw new CliError(
      `Trim of clip '${args.clip}' to start=${startFrame} duration=${durationFrames} was rejected: ` +
        `it would overlap a neighbouring clip, or the track is locked.`
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

function parseIntStrict(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw usageError(`${flag} expects a non-negative integer frame count`)
  return Number(value)
}
