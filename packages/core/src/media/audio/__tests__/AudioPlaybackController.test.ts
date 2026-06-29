import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlaybackController } from '../AudioPlaybackController'
import type { PlaybackEngine, PlaybackSnapshot } from '../../../playback/PlaybackEngine'
import type { Project } from '../../../types'

// ---------------------------------------------------------------------------
// Fake PlaybackEngine
// ---------------------------------------------------------------------------

function makeFakeEngine() {
  let listener: ((snap: PlaybackSnapshot) => void) | null = null
  const state = { currentFrame: 0, isPlaying: false, playbackRate: 1, loop: false }

  const engine = {
    get currentFrame() { return state.currentFrame },
    get isPlaying() { return state.isPlaying },
    get playbackRate() { return state.playbackRate },
    get loop() { return state.loop },
    subscribe(fn: (snap: PlaybackSnapshot) => void) {
      listener = fn
      return () => { listener = null }
    },
    // setAudioContext is called by the controller — accept it silently.
    setAudioContext: vi.fn(),
  }

  function emit(snap: Partial<PlaybackSnapshot> & { epoch: number }): void {
    state.currentFrame = snap.currentFrame ?? state.currentFrame
    state.isPlaying = snap.isPlaying ?? state.isPlaying
    if (snap.playbackRate !== undefined) state.playbackRate = snap.playbackRate
    listener?.({
      currentFrame: state.currentFrame,
      isPlaying: state.isPlaying,
      playbackRate: state.playbackRate,
      loop: state.loop,
      epoch: snap.epoch,
    })
  }

  return { engine: engine as unknown as PlaybackEngine, emit, raw: engine }
}

// ---------------------------------------------------------------------------
// Mock AudioContext
// ---------------------------------------------------------------------------

function makeMockAudioContext() {
  const createdNodes: ReturnType<typeof makeNode>[] = []

  function makeNode() {
    return {
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      connect: vi.fn((target: unknown) => target),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  function makeGain(initialValue = 1) {
    const gains: ReturnType<typeof makeGainParam>[] = []

    function makeGainParam(v: number) {
      const param = {
        value: v,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn((target: number) => { param.value = target }),
      }
      gains.push(param)
      return param
    }

    const node = {
      gain: makeGainParam(initialValue),
      connect: vi.fn((target: unknown) => target),
      disconnect: vi.fn(),
    }
    return node
  }

  function makeAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
      connect: vi.fn((target: unknown) => target),
      disconnect: vi.fn(),
    }
  }

  const gainInstances: ReturnType<typeof makeGain>[] = []
  const analyserInstances: ReturnType<typeof makeAnalyser>[] = []
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
    createGain: vi.fn(() => {
      const g = makeGain()
      gainInstances.push(g)
      return g
    }),
    createAnalyser: vi.fn(() => {
      const a = makeAnalyser()
      analyserInstances.push(a)
      return a
    }),
    decodeAudioData: vi.fn(async () => buffer),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }

  return {
    ctx: ctx as unknown as AudioContext,
    createdNodes,
    gainInstances,
    analyserInstances,
    buffer,
    raw: ctx,
  }
}

