import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import type { EditorOp } from './types'

/**
 * AGN-P21: the extended keyframe channels. Each opened channel has a project
 * built to carry it (sanitise + apply with zero drops and zero skips, and the
 * key really lands), and each guard has a refusal with its reason.
 */
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  // addClip takes the creation options; effects and a mask are written after, as the UI does.
  const add = (o: Record<string, unknown>, extra: Record<string, unknown> = {}): string => {
    const c = engine.addClip({ trackId: v, durationFrames: 150, ...o } as never)
    if (Object.keys(extra).length) engine.updateClip(c.id, v, extra as never)
    return c.id
  }
  const plain = add({ type: 'image', name: 'Plain', src: 'a.png', startFrame: 0 })
  const fx = add(
    { type: 'video', name: 'Blurred', src: 'b.mp4', startFrame: 150 },
    {
      effects: [
        { id: 'blur1', kind: 'gaussianBlur', params: { radius: 4 } },
        { id: 'vig1', kind: 'vignette', params: {} },
      ],
    },
  )
  const masked = add({ type: 'image', name: 'Masked', src: 'c.png', startFrame: 300 }, { mask: { kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 } })
  const path = add({ type: 'shape', name: 'Blob', shape: { shapeKind: 'path', shapePath: 'M0 0L100 0L100 100Z' }, startFrame: 450 })
  const rect = add({ type: 'shape', name: 'Box', shape: { shapeKind: 'rect' }, startFrame: 600 })
  const gen = add({ type: 'generator', name: 'Snow', generator: { kind: 'particles', params: {} }, startFrame: 750 })
  const text = add({ type: 'text', name: 'Title', text: { content: 'Hi' }, startFrame: 900, durationFrames: 90 })
  return { engine, plain, fx, masked, path, rect, gen, text }
}

const keys = (clip: string, channel: string, ks: Array<Record<string, unknown>>): EditorOp =>
  ({ op: 'setKeyframes', clip, channel, keys: ks }) as unknown as EditorOp
const expr = (clip: string, channel: string, text: unknown): EditorOp => ({ op: 'setExpression', clip, channel, source: text }) as unknown as EditorOp

/** Sanitise then apply `raw` to the fixture; both must be clean. */
function run(f: ReturnType<typeof fixture>, raw: EditorOp, clipId: (f: ReturnType<typeof fixture>) => string, channel: string) {
  const { ops, dropped } = sanitizeOps([raw], f.engine.getProject())
  expect(dropped).toEqual([])
  const res = applyOps(f.engine, ops, { description: 'p21' })
  expect(res.skipped).toEqual([])
  const clip = f.engine.findClip(clipId(f))!.clip
  const track = clip.keyframes?.channels?.[channel as never]
  expect(track?.keys.length, channel).toBeGreaterThan(0)
  for (const frame of [0, 100, 400, 700, 950]) expect(() => resolveTimeline(frame, f.engine.getProject())).not.toThrow()
  return { f, ops, track: track!, say: opDescriber(f.engine.getProject()) }
}

