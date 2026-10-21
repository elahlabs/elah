import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import type { Clip, Keyframe, Project, Track } from '../../types'
import { sampleChannel } from '../../resolver/keyframes'
import type { ExpressionError } from '../../resolver/expr/scope'
import { renderAudioMix } from '../exportVideo'
import { flattenAudioClips } from '../../elements/compound'
import {
  applyGainEvents,
  audibleSpan,
  gainAutomation,
  hasAudibleSolo,
  isAudioTrackAudible,
  isClipAudioAudible,
  scheduleAudioClip,
  type GainEvent,
  type GainParamLike,
} from '../audioMix'

/**
 * The export audio mix (PV-P1b-2).
 *
 * The property under test is that collection is `flattenAudioClips`, so audio
 * inside a compound is scheduled at its ABSOLUTE position with its ancestors'
 * gains folded in — and that a project with no compounds produces exactly what the
 * old top-level filter produced, so legacy documents are untouched.
 *
 * The `OfflineAudioContext` double is not a spy: `startRendering` really sums the
 * scheduled sources into a Float32Array, honouring gain and playbackRate. That is
 * what lets the last test assert SILENCE before a nested clip's start, which a
 * call-recorder could not distinguish from "scheduled but inaudible".
 */

const FPS = 30
/** Every fake source is a constant DC value, so gain is readable in the mix. */
const SOURCE_DC = 1

interface Scheduled {
  src: string
  /** `start(when, offset, duration)` — all seconds, duration in SOURCE time. */
  when: number
  offset: number
  duration: number
  rate: number
  gain: number
  bufferSeconds: number
}

const scheduled: Scheduled[] = []
/** Gain nodes in creation order; the mix makes one per source, just before start(). */
const gainNodes: Array<{ gain: { value: number } }> = []
let decodeCount = 0
let resolveShouldFail: (src: string) => boolean = () => false

/** A constant-valued AudioBuffer double, tagged with the src it came from. */
function fakeBuffer(seconds: number, src: string) {
  return { duration: seconds, length: Math.round(seconds * 44100), sampleRate: 44100, numberOfChannels: 1, __src: src }
}

/**
 * Tagged ArrayBuffers: the resolver marks what it fetched, so `decodeAudioData`
 * can label the buffer. An AudioBufferSourceNode carries no src in the real API,
 * so this is the only honest way a test can tell two scheduled sources apart.
 */
function tagged(src: string): ArrayBuffer {
  const buf = new ArrayBuffer(8)
  ;(buf as ArrayBuffer & { __src?: string }).__src = src
  return buf
}

class FakeOfflineAudioContext {
  readonly sampleRate: number
  readonly length: number
  constructor(_channels: number, length: number, sampleRate: number) {
    this.length = length
    this.sampleRate = sampleRate
  }
  createBufferSource() {
    const node = {
      buffer: null as { duration: number; __src: string } | null,
      playbackRate: { value: 1 },
      connect: (n: unknown) => n,
      start: (when: number, offset: number, duration: number) => {
        // The mix creates the source, then its gain, then connects, then starts —
        // so the most recently created gain IS this source's gain.
        const g = gainNodes[gainNodes.length - 1]
        scheduled.push({
          src: node.buffer?.__src ?? '',
          when,
          offset,
          duration,
          rate: node.playbackRate.value,
          gain: g?.gain.value ?? 1,
          bufferSeconds: node.buffer?.duration ?? 0,
        })
      },
    }
    return node
  }
  createGain() {
    // PV-P10a: `renderAudioMix` now schedules gain via `applyGainEvents`
    // (`setValueAtTime`/`linearRampToValueAtTime`), never a direct `.value =`
    // assignment — these two mimic just enough of the real AudioParam to keep
    // `gain.value` correct for the `gain: g?.gain.value ?? 1` recorder below;
    // every fixture here is a STATIC (unkeyed) clip, so gainAutomation always
    // emits exactly one `set` call before `start()` reads it.
    const g = {
      gain: {
        value: 1,
        setValueAtTime(value: number) {
          g.gain.value = value
        },
        linearRampToValueAtTime(value: number) {
          g.gain.value = value
        },
      },
      connect: (n: unknown) => n,
    }
    gainNodes.push(g)
    return g
  }
  get destination() {
    return {}
  }
  decodeAudioData(buf: ArrayBuffer) {
    decodeCount++
    const src = (buf as ArrayBuffer & { __src?: string }).__src ?? 'unknown'
    return Promise.resolve(fakeBuffer(10, src))
  }
  async startRendering() {
    // Really mix: each source is DC for its scheduled span, scaled by gain, with
    // playbackRate shortening the SPAN it occupies (duration is in source time).
    const out = new Float32Array(this.length)
    for (const s of scheduled) {
      const startSample = Math.round(s.when * this.sampleRate)
      const spanSamples = Math.round((s.duration / s.rate) * this.sampleRate)
      for (let i = 0; i < spanSamples; i++) {
        const idx = startSample + i
        if (idx >= 0 && idx < out.length) out[idx] += SOURCE_DC * s.gain
      }
    }
    return {
      numberOfChannels: 1,
      length: this.length,
      sampleRate: this.sampleRate,
      getChannelData: () => out,
    }
  }
}

// --- project builders -------------------------------------------------------

function audioClip(over: Partial<Clip> & { startFrame: number; durationFrames: number }): Clip {
  return {
    type: 'audio',
    src: 'a.mp3',
    name: 'a',
    trackId: '',
    sourceStartFrame: 0,
    volume: 1,
    ...over,
  } as Clip
}

