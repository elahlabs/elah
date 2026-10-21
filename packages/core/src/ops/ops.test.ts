import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber, formatSeconds } from './describeOp'
import { describeProject } from './describe'
import type { EditorOp } from './types'
import type { Paint } from '../types'

function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
  const b = engine.addClip({ trackId: v, type: 'video', name: 'B-roll', src: 'b.mp4', startFrame: 150, durationFrames: 150 })
  return { engine, v, a: a.id, b: b.id }
}

describe('sanitizeOps', () => {
  it('accepts the strict-schema form: nulls, params as name/value pairs, numbers as strings', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'addText', text: '  Hello  world ', at: '1.5', duration: 3, template: null, color: '#FFAA00', region: 'lower-third', motion: 'pop-in', reveal: null },
        { op: 'addEffect', clip: a, kind: 'gaussianBlur', params: [{ name: 'radius', value: '400' }] },
        { op: 'addGenerator', kind: 'particles', preset: 'confetti', at: 0, duration: 2, params: [{ name: 'count', value: 50 }] },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops[0]).toEqual({ op: 'addText', text: 'Hello world', at: 1.5, duration: 3, color: '#ffaa00', region: 'lower-third', motion: 'pop-in' })
    // Clamped to the registry's max radius.
    expect(ops[1]).toMatchObject({ op: 'addEffect', params: { radius: 100 } })
    expect(ops[2]).toMatchObject({ preset: 'confetti', params: { count: 50 } })
  })

  it('drops invented names and stale ids with a reason, keeps the rest', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'teleport' },
        { op: 'addEffect', clip: 'nope', kind: 'bloom' },
        { op: 'addEffect', clip: a, kind: 'sparkle' },
        { op: 'addTransition', from: a, kind: 'zoom' },
        { op: 'setBlend', clip: a, blend: 'screen' },
      ],
      engine.getProject(),
    )
    expect(ops.map((o) => o.op)).toEqual(['addTransition', 'setBlend'])
    expect(dropped.map((d) => d.index)).toEqual([0, 1, 2])
    expect(dropped[1]!.reason).toMatch(/no clip "nope"/)
    expect(dropped[2]!.reason).toMatch(/unknown effect/)
  })

  it('resolves $refs only after they are declared, and forgets removed clips', () => {
    const { engine, a } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'applyMotionPreset', clip: '$title', preset: 'fade-in' },
        { op: 'addText', ref: 'title', text: 'Hi', at: 0, duration: 2 },
        { op: 'applyMotionPreset', clip: '$title', preset: 'fade-in' },
        { op: 'removeClip', clip: a },
        { op: 'setBlend', clip: a, blend: 'multiply' },
      ],
      engine.getProject(),
    )
    expect(ops.map((o) => o.op)).toEqual(['addText', 'applyMotionPreset', 'removeClip'])
    expect(dropped.map((d) => d.index)).toEqual([0, 4])
  })
})