describe('AGN-P21: opened channels, each on a project that carries it', () => {
  it('shape.stroke takes vec keys', () => {
    const f = fixture()
    const op = keys(f.rect, 'shape.stroke', [
      { at: 0, vec: [1, 0, 0, 1] },
      { at: 2, vec: [0, 0, 1], curve: 'ease-out' },
    ])
    const { track, ops, say } = run(f, op, (x) => x.rect, 'shape.stroke')
    expect(track.keys[0]).toMatchObject({ value: 0, vec: [1, 0, 0, 1] })
    expect(track.keys[1]!.vec).toEqual([0, 0, 1, 1])
    expect(say(ops[0]!)).toMatch(/stroke colour/)
  })
  it('shape.fill takes vec keys', () => {
    const f = fixture()
    run(f, keys(f.rect, 'shape.fill', [{ at: 0, vec: [0, 0, 0, 0] }, { at: 1, vec: [1, 1, 1, 1] }]), (x) => x.rect, 'shape.fill')
  })
  it('color takes vec keys on a text clip', () => {
    const f = fixture()
    run(f, keys(f.text, 'color', [{ at: 0, vec: [1, 1, 1, 1] }, { at: 1, vec: [1, 0.4, 0, 1] }]), (x) => x.text, 'color')
  })
  it('shape.path takes path keys on a path shape', () => {
    const f = fixture()
    const { track } = run(
      f,
      keys(f.path, 'shape.path', [{ at: 0, path: 'M0 0L100 0L100 100Z' }, { at: 1, path: 'M0 0L50 40L100 100Z' }]),
      (x) => x.path,
      'shape.path',
    )
    expect(track.keys[1]).toMatchObject({ value: 0, path: 'M0 0L50 40L100 100Z' })
  })
  it('mask.<field> on a masked clip', () => {
    const f = fixture()
    for (const field of ['x', 'y', 'width', 'height', 'rotation', 'feather']) {
      run(f, keys(f.masked, `mask.${field}`, [{ at: 0, value: 0.2 }, { at: 1, value: 0.8 }]), (x) => x.masked, `mask.${field}`)
    }
  })
  it('fx.<effectId>.<param>: a number param, and a colour param with vec', () => {
    const f = fixture()
    run(f, keys(f.fx, 'fx.blur1.radius', [{ at: 0, value: 0 }, { at: 1, value: 30 }]), (x) => x.fx, 'fx.blur1.radius')
    run(f, keys(f.fx, 'fx.vig1.color', [{ at: 0, vec: [0, 0, 0, 1] }, { at: 1, vec: [1, 0, 0, 1] }]), (x) => x.fx, 'fx.vig1.color')
  })
  it('draw.start takes scalar keys on a shape, next to draw', () => {
    const f = fixture()
    run(f, keys(f.rect, 'draw.start', [{ at: 0, value: 0 }, { at: 1, value: 0.5 }]), (x) => x.rect, 'draw.start')
  })
  it('gen.<param> on a generator clip', () => {
    const f = fixture()
    run(f, keys(f.gen, 'gen.speed', [{ at: 0, value: 0.5 }, { at: 1, value: 3 }]), (x) => x.gen, 'gen.speed')
  })
  it('setExpression can drive a mask field and an effect param', () => {
    const f = fixture()
    for (const [clip, channel] of [
      [f.masked, 'mask.x'],
      [f.fx, 'fx.blur1.radius'],
    ] as const) {
      const { ops, dropped } = sanitizeOps([expr(clip, channel, 'value + wiggle(1, 0.1)')], f.engine.getProject())
      expect(dropped, channel).toEqual([])
      const res = applyOps(f.engine, ops, { description: 'p21' })
      expect(res.skipped, channel).toEqual([])
      expect(f.engine.findClip(clip)!.clip.keyframes?.channels?.[channel as never]?.source.kind).toBe('expression')
    }
  })
})

