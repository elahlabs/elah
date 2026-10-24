import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { EDITOR_OP_NAMES, type EditorOp } from './types'

// MG-P5: `staggerPreset` — one motion preset across several clips, each clip's keys a fixed number of frames
// later than the previous one's. It rides `staggerPresetPatches`, so the keys are real keys.

function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const lane = engine.addTrack('elements').id
  const add = (name: string, start: number) =>
    engine.addClip({ trackId: lane, type: 'text', name, startFrame: start, durationFrames: 60, text: { content: name } } as never).id
  const a = add('One', 0)
  const b = add('Two', 60)
  const c = add('Three', 120)
  return { engine, lane, a, b, c }
}

const firstOpacityFrame = (engine: TimelineEngine, id: string): number | undefined =>
  engine.findClip(id)?.clip.keyframes?.channels?.opacity?.keys[0]?.frame

describe('sanitizeOps: staggerPreset', () => {
  it('is a registered op name', () => {
    expect(EDITOR_OP_NAMES).toContain('staggerPreset')
  })

  it('accepts ids, names and $refs, clamps the offset and the amount', () => {
    const p = fixture()
    const raw = [
      { op: 'addText', ref: 'new', text: 'Four', at: 5, duration: 2 },
      { op: 'staggerPreset', clips: [p.a, 'Two', '$new'], preset: 'pop-in', amount: 99, offsetFrames: 9999 },
    ]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[1]).toEqual({ op: 'staggerPreset', clips: [p.a, p.b, '$new'], preset: 'pop-in', amount: 3, offsetFrames: 300 })
  })

  it('rounds the offset, floors it at 0 and defaults it when missing or not a number', () => {
    const p = fixture()
    const offsets = [4.6, -10, undefined, 'soon'].map((offsetFrames) => {
      const r = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames }], p.engine.getProject())
      expect(r.dropped).toEqual([])
      return (r.ops[0] as Extract<EditorOp, { op: 'staggerPreset' }>).offsetFrames
    })
    expect(offsets).toEqual([5, 0, 6, 6])
  })

  it('drops the whole op, with a reason, for anything it cannot trust', () => {
    const p = fixture()
    const why = (o: Record<string, unknown>) =>
      sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 4, ...o }], p.engine.getProject()).dropped.map((d) => d.reason)
    expect(why({ clips: undefined })).toEqual([expect.stringMatching(/needs a clips array/)])
    expect(why({ clips: [p.a] })).toEqual([expect.stringMatching(/at least two/)])
    expect(why({ clips: [p.a, p.a] })).toEqual([expect.stringMatching(/same clip twice/)])
    expect(why({ clips: [p.a, 'nope'] })).toEqual([expect.stringMatching(/no clip "nope"/)])
    expect(why({ clips: [p.a, '$later'] })).toEqual([expect.stringMatching(/refers to nothing created earlier/)])
    expect(why({ clips: [p.a, `${p.b}/child`] })).toEqual([expect.stringMatching(/path into a graphic/)])
    expect(why({ clips: Array.from({ length: 25 }, (_, i) => `c${i}`) })).toEqual([expect.stringMatching(/at most 24/)])
    expect(why({ preset: 'overshoot' })).toEqual([expect.stringMatching(/unknown stagger preset "overshoot"/)])
    // A beat preset is not a whole-clip preset: it needs a beat grid, so it cannot stagger.
    expect(why({ preset: 'beat-zoom' })).toEqual([expect.stringMatching(/unknown stagger preset/)])
  })
})

