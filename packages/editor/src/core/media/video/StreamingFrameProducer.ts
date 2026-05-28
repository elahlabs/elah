/**
 * StreamingFrameProducer — push-based VideoFrameProvider backed by VideoDecoderManager.
 *
 * Replaces DecoderBackedVideoFrameProvider (PR-02). Key differences:
 *  - Push model: setPlayhead() drives forward decode. VideoLayer only calls
 *    setPlayhead() + getCurrent(); no requestFrame / prefetch.
 *  - Decoder stays warm across contiguous setPlayhead() calls (no per-request flush).
 *  - Discontinuity detection: |Δplayhead| > 1 triggers reset(keyframeUs) which seeks
 *    the demuxer and cold-starts the decoder from the nearest keyframe.
 *  - Feed-watermark tracks the highest frame fed to the decoder so overlapping
 *    setPlayhead() calls don't re-feed the same packets.
 *
 * Ownership invariants (I10):
 *  - VideoDecoder.output → onFrame callback → cache.put (ownership to cache).
 *  - Stale frames (arrived after dispose) are closed immediately.
 *  - FrameCache owns all stored frames; evicted frames are closed by the cache.
 *
 * @see architecture.md §6 for the pipeline contract.
 */

import type { VideoFrameProvider } from './VideoFrameProvider'
import { FrameCache, type FrameCacheHooks } from './FrameCache'
import { GpuDebugCounters } from '../../renderer/gpu/debug/GpuDebugCounters'
import { VideoDecoderManager } from './VideoDecoderManager'
import type { DemuxerFactory } from './demuxer/MediabunnyDemuxer'
import type { VideoDecoderFactory } from './VideoDecoderManager'

const DEFAULT_FPS = 30
// 16 frames = ~533ms at 30fps. Gives the decoder a larger buffer so cache
// misses don't stall the render path while packets are in flight.
const DEFAULT_LOOKAHEAD_FRAMES = 16
// 60 frames = 2 seconds at 30fps. Keeps a 2s window so seeks and resets
// have enough room to warm the decoder before hitting the playhead.
const DEFAULT_MAX_FRAMES = 60
const DEFAULT_IDLE_TIMEOUT_MS = 5_000

type ProviderState = 'active' | 'idle' | 'disposed'

/**
 * Toggle in DevTools console: `window.__SFP_DEBUG__ = true` to enable
 * detailed `[SFP-TRACE]` logging of every setPlayhead + cache.put + feed window.
 */
function _sfpTrace(msg: string, data?: Record<string, unknown>): void {
  if (typeof globalThis !== 'undefined' && (globalThis as { __SFP_DEBUG__?: boolean }).__SFP_DEBUG__) {
    if (data) {
      console.log(`[SFP-TRACE] ${msg}`, data)
    } else {
      console.log(`[SFP-TRACE] ${msg}`)
    }
  }
}

export interface StreamingFrameProducerOptions {
  /** Source URL passed to VideoDecoderManager.open(). */
  src: string
  /** Frames per second. Default 30. */
  fps?: number
  /** Frames to decode ahead of the playhead. Default 8. */
  lookaheadFrames?: number
  /** Max decoded frames to hold in the LRU cache. Default 30. */
  maxFrames?: number
  /** Injected demuxer factory. Required for real decode; tests inject a mock. */
  demuxerFactory: DemuxerFactory
  /** Optional decoder factory override (tests inject mocks). */
  decoderFactory?: VideoDecoderFactory
  /** Optional FrameCache instrumentation hooks. */
  cacheHooks?: FrameCacheHooks
}

export class StreamingFrameProducer implements VideoFrameProvider {
  private readonly _src: string
  private readonly _fps: number
  private readonly _lookaheadFrames: number
  private readonly _usPerFrame: number
  private readonly _cache: FrameCache
  private readonly _manager: VideoDecoderManager

  private _state: ProviderState = 'active'
  /**
   * The last playhead that completed a successful feed cycle.
   * null means no successful feed has occurred yet (triggers first-call reset).
   */
  private _lastPlayhead: number | null = null
  /**
   * The most recent playhead seen by setPlayhead(), including calls during reset.
   * Used so the post-reset feed targets the freshest position.
   */
  private _latestPlayhead: number | null = null
  /**
   * Highest frame index for which feed() has been called on the manager.
   * Prevents re-feeding the same packet range on consecutive ticks.
   * Cleared to -1 on each reset.
   */
  private _feedWatermark = -1
  /**
   * Highest source frame index actually delivered by the decoder (via onFrame).
   * Decode normally LEADS the playhead. When the playhead outruns this by more
   * than half the lookahead despite the watermark showing we fed ahead, the
   * decoder has silently stalled (e.g. it reports Ready but stops emitting
   * frames) — setPlayhead forces a discontinuity to re-seek and restart output.
   * Cleared to -1 on every reset/reopen.
   */
  private _highestDecodedFrame = -1
  /** True while an async reset is in progress. Prevents concurrent resets. */
  private _resetInProgress = false
  /** Last sourceFrame that produced a [SFP-TRACE] setPlayhead log. Suppresses identical steady-state spam. */
  private _lastLoggedPlayhead: number | null = null