/**
 * Insert a clip, then apply the fields `addClip` does NOT take.
 *
 * `addClip` funnels through `createClip`, which builds a fresh clip and hardcodes
 * `sourceStartFrame: 0` and `disabled: false` — so a fixture that passes `speed`,
 * `disabled` or a trim offset straight to `addClip` silently gets a DIFFERENT clip
 * than it asked for, and the test fails for a reason that has nothing to do with
 * the mix. Those fields go through `updateClip`.
 */
function insert(engine: TimelineEngine, trackId: string, clip: Clip): Clip {
  const added = engine.addClip({ ...clip, trackId } as never)
  const patch: Partial<Clip> = {}
  if (clip.disabled) patch.disabled = true
  if (clip.sourceStartFrame) patch.sourceStartFrame = clip.sourceStartFrame
  if (clip.speed !== undefined) patch.speed = clip.speed
  if (Object.keys(patch).length) engine.updateClip(added.id, trackId, patch)
  return added
}

/** A child project holding one audio clip on its own track. */
function childProject(clip: Clip, trackVolume = 1): Project {
  const engine = new TimelineEngine({ fps: FPS })
  const track = engine.addTrack('audio')
  insert(engine, track.id, clip)
  return withTrackVolume(engine.getProject(), track.id, trackVolume)
}

/** A parent project whose single clip is `clip` (usually the compound). */
function parentProject(clip: Clip, trackVolume = 1): Project {
  const engine = new TimelineEngine({ fps: FPS })
  const track = engine.addTrack('elements')
  insert(engine, track.id, clip)
  return withTrackVolume(engine.getProject(), track.id, trackVolume)
}

function withTrackVolume(project: Project, trackId: string, volume: number): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, volume } : t)) }
}

function compoundClip(nested: Project, over: Partial<Clip> = {}): Clip {
  return {
    type: 'compound',
    name: 'C',
    trackId: '',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    volume: 1,
    compound: { project: nested },
    ...over,
  } as Clip
}

const resolver = async (src: string) => {
  if (resolveShouldFail(src)) throw new Error(`boom ${src}`)
  return tagged(src)
}

beforeEach(() => {
  scheduled.length = 0
  gainNodes.length = 0
  decodeCount = 0
  resolveShouldFail = () => false
  ;(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext
})

afterEach(() => {
  delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext
})

// --- tests ------------------------------------------------------------------

describe('renderAudioMix — no audio', () => {
  it('returns null for a project with nothing in it', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    expect(await renderAudioMix(engine.getProject(), resolver)).toBeNull()
  })

  it('returns null when no audio clip survives filtering', async () => {
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 30, disabled: true }))
    expect(await renderAudioMix(project, resolver)).toBeNull()
    expect(scheduled).toHaveLength(0)
  })

  it('reports an issue and returns null when OfflineAudioContext is unavailable', async () => {
    delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext
    const issues: string[] = []
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 30 }))
    const result = await renderAudioMix(project, resolver, (m) => issues.push(m))
    expect(result).toBeNull()
    expect(issues.join(' ')).toMatch(/OfflineAudioContext unavailable/)
  })
})

describe('renderAudioMix — a flat project is unchanged', () => {
  it('schedules a top-level clip exactly as the old filter did', async () => {
    const project = parentProject(audioClip({ startFrame: 15, durationFrames: 30, sourceStartFrame: 45, volume: 0.5 }))
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({
      when: 15 / FPS,
      offset: 45 / FPS,
      duration: 30 / FPS,
      rate: 1,
      gain: 0.5,
    })
  })

  it('applies the clip track volume on top of the clip volume', async () => {
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 30, volume: 0.4 }), 0.5)
    await renderAudioMix(project, resolver)
    expect(scheduled[0]!.gain).toBeCloseTo(0.2, 10)
  })

  it('honours playbackRate for an ordinary sped-up audio clip', async () => {
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 30, speed: 2 }))
    await renderAudioMix(project, resolver)
    expect(scheduled[0]!.rate).toBe(2)
    // duration is SOURCE time: 1s of timeline at 2x consumes 2s of buffer.
    expect(scheduled[0]!.duration).toBeCloseTo((30 / FPS) * 2, 10)
  })
})