describe('applyOps: staggerPreset', () => {
  it('writes real keyframes, each clip later than the one before', () => {
    const p = fixture()
    const { ops, dropped } = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'fade-in', offsetFrames: 5 }], p.engine.getProject())
    expect(dropped).toEqual([])
    const res = applyOps(p.engine, ops, { description: 'stagger' })
    expect(res.skipped).toEqual([])
    expect(res.applied).toEqual([0])
    expect([p.a, p.b, p.c].map((id) => firstOpacityFrame(p.engine, id))).toEqual([0, 5, 10])
    expect(res.touched.changed.sort()).toEqual([p.a, p.b, p.c].sort())
    expect(() => resolveTimeline(10, p.engine.getProject())).not.toThrow()
  })

  it('follows the order given, not the timeline order', () => {
    const p = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [p.c, p.b, p.a], preset: 'fade-in', offsetFrames: 7 }], p.engine.getProject())
    applyOps(p.engine, ops)
    expect([p.c, p.b, p.a].map((id) => firstOpacityFrame(p.engine, id))).toEqual([0, 7, 14])
  })

  it('is one undo step', () => {
    const p = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'pop-in', offsetFrames: 3 }], p.engine.getProject())
    applyOps(p.engine, ops)
    expect(p.engine.findClip(p.b)?.clip.keyframes?.channels?.scale?.keys.length).toBeGreaterThan(0)
    p.engine.undo()
    for (const id of [p.a, p.b, p.c]) expect(p.engine.findClip(id)?.clip.keyframes?.channels?.scale).toBeUndefined()
  })

  it('works on clips created earlier in the same plan', () => {
    const p = fixture()
    const raw = [
      { op: 'addText', ref: 'x', text: 'X', at: 8, duration: 2 },
      { op: 'addText', ref: 'y', text: 'Y', at: 9, duration: 2 },
      { op: 'staggerPreset', clips: ['$x', '$y'], preset: 'fade-in', offsetFrames: 4 },
    ]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(dropped).toEqual([])
    const res = applyOps(p.engine, ops)
    expect(res.skipped).toEqual([])
    expect(firstOpacityFrame(p.engine, res.refs.x!)).toBe(0)
    expect(firstOpacityFrame(p.engine, res.refs.y!)).toBe(4)
  })

  it('skips the whole op with a reason when a clip is gone, writing nothing', () => {
    const p = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'fade-in', offsetFrames: 5 }], p.engine.getProject())
    p.engine.removeClip(p.c, p.lane)
    const res = applyOps(p.engine, ops)
    expect(res.applied).toEqual([])
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0]).toMatchObject({ index: 0, reason: expect.stringContaining(`no clip "${p.c}"`) })
    expect(firstOpacityFrame(p.engine, p.a)).toBeUndefined()
    expect(firstOpacityFrame(p.engine, p.b)).toBeUndefined()
  })

  it('skips an unresolved $ref and a locked lane with a reason, and never throws', () => {
    const p = fixture()
    const bare = [{ op: 'staggerPreset', clips: [p.a, '$ghost'], preset: 'fade-in', offsetFrames: 5 }] as unknown as EditorOp[]
    const r1 = applyOps(p.engine, bare)
    expect(r1.skipped[0]!.reason).toMatch(/"\$ghost" was not created/)
    const locked = [{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 5 }] as unknown as EditorOp[]
    p.engine.updateTrack(p.lane, { locked: true })
    const r2 = applyOps(p.engine, locked)
    expect(r2.skipped[0]!.reason).toMatch(/locked track/)
    expect(firstOpacityFrame(p.engine, p.a)).toBeUndefined()
  })

  it('reads as one sentence on the card', () => {
    const p = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'slide-in-up', offsetFrames: 5 }], p.engine.getProject())
    expect(opDescriber(p.engine.getProject())(ops[0]!)).toBe('Stagger slide in up across “One”, “Two”, “Three” (5 frames apart)')
  })
})

