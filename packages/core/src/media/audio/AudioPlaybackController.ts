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
import { defaultAudioResolver, type AudioResolver } from './audioResolver'
import { sourceBlobCache } from '../video/demuxer/sourceBlobCache'
import { AudioChunkCache, STREAM_CHUNK_SEC } from './audioChunkCache'
import {
  STREAM_AUDIO_ABOVE_BYTES,
  WHOLE_FILE_DECODE_MAX_BYTES,
  openAudioStream,
  type AudioStream,
} from './streamDecode'
import type { ClipAudioEnhance } from '../../types'
import { enhanceSignature } from '../../audio/clipAudio'
import { loadFeature } from '../../renderer/gpu/features'
import { buildEnhanceChain, disconnectEnhanceChain, type EnhanceChain } from './enhanceChain'

export interface AudioPlaybackControllerOptions {
  /** Injectable for tests; production builds a real AudioContext. */
  audioContextFactory?: () => AudioContext
  /** Injectable URL→bytes seam for CDN/auth/proxy overrides. Defaults to fetch(src).arrayBuffer(). */
  audioResolver?: AudioResolver
  /**
   * LM-P5: the Blob behind a src when it is held locally (default: a pinned
   * local file in `sourceBlobCache`). A source whose Blob is larger than
   * `streamAboveBytes` is played from decoded windows instead of one
   * whole-file buffer. Sources with no Blob here keep the whole-file path.
   */
  audioBlobFor?: (src: string) => Blob | undefined
  /** Injectable stream opener (tests). Defaults to mediabunny. */
  openAudioStream?: (blob: Blob) => Promise<AudioStream>
  /** Blob size above which a source streams. Default `STREAM_AUDIO_ABOVE_BYTES`. */
  streamAboveBytes?: number
}

/** Duration of gain ramps — short enough to be imperceptible, long enough to avoid clicks. */
const GAIN_RAMP_S = 0.01
/** How long a failed load is remembered before the next attempt may retry it. */
const AUDIO_RETRY_AFTER_MS = 5000

interface ClipNodes {
  node: AudioBufferSourceNode
  gain: GainNode
  trackId: string
  /** Streamed clips only: the chunk scheduler's state. */
  run?: StreamRun
  /** The clip's Enhance chain between source and gain, when it has one. */
  chain?: EnhanceChain | null
  /** `enhanceSignature` the chain was built for; a change restarts the clip. */
  enhanceSig: string
}

/** Scheduler state for one clip playing from decoded windows. */
interface StreamRun {
  src: string
  stream: AudioStream
  token: number
  /** Source seconds the clip started at, and the context time they play at. */
  offsetSec: number
  startTime: number
  /** Effective rate: transport rate x clip speed. */
  rate: number
  gain: GainNode
  /** Where chunk nodes connect: the Enhance chain's input, else `gain`. */
  input: AudioNode
  firstK: number
  lastK: number
  nextK: number
  ended: number
  live: boolean
  filling: boolean
  nodes: Set<AudioBufferSourceNode>
}

/** Chunks scheduled ahead of the one that is playing. */
const STREAM_AHEAD_CHUNKS = 2

interface TrackNodes {
  gain: GainNode
  analyser: AnalyserNode
}

export class AudioPlaybackController {
  private readonly _playback: PlaybackEngine
  private readonly _getProject: () => Project
  private readonly _audioContextFactory: () => AudioContext
  private readonly _audioResolver: AudioResolver