describe('renderAudioMix — audio inside a compound', () => {
  it('schedules a nested clip at its ABSOLUTE start', async () => {
    // child starts at frame 20; the compound starts at frame 100 → 120/30 = 4s.
    const child = childProject(audioClip({ startFrame: 20, durationFrames: 30 }))
    const project = parentProject(compoundClip(child, { startFrame: 100, durationFrames: 60 }))
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.when).toBeCloseTo(120 / FPS, 10)
  })

  it('multiplies ancestor gain by the child clip gain', async () => {
    const child = childProject(audioClip({ startFrame: 0, durationFrames: 30, volume: 0.8 }))
    const project = parentProject(compoundClip(child, { startFrame: 0, durationFrames: 60, volume: 0.5 }), 0.5)
    await renderAudioMix(project, resolver)
    // ancestor .5 (compound volume) x child .8 x own track .5 = .2
    expect(scheduled[0]!.gain).toBeCloseTo(0.2, 10)
  })

  it('starts a nested clip in silence and is audible from its start', async () => {
    const child = childProject(audioClip({ startFrame: 30, durationFrames: 30, volume: 1 }))
    const project = parentProject(compoundClip(child, { startFrame: 0, durationFrames: 60 }))
    const mixed = await renderAudioMix(project, resolver)
    expect(mixed).not.toBeNull()
    const pcm = new Float32Array(mixed!.channels[0])
    const at = (sec: number) => pcm[Math.round(sec * mixed!.sampleRate)] ?? 0
    // The child starts 30 frames = 1s in, so before that the mix is silent and
    // from its start it carries the clip's gain.
    expect(at(0)).toBe(0)
    expect(at(0.5)).toBe(0)
    expect(at(1.05)).toBeCloseTo(1, 5)
  })

  it('mixes audio from two compounds at their own absolute positions', async () => {
    const a = childProject(audioClip({ startFrame: 0, durationFrames: 30, src: 'a.mp3' }))
    const b = childProject(audioClip({ startFrame: 0, durationFrames: 30, src: 'b.mp3' }))
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('elements')
    insert(engine, track.id, compoundClip(a, { startFrame: 0, durationFrames: 30 }))
    insert(engine, track.id, compoundClip(b, { startFrame: 60, durationFrames: 30 }))
    await renderAudioMix(engine.getProject(), resolver)
    expect(scheduled).toHaveLength(2)
    expect(scheduled[0]!.when).toBeCloseTo(0, 10)
    expect(scheduled[1]!.when).toBeCloseTo(60 / FPS, 10)
  })
})

describe('renderAudioMix — issues and cleanup', () => {
  it('decodes a shared src once for two clips', async () => {
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    insert(engine, track.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'same.mp3' }))
    insert(engine, track.id, audioClip({ startFrame: 30, durationFrames: 30, src: 'same.mp3' }))
    await renderAudioMix(engine.getProject(), resolver)
    expect(scheduled).toHaveLength(2)
    expect(decodeCount).toBe(1)
  })

  it('yields no node for audio inside a muted ancestor', async () => {
    const child = childProject(audioClip({ startFrame: 0, durationFrames: 30 }))
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('elements')
    insert(engine, track.id, compoundClip(child, { startFrame: 0, durationFrames: 30 }))
    const project = engine.getProject()
    const muted = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, muted: true } : t)),
    }
    await renderAudioMix(muted, resolver)
    expect(scheduled).toHaveLength(0)
  })

  it('reports a retimed compound ONCE per skipped ancestor', async () => {
    const child = childProject(audioClip({ startFrame: 0, durationFrames: 30 }))
    const project = parentProject(compoundClip(child, { startFrame: 0, durationFrames: 30, speed: 2 }))
    const issues: string[] = []
    await renderAudioMix(project, resolver, (m) => issues.push(m))
    const retimed = issues.filter((m) => /retimed compound/.test(m))
    expect(retimed).toHaveLength(1)
    expect(scheduled).toHaveLength(0)
  })

  it('a failing source does not suppress another valid one', async () => {
    resolveShouldFail = (src) => src === 'bad.mp3'
    const engine = new TimelineEngine({ fps: FPS })
    const track = engine.addTrack('audio')
    insert(engine, track.id, audioClip({ startFrame: 0, durationFrames: 30, src: 'bad.mp3' }))
    insert(engine, track.id, audioClip({ startFrame: 30, durationFrames: 30, src: 'good.mp3' }))
    const issues: string[] = []
    const mixed = await renderAudioMix(engine.getProject(), resolver, (m) => issues.push(m))
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.src).toBe('good.mp3')
    expect(issues.some((m) => /decode error/.test(m))).toBe(true)
    expect(mixed).not.toBeNull()
  })
})

/**
 * PV-P9a-1: the range-aware mix. `renderAudioMix`'s new (optional, trailing)
 * `range` parameter intersects each flattened entry's ABSOLUTE window with
 * the export range before anything is scheduled — a clip entirely outside
 * the range is dropped, one straddling an edge keeps only the overlapping
 * slice, and the schedule is zero-based against `range.startFrame` (not the
 * project), matching ExportWorker.ts's own zero-based encode timestamps.
 *
 * Every case here passes an explicit `range`; the describe blocks above never
 * pass one (so `renderAudioMix` defaults to the whole project) and are left
 * completely untouched by this addition — their continuing to pass is what
 * proves the range parameter is additive, not a behaviour change to the
 * legacy (whole-project) path.
 */
