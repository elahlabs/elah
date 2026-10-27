/**
 * TICKET-PF-17 (phase A): the page tools Claude may call from the Ask Claude box. Each one is an editor operation
 * on the live engine: it validates its input, applies inside one `engine.batch` and returns a one-line result. A
 * refusal THROWS (Claude reads "Error: <message>" and carries on); nothing here reaches the network.
 *
 * One undo step per answer. Tool calls arrive over several async rounds, so each lands as its own batch (the
 * viewer sees it at once). When the answer ends, `finish()` folds them: it discards those entries (only if the
 * engine has not changed since the last one) and replays the recorded inputs, which are deterministic against the
 * same starting project, inside ONE batch. Undo then reverts the whole answer.
 */
import {
  baselineTransform,
  channelKeys,
  remapKeyframes,
  type Clip,
  type ClipKeyframes,
  type Keyframe,
  type Transform,
} from '@elah/core'
import type { TimelineEngine } from '@elah/editor'
import type { SampleTool } from '../claudeCaps'

export type AskOp =
  | { tool: 'set_text'; clipId: string; text: string }
  | { tool: 'retime'; clipId: string; startSeconds?: number; durationSeconds?: number }
  | { tool: 'move'; clipId: string; x?: number; y?: number; scale?: number }
  | { tool: 'trim_gap'; atSeconds: number; seconds: number }

export interface AskSession {
  tools: SampleTool[]
  /** Ops applied so far, in order. */
  readonly applied: ReadonlyArray<AskOp>
  /** Fold every op of this answer into one undo entry. Call once, after the call settles (success, error or Stop). */
  finish(): { steps: number; folded: boolean }
}

const UNDO_LABEL = 'Ask Claude'
const MAX_TEXT = 500
const MAX_SECONDS = 3600

const fail = (message: string): never => {
  throw new Error(message)
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`${what} is required (a string).`)
  return (v as string).trim()
}

/** undefined when absent or null; a finite number otherwise. */
function num(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) fail(`${what} must be a number.`)
  return n
}

const secs = (frames: number, fps: number) => (frames / fps).toFixed(2)

function clipOf(engine: TimelineEngine, id: string): Clip {
  const found = engine.findClip(id)
  if (!found) fail(`No clip "${id}". Use an id from the clip list.`)
  const clip = found!.clip
  if (engine.isTrackLocked(clip.trackId)) fail(`"${clip.name}" is on a locked track.`)
  return clip
}

const label = (c: Clip) => (c.type === 'text' && c.content ? `"${c.content.slice(0, 40)}"` : `"${c.name || c.id}"`)

/** Rewrites the engine's overlap error into words Claude can act on. */
function inBatch(engine: TimelineEngine, recipe: () => void) {
  try {
    engine.batch(recipe, UNDO_LABEL)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const m = /overlap with "([^"]+)"/.exec(msg)
    if (m) {
      const other = engine.findClip(m[1]!)?.clip
      fail(`That would overlap ${other ? label(other) : m[1]} on the same track; nothing was changed.`)
    }
    fail(msg)
  }
}

const MEDIA = new Set<Clip['type']>(['video', 'audio', 'sequence'])
const MOVABLE = new Set<Clip['type']>(['text', 'shape', 'image', 'video', 'compound', 'sequence', 'generator'])

// ---------------------------------------------------------------------------------------------------------------
// The four operations (pure against the engine's current project; used live and again for the fold)

function setText(engine: TimelineEngine, op: Extract<AskOp, { tool: 'set_text' }>): string {
  const clip = clipOf(engine, op.clipId)
  if (clip.type !== 'text') fail(`${label(clip)} is a ${clip.type} clip; only text clips have text.`)
  if (clip.words?.length && clip.captionMode && clip.captionMode !== 'static') fail(`${label(clip)} is a word-timed caption; its words come from the audio.`)
  if (clip.content === op.text) fail('The text is already exactly that.')
  inBatch(engine, () => {
    engine.updateClip(clip.id, clip.trackId, {
      content: op.text,
      // Styled runs are offsets into the old text.
      ...(clip.spans?.length ? { spans: undefined } : {}),
    })
  })
  return `Text of "${clip.name || clip.id}" is now "${op.text}".`
}

