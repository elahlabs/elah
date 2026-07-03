/**
 * VideoDecoderManager — push-based decoder wrapper (PR-02).
 *
 * Simplified API replacing the old pull-based requestFrame/flush-per-call model:
 *  - feed(timeRangeUs)  — fire-and-forget; packets fed to decoder; frames arrive via onFrame
 *  - reset(toKeyframeUs) — seek demuxer + reset decoder (discontinuity handling)
 *  - onFrame             — callback; producer sets this to receive decoded frames
 *  - drain()             — flush decoder before dispose; not called on contiguous feed path
 *
 * The decoder stays warm across contiguous feed() calls (no per-request flush).
 * reset() increments the feed-generation counter so stale async feed loops exit cleanly.
 *
 * State machine:
 *   Idle → Opening → Ready ↔ Resetting
 *   Ready → Draining → Idle
 *   Any active state → Errored → Idle (reopen) or Disposed
 *   Any state → Disposed
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
  | 'Resetting'
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

/**
 * Factory that receives the output and error handlers from VideoDecoderManager.
 * Injecting handlers into the factory enables test mocks to fire frame output
 * and error callbacks without a real WebCodecs runtime.
 */
export type VideoDecoderFactory = (
  output: (frame: VideoFrame) => void,
  error: (e: DOMException) => void,
) => VideoDecoderLike

export interface VideoDecoderManagerOptions {
  demuxerFactory?: DemuxerFactory
  decoderFactory?: VideoDecoderFactory
  idleTimeoutMs?: number
  /**
   * Frames per second of the source media. Used to compute source frame indices
   * from decoder output timestamps: `Math.round(timestamp / usPerFrame)`.
   * Default 30.
   */
  fps?: number
  /** Invoked on every state machine transition. */
  onStateChange?: (state: DecoderState) => void
  /** Invoked when a decode is dropped (non-cancellation failure). */
  onDroppedFrame?: (sourceFrameIdx: number) => void
  onError?: (error: Error) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 5000
const DEFAULT_FPS = 30
/**
 * Hardware VideoDecoder queues are typically capped at 8-16 pending decode
 * requests. Exceeding the cap throws QuotaExceededError, which crashes the
 * decoder and forces a full reopen (clearing the frame cache in the process).
 * We yield to the event loop whenever the queue reaches this depth so the
 * decoder can drain some frames before we push more — especially important
 * for 4K/UHD content where frames are large and output is slower.
 *
 * The cast to `{ decodeQueueSize?: number }` is safe: real VideoDecoder
 * always exposes this; test mocks don't, so the check is a no-op for tests.
 */
const MAX_DECODE_QUEUE_DEPTH = 4

/**
 * Toggle in DevTools: `window.__VDM_DEBUG__ = true` to enable per-feed +
 * per-packet + per-frame decoder traces.
 */
function _vdmTrace(msg: string, data?: Record<string, unknown>): void {
  if (typeof globalThis !== 'undefined' && (globalThis as { __VDM_DEBUG__?: boolean }).__VDM_DEBUG__) {
    if (data) {
      console.log(`[VDM-TRACE] ${msg}`, data)
    } else {
      console.log(`[VDM-TRACE] ${msg}`)
    }
  }
}

const VALID_TRANSITIONS: Record<DecoderState, DecoderState[]> = {
  Idle: ['Opening', 'Disposed'],
  Opening: ['Ready', 'Errored', 'Disposed'],
  Ready: ['Resetting', 'Draining', 'Disposed', 'Errored'],
  Resetting: ['Ready', 'Errored', 'Disposed'],
  Draining: ['Idle', 'Errored', 'Disposed'],
  Disposed: [],
  Errored: ['Idle', 'Disposed'],
}

export class VideoDecoderManager {
  /**
   * Callback invoked for each decoded VideoFrame. Set by the producer.
   * The callback receives the frame (with ownership transferred — must close or store)
   * and the source frame index derived from frame.timestamp.
   *
   * A frame that arrives after reset() (stale generation) may still reach this callback
   * if the decoder had buffered output. The producer should check the sourceFrameIdx
   * against its current window and close stale frames.
   */
  onFrame: ((frame: VideoFrame, sourceFrameIdx: number) => void) | null = null

