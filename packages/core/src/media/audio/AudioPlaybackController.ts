/**
 * AudioPlaybackController — multi-track audio playback with mixer.
 *
 * Web Audio graph per clip:
 *   AudioBufferSourceNode → clipGain → trackGain → trackAnalyser → masterGain → destination
 *
 * Design highlights:
 *  - Hands its AudioContext to PlaybackEngine.setAudioContext() so the engine
 *    uses ctx.currentTime as the master clock, eliminating A/V drift.
 *  - One clipGain+source pair per active clip; shared trackGain+analyser per track.
 *  - Gain changes use short LinearRamp instead of direct value writes (no clicks).
 *  - playbackRate threaded to AudioBufferSourceNode so slow/fast-mo follows video.
 *  - Re-schedules only on epoch changes (transport events), not on every frame.
 */

import { resolveTimeline } from '../../resolver/resolveTimeline'
import { trace } from '../../debug/trace'
import type { PlaybackEngine, PlaybackSnapshot } from '../../playback/PlaybackEngine'
import type { Project } from '../../types'

export interface AudioPlaybackControllerOptions {
  /** Injectable for tests; production builds a real AudioContext. */
  audioContextFactory?: () => AudioContext
}

/** Duration of gain ramps — short enough to be imperceptible, long enough to avoid clicks. */
const GAIN_RAMP_S = 0.01

interface ClipNodes {
  node: AudioBufferSourceNode
  gain: GainNode
  trackId: string
}

interface TrackNodes {
  gain: GainNode
  analyser: AnalyserNode
}

export class AudioPlaybackController {
  private readonly _playback: PlaybackEngine
  private readonly _getProject: () => Project
  private readonly _audioContextFactory: () => AudioContext

  private _ctx: AudioContext | null = null
  private _masterGain: GainNode | null = null
  /** One node+gain pair per active clip, keyed by clipId. */
  private readonly _active = new Map<string, ClipNodes>()
  /** One gain+analyser pair per track that has active clips, keyed by trackId. */
  private readonly _trackNodes = new Map<string, TrackNodes>()
  /** Per-clip tokens — bumped on stop or re-schedule so stale decodes bail. */
  private readonly _clipTokens = new Map<string, number>()
  private readonly _buffers = new Map<string, Promise<AudioBuffer>>()
  private _tokenCounter = 0
  private _lastEpoch = -1
  private _unsub: (() => void) | null = null
  private _stateChangeHandler: (() => void) | null = null
  private _globalUnlock: (() => void) | null = null

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
      // Unify the transport clock: PlaybackEngine will prefer ctx.currentTime
      // over performance.now() whenever the context is running.
      this._playback.setAudioContext(this._ctx)

      // Re-anchor the integrator the moment the context actually starts running.
      // Using _lastNotifiedFrame (not getFrameAt) avoids a garbage read: by the
      // time statechange fires, ctx.state is already 'running' so now() returns
      // the small ctx.currentTime, but anchorTime still holds the large
      // performance.now() value — getFrameAt() would be massively negative.
      const stateChangeHandler = () => {
        trace('AUDIO', 'statechange', { state: this._ctx?.state })
        if (this._ctx?.state === 'running') this._playback.reanchor()
      }
      this._stateChangeHandler = stateChangeHandler
      this._ctx.addEventListener('statechange', stateChangeHandler)

