/**
 * AudioPlaybackController — basic single-track audio playback for v1.
 *
 * Web Audio, slaved to the PlaybackEngine clock:
 *  - Decodes each audio src once (whole-file `decodeAudioData`) and caches the
 *    AudioBuffer. These buffers are exactly what a future OfflineAudioContext
 *    export path (#6) would consume, so this is forward-compatible.
 *  - Subscribes to the PlaybackEngine. On every transport event (play / pause /
 *    seek / rate — all bump `epoch`) it re-anchors the audio to the current
 *    playhead. PlaybackEngine stays the master clock; audio chases it. For a
 *    single short clip the real-time AudioContext and the integrate clock stay
 *    close enough without continuous drift correction.
 *
 * v1 constraint: one audio track → at most one active audio clip at a time.
 * This controller does NOT render through GpuRenderer — it lives beside it on
 * the same playhead.
 */

import { resolveTimeline } from '../../resolver/resolveTimeline'
import type { PlaybackEngine, PlaybackSnapshot } from '../../playback/PlaybackEngine'
import type { Project } from '../../types'

export interface AudioPlaybackControllerOptions {
  /** Injectable for tests; production builds a real AudioContext. */
  audioContextFactory?: () => AudioContext
}

export class AudioPlaybackController {
  private readonly _playback: PlaybackEngine
  private readonly _getProject: () => Project
  private readonly _audioContextFactory: () => AudioContext

  private _ctx: AudioContext | null = null
  private readonly _buffers = new Map<string, Promise<AudioBuffer>>()
  private _node: AudioBufferSourceNode | null = null
  private _gain: GainNode | null = null
  private _activeClipId: string | null = null
  private _lastEpoch = -1
  /** Bumped on each (re)schedule so a stale async decode can't start audio late. */
  private _scheduleToken = 0
  private _unsub: (() => void) | null = null

  constructor(
    playback: PlaybackEngine,
    getProject: () => Project,
    options: AudioPlaybackControllerOptions = {},
  ) {
    this._playback = playback
    this._getProject = getProject
    this._audioContextFactory =
      options.audioContextFactory ?? (() => new AudioContext())
  }

  /** Begin tracking the playback clock. Lazily creates the AudioContext. */
  start(): void {
    if (this._unsub) return
    if (!this._ctx) {
      this._ctx = this._audioContextFactory()
    }
    this._unsub = this._playback.subscribe((snap) => this._onSnapshot(snap))
    // Sync once against the current state (e.g. already playing on mount).
    this._onSnapshot({
      currentFrame: this._playback.currentFrame,
      isPlaying: this._playback.isPlaying,
      playbackRate: this._playback.playbackRate,
      loop: this._playback.loop,
      epoch: -1,
    })
  }

  /** Stop tracking, stop any sound, and release the AudioContext. */
  destroy(): void {
    this._unsub?.()
    this._unsub = null
    this._stop()
    this._activeClipId = null
    if (this._ctx) {
      void this._ctx.close()
      this._ctx = null
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _onSnapshot(snap: PlaybackSnapshot): void {
    const transportChanged = snap.epoch !== this._lastEpoch
    this._lastEpoch = snap.epoch

    const scene = resolveTimeline(snap.currentFrame, this._getProject())
    // One audio track in v1; the last entry = topmost by zIndex if more ever slipped in.
    const clip =
      scene.audios.length > 0 ? scene.audios[scene.audios.length - 1] : null

    if (!clip) {
      this._stop()
      this._activeClipId = null
      return
    }

    // Live volume tracking while a node is playing.
    if (this._gain) {
      this._gain.gain.value = clip.volume
    }

    if (!snap.isPlaying) {
      this._stop()
      return
    }

    // Restart only on a real change — NOT on every integer-frame advance, or the
    // audio would stutter as it re-seeks each frame.
    const needRestart =
      transportChanged || clip.id !== this._activeClipId || this._node === null
    if (!needRestart) return

    const offsetSec = clip.sourceFrame / scene.fps
    void this._schedule(clip.id, clip.src, offsetSec, clip.volume)
  }

  private async _schedule(
    clipId: string,
    src: string,
    offsetSec: number,
    volume: number,
  ): Promise<void> {
    const token = ++this._scheduleToken
    let buffer: AudioBuffer
    try {
      buffer = await this._ensureBuffer(src)
    } catch {
      return
    }
    // A newer schedule (or a stop) superseded this one while decoding.
    if (token !== this._scheduleToken || !this._ctx) return

    this._startNode(buffer, offsetSec, volume)
    this._activeClipId = clipId
  }

  private _startNode(buffer: AudioBuffer, offsetSec: number, volume: number): void {
    const ctx = this._ctx
    if (!ctx) return

    this._stop()

    // Clip already played past its end — nothing to schedule.
    if (offsetSec >= buffer.duration) return
    const offset = Math.max(0, offsetSec)

    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    const node = ctx.createBufferSource()
    node.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = volume
    node.connect(gain).connect(ctx.destination)
    node.start(ctx.currentTime, offset)

    this._node = node
    this._gain = gain
  }

  private _stop(): void {
    if (this._node) {
      try {
        this._node.stop()
        this._node.disconnect()
      } catch {
        // Stopping a node that never started (or already stopped) throws — ignore.
      }
    }
    this._node = null
    this._gain = null
    // Bump the token so any in-flight decode does not start audio after a stop.
    this._scheduleToken++
  }

  private _ensureBuffer(src: string): Promise<AudioBuffer> {
    const cached = this._buffers.get(src)
    if (cached) return cached

    const ctx = this._ctx
    if (!ctx) return Promise.reject(new Error('AudioPlaybackController: no AudioContext'))

    const promise = fetch(src)
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
    this._buffers.set(src, promise)
    return promise
  }
}