  private readonly _demuxerFactory: DemuxerFactory | undefined
  private readonly _decoderFactory: VideoDecoderFactory
  private readonly _idleTimeoutMs: number
  private readonly _fps: number
  private readonly _onStateChange: ((state: DecoderState) => void) | null
  private readonly _onDroppedFrame: ((sourceFrameIdx: number) => void) | null
  private readonly _onError: ((error: Error) => void) | null

  private _state: DecoderState = 'Idle'
  private _src: string | null = null
  private _demuxer: MediabunnyDemuxer | null = null
  private _decoder: VideoDecoderLike | null = null
  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  /**
   * Incremented on every reset() call. _feedAsync loops check this before
   * calling decoder.decode() so stale loops exit without feeding the decoder.
   */
  private _feedGeneration = 0

  /**
   * True while an _feedAsync loop is running. Only one feed loop may run at
   * a time because MediabunnyDemuxer.packets() is a stateful generator that
   * is NOT safe for concurrent iteration (it mutates _seekPacket/_nextPacket).
   */
  private _feedActive = false

  /**
   * Coalesced range queued while _feedActive is true. When the active feed
   * loop completes it picks this up and runs immediately.
   * start = min of all queued starts, end = max of all queued ends.
   */
  private _feedPendingRange: [number, number] | null = null

  constructor(options: VideoDecoderManagerOptions = {}) {
    this._demuxerFactory = options.demuxerFactory
    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this._fps = options.fps ?? DEFAULT_FPS
    this._onStateChange = options.onStateChange ?? null
    this._onDroppedFrame = options.onDroppedFrame ?? null
    this._onError = options.onError ?? null

    this._decoderFactory = options.decoderFactory ?? ((output, error) => {
      if (typeof VideoDecoder === 'undefined') {
        throw new Error('VideoDecoderManager: VideoDecoder not available')
      }
      return new VideoDecoder({ output, error }) as unknown as VideoDecoderLike
    })
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

      // optimizeForLatency tells the decoder to emit frames ASAP with minimal
      // output buffering. Without it the decoder holds frames back for B-frame
      // reordering, and a non-burst feed can leave it sitting on output — a key
      // contributor to the mid-playback freeze. See frame-lifecycle-and-decode-stall.md.
      const config: VideoDecoderConfig = {
        ...this._demuxer.getConfig(),
        optimizeForLatency: true,
      }
      const usPerFrame = 1_000_000 / this._fps
      this._decoder = this._decoderFactory(
        (frame: VideoFrame) => {
          if (this._state === 'Disposed') {
            frame.close()
            return
          }
          if (this.onFrame) {
            const sourceFrameIdx = Math.round(frame.timestamp / usPerFrame)
            _vdmTrace('decoder.output → onFrame', {
              sourceFrameIdx,
              timestampUs: frame.timestamp,
              decoderQueueSize: this._decoder
                ? (this._decoder as { decodeQueueSize?: number }).decodeQueueSize
                : undefined,
              state: this._state,
            })
            this.onFrame(frame, sourceFrameIdx)
          } else {
            frame.close()
          }
        },
        (error: DOMException) => {
          _vdmTrace('decoder.error', { message: error.message })
          this._handleError(error)
        },
      )
      this._decoder.configure(config)

      this._transition('Ready')
    } catch (error) {
      this._handleError(error)
      throw error
    }
  }