describe('the whole op set never throws on junk', () => {
  const junk: unknown[] = [null, undefined, 0, 'x', [], {}, NaN, -1, 1e9, { a: 1 }, [null], ['a', 'b'], true]

  it('sanitizeOps survives every op name with every junk value in every slot', () => {
    const p = fixture()
    const slots = ['clip', 'clips', 'preset', 'offsetFrames', 'amount', 'at', 'duration', 'keys', 'items', 'value', 'text', 'kind']
    const raw: unknown[] = [null, 5, 'staggerPreset']
    for (const name of EDITOR_OP_NAMES) {
      raw.push({ op: name })
      for (const slot of slots) for (const v of junk) raw.push({ op: name, [slot]: v })
    }
    expect(() => sanitizeOps(raw, p.engine.getProject())).not.toThrow()
  })

  it('applyOps survives staggerPreset aimed at junk without throwing or writing', () => {
    const p = fixture()
    const ops = junk.flatMap((v) => [
      { op: 'staggerPreset', clips: v, preset: 'fade-in', offsetFrames: 5 },
      { op: 'staggerPreset', clips: [p.a, p.b], preset: v, offsetFrames: v },
      { op: 'staggerPreset', clips: [v, p.b], preset: 'fade-in', offsetFrames: 5, amount: v },
    ]) as unknown as EditorOp[]
    let res: ReturnType<typeof applyOps> | undefined
    expect(() => {
      res = applyOps(p.engine, ops)
    }).not.toThrow()
    expect(res!.applied.length + res!.skipped.length).toBe(ops.length)
    expect(() => resolveTimeline(10, p.engine.getProject())).not.toThrow()
  })
})

