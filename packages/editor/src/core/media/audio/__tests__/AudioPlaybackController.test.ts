import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlaybackController } from '../AudioPlaybackController'
import type { PlaybackEngine, PlaybackSnapshot } from '../../../playback/PlaybackEngine'
import type { Project } from '../../../types'

// ---------------------------------------------------------------------------
// Fake PlaybackEngine — lets us drive snapshots by hand without a RAF loop
// (vitest runs in the `node` environment; requestAnimationFrame is absent).
// ---------------------------------------------------------------------------

function makeFakeEngine() {
  let listener: ((snap: PlaybackSnapshot) => void) | null = null
  const state = { currentFrame: 0, isPlaying: false, playbackRate: 1, loop: false }

  const engine = {
    get currentFrame() {
      return state.currentFrame
    },
    get isPlaying() {
      return state.isPlaying
    },
    get playbackRate() {
      return state.playbackRate
    },
    get loop() {
      return state.loop
    },
    subscribe(fn: (snap: PlaybackSnapshot) => void) {
      listener = fn
      return () => {
        listener = null
      }
    },
  }

  /** Emit a snapshot to the controller, updating the engine's reported state. */
  function emit(snap: Partial<PlaybackSnapshot> & { epoch: number }): void {
    state.currentFrame = snap.currentFrame ?? state.currentFrame
    state.isPlaying = snap.isPlaying ?? state.isPlaying
    listener?.({
      currentFrame: state.currentFrame,
      isPlaying: state.isPlaying,
      playbackRate: state.playbackRate,
      loop: state.loop,
      epoch: snap.epoch,
    })
  }

  return { engine: engine as unknown as PlaybackEngine, emit }
}

// ---------------------------------------------------------------------------
// Mock AudioContext
// ---------------------------------------------------------------------------

function makeMockAudioContext() {
  const node = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn((target: unknown) => target),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  }
  const gain = {
    gain: { value: 1 },
    connect: vi.fn((target: unknown) => target),
    disconnect: vi.fn(),
  }
  const buffer = { duration: 4 } as AudioBuffer

  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {},
    createBufferSource: vi.fn(() => node),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(async () => buffer),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }

  return { ctx: ctx as unknown as AudioContext, node, gain, buffer, raw: ctx }
}

function makeProject(overrides?: { volume?: number }): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [
      {
        id: 'audio-track',
        name: 'Audio',
        kind: 'audio',
        order: 0,
        height: 60,
        locked: false,
        disabled: false,
        muted: false,
        solo: false,
      },
    ],
    clips: {
      'audio-track': [
        {
          id: 'clip-1',
          trackId: 'audio-track',
          type: 'audio',
          name: 'A',
          startFrame: 0,
          durationFrames: 120,
          sourceStartFrame: 0,
          sourceDurationFrames: 120,
          src: 'audio://sample',
          volume: overrides?.volume ?? 0.5,
        },
      ],
    },
    version: 1,
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioPlaybackController', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes and starts the node at the correct offset on play', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    expect(raw.decodeAudioData).toHaveBeenCalledTimes(1)
    // sourceFrame 0 / fps 30 = 0s offset, scheduled at ctx.currentTime (0).
    expect(node.start).toHaveBeenCalledWith(0, 0)
  })

  it('does NOT restart on a plain frame advance (same epoch)', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 1, isPlaying: true, currentFrame: 5 })
    await flush()

    expect(node.start).toHaveBeenCalledTimes(1)
  })

  it('reschedules from the new position on seek (epoch bump) while playing', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 2, isPlaying: true, currentFrame: 30 })
    await flush()

    expect(node.start).toHaveBeenCalledTimes(2)
    // Frame 30 / fps 30 = 1s offset.
    expect(node.start).toHaveBeenLastCalledWith(0, 1)
    // Buffer decoded once and reused from cache.
    expect(raw.decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('stops the node on pause', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 2, isPlaying: false, currentFrame: 10 })
    await flush()

    expect(node.stop).toHaveBeenCalled()
  })

  it('tracks clip volume on the gain node', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, gain } = makeMockAudioContext()
    const controller = new AudioPlaybackController(
      engine,
      () => makeProject({ volume: 0.25 }),
      { audioContextFactory: () => ctx },
    )
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    // A subsequent snapshot updates the live gain.
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })

    expect(gain.gain.value).toBe(0.25)
  })

  it('stops audio when no audio clip is active', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node } = makeMockAudioContext()
    let project = makeProject()
    const controller = new AudioPlaybackController(engine, () => project, {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // Remove all clips → resolver yields no active audio.
    project = { ...project, clips: {} }
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })
    await flush()

    expect(node.stop).toHaveBeenCalled()
  })

  it('destroy() unsubscribes, stops, and closes the context', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, node, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    controller.destroy()

    expect(node.stop).toHaveBeenCalled()
    expect(raw.close).toHaveBeenCalled()

    // After destroy, further emits are ignored (unsubscribed).
    node.start.mockClear()
    emit({ epoch: 9, isPlaying: true, currentFrame: 0 })
    await flush()
    expect(node.start).not.toHaveBeenCalled()
  })
})