describe('renderAudioMix — export range (PV-P9a-1)', () => {
  it("the ticket's own worked example: clip [0,100), range [20,50) → when=0s, offset=20/fps, duration=30/fps", async () => {
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 100 }))
    await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({
      when: 0,
      offset: 20 / FPS,
      duration: 30 / FPS,
      rate: 1,
    })
  })

  it('drops a clip entirely BEFORE the range', async () => {
    // Absolute window [0, 10); range starts at frame 20 — no overlap at all.
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 10 }))
    const mixed = await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(0)
    expect(mixed).toBeNull()
  })

  it('drops a clip entirely AFTER the range', async () => {
    // Absolute window [60, 70); range ends at frame 50 — no overlap at all.
    const project = parentProject(audioClip({ startFrame: 60, durationFrames: 10 }))
    const mixed = await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(0)
    expect(mixed).toBeNull()
  })

  it('trims the HEAD of a clip straddling the range start', async () => {
    // Absolute window [10, 40); range [20, 50) → overlap [20, 40), 20 frames.
    // head = 20 - 10 = 10 frames trimmed from the clip's own front.
    const project = parentProject(audioClip({ startFrame: 10, durationFrames: 30, sourceStartFrame: 0 }))
    await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({
      when: 0, // overlap starts exactly at range.startFrame
      offset: 10 / FPS, // sourceStartFrame(0) + head(10) * rate(1)
      duration: 20 / FPS, // overlapFrames(20) / fps * rate(1)
      rate: 1,
    })
  })

  it('clamps the DURATION of a clip straddling the range end', async () => {
    // Absolute window [40, 70); range [20, 50) → overlap [40, 50), 10 frames.
    // head = 40 - 40 = 0: nothing trimmed from the front, only the tail is cut.
    const project = parentProject(audioClip({ startFrame: 40, durationFrames: 30, sourceStartFrame: 5 }))
    await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({
      when: 20 / FPS, // overlap starts 20 frames into the range
      offset: 5 / FPS, // sourceStartFrame(5) + head(0) — untouched
      duration: 10 / FPS, // overlapFrames(10) / fps * rate(1), not the clip's full 30
      rate: 1,
    })
  })

  it('scales the head trim and the source offset by a non-default playback rate', async () => {
    // Absolute window [10, 50) at speed 2x; range [20, 50) → overlap [20, 50),
    // 30 frames. head = 20 - 10 = 10 TIMELINE frames, which at 2x consumes 20
    // SOURCE frames — this is the case that would silently pass with `head`
    // added unscaled, so it pins the `head * rate` term specifically.
    const project = parentProject(audioClip({ startFrame: 10, durationFrames: 40, sourceStartFrame: 0, speed: 2 }))
    await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({
      when: 0,
      offset: (10 * 2) / FPS, // sourceStartFrame(0) + head(10) * rate(2)
      duration: (30 / FPS) * 2, // overlapFrames(30) / fps * rate(2) — SOURCE time
      rate: 2,
    })
  })

  it('a straddling clip is audible only across its clamped overlap, not its full original span (PCM)', async () => {
    // Absolute window [10, 40); range [20, 50) → overlap [20, 40). Without the
    // range clamp this clip would still be playing through the whole 20-frame
    // overlap and beyond; with it, sound stops the instant the ORIGINAL clip's
    // own end (frame 40, i.e. output t = 20/fps) is reached, one output-range
    // frame short of the range's own end at 30/fps.
    const project = parentProject(audioClip({ startFrame: 10, durationFrames: 30, volume: 1 }))
    const mixed = await renderAudioMix(project, resolver, undefined, { startFrame: 20, endFrame: 50, totalFrames: 30 })
    expect(mixed).not.toBeNull()
    const pcm = new Float32Array(mixed!.channels[0])
    const at = (sec: number) => pcm[Math.round(sec * mixed!.sampleRate)] ?? 0
    expect(at(0)).toBeCloseTo(1, 5) // audible from output t=0 (overlap starts at range.startFrame)
    expect(at(0.5 / FPS)).toBeCloseTo(1, 5)
    expect(at(21 / FPS)).toBe(0) // silent past the clip's own end (20 output frames in)
    expect(at(29 / FPS)).toBe(0) // and silent for the rest of the output range
  })

  it('no scheduled clip starts or plays past the output range — the mix buffer is sized to the range, not the project', async () => {
    const project = parentProject(audioClip({ startFrame: 0, durationFrames: 100, volume: 1 }))
    const range = { startFrame: 20, endFrame: 50, totalFrames: 30 }
    const mixed = await renderAudioMix(project, resolver, undefined, range)
    expect(mixed).not.toBeNull()
    // Rendered length matches the RANGE's duration (30 frames), not the
    // project's (100 frames) — "no audio outside output range" holds
    // structurally: there is nowhere in the buffer for it to be.
    expect(mixed!.length).toBe(Math.ceil(mixed!.sampleRate * (range.totalFrames / FPS)))
    expect(scheduled[0]!.when).toBe(0)
    expect(scheduled[0]!.when + scheduled[0]!.duration).toBeLessThanOrEqual(range.totalFrames / FPS + 1e-9)
  })

  it('an explicit whole-project range reduces to exactly the legacy (no-range) schedule', async () => {
    const clip = audioClip({ startFrame: 15, durationFrames: 30, sourceStartFrame: 45, volume: 0.5 })
    const legacyProject = parentProject(clip)
    await renderAudioMix(legacyProject, resolver)
    const legacy = { ...scheduled[0]! }
    scheduled.length = 0
    const rangedProject = parentProject(clip)
    await renderAudioMix(rangedProject, resolver, undefined, { startFrame: 0, endFrame: 60, totalFrames: 60 })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toEqual(legacy)
  })
})

/**
 * PV-P10a: the pure math in `export/audioMix.ts`, tested directly — no
 * `OfflineAudioContext` double needed for these, since the functions never
 * touch Web Audio.
 */

/** `{ id, frame, value, easing: 'linear', ...extra }` — the ticket's own helper shape. */
function key(frame: number, value: number, extra: Partial<Keyframe> = {}): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear', ...extra } as Keyframe
}

/** A minimal literal audio clip for the pure functions — NOT routed through
 *  TimelineEngine/createClip, so every field, including `keyframes`, survives
 *  exactly as written. */
function pureClip(over: Partial<Clip> & { startFrame: number; durationFrames: number }): Clip {
  return {
    id: 'c1',
    type: 'audio',
    src: 'a.mp3',
    name: 'a',
    trackId: 't1',
    sourceStartFrame: 0,
    ...over,
  } as Clip
}

