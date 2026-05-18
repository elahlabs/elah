/**
 * PlaybackEngine — owns the RAF loop and playback position.
 *
 * Framework-agnostic: no React, no Zustand imports.
 * Timeline.tsx wires it to the Zustand store via subscribe().
 *
 * Design contract:
 *  - play / pause / seek / setPlaybackRate are the only mutation entry-points
 *  - subscribe() delivers a snapshot on every state change + every frame tick
 *  - destroy() must be called when the engine is no longer needed (stops RAF)
 */

export interface PlaybackSnapshot {
  currentFrame: number
  isPlaying: boolean
  playbackRate: number
  loop: boolean
}

export interface PlaybackEngineConfig {
  fps: number
  /** Called each tick to know when to loop/stop. */
  getTotalFrames: () => number
}

type PlaybackListener = (snapshot: PlaybackSnapshot) => void

export class PlaybackEngine {
  private _frame = 0
  private _playing = false
  private _rate = 1
  private _loop = false

  private readonly fps: number
  private readonly getTotalFrames: () => number

  private rafId: number | null = null
  private lastTimestamp: number | null = null
  private frameAcc = 0

  private listeners = new Set<PlaybackListener>()

  constructor(config: PlaybackEngineConfig) {
    this.fps = config.fps
    this.getTotalFrames = config.getTotalFrames
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get currentFrame(): number {
    return this._frame
  }

  get currentTime(): number {
    return this._frame / this.fps
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

  play(): void {
    if (this._playing) return
    this._playing = true
    this.notify()
    this.startRAF()
  }

  pause(): void {
    if (!this._playing) return
    this._playing = false
    this.notify()
    // RAF loop self-terminates on next tick when it sees _playing === false
  }

  seek(frame: number): void {
    const next = Math.max(0, Math.floor(frame))
    if (next === this._frame) return
    this._frame = next
    this.notify()
  }

  setPlaybackRate(rate: number): void {
    this._rate = rate
    this.notify()
  }

  setLoop(loop: boolean): void {
    this._loop = loop
    // No notify — this only affects end-of-timeline branching behavior
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.listeners.clear()
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private startRAF(): void {
    if (this.rafId !== null) return // already running
    this.lastTimestamp = null
    this.frameAcc = 0

    const tick = (timestamp: number) => {
      if (!this._playing) {
        this.rafId = null
        this.lastTimestamp = null
        this.frameAcc = 0
        return
      }

      this.rafId = requestAnimationFrame(tick)

      if (this.lastTimestamp === null) {
        this.lastTimestamp = timestamp
        return
      }

      // Clamp elapsed — prevents a backgrounded tab from fast-forwarding
      // thousands of frames on resume.
      const elapsed = Math.min((timestamp - this.lastTimestamp) / 1000, 0.25)
      this.lastTimestamp = timestamp

      this.frameAcc += elapsed * this.fps * this._rate
      const whole = Math.floor(this.frameAcc)
      this.frameAcc -= whole
      if (whole === 0) return

      const totalF = Math.max(this.getTotalFrames(), this.fps * 10)
      const next = this._frame + whole

      if (next >= totalF) {
        if (this._loop) {
          this._frame = next % totalF
        } else {
          this._frame = totalF - 1
          this._playing = false
          this.rafId = null
          this.lastTimestamp = null
          this.frameAcc = 0
        }
      } else {
        this._frame = next
      }

      this.notify()
    }

    this.rafId = requestAnimationFrame(tick)
  }

  private notify(): void {
    const snapshot: PlaybackSnapshot = {
      currentFrame: this._frame,
      isPlaying: this._playing,
      playbackRate: this._rate,
      loop: this._loop,
    }
    this.listeners.forEach((fn) => fn(snapshot))
  }
}