      // Belt-and-braces: unlock on first user interaction anywhere, so the
      // context becomes running even if the play path hasn't been hit yet.
      // Guarded for the node/vitest test environment where window is undefined.
      if (typeof window !== 'undefined') {
        const unlock = () => {
          this._ctx?.resume().catch((e) => trace('AUDIO', 'global unlock failed', String(e)))
        }
        this._globalUnlock = unlock
        window.addEventListener('pointerdown', unlock, { once: true })
        window.addEventListener('keydown', unlock, { once: true })
      }
    }
    this._unsub = this._playback.subscribe((snap) => this._onSnapshot(snap))
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
    this._teardownAllTrackNodes()
    if (this._ctx) {
      if (this._stateChangeHandler) {
        this._ctx.removeEventListener('statechange', this._stateChangeHandler)
        this._stateChangeHandler = null
      }
      this._playback.setAudioContext(null)
      void this._ctx.close()
      this._ctx = null
      this._masterGain = null
    }
    if (typeof window !== 'undefined' && this._globalUnlock) {
      window.removeEventListener('pointerdown', this._globalUnlock)
      window.removeEventListener('keydown', this._globalUnlock)
      this._globalUnlock = null
    }
  }

  // ── Mixer API ────────────────────────────────────────────────────────────

  /**
   * Ramp the master gain to `value` over GAIN_RAMP_S seconds.
   * Safe to call during playback — no clicks.
   */
  setMasterGain(value: number): void {
    const g = this._masterGain
    const ctx = this._ctx
    if (!g || !ctx) return
    this._rampGain(g.gain, Math.max(0, value), ctx.currentTime)
  }

  /**
   * Ramp a per-track gain to `value` over GAIN_RAMP_S seconds.
   * No-op if no clips on that track are currently active.
   */
  setTrackGain(trackId: string, value: number): void {
    const nodes = this._trackNodes.get(trackId)
    const ctx = this._ctx
    if (!nodes || !ctx) return
    this._rampGain(nodes.gain.gain, Math.max(0, value), ctx.currentTime)
  }

  /**
   * Read the current RMS level (0..1) for every active track.
   * Returns L=R (mono-summed) for v1; extend with ChannelSplitter for true stereo.
   */
  getTrackLevels(): Map<string, { left: number; right: number }> {
    const result = new Map<string, { left: number; right: number }>()
    for (const [trackId, nodes] of this._trackNodes) {
      const data = new Float32Array(nodes.analyser.fftSize)
      nodes.analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!
      const rms = Math.sqrt(sum / data.length)
      result.set(trackId, { left: rms, right: rms })
    }
    return result
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _onSnapshot(snap: PlaybackSnapshot): void {
    const transportChanged = snap.epoch !== this._lastEpoch
    this._lastEpoch = snap.epoch

    // Resume synchronously while still in the gesture task (click → play →
    // notify → _onSnapshot is fully synchronous). The gesture activation does
    // NOT survive the await in _scheduleClip, so this is the only safe place.
    if (snap.isPlaying && this._ctx && this._ctx.state === 'suspended') {
      trace('AUDIO', 'resuming context (suspended) on play gesture', { epoch: snap.epoch })
      this._ctx.resume().catch((e) => trace('AUDIO', 'resume failed', String(e)))
    }

    const scene = resolveTimeline(snap.currentFrame, this._getProject())
    const activeClips = scene.audios
    trace('AUDIO', 'snapshot', {
      frame: snap.currentFrame,
      epoch: snap.epoch,
      isPlaying: snap.isPlaying,
      ctxState: this._ctx?.state,
      activeClipIds: activeClips.map((c) => c.id),
    })

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
      // Ramp clip gain on the existing node — no restart needed for volume changes.
      const existing = this._active.get(clip.id)
      if (existing) {
        const ctx = this._ctx
        if (ctx) this._rampGain(existing.gain.gain, clip.volume, ctx.currentTime)
      }

      // Restart only on epoch change (seek / play / rate) or first appearance.
      const needRestart = transportChanged || !this._active.has(clip.id)
      if (!needRestart) continue

      const offsetSec = clip.sourceFrame / scene.fps
      void this._scheduleClip(clip.id, clip.trackId, clip.src, offsetSec, clip.volume, snap.playbackRate)
    }
  }

  private async _scheduleClip(
    clipId: string,
    trackId: string,
    src: string,
    offsetSec: number,
    volume: number,
    playbackRate: number,
  ): Promise<void> {
    const token = ++this._tokenCounter
    this._clipTokens.set(clipId, token)
    trace('AUDIO', 'scheduleClip start', { clipId, trackId, offsetSec })

    let buffer: AudioBuffer
    try {
      buffer = await this._ensureBuffer(src)
    } catch (e) {
      trace('AUDIO', 'scheduleClip buffer error', { clipId, error: String(e) })
      return
    }
    if (this._clipTokens.get(clipId) !== token) {
      trace('AUDIO', 'scheduleClip stale (superseded)', { clipId })
      return
    }
    if (!this._ctx || !this._masterGain) {
      trace('AUDIO', 'scheduleClip stale (destroyed)', { clipId })
      return
    }

    trace('AUDIO', 'scheduleClip starting node', { clipId, ctxState: this._ctx.state })
    this._startClipNode(clipId, trackId, buffer, offsetSec, volume, playbackRate)
  }

  private _startClipNode(
    clipId: string,
    trackId: string,
    buffer: AudioBuffer,
    offsetSec: number,
    volume: number,
    playbackRate: number,
  ): void {
    const ctx = this._ctx
    const masterGain = this._masterGain
    if (!ctx || !masterGain) return

    this._stopClip(clipId)

    if (offsetSec >= buffer.duration) return
    const offset = Math.max(0, offsetSec)

    const trackNodes = this._ensureTrackNodes(trackId)

    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = playbackRate

    const gain = ctx.createGain()
    gain.gain.value = volume

    // clipSource → clipGain → trackGain → trackAnalyser → masterGain → destination
    node.connect(gain)
    gain.connect(trackNodes.gain)

    // Schedule 20 ms ahead to land cleanly on a future audio quantum.
    // Only push the schedule time — not the source offset — to avoid skipping
    // the first 20 ms of audio content and introducing A/V drift.
    trace('AUDIO', 'node.start', { clipId, trackId, scheduleAt: ctx.currentTime + 0.02, offset, ctxState: ctx.state })
    node.start(ctx.currentTime + 0.02, offset)

    this._active.set(clipId, { node, gain, trackId })
  }

  /** Ensure per-track gain+analyser nodes exist, creating them lazily. */
  private _ensureTrackNodes(trackId: string): TrackNodes {
    const existing = this._trackNodes.get(trackId)
    if (existing) return existing

    const ctx = this._ctx!
    const masterGain = this._masterGain!

    const gain = ctx.createGain()
    gain.gain.value = 1

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024

    gain.connect(analyser)
    analyser.connect(masterGain)

    const nodes: TrackNodes = { gain, analyser }
    this._trackNodes.set(trackId, nodes)
    return nodes
  }

  private _stopClip(clipId: string): void {
    this._clipTokens.set(clipId, ++this._tokenCounter)

    const entry = this._active.get(clipId)
    if (entry) {
      try {
        entry.node.stop()
        entry.node.disconnect()
        entry.gain.disconnect()
      } catch {
        // Already stopped or never started — ignore.
      }
      this._active.delete(clipId)
      this._cleanupTrackNodesIfEmpty(entry.trackId)
    }
  }

  private _stopAll(): void {
    for (const id of [...this._active.keys()]) {
      this._stopClip(id)
    }
  }

  /** Tear down track nodes when no clips on that track are active. */
  private _cleanupTrackNodesIfEmpty(trackId: string): void {
    const hasClipsOnTrack = [...this._active.values()].some((c) => c.trackId === trackId)
    if (hasClipsOnTrack) return

    const nodes = this._trackNodes.get(trackId)
    if (nodes) {
      try {
        nodes.gain.disconnect()
        nodes.analyser.disconnect()
      } catch {
        // Already disconnected.
      }
      this._trackNodes.delete(trackId)
    }
  }

  private _teardownAllTrackNodes(): void {
    for (const [, nodes] of this._trackNodes) {
      try {
        nodes.gain.disconnect()
        nodes.analyser.disconnect()
      } catch {
        // ignore
      }
    }
    this._trackNodes.clear()
  }

  private _rampGain(param: AudioParam, target: number, now: number): void {
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.linearRampToValueAtTime(Math.max(0, target), now + GAIN_RAMP_S)
  }

  private _ensureBuffer(src: string): Promise<AudioBuffer> {
    const cached = this._buffers.get(src)
    if (cached) return cached

    const ctx = this._ctx
    if (!ctx) return Promise.reject(new Error('AudioPlaybackController: no AudioContext'))

    const promise = fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching audio ${src}`)
        return res.arrayBuffer()
      })
      .then((buf) => ctx.decodeAudioData(buf))
    // Evict on failure so a transient error can retry later; identity guard
    // avoids clobbering a newer in-flight retry. This side-chain also marks
    // the rejection "handled" so fire-and-forget preload callers don't raise
    // unhandledrejection — `_scheduleClip` still awaits `promise` directly,
    // so its own rejection handling is unaffected.
    promise.catch((e) => {
      if (this._buffers.get(src) === promise) this._buffers.delete(src)
      console.warn(`[audio] failed to load ${src}:`, e)
    })
    this._buffers.set(src, promise)
    return promise
  }

  /**
   * Warm the decode cache for every audio clip in the project so first play
   * doesn't wait on download + decode. Dedupe is the `_buffers` cache itself;
   * failures are handled (evict + warn) inside `_ensureBuffer`. The cache is
   * intentionally never evicted except on load failure.
   */
  preloadProjectAudio(): void {
    if (!this._ctx) return
    for (const clips of Object.values(this._getProject().clips)) {
      for (const clip of clips) {
        if (clip.type === 'audio' && typeof clip.src === 'string') {
          void this._ensureBuffer(clip.src)
        }
      }
    }
  }
}
