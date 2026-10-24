import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip } from '../types'
import { applyOps } from './apply'
import type { ApplyContext } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import { EDITOR_OP_NAMES, type EditorOp } from './types'

/**
 * CHAT-5a: `removeRanges`, `crossfadeCuts`, `duckUnder` and `addSfx`, through the same sanitize gate and the same
 * single batch as every other op, run against a real engine.
 */

const FPS = 30
type Assets = NonNullable<ApplyContext['assets']>
const assets: Assets = new Map([
  ['whoosh', { id: 'whoosh', kind: 'audio', name: 'Whoosh', src: 'blob:whoosh', durationSec: 1.2 }],
  ['song', { id: 'song', kind: 'audio', name: 'Theme', src: 'blob:song', durationSec: 60 }],
  ['talk', { id: 'talk', kind: 'video', name: 'Interview', src: 'blob:talk', durationSec: 20 }],
  ['logo', { id: 'logo', kind: 'image', name: 'Logo', src: 'blob:logo', durationSec: 0 }],
])

function run(engine: TimelineEngine, raw: unknown[]) {
  const clean = sanitizeOps(raw, engine.getProject(), { assets })
  const res = applyOps(engine, clean.ops, { assets })
  return { ...res, dropped: clean.dropped, ops: clean.ops }
}

const all = (engine: TimelineEngine): Clip[] => Object.values(engine.getProject().clips).flat()
const on = (engine: TimelineEngine, trackId: string): Clip[] => [...(engine.getProject().clips[trackId] ?? [])].sort((a, b) => a.startFrame - b.startFrame)
const spans = (clips: Clip[]) => clips.map((c) => [c.startFrame, c.durationFrames])