  private _idleTimer: ReturnType<typeof setTimeout> | null = null
  private _idleCallback: (() => void) | null = null

  private _openPromise: Promise<void> | null = null
  private _openError: Error | null = null
  private _reopening = false

  constructor(opts: StreamingFrameProducerOptions) {
    this._src = opts.src
    this._fps = opts.fps ?? DEFAULT_FPS
    this._lookaheadFrames = opts.lookaheadFrames ?? DEFAULT_LOOKAHEAD_FRAMES
    this._usPerFrame = 1_000_000 / this._fps

    this._cache = new FrameCache({
      maxFrames: opts.maxFrames ?? DEFAULT_MAX_FRAMES,
      hooks: opts.cacheHooks,
    })

    this._manager = new VideoDecoderManager({
      fps: this._fps,
      demuxerFactory: opts.demuxerFactory,
      decoderFactory: opts.decoderFactory,
      onDroppedFrame: () => {
        GpuDebugCounters.incDropped()
      },
      onError: (err) => {
        if (this._state === 'disposed' || this._reopening) return
        // Surface the underlying decoder/demuxer error so it doesn't get
        // swallowed by the automatic reopen. Critical for diagnosing
        // mid-playback stalls (e.g. WebCodecs internal failure).
        console.warn(
          '[StreamingFrameProducer] decoder errored — reopening manager:',
          err,
        )
        this._reopening = true
        // After reopen the manager is fresh: no seek, no frames decoded.
        // Reset producer bookkeeping so the next setPlayhead() is treated as
        // a discontinuity, which forces a seek-to-keyframe before the next
        // feed. Without this, _feedWindow() would skip feeding (watermark
        // is still ahead of N+lookahead) OR feed a non-keyframe packet into
        // a freshly-configured decoder, triggering another error → infinite
        // reopen loop and a permanent black frame.
        this._lastPlayhead = null
        this._feedWatermark = -1
        this._highestDecodedFrame = -1
        this._cache.clear()
        GpuDebugCounters.cacheSize = 0
        _sfpTrace('manager error → reopen + bookkeeping reset', {
          error: err instanceof Error ? err.message : String(err),
        })
        this._openPromise = this._manager
          .reopen(this._src)
          .catch((reopenErr: Error) => {
            this._openError = reopenErr
          })
          .finally(() => {
            this._reopening = false
          })
      },
    })

    // Route each decoded VideoFrame into the cache (I10: ownership transferred to cache).
    // Frames that arrive after dispose are closed immediately to prevent leaks.
    this._manager.onFrame = (frame: VideoFrame, sourceFrameIdx: number) => {
      if (this._state === 'disposed') {
        frame.close()
        return
      }

      // Gap detector: fires once per missing index, not per RAF.
      // rawIndex is the unrounded value — e.g. 3.75 rounds to 4, skipping 3.
      // A pattern of rawIndex = N + 0.75 every 5 frames means fps mismatch
      // (video encoded at fps_v but decoder indexing at fps_p ≠ fps_v).
      const prevHighest = this._highestDecodedFrame
      if (prevHighest >= 0 && sourceFrameIdx > prevHighest + 1) {
        _sfpTrace('onFrame INDEX GAP', {
          expected: prevHighest + 1,
          got: sourceFrameIdx,
          skipped: sourceFrameIdx - prevHighest - 1,
          rawTimestampUs: frame.timestamp,
          rawIndex: frame.timestamp / this._usPerFrame,
        })
      }

      this._cache.put(sourceFrameIdx, frame)
      if (sourceFrameIdx > this._highestDecodedFrame) {
        this._highestDecodedFrame = sourceFrameIdx
      }
      GpuDebugCounters.cacheSize = this._cache.size
      _sfpTrace('onFrame → cache.put', {
        sourceFrameIdx,
        timestampUs: frame.timestamp,
        cacheSize: this._cache.size,
        lastPlayhead: this._lastPlayhead,
      })
    }

    this._openPromise = this._manager.open(this._src).catch((err: Error) => {
      this._openError = err
    })

    _sfpTrace('init', {
      fps: this._fps,
      usPerFrame: this._usPerFrame,
      lookaheadFrames: this._lookaheadFrames,
    })
  }

  // ---------------------------------------------------------------------------
  // VideoFrameProvider interface
  // ---------------------------------------------------------------------------

