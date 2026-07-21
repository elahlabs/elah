/**
 * ffmpeg discovery, version floor, and encoder capability check.
 *
 * ffmpeg is a system binary, deliberately never an npm dependency: vendoring a
 * static build would add tens of MB to this package, drag GPL-licensed code
 * into an MIT/Apache-2.0 dependency graph, and lose the hardware encoders
 * (h264_videotoolbox / h264_nvenc / h264_qsv) that only the platform's own
 * ffmpeg build has — a vendored static build ships none of them. Discovery
 * therefore mirrors packages/cli/src/lib/browser.ts's search for a system
 * Chrome: explicit option -> env var -> bare command name resolved via PATH,
 * trying each in turn and surfacing the last failure if every attempt fails.
 *
 * The version floor exists because this package's entire frame-accuracy
 * strategy (see decoder.ts) rests on `-fps_mode passthrough`, which forbids
 * ffmpeg from duplicating/dropping frames to hit a constant rate. That flag
 * landed in ffmpeg 5.1; below it we must refuse rather than silently produce
 * a mistimed export.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ExportServerError } from '../errors'

import type { FfmpegBinary } from '../types'

const execFileAsync = promisify(execFile)

/** Lowest ffmpeg that supports every flag/filter option this package emits. */
export const MIN_FFMPEG_VERSION: readonly [number, number] = [5, 1]

export interface LocateFfmpegOptions {
  /** Explicit executable path; wins over discovery. */
  ffmpegPath?: string
  /** Encoder names that must be present, e.g. ['libx264', 'aac']. */
  requireEncoders?: string[]
}

/**
 * Encoder names ffmpeg may report that can produce H.264, used only to make
 * an ENCODER_MISSING error actionable ("here's what you *can* use instead").
 * Not exhaustive — vaapi/v4l2m2m variants are Linux-only and rare in the wild.
 */
const H264_ENCODERS = [
  'libx264',
  'libx264rgb',
  'h264_videotoolbox',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_vaapi',
  'h264_v4l2m2m',
]

/**
 * Parses `ffmpeg -version` stdout into `[major, minor]`.
 *
 * Deliberately lenient: only the first line is inspected, and an optional
 * leading `n` is tolerated (static builds from e.g. BtbN report
 * `version n6.1.1`). Git/nightly builds print a non-numeric version like
 * `version N-118234-g0abcdef` — that has no `\d+\.\d+` to match, so this
 * returns `null` and the caller proceeds with a warning rather than locking
 * out custom builds that may well be newer than any numbered release.
 */
export function parseFfmpegVersion(stdout: string): [number, number] | null {
  const firstLine = stdout.split('\n')[0] ?? ''
  const match = /version\s+n?(\d+)\.(\d+)/.exec(firstLine)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

/**
 * Parses `ffmpeg -encoders` stdout into the set of encoder names.
 *
 * Encoder lines look like ` V....D libx264              libx264 H.264 ...` —
 * a leading space, six capability flags, then the name. Each flag column has
 * its own fixed alphabet (col 1: `V`/`A`/`S`; the rest: a letter or `.`) —
 * `[VAS.]{6}` looks equivalent but is NOT: it also accepts `.` in col 1, which
 * never occurs, and — the one that matters — rejects the letters actually
 * used in columns 2-6 (`F`, `S`, `X`, `B`, `D`), so it silently drops any
 * encoder line that sets one of those flags. On a real ffmpeg build that is
 * most encoders, `libx264` included (it reports `D`), which would have made
 * the capability check that gates this whole package unable to see the
 * encoder it exists to verify. Matching each column's real alphabet is what
 * makes this work against actual `-encoders` output instead of just the
 * lines that happen to have no flags set. The header (`Encoders:`) and the
 * flag legend above the encoder table don't match this shape and are ignored
 * for free.
 */
export function parseEncoders(stdout: string): Set<string> {
  const encoders = new Set<string>()
  const lineRe = /^\s[VAS][F.][S.][X.][B.][D.]\s+(\S+)/gm
  let match: RegExpExecArray | null
  while ((match = lineRe.exec(stdout)) !== null) {
    encoders.add(match[1])
  }
  return encoders
}

function compareVersions(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

async function probeEncoders(candidate: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync(candidate, ['-hide_banner', '-encoders'])
  return parseEncoders(stdout)
}

/**
 * Locates a usable ffmpeg, verifies it meets {@link MIN_FFMPEG_VERSION}, and
 * (when `requireEncoders` is given) verifies each named encoder is present.
 *
 * Discovery order: `options.ffmpegPath` -> `ELAH_FFMPEG` env -> `'ffmpeg'` on
 * PATH — each candidate is tried by running `<candidate> -version`, in that
 * order, so an explicit option always gets first chance and PATH is the
 * fallback of last resort.
 */
export async function locateFfmpeg(options: LocateFfmpegOptions = {}): Promise<FfmpegBinary> {
  const candidates = [options.ffmpegPath, process.env.ELAH_FFMPEG, 'ffmpeg'].filter(
    (c): c is string => !!c,
  )

  let lastError: Error | undefined
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['-version'])
      const versionLine = stdout.split('\n')[0]?.trim() ?? ''
      const version = parseFfmpegVersion(stdout)

      if (version === null) {
        // eslint-disable-next-line no-console
        console.warn(
          `[@elah/export-server] ffmpeg at '${candidate}' reports a non-numeric version ` +
            `('${versionLine}'); proceeding without a version check (assuming a git/nightly build).`,
        )
      } else if (compareVersions(version, MIN_FFMPEG_VERSION) < 0) {
        throw new ExportServerError(
          'FFMPEG_TOO_OLD',
          `ffmpeg at '${candidate}' is version ${version[0]}.${version[1]}, but @elah/export-server ` +
            `requires ${MIN_FFMPEG_VERSION[0]}.${MIN_FFMPEG_VERSION[1]}+ (needs -fps_mode passthrough, ` +
            `added in ffmpeg 5.1, for frame-accurate decode). Found: ${versionLine}`,
        )
      }

      const encoders = await probeEncoders(candidate)
      const required = options.requireEncoders ?? []
      const missing = required.filter(name => !encoders.has(name))
      if (missing.length > 0) {
        const available = H264_ENCODERS.filter(name => encoders.has(name))
        const encoderLabel =
          missing.length === 1
            ? `encoder '${missing[0]}'`
            : `encoders ${missing.map(name => `'${name}'`).join(', ')}`
        throw new ExportServerError(
          'ENCODER_MISSING',
          `ffmpeg at ${candidate} has no ${encoderLabel}. Available H.264 encoders: ` +
            `${available.length > 0 ? available.join(', ') : 'none found'}.`,
        )
      }

      return { path: candidate, versionLine, version, encoders }
    } catch (err) {
      // FFMPEG_TOO_OLD / ENCODER_MISSING are fatal facts about a *found* ffmpeg,
      // not evidence the candidate is unusable as a binary — surface them
      // immediately rather than masking them behind a later FFMPEG_NOT_FOUND.
      if (err instanceof ExportServerError) throw err
      lastError = err as Error
    }
  }

  throw new ExportServerError(
    'FFMPEG_NOT_FOUND',
    'No ffmpeg binary found for export. Install ffmpeg (brew install ffmpeg / apt install ffmpeg), ' +
      `or pass ffmpegPath (or set ELAH_FFMPEG). Last error: ${lastError?.message}`,
  )
}