  private _ctx: AudioContext | null = null
  private _masterGain: GainNode | null = null
  /** One node+gain pair per active clip, keyed by clipId. */
  private readonly _active = new Map<string, ClipNodes>()
  /** One gain+analyser pair per track that has active clips, keyed by trackId. */
  private readonly _trackNodes = new Map<string, TrackNodes>()
  /** Per-clip tokens — bumped on stop or re-schedule so stale decodes bail. */
  private readonly _clipTokens = new Map<string, number>()
  /** Clips currently awaiting a buffer (fetch+decode in flight) — prevents re-scheduling every tick. */
  private readonly _pendingClips = new Set<string>()
  private readonly _buffers = new Map<string, Promise<AudioBuffer>>()
  private readonly _audioBlobFor: (src: string) => Blob | undefined
  private readonly _openAudioStream: (blob: Blob) => Promise<AudioStream>
  private readonly _streamAboveBytes: number
  /** LM-P5: open streams and their chunk caches, keyed by src. */
  private readonly _streams = new Map<string, Promise<AudioStream>>()
  private readonly _chunkCaches = new Map<string, AudioChunkCache<AudioBuffer | null>>()
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
    this._audioResolver = options.audioResolver ?? defaultAudioResolver
    this._audioBlobFor = options.audioBlobFor ?? ((src) => sourceBlobCache.pinnedBlob(src))
    this._openAudioStream = options.openAudioStream ?? ((blob) => openAudioStream(blob))
    this._streamAboveBytes = options.streamAboveBytes ?? STREAM_AUDIO_ABOVE_BYTES
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
    for (const opening of this._streams.values()) void opening.then((st) => st.close(), () => undefined)
    this._streams.clear()
    for (const cache of this._chunkCaches.values()) cache.clear()
    this._chunkCaches.clear()
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

      // Restart only on epoch change (seek / play / rate), first appearance, or
      // an Enhance change (its chain is built once, when the node starts).
      // A clip already awaiting its buffer is left alone — _scheduleClip
      // recomputes the offset against the live playhead once the decode
      // resolves, so re-firing every tick would just churn tokens for nothing.
      const enhanceChanged = existing !== undefined && existing.enhanceSig !== enhanceSignature(clip.enhance)
      const needRestart =
        transportChanged || enhanceChanged || (!this._active.has(clip.id) && !this._pendingClips.has(clip.id))
      if (!needRestart) continue

