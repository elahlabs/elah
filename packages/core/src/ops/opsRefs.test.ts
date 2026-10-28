import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { applyOps } from './apply'
import { sanitizeOps } from './sanitize'

/**
 * AGN-P26. Two defects from the first /dev/assistant-run sessions:
 *   1. a channel on a `$ref` clip was refused even when the creating op fixes its type;
 *   2. a clip named in describeProject by its NAME could not be used as a reference.
 * The path-morph refusal now names the actual mismatch.
 */
function project() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const track = engine.addTrack('video').id
  let cursor = 0
  const add = (o: Record<string, unknown>) => engine.addClip({ trackId: track, durationFrames: 150, startFrame: (cursor += 150) - 150, ...o } as never).id
  const headline = add({ type: 'text', name: 'headline', text: { content: 'Hi' } })
  const logo = add({ type: 'image', name: 'Logo', src: 'a.png' })
  const twinA = add({ type: 'image', name: 'Twin', src: 'a.png' })
  const twinB = add({ type: 'image', name: 'Twin', src: 'b.png' })
  const shape = add({ type: 'shape', name: 'Box', shape: { shapeKind: 'rect' } })
  const blob = add({ type: 'shape', name: 'Blob', shape: { shapeKind: 'path', shapePath: 'M0 0L100 0L100 100Z' } })
  return { engine, track, headline, logo, twinA, twinB, shape, blob }
}
const keys = (clip: string, channel: string, ks: Array<Record<string, unknown>>) => ({ op: 'setKeyframes', clip, channel, keys: ks })
const FILL = [
  { at: 0, vec: [0.1, 0.1, 0.1, 1] },
  { at: 2, vec: [0, 1, 1, 1] },
]

describe('AGN-P26: a channel is proven from the op that creates the ref', () => {
  it('addShape then shape.fill and shape.stroke in one plan: sanitises clean, applies, and the keys land', () => {
    const p = project()
    const raw = [{ op: 'addShape', ref: 'box', kind: 'rect', at: 1, duration: 3 }, keys('$box', 'shape.fill', FILL), keys('$box', 'shape.stroke', FILL)]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(3)
    const res = applyOps(p.engine, ops, { description: 'p26' })
    expect(res.skipped).toEqual([])
    const made = Object.values(p.engine.getProject().clips)
      .flat()
      .find((c) => c.type === 'shape' && c.name !== 'Box' && c.name !== 'Blob')!
    expect(made.keyframes?.channels?.['shape.fill' as never]?.keys).toHaveLength(2)
    expect(made.keyframes?.channels?.['shape.stroke' as never]?.keys).toHaveLength(2)
    expect(() => resolveTimeline(45, p.engine.getProject())).not.toThrow()
  })
  it('addText then the colour channel', () => {
    const p = project()
    const { ops, dropped } = sanitizeOps([{ op: 'addText', ref: 't', text: 'Hello', at: 0, duration: 2 }, keys('$t', 'color', FILL)], p.engine.getProject())
    expect(dropped).toEqual([])
    expect(applyOps(p.engine, ops, { description: 'p26' }).skipped).toEqual([])
  })
  it('the type the op fixes still decides: wrong-kind channels are refused with their own reasons', () => {
    const p = project()
    const why = (raw: unknown[]) =>
      sanitizeOps(raw, p.engine.getProject())
        .dropped.map((d) => d.reason)
        .join('|')
    expect(why([{ op: 'addText', ref: 't', text: 'x', at: 0, duration: 2 }, keys('$t', 'shape.fill', FILL)])).toMatch(/needs a shape clip/)
    expect(why([{ op: 'addShape', ref: 's', kind: 'circle', at: 0, duration: 2 }, keys('$s', 'color', FILL)])).toMatch(/not text/)
    expect(why([{ op: 'addShape', ref: 's', kind: 'circle', at: 0, duration: 2 }, keys('$s', 'shape.path', [{ at: 0, path: 'M0 0L9 9' }])])).toMatch(/variant is "path"/)
  })
  it('channels whose proof needs fields only a real clip has (fx, mask, gen) are still refused on a ref', () => {
    const p = project()
    const why = (channel: string) =>
      sanitizeOps([{ op: 'addShape', ref: 's', kind: 'rect', at: 0, duration: 2 }, keys('$s', channel, [{ at: 0, value: 1 }])], p.engine.getProject())
        .dropped.map((d) => d.reason)
        .join('|')
    for (const ch of ['fx.blur1.radius', 'mask.x', 'gen.speed']) expect(why(ch)).toMatch(/cannot be checked on a clip created in this plan/)
  })
  it("an unknown output type is still refused with today's reason (a generator)", () => {
    const p = project()
    const { dropped } = sanitizeOps([{ op: 'addGenerator', ref: 'bg', kind: 'gradientBackground', at: 0, duration: 2 }, keys('$bg', 'shape.fill', FILL)], p.engine.getProject())
    expect(dropped[0]!.reason).toBe('"shape.fill" cannot be checked on a clip created in this plan; add the keys in a later plan')
  })
  it("insertVector's output is a shape or a compound depending on the SVG: refused, and the reason says what to write instead", () => {
    const p = project()
    const { ops, dropped } = sanitizeOps(
      [{ op: 'insertVector', ref: 'logo', asset: 'svg1' }, keys('$logo', 'shape.fill', FILL), keys('$logo', 'opacity', [{ at: 0, value: 0 }, { at: 1, value: 1 }])],
      p.engine.getProject(),
    )
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.reason).toMatch(/cannot be checked on a vector created in this plan.*compoundId\/childId.*next plan/)
    // a builtin channel needs no proof and is not refused
    expect(ops.map((o) => o.op)).toEqual(['insertVector', 'setKeyframes'])
  })
  it('a ref re-declared by a different op does not keep the old type', () => {
    const p = project()
    const { dropped } = sanitizeOps(
      [{ op: 'addShape', ref: 'x', kind: 'rect', at: 0, duration: 2 }, { op: 'addGenerator', ref: 'x', kind: 'gradientBackground', at: 0, duration: 2 }, keys('$x', 'shape.fill', FILL)],
      p.engine.getProject(),
    )
    expect(dropped[0]!.reason).toMatch(/created in this plan/)
  })
})

