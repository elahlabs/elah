/**
 * One error type, one machine-readable code, for the whole package.
 *
 * Mirrors packages/cli/src/lib/errors.ts's CliError: every failure this
 * package throws is an ExportServerError, never a bare Error, so a render
 * server can switch on `.code` to pick an HTTP status instead of pattern
 * matching a message string. Messages are still written for a human —
 * whoever operates the server — naming the file/binary/clip at fault and
 * the fix, in the tone of packages/cli/src/lib/browser.ts:34-37.
 */

/**
 * - `FFMPEG_NOT_FOUND` / `FFMPEG_TOO_OLD` / `ENCODER_MISSING` — ffmpeg discovery
 *   and capability checks (locate.ts) failed before any frame was touched.
 * - `EMPTY_PROJECT` / `PLAN_INVALID` — the Scene scan (plan.ts) found nothing
 *   to export, or found a shape the planner cannot turn into a plan.
 * - `PROBE_FAILED` — mediabunny could not read a source's metadata/PTS index.
 * - `SOURCE_UNSUPPORTED` — a clip `src` has no on-disk form (sources.ts), e.g.
 *   a browser-only `blob:`/`data:` URL.
 * - `FONT_LOAD_FAILED` — a requested font file/family could not be registered.
 * - `DECODE_FAILED` — a per-clip ffmpeg decode process failed or produced
 *   malformed rawvideo.
 * - `ENCODE_FAILED` — the encoder process (video+audio mux) failed.
 * - `OUTPUT_INVALID` — the finished file failed post-export validation.
 * - `ABORTED` — the caller's AbortSignal fired; not a defect, but still
 *   surfaced through this type so callers don't have to special-case it.
 */
export type ExportErrorCode =
  | 'FFMPEG_NOT_FOUND'
  | 'FFMPEG_TOO_OLD'
  | 'ENCODER_MISSING'
  | 'EMPTY_PROJECT'
  | 'PLAN_INVALID'
  | 'PROBE_FAILED'
  | 'SOURCE_UNSUPPORTED'
  | 'FONT_LOAD_FAILED'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'
  | 'OUTPUT_INVALID'
  | 'ABORTED'

export interface ExportServerErrorOptions {
  /** Wrapped low-level error (a `child_process` failure, a parse error, ...). */
  cause?: unknown
  /** Tail of the child process's stderr, when the failure came from ffmpeg. */
  stderr?: string
}

/**
 * The one error type this package throws.
 *
 * `code` is the contract a render server codes against to map failures to
 * HTTP statuses (e.g. `SOURCE_UNSUPPORTED` -> 422, `FFMPEG_NOT_FOUND` -> 500)
 * without string-matching `message`, which is free to change wording.
 */
export class ExportServerError extends Error {
  readonly code: ExportErrorCode
  readonly stderr?: string

  constructor(code: ExportErrorCode, message: string, options?: ExportServerErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ExportServerError'
    this.code = code
    this.stderr = options?.stderr
  }
}
