/**
 * PV-P9a-2: the PNG-sequence transport — the pieces that sit on each side of
 * the ExportWorker/main-thread boundary for a `container: 'png-sequence'`
 * export.
 *
 * "Bounded" is the point: an export can run to thousands of frames, and
 * nothing here may hold more than the frame currently in flight. The
 * discipline that keeps it bounded is "at most one unacknowledged frame" —
 * enforced on the WORKER side by `FrameAckGate` (the worker never encodes
 * frame i+1 until frame i's `png-ack` arrives) and on the MAIN-THREAD side by
 * `createPngFrameReceiver` (the ack is posted back only after the frame's
 * bytes have actually been written to the sink, not merely received). Both
 * pieces are plain, DOM-free TypeScript so they can be driven directly by a
 * test without a real Worker or a real file system — see
 * `__tests__/pngProtocol.test.ts`.
 *
 * `createZipFrameSink` is the fallback used when the caller supplies no
 * `ExportOptions.frameSink` (no directory picker — PV-P9a-3's UI owns that):
 * it reuses PV-P7b-1's `zipStore` rather than a second ZIP writer, and caps
 * its own memory explicitly (PV-CONTRACTS: "P9a-2 bounds memory ... it must
 * not call this a streaming ZIP encoder" — it is an in-memory ZIP with a
 * hard ceiling, not a true streaming archive format).
 */

import { zipStore, type ZipFile } from './zipStore'
import type { FrameSink } from './types'

// ---------------------------------------------------------------------------
// Frame naming
// ---------------------------------------------------------------------------

/** `frame-000001.png` style name, sequential from 1, for zero-based `index`. */
export function pngFrameName(index: number): string {
  return `frame-${String(index + 1).padStart(6, '0')}.png`
}

// ---------------------------------------------------------------------------
// Worker-side backpressure gate
// ---------------------------------------------------------------------------

/**
 * Enforces "at most one unacknowledged frame" on the sending side: call
 * `expect(index)` right before posting frame `index`, then `await` the
 * returned promise before producing frame `index + 1`. Calling `expect`
 * again before the pending one resolves is a protocol violation and throws
 * synchronously — this is what makes two frames in flight at once
 * impossible by construction, not merely by convention.
 */
export class FrameAckGate {
  private pending: { index: number; resolve: () => void; reject: (reason: unknown) => void } | null = null

  /** Registers frame `index` as awaiting its ack. Throws if a previous frame is still unacknowledged. */
  expect(index: number): Promise<void> {
    if (this.pending) {
      throw new Error(
        `FrameAckGate: frame ${this.pending.index} was never acknowledged before frame ${index} was posted`,
      )
    }
    return new Promise<void>((resolve, reject) => {
      this.pending = { index, resolve, reject }
    })
  }

  /**
   * Acknowledges frame `index`, resolving the matching `expect()`. Throws
   * (and rejects the pending promise) on a mismatched or unexpected ack.
   */
  ack(index: number): void {
    const pending = this.pending
    if (!pending) {
      throw new Error(`FrameAckGate: unexpected ack for frame ${index} — no frame is pending`)
    }
    if (pending.index !== index) {
      this.pending = null
      const err = new Error(`FrameAckGate: ack index mismatch — expected ${pending.index}, got ${index}`)
      pending.reject(err)
      throw err
    }
    this.pending = null
    pending.resolve()
  }

  /** Rejects the pending `expect()`, if any — used when the export aborts or errors before an ack arrives. */
  fail(reason: unknown): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.reject(reason)
  }
}

// ---------------------------------------------------------------------------
// Main-thread receiver
// ---------------------------------------------------------------------------

/**
 * The main thread's half of the protocol: validates each incoming
 * `png-frame` message is the next one expected (never out of order — a
 * worker that sent two unacknowledged frames, or a corrupted message
 * stream, is caught here rather than silently zipping frames in the wrong
 * order), writes it to `sink`, and only resolves once that write settles.
 * The caller (`exportVideo.ts`) posts the `png-ack` back to the worker
 * AFTER this resolves — never before — which is what keeps a slow sink
 * (e.g. a real disk write) from letting the worker race ahead.
 */
export interface PngFrameReceiver {
  receive(frame: { index: number; name: string; data: Uint8Array }): Promise<void>
}

export function createPngFrameReceiver(sink: FrameSink): PngFrameReceiver {
  let expected = 0
  return {
    async receive(frame) {
      if (frame.index !== expected) {
        throw new Error(
          `PNG sequence frame out of order: expected index ${expected}, got ${frame.index} ("${frame.name}")`,
        )
      }
      await sink.write(frame.name, frame.data)
      expected++
    },
  }
}

// ---------------------------------------------------------------------------
// Options → worker message
// ---------------------------------------------------------------------------

/**
 * Strips the main-thread-only `frameSink` before an options object crosses
 * `postMessage`'s structured clone (a function throws `DataCloneError`,
 * which would fail every export, not just a PNG one), replacing it with the
 * `pngSinkMode` boolean the worker can log.
 */
export function stripFrameSinkForWorker<T extends { frameSink?: unknown }>(
  options: T,
): Omit<T, 'frameSink'> & { pngSinkMode: boolean } {
  const { frameSink, ...rest } = options
  return { ...rest, pngSinkMode: !!frameSink } as Omit<T, 'frameSink'> & { pngSinkMode: boolean }
}

// ---------------------------------------------------------------------------
// Default sink: a bounded in-memory ZIP (PV-P7b-1's zipStore)
// ---------------------------------------------------------------------------

/** Aggregate PNG bytes cap for the in-memory ZIP fallback (PV-P9a-2 design). */
export const PNG_ZIP_MAX_BYTES = 128 * 1024 * 1024

/** File-count cap for the in-memory ZIP fallback (PV-P9a-2 design). */
export const PNG_ZIP_MAX_FILES = 10000

export interface ZipFrameSink extends FrameSink {
  /** The finished archive — call only after `close()` has resolved. */
  toZip(): Uint8Array
}

/**
 * The fallback `FrameSink` used when `ExportOptions.frameSink` is absent: an
 * in-memory, bounded ZIP. `write` rejects the INSTANT accepting a frame
 * would push the aggregate size or file count past the cap — never after,
 * so the archive is never silently truncated; the caller aborts the whole
 * export and reports the cap as the reason to use a directory sink instead.
 */
export function createZipFrameSink(limits: { maxBytes?: number; maxFiles?: number } = {}): ZipFrameSink {
  const maxBytes = limits.maxBytes ?? PNG_ZIP_MAX_BYTES
  const maxFiles = limits.maxFiles ?? PNG_ZIP_MAX_FILES
  const files: ZipFile[] = []
  let totalBytes = 0
  let closed = false
  let aborted = false

  return {
    async write(name, data) {
      if (closed || aborted) {
        throw new Error('createZipFrameSink: write() called after close()/abort()')
      }
      if (files.length + 1 > maxFiles) {
        throw new Error(
          `createZipFrameSink: PNG sequence exceeds ${maxFiles} files. Export to a directory instead of a ZIP.`,
        )
      }
      if (totalBytes + data.length > maxBytes) {
        throw new Error(
          `createZipFrameSink: PNG sequence exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MiB ZIP limit. ` +
            'Export to a directory instead of a ZIP.',
        )
      }
      files.push({ name, data })
      totalBytes += data.length
    },
    async close() {
      closed = true
    },
    async abort() {
      aborted = true
      files.length = 0
      totalBytes = 0
    },
    toZip() {
      if (!closed) throw new Error('createZipFrameSink: toZip() called before close()')
      return zipStore(files)
    },
  }
}
