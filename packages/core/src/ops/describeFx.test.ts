import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { EFFECT_REGISTRY, getEffectDefinition } from '../effects/registry'
import { describeProject, MAX_DESCRIBED_FX_PARAMS, MAX_DESCRIBED_FX_PARAMS_TOTAL, type DescribedClip } from './describe'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import type { EditorOp } from './types'

/**
 * AGN-P22: the channels AGN-P21 opened become discoverable. A plan that names
 * `fx.<id>.<param>` or `gen.<param>` copied from the describe output must
 * sanitise and apply with nothing dropped.
 */
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const add = (o: Record<string, unknown>, extra: Record<string, unknown> = {}): string => {
    const c = engine.addClip({ trackId: v, durationFrames: 150, ...o } as never)
    if (Object.keys(extra).length) engine.updateClip(c.id, v, extra as never)
    return c.id
  }
  const fx = add(
    { type: 'video', name: 'Blurred', src: 'b.mp4', startFrame: 0 },
    {
      effects: [
        { id: 'blur1', kind: 'gaussianBlur', params: { radius: 4 } },
        { id: 'grade1', kind: 'colorGrade', params: { exposure: 0.5 } },
      ],
    },
  )
  const gen = add({ type: 'generator', name: 'Snow', generator: { kind: 'particles', params: {} }, startFrame: 150 })
  return { engine, fx, gen }
}

const clipOf = (engine: TimelineEngine, id: string): DescribedClip =>
  describeProject(engine.getProject()).tracks.flatMap((t) => t.clips).find((c) => c.id === id)!