function pureTrack(over: Partial<Track> = {}): Track {
  return {
    id: 't1',
    name: 'Track',
    kind: 'audio',
    order: 0,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...over,
  }
}

function volumeKeys(keys: Keyframe[]): NonNullable<Clip['keyframes']> {
  return { channels: { volume: { source: { kind: 'keyframes' }, keys } } }
}

describe('gainAutomation / scheduleAudioClip / audibleSpan (PV-P10a)', () => {
  it('constant volume, no track volume: one set event at the clip volume', () => {
    const clip = pureClip({ startFrame: 30, durationFrames: 60, sourceStartFrame: 0, volume: 0.8 })
    const track = pureTrack()
    const events = gainAutomation(clip, track, 30, { startFrame: 0, endFrame: 300 })
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 1, value: 0.8 }])
  })

  it('multiplies by track volume, and mute zeroes it', () => {
    const clip = pureClip({ startFrame: 30, durationFrames: 60, sourceStartFrame: 0, volume: 0.8 })
    const half = gainAutomation(clip, pureTrack({ volume: 0.5 }), 30, { startFrame: 0, endFrame: 300 })
    expect(half).toEqual<GainEvent[]>([{ kind: 'set', time: 1, value: 0.4 }])
    const muted = gainAutomation(clip, pureTrack({ muted: true }), 30, { startFrame: 0, endFrame: 300 })
    expect(muted).toEqual<GainEvent[]>([{ kind: 'set', time: 1, value: 0 }])
  })

  it('linear fade: two events, the ramp value scaled by track volume, and the clip volume field is ignored once keyed', () => {
    const clip = pureClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      keyframes: volumeKeys([key(0, 0), key(10, 1)]),
    })
    const track = pureTrack()
    const range = { startFrame: 0, endFrame: 20 }
    const base = gainAutomation(clip, track, 10, range)
    expect(base).toEqual<GainEvent[]>([
      { kind: 'set', time: 0, value: 0 },
      { kind: 'ramp', time: 1, value: 1 },
    ])

    const withTrackVolume = gainAutomation(clip, pureTrack({ volume: 2 }), 10, range)
    expect(withTrackVolume).toEqual<GainEvent[]>([
      { kind: 'set', time: 0, value: 0 },
      { kind: 'ramp', time: 1, value: 2 },
    ])

    const withClipVolume = gainAutomation({ ...clip, volume: 0.3 }, track, 10, range)
    expect(withClipVolume).toEqual(base) // keys win over the static clip.volume field
  })

  it('hold: steps, then ramps into the destination key', () => {
    const clip = pureClip({
      startFrame: 0,
      durationFrames: 10,
      sourceStartFrame: 0,
      keyframes: volumeKeys([key(0, 1, { hold: true }), key(5, 0.2)]),
    })
    const events = gainAutomation(clip, pureTrack(), 10, { startFrame: 0, endFrame: 10 })
    expect(events).toEqual<GainEvent[]>([
      { kind: 'set', time: 0, value: 1 },
      { kind: 'ramp', time: 0.4, value: 1 },
      { kind: 'ramp', time: 0.5, value: 0.2 },
    ])
  })

  it('an eased curve: first/last pinned, at most one event per frame, and every event matches sampleChannel', () => {
    const keys = [key(0, 0), key(10, 1, { easing: 'quad-in-out' })]
    const clip = pureClip({ startFrame: 0, durationFrames: 11, sourceStartFrame: 0, keyframes: volumeKeys(keys) })
    const fps = 10
    const events = gainAutomation(clip, pureTrack(), fps, { startFrame: 0, endFrame: 11 })
    expect(events.length).toBeLessThanOrEqual(11)
    expect(events[0]).toEqual({ kind: 'set', time: 0, value: 0 })
    expect(events[events.length - 1]).toEqual({ kind: 'ramp', time: 1, value: 1 })
    for (const e of events) {
      const frame = e.time * fps
      expect(e.value).toBeCloseTo(sampleChannel(keys, frame)!, 9)
    }
  })

  it('a range cut into the fade: the head is trimmed, matching scheduleAudioClip', () => {
    const clip = pureClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      keyframes: volumeKeys([key(0, 0), key(10, 1)]),
    })
    const range = { startFrame: 5, endFrame: 15 }
    const events = gainAutomation(clip, pureTrack(), 10, range)
    expect(events).toEqual<GainEvent[]>([
      { kind: 'set', time: 0, value: 0.5 },
      { kind: 'ramp', time: 0.5, value: 1 },
    ])
    expect(scheduleAudioClip(clip, 10, range)).toEqual({ when: 0, offset: 0.5, duration: 1, playbackRate: 1 })
  })

  it('outside the range: gainAutomation [], scheduleAudioClip null, audibleSpan null', () => {
    const clip = pureClip({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0 })
    const range = { startFrame: 100, endFrame: 200 }
    expect(gainAutomation(clip, pureTrack(), 10, range)).toEqual([])
    expect(scheduleAudioClip(clip, 10, range)).toBeNull()
    expect(audibleSpan(clip, range)).toBeNull()
  })

  it('a compound entry offset: gainAutomation and scheduleAudioClip both read offsetFrames', () => {
    const clip = pureClip({ startFrame: 0, durationFrames: 10, sourceStartFrame: 0, volume: 1 })
    const range = { startFrame: 0, endFrame: 300 }
    const events = gainAutomation(clip, pureTrack(), 10, range, 100)
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 10, value: 1 }])
    expect(scheduleAudioClip(clip, 10, range, 100)).toEqual({ when: 10, offset: 0, duration: 1, playbackRate: 1 })
  })

  it('speed scales the head trim and the source offset, not the timeline duration', () => {
    const clip = pureClip({ startFrame: 10, sourceStartFrame: 4, durationFrames: 10, speed: 2 })
    const range = { startFrame: 15, endFrame: 300 }
    expect(scheduleAudioClip(clip, 10, range)).toEqual({ when: 0, offset: 1.4, duration: 1, playbackRate: 2 })
  })

  it('the legacy shape: fullMixRange of a project holding only this clip reproduces start()\'s original three arguments', () => {
    const clip = pureClip({ startFrame: 45, sourceStartFrame: 12, durationFrames: 90 })
    const engine = new TimelineEngine({ fps: 30 })
    const track = engine.addTrack('audio')
    insert(engine, track.id, clip)
    const project = engine.getProject()
    const stored = project.clips[track.id]![0]!
    const range = { startFrame: 0, endFrame: 135 }
    expect(scheduleAudioClip(stored, 30, range)).toEqual({ when: 1.5, offset: 0.4, duration: 3, playbackRate: 1 })
  })

  it('applyGainEvents calls setValueAtTime then linearRampToValueAtTime, value first', () => {
    const calls: unknown[][] = []
    const param: GainParamLike = {
      setValueAtTime: (value, time) => calls.push(['setValueAtTime', value, time]),
      linearRampToValueAtTime: (value, time) => calls.push(['linearRampToValueAtTime', value, time]),
    }
    applyGainEvents(param, [
      { kind: 'set', time: 0, value: 0 },
      { kind: 'ramp', time: 1, value: 1 },
    ])
    expect(calls).toEqual([
      ['setValueAtTime', 0, 0],
      ['linearRampToValueAtTime', 1, 1],
    ])
  })
})