/** A 10 s merged A/V clip (picture + its own sound) at frame 0, followed by two 5 s clips on the same lane. */
function talk() {
  const engine = new TimelineEngine({ fps: FPS, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const main = engine.addClip({ trackId: v, type: 'video', name: 'Talk', src: 'talk.mp4', startFrame: 0, durationFrames: 300 })
  engine.updateClip(main.id, v, { sourceStartFrame: 0, sourceDurationFrames: 300, assetFrames: 600, embeddedAudio: true })
  const next1 = engine.addClip({ trackId: v, type: 'image', name: 'Next 1', src: 'n1.png', startFrame: 300, durationFrames: 150 })
  const next2 = engine.addClip({ trackId: v, type: 'image', name: 'Next 2', src: 'n2.png', startFrame: 450, durationFrames: 150 })
  return { engine, v, main: main.id, next1: next1.id, next2: next2.id }
}

/** Three cuts: source 1.0–1.5 s, 3.0–3.5 s, 6.0–7.0 s = frames 30–45, 90–105, 180–210 (60 frames in all). */
const THREE = [
  { from: 1, to: 1.5 },
  { from: 3, to: 3.5 },
  { from: 6, to: 7 },
]

describe('the four ops are in the vocabulary', () => {
  it('names them all', () => {
    for (const n of ['removeRanges', 'crossfadeCuts', 'duckUnder', 'addSfx']) expect(EDITOR_OP_NAMES, n).toContain(n)
  })
})

describe('removeRanges', () => {
  it('cuts 3 ranges out of a merged A/V clip, closes the gaps and ripples both later clips; one undo restores the project exactly', () => {
    const { engine, v, main, next1, next2 } = talk()
    const before = engine.getProject()
    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: THREE }])
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.applied).toEqual([0])

    const lane = on(engine, v)
    // Four pieces of the talk, back to back from 0, then the two later clips 60 frames earlier.
    expect(spans(lane)).toEqual([
      [0, 30],
      [30, 45],
      [75, 75],
      [150, 90],
      [240, 150],
      [390, 150],
    ])
    expect(lane[0]!.id).toBe(main) // the first piece keeps the clip's id
    expect(lane[4]!.id).toBe(next1)
    expect(lane[5]!.id).toBe(next2)
    // Each piece plays the right stretch of the source, and stays a merged A/V clip.
    expect(lane.slice(0, 4).map((c) => c.sourceStartFrame)).toEqual([0, 45, 105, 210])
    expect(lane.slice(0, 4).every((c) => c.embeddedAudio === true && c.type === 'video')).toBe(true)
    // The cut-out stretches are reported as removed, for the diff styling.
    expect(r.touched.removed.map((x) => [x.startFrame, x.durationFrames]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [30, 15],
      [90, 15],
      [180, 30],
    ])

    expect(engine.undo()).toBe(true)
    expect(engine.getProject()).toEqual(before)
  })

  it('without ripple the gaps stay and later clips do not move', () => {
    const { engine, v, main } = talk()
    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: THREE, ripple: false }])
    expect(r.skipped).toEqual([])
    expect(spans(on(engine, v))).toEqual([
      [0, 30],
      [45, 45],
      [105, 75],
      [210, 90],
      [300, 150],
      [450, 150],
    ])
  })

  it('merges ranges closer than 0.12 s and drops ranges under 0.05 s', () => {
    const { engine, v, main } = talk()
    const r = run(engine, [
      {
        op: 'removeRanges',
        clip: main,
        ranges: [
          { from: 1, to: 2 },
          { from: 2.1, to: 3 }, // 0.1 s after the first: one range 1.0–3.0
          { from: 5, to: 5.04 }, // under 0.05 s: dropped
          { from: 8, to: 8.5 },
        ],
      },
    ])
    expect(r.skipped).toEqual([])
    // 1.0–3.0 s is frames 30–90 (60), 8.0–8.5 s is frames 240–255 (15).
    expect(spans(on(engine, v)).slice(0, 3)).toEqual([
      [0, 30],
      [30, 150],
      [180, 45],
    ])
    expect(on(engine, v)[3]!.startFrame).toBe(300 - 75)
  })

  it('refuses a range outside the clip source and changes nothing', () => {
    const { engine, main } = talk()
    const before = engine.getProject()
    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: [{ from: 1, to: 2 }, { from: 40, to: 41 }] }])
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]!.reason).toMatch(/outside the clip's source/)
    expect(engine.getProject()).toBe(before)
  })

  it('clamps a range that overhangs the end of the clip', () => {
    const { engine, v, main } = talk()
    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: [{ from: 9, to: 12 }] }])
    expect(r.skipped).toEqual([])
    expect(spans(on(engine, v)).slice(0, 2)).toEqual([
      [0, 270],
      [270, 150],
    ])
  })

  it('a cut that starts on the first frame removes the original id and the rest slides to the start', () => {
    const { engine, v, main } = talk()
    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: [{ from: 0, to: 2 }] }])
    expect(r.skipped).toEqual([])
    const lane = on(engine, v)
    expect(spans(lane)).toEqual([
      [0, 240],
      [240, 150],
      [390, 150],
    ])
    expect(lane.some((c) => c.id === main)).toBe(false)
    expect(r.touched.removed.some((x) => x.id === main && x.startFrame === 0 && x.durationFrames === 60)).toBe(true)
  })

  it('cuts a linked partner at the same timeline moments, ripples its lane, and keeps each stretch linked', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const v = engine.addTrack('video').id
    const a = engine.addTrack('audio').id
    const pic = engine.addClip({ trackId: v, type: 'video', name: 'Picture', src: 'talk.mp4', startFrame: 0, durationFrames: 300 })
    engine.updateClip(pic.id, v, { sourceStartFrame: 0, sourceDurationFrames: 300, assetFrames: 600, embeddedAudio: false })
    const snd = engine.addClip({ trackId: a, type: 'audio', name: 'Sound', src: 'talk.mp4', startFrame: 0, durationFrames: 300 })
    engine.updateClip(snd.id, a, { sourceStartFrame: 0, sourceDurationFrames: 300 })
    const tail = engine.addClip({ trackId: a, type: 'audio', name: 'Tail', src: 'tail.mp3', startFrame: 300, durationFrames: 60 })
    expect(engine.linkClips([pic.id, snd.id])).toBeTruthy()

    const r = run(engine, [{ op: 'removeRanges', clip: pic.id, ranges: THREE }])
    expect(r.skipped).toEqual([])
    const picture = on(engine, v)
    const sound = on(engine, a)
    // The sound is cut exactly like the picture, and its lane's later clip moves up by the same 60 frames.
    expect(spans(picture)).toEqual([
      [0, 30],
      [30, 45],
      [75, 75],
      [150, 90],
    ])
    expect(spans(sound)).toEqual([...spans(picture), [240, 60]])
    expect(sound[4]!.id).toBe(tail.id)
    // Piece n of the picture and piece n of the sound are one link group, different from the other pieces'.
    for (let i = 0; i < 4; i++) {
      expect(picture[i]!.linkId, `piece ${i}`).toBeTruthy()
      expect(sound[i]!.linkId, `piece ${i}`).toBe(picture[i]!.linkId)
    }
    expect(new Set(picture.map((c) => c.linkId)).size).toBe(4)
    // And it is still ONE undo step.
    expect(engine.undo()).toBe(true)
    expect(on(engine, v)).toHaveLength(1)
    expect(on(engine, a)).toHaveLength(2)
  })

  it('drops the words inside the cuts from linked captions and follows the picture', () => {
    const { engine, v, main } = talk()
    const t = engine.addTrack('elements', { name: 'Captions' }).id
    const cap = engine.addClip({ trackId: t, type: 'text', name: 'one', startFrame: 0, durationFrames: 60, text: { content: 'hi there you' } })
    engine.updateClip(cap.id, t, {
      words: [
        { text: 'hi', start: 0, end: 20 },
        { text: 'there', start: 20, end: 40 }, // centre 30: inside the first cut
        { text: 'you', start: 40, end: 60 },
      ],
    })
    const late = engine.addClip({ trackId: t, type: 'text', name: 'two', startFrame: 120, durationFrames: 60, text: { content: 'is it ok' } })
    engine.updateClip(late.id, t, {
      words: [
        { text: 'is', start: 0, end: 20 },
        { text: 'it', start: 20, end: 40 },
        { text: 'ok', start: 40, end: 60 },
      ],
    })
    const gone = engine.addClip({ trackId: t, type: 'text', name: 'three', startFrame: 182, durationFrames: 20, text: { content: 'um' } })
    engine.updateClip(gone.id, t, { words: [{ text: 'um', start: 0, end: 20 }] }) // wholly inside the third cut
    engine.linkClips([main, cap.id, late.id, gone.id])

    const r = run(engine, [{ op: 'removeRanges', clip: main, ranges: THREE }])
    expect(r.skipped).toEqual([])
    const caps = on(engine, t)
    expect(caps.map((c) => c.id)).toEqual([cap.id, late.id]) // "um" had no word left: removed
    const first = caps[0]!
    expect(first.content).toBe('hi you')
    expect(first.words!.map((w) => w.text)).toEqual(['hi', 'you'])
    expect(first.startFrame).toBe(0)
    // "you" started inside the first cut (frames 30-45), so it now starts where that cut began, 30, and ends at 60 - 15 = 45.
    expect(first.words![1]).toEqual({ text: 'you', start: 30, end: 45 })
    expect(first.durationFrames).toBe(45)
    // The later caption starts after the first two cuts (15 + 15 frames), so it moves from 120 to 90 with the picture.
    const second = caps[1]!
    expect(second.startFrame).toBe(90)
    expect(second.words!.map((w) => w.text)).toEqual(['is', 'it', 'ok'])
    expect(on(engine, v)).toHaveLength(6)
  })

  it('refuses a locked lane, a magnetic main lane without ripple, a speed ramp and a non-media clip', () => {
    const a = talk()
    a.engine.updateTrack(a.v, { locked: true })
    expect(run(a.engine, [{ op: 'removeRanges', clip: a.main, ranges: THREE }]).skipped[0]!.reason).toMatch(/locked track/)

    const b = talk()
    b.engine.setTimelineMode('magnetic')
    expect(b.engine.setMainTrack(b.v)).toBe(true)
    const rb = run(b.engine, [{ op: 'removeRanges', clip: b.main, ranges: THREE, ripple: false }])
    expect(rb.skipped[0]!.reason).toMatch(/magnetic main track/)
    // With ripple the same cut is fine on a magnetic lane.
    expect(run(b.engine, [{ op: 'removeRanges', clip: b.main, ranges: THREE }]).skipped).toEqual([])

    const c = talk()
    expect(run(c.engine, [{ op: 'removeRanges', clip: c.next1, ranges: THREE }]).dropped[0]!.reason).toMatch(/video or audio/)
    expect(applyOps(c.engine, [{ op: 'removeRanges', clip: c.next1, ranges: THREE }]).skipped[0]!.reason).toMatch(/video or audio/)
  })

  it('works inside a larger plan: one undo undoes every op', () => {
    const { engine, v, main } = talk()
    const before = engine.getProject()
    const r = run(engine, [
      { op: 'removeRanges', clip: main, ranges: THREE },
      { op: 'addMarker', at: 1, name: 'after' },
    ])
    expect(r.skipped).toEqual([])
    expect(on(engine, v)).toHaveLength(6)
    expect(engine.undo()).toBe(true)
    expect(engine.getProject()).toEqual(before)
  })

  it('sanitize reads the ranges, drops a malformed op, and never throws on junk', () => {
    const { engine, main } = talk()
    const ok = sanitizeOps([{ op: 'removeRanges', clip: main, ranges: [{ from: '1', to: 2 }, [3, 4], { start: 5, end: 6 }, { from: 9, to: 8 }, null], ripple: false }], engine.getProject())
    expect(ok.dropped).toEqual([])
    expect(ok.ops[0]).toEqual({
      op: 'removeRanges',
      clip: main,
      ranges: [
        { from: 1, to: 2 },
        { from: 3, to: 4 },
        { from: 5, to: 6 },
      ],
      ripple: false,
    })
    expect(sanitizeOps([{ op: 'removeRanges', clip: main, ranges: [], ripple: null }], engine.getProject()).dropped[0]!.reason).toMatch(/needs ranges/)
    expect(sanitizeOps([{ op: 'removeRanges', clip: 'nope', ranges: THREE }], engine.getProject()).dropped[0]!.reason).toMatch(/no clip/)
    expect(sanitizeOps([{ op: 'removeRanges', clip: main, ranges: THREE, ripple: true }], engine.getProject()).ops[0]).toEqual({ op: 'removeRanges', clip: main, ranges: THREE })
  })
})

