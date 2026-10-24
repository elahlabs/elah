import { instantiate } from '../composition'
import type { CompositionIssue, PropValue } from '../composition'
import type { Project } from '../types'
import { exportVideo } from './exportVideo'
import type { ExportOptions } from './types'

/** One row of a variant batch: prop values (typed, or raw strings from a CSV cell) plus a display name. */
export interface VariantRow {
  /** Prop values for this variant: typed, or strings straight from a CSV cell. */
  values: Readonly<Record<string, unknown>>
  /** A display name; the caller makes file names from it. */
  name?: string
}

export interface VariantProgress {
  index: number
  frame: number
  totalFrames: number
}

export interface RenderVariantsOptions {
  /** Passed to every export. renderVariants sets `signal` and `onProgress` itself. */
  export?: Omit<ExportOptions, 'onProgress' | 'signal'>
  /** Row i is instantiated with seed `seed + i`. Default 1. */
  seed?: number
  signal?: AbortSignal
  onProgress?: (progress: VariantProgress) => void
  /** Test seam. Default: exportVideo. */
  exporter?: (project: Project, options: ExportOptions) => Promise<Blob>
}

export type VariantResult =
  | { index: number; name?: string; ok: true; blob: Blob; values: Record<string, PropValue>; warnings: CompositionIssue[] }
  | { index: number; name?: string; ok: false; error: string; issues: CompositionIssue[] }

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Export aborted', 'AbortError')
  }
}

/**
 * For each row, runs `instantiate` then the existing `exportVideo`, one row at
 * a time (`exportVideo` itself rejects a second concurrent call), and yields
 * one result per row: a video `Blob`, or an error with the reason. A row whose
 * instantiate() issues include an 'error' severity skips the exporter entirely
 * and is reported as that row's failure; a rejecting exporter call becomes the
 * row's error and the loop continues. Cancelling (`options.signal`) makes the
 * generator throw an AbortError at once, before or during a row, and later
 * rows are never started.
 */
export async function* renderVariants(
  project: Project,
  rows: Iterable<VariantRow> | AsyncIterable<VariantRow>,
  options: RenderVariantsOptions = {},
): AsyncGenerator<VariantResult, void, undefined> {
  if (!project.composition) {
    throw new Error('renderVariants: the project has no composition')
  }

  const exporter = options.exporter ?? exportVideo
  const seed = options.seed ?? 1
  let index = 0

  for await (const row of rows) {
    throwIfAborted(options.signal)
    const i = index++

    const inst = instantiate(project, row.values ?? {}, { seed: seed + i })
    const errors = inst.issues.filter((issue) => issue.severity === 'error')

    let result: VariantResult
    if (errors.length > 0) {
      result = {
        index: i,
        name: row.name,
        ok: false,
        error: errors.map((e) => e.message).join('; '),
        issues: inst.issues,
      }
    } else {
      try {
        const blob = await exporter(inst.project, {
          ...options.export,
          signal: options.signal,
          onProgress: (p) => options.onProgress?.({ index: i, frame: p.frame, totalFrames: p.totalFrames }),
        })
        result = { index: i, name: row.name, ok: true, blob, values: inst.values, warnings: inst.issues }
      } catch (err) {
        if (options.signal?.aborted || (err as { name?: string } | null)?.name === 'AbortError') throw err
        result = {
          index: i,
          name: row.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          issues: inst.issues,
        }
      }
    }

    // `yield` sits outside the try/catch: an error thrown by the CONSUMER's
    // loop body (delivered back into this generator via `throw`) must never
    // be caught here and reported as if it were this row's export error.
    yield result
  }
}
