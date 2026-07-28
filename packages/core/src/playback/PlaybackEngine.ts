/**
 * PlaybackEngine — anchor-and-integrate playback clock.
 *
 * Framework-agnostic: no React, no Zustand imports.
 * Timeline.tsx wires it to the Zustand store via subscribe().
 *
 * Design contract:
 *  - play / pause / seek / setPlaybackRate are the only mutation entry-points
 *  - subscribe() delivers a snapshot on transport events + integer frame advances
 *  - subscribeTimeupdate() delivers throttled snapshots (~10 Hz) for UI labels
 *  - destroy() must be called when the engine is no longer needed (stops RAF)
 */

import { trace } from '../debug/trace'

/** Immutable transport state pushed to subscribers; `epoch` bumps on every command so a same-frame re-seek still notifies. */
export interface PlaybackSnapshot {
  currentFrame: number
  isPlaying: boolean
  playbackRate: number
  loop: boolean
  epoch: number
}

export interface PlaybackEngineConfig {
  fps: number
  /** Called each tick to know when to loop/stop. */
  getTotalFrames: () => number
  /** Optional — inject for deterministic tests. */
  now?: () => number
}

type PlaybackListener = (snapshot: PlaybackSnapshot) => void

export class PlaybackEngine {
  private anchorFrame = 0
  private anchorTime = 0
  private _playing = false
  private _rate = 1
  private _loop = false
  private _epoch = 0
  private _lastNotifiedFrame = 0
  private _lastTimeupdateAt = -Infinity

  private readonly fps: number
  private readonly getTotalFrames: () => number
  private readonly _nowOverride: (() => number) | undefined
  private _audioCtx: AudioContext | null = null

  private rafId: number | null = null
  private listeners = new Set<PlaybackListener>()
  private timeupdateListeners = new Set<PlaybackListener>()

  private readonly onVisibility = (): void => {
    // Why: blur is treated as implicit pause for the editor preview. Re-anchoring
    // on hidden freezes the integrated position; re-anchoring time on visible restarts
    // the clock without catch-up. Same UX as the old 0.25s elapsed clamp.
    if (typeof document === 'undefined' || !this._playing) return
    const t = this.now()
    if (document.hidden) {
      this.anchorFrame = this.integratedFrameAt(t)
      this.anchorTime = t
    } else {
      this.anchorTime = t
    }
  }