describe('crossfadeCuts', () => {
  function pieces() {
    const engine = new TimelineEngine({ fps: FPS })
    const a = engine.addTrack('audio').id
    const ids = [0, 1, 2, 3].map((i) => engine.addClip({ trackId: a, type: 'audio', name: `P${i}`, src: 's.mp3', startFrame: i * 90, durationFrames: 90 }).id)
    for (const id of ids) engine.updateClip(id, a, { volume: 0.8 })
    return { engine, a, ids }
  }
  const keysOf = (c: Clip) => (c.keyframes?.channels?.volume?.keys ?? []).map((k) => [k.frame, k.value])

  it('fades out and in at every one of 3 joins, over the requested milliseconds', () => {
    const { engine, a, ids } = pieces()
    const r = run(engine, [{ op: 'crossfadeCuts', track: a, ms: 100 }]) // 100 ms = 3 frames
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    const clips = on(engine, a)
    // First clip: no join before it, fades out only. Middle clips: both. Last: fades in only.
    expect(keysOf(clips[0]!)).toEqual([[86, 0.8], [89, 0]])
    expect(keysOf(clips[1]!)).toEqual([[0, 0], [3, 0.8], [86, 0.8], [89, 0]])
    expect(keysOf(clips[2]!)).toEqual([[0, 0], [3, 0.8], [86, 0.8], [89, 0]])
    expect(keysOf(clips[3]!)).toEqual([[0, 0], [3, 0.8]])
    expect(r.touched.changed.sort()).toEqual([...ids].sort())
    expect(engine.undo()).toBe(true)
    expect(all(engine).every((c) => c.keyframes === undefined)).toBe(true)
  })

  it('clamps ms to 2..200 and takes at least one frame, and defaults to 10 ms', () => {
    const { engine, a } = pieces()
    expect(sanitizeOps([{ op: 'crossfadeCuts', track: a, ms: 1 }, { op: 'crossfadeCuts', track: a, ms: 9999 }, { op: 'crossfadeCuts', track: a }], engine.getProject()).ops).toEqual([
      { op: 'crossfadeCuts', track: a, ms: 2 },
      { op: 'crossfadeCuts', track: a, ms: 200 },
      { op: 'crossfadeCuts', track: a },
    ])
    run(engine, [{ op: 'crossfadeCuts', track: a }])
    expect(keysOf(on(engine, a)[1]!)).toEqual([[0, 0], [1, 0.8], [88, 0.8], [89, 0]])
  })

  it('keeps existing volume keys and fades from the level the clip has there', () => {
    const { engine, a } = pieces()
    const second = on(engine, a)[1]!
    engine.updateClip(second.id, a, {
      keyframes: { channels: { volume: { source: { kind: 'keyframes' }, keys: [{ id: 'k1', frame: 0, value: 0.2, easing: 'linear' }, { id: 'k2', frame: 40, value: 0.6, easing: 'linear' }] } } },
    })
    run(engine, [{ op: 'crossfadeCuts', clips: [on(engine, a)[0]!.id, second.id], ms: 100 }])
    const keys = keysOf(on(engine, a)[1]!)
    expect(keys).toContainEqual([40, 0.6]) // the clip's own key survives
    expect(keys).toContainEqual([0, 0]) // fade in starts from silence
    // 3 frames in, the clip's own curve (0.2 -> 0.6 over 40 frames) is at 0.2 + 0.4 * 3/40.
    expect(keys.find((k) => k[0] === 3)![1]).toBeCloseTo(0.23, 5)
  })

  it('only fades joins among the named clips, and skips when there is no join', () => {
    const { engine, a, ids } = pieces()
    const r = run(engine, [{ op: 'crossfadeCuts', clips: [ids[0]!, ids[3]!] }])
    expect(r.skipped[0]!.reason).toMatch(/no joins/)
    // Two clips of different tracks, and a gap, are not joins either.
    const b = engine.addTrack('audio').id
    engine.addClip({ trackId: b, type: 'audio', name: 'Gap', src: 'g.mp3', startFrame: 400, durationFrames: 30 })
    expect(run(engine, [{ op: 'crossfadeCuts' }]).skipped).toEqual([])
    expect(on(engine, b)[0]!.keyframes).toBeUndefined()
    expect(on(engine, a)).toHaveLength(4)
  })

  it('fades the joins a removeRanges cut leaves behind (3 ranges = 3 joins)', () => {
    const { engine, v, main } = talk()
    run(engine, [{ op: 'removeRanges', clip: main, ranges: THREE }])
    const r = run(engine, [{ op: 'crossfadeCuts', track: v, ms: 20 }])
    expect(r.skipped).toEqual([])
    const lane = on(engine, v).slice(0, 4)
    expect(lane.map((c) => (c.keyframes?.channels?.volume?.keys ?? []).length)).toEqual([2, 4, 4, 2])
  })
})

