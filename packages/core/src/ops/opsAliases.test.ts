import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import type { EditorOp } from './types'

/**
 * AGN-P24: the first live motion-graphics plan, run through the real sanitiser.
 * The planner reached for every capability correctly in spirit; its phrasing is
 * what failed (`param` for `channel`, `keys` on setEffectParam, a curve name in
 * the preset slot, an arc). Aliases and teaching refusals fix PHRASING; no guard
 * was loosened (the structure rule and the per-clip proofs are asserted below).
 */
function project(opts: { twoBlurs?: boolean; noBlur?: boolean } = {}) {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 } })
  const v = engine.addTrack('video').id
  const e = engine.addTrack('elements').id
  const logo = engine.addClip({
    trackId: v,
    type: 'shape',
    name: 'logo',
    startFrame: 0,
    durationFrames: 240,
    shape: { shapeKind: 'path', shapePath: 'M0 0 L100 0 L100 100 Z', stroke: '#ff0000' },
  } as never)
  const effects = opts.noBlur
    ? []
    : [
        { id: 'blur1', kind: 'gaussianBlur', params: { radius: 8 } },
        ...(opts.twoBlurs ? [{ id: 'blur2', kind: 'gaussianBlur', params: { radius: 2 } }] : []),
      ]
  engine.updateClip(logo.id, v, { effects } as never)
  const title = engine.addClip({ trackId: e, type: 'text', name: 'title', startFrame: 0, durationFrames: 240, text: { content: 'ELAH' } } as never)
  // The planner addressed clips by the ids "logo" and "title".
  const json = JSON.stringify(engine.getProject()).split(logo.id).join('logo').split(title.id).join('title')
  engine.loadProject(JSON.parse(json))
  return engine
}

/** The plan exactly as the live planner returned it on 2026-10-09. */
const LIVE_PLAN: unknown[] = [
  { op: 'setKeyframes', clip: 'logo', param: 'shape.path', keys: [{ at: 0, path: 'M0 0 L100 0 L100 100 Z' }, { at: 2, path: 'M50 0 A50 50 0 1 1 49.9 0', curve: 'ease-in-out' }] },
  { op: 'setKeyframes', clip: 'logo', param: 'shape.stroke', keys: [{ at: 0, vec: [1, 0, 0, 1] }, { at: 2, vec: [1, 1, 1, 1], curve: 'ease-in-out' }] },
  { op: 'setEffectParam', clip: 'logo', effect: 'gaussianBlur', param: 'radius', keys: [{ at: 0, value: 8 }, { at: 2, value: 0, curve: 'ease-out' }] },
  { op: 'applyMotionPreset', clip: 'title', preset: 'overshoot' },
  { op: 'setExpression', clip: 'title', channel: 'y', source: 'value + 0.01*sin(t*2*PI*0.4)' },
  { op: 'setKeyframes', clip: 'title', param: 'opacity', keys: [{ at: 0, value: 1 }, { at: 4, value: 0, curve: 'ease-in' }] },
]
/** What the sanitiser said before AGN-P24, measured on `dev` @ fac0567: 1 of 6. */
const SURVIVED_BEFORE = 1

describe('AGN-P24: the verbatim live plan', () => {
  it('survives 5 of 6 (was 1 of 6, then 4 before AGN-P28 taught the morph to read arcs), and the remaining refusal teaches', () => {
    const engine = project()
    const { ops, dropped } = sanitizeOps(LIVE_PLAN, engine.getProject())
    expect(ops.length).toBeGreaterThan(SURVIVED_BEFORE)
    expect(ops.length).toBe(5)
    // AGN-P28: the arc morph (index 0) is no longer refused. The one refusal that remains is a correct one, with its reason.
    expect(dropped.map((d) => d.index).sort()).toEqual([3])
    const why = Object.fromEntries(dropped.map((d) => [d.index, d.reason]))
    expect(why[3]).toMatch(/pop-in/)
    expect(why[3]).toMatch(/curve/)
    // The survivors apply cleanly and the blur ramp really lands on blur1.
    const res = applyOps(engine, ops, { description: 'p24' })
    expect(res.skipped).toEqual([])
    const logo = engine.findClip('logo')!.clip
    expect(logo.keyframes?.channels?.['fx.blur1.radius' as never]?.keys.length).toBe(2)
    expect(engine.findClip('title')!.clip.keyframes?.channels?.opacity?.keys.length).toBe(2)
    // ...and the arc-written circle really is the morph's second key.
    expect(logo.keyframes?.channels?.['shape.path' as never]?.keys.length).toBe(2)
    for (const f of [0, 30, 60, 120]) expect(() => resolveTimeline(f, engine.getProject())).not.toThrow()
  })
  it('with matched cubics instead of the arc, the path morph survives too (5 of 6)', () => {
    const fixed = structuredClone(LIVE_PLAN) as Array<Record<string, any>>
    fixed[0]!.keys[0].path = 'M0 0 C30 0 70 0 100 0 C100 30 100 70 100 100 Z'
    fixed[0]!.keys[1].path = 'M50 0 C80 0 100 20 100 50 C100 80 80 100 50 100 Z'
    const { ops } = sanitizeOps(fixed, project().getProject())
    expect(ops.length).toBe(5)
  })
  it('a mismatched structure now reconciles (AGN-P27), and the keys are stored as authored', () => {
    const plan = structuredClone(LIVE_PLAN).slice(0, 1) as Array<Record<string, any>>
    const circle = 'M50 0 C80 0 100 20 100 50 C100 80 80 100 50 100 C20 100 0 80 0 50 Z'
    plan[0]!.keys[1].path = circle
    const { ops, dropped } = sanitizeOps(plan, project().getProject())
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(1)
    expect((ops[0] as { keys: Array<{ path: string }> }).keys[1]!.path).toBe(circle)
  })
})