function retime(engine: TimelineEngine, op: Extract<AskOp, { tool: 'retime' }>): string {
  const fps = engine.getProject().fps
  const clip = clipOf(engine, op.clipId)
  const start = op.startSeconds !== undefined ? Math.max(0, Math.round(op.startSeconds * fps)) : clip.startFrame
  const dur = op.durationSeconds !== undefined ? Math.max(1, Math.round(op.durationSeconds * fps)) : clip.durationFrames
  if (start === clip.startFrame && dur === clip.durationFrames) fail(`${label(clip)} already runs ${secs(start, fps)}-${secs(start + dur, fps)} s.`)
  inBatch(engine, () => {
    if (MEDIA.has(clip.type) && dur !== clip.durationFrames) {
      // Footage: the end moves within its media (the engine caps it); the start moves the whole clip.
      if (start !== clip.startFrame) engine.updateClip(clip.id, clip.trackId, { startFrame: start })
      engine.trimClip(clip.id, clip.trackId, start, dur)
      const after = engine.findClip(clip.id)?.clip
      if (!after || after.durationFrames !== dur) fail(`${label(clip)} has only ${secs(after?.durationFrames ?? clip.durationFrames, fps)} s of media there, or a neighbour is in the way.`)
      return
    }
    // Graphics: keys are counted from the clip's start, so a longer clip plays its animation proportionally slower.
    const keyframes = dur !== clip.durationFrames && clip.keyframes ? remapKeyframes(clip.keyframes, { scale: dur / clip.durationFrames }) : undefined
    engine.updateClip(clip.id, clip.trackId, {
      startFrame: start,
      durationFrames: dur,
      ...(keyframes ? { keyframes } : {}),
    })
  })
  return `${label(clip)} now runs ${secs(start, fps)}-${secs(start + dur, fps)} s.`
}

function withKeys(kf: ClipKeyframes, ch: 'x' | 'y' | 'scale', keys: Keyframe[]): ClipKeyframes {
  const track = kf.channels[ch]!
  return { ...kf, channels: { ...kf.channels, [ch]: { ...track, keys } } }
}

/** The value a channel settles on: the last key when keyed, else the authored transform. */
export function restValue(clip: Clip, ch: 'x' | 'y' | 'scale', base: Transform): number {
  const keys = channelKeys(clip, ch)
  return keys.length ? keys[keys.length - 1]!.value : base[ch]
}

function move(engine: TimelineEngine, op: Extract<AskOp, { tool: 'move' }>): string {
  const project = engine.getProject()
  const clip = clipOf(engine, op.clipId)
  if (!MOVABLE.has(clip.type)) fail(`${label(clip)} is a ${clip.type} clip and has no position on the stage.`)
  if ((op.x !== undefined || op.y !== undefined) && (clip.layout?.anchorTo || clip.layout?.fitTo || clip.layout?.region || clip.layout?.pin)) {
    fail(`${label(clip)} is placed by a layout rule (attached to another element or a stage region), so x and y cannot move it; change only scale.`)
  }
  const base = baselineTransform(clip, { stage: project.stage })
  if (!base) fail(`${label(clip)} has no transform.`)
  const transform: Transform = { ...base!, anchor: { ...base!.anchor } }
  let keyframes = clip.keyframes
  const said: string[] = []
  for (const ch of ['x', 'y', 'scale'] as const) {
    const v = op[ch]
    if (v === undefined) continue
    const keys = channelKeys(clip, ch)
    if (keys.length && keyframes) {
      // Keyed channels are absolute: shift (x, y) or multiply (scale) every key so the motion keeps its shape and
      // settles on the value asked for.
      const rest = keys[keys.length - 1]!.value
      if (ch === 'scale') {
        if (!(rest > 0)) fail(`${label(clip)} animates its scale from zero; scale cannot be set as a factor.`)
        const k = v / rest
        keyframes = withKeys(keyframes, ch, keys.map((key) => ({ ...key, value: key.value * k })))
        transform.scale = transform.scale * k
      } else {
        const d = v - rest
        keyframes = withKeys(keyframes, ch, keys.map((key) => ({ ...key, value: key.value + d })))
        transform[ch] = transform[ch] + d
      }
    } else {
      transform[ch] = v
    }
    said.push(`${ch} ${v.toFixed(ch === 'scale' ? 2 : 3)}`)
  }
  if (!said.length) fail('Give at least one of x, y or scale.')
  inBatch(engine, () => {
    engine.updateClip(clip.id, clip.trackId, { transform, ...(keyframes !== clip.keyframes ? { keyframes } : {}) })
  })
  return `${label(clip)} now at ${said.join(', ')}.`
}

