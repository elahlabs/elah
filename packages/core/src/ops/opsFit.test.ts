/** PQ-1a: setFit through sanitize -> apply -> describeOp. */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { EDITOR_OP_NAMES } from './types'

const assets = new Map([
  ['wide', { id: 'wide', kind: 'video' as const, name: 'Wide', src: 'blob:wide', durationSec: 10, width: 1920, height: 1080 }],
  ['nosize', { id: 'nosize', kind: 'video' as const, name: 'NoSize', src: 'blob:ns', durationSec: 10 }],
])

function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 } })
  const v = engine.addTrack('video', { name: 'Main' }).id
  const a = engine.addTrack('audio', { name: 'Music' }).id
  const shot = engine.addClip({ trackId: v, type: 'video', name: 'Shot', src: 'blob:wide', assetId: 'wide', startFrame: 0, durationFrames: 150 }).id
  const blind = engine.addClip({ trackId: v, type: 'video', name: 'Blind', src: 'blob:ns', assetId: 'nosize', startFrame: 150, durationFrames: 150 }).id
  const music = engine.addClip({ trackId: a, type: 'audio', name: 'Song', src: 'blob:s', startFrame: 0, durationFrames: 150 }).id
  return { engine, v, shot, blind, music }
}

function run(engine: TimelineEngine, raw: unknown[]) {
  const clean = sanitizeOps(raw, engine.getProject(), { assets })
  const res = applyOps(engine, clean.ops, { assets })
  return { ...res, clean }
}
const all = (engine: TimelineEngine) => Object.values(engine.getProject().clips).flat()
const get = (engine: TimelineEngine, id: string) => engine.findClip(id)!.clip
const backdrops = (engine: TimelineEngine) => all(engine).filter((c) => c.name.endsWith('(fit background)'))

describe('setFit', () => {
  it('is in the vocabulary', () => {
    expect(EDITOR_OP_NAMES).toContain('setFit')
  })

  it('cover writes crop, transform and focus; contain clears the first two and keeps focus', () => {
    const { engine, shot } = fixture()
    const r = run(engine, [{ op: 'setFit', clip: shot, fit: 'cover', focusX: 0.25, focusY: 0.4 }])
    expect(r.skipped).toEqual([])
    const c = get(engine, shot)
    expect(c.crop!.width).toBeCloseTo(0.3164, 4)
    expect(c.crop!.x).toBeCloseTo(0.25 - 0.3164 / 2, 4)
    expect(c.transform).toBeDefined()
    expect(c.focus).toEqual({ x: 0.25, y: 0.4 })
    run(engine, [{ op: 'setFit', clip: shot, fit: 'contain' }])
    const d = get(engine, shot)
    expect(d.crop).toBeUndefined()
    expect(d.transform).toBeUndefined()
    expect(d.focus).toEqual({ x: 0.25, y: 0.4 })
  })

  it('blur-fill adds one linked, muted, blurred backdrop on a lane behind, and twice leaves one', () => {
    const { engine, shot } = fixture()
    const r = run(engine, [{ op: 'setFit', clip: shot, fit: 'blur-fill' }])
    expect(r.skipped).toEqual([])
    expect(r.touched.added).toHaveLength(1)
    const [back] = backdrops(engine)
    expect(back!.volume).toBe(0)
    expect(back!.effects!.map((e) => e.kind)).toEqual(['gaussianBlur', 'colorGrade'])
    expect(back!.effects![0]!.params.radius).toBe(40)
    expect(back!.effects![1]!.params.exposure).toBe(-0.6)
    expect(back!.crop).toBeDefined()
    expect(back!.linkId).toBeDefined()
    expect(back!.linkId).toBe(get(engine, shot).linkId)
    const tracks = engine.getProject().tracks
    expect(tracks.find((t) => t.id === back!.trackId)!.order).toBeLessThan(tracks.find((t) => t.id === get(engine, shot).trackId)!.order)
    expect(get(engine, shot).crop).toBeUndefined()
    run(engine, [{ op: 'setFit', clip: shot, fit: 'blur-fill', focusX: 0.8 }])
    expect(backdrops(engine)).toHaveLength(1)
    expect(backdrops(engine)[0]!.focus!.x).toBe(0.8)
  })

  it('one op is one undo step', () => {
    const { engine, shot } = fixture()
    const before = all(engine).length
    run(engine, [{ op: 'setFit', clip: shot, fit: 'blur-fill' }])
    expect(all(engine)).toHaveLength(before + 1)
    engine.undo()
    expect(all(engine)).toHaveLength(before)
  })

  it('cover or contain after blur-fill removes the backdrop', () => {
    const { engine, shot } = fixture()
    run(engine, [{ op: 'setFit', clip: shot, fit: 'blur-fill' }])
    const r = run(engine, [{ op: 'setFit', clip: shot, fit: 'cover' }])
    expect(backdrops(engine)).toHaveLength(0)
    expect(r.touched.removed).toHaveLength(1)
    expect(get(engine, shot).crop).toBeDefined()
  })

  it('skips with a reason: unknown size, audio, keyed scale', () => {
    const { engine, shot, blind, music } = fixture()
    engine.updateClip(shot, get(engine, shot).trackId, {
      keyframes: { channels: { scale: { source: { kind: 'keyframes' }, keys: [{ id: 'k1', frame: 0, value: 1 }] } } },
    } as never)
    const r = run(engine, [
      { op: 'setFit', clip: blind, fit: 'cover' },
      { op: 'setFit', clip: music, fit: 'cover' },
      { op: 'setFit', clip: shot, fit: 'cover' },
    ])
    expect(r.applied).toEqual([])
    expect(r.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('not known yet'),
      expect.stringContaining('audio clip'),
      expect.stringContaining('keyed'),
    ])
  })

  it('sanitize clamps focus, rejects a bad fit, and describes the op', () => {
    const { engine, shot } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'setFit', clip: shot, fit: 'cover', focusX: 7, focusY: -2 },
        { op: 'setFit', clip: shot, fit: 'zoom' },
        { op: 'setFit', clip: shot, fit: 'cover', focusX: 'wat' },
      ],
      engine.getProject(),
      { assets },
    )
    expect(dropped).toHaveLength(1)
    expect(ops[0]).toEqual({ op: 'setFit', clip: shot, fit: 'cover', focusX: 1, focusY: 0 })
    expect(ops[1]).toEqual({ op: 'setFit', clip: shot, fit: 'cover' })
    expect(opDescriber(engine.getProject())({ op: 'setFit', clip: shot, fit: 'cover', focusX: 0.62, focusY: 0.4 })).toBe(
      'Fit “Shot” to the frame (cover, focus 62%, 40%)',
    )
  })
})