function makeProject(overrides?: { volume?: number; trackVolume?: number }): Project {
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
        volume: overrides?.trackVolume ?? 1,
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
        volume: 1,
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
        volume: 1,
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

  // ── Basic playback ──────────────────────────────────────────────────────────

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
    expect(createdNodes[0]!.start).toHaveBeenCalledTimes(1)
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
    expect(createdNodes[0]!.start).toHaveBeenCalledTimes(1)
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

    expect(createdNodes).toHaveLength(2)
    expect(createdNodes[0]!.start).toHaveBeenCalledTimes(1)
    expect(createdNodes[1]!.start).toHaveBeenCalledTimes(1)
    // Buffer decoded once, reused from cache.
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

    expect(createdNodes[0]!.stop).toHaveBeenCalled()
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

    project = { ...project, clips: {} }
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })
    await flush()

    expect(createdNodes[0]!.stop).toHaveBeenCalled()
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

    expect(createdNodes[0]!.stop).toHaveBeenCalled()
    expect(raw.close).toHaveBeenCalled()

    const nodeStartCount = createdNodes[0]!.start.mock.calls.length
    emit({ epoch: 9, isPlaying: true, currentFrame: 0 })
    await flush()
    expect(createdNodes[0]!.start).toHaveBeenCalledTimes(nodeStartCount)
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

    expect(raw.decodeAudioData).toHaveBeenCalledTimes(2)
    expect(createdNodes).toHaveLength(2)
    expect(createdNodes[0]!.start).toHaveBeenCalledTimes(1)
    expect(createdNodes[1]!.start).toHaveBeenCalledTimes(1)
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

    project = { ...project, clips: { 'track-1': project.clips['track-1']! } }
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })
    await flush()

    const stopped = createdNodes.filter((n) => n.stop.mock.calls.length > 0)
    const running = createdNodes.filter((n) => n.stop.mock.calls.length === 0)
    expect(stopped).toHaveLength(1)
    expect(running).toHaveLength(1)
  })

  // ── Clock handoff ───────────────────────────────────────────────────────────

  it('start() calls setAudioContext on the engine with the created context', () => {
    const { engine, raw: engineRaw } = makeFakeEngine()
    const { ctx } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    expect(engineRaw.setAudioContext).toHaveBeenCalledWith(ctx)
  })

  it('destroy() calls setAudioContext(null) to detach the clock', async () => {
    const { engine, emit, raw: engineRaw } = makeFakeEngine()
    const { ctx } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()
    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    controller.destroy()

    expect(engineRaw.setAudioContext).toHaveBeenLastCalledWith(null)
  })

  // ── playbackRate ────────────────────────────────────────────────────────────

  it('sets playbackRate on the AudioBufferSourceNode', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0, playbackRate: 2 })
    await flush()

    expect(createdNodes[0]!.playbackRate.value).toBe(2)
  })

  it('reschedules with new playbackRate on rate change (epoch bump)', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, createdNodes } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0, playbackRate: 1 })
    await flush()
    emit({ epoch: 2, isPlaying: true, currentFrame: 5, playbackRate: 0.5 })
    await flush()

    expect(createdNodes).toHaveLength(2)
    expect(createdNodes[1]!.playbackRate.value).toBe(0.5)
  })

  // ── Gain ramps ──────────────────────────────────────────────────────────────

  it('uses gain ramp (linearRampToValueAtTime) instead of direct value write', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, gainInstances } = makeMockAudioContext()
    const controller = new AudioPlaybackController(
      engine,
      () => makeProject({ volume: 0.75 }),
      { audioContextFactory: () => ctx },
    )
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()
    // Subsequent snapshot triggers live gain update on existing node.
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })

    // clipGain's gain param should have used linearRampToValueAtTime.
    const clipGain = gainInstances.find(
      (g) => g.gain.linearRampToValueAtTime.mock.calls.length > 0,
    )
    expect(clipGain).toBeDefined()
    expect(clipGain!.gain.linearRampToValueAtTime).toHaveBeenCalled()
  })

  // ── Track graph ─────────────────────────────────────────────────────────────

  it('creates per-track analyser nodes', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, analyserInstances } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeMultiTrackProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // Two tracks → two analysers.
    expect(analyserInstances).toHaveLength(2)
  })

  it('getTrackLevels() returns an entry per active track', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeMultiTrackProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    const levels = controller.getTrackLevels()
    expect(levels.size).toBe(2)
    expect(levels.has('track-1')).toBe(true)
    expect(levels.has('track-2')).toBe(true)
  })

  it('getTrackLevels() returns { left, right } numbers', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    const levels = controller.getTrackLevels()
    const entry = levels.get('audio-track')
    expect(entry).toBeDefined()
    expect(typeof entry!.left).toBe('number')
    expect(typeof entry!.right).toBe('number')
  })

  // ── Mixer API ───────────────────────────────────────────────────────────────

  it('setMasterGain() ramps the master gain node', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, gainInstances } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // masterGain is the first gain created in start().
    const masterGain = gainInstances[0]!
    controller.setMasterGain(0.5)

    expect(masterGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.5,
      expect.any(Number),
    )
  })

  it('setTrackGain() ramps the per-track gain node', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, gainInstances } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    controller.setTrackGain('audio-track', 0.3)

    // trackGain is created after masterGain and clipGain → it's the 3rd gain.
    const rampedGains = gainInstances.filter(
      (g) => g.gain.linearRampToValueAtTime.mock.calls.some(([v]: [number]) => v === 0.3),
    )
    expect(rampedGains.length).toBeGreaterThan(0)
  })

  it('setMasterGain() clamps to 0 for negative values', () => {
    const { engine } = makeFakeEngine()
    const { ctx, gainInstances } = makeMockAudioContext()
    const controller = new AudioPlaybackController(engine, () => makeProject(), {
      audioContextFactory: () => ctx,
    })
    controller.start()

    controller.setMasterGain(-1)

    const masterGain = gainInstances[0]!
    expect(masterGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      expect.any(Number),
    )
  })

  // ── Mute / track volume via resolver ───────────────────────────────────────

  it('muted track produces volume 0 on the clip gain node', async () => {
    const { engine, emit } = makeFakeEngine()
    const { ctx, gainInstances } = makeMockAudioContext()
    const project: Project = {
      ...makeProject(),
      tracks: [
        {
          id: 'audio-track',
          name: 'Audio',
          kind: 'audio',
          order: 0,
          height: 60,
          locked: false,
          disabled: false,
          muted: true,
          solo: false,
          volume: 1,
        },
      ],
    }
    const controller = new AudioPlaybackController(engine, () => project, {
      audioContextFactory: () => ctx,
    })
    controller.start()

    emit({ epoch: 1, isPlaying: true, currentFrame: 0 })
    await flush()

    // A second same-epoch snapshot triggers the live ramp update on the existing node.
    emit({ epoch: 1, isPlaying: true, currentFrame: 1 })

    // The clip gain should have been ramped to 0 (muted track → effective volume 0).
    const clipGain = gainInstances.find((g) =>
      g.gain.linearRampToValueAtTime.mock.calls.some(([v]: [number]) => v === 0),
    )
    expect(clipGain).toBeDefined()
  })
})
