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
  // Each createBufferSource() call returns a fresh node so multi-track tests
  // can assert on individual nodes independently.
  const createdNodes: ReturnType<typeof makeNode>[] = []

  function makeNode() {
    return {
      buffer: null as AudioBuffer | null,
      connect: vi.fn((target: unknown) => target),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    }
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
    createBufferSource: vi.fn(() => {
      const n = makeNode()
      createdNodes.push(n)
      return n
    }),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(async () => buffer),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }

  return {
    ctx: ctx as unknown as AudioContext,
    createdNodes,
    gain,
    buffer,
    raw: ctx,
  }
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
    transitions: [],
    version: 1,
  }
}

function makeMultiTrackProject(): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1920, height: 1080 },
    tracks: [
      {
        id: 'track-1',
        name: 'Audio 1',
        kind: 'audio',
        order: 0,
        height: 60,
        locked: false,
        disabled: false,
        muted: false,
        solo: false,
      },
      {
        id: 'track-2',
        name: 'Audio 2',
        kind: 'audio',
        order: 1,
        height: 60,
        locked: false,
        disabled: false,
        muted: false,
        solo: false,
      },
    ],
    clips: {
      'track-1': [
        {
          id: 'clip-a',
          trackId: 'track-1',
          type: 'audio',
          name: 'A',
          startFrame: 0,
          durationFrames: 120,
          sourceStartFrame: 0,
          sourceDurationFrames: 120,
          src: 'audio://sample-a',
          volume: 0.8,
        },
      ],
      'track-2': [
        {
          id: 'clip-b',
          trackId: 'track-2',
          type: 'audio',
          name: 'B',
          startFrame: 0,
          durationFrames: 120,
          sourceStartFrame: 0,
          sourceDurationFrames: 120,
          src: 'audio://sample-b',
          volume: 0.6,
        },
      ],
    },
    transitions: [],
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
    const { ctx, createdNodes, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    expect(raw.decodeAudioData).toHaveBeenCalledTimes(1)
    // sourceFrame 0 / fps 30 = 0s offset, scheduled at ctx.currentTime (0).
    expect(createdNodes[0].start).toHaveBeenCalledWith(0, 0)
  })

  it('does NOT restart on a plain frame advance (same epoch)', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 1, isPlaying: true, currentFrame: 5 })
    await flush()

    expect(createdNodes).toHaveLength(1)
    expect(createdNodes[0].start).toHaveBeenCalledTimes(1)
  })

  it('reschedules from the new position on seek (epoch bump) while playing', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 2, isPlaying: true, currentFrame: 30 })
    await flush()

    // Two separate nodes: one per schedule.
    expect(createdNodes).toHaveLength(2)
    expect(createdNodes[0].start).toHaveBeenCalledWith(0, 0)
    // Frame 30 / fps 30 = 1s offset.
    expect(createdNodes[1].start).toHaveBeenCalledWith(0, 1)
    // Buffer decoded once and reused from cache.
    expect(raw.decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('stops the node on pause', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    emit({ epoch: 2, isPlaying: false, currentFrame: 10 })
    await flush()

    expect(createdNodes[0].stop).toHaveBeenCalled()
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
    const { ctx, createdNodes } = makeMockAudioContext()
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

    expect(createdNodes[0].stop).toHaveBeenCalled()
  })

  it('destroy() unsubscribes, stops, and closes the context', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    controller.destroy()

    const firstNode = createdNodes[0]
    expect(firstNode.stop).toHaveBeenCalled()
    expect(raw.close).toHaveBeenCalled()

    // After destroy, further emits are ignored (unsubscribed).
    const nodeStartCount = firstNode.start.mock.calls.length
    emit({ epoch: 9, isPlaying: true, currentFrame: 0 })
    await flush()
    expect(firstNode.start).toHaveBeenCalledTimes(nodeStartCount)
  })

  it('starts a node for every active audio clip simultaneously (multi-track mixing)', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes, raw } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeMultiTrackProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // Both clips decoded and both nodes started.
    expect(raw.decodeAudioData).toHaveBeenCalledTimes(2)
    expect(createdNodes).toHaveLength(2)
    expect(createdNodes[0].start).toHaveBeenCalledTimes(1)
    expect(createdNodes[1].start).toHaveBeenCalledTimes(1)
  })

  it('stops only the clip that leaves the scene, keeps others playing', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes } = makeMockAudioContext()
    let project = makeMultiTrackProject()
    const controller = new AudioPlaybackController(engine, () => project, {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // Remove track-2's clip so only clip-a remains active.
    project = { ...project, clips: { 'track-1': project.clips['track-1']! } }
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })
    await flush()

    // One of the two nodes was stopped; the other kept playing (start called once, stop once).
    const stopped = createdNodes.filter((n) => n.stop.mock.calls.length > 0)
    const running = createdNodes.filter((n) => n.stop.mock.calls.length === 0)
    expect(stopped).toHaveLength(1)
    expect(running).toHaveLength(1)
  })
})
