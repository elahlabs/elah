import { TimelineEngine, type Project } from '@elah/core'
import { CliError } from '../lib/errors'
import { parseFramePosition } from '../lib/timecode'
import { readProject, writeProject, findClipTrack } from '../lib/project-io'

/** The engine silently ignores edits on locked tracks — fail with the real reason instead. */
export function requireUnlockedTrack(project: Project, trackId: string): void {
  const track = project.tracks.find((t) => t.id === trackId)
  if (track?.locked) {
    throw new CliError(`Track '${track.name}' (${trackId}) is locked — unlock it to edit its clips.`)
  }
}

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

  requireUnlockedTrack(project, trackId)

  const engine = new TimelineEngine({ fps: project.fps })
  engine.loadProject(project)

  const result = engine.splitClip(args.clip, trackId, atFrame)
  if (!result) {
    const end = clip.startFrame + clip.durationFrames
    throw new CliError(
      `Cannot split clip '${args.clip}' at frame ${atFrame}: the split point must fall strictly inside ` +
        `the clip (frames ${clip.startFrame + 1}–${end - 1}).`
    )
  }

  const [leftId, rightId] = result
  writeProject(engine.getProject(), args.out)
  process.stderr.write(`split clip '${args.clip}' at frame ${atFrame} → '${leftId}' + '${rightId}'\n`)
}