describe('AGN-P21: every guard refuses with a reason', () => {
  const refuse = (raw: EditorOp, pick: (f: ReturnType<typeof fixture>) => unknown = () => undefined): string => {
    const f = fixture()
    const op = JSON.parse(JSON.stringify(raw), (_k, v) => v) as Record<string, unknown>
    const target = pick(f)
    if (typeof target === 'string') op.clip = target
    const { ops, dropped } = sanitizeOps([op], f.engine.getProject())
    expect(ops).toEqual([])
    expect(dropped).toHaveLength(1)
    return dropped[0]!.reason
  }

  it('mask on a clip with no mask', () => {
    expect(refuse(keys('x', 'mask.x', [{ at: 0, value: 0.2 }]), (f) => f.plain)).toMatch(/has no mask/)
  })
  it('an effect id the clip does not carry', () => {
    expect(refuse(keys('x', 'fx.nope.radius', [{ at: 0, value: 1 }]), (f) => f.fx)).toMatch(/names an effect this clip does not have/)
    // a real effect id, but on a clip that has no effects at all
    expect(refuse(keys('x', 'fx.blur1.radius', [{ at: 0, value: 1 }]), (f) => f.plain)).toMatch(/names an effect this clip does not have/)
  })
  it('a param the effect does not have, or that cannot be animated', () => {
    expect(refuse(keys('x', 'fx.blur1.bogus', [{ at: 0, value: 1 }]), (f) => f.fx)).toMatch(/no param "bogus"/)
  })
  it('gen.<param> on a clip that is not a generator, and an unknown generator param', () => {
    expect(refuse(keys('x', 'gen.speed', [{ at: 0, value: 1 }]), (f) => f.plain)).toMatch(/needs a generator clip/)
    expect(refuse(keys('x', 'gen.bogus', [{ at: 0, value: 1 }]), (f) => f.gen)).toMatch(/no param "bogus"/)
    expect(refuse(keys('x', 'gen.count', [{ at: 0, value: 1 }]), (f) => f.gen)).toMatch(/cannot be animated/)
  })
  it('shape.path on a shape that is not the path variant, and on a non-shape', () => {
    const op = keys('x', 'shape.path', [{ at: 0, path: 'M0 0L9 9' }])
    expect(refuse(op, (f) => f.rect)).toMatch(/variant is "path"/)
    expect(refuse(op, (f) => f.plain)).toMatch(/variant is "path"/)
  })
  it('vec on a numeric channel', () => {
    expect(refuse(keys('x', 'opacity', [{ at: 0, value: 1, vec: [1, 0, 0] }]), (f) => f.plain)).toMatch(/vec is for colour channels only/)
    expect(refuse(keys('x', 'mask.x', [{ at: 0, vec: [1, 0, 0] }]), (f) => f.masked)).toMatch(/vec is for colour channels only/)
  })
  it('path on a numeric channel', () => {
    expect(refuse(keys('x', 'x', [{ at: 0, value: 1, path: 'M0 0L9 9' }]), (f) => f.plain)).toMatch(/path is for the "shape.path" channel only/)
  })
  it('a colour channel with no vec, a short vec, or an out-of-range vec', () => {
    const pick = (f: ReturnType<typeof fixture>) => f.rect
    expect(refuse(keys('x', 'shape.fill', [{ at: 0, value: 1 }]), pick)).toMatch(/need vec/)
    expect(refuse(keys('x', 'shape.fill', [{ at: 0, vec: [1, 0] }]), pick)).toMatch(/need vec/)
    expect(refuse(keys('x', 'shape.fill', [{ at: 0, vec: [1, 0, 2] }]), pick)).toMatch(/need vec/)
    expect(refuse(keys('x', 'shape.fill', [{ at: 0, vec: [1, 0, 'a'] }]), pick)).toMatch(/need vec/)
  })
  it('a colour channel on the wrong kind of clip', () => {
    expect(refuse(keys('x', 'shape.stroke', [{ at: 0, vec: [1, 0, 0] }]), (f) => f.plain)).toMatch(/needs a shape clip/)
    expect(refuse(keys('x', 'color', [{ at: 0, vec: [1, 0, 0] }]), (f) => f.rect)).toMatch(/not text/)
  })
  it('a path key that cannot morph, or whose structure differs', () => {
    const pick = (f: ReturnType<typeof fixture>) => f.path
    // AGN-P28: an arc is path data that can morph now; a bad flag is what is refused, and the message says how to write it.
    expect(refuse(keys('x', 'shape.path', [{ at: 0, path: 'M0 0A5 5 0 2 1 9 9' }]), pick)).toMatch(/can morph.*flags.*0 or 1/)
    expect(refuse(keys('x', 'shape.path', [{ at: 0, path: 'M0 0L9 9' }, { at: 1, path: 'M0 0L9 9L5 5L0 9Z' }]), pick)).toMatch(/cannot morph.*open.*closed/)
    expect(refuse(keys('x', 'shape.path', [{ at: 0, value: 1 }]), pick)).toMatch(/need path/)
  })
  it('an expression on a colour or path channel', () => {
    expect(refuse(expr('x', 'shape.stroke', 'value'), (f) => f.rect)).toMatch(/not a number channel/)
    expect(refuse(expr('x', 'color', 'value'), (f) => f.text)).toMatch(/not a number channel/)
    expect(refuse(expr('x', 'shape.path', 'value'), (f) => f.path)).toMatch(/not a number channel/)
    expect(refuse(expr('x', 'fx.vig1.color', 'value'), (f) => f.fx)).toMatch(/not a number channel/)
  })
  it('an expression still cannot drive draw or time, and the same proofs gate it', () => {
    expect(refuse(expr('x', 'draw', 'value'), (f) => f.rect)).toMatch(/unknown expression channel "draw"/)
    expect(refuse(expr('x', 'draw.start', 'value'), (f) => f.rect)).toMatch(/unknown expression channel "draw.start"/)
    expect(refuse(expr('x', 'time', 'value'), (f) => f.plain)).toMatch(/unknown expression channel "time"/)
    expect(refuse(expr('x', 'mask.x', 'value'), (f) => f.plain)).toMatch(/has no mask/)
  })
  it('an extended channel on a clip whose output type is unknown (made earlier in the same plan) is still refused', () => {
    const f = fixture()
    const raw = [
      { op: 'addGenerator', ref: 'bg', kind: 'gradientBackground', at: 0, duration: 3 },
      keys('$bg', 'shape.stroke', [{ at: 0, vec: [1, 0, 0] }]),
    ]
    const { dropped } = sanitizeOps(raw, f.engine.getProject())
    expect(dropped.map((d) => d.reason).join('|')).toMatch(/created in this plan/)
  })
  it('an unknown channel is still refused', () => {
    expect(refuse(keys('x', 'bogus', [{ at: 0, value: 1 }]), (f) => f.plain)).toMatch(/unknown keyframe channel "bogus"/)
    expect(refuse(keys('x', 'fx.a', [{ at: 0, value: 1 }]), (f) => f.fx)).toMatch(/unknown keyframe channel/)
  })
  it('the builtin channels still work unchanged on a number key', () => {
    const f = fixture()
    const { ops, dropped } = sanitizeOps([keys(f.plain, 'opacity', [{ at: 0, value: 0 }, { at: 1, value: 1 }])], f.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ op: 'setKeyframes', channel: 'opacity' })
    expect((ops[0] as { keys: unknown[] }).keys).toEqual([
      { at: 0, value: 0 },
      { at: 1, value: 1 },
    ])
  })
})