/** Keys of a clip whose span loses frames [a, b) (clip-local): keys after b move back; keys inside are dropped. */
function cutKeys(kf: ClipKeyframes | undefined, a: number, b: number): ClipKeyframes | undefined {
  if (!kf?.channels || b <= a) return kf
  const d = b - a
  const channels: ClipKeyframes['channels'] = {}
  for (const [name, track] of Object.entries(kf.channels)) {
    if (!track) continue
    const keys = (track.keys ?? []) as Keyframe[]
    let next = keys.filter((k) => k.frame <= a || k.frame >= b).map((k) => (k.frame >= b ? { ...k, frame: k.frame - d } : k))
    // A channel whose only keys sat inside the cut keeps one, at the cut, so it still resolves.
    if (next.length === 0 && keys.length) next = [{ ...keys[keys.length - 1]!, frame: a }]
    ;(channels as Record<string, unknown>)[name] = { ...track, keys: next }
  }
  return { ...kf, channels }
}

function trimGap(engine: TimelineEngine, op: Extract<AskOp, { tool: 'trim_gap' }>): string {
  const project = engine.getProject()
  const fps = project.fps
  const total = engine.getTotalFrames()
  const a = Math.max(0, Math.round(op.atSeconds * fps))
  const b = Math.min(total, Math.round((op.atSeconds + op.seconds) * fps))
  const d = b - a
  if (a >= total) fail(`${op.atSeconds} s is past the end of the video (${secs(total, fps)} s).`)
  if (d < 1) fail('That cut is shorter than one frame.')
  if (d >= total) fail('That would cut the whole video.')

  type Change = { clip: Clip; patch: Partial<Clip> }
  const resize: Change[] = []
  const shift: Array<{ clipId: string; trackId: string; delta: number }> = []
  for (const list of Object.values(project.clips)) {
    for (const c of list ?? []) {
      const s = c.startFrame
      const e = c.startFrame + c.durationFrames
      if (e <= a) continue
      if (s >= b) {
        shift.push({ clipId: c.id, trackId: c.trackId, delta: -d })
        continue
      }
      if (engine.isTrackLocked(c.trackId)) fail(`${label(c)} crosses the cut and is on a locked track.`)
      if (s >= a && e <= b) fail(`${label(c)} lies entirely inside ${secs(a, fps)}-${secs(b, fps)} s, so the cut would remove it. Cut a range around it, or retime it first.`)
      const media = MEDIA.has(c.type)
      const speed = c.speed ?? 1
      if (s < a && e > b) {
        if (media) fail(`The footage ${label(c)} runs through ${secs(a, fps)}-${secs(b, fps)} s; cutting inside footage is not available here. Split it in the timeline first.`)
        resize.push({ clip: c, patch: { durationFrames: c.durationFrames - d, keyframes: cutKeys(c.keyframes, a - s, b - s) } })
      } else if (s < a) {
        // Ends inside the cut: it ends at the cut.
        resize.push({ clip: c, patch: { durationFrames: a - s } })
      } else {
        // Starts inside the cut: what was after the cut starts at the cut.
        const lost = b - s
        resize.push({
          clip: c,
          patch: {
            startFrame: a,
            durationFrames: e - b,
            ...(media ? { sourceStartFrame: c.sourceStartFrame + Math.round(lost * speed) } : {}),
            ...(c.keyframes ? { keyframes: remapKeyframes(c.keyframes, { shift: -lost }) } : {}),
          },
        })
      }
    }
  }
  // Shrinks first (they only free space), then one validated shift of everything after the cut.
  resize.sort((x, y) => x.clip.startFrame - y.clip.startFrame)
  inBatch(engine, () => {
    for (const r of resize) engine.updateClip(r.clip.id, r.clip.trackId, r.patch)
    if (shift.length && !engine.shiftClips(shift, UNDO_LABEL)) fail('The clips after the cut could not move earlier (a locked track or an overlap).')
    for (const m of [...(engine.getProject().markers ?? [])]) {
      if (m.frame >= b) engine.updateMarker(m.id, { frame: m.frame - d })
    }
  })
  const now = engine.getTotalFrames()
  return `Cut ${secs(d, fps)} s at ${secs(a, fps)} s: ${shift.length} clip${shift.length === 1 ? '' : 's'} moved earlier, ${resize.length} shortened. The video is now ${secs(now, fps)} s.`
}