describe('duckUnder', () => {
  function mix() {
    const engine = new TimelineEngine({ fps: FPS })
    const m = engine.addTrack('audio').id
    const vo = engine.addTrack('audio').id
    const music = engine.addClip({ trackId: m, type: 'audio', name: 'Music', src: 'm.mp3', startFrame: 0, durationFrames: 300 })
    const voice = engine.addClip({ trackId: vo, type: 'audio', name: 'Voice', src: 'v.mp3', startFrame: 60, durationFrames: 90 })
    return { engine, m, vo, music: music.id, voice: voice.id }
  }
  const GAIN = 10 ** (-12 / 20)
  const keysOf = (c: Clip) => (c.keyframes?.channels?.volume?.keys ?? []).map((k) => [k.frame, Math.round(k.value * 10000) / 10000])

  it('lowers the music to -12 dB at the voice clip edges with attack and release ramps', () => {
    const { engine, m, music, voice } = mix()
    const r = run(engine, [{ op: 'duckUnder', music, voice }])
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    const g = Math.round(GAIN * 10000) / 10000
    // Attack 0.15 s = 5 frames before the voice (60), release 0.4 s = 12 frames after its last frame (149).
    expect(keysOf(on(engine, m)[0]!)).toEqual([
      [55, 1],
      [60, g],
      [149, g],
      [161, 1],
    ])
    expect(engine.undo()).toBe(true)
    expect(on(engine, m)[0]!.keyframes).toBeUndefined()
  })

  it('ducks only under the given speech segments, merging stretches closer than attack + release', () => {
    const { engine, m, music, voice } = mix()
    const r = run(engine, [
      {
        op: 'duckUnder',
        music,
        voice,
        amountDb: -20,
        attackSec: 0.1,
        releaseSec: 0.2,
        segments: [
          { from: 2, to: 3 }, // frames 60–90
          { from: 3.1, to: 3.5 }, // 3 frames later (< attack 3 + release 6): one stretch 60–105
          { from: 6, to: 7 }, // frames 180–210, separate
        ],
      },
    ])
    expect(r.skipped).toEqual([])
    const g = Math.round(10 ** (-20 / 20) * 10000) / 10000
    expect(keysOf(on(engine, m)[0]!)).toEqual([
      [57, 1],
      [60, g],
      [104, g],
      [110, 1],
      [177, 1],
      [180, g],
      [209, g],
      [215, 1],
    ])
  })

  it('ducks from the music level it has, and drops its old keys inside the ducked window', () => {
    const { engine, m, music, voice } = mix()
    engine.updateClip(music, m, { volume: 0.5 })
    engine.updateClip(music, m, {
      keyframes: { channels: { volume: { source: { kind: 'keyframes' }, keys: [{ id: 'a', frame: 100, value: 0.5, easing: 'linear' }, { id: 'b', frame: 250, value: 0.5, easing: 'linear' }] } } },
    })
    run(engine, [{ op: 'duckUnder', music, voice, segments: [{ from: 2, to: 3 }] }])
    const keys = keysOf(on(engine, m)[0]!)
    expect(keys.find((k) => k[0] === 60)![1]).toBeCloseTo(0.5 * GAIN, 3)
    expect(keys).toContainEqual([250, 0.5]) // outside the window: kept
    expect(keys.some((k) => k[0] === 100)).toBe(false) // inside 55..102+: replaced by the duck
  })

  it('refuses a non-sound clip, the same clip twice, a locked lane and speech that misses the music', () => {
    const { engine, m, music, voice } = mix()
    const img = engine.addClip({ trackId: engine.addTrack('video').id, type: 'image', name: 'Pic', src: 'p.png', startFrame: 0, durationFrames: 30 }).id
    expect(sanitizeOps([{ op: 'duckUnder', music: img, voice }], engine.getProject()).dropped[0]!.reason).toMatch(/no sound/)
    expect(sanitizeOps([{ op: 'duckUnder', music, voice: music }], engine.getProject()).dropped[0]!.reason).toMatch(/different clips/)
    expect(applyOps(engine, [{ op: 'duckUnder', music, voice, segments: [{ from: 20, to: 21 }] }]).skipped[0]!.reason).toMatch(/does not overlap/)
    engine.updateTrack(m, { locked: true })
    expect(applyOps(engine, [{ op: 'duckUnder', music, voice }]).skipped[0]!.reason).toMatch(/locked track/)
  })

  it('sanitize clamps amountDb to -40..0 and the ramps, and keeps well-formed segments only', () => {
    const { engine, music, voice } = mix()
    const { ops } = sanitizeOps(
      [
        { op: 'duckUnder', music, voice, amountDb: -100, attackSec: 0, releaseSec: 99, segments: [{ from: 1, to: 2 }, { from: 5, to: 4 }] },
        { op: 'duckUnder', music, voice, amountDb: 6 },
        { op: 'duckUnder', music, voice, amountDb: null, segments: null },
      ],
      engine.getProject(),
    )
    expect(ops).toEqual([
      { op: 'duckUnder', music, voice, amountDb: -40, attackSec: 0.01, releaseSec: 5, segments: [{ from: 1, to: 2 }] },
      { op: 'duckUnder', music, voice, amountDb: 0 },
      { op: 'duckUnder', music, voice },
    ])
  })
})