describe('AGN-P21: a part inside a graphic', () => {
  it('a colour key reaches a shape inside a compound by its part path, and the same proofs apply there', () => {
    const f = { engine: new TimelineEngine({ fps: 30, stage: { width: 1280, height: 720 } }) }
    const t1 = f.engine.addTrack('elements').id
    const t2 = f.engine.addTrack('elements').id
    const shapeA = f.engine.addClip({ trackId: t1, type: 'shape', shape: { shapeKind: 'rect' }, startFrame: 0, durationFrames: 60 } as never).id
    const shapeB = f.engine.addClip({ trackId: t2, type: 'shape', shape: { shapeKind: 'rect' }, startFrame: 0, durationFrames: 60 } as never).id
    const nested = applyOps(f.engine, [{ op: 'nest', clips: [shapeA, shapeB], ref: 'grp', name: 'Pair' } as EditorOp], { description: 'nest' })
    expect(nested.skipped).toEqual([])
    const group = Object.values(f.engine.getProject().clips).flat().find((c) => c.type === 'compound')!
    const childId = Object.values(group.compound!.project.clips).flat()[0]!.id
    const path = `${group.id}/${childId}`
    const { ops, dropped } = sanitizeOps([keys(path, 'shape.fill', [{ at: 0, vec: [1, 0, 0] }, { at: 1, vec: [0, 1, 0] }])], f.engine.getProject())
    expect(dropped).toEqual([])
    const res = applyOps(f.engine, ops, { description: 'p21' })
    expect(res.skipped).toEqual([])
    const inner = Object.values(f.engine.findClip(group.id)!.clip.compound!.project.clips).flat().find((c) => c.id === childId)!
    expect(inner.keyframes?.channels?.['shape.fill']?.keys[1]).toMatchObject({ vec: [0, 1, 0, 1] })
    // The same part is not a path shape and has no mask.
    expect(sanitizeOps([keys(path, 'shape.path', [{ at: 0, path: 'M0 0L9 9' }])], f.engine.getProject()).dropped[0]!.reason).toMatch(/variant is "path"/)
    expect(sanitizeOps([keys(path, 'mask.x', [{ at: 0, value: 1 }])], f.engine.getProject()).dropped[0]!.reason).toMatch(/has no mask/)
  })
})