  /** Reopen from Idle after drain or error recovery. */
  async reopen(src: string): Promise<void> {
    // Invalidate any in-flight _feedAsync loop BEFORE tearing down the old
    // decoder/demuxer. A feed loop parked in an await (demuxer generator or the
    // backpressure setTimeout) would otherwise wake up after open() has swapped
    // in a fresh decoder, pass its gen/state guards (reopen never bumped the
    // generation), and call decode() with a mid-stream DELTA packet on a decoder
    // that has no reference frame — throwing EncodingError, which reopens again:
    // a self-sustaining decode-error loop. Bumping the generation and clearing
    // the serialization flags makes the stale loop exit at its next guard check,
    // exactly as reset() and dispose() already do.
    this._feedGeneration++
    this._feedActive = false
    this._feedPendingRange = null

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
   * Feed packets for a time range to the decoder. Returns immediately.
   * Decoded frames arrive asynchronously via the onFrame callback.
   *
   * No-op when state is not Ready. Must only be called from Ready state;
   * call reset() to handle discontinuities before feeding.
   *
   * Only one _feedAsync loop runs at a time (the demuxer packets() generator
   * is stateful and not concurrent-safe). When a loop is already active,
   * the new range is coalesced into _feedPendingRange and started automatically
   * when the current loop finishes.
   */
  feed(timeRangeUs: [number, number]): void {
    if (this._state !== 'Ready') {
      _vdmTrace('feed dropped — state not Ready', {
        state: this._state,
        timeRangeUs,
      })
      return
    }
    if (this._feedActive) {
      // Coalesce: keep earliest start, latest end.
      if (this._feedPendingRange === null) {
        this._feedPendingRange = timeRangeUs
      } else {
        this._feedPendingRange = [
          Math.min(this._feedPendingRange[0], timeRangeUs[0]),
          Math.max(this._feedPendingRange[1], timeRangeUs[1]),
        ]
      }
      _vdmTrace('feed coalesced into pending', {
        incomingRange: timeRangeUs,
        coalescedPending: this._feedPendingRange,
        decoderQueueSize: this._decoder
          ? (this._decoder as { decodeQueueSize?: number }).decodeQueueSize
          : undefined,
      })
      return
    }
    this._feedActive = true
    const gen = this._feedGeneration
    _vdmTrace('feed → _feedAsync start', {
      timeRangeUs,
      gen,
      decoderQueueSize: this._decoder
        ? (this._decoder as { decodeQueueSize?: number }).decodeQueueSize
        : undefined,
    })
    void this._feedAsync(timeRangeUs, gen)
  }

  /**
   * Seek demuxer to keyframe then reset+reconfigure the decoder.
   * Ready → Resetting → Ready.
   *
   * Increments the feed-generation counter so any in-progress _feedAsync
   * loops abandon packet delivery. Called on discontinuity by the producer.
   */
  async reset(toKeyframeUs: number): Promise<void> {
    if (this._state === 'Disposed' || this._state === 'Errored') return
    if (this._state !== 'Ready') {
      throw new Error(`VideoDecoderManager: reset() invalid from state ${this._state}`)
    }

    // Cancel in-progress feeds before touching the decoder.
    this._feedGeneration++
    // Clear serialization state immediately so the next feed() after reset()
    // returns starts fresh rather than coalescing into a stale pending range.
    this._feedActive = false
    this._feedPendingRange = null

    this._assertTransition('Resetting')
    try {
      await this._demuxer!.seekToKeyframe(toKeyframeUs)
      this._decoder!.reset()
      this._decoder!.configure({
        ...this._demuxer!.getConfig(),
        optimizeForLatency: true,
      })
      this._transition('Ready')
    } catch (error) {
      this._handleError(error)
      throw error
    }
  }

  /**
   * DIAGNOSTIC ONLY: force the decoder to flush its reorder buffer (DPB) so any
   * decoded-but-not-yet-presented frames fire through onFrame immediately.
   * Does NOT change state or tear down the decoder. After this, the decoder
   * requires a keyframe for the next decode() — so playback will need a reset()
   * to continue. Used to confirm whether frames are held in the decoder's DPB.
   */
  async debugFlush(): Promise<void> {
    if (this._state !== 'Ready' || !this._decoder) return
    _vdmTrace('debugFlush → decoder.flush()', {
      decoderQueueSize: (this._decoder as { decodeQueueSize?: number }).decodeQueueSize,
    })
    await this._decoder.flush()
    _vdmTrace('debugFlush complete', {})
  }

  /**
   * Drain the decoder: flush remaining output, then transition Idle.
   * Use only during dispose. Not called on the contiguous feed path.
   */
  async drain(): Promise<void> {
    if (this._state === 'Disposed') return
    this._assertTransition('Draining')

    try {
      await this._decoder!.flush()
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
    this._feedGeneration++
    this._feedActive = false
    this._feedPendingRange = null
    this._clearIdleTimer()
    this._cleanupResources()
    this._src = null
    this._transition('Disposed')
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _feedAsync(timeRangeUs: [number, number], gen: number): Promise<void> {
    let packetCount = 0
    let firstTimestampUs: number | null = null
    let lastTimestampUs: number | null = null
    let stateNotReadyExit = false
    try {
      for await (const chunk of this._demuxer!.packets(timeRangeUs)) {
        // Exit if a reset() or dispose() was called during this feed.
        // Do NOT touch _feedActive or _feedPendingRange here — reset() has
        // already cleared them synchronously so they now belong to a newer feed.
        if (gen !== this._feedGeneration) {
          _vdmTrace('_feedAsync stale-gen exit during iteration', {
            gen,
            currentGen: this._feedGeneration,
            packetsConsumed: packetCount,
          })
          return
        }
        if (this._state !== 'Ready') {
          _vdmTrace('_feedAsync state-not-Ready exit during iteration', {
            state: this._state,
            packetsConsumed: packetCount,
          })
          stateNotReadyExit = true
          break
        }
        if (firstTimestampUs === null) firstTimestampUs = chunk.timestamp
        lastTimestampUs = chunk.timestamp

        // Backpressure: if the hardware decoder's pending queue is at the
        // threshold, yield to the event loop before queueing the next packet.
        // One macrotask boundary is enough for the decoder to output frames
        // and reduce decodeQueueSize below the hard browser limit (~8–16).
        // Test mocks don't expose decodeQueueSize → the cast returns undefined
        // → the check is skipped → no change to test behaviour.
        const queueDepth = (this._decoder as { decodeQueueSize?: number }).decodeQueueSize
        if (queueDepth !== undefined && queueDepth >= MAX_DECODE_QUEUE_DEPTH) {
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          // Re-validate after the yield — state may have changed.
          if (gen !== this._feedGeneration) return
          if (this._state !== 'Ready') {
            stateNotReadyExit = true
            break
          }
        }

        this._decoder!.decode(chunk)
        packetCount++
      }
      // NB: no flush() here. WebCodecs requires the next decode() after flush()
      // to be a key frame, which breaks contiguous (delta-frame) feeding. The
      // decoder stays warm across contiguous feed() calls instead.
    } catch (error) {
      if (gen === this._feedGeneration && this._state !== 'Disposed') {
        // Error in current generation — clean up and surface.
        this._feedActive = false
        this._feedPendingRange = null
        _vdmTrace('_feedAsync ERROR', {
          gen,
          packetCount,
          error: error instanceof Error ? error.message : String(error),
        })
        const err = error instanceof Error ? error : new Error(String(error))
        this._onDroppedFrame?.(0)
        this._handleError(err)
      }
      // Stale-gen errors are silently dropped (generation already cleared state).
      return
    }

    // State-not-Ready exit (decoder errored mid-decode and transitioned to
    // Errored). Clear _feedActive so the producer can drive recovery via
    // a future reset() without coalescing into a stuck pending range.
    if (stateNotReadyExit) {
      if (gen === this._feedGeneration) {
        this._feedActive = false
        this._feedPendingRange = null
      }
      return
    }

    // Normal completion — check gen before touching shared state.
    if (gen !== this._feedGeneration) return  // Became stale during final iteration.

    // Start the coalesced pending range if one accumulated while we were busy.
    const pending = this._feedPendingRange
    this._feedPendingRange = null
    this._feedActive = false

    _vdmTrace('_feedAsync completed', {
      timeRangeUs,
      packetCount,
      firstTimestampUs,
      lastTimestampUs,
      hasPending: pending !== null,
      pending,
      decoderQueueSize: this._decoder
        ? (this._decoder as { decodeQueueSize?: number }).decodeQueueSize
        : undefined,
    })

    if (pending !== null && this._state === 'Ready') {
      this._feedActive = true
      _vdmTrace('_feedAsync chaining pending', { pending })
      void this._feedAsync(pending, this._feedGeneration)
    }
  }

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
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

}
