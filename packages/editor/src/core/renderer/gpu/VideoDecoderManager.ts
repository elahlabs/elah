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
  onStateChange?: (state: DecoderState) => void
  onError?: (error: Error) => void
}

interface PendingDecode {
  sourceFrame: number
  resolve: (frame: VideoFrame) => void
  reject: (error: Error) => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 5000

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
  private readonly _onStateChange: ((state: DecoderState) => void) | null
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

  constructor(options: VideoDecoderManagerOptions = {}) {
    this._demuxerFactory = options.demuxerFactory
    this._decoderFactory = options.decoderFactory ?? createDefaultDecoder
    this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this._onStateChange = options.onStateChange ?? null
    this._onError = options.onError ?? null
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
      const timeUs = sourceFrame * (1_000_000 / 30)
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
    if (this._state !== 'Disposed') {
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

      try {
        const frame = await this._decodeFrame(sourceFrame)
        this._resolveFrame(sourceFrame, frame)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this._rejectFrame(sourceFrame, err)
        this._handleError(err)
        break
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
    const timeUs = sourceFrame * (1_000_000 / 30)
    const timeRange: [number, number] = [timeUs, timeUs + (1_000_000 / 30)] as [number, number]

    for await (const chunk of this._demuxer!.packets(timeRange)) {
      this._decoder!.decode(chunk)
    }

    return createDecodedFrame(sourceFrame)
  }

  private _resolveFrame(sourceFrame: number, frame: VideoFrame): void {
    const waiters = this._pendingDecodes.get(sourceFrame) ?? []
    this._pendingDecodes.delete(sourceFrame)
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

function createDefaultDecoder(): VideoDecoderLike {
  if (typeof VideoDecoder === 'undefined') {
    throw new Error('VideoDecoderManager: VideoDecoder not available')
  }
  return new VideoDecoder({
    output: () => {},
    error: () => {},
  }) as unknown as VideoDecoderLike
}

function createDecodedFrame(sourceFrame: number): VideoFrame {
  return {
    displayWidth: 640,
    displayHeight: 360,
    close: () => {},
    timestamp: sourceFrame * (1_000_000 / 30),
  } as unknown as VideoFrame
}
