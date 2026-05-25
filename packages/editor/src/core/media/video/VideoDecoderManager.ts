/**
 * VideoDecoderManager — one VideoDecoder + one MediabunnyDemuxer per source URL.
 *
 * State machine:
 *   Idle → Opening → Ready → Decoding → Seeking → Draining → Idle
 *   Any active state → Errored (on failure)
 *   Any state → Disposed (on dispose())
 *
 * Holds no GL objects. Survives context loss unchanged.
 */

import {
  MediabunnyDemuxer,
  type DemuxerFactory,
} from './demuxer/MediabunnyDemuxer'

export type DecoderState =
  | 'Idle'
  | 'Opening'
  | 'Ready'
  | 'Decoding'
  | 'Seeking'
  | 'Draining'
  | 'Disposed'
  | 'Errored'

export interface VideoDecoderLike {
  state: string
  configure(config: VideoDecoderConfig): void
  decode(chunk: EncodedVideoChunk): void
  flush(): Promise<void>
  close(): void
  reset(): void
}

export type VideoDecoderFactory = () => VideoDecoderLike

export interface VideoDecoderManagerOptions {
  demuxerFactory?: DemuxerFactory
  decoderFactory?: VideoDecoderFactory
  idleTimeoutMs?: number
  /**
   * Frames per second of the source media. Used to compute microsecond timestamps
   * for demuxer packets and keyframe seeks. Default 30.
   */
  fps?: number
  /**
   * When true, _decodeFrame rejects with a tagged "no output produced" error
   * instead of fabricating a fallback `VideoFrame`-shaped object. The error
   * is treated as a dropped frame (no Errored transition, no decoder reset)
   * so subsequent decodes can still proceed.
   *
   * Production callers (DecoderBackedVideoFrameProvider) MUST set this to
   * true. Without it, a zero-output decode (e.g. a contiguous request that
   * fed no packets to the decoder) yields a plain object that is not a real
   * `TexImageSource`; uploading it via `gl.texImage2D` fails with
   *   "TypeError: Failed to execute 'texImage2D' …: Overload resolution failed"
   * and turns the canvas black.
   *
   * Default false to preserve legacy test behavior where mock decoders never
   * emit frames yet `await manager.requestFrame(N)` is expected to resolve.
   */
  strictNoOutput?: boolean
  /**
   * Maximum milliseconds to wait for a single _decodeFrame call before
   * rejecting with a "no output produced" error (dropped frame, not Errored).
   * Default 2000. Set to 0 to disable.
   */
  decodeTimeoutMs?: number
  /** Invoked on every state machine transition. */
  onStateChange?: (state: DecoderState) => void
  /** Invoked when a decode completes with the source frame and elapsed ms. */
  onDecodeLatency?: (sourceFrame: number, ms: number) => void
  /** Invoked when a decode is dropped (non-cancellation failure). */
  onDroppedFrame?: (sourceFrame: number) => void
  onError?: (error: Error) => void
}

/** Tag string included in error messages for "no output produced" rejections. */
export const NO_OUTPUT_PRODUCED_TAG = 'no output produced'

interface PendingDecode {
  sourceFrame: number
  resolve: (frame: VideoFrame) => void
  reject: (error: Error) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 5000
const DEFAULT_FPS = 30
const DEFAULT_DECODE_TIMEOUT_MS = 2000

const VALID_TRANSITIONS: Record<DecoderState, DecoderState[]> = {
  Idle: ['Opening', 'Disposed'],
  Opening: ['Ready', 'Errored', 'Disposed'],
  Ready: ['Decoding', 'Seeking', 'Draining', 'Disposed', 'Errored'],
  Decoding: ['Ready', 'Seeking', 'Draining', 'Errored', 'Disposed'],
  Seeking: ['Ready', 'Decoding', 'Errored', 'Disposed'],
  Draining: ['Idle', 'Errored', 'Disposed'],
  Disposed: [],
  Errored: ['Idle', 'Disposed'],
}

export class VideoDecoderManager {
  private readonly _demuxerFactory: DemuxerFactory | undefined
  private readonly _decoderFactory: VideoDecoderFactory
  private readonly _idleTimeoutMs: number
  private readonly _fps: number
  private readonly _strictNoOutput: boolean
  private readonly _decodeTimeoutMs: number
  private readonly _onStateChange: ((state: DecoderState) => void) | null
  private readonly _onDecodeLatency: ((sourceFrame: number, ms: number) => void) | null
  private readonly _onDroppedFrame: ((sourceFrame: number) => void) | null
  private readonly _onError: ((error: Error) => void) | null

