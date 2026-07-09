/**
 * EditCommand — the machine contract between the AI planner and the engine.
 *
 * The AI command-planning model emits an array of these; interpretEditCommands
 * maps each one onto the TimelineEngine mutation funnel. This is the "FFmpeg-like
 * command set" of the editor: a small, closed vocabulary of edits that are all
 * expressible through existing engine methods and therefore fully undoable.
 *
 * TIME IS INTEGER FRAMES (engine principle P2). Every frame field here is an
 * integer timeline frame. Conversion from the AI's seconds / MM:SS timestamps to
 * frames happens at the web boundary where the project fps is known — the core
 * never sees seconds, so it stays deterministic and fps-agnostic.
 */

/** Trim a clip's in/out points. Maps to engine.trimClip. */
export interface TrimCommand {
  kind: 'trim'
  clipId: string
  trackId: string
  /** New timeline start frame of the clip. */
  startFrame: number
  /** New duration in frames. */
  durationFrames: number
}

/** Split a clip in two at a timeline frame. Maps to engine.splitClip. */
export interface SplitCommand {
  kind: 'split'
  clipId: string
  trackId: string
  /** Timeline frame at which to split; must be strictly inside the clip. */
  atFrame: number
}

/** Remove a clip. Maps to engine.removeClip. */
export interface DeleteCommand {
  kind: 'delete'
  clipId: string
  trackId: string
}

/** Move a clip to a new start frame, optionally onto another track. Maps to engine.moveClip. */
export interface MoveCommand {
  kind: 'move'
  clipId: string
  fromTrackId: string
  toTrackId: string
  startFrame: number
}

/**
 * Cut out a timeline range from a single clip: split at both boundaries and
 * remove the middle segment. Composite — expands to split/split/remove inside
 * one batch. This is the primitive behind "cut the part where the person
 * says Hi".
 */
export interface CutRangeCommand {
  kind: 'cutRange'
  clipId: string
  trackId: string
  /** Inclusive timeline start frame of the range to remove. */
  fromFrame: number
  /** Exclusive timeline end frame of the range to remove. */
  toFrame: number
}

export type EditCommand =
  | TrimCommand
  | SplitCommand
  | DeleteCommand
  | MoveCommand
  | CutRangeCommand

export type EditCommandKind = EditCommand['kind']

/**
 * JSON schema describing EditCommand[], suitable for prompting a structured-output
 * model. Kept in sync with the discriminated union above. The planner is asked to
 * return { "commands": EditCommand[] }.
 */
export const EDIT_COMMAND_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['commands'],
  properties: {
    commands: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: ['trim', 'split', 'delete', 'move', 'cutRange'],
          },
          clipId: { type: 'string' },
          trackId: { type: 'string' },
          fromTrackId: { type: 'string' },
          toTrackId: { type: 'string' },
          startFrame: { type: 'integer', minimum: 0 },
          durationFrames: { type: 'integer', minimum: 1 },
          atFrame: { type: 'integer', minimum: 0 },
          fromFrame: { type: 'integer', minimum: 0 },
          toFrame: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const