describe('isAudioTrackAudible (PV-P10a)', () => {
  it('no solo anywhere: every track is audible', () => {
    const a = pureTrack({ id: 'a' })
    expect(isAudioTrackAudible(a, [a])).toBe(true)
  })

  it('muted is never audible, solo or not', () => {
    const a = pureTrack({ id: 'a', muted: true })
    expect(isAudioTrackAudible(a, [a])).toBe(false)
  })

  it('disabled is never audible', () => {
    const a = pureTrack({ id: 'a', disabled: true })
    expect(isAudioTrackAudible(a, [a])).toBe(false)
  })

  it('when one audio track is solo, only it is audible', () => {
    const a1 = pureTrack({ id: 'a1', solo: true })
    const a2 = pureTrack({ id: 'a2' })
    const tracks = [a1, a2]
    expect(isAudioTrackAudible(a1, tracks)).toBe(true)
    expect(isAudioTrackAudible(a2, tracks)).toBe(false)
  })

  it('a solo VIDEO track does not silence an audio track', () => {
    const video = pureTrack({ id: 'v1', kind: 'video', solo: true })
    const audio = pureTrack({ id: 'a1' })
    expect(isAudioTrackAudible(audio, [video, audio])).toBe(true)
  })
})

/** A minimal project satisfying `Project`, for `gainAutomation`'s `owningProject`. */
function minimalProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p',
    fps: 10,
    stage: { width: 100, height: 100 },
    tracks: [],
    clips: {},
    transitions: [],
    version: 1,
    ...over,
  }
}

function expressionVolume(source: string): NonNullable<Clip['keyframes']> {
  return { channels: { volume: { source: { kind: 'expression', source }, keys: [] } } }
}