export function applyAskOp(engine: TimelineEngine, op: AskOp): string {
  switch (op.tool) {
    case 'set_text':
      return setText(engine, op)
    case 'retime':
      return retime(engine, op)
    case 'move':
      return move(engine, op)
    case 'trim_gap':
      return trimGap(engine, op)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Input validation (Claude's arguments are not validated by the platform)

export function parseOp(tool: AskOp['tool'], input: { [k: string]: unknown }): AskOp {
  switch (tool) {
    case 'set_text': {
      const text = typeof input.text === 'string' ? input.text.replace(/\s+$/g, '') : ''
      if (!text.trim()) fail('text is required and cannot be empty.')
      if (text.length > MAX_TEXT) fail(`text is at most ${MAX_TEXT} characters.`)
      return { tool, clipId: str(input.clipId, 'clipId'), text }
    }
    case 'retime': {
      const startSeconds = num(input.startSeconds, 'startSeconds')
      const durationSeconds = num(input.durationSeconds, 'durationSeconds')
      if (startSeconds === undefined && durationSeconds === undefined) fail('Give startSeconds, durationSeconds or both.')
      if (startSeconds !== undefined && (startSeconds < 0 || startSeconds > MAX_SECONDS)) fail('startSeconds must be 0 or more.')
      if (durationSeconds !== undefined && (durationSeconds <= 0 || durationSeconds > MAX_SECONDS)) fail('durationSeconds must be more than 0.')
      return { tool, clipId: str(input.clipId, 'clipId'), ...(startSeconds !== undefined ? { startSeconds } : {}), ...(durationSeconds !== undefined ? { durationSeconds } : {}) }
    }
    case 'move': {
      const x = num(input.x, 'x')
      const y = num(input.y, 'y')
      const scale = num(input.scale, 'scale')
      if (x === undefined && y === undefined && scale === undefined) fail('Give at least one of x, y or scale.')
      if (x !== undefined && (x < -0.5 || x > 1.5)) fail('x is 0..1 across the stage (0.5 = centre).')
      if (y !== undefined && (y < -0.5 || y > 1.5)) fail('y is 0..1 down the stage (0.5 = centre).')
      if (scale !== undefined && (scale < 0.05 || scale > 10)) fail('scale must be between 0.05 and 10.')
      return { tool, clipId: str(input.clipId, 'clipId'), ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(scale !== undefined ? { scale } : {}) }
    }
    case 'trim_gap': {
      const atSeconds = num(input.atSeconds, 'atSeconds')
      const seconds = num(input.seconds, 'seconds')
      if (atSeconds === undefined || atSeconds < 0) fail('atSeconds is required (0 or more).')
      if (seconds === undefined || seconds <= 0 || seconds > MAX_SECONDS) fail('seconds is required (more than 0).')
      return { tool, atSeconds: atSeconds!, seconds: seconds! }
    }
  }
}

const DEFS: Array<{ name: AskOp['tool']; description: string; inputSchema: NonNullable<SampleTool['inputSchema']>; doing: (i: { [k: string]: unknown }) => string }> = [
  {
    name: 'set_text',
    description: "Replace a text clip's words. Returns one line saying what the text is now.",
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Id of a text clip from the clip list.' },
        text: { type: 'string', description: 'The new text, exactly as it should read.' },
      },
      required: ['clipId', 'text'],
    },
    doing: () => 'Changing the text',
  },
  {
    name: 'retime',
    description:
      "Change when a clip starts and/or how long it lasts, in seconds on the timeline. A longer graphic plays its animation proportionally slower. Only that clip moves; other clips keep their times. Returns the clip's new start and end.",
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Id from the clip list.' },
        startSeconds: { type: 'number', description: 'New start, seconds from the beginning of the video. Omit to keep.' },
        durationSeconds: { type: 'number', description: 'New length in seconds. Omit to keep.' },
      },
      required: ['clipId'],
    },
    doing: () => 'Retiming',
  },
  {
    name: 'move',
    description:
      'Place or resize a clip on the stage. x and y are fractions of the stage (0..1, 0.5 = centre, y grows downward) for the point the clip settles on; scale multiplies its authored size (1 = as made). Animated clips keep their motion, shifted to the new place or size. Returns the new values.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Id from the clip list.' },
        x: { type: 'number', description: '0..1 across the stage. Omit to keep.' },
        y: { type: 'number', description: '0..1 down the stage. Omit to keep.' },
        scale: { type: 'number', description: 'Absolute scale, e.g. current 1.00 -> 1.25 for "bigger". Omit to keep.' },
      },
      required: ['clipId'],
    },
    doing: (i) => (i.scale !== undefined && i.x === undefined && i.y === undefined ? 'Resizing' : 'Moving'),
  },
  {
    name: 'trim_gap',
    description:
      'Remove a stretch of time from the whole video (a pause): everything after atSeconds + seconds moves earlier by seconds, and clips running through the stretch get shorter. Refuses if a clip lies entirely inside the stretch. Returns what moved and the new length.',
    inputSchema: {
      type: 'object',
      properties: {
        atSeconds: { type: 'number', description: 'Where the stretch to remove starts, seconds from the beginning.' },
        seconds: { type: 'number', description: 'How long the stretch is, in seconds.' },
      },
      required: ['atSeconds', 'seconds'],
    },
    doing: () => 'Cutting the pause',
  },
]