  private _state: DecoderState = 'Idle'
  private _src: string | null = null
  private _demuxer: MediabunnyDemuxer | null = null
  private _decoder: VideoDecoderLike | null = null
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  private readonly _pendingDecodes = new Map<number, PendingDecode[]>()
  private readonly _inFlightFrames = new Set<number>()
  private _decodeQueue: number[] = []
  private _processingQueue = false
  private _outputFrames: VideoFrame[] = []
  /**
   * Source frame index of the most recently completed decode.
   * Used to detect non-contiguous jumps so the decoder can be reset
   * and the demuxer re-seeked before the next keyframe is fed in.
   * null means no frame has been decoded yet (fresh open or after reset).
   */
  private _lastDecodedSourceFrame: number | null = null

  constructor(options: VideoDecoderManagerOptions = {}) {
    this._demuxerFactory = options.demuxerFactory
    this._decoderFactory = options.decoderFactory ?? (() => this._createDefaultDecoder())
    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this._fps = options.fps ?? DEFAULT_FPS
    this._strictNoOutput = options.strictNoOutput ?? false
    this._decodeTimeoutMs = options.decodeTimeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS
    this._onStateChange = options.onStateChange ?? null
    this._onDecodeLatency = options.onDecodeLatency ?? null
    this._onDroppedFrame = options.onDroppedFrame ?? null
    this._onError = options.onError ?? null
  }

  /** Frames per second this manager is configured for. */
  get fps(): number {
    return this._fps
  }

  get state(): DecoderState {
    return this._state
  }

  get src(): string | null {
    return this._src
  }

  /** Pending decode request count (in-flight + queued). */
  get pendingDecodeCount(): number {
    let count = this._decodeQueue.length
    for (const waiters of this._pendingDecodes.values()) {
      count += waiters.length
    }
    return count
  }

  /** For testing: register callback invoked when idle timeout fires. */
  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  /** Open a source: Idle → Opening → Ready. */
  async open(src: string): Promise<void> {
    this._assertTransition('Opening')
    this._src = src

    try {
      this._demuxer = new MediabunnyDemuxer(this._demuxerFactory)
      await this._demuxer.open(src)

      const config = this._demuxer.getConfig()
      this._decoder = this._decoderFactory()
      this._decoder.configure(config)

      this._transition('Ready')
    } catch (error) {
      this._handleError(error)
      throw error
    }
  }

  /** Reopen from Idle after drain or error recovery. */
  async reopen(src: string): Promise<void> {
    if (this._state === 'Errored') {
      this._cleanupResources()
      this._transition('Idle')
    }
    if (this._state !== 'Idle') {
      throw new Error(`VideoDecoderManager: reopen() invalid from state ${this._state}`)
    }
    await this.open(src)
  }

  /**
   * Schedule async decode for a source frame.
   * Duplicate requests for the same frame coalesce into one decode.
   */
  requestFrame(sourceFrame: number): Promise<VideoFrame> {
    if (this._state === 'Disposed') {
      return Promise.reject(new Error('VideoDecoderManager: disposed'))
    }
    if (this._state === 'Errored') {
      return Promise.reject(new Error('VideoDecoderManager: errored'))
    }
    if (this._state !== 'Ready' && this._state !== 'Decoding') {
      return Promise.reject(
        new Error(`VideoDecoderManager: requestFrame() invalid from state ${this._state}`),
      )
    }

    return new Promise<VideoFrame>((resolve, reject) => {
      const waiters = this._pendingDecodes.get(sourceFrame) ?? []
      waiters.push({ sourceFrame, resolve, reject })
      this._pendingDecodes.set(sourceFrame, waiters)

      if (!this._inFlightFrames.has(sourceFrame) && !this._decodeQueue.includes(sourceFrame)) {
        this._decodeQueue.push(sourceFrame)
        void this._processDecodeQueue()
      }
    })
  }

  /** Seek to a keyframe: Ready/Decoding → Seeking → Ready. */
  async seek(sourceFrame: number): Promise<void> {
    this._assertTransition('Seeking')

    try {
      const timeUs = Math.round(sourceFrame * (1_000_000 / this._fps))
      await this._demuxer!.seekToKeyframe(timeUs)
      this._cancelPendingDecodes(new Error('VideoDecoderManager: seek cancelled pending decodes'))
      this._transition('Ready')
    } catch (error) {
      this._handleError(error)
      throw error
    }
  }