// A plan that writes per-clip presets AND a stagger of the same preset over the same clips would apply both, leaving
// the un-offset keys next to the staggered ones. `sanitizeOps` drops the covered per-clip presets.
describe('sanitizeOps: staggerPreset covers per-clip presets', () => {
  const COVERED = 'covered by staggerPreset on the same clips'

  function pair() {
    const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
    // One lane per clip: they all start together, and clips on a lane may not overlap.
    const add = (name: string) =>
      engine.addClip({ trackId: engine.addTrack('elements').id, type: 'text', name, startFrame: 0, durationFrames: 90, text: { content: name } } as never).id
    const logo = add('logo')
    const title = add('title')
    const other = add('other')
    return { engine, logo, title, other }
  }
  const frames = (engine: TimelineEngine, id: string, channel: 'opacity' | 'y') =>
    engine.findClip(id)?.clip.keyframes?.channels?.[channel]?.keys.map((k) => k.frame)
  const stagger = { op: 'staggerPreset', preset: 'slide-in-up', clips: ['logo', 'title'], offsetFrames: 6 }

  it('keeps only the stagger of the exact three-op plan and leaves no un-offset keys', () => {
    const p = pair()
    const raw = [
      { op: 'applyMotionPreset', clip: 'logo', preset: 'slide-in-up' },
      { op: 'applyMotionPreset', clip: 'title', preset: 'slide-in-up' },
      stagger,
    ]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(ops.map((o) => o.op)).toEqual(['staggerPreset'])
    expect(dropped).toEqual([
      { index: 0, reason: COVERED },
      { index: 1, reason: COVERED },
    ])
    applyOps(p.engine, ops)

    // Reference: the stagger on its own writes exactly the same keys.
    const ref = pair()
    applyOps(ref.engine, sanitizeOps([stagger], ref.engine.getProject()).ops)
    for (const channel of ['opacity', 'y'] as const) {
      expect(frames(p.engine, p.title, channel)).toEqual(frames(ref.engine, ref.title, channel))
      expect(frames(p.engine, p.logo, channel)).toEqual(frames(ref.engine, ref.logo, channel))
    }
    const titleY = frames(p.engine, p.title, 'y')!
    const logoY = frames(p.engine, p.logo, 'y')!
    expect(titleY[0]).toBe(logoY[0]! + 6)
    expect(titleY).toHaveLength(logoY.length)
    expect(titleY).not.toContain(logoY[0])
  })

  it('drops a covered preset written before AND after the stagger, in plan order', () => {
    const p = pair()
    const raw = [
      { op: 'applyMotionPreset', clip: p.logo, preset: 'slide-in-up' },
      stagger,
      { op: 'applyMotionPreset', clip: '$none', preset: 'slide-in-up' },
      { op: 'applyMotionPreset', clip: 'title', preset: 'slide-in-up' },
    ]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(ops.map((o) => o.op)).toEqual(['staggerPreset'])
    expect(dropped).toEqual([
      { index: 0, reason: COVERED },
      { index: 2, reason: expect.stringMatching(/refers to nothing created earlier/) },
      { index: 3, reason: COVERED },
    ])
  })

  it('also covers a clip written as a $ref the stagger names', () => {
    const p = pair()
    const raw = [
      { op: 'addText', ref: 'x', text: 'X', at: 5, duration: 2 },
      { op: 'applyMotionPreset', clip: '$x', preset: 'fade-in' },
      { op: 'staggerPreset', preset: 'fade-in', clips: ['logo', '$x'], offsetFrames: 3 },
    ]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(ops.map((o) => o.op)).toEqual(['addText', 'staggerPreset'])
    expect(dropped).toEqual([{ index: 1, reason: COVERED }])
  })

  it('keeps a different preset on a staggered clip', () => {
    const p = pair()
    const raw = [{ op: 'applyMotionPreset', clip: 'title', preset: 'fade-in' }, stagger]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops.map((o) => o.op)).toEqual(['applyMotionPreset', 'staggerPreset'])
  })

  it('keeps the same preset on a clip outside the stagger', () => {
    const p = pair()
    const raw = [stagger, { op: 'applyMotionPreset', clip: 'other', preset: 'slide-in-up' }]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(dropped).toEqual([])
    expect(ops.map((o) => o.op)).toEqual(['staggerPreset', 'applyMotionPreset'])
  })

  it('leaves a plan with no stagger exactly as it was', () => {
    const p = pair()
    const raw = [
      { op: 'applyMotionPreset', clip: 'logo', preset: 'slide-in-up' },
      { op: 'applyMotionPreset', clip: 'title', preset: 'slide-in-up', amount: 2 },
      { op: 'applyMotionPreset', clip: 'nope', preset: 'slide-in-up' },
    ]
    const r = sanitizeOps(raw, p.engine.getProject())
    expect(r).toEqual({
      ops: [
        { op: 'applyMotionPreset', clip: p.logo, preset: 'slide-in-up' },
        { op: 'applyMotionPreset', clip: p.title, preset: 'slide-in-up', amount: 2 },
      ],
      dropped: [{ index: 2, reason: 'no clip "nope" on the timeline' }],
    })
  })

  it('does not let a dropped stagger cover anything', () => {
    const p = pair()
    const raw = [{ op: 'applyMotionPreset', clip: 'title', preset: 'slide-in-up' }, { ...stagger, clips: ['logo'] }]
    const { ops, dropped } = sanitizeOps(raw, p.engine.getProject())
    expect(ops.map((o) => o.op)).toEqual(['applyMotionPreset'])
    expect(dropped).toEqual([{ index: 1, reason: expect.stringMatching(/at least two/) }])
  })
})