describe('gainAutomation — expressions and ancestry (PV-P10a)', () => {
  it('an expression-only volume channel (no keys) samples clamp(t, 0, 1)', () => {
    const clip = pureClip({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0, keyframes: expressionVolume('clamp(t, 0, 1)') })
    const events = gainAutomation(clip, pureTrack(), 10, { startFrame: 5, endFrame: 6 }, 0, undefined, minimalProject())
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.5 }])
  })

  it('prop() reads the supplied owningProject\'s OWN composition, not a substitute one', () => {
    const clip = pureClip({ startFrame: 0, durationFrames: 10, sourceStartFrame: 0, keyframes: expressionVolume('prop("gain")') })
    const range = { startFrame: 0, endFrame: 1 }
    const projectWithGain = (gain: number): Project =>
      minimalProject({ composition: { props: [{ name: 'gain', type: 'number', default: 1, label: 'gain' }], bindings: [], values: { gain } } })
    const low = gainAutomation(clip, pureTrack(), 10, range, 0, undefined, projectWithGain(0.2))
    const high = gainAutomation(clip, pureTrack(), 10, range, 0, undefined, projectWithGain(0.9))
    expect(low).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.2 }])
    expect(high).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.9 }])
  })

  it('an invalid expression falls back to the authored clip.volume and reports the issue ONCE', () => {
    const clip = pureClip({ startFrame: 0, durationFrames: 5, sourceStartFrame: 0, volume: 0.6, keyframes: expressionVolume('???') })
    const issues: ExpressionError[] = []
    const events = gainAutomation(clip, pureTrack(), 10, { startFrame: 0, endFrame: 5 }, 0, undefined, minimalProject(), (i) => issues.push(i))
    // Every frame falls back to the same authored value, so this collapses to one `set`.
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.6 }])
    expect(issues).toHaveLength(1)
  })

  it('regression (PV-P10b-3 handoff): keys 0->0/20->1, clipped head 10, ancestorGain .5, own track .5 -> .125', () => {
    const original = pureClip({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0, keyframes: volumeKeys([key(0, 0), key(20, 1)]) })
    const cropped = pureClip({ startFrame: 0, durationFrames: 10, sourceStartFrame: 10 })
    const events = gainAutomation(
      cropped,
      pureTrack({ volume: 0.5 }),
      10,
      { startFrame: 0, endFrame: 1 },
      0,
      { originalClip: original, localFrameOffset: 10, ancestorGain: 0.5 },
    )
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.125 }])
  })

  it('the same regression via an expression (frame/20) — the local frame, not the cropped frame, is what is sampled', () => {
    const original = pureClip({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0, keyframes: expressionVolume('frame/20') })
    const cropped = pureClip({ startFrame: 0, durationFrames: 10, sourceStartFrame: 10 })
    const events = gainAutomation(
      cropped,
      pureTrack({ volume: 0.5 }),
      10,
      { startFrame: 0, endFrame: 1 },
      0,
      { originalClip: original, localFrameOffset: 10, ancestorGain: 0.5 },
      minimalProject(),
    )
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.125 }])
  })

  it('the same regression, unkeyed: original volume .8 x ancestorGain .5 x own track .5 -> .2', () => {
    const original = pureClip({ startFrame: 0, durationFrames: 20, sourceStartFrame: 0, volume: 0.8 })
    const cropped = pureClip({ startFrame: 0, durationFrames: 10, sourceStartFrame: 10 })
    const events = gainAutomation(
      cropped,
      pureTrack({ volume: 0.5 }),
      10,
      { startFrame: 0, endFrame: 1 },
      0,
      { originalClip: original, localFrameOffset: 10, ancestorGain: 0.5 },
    )
    expect(events).toEqual<GainEvent[]>([{ kind: 'set', time: 0, value: 0.2 }])
  })

  it('a source clip with its own speed 2 advances the SOURCE offset by head * rate for a clipped head of 10', () => {
    const clip = pureClip({ startFrame: 0, sourceStartFrame: 0, durationFrames: 30, speed: 2 })
    const schedule = scheduleAudioClip(clip, 10, { startFrame: 10, endFrame: 300 }) // head = 10 - 0 = 10
    expect(schedule).not.toBeNull()
    expect(schedule!.offset).toBeCloseTo((0 + 10 * 2) / 10, 9) // 2.0s — 20 SOURCE frames, not 10
  })
})

describe('renderAudioMix — solo at every ancestry level (PV-P10a)', () => {
  it('excludes a nested clip when a DIFFERENT audio track at its OWN level is soloed', async () => {
    const childEngine = new TimelineEngine({ fps: FPS })
    const leafTrack = childEngine.addTrack('audio')
    insert(childEngine, leafTrack.id, audioClip({ startFrame: 0, durationFrames: 30 }))
    const soloTrack = childEngine.addTrack('audio')
    const child = {
      ...childEngine.getProject(),
      tracks: childEngine.getProject().tracks.map((t) => (t.id === soloTrack.id ? { ...t, solo: true } : t)),
    }
    const project = parentProject(compoundClip(child, { startFrame: 0, durationFrames: 30 }))
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(0)
  })

  it('includes a nested clip when ITS OWN track is the one soloed at that level', async () => {
    const childEngine = new TimelineEngine({ fps: FPS })
    const leafTrack = childEngine.addTrack('audio')
    insert(childEngine, leafTrack.id, audioClip({ startFrame: 0, durationFrames: 30 }))
    const child = {
      ...childEngine.getProject(),
      tracks: childEngine.getProject().tracks.map((t) => (t.id === leafTrack.id ? { ...t, solo: true } : t)),
    }
    const project = parentProject(compoundClip(child, { startFrame: 0, durationFrames: 30 }))
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(1)
  })

  it('excludes a whole nested subtree when the ANCESTOR compound track is silenced by a sibling solo at the PARENT level', async () => {
    const child = childProject(audioClip({ startFrame: 0, durationFrames: 30 }))
    const parentEngine = new TimelineEngine({ fps: FPS })
    const compoundTrack = parentEngine.addTrack('elements')
    insert(parentEngine, compoundTrack.id, compoundClip(child, { startFrame: 0, durationFrames: 30 }))
    parentEngine.addTrack('elements') // a second elements track, soloed below, silences compoundTrack
    const siblingTrack = parentEngine.getProject().tracks.find((t) => t.kind === 'elements' && t.id !== compoundTrack.id)!
    const project = {
      ...parentEngine.getProject(),
      tracks: parentEngine.getProject().tracks.map((t) => (t.id === siblingTrack.id ? { ...t, solo: true } : t)),
    }
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(0)
  })
})

// --- merged A/V clips (Clip.embeddedAudio) ----------------------------------