  constructor(config: PlaybackEngineConfig) {
    this.fps = config.fps
    this.getTotalFrames = config.getTotalFrames
    this._nowOverride = config.now

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  /**
   * Attach an AudioContext so the engine uses ctx.currentTime as the transport
   * clock instead of performance.now(). Call with null to detach (e.g. on destroy).
   * Re-anchors immediately so the swap is seamless during playback.
   */
  setAudioContext(ctx: AudioContext | null): void {
    this._audioCtx = ctx
    if (this._playing) {
      this.anchorFrame = this.getFrameAt()
      this.anchorTime = this.now()
    }
  }

  /**
   * Re-anchor the integrator to `_lastNotifiedFrame` under the current clock.
   * Safe to call when the time source changes (e.g. AudioContext → running) —
   * uses the last integer frame broadcast by the RAF loop rather than
   * getFrameAt(), which would read a garbage value the instant ctx.currentTime
   * takes over from performance.now().
   */
  reanchor(): void {
    this.anchorFrame = this._lastNotifiedFrame
    this.anchorTime = this.now()
  }

  // ── Private clock ─────────────────────────────────────────────────────────

  /**
   * Returns the current time in seconds. Prefers ctx.currentTime (hardware
   * audio clock) over performance.now() to eliminate A/V drift. Falls back to
   * performance.now() before audio is attached or while ctx is suspended.
   */
  private now(): number {
    if (this._nowOverride) return this._nowOverride()
    const ctx = this._audioCtx
    if (ctx && ctx.state === 'running') return ctx.currentTime
    return performance.now() / 1000
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  /** Float frame at time t (defaults to now()). The renderer reads this. */
  getFrameAt(t: number = this.now()): number {
    if (!this._playing) return this.anchorFrame
    if (typeof document !== 'undefined' && document.hidden) return this.anchorFrame
    return this.integratedFrameAt(t)
  }

  private integratedFrameAt(t: number): number {
    return this.anchorFrame + (t - this.anchorTime) * this.fps * this._rate
  }

  /** Integer frame for the store / UI. */
  get currentFrame(): number {
    return Math.floor(this.getFrameAt())
  }

  get currentTime(): number {
    return this.currentFrame / this.fps
  }

  get isPlaying(): boolean {
    return this._playing
  }

  get playbackRate(): number {
    return this._rate
  }

  get loop(): boolean {
    return this._loop
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  /** No-op if already playing; re-anchors the clock to now so resuming never replays skipped wall-clock time. */
  play(): void {
    if (this._playing) return
    this.anchorTime = this.now()
    this._playing = true
    this._epoch++
    this.notify()
    this.startRAF()
  }

  /** No-op if already paused; freezes the integrated frame so a later play() continues from exactly here. */
  pause(): void {
    if (!this._playing) return
    this.anchorFrame = this.getFrameAt()
    this.anchorTime = this.now()
    this._playing = false
    this._epoch++
    this.notify()
  }

  /** Jumps to a frame and always bumps the epoch — even seeking to the current frame — so one-shot effects retrigger. */
  seek(frame: number): void {
    const next = Math.max(0, Math.floor(frame))
    trace('SET_PLAYHEAD', { target: next, fromAnchor: this.anchorFrame, playing: this._playing })
    // Note: NO same-frame early return. Always bump the epoch so loop-to-start
    // and re-seek-to-same-frame retrigger one-shot effects.
    this.anchorFrame = next
    this.anchorTime = this.now()
    this._epoch++
    this.notify()
  }

  setPlaybackRate(rate: number): void {
    if (rate === this._rate) return
    this.anchorFrame = this.getFrameAt()
    this.anchorTime = this.now()
    this._rate = rate
    this._epoch++
    this.notify()
  }

  setLoop(loop: boolean): void {
    if (loop === this._loop) return
    this._loop = loop
    this._epoch++
    this.notify()
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeTimeupdate(listener: PlaybackListener): () => void {
    this.timeupdateListeners.add(listener)
    return () => this.timeupdateListeners.delete(listener)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Must be called when the engine is discarded — cancels the RAF loop and drops listeners so the clock can't leak. */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
    this.listeners.clear()
    this.timeupdateListeners.clear()
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private startRAF(): void {
    if (this.rafId !== null) return

    const tick = () => {
      if (!this._playing) {
        this.rafId = null
        return
      }

      this.rafId = requestAnimationFrame(tick)

      const f = this.getFrameAt()
      const intF = Math.floor(f)

      const totalF = Math.max(this.getTotalFrames(), this.fps * 10)
      if (intF >= totalF) {
        if (this._loop) {
          this.anchorFrame = 0
          this.anchorTime = this.now()
          this._lastNotifiedFrame = 0
          this._epoch++
          this.notify()
        } else {
          this.anchorFrame = totalF - 1
          this.anchorTime = this.now()
          this._playing = false
          this.rafId = null
          this._lastNotifiedFrame = totalF - 1
          this._epoch++
          this.notify()
        }
        return
      }

      // Notify only when the integer frame advanced — avoids notify storms on
      // displays running faster than fps (60 Hz display × 30 fps timeline).
      if (intF !== this._lastNotifiedFrame) {
        this._lastNotifiedFrame = intF
        this.notify()
      }
    }

    this._lastNotifiedFrame = Math.floor(this.getFrameAt())
    this.rafId = requestAnimationFrame(tick)
  }

  private notify(): void {
    trace('PLAYHEAD', { frame: this.currentFrame, epoch: this._epoch, playing: this._playing })
    const snapshot: PlaybackSnapshot = {
      currentFrame: this.currentFrame,
      isPlaying: this._playing,
      playbackRate: this._rate,
      loop: this._loop,
      epoch: this._epoch,
    }

    this.emit(this.listeners, snapshot)

    const t = this.now()
    if (t - this._lastTimeupdateAt >= 0.1) {
      this._lastTimeupdateAt = t
      this.emit(this.timeupdateListeners, snapshot)
    }
  }

  private emit(set: Set<PlaybackListener>, snapshot: PlaybackSnapshot): void {
    set.forEach((fn) => {
      try {
        fn(snapshot)
      } catch {
        // One broken listener must not stall the clock.
      }
    })
  }
}
