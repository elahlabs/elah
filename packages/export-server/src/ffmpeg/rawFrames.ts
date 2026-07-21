/**
 * Frame-delimiting reader for an ffmpeg `-f rawvideo` stdout pipe.
 *
 * A rawvideo pipe is just bytes — ffmpeg never inserts frame boundaries, so
 * the only thing that tells us where one frame ends and the next begins is
 * `frameBytes` (= width * height * 4 for rgba), which the caller derives from
 * the probe-produced source dimensions. Get that number wrong and every frame
 * silently shears across the wrong boundary.
 *
 * Paused-mode only: we drive the stream with `'readable'` + `stream.read()`,
 * never `'data'`/`resume()`. Flowing mode would let Node buffer the whole
 * decode into RAM ahead of the export loop, which defeats the OS-pipe
 * backpressure that is supposed to throttle ffmpeg to the speed we consume at
 * (see decoder.ts's stdin backpressure for the encoder side of the same
 * concern).
 */

import type { Readable } from 'node:stream'

interface PendingRead {
  resolve: (frame: Uint8ClampedArray | null) => void
  reject: (err: Error) => void
}

export class RawFrameReader {
  private readonly stream: Readable
  private readonly frameBytes: number

  private pending: Buffer[] = []
  private pendingBytesInternal = 0

  private ended = false
  private errored: Error | null = null
  private waiter: PendingRead | null = null

  private destroyed = false

  private readonly onReadable: () => void
  private readonly onEnd: () => void
  private readonly onError: (err: Error) => void

  trailingBytes = 0

  /** Bytes currently buffered ahead of the next `read()` — exposed for the backpressure regression test. */
  get pendingBytes(): number {
    return this.pendingBytesInternal
  }

  constructor(stream: Readable, frameBytes: number) {
    this.stream = stream
    this.frameBytes = frameBytes

    // Bound once so removeListener() in destroy() actually removes them.
    this.onReadable = () => this.pump()
    this.onEnd = () => this.handleEnd()
    this.onError = (err: Error) => this.handleError(err)

    this.stream.on('readable', this.onReadable)
    this.stream.on('end', this.onEnd)
    this.stream.on('error', this.onError)
  }

  /**
   * Resolves the next complete frame, or null once the stream ends cleanly.
   * Rejects on stream error (including errors that arrived before this call).
   *
   * The returned array is a VIEW over an internal buffer valid only until the
   * next `read()` call — copy it (`.slice()`) if you need to keep it past
   * that point (transition snapshots do this).
   */
  read(): Promise<Uint8ClampedArray | null> {
    if (this.waiter) {
      throw new Error('RawFrameReader.read() called while a previous read() is still pending')
    }

    if (this.errored) {
      return Promise.reject(this.errored)
    }

    const framed = this.tryTakeFrame()
    if (framed) return Promise.resolve(framed)

    if (this.ended) {
      return Promise.resolve(this.finishAtEnd())
    }

    return new Promise<Uint8ClampedArray | null>((resolve, reject) => {
      this.waiter = { resolve, reject }
      // A chunk may already be sitting in the stream's internal buffer from
      // before this read() was called (e.g. arrived between two reads).
      this.pump()
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stream.off('readable', this.onReadable)
    this.stream.off('end', this.onEnd)
    this.stream.off('error', this.onError)
    // A destroy() mid-read should not leave a caller hanging forever.
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter.resolve(null)
    }
  }

  /**
   * Pulls only as much as the next frame needs, then settles the waiter if
   * satisfied.
   *
   * Deliberately NOT a "drain everything currently readable" loop: `pending`
   * refilling from the stream's internal buffer makes the stream re-emit
   * 'readable' once that buffer refills from the underlying fd, so an
   * unconditional drain loop here would pull forever regardless of whether
   * anyone is consuming — exactly the flowing-mode-shaped bug this file's own
   * header warns against, just reintroduced one level down. Stopping once
   * `pendingBytes >= frameBytes` leaves the rest sitting in the stream's own
   * (highWaterMark-bounded) buffer, which is what lets Node's/the OS's pipe
   * backpressure actually reach ffmpeg: ffmpeg's stdout write blocks once that
   * buffer is full, and stops being read again only once a caller's `read()`
   * needs the next frame and calls `pump()` (via the 'readable' handler or via
   * `read()` itself installing a waiter) to top the buffer back up.
   */
  private pump(): void {
    if (this.destroyed) return

    while (this.pendingBytesInternal < this.frameBytes) {
      const chunk = this.stream.read() as Buffer | null
      if (chunk === null) break
      if (chunk.length === 0) continue
      this.pending.push(chunk)
      this.pendingBytesInternal += chunk.length
    }

    if (!this.waiter) return

    const framed = this.tryTakeFrame()
    if (framed) {
      const waiter = this.waiter
      this.waiter = null
      waiter.resolve(framed)
      return
    }

    if (this.ended) {
      const waiter = this.waiter
      this.waiter = null
      waiter.resolve(this.finishAtEnd())
    }
  }

  /** Takes exactly `frameBytes` off the front of `pending` if enough has accumulated. */
  private tryTakeFrame(): Uint8ClampedArray | null {
    if (this.pendingBytesInternal < this.frameBytes) return null

    const buf = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.pendingBytesInternal)

    const frame = new Uint8ClampedArray(buf.buffer, buf.byteOffset, this.frameBytes)

    const remainderLength = this.pendingBytesInternal - this.frameBytes
    if (remainderLength > 0) {
      this.pending = [buf.subarray(this.frameBytes)]
    } else {
      this.pending = []
    }
    this.pendingBytesInternal = remainderLength

    return frame
  }

  /** Called once, at end-of-stream, when no more frames can ever complete. */
  private finishAtEnd(): Uint8ClampedArray | null {
    // A partial trailing frame is dropped, never emitted — the caller sees
    // trailingBytes > 0 and can log/warn as it sees fit.
    this.trailingBytes = this.pendingBytesInternal
    this.pending = []
    this.pendingBytesInternal = 0
    return null
  }

  private handleEnd(): void {
    this.ended = true
    this.pump()
  }

  private handleError(err: Error): void {
    this.errored = err
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter.reject(err)
    }
  }
}