  /**
   * Synchronous cache lookup. Returns a borrowed reference or null.
   * Never awaits. Invariant I1.
   */
  getCurrent(sourceFrame: number): VideoFrame | null {
    if (this._state === 'disposed') return null

    this._cache.setPivot(sourceFrame)
    // maxLookback=2 bridges fps-mismatch index gaps (e.g. 24fps video on 30fps
    // project skips one slot every 5 frames). See known-bugs.md: KB-001.
    const frame = this._cache.get(sourceFrame, 2)
    if (frame !== null) {
      GpuDebugCounters.cacheHits++
    } else {
      GpuDebugCounters.cacheMisses++
      _sfpTrace('getCurrent MISS', {
        sourceFrame,
        cacheSize: this._cache.size,
        watermark: this._feedWatermark,
        managerState: this._manager.state,
        cacheKeys: this._cacheKeysSnapshot(),
      })
    }
    GpuDebugCounters.cacheSize = this._cache.size
    return frame
  }

  /** Internal: snapshot current cache keys for diagnostic logging. */
  private _cacheKeysSnapshot(): number[] {
    const keys: number[] = []
    const cacheWithKeys = this._cache as unknown as {
      _frames?: Map<number, unknown>
    }
    const frames = cacheWithKeys._frames
    if (frames) {
      for (const k of frames.keys()) keys.push(k)
    }
    return keys.sort((a, b) => a - b)
  }