describe('AGN-P26: a clip name is a reference', () => {
  const one = (p: ReturnType<typeof project>, raw: Record<string, unknown>) => sanitizeOps([raw], p.engine.getProject())

  it('an exact name resolves to its id, in every op that takes a clip', () => {
    const p = project()
    expect(one(p, { op: 'setClipProps', clip: 'headline', opacity: 0.5 }).ops[0]).toMatchObject({ clip: p.headline })
    expect(one(p, { op: 'moveClip', clip: 'Logo', at: 2 }).ops[0]).toMatchObject({ clip: p.logo })
    expect(one(p, { op: 'removeClip', clip: 'Box' }).ops[0]).toMatchObject({ clip: p.shape })
    expect(one(p, keys('Box', 'shape.fill', FILL)).ops[0]).toMatchObject({ clip: p.shape })
  })
  it('the defect-2 plan: under names a clip by name', () => {
    const p = project()
    const { ops, dropped } = one(p, { op: 'setClipProps', clip: p.logo, under: 'headline' })
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ clip: p.logo, under: p.headline })
  })
  it('a single case-insensitive match resolves', () => {
    const p = project()
    expect(one(p, { op: 'moveClip', clip: 'HEADLINE', at: 1 }).ops[0]).toMatchObject({ clip: p.headline })
    expect(one(p, { op: 'moveClip', clip: 'logo', at: 1 }).ops[0]).toMatchObject({ clip: p.logo })
  })
  it('an id always wins over a name, even when another clip is NAMED like that id', () => {
    const p = project()
    p.engine.updateClip(p.shape, p.track, { name: p.headline } as never)
    expect(one(p, { op: 'moveClip', clip: p.headline, at: 1 }).ops[0]).toMatchObject({ clip: p.headline })
  })
  it('a name shared by two clips is a refusal naming both ids, never a pick', () => {
    const p = project()
    const { ops, dropped } = one(p, { op: 'moveClip', clip: 'Twin', at: 1 })
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toContain(p.twinA)
    expect(dropped[0]!.reason).toContain(p.twinB)
    expect(dropped[0]!.reason).toMatch(/names 2 clips/)
  })
  it('an exact name beats a looser case-insensitive clash; with no exact name the clash is ambiguous', () => {
    const p = project()
    p.engine.updateClip(p.twinA, p.track, { name: 'LOGO' } as never)
    expect(one(p, { op: 'moveClip', clip: 'Logo', at: 1 }).ops[0]).toMatchObject({ clip: p.logo })
    const { ops, dropped } = one(p, { op: 'moveClip', clip: 'logo', at: 1 })
    expect(ops).toEqual([])
    expect(dropped[0]!.reason).toContain(p.logo)
    expect(dropped[0]!.reason).toContain(p.twinA)
  })
  it('an unknown name is still the old refusal', () => {
    const p = project()
    expect(one(p, { op: 'moveClip', clip: 'nothing', at: 1 }).dropped[0]!.reason).toBe('no clip "nothing" on the timeline')
  })
  it('a name that was removed earlier in the plan is refused as removed', () => {
    const p = project()
    const { dropped } = sanitizeOps([{ op: 'removeClip', clip: 'Box' }, { op: 'moveClip', clip: 'Box', at: 1 }], p.engine.getProject())
    expect(dropped[0]!.reason).toMatch(/removed earlier/)
  })
  it('nest resolves names, and two names for one clip is the same-clip refusal', () => {
    const p = project()
    expect(sanitizeOps([{ op: 'nest', clips: ['headline', 'Logo'] }], p.engine.getProject()).ops[0]).toMatchObject({ clips: [p.headline, p.logo] })
    expect(sanitizeOps([{ op: 'nest', clips: ['headline', p.headline] }], p.engine.getProject()).dropped[0]!.reason).toMatch(/same clip twice/)
  })
})

