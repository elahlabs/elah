import { TimelineEngine } from '@elah/core'
import { CliError } from '../lib/errors'
import { parseFramePosition } from '../lib/timecode'
import { readProject, writeProject, findClipTrack } from '../lib/project-io'

export interface SplitArgs {
  project: string
  clip: string
  at: string
  out?: string
}

export function runSplit(args: SplitArgs): void {
  const { project } = readProject(args.project)
  const { clip, trackId } = findClipTrack(project, args.clip)
  const atFrame = parseFramePosition(args.at, project.fps)

  const engine = new TimelineEngine({ fps: project.fps })
  engine.loadProject(project)

  const result = engine.splitClip(args.clip, trackId, atFrame)
  if (!result) {
    const end = clip.startFrame + clip.durationFrames
    throw new CliError(
      `Cannot split clip '${args.clip}' at frame ${atFrame}: the split point must fall strictly inside ` +
        `the clip (frames ${clip.startFrame + 1}–${end - 1}) and the track must be unlocked.`
    )
  }

  const [leftId, rightId] = result
  writeProject(engine.getProject(), args.out)
  process.stderr.write(`split clip '${args.clip}' at frame ${atFrame} → '${leftId}' + '${rightId}'\n`)
}