  /**
   * Declare the playhead position. Drives forward decode.
   *
   * On each call:
   *  1. Updates the cache pivot for eviction ordering.
   *  2. If |N - lastPlayhead| > 1 (or first call) → discontinuity:
   *     fires an async reset (seek demuxer to keyframe, reset decoder),
   *     then feeds the lookahead window from the freshest playhead position.
   *  3. Otherwise → contiguous: feeds any new frames needed to cover [N, N+lookahead].
   *
   * Returns immediately — never awaits.
   */
  setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }): void {
    if (this._state === 'disposed') return

    this._cache.setPivot(sourceFrame)
    this._latestPlayhead = sourceFrame

    if (this._resetInProgress) {
      _sfpTrace('setPlayhead while reset in-progress', {
        sourceFrame,
        latestPlayhead: this._latestPlayhead,
      })
      return
    }

    const lookahead = opts?.lookaheadFrames ?? this._lookaheadFrames
    // A delta of > lookahead means the cache can't cover the gap — genuine seek.
    // A delta of 1..lookahead means we can just extend the feed window forward
    // without resetting the decoder. This prevents spurious reset cascades when
    // the open/reset takes longer than one video frame (~33ms at 30fps) and
    // _latestPlayhead has quietly advanced by 2-3 frames before _lastPlayhead is set.
    // Stall detection: decode normally LEADS the playhead. If the playhead has
    // moved past the highest decoded frame by more than half the lookahead even
    // though we already fed up to (or past) this position, the decoder has
    // silently stopped emitting — feeding more won't help because _feedWindow
    // is gated by the watermark. Treat it as a discontinuity so we re-seek to
    // the current keyframe and cold-start the decoder, breaking the freeze.
    const stalled =
      this._lastPlayhead !== null &&
      this._manager.state === 'Ready' &&
      this._feedWatermark >= sourceFrame &&
      sourceFrame - this._highestDecodedFrame > Math.floor(lookahead / 2)

    const isDiscontinuity =
      this._lastPlayhead === null ||
      Math.abs(sourceFrame - this._lastPlayhead) > lookahead ||
      stalled

    // Only log when the frame advances, or when something interesting happens
    // (discontinuity, stall). Suppresses the 60fps steady-state spam.
    if (isDiscontinuity || stalled || sourceFrame !== this._lastLoggedPlayhead) {
      _sfpTrace('setPlayhead', {
        sourceFrame,
        lastPlayhead: this._lastPlayhead,
        watermark: this._feedWatermark,
        highestDecoded: this._highestDecodedFrame,
        managerState: this._manager.state,
        cacheSize: this._cache.size,
        stalled,
        isDiscontinuity,
      })
      this._lastLoggedPlayhead = sourceFrame
    }

    if (isDiscontinuity) {
      this._resetInProgress = true
      void this._handleDiscontinuity(sourceFrame, lookahead)
      return
    }

    this._lastPlayhead = sourceFrame
    this._feedWindow(sourceFrame, lookahead)
  }

  markIdle(): void {
    if (this._state === 'disposed') return
    this._state = 'idle'
    this._clearIdleTimer()
    this._idleTimer = setTimeout(() => {
      this._idleCallback?.()
    }, DEFAULT_IDLE_TIMEOUT_MS)
    this._manager.markIdle()
  }

  markActive(): void {
    if (this._state === 'disposed') return
    this._clearIdleTimer()
    this._state = 'active'
    this._manager.markActive()
  }

  dispose(): void {
    if (this._state === 'disposed') return
    this._state = 'disposed'
    this._clearIdleTimer()
    this._manager.dispose()
    this._cache.dispose()
    GpuDebugCounters.cacheSize = 0
  }

  // ---------------------------------------------------------------------------
  // Test / diagnostic surface
  // ---------------------------------------------------------------------------

  get state(): ProviderState {
    return this._state
  }

  /**
   * Exposes the underlying VideoDecoderManager state for the GPU debug panel.
   * VideoLayer reads `provider.decoderState` to populate "Decoders:" in the
   * overlay; without this getter it showed "(none)" even when the decoder was
   * healthy.
   */
  get decoderState(): string {
    return this._manager.state
  }

  get cacheSize(): number {
    return this._cache.size
  }

  get openError(): Error | null {
    return this._openError
  }

  /**
   * Returns the open promise so callers can await readiness in tests.
   * The render path never awaits this.
   */
  get openPromise(): Promise<void> | null {
    return this._openPromise
  }

  /** For testing: register a callback invoked when idle timeout fires. */
  setIdleCallback(cb: (() => void) | null): void {
    this._idleCallback = cb
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Handle a playhead discontinuity:
   *  1. Await the initial open (if not yet complete).
   *  2. Seek the demuxer to the keyframe before toKeyframeUs.
   *  3. Reset the decoder.
   *  4. Feed the lookahead window from the freshest playhead.
   */
  private async _handleDiscontinuity(sourceFrame: number, lookahead: number): Promise<void> {
    // Await the initial open so reset() is valid.
    if (this._openPromise) {
      await this._openPromise
      this._openPromise = null
    }

    if (this._state === 'disposed') {
      this._resetInProgress = false
      return
    }

    if (this._manager.state !== 'Ready') {
      // Open failed or manager is in an unexpected state.
      this._resetInProgress = false
      return
    }

    this._feedWatermark = -1

    // The frame we actually sought to. Saved so _feedWindow starts from the
    // keyframe anchor, not from _latestPlayhead, even if the RAF advanced
    // several frames during the async open/reset.
    let seekAnchorFrame = sourceFrame

    try {
      const toKeyframeUs = Math.round(sourceFrame * this._usPerFrame)
      await this._manager.reset(toKeyframeUs)
      this._lastPlayhead = this._latestPlayhead ?? sourceFrame
      // Baseline the stall detector to the post-reset playhead so it doesn't
      // immediately re-trip on the stale pre-reset value. Decode will deliver
      // frames from the seek anchor; if it still doesn't, the watchdog fires
      // again ~lookahead/2 frames later and retries.
      this._highestDecodedFrame = this._lastPlayhead
      seekAnchorFrame = sourceFrame
    } catch {
      // manager transitions to Errored; the onError handler will reopen.
      // _lastPlayhead intentionally left unset so the next setPlayhead is
      // still treated as a discontinuity and retries the reset after reopen.
    } finally {
      this._resetInProgress = false
      if (this._latestPlayhead !== null) {
        // Feed from the keyframe anchor through to latestPlayhead + lookahead.
        // This ensures the decoder gets all reference frames it needs even when
        // _latestPlayhead advanced several frames during the async reset.
        const targetPlayhead = this._latestPlayhead
        const totalLookahead = Math.max(targetPlayhead - seekAnchorFrame, 0) + lookahead
        _sfpTrace('_handleDiscontinuity complete → _feedWindow', {
          seekAnchorFrame,
          targetPlayhead,
          totalLookahead,
          watermark: this._feedWatermark,
        })
        this._feedWindow(seekAnchorFrame, totalLookahead)
      }
    }
  }

  /**
   * Feed the manager for the window [N, N+lookahead] if not already covered.
   *
   * Uses a feed-watermark to avoid re-feeding the same packet ranges across
   * consecutive ticks. The manager's fire-and-forget feed() API handles
   * the async packet iteration; frames arrive via the onFrame callback.
   */
  private _feedWindow(N: number, lookahead: number): void {
    if (this._state === 'disposed') return
    if (this._manager.state !== 'Ready') return

    const windowEnd = N + lookahead
    if (windowEnd <= this._feedWatermark) return

    // Pick up from where we left off (or from N on first call / after reset).
    const feedStart = Math.max(this._feedWatermark + 1, N)
    if (feedStart > windowEnd) return

    const startUs = Math.round(feedStart * this._usPerFrame)
    const endUs = Math.round((windowEnd + 1) * this._usPerFrame)

    _sfpTrace('_feedWindow → manager.feed', {
      N,
      feedStart,
      windowEnd,
      startUs,
      endUs,
      previousWatermark: this._feedWatermark,
    })

    this._manager.feed([startUs, endUs])
    this._feedWatermark = windowEnd
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }
}