      void this._scheduleClip(clip.id, clip.trackId, clip.src, clip.enhance)
    }
  }

  private async _scheduleClip(clipId: string, trackId: string, src: string, enhance?: ClipAudioEnhance): Promise<void> {
    const token = ++this._tokenCounter
    this._clipTokens.set(clipId, token)
    this._pendingClips.add(clipId)
    trace('AUDIO', 'scheduleClip start', { clipId, trackId })

    // Enhance's denoiser is a worklet module; load it before the node starts.
    // Every later step re-checks the token, so a stale call still bails.
    if (enhance && enhance.noise > 0 && this._ctx) await this._loadDenoiser(this._ctx)

    // LM-P5: a large local source is played from decoded windows, never decoded whole.
    const streamBlob = this._streamBlobFor(src)
    if (streamBlob) {
      const handled = await this._scheduleStreamedClip(clipId, trackId, src, streamBlob, token)
      if (handled) return
    }

    let buffer: AudioBuffer
    try {
      buffer = await this._ensureBuffer(src)
    } catch (e) {
      trace('AUDIO', 'scheduleClip buffer error', { clipId, error: String(e) })
      this._pendingClips.delete(clipId)
      return
    }
    if (this._clipTokens.get(clipId) !== token) {
      trace('AUDIO', 'scheduleClip stale (superseded)', { clipId })
      // A newer call already owns _pendingClips bookkeeping for this clip — leave it be.
      return
    }
    this._pendingClips.delete(clipId)
    if (!this._ctx || !this._masterGain) {
      trace('AUDIO', 'scheduleClip stale (destroyed)', { clipId })
      return
    }

    // The decode may have taken a while (cold CDN fetch) — the offset/volume
    // captured when scheduling began can be seconds stale by now. Recompute
    // against the live playhead so a slow decode snaps into sync instead of
    // starting at a stale position (or resuming audio after a pause/stop).
    if (!this._playback.isPlaying) {
      trace('AUDIO', 'scheduleClip stale (no longer playing)', { clipId })
      return
    }
    const liveScene = resolveTimeline(this._playback.currentFrame, this._getProject())
    const liveClip = liveScene.audios.find((c) => c.id === clipId)
    if (!liveClip) {
      trace('AUDIO', 'scheduleClip stale (clip no longer active)', { clipId })
      return
    }
    const liveOffsetSec = liveClip.sourceFrame / liveScene.fps

    trace('AUDIO', 'scheduleClip starting node', { clipId, ctxState: this._ctx.state, liveOffsetSec })
    // `liveClip.speed` is re-read with the live offset for the same reason:
    // export schedules every clip at `clip.speed` (audioMix), so the preview
    // multiplies it into the transport rate or a retimed clip drifts out of sync.
    this._startClipNode(
      clipId,
      trackId,
      buffer,
      liveOffsetSec,
      liveClip.volume,
      this._playback.playbackRate,
      liveClip.speed,
      liveClip.enhance,
    )
  }

  /** Denoiser readiness per context, so building a chain stays synchronous. */
  private readonly _denoiseReady = new WeakMap<BaseAudioContext, boolean>()

  private async _loadDenoiser(ctx: AudioContext): Promise<void> {
    if (this._denoiseReady.has(ctx)) return
    // The worklet source loads with the Enhance feature (CONV-8), not with the editor.
    try {
      const { ensureDenoiseWorklet } = await loadFeature('enhance')
      this._denoiseReady.set(ctx, await ensureDenoiseWorklet(ctx))
    } catch (err) {
      // Same as a browser without AudioWorklet: the clip plays without noise reduction.
      console.warn('[AudioPlaybackController] the Enhance denoiser failed to load:', err)
      this._denoiseReady.set(ctx, false)
    }
  }

  private _chainFor(ctx: AudioContext, enhance: ClipAudioEnhance | undefined): EnhanceChain | null {
    return buildEnhanceChain(ctx, enhance, this._denoiseReady.get(ctx) === true)
  }

  /** The Blob to stream `src` from, or null when it should take the whole-file path. */
  private _streamBlobFor(src: string): Blob | null {
    const blob = this._audioBlobFor(src)
    return blob && blob.size > this._streamAboveBytes ? blob : null
  }

  private _streamFor(src: string, blob: Blob): Promise<AudioStream> {
    let opening = this._streams.get(src)
    if (!opening) {
      opening = this._openAudioStream(blob)
      this._streams.set(src, opening)
      const mine = opening
      mine.catch(() => {
        if (this._streams.get(src) === mine) this._streams.delete(src)
      })
    }
    return opening
  }

  /** One decoded window of `src` as an AudioBuffer (null when the window holds no frames). */
  private _chunkFor(src: string, stream: AudioStream, k: number): Promise<AudioBuffer | null> {
    let cache = this._chunkCaches.get(src)
    if (!cache) {
      cache = new AudioChunkCache<AudioBuffer | null>()
      this._chunkCaches.set(src, cache)
    }
    return cache.get(k, async () => {
      const ctx = this._ctx
      if (!ctx) throw new Error('AudioPlaybackController: no AudioContext')
      const start = k * STREAM_CHUNK_SEC
      const end = Math.min(stream.durationSec, start + STREAM_CHUNK_SEC)
      if (end <= start) return null
      const range = await stream.readRange(start, end)
      const frames = range.channels[0]?.length ?? 0
      if (frames === 0) return null
      const buffer = ctx.createBuffer(range.channels.length, frames, range.sampleRate)
      for (let c = 0; c < range.channels.length; c++) buffer.copyToChannel(range.channels[c]!, c)
      return buffer
    })
  }

  /**
   * Start a clip from decoded windows. Resolves `true` when the clip was
   * handled (started, superseded, or refused); `false` when the stream could
   * not be opened and the whole-file path should be tried instead.
   */
  private async _scheduleStreamedClip(
    clipId: string,
    trackId: string,
    src: string,
    blob: Blob,
    token: number,
  ): Promise<boolean> {
    let stream: AudioStream
    try {
      stream = await this._streamFor(src, blob)
    } catch (e) {
      trace('AUDIO', 'stream open failed', { clipId, error: String(e) })
      if (blob.size <= WHOLE_FILE_DECODE_MAX_BYTES) return false
      console.warn(`[audio] cannot stream ${src} and it is too large to decode whole:`, e)
      if (this._clipTokens.get(clipId) === token) this._pendingClips.delete(clipId)
      return true
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (this._clipTokens.get(clipId) !== token) return true
      if (!this._ctx || !this._masterGain || !this._playback.isPlaying) {
        this._pendingClips.delete(clipId)
        return true
      }
      const liveScene = resolveTimeline(this._playback.currentFrame, this._getProject())
      const liveClip = liveScene.audios.find((c) => c.id === clipId)
      if (!liveClip) {
        this._pendingClips.delete(clipId)
        return true
      }
      const offsetSec = Math.max(0, liveClip.sourceFrame / liveScene.fps)
      if (offsetSec >= stream.durationSec) {
        this._pendingClips.delete(clipId)
        return true
      }
      const lastK = Math.max(0, Math.ceil(stream.durationSec / STREAM_CHUNK_SEC) - 1)
      const k0 = Math.min(lastK, Math.floor(offsetSec / STREAM_CHUNK_SEC))
      let first: AudioBuffer | null
      try {
        first = await this._chunkFor(src, stream, k0)
      } catch (e) {
        trace('AUDIO', 'stream chunk error', { clipId, error: String(e) })
        console.warn(`[audio] failed to decode a window of ${src}:`, e)
        if (this._clipTokens.get(clipId) === token) this._pendingClips.delete(clipId)
        return true
      }
      if (this._clipTokens.get(clipId) !== token) return true

      // The playhead moved on while the window decoded: re-aim at where it is now.
      const nowScene = resolveTimeline(this._playback.currentFrame, this._getProject())
      const nowClip = nowScene.audios.find((c) => c.id === clipId)
      const nowOffset = nowClip ? Math.max(0, nowClip.sourceFrame / nowScene.fps) : offsetSec
      if (first && Math.min(lastK, Math.floor(nowOffset / STREAM_CHUNK_SEC)) !== k0 && attempt < 2) continue
      if (!first || !nowClip || !this._ctx || !this._masterGain) {
        this._pendingClips.delete(clipId)
        return true
      }
      this._startStreamedClip(clipId, trackId, src, stream, first, k0, lastK, nowOffset, nowClip.volume, nowClip.speed, nowClip.enhance)
      return true
    }
    this._pendingClips.delete(clipId)
    return true
  }

  private _startStreamedClip(
    clipId: string,
    trackId: string,
    src: string,
    stream: AudioStream,
    first: AudioBuffer,
    k0: number,
    lastK: number,
    offsetSec: number,
    volume: number,
    clipSpeed?: number,
    enhance?: ClipAudioEnhance,
  ): void {
    const ctx = this._ctx!
    this._stopClip(clipId) // also invalidates any older token and pending flag
    const trackNodes = this._ensureTrackNodes(trackId)
    const rate = this._playback.playbackRate * (clipSpeed ?? 1)
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(trackNodes.gain)
    const chain = this._chainFor(ctx, enhance)
    chain?.output.connect(gain)
    // The denoiser's output trails its input: read that much further into the
    // source so the processed sound stays on the picture (when the window allows).
    const lead = chain ? chain.latencySec * rate : 0
    if (lead > 0 && offsetSec - k0 * STREAM_CHUNK_SEC + lead < first.duration) offsetSec += lead

    const run: StreamRun = {
      src,
      stream,
      token: this._clipTokens.get(clipId)!,
      offsetSec,
      startTime: ctx.currentTime + 0.02,
      rate,
      gain,
      input: chain?.input ?? gain,
      firstK: k0,
      lastK,
      nextK: k0 + 1,
      ended: 0,
      live: true,
      filling: false,
      nodes: new Set(),
    }
    const node = this._chunkNode(clipId, run, first, run.startTime, Math.max(0, offsetSec - k0 * STREAM_CHUNK_SEC))
    trace('AUDIO', 'stream node.start', { clipId, trackId, k0, offsetSec, ctxState: ctx.state })
    this._active.set(clipId, { node, gain, trackId, run, chain, enhanceSig: enhanceSignature(enhance) })
    void this._fillStream(clipId, run)
  }

  private _chunkNode(
    clipId: string,
    run: StreamRun,
    buffer: AudioBuffer,
    when: number,
    offsetInChunk: number,
  ): AudioBufferSourceNode {
    const ctx = this._ctx!
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = run.rate
    node.connect(run.input)
    node.onended = () => {
      run.nodes.delete(node)
      if (!run.live) return
      run.ended++
      void this._fillStream(clipId, run)
    }
    run.nodes.add(node)
    node.start(when, offsetInChunk)
    return node
  }

  /** Keep the next `STREAM_AHEAD_CHUNKS` windows scheduled, back to back, after the one playing. */
  private async _fillStream(clipId: string, run: StreamRun): Promise<void> {
    if (run.filling) return
    run.filling = true
    try {
      while (run.live && run.nextK <= run.lastK && run.nextK - (run.firstK + run.ended) <= STREAM_AHEAD_CHUNKS) {
        const k = run.nextK++
        let chunk: AudioBuffer | null
        try {
          chunk = await this._chunkFor(run.src, run.stream, k)
        } catch (e) {
          console.warn(`[audio] failed to decode a window of ${run.src}:`, e)
          return
        }
        const ctx = this._ctx
        if (!run.live || this._clipTokens.get(clipId) !== run.token || !ctx) return
        if (!chunk) continue
        let when = run.startTime + (k * STREAM_CHUNK_SEC - run.offsetSec) / run.rate
        let offsetInChunk = 0
        if (when < ctx.currentTime) {
          // Decoding fell behind the clock: join the window where it is now.
          offsetInChunk = (ctx.currentTime - when) * run.rate
          when = ctx.currentTime
          if (offsetInChunk >= chunk.duration) continue
        }
        this._chunkNode(clipId, run, chunk, when, offsetInChunk)
      }
    } finally {
      run.filling = false
    }
  }

  private _startClipNode(
    clipId: string,
    trackId: string,
    buffer: AudioBuffer,
    offsetSec: number,
    volume: number,
    playbackRate: number,
    clipSpeed?: number,
    enhance?: ClipAudioEnhance,
  ): void {
    const ctx = this._ctx
    const masterGain = this._masterGain
    if (!ctx || !masterGain) return

    this._stopClip(clipId)

    const chain = this._chainFor(ctx, enhance)
    // The denoiser's output trails its input: start that much further into the
    // source so the processed sound stays on the picture.
    if (chain) offsetSec += chain.latencySec * playbackRate * (clipSpeed ?? 1)
    if (offsetSec >= buffer.duration) {
      disconnectEnhanceChain(chain)
      return
    }
    const offset = Math.max(0, offsetSec)

    const trackNodes = this._ensureTrackNodes(trackId)

    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = playbackRate * (clipSpeed ?? 1)

    const gain = ctx.createGain()
    gain.gain.value = volume

    // clipSource → [enhance chain] → clipGain → trackGain → trackAnalyser → masterGain → destination
    if (chain) {
      node.connect(chain.input)
      chain.output.connect(gain)
    } else {
      node.connect(gain)
    }
    gain.connect(trackNodes.gain)

    // Schedule 20 ms ahead to land cleanly on a future audio quantum.
    // Only push the schedule time — not the source offset — to avoid skipping
    // the first 20 ms of audio content and introducing A/V drift.
    trace('AUDIO', 'node.start', { clipId, trackId, scheduleAt: ctx.currentTime + 0.02, offset, ctxState: ctx.state })
    node.start(ctx.currentTime + 0.02, offset)

    this._active.set(clipId, { node, gain, trackId, chain, enhanceSig: enhanceSignature(enhance) })
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
    // Invalidates any in-flight _scheduleClip for this clip too — without this,
    // a pending decode that resolves after a genuine stop (clip removed, or
    // _stopAll on pause) would see itself as "stale" and bail without ever
    // clearing _pendingClips, permanently blocking future restarts.
    this._pendingClips.delete(clipId)

    const entry = this._active.get(clipId)
    if (entry) {
      if (entry.run) {
        entry.run.live = false
        for (const n of entry.run.nodes) {
          try {
            n.onended = null
            n.stop()
            n.disconnect()
          } catch {
            // Already stopped.
          }
        }
        entry.run.nodes.clear()
      }
      try {
        entry.node.stop()
        entry.node.disconnect()
        entry.gain.disconnect()
      } catch {
        // Already stopped or never started — ignore.
      }
      disconnectEnhanceChain(entry.chain)
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
    // LM-P5 backstop: a source too large for any whole-file decode is never attempted.
    const held = this._audioBlobFor(src)
    if (held && held.size > WHOLE_FILE_DECODE_MAX_BYTES) {
      return Promise.reject(new Error('AudioPlaybackController: source is too large to decode whole'))
    }

    const ctx = this._ctx
    if (!ctx) return Promise.reject(new Error('AudioPlaybackController: no AudioContext'))

    const promise = this._audioResolver(src).then((buf) => ctx.decodeAudioData(buf))
    // Evict on failure so a transient error can retry — but not straight away.
    // `_tick` reschedules a playing clip that is neither active nor pending on
    // every frame, so evicting at once turned one dead src into a fresh
    // download (and a warning) per frame for as long as playback ran. The
    // rejected promise answers for `AUDIO_RETRY_AFTER_MS` instead. The identity
    // guard avoids clobbering a newer in-flight retry. This side-chain also
    // marks the rejection "handled" so fire-and-forget preload callers don't
    // raise unhandledrejection — `_scheduleClip` still awaits `promise`
    // directly, so its own rejection handling is unaffected.
    promise.catch((e) => {
      console.warn(`[audio] failed to load ${src}:`, e)
      setTimeout(() => {
        if (this._buffers.get(src) === promise) this._buffers.delete(src)
      }, AUDIO_RETRY_AFTER_MS)
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
        // A merged video clip (embeddedAudio) is decoded from its mp4 too;
        // `cachedAudioResolver` shares bytes with the demuxer, so warming it is
        // not a second download.
        if ((clip.type === 'audio' || (clip.type === 'video' && clip.embeddedAudio === true)) && typeof clip.src === 'string') {
          this._warm(clip.src)
        }
      }
    }
  }

  /**
   * Warm the decode cache for a single URL — for callers that want to start
   * fetching+decoding as soon as a media asset is registered (e.g. clicked
   * into the library), rather than waiting for it to land on the timeline.
   */
  warmAudioSrc(src: string): void {
    if (!this._ctx) return
    this._warm(src)
  }

  private _warm(src: string): void {
    const blob = this._streamBlobFor(src)
    if (!blob) {
      void this._ensureBuffer(src)
      return
    }
    // Open the stream and decode the first window so playback from the start has no gap.
    void this._streamFor(src, blob)
      .then((stream) => this._chunkFor(src, stream, 0))
      .catch((e) => trace('AUDIO', 'stream warm failed', { src, error: String(e) }))
  }
}