/**
 * The tools for ONE Ask (a new session per call). `onProgress` gets a short line from inside each `execute`.
 */
export function createAskSession(engine: TimelineEngine, onProgress?: (line: string) => void): AskSession {
  const applied: AskOp[] = []
  let lastRev = -1
  let done = false

  const tools: SampleTool[] = DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    execute: (input, context) => {
      if (done || context?.signal?.aborted) fail('Stopped by the viewer.')
      const raw = input && typeof input === 'object' ? input : {}
      const op = parseOp(def.name, raw)
      onProgress?.(`${def.doing(raw)}...`)
      // The fold replays against the same start only while nothing else touched the project in between.
      if (applied.length && engine.getRevision() !== lastRev) lastRev = -2
      const before = engine.getRevision()
      let result: string
      try {
        result = applyAskOp(engine, op)
      } catch (e) {
        // A refused op rolls its batch back to the same project but still bumps the revision.
        if (applied.length && lastRev === before) lastRev = engine.getRevision()
        throw e
      }
      if (engine.getRevision() === before) fail('Nothing changed.')
      applied.push(op)
      if (lastRev !== -2) lastRev = engine.getRevision()
      return result
    },
  }))

  return {
    tools,
    applied,
    finish() {
      done = true
      const steps = applied.length
      if (steps < 2 || lastRev < 0 || engine.getRevision() !== lastRev) return { steps, folded: steps === 1 }
      for (let i = 0; i < steps; i++) {
        if (!engine.discardLast(engine.getRevision())) {
          // Put back the ones already discarded, as separate steps, rather than lose them.
          for (const op of applied.slice(steps - i)) {
            try {
              engine.batch(() => void applyAskOp(engine, op), UNDO_LABEL)
            } catch {
              /* that one no longer applies */
            }
          }
          return { steps, folded: false }
        }
      }
      try {
        engine.batch(() => {
          for (const op of applied) applyAskOp(engine, op)
        }, UNDO_LABEL)
        return { steps, folded: true }
      } catch {
        // Should not happen (same ops, same start). Put the work back as separate steps rather than lose it.
        for (const op of applied) {
          try {
            engine.batch(() => void applyAskOp(engine, op), UNDO_LABEL)
          } catch {
            /* that one no longer applies */
          }
        }
        return { steps, folded: false }
      }
    },
  }
}