describe('AGN-P22: describe lists what a clip carries', () => {
  it('lists keyframeable effect params with current values, defaulting what the clip omits', () => {
    const { engine, fx } = fixture()
    const c = clipOf(engine, fx)
    const blur = c.effects!.find((e) => e.id === 'blur1')!
    expect(blur.params).toBeDefined()
    expect(Object.keys(blur.params!).length).toBeGreaterThan(0)
    const grade = c.effects!.find((e) => e.id === 'grade1')!
    expect(grade.params!.exposure).toBe(0.5)
    expect(grade.params!.contrast).toBe(1)
  })

  it('lists only params the registry marks keyframeable', () => {
    const { engine, fx } = fixture()
    for (const e of clipOf(engine, fx).effects!) {
      const def = getEffectDefinition(e.kind)!
      for (const name of Object.keys(e.params ?? {})) expect(def.params[name]!.keyframeable, `${e.kind}.${name}`).toBe(true)
    }
  })

  it('lists a generator kind and its animatable params only', () => {
    const { engine, gen } = fixture()
    const g = clipOf(engine, gen).generator!
    expect(g.kind).toBe('particles')
    expect(g.params).toBeDefined()
    expect(g.params).not.toHaveProperty('count') // count is not keyframeable
    for (const v of Object.values(g.params!)) expect(typeof v).toBe('number')
  })

  it('round trip: a plan naming fx.<id>.<param> and gen.<param> from the describe output applies with zero drops', () => {
    const f = fixture()
    const d = describeProject(f.engine.getProject())
    const clips = d.tracks.flatMap((t) => t.clips)
    const fxClip = clips.find((c) => c.id === f.fx)!
    const blur = fxClip.effects!.find((e) => e.kind === 'gaussianBlur')!
    const param = Object.keys(blur.params!)[0]!
    const genClip = clips.find((c) => c.id === f.gen)!
    const genParam = Object.keys(genClip.generator!.params!)[0]!
    const raw = [
      { op: 'setKeyframes', clip: fxClip.id, channel: `fx.${blur.id}.${param}`, keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
      { op: 'setKeyframes', clip: genClip.id, channel: `gen.${genParam}`, keys: [{ at: 0, value: 0.2 }, { at: 1, value: 0.8 }] },
    ] as unknown as EditorOp[]
    const { ops, dropped } = sanitizeOps(raw, f.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(2)
    const res = applyOps(f.engine, ops, { description: 'p22' })
    expect(res.skipped).toEqual([])
    expect(clipOf(f.engine, f.fx).keyed).toContain(`fx.${blur.id}.${param}`)
    expect(() => resolveTimeline(10, f.engine.getProject())).not.toThrow()
  })

  it('every param describe lists, for every effect kind, is accepted by sanitizeOps', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const v = engine.addTrack('video').id
    const kinds = [...EFFECT_REGISTRY.keys()].filter((k) => getEffectDefinition(k)?.appliesTo.includes('image'))
    kinds.forEach((kind, i) => {
      const c = engine.addClip({ trackId: v, type: 'image', name: kind, src: 'a.png', startFrame: i * 10, durationFrames: 10 } as never)
      engine.updateClip(c.id, v, { effects: [{ id: `e-${kind}`, kind, params: {} }] } as never)
    })
    const clips = describeProject(engine.getProject(), { maxFxParams: 1000, maxFxParamsTotal: 100000 }).tracks.flatMap((t) => t.clips)
    let checked = 0
    for (const c of clips) {
      for (const e of c.effects ?? []) {
        for (const [param, value] of Object.entries(e.params ?? {})) {
          // A colour param is described AS its key form (a vec, 0..1), so the key is built from the described value itself.
          const key = Array.isArray(value) ? { at: 0, vec: value } : { at: 0, value: 0 }
          const raw = [{ op: 'setKeyframes', clip: c.id, channel: `fx.${e.id}.${param}`, keys: [key, { ...key, at: 1 }] }] as unknown as EditorOp[]
          const { dropped } = sanitizeOps(raw, engine.getProject())
          expect(dropped, `${e.kind}.${param}`).toEqual([])
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
  })
  it('a colour param is described in the form its keyframe takes, not as hex', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const v = engine.addTrack('video').id
    const c = engine.addClip({ trackId: v, type: 'image', name: 'shot', src: 'a.png', startFrame: 0, durationFrames: 30 } as never)
    engine.updateClip(c.id, v, { effects: [{ id: 'vig', kind: 'vignette', params: { color: '#ff0000' } }] } as never)
    const clip = describeProject(engine.getProject()).tracks.flatMap((t) => t.clips).find((x) => x.id === c.id)!
    const colour = clip.effects![0]!.params!.color
    expect(Array.isArray(colour)).toBe(true)
    expect(colour).toEqual([1, 0, 0, 1])
    expect(JSON.stringify(clip)).not.toContain('#ff0000')
  })
})

describe('AGN-P22: the additions are capped', () => {
  function graded(n: number, effectsPerClip = 3) {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const v = engine.addTrack('video').id
    for (let i = 0; i < n; i++) {
      const c = engine.addClip({ trackId: v, type: 'video', name: `c${i}`, src: `a${i}.mp4`, startFrame: i * 30, durationFrames: 30 } as never)
      engine.updateClip(
        c.id,
        v,
        { effects: Array.from({ length: effectsPerClip }, (_, k) => ({ id: `g${i}-${k}`, kind: 'colorGrade', params: {} })) } as never,
      )
    }
    return engine
  }
  const count = (d: ReturnType<typeof describeProject>) =>
    d.tracks.flatMap((t) => t.clips).map((c) => (c.effects ?? []).reduce((s, e) => s + Object.keys(e.params ?? {}).length, 0))

  it('no clip lists more than the per-clip cap, and the effects themselves are still all listed', () => {
    const d = describeProject(graded(2, 5).getProject())
    for (const n of count(d)) expect(n).toBeLessThanOrEqual(MAX_DESCRIBED_FX_PARAMS)
    expect(d.tracks.flatMap((t) => t.clips)[0]!.effects).toHaveLength(5)
  })

  it('the whole project lists no more than the overall cap', () => {
    const d = describeProject(graded(60, 3).getProject())
    expect(count(d).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_DESCRIBED_FX_PARAMS_TOTAL)
  })

  it('a realistic 20-clip project, effects on half, stays far inside the route limit', () => {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    const v = engine.addTrack('video').id
    for (let i = 0; i < 20; i++) {
      const c = engine.addClip({ trackId: v, type: 'video', name: `Clip ${i}`, src: `asset-${i}.mp4`, startFrame: i * 60, durationFrames: 60 } as never)
      if (i % 2 === 0) {
        engine.updateClip(c.id, v, {
          effects: [
            { id: `cg${i}`, kind: 'colorGrade', params: { contrast: 1.1 } },
            { id: `bl${i}`, kind: 'gaussianBlur', params: { radius: 3 } },
          ],
        } as never)
      }
    }
    const withParams = JSON.stringify(describeProject(engine.getProject())).length
    const without = JSON.stringify(describeProject(engine.getProject(), { maxFxParams: 0 })).length
    console.log(`AGN-P22 describe size: before=${without} after=${withParams}`)
    expect(withParams).toBeLessThan(20_000)
    expect(withParams).toBeGreaterThan(without)
  })
})