describe('AGN-P26/P27: the path-morph refusal names the mismatch', () => {
  it('a differing segment count now reconciles instead of refusing (AGN-P27)', () => {
    const p = project()
    const authored = 'M0 0C1 0 2 1 2 2C2 3 1 4 0 4C-1 3 -1 1 0 0Z'
    const { ops, dropped } = sanitizeOps([keys(p.blob, 'shape.path', [{ at: 0, path: 'M0 0L9 0L9 9Z' }, { at: 2, path: authored }])], p.engine.getProject())
    expect(dropped).toEqual([])
    expect((ops[0] as { keys: Array<{ path: string }> }).keys[1]!.path).toBe(authored)
  })
  it("reports the real reason and each key's subpath count, cubic segment count and closedness", () => {
    const p = project()
    const { ops, dropped } = sanitizeOps(
      [keys(p.blob, 'shape.path', [{ at: 0, path: 'M0 0L9 0L9 9Z' }, { at: 2, path: 'M0 0L9 0L9 9L9 20' }])],
      p.engine.getProject(),
    )
    expect(ops).toEqual([])
    const reason = dropped[0]!.reason
    expect(reason).toContain('key 1 (at 0s) is 1 subpath: 2 cubic segments, closed')
    expect(reason).toContain('key 2 (at 2s) is 1 subpath: 3 cubic segments, open')
    expect(reason).toMatch(/closed in one key and open in the other/)
  })
  it('checks consecutive pairs, not every key against the first', () => {
    const p = project()
    const { dropped } = sanitizeOps(
      [keys(p.blob, 'shape.path', [{ at: 0, path: 'M0 0L9 0L9 9Z' }, { at: 1, path: 'M0 0L9 0L9 9L0 9Z' }, { at: 2, path: 'M0 0L9 0L9 9L0 9' }])],
      p.engine.getProject(),
    )
    expect(dropped[0]!.reason).toContain('keys 2 and 3 cannot morph')
  })
  it('matching structures still morph', () => {
    const p = project()
    const { ops, dropped } = sanitizeOps(
      [keys(p.blob, 'shape.path', [{ at: 0, path: 'M0 0L9 0L9 9Z' }, { at: 2, path: 'M1 1L8 1L8 8Z' }])],
      p.engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(1)
  })
})