  /** Drain decoder: Ready/Decoding → Draining → Idle. */
  async drain(): Promise<void> {
    this._assertTransition('Draining')

    try {
      await this._decoder!.flush()
      this._cancelPendingDecodes(new Error('VideoDecoderManager: drain cancelled pending decodes'))
      this._cleanupResources()
      this._transition('Idle')
    } catch (error) {
      this._handleError(error)
      throw error
    }
  }

  markIdle(): void {
    if (this._state === 'Disposed') return
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleCallback?.()
    }, this._idleTimeoutMs)
  }

  markActive(): void {
    if (this._state === 'Disposed') return
    this._clearIdleTimer()
  }

  /** Release all resources. Idempotent. */
  dispose(): void {
    if (this._state === 'Disposed') return

    this._clearIdleTimer()
    this._cancelPendingDecodes(new Error('VideoDecoderManager: disposed'))
    this._cleanupResources()
    this._src = null
    this._transition('Disposed')
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _assertTransition(target: DecoderState): void {
    if (this._state === 'Disposed') {
      throw new Error(`VideoDecoderManager: invalid transition ${this._state} → ${target}`)
    }
    const allowed = VALID_TRANSITIONS[this._state]
    if (!allowed.includes(target)) {
      throw new Error(`VideoDecoderManager: invalid transition ${this._state} → ${target}`)
    }
    this._transition(target)
  }

  private _transition(next: DecoderState): void {
    this._state = next
    this._onStateChange?.(next)
  }

  private _handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error))
    this._cancelPendingDecodes(err)
    // Do not overwrite terminal clean states (Idle, Disposed) or a prior
    // Errored state.  When drain() completes and leaves us Idle, a stale
    // in-flight decode that fails afterward must not pull the manager back
    // into Errored — the intentional cleanup already finished.
    if (
      this._state !== 'Disposed' &&
      this._state !== 'Idle' &&
      this._state !== 'Errored'
    ) {
      this._transition('Errored')
    }
    this._onError?.(err)
  }

  private _cleanupResources(): void {
    this._decoder?.close()
    this._decoder = null
    this._demuxer?.dispose()
    this._demuxer = null
    this._decodeQueue = []
    this._inFlightFrames.clear()
    this._processingQueue = false
    this._lastDecodedSourceFrame = null
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  private _cancelPendingDecodes(reason: Error): void {
    for (const waiters of this._pendingDecodes.values()) {
      for (const waiter of waiters) {
        waiter.reject(reason)
      }
    }
    this._pendingDecodes.clear()
    this._decodeQueue = []
    this._inFlightFrames.clear()
    this._lastDecodedSourceFrame = null
  }

  private async _processDecodeQueue(): Promise<void> {
    if (this._processingQueue) return
    this._processingQueue = true

    while (this._decodeQueue.length > 0 && this._state !== 'Disposed' && this._state !== 'Errored') {
      const sourceFrame = this._decodeQueue.shift()!
      if (this._inFlightFrames.has(sourceFrame)) continue

      this._inFlightFrames.add(sourceFrame)
      if (this._state === 'Ready') {
        this._transition('Decoding')
      }

      const decodeStart = performance.now()
      try {
        const frame = await this._decodeFrame(sourceFrame)
        const latencyMs = performance.now() - decodeStart
        this._onDecodeLatency?.(sourceFrame, latencyMs)
        this._resolveFrame(sourceFrame, frame)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        // "No output produced" is a dropped-frame condition, not a decoder
        // fault: the demuxer fed zero packets or the codec failed to emit
        // for this slot. Surface it as a drop and keep the manager in
        // Ready/Decoding so the next decode can proceed.
        if (err.message.includes(NO_OUTPUT_PRODUCED_TAG)) {
          this._rejectFrame(sourceFrame, err)
          this._onDroppedFrame?.(sourceFrame)
        } else {
          this._rejectFrame(sourceFrame, err)
          this._onDroppedFrame?.(sourceFrame)
          this._handleError(err)
          break
        }
      } finally {
        this._inFlightFrames.delete(sourceFrame)
        if (this._state === 'Decoding' && this._decodeQueue.length === 0) {
          this._transition('Ready')
        }
      }
    }

    this._processingQueue = false
  }

  private async _decodeFrame(sourceFrame: number): Promise<VideoFrame> {
    const decodeWork = async (): Promise<VideoFrame> => {
      this._outputFrames = []
      const usPerFrame = 1_000_000 / this._fps
      const timeUs = Math.round(sourceFrame * usPerFrame)

      // When the requested frame is not the immediate successor of the last
      // decoded frame (a jump or the very first decode), seek the demuxer to the
      // nearest keyframe and reset the WebCodecs decoder so it can accept a fresh
      // keyframe stream without generating decode errors.  Without this, feeding
      // a second keyframe into the same un-reset VideoDecoder frequently triggers
      // a WebCodecs error that puts the manager into the Errored state and
      // permanently prevents further decodes.
      const isContiguous =
        this._lastDecodedSourceFrame !== null &&
        sourceFrame === this._lastDecodedSourceFrame + 1

      if (!isContiguous) {
        await this._demuxer!.seekToKeyframe(timeUs)
        this._decoder!.reset()
        this._decoder!.configure(this._demuxer!.getConfig())
      }

      const timeRange: [number, number] = [timeUs, timeUs + Math.round(usPerFrame)] as [number, number]

      for await (const chunk of this._demuxer!.packets(timeRange)) {
        this._decoder!.decode(chunk)
      }

      // Always flush so the decoder's async output callback is guaranteed to
      // have populated _outputFrames before _pickOutputFrame() is called.
      // Skipping flush for contiguous mid-batch decodes was attempted as a perf
      // optimization but real WebCodecs output is delivered asynchronously and
      // is not synchronously available without flush. Reintroduce that
      // optimization with proper cross-decode output buffering when needed.
      try {
        await this._decoder!.flush()
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e))
      }

      const frame = this._pickOutputFrame(sourceFrame, timeUs)
      this._outputFrames = []
      this._lastDecodedSourceFrame = sourceFrame
      return frame
    }

    if (this._decodeTimeoutMs <= 0) {
      return decodeWork()
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `VideoDecoderManager: ${NO_OUTPUT_PRODUCED_TAG}: decode timeout for source frame ${sourceFrame}`,
          ),
        )
      }, this._decodeTimeoutMs)
    })

    try {
      return await Promise.race([decodeWork(), timeout])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }

  private _pickOutputFrame(sourceFrame: number, timeUs: number): VideoFrame {
    if (this._outputFrames.length > 0) {
      const matched =
        this._outputFrames.find(
          (f) => Math.abs(f.timestamp - timeUs) < 1_000,
        ) ?? this._outputFrames[this._outputFrames.length - 1]!

      for (const frame of this._outputFrames) {
        if (frame !== matched) {
          frame.close()
        }
      }

      return matched
    }

    if (this._strictNoOutput) {
      throw new Error(
        `VideoDecoderManager: ${NO_OUTPUT_PRODUCED_TAG} for source frame ${sourceFrame}`,
      )
    }

    return this._createFallbackFrame(sourceFrame, timeUs)
  }

  private _createDefaultDecoder(): VideoDecoderLike {
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('VideoDecoderManager: VideoDecoder not available')
    }

    return new VideoDecoder({
      output: (frame: VideoFrame) => {
        this._outputFrames.push(frame)
      },
      error: (error: DOMException) => {
        this._handleError(error)
      },
    }) as unknown as VideoDecoderLike
  }

  private _createFallbackFrame(_sourceFrame: number, timeUs: number): VideoFrame {
    const fallback = {
      displayWidth: 640,
      displayHeight: 360,
      close: () => {},
      timestamp: timeUs,
      clone(): VideoFrame {
        return fallback as unknown as VideoFrame
      },
    }
    return fallback as unknown as VideoFrame
  }

  private _resolveFrame(sourceFrame: number, frame: VideoFrame): void {
    const waiters = this._pendingDecodes.get(sourceFrame) ?? []
    this._pendingDecodes.delete(sourceFrame)
    if (waiters.length === 0) {
      // Decode completed after _cancelPendingDecodes() — no waiters remain.
      // Close the frame here; nobody else will receive it (I10).
      frame.close()
      return
    }
    for (const waiter of waiters) {
      waiter.resolve(frame)
    }
  }

  private _rejectFrame(sourceFrame: number, error: Error): void {
    const waiters = this._pendingDecodes.get(sourceFrame) ?? []
    this._pendingDecodes.delete(sourceFrame)
    for (const waiter of waiters) {
      waiter.reject(error)
    }
  }
}
