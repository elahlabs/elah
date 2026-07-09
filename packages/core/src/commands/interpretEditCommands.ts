import type { TimelineEngine } from '../editor/TimelineEngine'
import type { EditCommand } from './editCommand'

/**
 * Why a single command was not applied. Mirrors the tagged-failure style of
 * actions/types.ts — the interpreter never throws on an expected rejection, it
 * records a reason so the UI can explain what happened.
 */
export type EditCommandFailureReason =
  | 'clip-not-found'
  | 'track-mismatch'
  | 'track-locked'
  | 'invalid-range'
  | 'split-outside-clip'
  | 'engine-rejected'
  | 'unknown-command'

export type EditCommandResult =
  | { ok: true; command: EditCommand }
  | { ok: false; command: EditCommand; reason: EditCommandFailureReason }

/**
 * Execute AI-planned edit commands against the engine.
 *
 * The whole batch runs inside engine.batch(), so an entire AI edit — however
 * many primitive commands it expands to — collapses into ONE undo entry. A
 * command that can't be applied is reported in the returned results but does not
 * abort the batch; sibling commands still run. (The engine's own guards — locked
 * tracks, overlap, source bounds — remain the last line of defence.)
 *
 * Returns one result per input command, in order.
 */
export function interpretEditCommands(
  engine: TimelineEngine,
  commands: EditCommand[],
  description = 'AI edit',
): EditCommandResult[] {
  const results: EditCommandResult[] = []

  engine.batch(() => {
    for (const command of commands) {
      results.push(applyOne(engine, command))
    }
  }, description)

  return results
}

function applyOne(
  engine: TimelineEngine,
  command: EditCommand,
): EditCommandResult {
  switch (command.kind) {
    case 'trim':
      return applyTrim(engine, command)
    case 'split':
      return applySplit(engine, command)
    case 'delete':
      return applyDelete(engine, command)
    case 'move':
      return applyMove(engine, command)
    case 'cutRange':
      return applyCutRange(engine, command)
    default:
      return { ok: false, command, reason: 'unknown-command' }
  }
}

/** Confirm the clip exists on the stated track. */
function locate(
  engine: TimelineEngine,
  clipId: string,
  trackId: string,
): { startFrame: number; durationFrames: number } | null {
  const found = engine.findClip(clipId)
  if (!found || found.trackId !== trackId) return null
  return {
    startFrame: found.clip.startFrame,
    durationFrames: found.clip.durationFrames,
  }
}

function applyTrim(
  engine: TimelineEngine,
  command: Extract<EditCommand, { kind: 'trim' }>,
): EditCommandResult {
  const clip = locate(engine, command.clipId, command.trackId)
  if (!clip) return fail(command, engine, command.clipId, command.trackId)
  if (command.durationFrames < 1) return { ok: false, command, reason: 'invalid-range' }

  // No-op guard: trimClip already matches the request → nothing to verify.
  const isNoOp =
    clip.startFrame === command.startFrame && clip.durationFrames === command.durationFrames

  engine.trimClip(
    command.clipId,
    command.trackId,
    command.startFrame,
    command.durationFrames,
  )

  // trimClip silently rejects (locked track, overlap, source-bounds) — confirm
  // the clip actually moved, otherwise report the rejection like every sibling.
  const after = locate(engine, command.clipId, command.trackId)
  if (!after) return { ok: false, command, reason: 'engine-rejected' }
  if (!isNoOp && after.startFrame === clip.startFrame && after.durationFrames === clip.durationFrames) {
    return { ok: false, command, reason: 'engine-rejected' }
  }
  return { ok: true, command }
}

function applySplit(
  engine: TimelineEngine,
  command: Extract<EditCommand, { kind: 'split' }>,
): EditCommandResult {
  const clip = locate(engine, command.clipId, command.trackId)
  if (!clip) return fail(command, engine, command.clipId, command.trackId)

  const end = clip.startFrame + clip.durationFrames
  if (command.atFrame <= clip.startFrame || command.atFrame >= end) {
    return { ok: false, command, reason: 'split-outside-clip' }
  }

  const result = engine.splitClip(command.clipId, command.trackId, command.atFrame)
  if (!result) return { ok: false, command, reason: 'engine-rejected' }
  return { ok: true, command }
}

function applyDelete(
  engine: TimelineEngine,
  command: Extract<EditCommand, { kind: 'delete' }>,
): EditCommandResult {
  const clip = locate(engine, command.clipId, command.trackId)
  if (!clip) return fail(command, engine, command.clipId, command.trackId)

  engine.removeClip(command.clipId, command.trackId)
  // removeClip is a silent no-op on a locked track; verify the clip is gone.
  if (engine.findClip(command.clipId)) {
    return { ok: false, command, reason: 'engine-rejected' }
  }
  return { ok: true, command }
}

function applyMove(
  engine: TimelineEngine,
  command: Extract<EditCommand, { kind: 'move' }>,
): EditCommandResult {
  const clip = locate(engine, command.clipId, command.fromTrackId)
  if (!clip) return fail(command, engine, command.clipId, command.fromTrackId)

  engine.moveClip(
    command.clipId,
    command.fromTrackId,
    command.toTrackId,
    command.startFrame,
  )
  // moveClip rejects overlaps / locked tracks silently — confirm it landed.
  const after = engine.findClip(command.clipId)
  if (!after || after.trackId !== command.toTrackId || after.clip.startFrame !== command.startFrame) {
    return { ok: false, command, reason: 'engine-rejected' }
  }
  return { ok: true, command }
}

/**
 * Cut a timeline range out of one clip. Splits at the range boundaries and
 * removes the middle segment. This is the workhorse behind "cut the part where…".
 *
 * For a clip spanning [start, end) and a removal range [from, to):
 *   - split at `from` (if strictly inside) → the right half becomes the segment
 *   - split that segment at `to` (if strictly inside) → its left half is the middle
 *   - remove the middle
 */
function applyCutRange(
  engine: TimelineEngine,
  command: Extract<EditCommand, { kind: 'cutRange' }>,
): EditCommandResult {
  const clip = locate(engine, command.clipId, command.trackId)
  if (!clip) return fail(command, engine, command.clipId, command.trackId)

  const start = clip.startFrame
  const end = clip.startFrame + clip.durationFrames
  const from = Math.max(command.fromFrame, start)
  const to = Math.min(command.toFrame, end)
  if (from >= to) return { ok: false, command, reason: 'invalid-range' }

  const { trackId } = command
  let segmentId = command.clipId

  // Split off everything left of `from`; the right half is what we keep working on.
  if (from > start) {
    const split = engine.splitClip(segmentId, trackId, from)
    if (!split) return { ok: false, command, reason: 'engine-rejected' }
    segmentId = split[1]
  }

  // The segment now spans [from, end). Its left part up to `to` is the middle.
  let middleId = segmentId
  if (to < end) {
    const split = engine.splitClip(segmentId, trackId, to)
    if (!split) return { ok: false, command, reason: 'engine-rejected' }
    middleId = split[0]
  }

  engine.removeClip(middleId, trackId)
  if (engine.findClip(middleId)) {
    return { ok: false, command, reason: 'engine-rejected' }
  }
  return { ok: true, command }
}

/** Distinguish "no such clip anywhere" from "clip exists but on a different track". */
function fail(
  command: EditCommand,
  engine: TimelineEngine,
  clipId: string,
  trackId: string,
): EditCommandResult {
  const found = engine.findClip(clipId)
  if (found && found.trackId !== trackId) {
    return { ok: false, command, reason: 'track-mismatch' }
  }
  return { ok: false, command, reason: 'clip-not-found' }
}