describe('addSfx', () => {
  it('creates the SFX lane once and puts each effect on it', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const r = run(engine, [
      { op: 'addSfx', asset: 'whoosh', at: 2 },
      { op: 'addSfx', asset: 'whoosh', at: 5, volume: 0.3, duration: 0.5 },
      { op: 'addSfx', asset: 'whoosh', at: 2.5 }, // overlaps the first: a second lane
    ])
    expect(r.dropped).toEqual([])
    expect(r.skipped).toEqual([])
    const lanes = engine.getProject().tracks.filter((t) => t.kind === 'audio')
    expect(lanes.map((t) => t.name).sort()).toEqual(['SFX', 'SFX 2'])
    const lane1 = lanes.find((t) => t.name === 'SFX')!
    const lane2 = lanes.find((t) => t.name === 'SFX 2')!
    const sfx = on(engine, lane1.id)
    expect(sfx).toHaveLength(2)
    expect(sfx[0]).toMatchObject({ type: 'audio', name: 'Whoosh', src: 'blob:whoosh', assetId: 'whoosh', startFrame: 60, durationFrames: 36, volume: 0.6, sourceStartFrame: 0 })
    expect(sfx[1]).toMatchObject({ startFrame: 150, durationFrames: 15, volume: 0.3 })
    expect(on(engine, lane2.id)).toHaveLength(1)
    expect(r.touched.added).toHaveLength(3)
  })

  it('reuses an existing lane named SFX instead of making another', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const t = engine.addTrack('audio', { name: 'SFX' }).id
    run(engine, [{ op: 'addSfx', asset: 'whoosh', at: 0 }])
    run(engine, [{ op: 'addSfx', asset: 'whoosh', at: 10 }])
    expect(engine.getProject().tracks.filter((x) => x.kind === 'audio')).toHaveLength(1)
    expect(on(engine, t)).toHaveLength(2)
  })

  it('never lengthens an effect past its asset, and one undo removes the lane with the clip', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const before = engine.getProject()
    run(engine, [{ op: 'addSfx', asset: 'whoosh', at: 1, duration: 30 }])
    expect(all(engine)[0]!.durationFrames).toBe(36)
    expect(engine.undo()).toBe(true)
    expect(engine.getProject()).toEqual(before)
  })

  it('refuses a non-audio or unknown asset, both at sanitize and at apply', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const lanes = engine.getProject().tracks.length
    for (const asset of ['talk', 'logo', 'missing']) {
      expect(sanitizeOps([{ op: 'addSfx', asset, at: 1 }], engine.getProject(), { assets }).dropped).toHaveLength(1)
      const res = applyOps(engine, [{ op: 'addSfx', asset, at: 1 }], { assets })
      expect(res.applied).toEqual([])
      expect(res.skipped).toHaveLength(1)
    }
    expect(applyOps(engine, [{ op: 'addSfx', asset: 'talk', at: 1 }], { assets }).skipped[0]!.reason).toMatch(/not audio/)
    expect(engine.getProject().tracks).toHaveLength(lanes)
  })

  it('sanitize clamps volume to 0..1 and reads assetId', () => {
    const engine = new TimelineEngine({ fps: FPS })
    const { ops } = sanitizeOps([{ op: 'addSfx', assetId: 'whoosh', at: 1, volume: 7, duration: null, ref: 'boom' }], engine.getProject(), { assets })
    expect(ops).toEqual([{ op: 'addSfx', ref: 'boom', asset: 'whoosh', at: 1, volume: 1 }])
  })
})