// PQ-2d: the 17 new preset names flow from MOTION_PRESET_NAMES through sanitize and apply with no change to either.
describe('PQ-2d preset names through the op layer', () => {
  const NEW = [
    'slide-out-left', 'slide-out-right', 'slide-out-up', 'slide-out-down', 'pop-out',
    'wipe-in', 'wipe-out', 'blur-in', 'blur-out', 'tracking-in', 'tracking-out',
    'highlight-sweep', 'highlight-clear', 'underline-draw', 'underline-erase', 'pop-overshoot', 'hold-breathe',
  ]

  it.each(NEW)('sanitizeOps accepts %s for applyMotionPreset and staggerPreset', (preset) => {
    const p = fixture()
    // Separate calls: a stagger over the same clips covers (drops) a single apply in the same batch.
    const single = sanitizeOps([{ op: 'applyMotionPreset', clip: p.a, preset }], p.engine.getProject())
    const stagger = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset, offsetFrames: 4 }], p.engine.getProject())
    expect([single.dropped, stagger.dropped]).toEqual([[], []])
    expect([...single.ops, ...stagger.ops].map((o) => (o as { preset: string }).preset)).toEqual([preset, preset])
  })

  it('applies blur-in to a text clip as an effect plus real keys, and skips an underline on text with a reason', () => {
    const p = fixture()
    const { ops } = sanitizeOps(
      [
        { op: 'applyMotionPreset', clip: p.a, preset: 'blur-in' },
        { op: 'applyMotionPreset', clip: p.b, preset: 'underline-draw' },
      ],
      p.engine.getProject(),
    )
    const res = applyOps(p.engine, ops)
    expect(res.applied).toEqual([0])
    expect(res.skipped).toHaveLength(1)
    const clip = p.engine.findClip(p.a)!.clip
    expect(clip.effects).toHaveLength(1)
    expect(Object.keys(clip.keyframes!.channels)).toEqual(expect.arrayContaining([`fx.${clip.effects![0].id}.radius`, 'opacity']))
    expect(() => resolveTimeline(10, p.engine.getProject())).not.toThrow()
  })
})

describe('staggerPreset: from, ease, grid (MOT-2)', () => {
  it('sanitizes the optional fields and drops unusable ones', () => {
    const p = fixture()
    const ok = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'fade-in', offsetFrames: 4, from: 'center', ease: 'quad-out', grid: 2 }], p.engine.getProject())
    expect(ok.dropped).toEqual([])
    expect(ok.ops[0]).toEqual({ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'fade-in', offsetFrames: 4, from: 'center', ease: 'quad-out', grid: 2 })
    const idx = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 4, from: '1' }], p.engine.getProject())
    expect((idx.ops[0] as Extract<EditorOp, { op: 'staggerPreset' }>).from).toBe(1)
    const nulls = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 4, from: null, ease: null, grid: null }], p.engine.getProject())
    expect(nulls.ops[0]).toEqual({ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 4 })
    const why = (o: Record<string, unknown>) =>
      sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b], preset: 'fade-in', offsetFrames: 4, ...o }], p.engine.getProject()).dropped.map((d) => d.reason)
    expect(why({ from: 'middle' })).toEqual([expect.stringMatching(/unknown stagger origin/)])
    expect(why({ ease: 'wobble' })).toEqual([expect.stringMatching(/unknown stagger ease/)])
  })

  it('a plain op writes the same keys as before; from center starts in the middle', () => {
    const plain = fixture()
    applyOps(plain.engine, sanitizeOps([{ op: 'staggerPreset', clips: [plain.a, plain.b, plain.c], preset: 'fade-in', offsetFrames: 5 }], plain.engine.getProject()).ops)
    expect([plain.a, plain.b, plain.c].map((id) => firstOpacityFrame(plain.engine, id))).toEqual([0, 5, 10])
    const mid = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [mid.a, mid.b, mid.c], preset: 'fade-in', offsetFrames: 5, from: 'center' }], mid.engine.getProject())
    applyOps(mid.engine, ops)
    expect([mid.a, mid.b, mid.c].map((id) => firstOpacityFrame(mid.engine, id))).toEqual([5, 0, 5])
  })

  it('reads the origin and grid on the card', () => {
    const p = fixture()
    const { ops } = sanitizeOps([{ op: 'staggerPreset', clips: [p.a, p.b, p.c], preset: 'slide-in-up', offsetFrames: 5, from: 'center', grid: 2 }], p.engine.getProject())
    expect(opDescriber(p.engine.getProject())(ops[0]!)).toBe('Stagger slide in up across “One”, “Two”, “Three” (5 frames apart, from center, 2-column grid)')
  })
})