describe('AGN-P24: param is an alias for channel', () => {
  const kf = (extra: Record<string, unknown>) => ({ op: 'setKeyframes', clip: 'title', keys: [{ at: 0, value: 1 }, { at: 1, value: 0 }], ...extra })
  it('works alone, on setKeyframes and setExpression', () => {
    const p = project().getProject()
    expect(sanitizeOps([kf({ param: 'opacity' })], p).ops[0]).toMatchObject({ op: 'setKeyframes', channel: 'opacity' })
    expect(sanitizeOps([{ op: 'setExpression', clip: 'title', param: 'y', source: 'value' }], p).ops[0]).toMatchObject({ op: 'setExpression', channel: 'y' })
  })
  it('channel wins when both are present and disagree', () => {
    const p = project().getProject()
    const { ops } = sanitizeOps([kf({ channel: 'opacity', param: 'y' })], p)
    expect((ops[0] as { channel: string }).channel).toBe('opacity')
    const e = sanitizeOps([{ op: 'setExpression', clip: 'title', channel: 'opacity', param: 'y', source: 'value' }], p)
    expect((e.ops[0] as { channel: string }).channel).toBe('opacity')
  })
  it('an unknown channel in param is still refused by name', () => {
    const { dropped } = sanitizeOps([kf({ param: 'wobble' })], project().getProject())
    expect(dropped[0]!.reason).toMatch(/unknown keyframe channel "wobble"/)
  })
})

describe('AGN-P24: setEffectParam with keys is setKeyframes on fx.<id>.<param>', () => {
  const ramp = (effect: string) => ({ op: 'setEffectParam', clip: 'logo', effect, param: 'radius', keys: [{ at: 0, value: 8 }, { at: 2, value: 0 }] })
  it('resolves an effect kind to the one matching id', () => {
    const { ops, dropped } = sanitizeOps([ramp('gaussianBlur')], project().getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ op: 'setKeyframes', clip: 'logo', channel: 'fx.blur1.radius' })
  })
  it('takes an effect id as is', () => {
    const { ops } = sanitizeOps([ramp('blur2')], project({ twoBlurs: true }).getProject())
    expect(ops[0]).toMatchObject({ channel: 'fx.blur2.radius' })
  })
  it('refuses with the ids when two effects of that kind exist', () => {
    const { ops, dropped } = sanitizeOps([ramp('gaussianBlur')], project({ twoBlurs: true }).getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toMatch(/2 "gaussianBlur" effects.*blur1.*blur2/)
  })
  it('refuses when the clip has no such effect', () => {
    const { ops, dropped } = sanitizeOps([ramp('gaussianBlur')], project({ noBlur: true }).getProject())
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toMatch(/no "gaussianBlur" effect/)
  })
  it('keeps the per-param proofs (a param the effect lacks is refused)', () => {
    const { dropped } = sanitizeOps([{ ...ramp('gaussianBlur'), param: 'nope' }], project().getProject())
    expect(dropped[0]!.reason).toMatch(/no param "nope"/)
  })
  it('a scalar value still works unchanged', () => {
    const { ops } = sanitizeOps([{ op: 'setEffectParam', clip: 'logo', effect: 'blur1', param: 'radius', value: 3 }], project().getProject())
    expect(ops[0] as EditorOp).toMatchObject({ op: 'setEffectParam', effect: 'blur1', param: 'radius', value: 3 })
  })
})

describe('AGN-P24: an unknown motion preset names the real ones', () => {
  it('lists the presets and points a curve name at the curve slot', () => {
    const { dropped } = sanitizeOps([{ op: 'applyMotionPreset', clip: 'title', preset: 'overshoot' }], project().getProject())
    const r = dropped[0]!.reason
    for (const n of ['pop-in', 'slide-in-left', 'ken-burns', 'shake-soft']) expect(r).toContain(n)
    expect(r).toMatch(/curve/)
  })
})