describe('describeOp', () => {
  it('reads each op as a plain sentence', () => {
    const { engine, main } = talk()
    const t = engine.addTrack('audio', { name: 'Voice lane' }).id
    const music = engine.addClip({ trackId: engine.addTrack('audio').id, type: 'audio', name: 'Theme', src: 'm.mp3', startFrame: 0, durationFrames: 60 }).id
    const voice = engine.addClip({ trackId: t, type: 'audio', name: 'Voice', src: 'v.mp3', startFrame: 0, durationFrames: 60 }).id
    const d = opDescriber(engine.getProject(), new Map([['whoosh', { name: 'Whoosh' }]]))
    const op = (o: EditorOp) => d(o)
    expect(op({ op: 'removeRanges', clip: main, ranges: THREE })).toBe('Cut 3 ranges (2s) out of “Talk” and close the gaps')
    expect(op({ op: 'removeRanges', clip: main, ranges: [{ from: 1, to: 1.5 }], ripple: false })).toBe('Cut 1 range (0.5s) out of “Talk” and leave the gaps')
    expect(op({ op: 'crossfadeCuts', track: t })).toBe('Crossfade the cuts on “Voice lane” (10 ms)')
    expect(op({ op: 'crossfadeCuts', clips: [main, music], ms: 40 })).toBe('Crossfade the cuts in 2 clips (40 ms)')
    expect(op({ op: 'crossfadeCuts' })).toBe('Crossfade the cuts everywhere (10 ms)')
    expect(op({ op: 'duckUnder', music, voice })).toBe('Lower “Theme” by 12 dB under “Voice”')
    expect(op({ op: 'duckUnder', music, voice, amountDb: -18, segments: [{ from: 1, to: 2 }] })).toBe('Lower “Theme” by 18 dB under “Voice” · 1 stretch of speech')
    expect(op({ op: 'addSfx', asset: 'whoosh', at: 3 })).toBe('Add sound effect “Whoosh” at 0:03 · volume 60%')
  })
})