describe('renderAudioMix — merged A/V clips (embeddedAudio)', () => {
  const track = (id: string, kind: Track['kind'], over: Partial<Track> = {}): Track =>
    ({ id, name: id, kind, order: 0, height: 64, locked: false, disabled: false, muted: false, solo: false, ...over }) as Track
  const clip = (over: Partial<Clip> & { id: string; trackId: string; type: Clip['type'] }): Clip =>
    ({ name: over.id, startFrame: 0, durationFrames: 60, sourceStartFrame: 0, sourceDurationFrames: 60, volume: 1, ...over }) as Clip
  const projectOf = (tracks: Track[], clips: Record<string, Clip[]>): Project =>
    ({ id: 'p', fps: FPS, stage: { width: 640, height: 360 }, tracks, clips, transitions: [], version: 5 }) as Project

  it('collects a merged clip and schedules it with its speed', async () => {
    const project = projectOf(
      [track('v', 'video')],
      { v: [clip({ id: 'm', trackId: 'v', type: 'video', src: 'movie.mp4', embeddedAudio: true, speed: 2, durationFrames: 30 })] },
    )
    expect(flattenAudioClips(project).map((e) => e.clip.id)).toEqual(['m'])
    await renderAudioMix(project, resolver)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({ src: 'movie.mp4', rate: 2, when: 0, offset: 0 })
    // 30 timeline frames at 2x consume 60 source frames = 2s of the file.
    expect(scheduled[0]!.duration).toBeCloseTo(2)
  })

  it('applies the video lane’s mute and volume, and the clip’s own volume', async () => {
    const mk = (t: Partial<Track>) =>
      projectOf(
        [track('v', 'video', t)],
        { v: [clip({ id: 'm', trackId: 'v', type: 'video', src: 'movie.mp4', embeddedAudio: true, volume: 0.8 })] },
      )
    await renderAudioMix(mk({ volume: 0.5 }), resolver)
    expect(scheduled[0]!.gain).toBeCloseTo(0.4)
    scheduled.length = 0
    expect(await renderAudioMix(mk({ muted: true }), resolver)).toBeNull()
  })

  it('a video clip without the flag (or with false) is silent', async () => {
    for (const embeddedAudio of [undefined, false]) {
      const project = projectOf(
        [track('v', 'video')],
        { v: [clip({ id: 'm', trackId: 'v', type: 'video', src: 'movie.mp4', embeddedAudio })] },
      )
      expect(flattenAudioClips(project)).toHaveLength(0)
      expect(await renderAudioMix(project, resolver)).toBeNull()
    }
  })

  it('a legacy video + separate audio pair is mixed exactly once, and a detached pair too', async () => {
    const legacy = projectOf(
      [track('v', 'video'), track('a', 'audio')],
      {
        v: [clip({ id: 'v1', trackId: 'v', type: 'video', src: 'movie.mp4' })],
        a: [clip({ id: 'a1', trackId: 'a', type: 'audio', src: 'movie.mp4' })],
      },
    )
    await renderAudioMix(legacy, resolver)
    expect(scheduled).toHaveLength(1)

    scheduled.length = 0
    const detached = projectOf(
      [track('v', 'video'), track('a', 'audio')],
      {
        v: [clip({ id: 'v1', trackId: 'v', type: 'video', src: 'movie.mp4', embeddedAudio: false })],
        a: [clip({ id: 'a1', trackId: 'a', type: 'audio', src: 'movie.mp4' })],
      },
    )
    await renderAudioMix(detached, resolver)
    expect(scheduled).toHaveLength(1)
  })

  it('a time-remapped merged clip is not mixed (same rule as the preview)', async () => {
    const keys = [
      { frame: 0, value: 0, easing: 'linear' },
      { frame: 59, value: 59, easing: 'linear' },
    ]
    const project = projectOf(
      [track('v', 'video')],
      {
        v: [
          clip({
            id: 'm',
            trackId: 'v',
            type: 'video',
            src: 'movie.mp4',
            embeddedAudio: true,
            keyframes: { channels: { time: { source: { kind: 'keyframes' }, keys } } } as unknown as Clip['keyframes'],
          }),
        ],
      },
    )
    expect(flattenAudioClips(project)).toHaveLength(0)
  })

  it('solo: an audio lane silences a merged video lane; a video lane does not silence an audio lane', async () => {
    const merged = clip({ id: 'm', trackId: 'v', type: 'video', src: 'movie.mp4', embeddedAudio: true })
    const plain = clip({ id: 'a1', trackId: 'a', type: 'audio', src: 'song.mp3' })
    await renderAudioMix(projectOf([track('v', 'video'), track('a', 'audio', { solo: true })], { v: [merged], a: [plain] }), resolver)
    expect(scheduled.map((s) => s.src)).toEqual(['song.mp3'])

    scheduled.length = 0
    await renderAudioMix(projectOf([track('v', 'video', { solo: true }), track('a', 'audio')], { v: [merged], a: [plain] }), resolver)
    expect(scheduled.map((s) => s.src).sort()).toEqual(['movie.mp4', 'song.mp3'])
  })

  it('hasAudibleSolo / isClipAudioAudible: the shared rule', () => {
    const v = track('v', 'video')
    const a = track('a', 'audio')
    const e = track('e', 'elements', { solo: true })
    expect(hasAudibleSolo([v, a, e])).toBe(false)
    expect(hasAudibleSolo([v, track('a', 'audio', { solo: true })])).toBe(true)
    expect(hasAudibleSolo([track('v', 'video', { solo: true }), a])).toBe(true)
    // A video lane is silenced by an audio solo, an audio lane only by an audio solo.
    expect(isClipAudioAudible(v, [v, track('a', 'audio', { solo: true })])).toBe(false)
    expect(isClipAudioAudible(a, [track('v', 'video', { solo: true }), a])).toBe(true)
    expect(isClipAudioAudible(track('v', 'video', { solo: true }), [track('v', 'video', { solo: true }), a])).toBe(true)
    expect(isClipAudioAudible(track('v', 'video', { muted: true }), [])).toBe(false)
    expect(isClipAudioAudible(track('v', 'video', { disabled: true }), [])).toBe(false)
  })
})
