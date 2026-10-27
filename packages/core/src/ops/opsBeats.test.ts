import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import type { EditorOp } from './types'

/** PV-P10b-3: beat presets, `syncTo: 'beats'`, `beatCuts`/`silenceFreeze`. */

function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
  const b = engine.addClip({ trackId: v, type: 'video', name: 'B-roll', src: 'b.mp4', startFrame: 150, durationFrames: 150 })
  const audioTrack = engine.addTrack('audio').id
  const song = engine.addClip({ trackId: audioTrack, type: 'audio', name: 'Song', src: 'song', startFrame: 0, durationFrames: 300 })
  const beats = Array.from({ length: 20 }, (_, i) => i * 15) // 0, 15, ..., 285
  engine.setAudioMarkers({ src: 'song', fps: 30, version: 1, bpm: 120, beats, silences: [[60, 90]] })
  return { engine, v, a: a.id, b: b.id, audioTrack, song: song.id }
}

describe('sanitizeOps — beats', () => {
  it('applyMotionPreset with syncTo: beats drops null amount/audio', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps(
      [{ op: 'applyMotionPreset', clip: a, preset: 'beat-zoom', syncTo: 'beats', amount: null, audio: null }],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'applyMotionPreset', clip: a, preset: 'beat-zoom', syncTo: 'beats' })
  })

  it('beatCuts coerces a string every to a number', () => {
    const { engine, b } = fixture()
    const { ops, dropped } = sanitizeOps([{ op: 'beatCuts', clip: b, every: '2' }], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'beatCuts', clip: b, every: 2 })
  })

  it('silenceFreeze keeps minDuration', () => {
    const { engine, b } = fixture()
    const { ops, dropped } = sanitizeOps([{ op: 'silenceFreeze', clip: b, minDuration: 0.4 }], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'silenceFreeze', clip: b, minDuration: 0.4 })
  })

  it('drops an invented preset name', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps([{ op: 'applyMotionPreset', clip: a, preset: 'beat-wobble' }], engine.getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toMatch(/unknown motion preset "beat-wobble"/)
  })

  it('the existing applyMotionPreset sanitize output is unchanged for ordinary input', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps([{ op: 'applyMotionPreset', clip: a, preset: 'pop-in', amount: 2 }], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'applyMotionPreset', clip: a, preset: 'pop-in', amount: 2 })
  })
})

describe('applyOps — beats', () => {
  it('beat-zoom on an image clip writes scale keys at the beats inside it, one undo step', () => {
    const { engine, a } = fixture()
    const res = applyOps(engine, [{ op: 'applyMotionPreset', clip: a, preset: 'beat-zoom' }])
    expect(res.skipped).toEqual([])
    const frames = (engine.findClip(a)!.clip.keyframes?.channels?.scale?.keys ?? []).map((k) => k.frame).sort((x, y) => x - y)
    // Beats inside [0, 150): 0, 15, ..., 135 -> 10 hits, 2 keys each (no leading key, first beat is 0).
    expect(frames.length).toBe(20)
    expect(frames[0]).toBe(0)
    expect(frames.every((f) => f <= 149)).toBe(true)
    expect(frames).toContain(135)
    expect(frames).toContain(141)
    engine.undo()
    expect(engine.findClip(a)!.clip.keyframes).toBeUndefined()
  })

  it('beatCuts on a video clip splits it on every 2nd beat, one undo step', () => {
    const { engine, b } = fixture()
    const before = engine.getProject().clips
    const res = applyOps(engine, [{ op: 'beatCuts', clip: b, every: 2 }])
    expect(res.skipped).toEqual([])
    const originalTrackId = engine.findClip(b)!.trackId
    const stillB = engine.findClip(b)!.clip
    expect(stillB.startFrame).toBe(150)
    expect(stillB.durationFrames).toBe(15) // 150..165
    const clips = engine.getProject().clips[originalTrackId] ?? []
    const starts = clips.map((c) => c.startFrame).sort((x, y) => x - y)
    expect(starts).toEqual([0, 150, 165, 195, 225, 255, 285])
    engine.undo()
    expect(engine.getProject().clips).toEqual(before)
  })

  it('silenceFreeze on a video clip writes time keys matching the silences under it', () => {
    const { engine } = fixture()
    const v2 = engine.addTrack('video').id
    const clip = engine.addClip({ trackId: v2, type: 'video', name: 'Covering', src: 'c.mp4', startFrame: 0, durationFrames: 150 })
    const res = applyOps(engine, [{ op: 'silenceFreeze', clip: clip.id }])
    expect(res.skipped).toEqual([])
    const after = engine.findClip(clip.id)!.clip
    const keys = (after.keyframes?.channels?.time?.keys ?? []).map((k) => ({ frame: k.frame, value: k.value, hold: !!k.hold }))
    expect(keys).toEqual([
      { frame: 0, value: 0, hold: false },
      { frame: 60, value: 60, hold: true },
      { frame: 90, value: 60, hold: false },
      { frame: 149, value: 119, hold: false },
    ])
  })

  it('syncTo: beats with an enter preset lands its ramp on the first beat', () => {
    const { engine, a } = fixture()
    const res = applyOps(engine, [{ op: 'applyMotionPreset', clip: a, preset: 'fade-in', syncTo: 'beats' }])
    expect(res.skipped).toEqual([])
    const keys = (engine.findClip(a)!.clip.keyframes?.channels?.opacity?.keys ?? []).map((k) => k.frame).sort((x, y) => x - y)
    // Beats inside a: 0, 15, 30, ...; the first > 0 is 15.
    expect(keys[keys.length - 1]).toBe(15)
  })

  it('syncTo: beats refuses a whole-clip preset', () => {
    const { engine, a } = fixture()
    const res = applyOps(engine, [{ op: 'applyMotionPreset', clip: a, preset: 'zoom-in', syncTo: 'beats' }])
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/syncTo "beats" applies to enter and exit presets/)
  })

  it('a beat op on a project without markers is skipped, the rest of the plan still applies', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const v = engine.addTrack('video').id
    const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
    const ops: EditorOp[] = [
      { op: 'applyMotionPreset', clip: a.id, preset: 'beat-zoom' },
      { op: 'applyMotionPreset', clip: a.id, preset: 'fade-in' },
    ]
    const res = applyOps(engine, ops)
    expect(res.skipped.map((s) => s.index)).toEqual([0])
    expect(res.skipped[0]!.reason).toMatch(/detect beats/)
    expect(res.applied).toEqual([1])
  })
})

describe('describeOp — beats', () => {
  it('describes beatCuts, silenceFreeze and a synced motion preset', () => {
    const { engine, b } = fixture()
    const describe = opDescriber(engine.getProject())
    expect(describe({ op: 'beatCuts', clip: b, every: 2 })).toBe('Cut “B-roll” on every 2 beats')
    expect(describe({ op: 'silenceFreeze', clip: b })).toBe('Freeze “B-roll” during silences')
    expect(describe({ op: 'applyMotionPreset', clip: b, preset: 'fade-in', syncTo: 'beats' })).toMatch(/on the beat$/)
  })
})
