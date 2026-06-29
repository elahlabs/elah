/**
 * AudioPlaybackController — multi-track audio playback.
 *
 * Web Audio, slaved to the PlaybackEngine clock:
 *  - Decodes each audio src once (whole-file `decodeAudioData`) and caches the
 *    AudioBuffer. These buffers are exactly what a future OfflineAudioContext
 *    export path would consume, so this is forward-compatible.
 *  - Subscribes to the PlaybackEngine. On every transport event (play / pause /
 *    seek / rate — all bump `epoch`) it re-anchors the audio to the current
 *    playhead. PlaybackEngine stays the master clock; audio chases it.
 *  - Creates one AudioBufferSourceNode + GainNode pair per active clip, all
 *    routed through a shared master GainNode, enabling true multi-track mixing.
 */

import { resolveTimeline } from '../../resolver/resolveTimeline'
import type { PlaybackEngine, PlaybackSnapshot } from '../../playback/PlaybackEngine'
import type { Project } from '../../types'

export interface AudioPlaybackControllerOptions {
  /** Injectable for tests; production builds a real AudioContext. */
  audioContextFactory?: () => AudioContext
}

interface ClipNodes {
  node: AudioBufferSourceNode
  gain: GainNode
}

export class AudioPlaybackController {
  private readonly _playback: PlaybackEngine
  private readonly _getProject: () => Project
  private readonly _audioContextFactory: () => AudioContext

  private _ctx: AudioContext | null = null
  private _masterGain: GainNode | null = null
  private readonly _buffers = new Map<string, Promise<AudioBuffer>>()
  /** One node+gain pair per active clip. */
  private readonly _active = new Map<string, ClipNodes>()
  /** Per-clip tokens — bumped on stop or re-schedule so stale decodes bail. */
  private readonly _clipTokens = new Map<string, number>()
  private _tokenCounter = 0
  private _lastEpoch = -1
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
      this._masterGain = this._ctx.createGain()
      this._masterGain.connect(this._ctx.destination)
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

  /** Stop tracking, stop all sound, and release the AudioContext. */
  destroy(): void {
    this._unsub?.()
    this._unsub = null
    this._stopAll()
    if (this._ctx) {
      void this._ctx.close()
      this._ctx = null
      this._masterGain = null
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _onSnapshot(snap: PlaybackSnapshot): void {
    const transportChanged = snap.epoch !== this._lastEpoch
    this._lastEpoch = snap.epoch

    const scene = resolveTimeline(snap.currentFrame, this._getProject())
    const activeClips = scene.audios

    // Stop nodes for clips that are no longer in the scene.
    const incomingIds = new Set(activeClips.map((c) => c.id))
    for (const id of [...this._active.keys()]) {
      if (!incomingIds.has(id)) {
        this._stopClip(id)
      }
    }

    if (!snap.isPlaying) {
      this._stopAll()
      return
    }

    for (const clip of activeClips) {
      // Live volume tracking while a node is already playing.
      const existing = this._active.get(clip.id)
      if (existing) {
        existing.gain.gain.value = clip.volume
      }

      // Restart only on a real change — NOT on every integer-frame advance, or
      // audio would stutter as it re-seeks each frame.
      const needRestart = transportChanged || !this._active.has(clip.id)
      if (!needRestart) continue

      const offsetSec = clip.sourceFrame / scene.fps
      void this._scheduleClip(clip.id, clip.src, offsetSec, clip.volume)
    }
  }

  private async _scheduleClip(
    clipId: string,
    src: string,
    offsetSec: number,
    volume: number,
  ): Promise<void> {
    const token = ++this._tokenCounter
    this._clipTokens.set(clipId, token)

    let buffer: AudioBuffer
    try {
      buffer = await this._ensureBuffer(src)
    } catch {
      return
    }
    // A newer schedule (or a stop) superseded this one while decoding.
    if (this._clipTokens.get(clipId) !== token || !this._ctx || !this._masterGain) return

    this._startClipNode(clipId, buffer, offsetSec, volume)
  }

  private _startClipNode(
    clipId: string,
    buffer: AudioBuffer,
    offsetSec: number,
    volume: number,
  ): void {
    const ctx = this._ctx
    const masterGain = this._masterGain
    if (!ctx || !masterGain) return

    // Stop any existing node for this clip before replacing.
    this._stopClip(clipId)

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
    node.connect(gain).connect(masterGain)
    node.start(ctx.currentTime, offset)

    this._active.set(clipId, { node, gain })
  }

  private _stopClip(clipId: string): void {
    // Bump this clip's token so any in-flight decode bails.
    this._clipTokens.set(clipId, ++this._tokenCounter)

    const entry = this._active.get(clipId)
    if (entry) {
      try {
        entry.node.stop()
        entry.node.disconnect()
      } catch {
        // Stopping a node that never started (or already stopped) throws — ignore.
      }
      this._active.delete(clipId)
    }
  }

  private _stopAll(): void {
    for (const id of [...this._active.keys()]) {
      this._stopClip(id)
    }
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