describe('applyOps', () => {
  it('applies a motion-graphics plan as ONE undo step and reports what it touched', () => {
    const { engine, a, b } = fixture()
    const ops: EditorOp[] = [
      { op: 'addLowerThird', ref: 'lt', title: 'Priya Rao', subtitle: 'Founder', at: 1, duration: 4, accent: '#ffd400' },
      { op: 'addGenerator', kind: 'particles', preset: 'confetti', at: 8, duration: 2 },
      { op: 'applyMotionPreset', clip: a, preset: 'punch-in' },
      { op: 'addTransition', from: a, kind: 'whip', duration: 0.5, direction: 'left' },
      { op: 'applyLook', clip: b, look: 'vhs-90s' },
      { op: 'addShape', kind: 'circle', at: 2, duration: 3, drawOn: true, outline: true, region: 'right' },
      { op: 'addMarker', at: 5, name: 'Beat' },
    ]
    const before = engine.getProject()
    const res = applyOps(engine, ops, { description: 'Punch up the intro' })
    expect(res.skipped).toEqual([])
    expect(res.applied).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(res.refs.lt).toBeTruthy()
    expect(res.touched.added.length).toBe(4) // title, subtitle, confetti, circle
    expect(res.touched.changed.sort()).toEqual([a, b].sort())
    expect(engine.lastHistoryDescription()).toBe('Punch up the intro')
    const p = engine.getProject()
    expect(p.transitions[0]).toMatchObject({ kind: 'whip', direction: 'left' })
    expect(p.version).toBe(3)
    // The lower third resolves as text at the lower third of the frame.
    const scene = resolveTimeline(60, p)
    expect(scene.texts.map((t) => t.content)).toEqual(expect.arrayContaining(['Priya Rao', 'Founder']))
    engine.undo()
    expect(engine.getProject()).toBe(before)
  })

  it('skips what cannot apply without rolling back the rest', () => {
    const { engine, a, b } = fixture()
    const res = applyOps(engine, [
      { op: 'moveClip', clip: a, at: 3 }, // would overlap B-roll
      { op: 'addText', text: 'Still here', at: 0, duration: 1 },
      { op: 'setSpeed', clip: a, speed: 2 }, // an image
      { op: 'splitClip', clip: b, at: 1 }, // outside the clip
    ])
    expect(res.applied).toEqual([1])
    expect(res.skipped.map((s) => s.index)).toEqual([0, 2, 3])
    expect(res.skipped[0]!.reason).toMatch(/overlap/)
    expect(Object.values(engine.getProject().clips).flat().some((c) => c.content === 'Still here')).toBe(true)
  })

  it('edits existing clips: trim, split, speed, props, keyframes, mask, blend', () => {
    const { engine, b } = fixture()
    const res = applyOps(engine, [
      { op: 'trimClip', clip: b, start: 6, end: 9 },
      { op: 'applySpeedPreset', clip: b, preset: 'speed-ramp-in' },
      { op: 'setClipProps', clip: b, opacity: 0.8, scale: 1.2, rotation: 5 },
      { op: 'setKeyframes', clip: b, channel: 'opacity', keys: [{ at: 0, value: 0 }, { at: 1, value: 1, curve: 'snappy' }] },
      { op: 'setMask', clip: b, shape: 'ellipse', feather: 0.2 },
      { op: 'setBlend', clip: b, blend: 'screen' },
    ])
    expect(res.skipped).toEqual([])
    const clip = engine.findClip(b)!.clip
    expect(clip.startFrame).toBe(180)
    expect(clip.durationFrames).toBe(90)
    expect(clip.keyframes?.channels.time?.keys.length).toBe(2)
    expect(clip.keyframes?.channels.opacity?.keys[1]?.easingBezier).toEqual([0.2, 0.9, 0.1, 1])
    expect(clip.mask).toMatchObject({ kind: 'ellipse', feather: 0.2 })
    expect(clip.blend).toBe('screen')
    expect(clip.transform?.rotation).toBeCloseTo((5 * Math.PI) / 180)
  })

  /** PV-P6a: a colour change from setClipProps must not leave a gradient hiding it. */
  it('setClipProps color on a shape clears a gradient fill; a plain shape is unaffected otherwise', () => {
    const { engine, v } = fixture()
    const gradient: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
    const gradientShape = engine.addClip({
      trackId: v,
      type: 'shape',
      name: 'G',
      startFrame: 300,
      durationFrames: 30,
      shape: { shapeKind: 'rect', shapeFill: '#111111', shapeFillPaint: gradient },
    })
    const plainShape = engine.addClip({
      trackId: v,
      type: 'shape',
      name: 'P',
      startFrame: 330,
      durationFrames: 30,
      shape: { shapeKind: 'circle', shapeFill: '#222222' },
    })
    const res = applyOps(engine, [
      { op: 'setClipProps', clip: gradientShape.id, color: '#ff0000' },
      { op: 'setClipProps', clip: plainShape.id, color: '#00ff00' },
    ])
    expect(res.skipped).toEqual([])
    const gClip = engine.findClip(gradientShape.id)!.clip
    expect(gClip.shapeFill).toBe('#ff0000')
    expect(gClip.shapeFillPaint).toBeUndefined()
    const pClip = engine.findClip(plainShape.id)!.clip
    expect(pClip.shapeFill).toBe('#00ff00')
  })

  it('defers generation behind a placeholder, and Discard removes it', () => {
    const { engine } = fixture()
    const rev0 = engine.getRevision()
    const res = applyOps(engine, [{ op: 'generateMedia', ref: 'shot', media: 'video', prompt: 'a drone shot over a city at dusk', at: 10, duration: 5 }])
    expect(res.deferred).toHaveLength(1)
    const d = res.deferred[0]!
    expect(d.index).toBe(0)
    expect(engine.findClip(d.placeholderClipId)?.clip.type).toBe('generator')
    const rev = engine.getRevision()
    expect(rev).toBeGreaterThan(rev0)
    // Something else happened since → discard refuses.
    engine.addMarker(1)
    expect(engine.discardLast(rev)).toBe(false)
    engine.undo()
    expect(engine.getProject().markers?.length ?? 0).toBe(0)
  })

  it('discardLast reverts the plan and leaves nothing to redo', () => {
    const { engine } = fixture()
    const before = engine.getProject()
    applyOps(engine, [{ op: 'addTitleCard', title: 'Day one', at: 0, duration: 3 }])
    expect(engine.discardLast(engine.getRevision())).toBe(true)
    expect(engine.getProject()).toBe(before)
    expect(engine.canRedo()).toBe(false)
  })
})

describe('describing', () => {
  it('reads ops as sentences with clip names and m:ss times', () => {
    const { engine, a } = fixture()
    const say = opDescriber(engine.getProject())
    expect(say({ op: 'addLowerThird', title: 'Priya', subtitle: 'Founder', at: 3, duration: 4 })).toBe('Add lower third “Priya — Founder” at 0:03 for 4s')
    expect(say({ op: 'addTransition', from: a, kind: 'whip', duration: 0.5 })).toBe('Whip pan from “Interview” into the next clip (0.5s)')
    expect(say({ op: 'applyLook', clip: '$shot', look: 'vhs-90s' })).toBe('Apply the VHS ’90s look to the new shot')
    expect(formatSeconds(75.5)).toBe('1:15.5')
  })

  it('the project description carries the playhead and in/out', () => {
    const { engine } = fixture()
    engine.setInOut({ in: 30, out: 90 })
    const d = describeProject(engine.getProject(), { playheadFrame: 45 })
    expect(d.playheadSec).toBe(1.5)
    expect(d.inOut).toEqual({ inSec: 1, outSec: 3 })
  })
})
