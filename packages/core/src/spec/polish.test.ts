import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from './compile'
import { lintSpec, polishSpec } from './polish'
import { DEFAULT_MOTION_STYLE, type MotionStyle } from './components/types'
import type { SpecElement, VideoSpec } from './types'

const FORMAT = { width: 1080, height: 1920, fps: 30 }

function style(over: Partial<MotionStyle> = {}): MotionStyle {
  return { ...DEFAULT_MOTION_STYLE, ...over }
}

function baseSpec(elements: SpecElement[], extra: Partial<VideoSpec> = {}): VideoSpec {
  return { format: FORMAT, duration: 10, elements, ...extra }
}

function text(id: string, at: number, duration: number, extra: Partial<SpecElement> = {}): SpecElement {
  return { id, kind: 'text', at, duration, text: id, size: 60, ...extra }
}

function shape(id: string, at: number, duration: number, extra: Partial<SpecElement> = {}): SpecElement {
  return { id, kind: 'shape', shape: 'rect', at, duration, w: 100, h: 100, ...extra }
}

function group(id: string, at: number, duration: number, children: SpecElement[], extra: Partial<SpecElement> = {}): SpecElement {
  return { id, kind: 'group', at, duration, children, ...extra }
}

function richSpec(): VideoSpec {
  return baseSpec(
    [
      text('attention', 0, 2, { enter: 'fade-in', exit: 'fade-out' }),
      group('because', 2, 3, [
        text('because-line', 0, 3, { reveal: { preset: 'rise' } }),
        text('because-sub', 0.8, 2.2, { enter: 'fade-in' }),
      ]),
      shape('ring', 5, 2, { shape: 'circle' }),
      shape('u1', 5, 1, { x: 0.3, y: 0.5 }),
      shape('u2', 5, 1, { x: 0.7, y: 0.5 }),
    ],
    { duration: 8, design: { colors: [{ name: 'accent', value: '#22c55e' }] } },
  )
}

describe('polishSpec: only fills gaps', () => {
  // Every element below closes off all FOUR per-element concerns at once: an
  // explicit `enter`/`exit` (blocks arrival/exit), and either a duration at or
  // under the idle-life threshold (1.2s) or an explicit expression on x/y/scale
  // (blocks idle life). None are adjacent (no hand-off boundary), none are a
  // top-level `group` (camera never applies), and no two share an `at` (no
  // stagger). That isolates the property this test is about: fill gaps, touch
  // nothing else.
  it('leaves a fully-authored spec unchanged apart from the ambient layer', () => {
    const spec = baseSpec([
      text('a', 0, 1, { enter: 'fade-in', exit: 'fade-out' }),
      text('b', 3, 1, { enter: 'fade-in', exit: 'fade-out' }),
      shape('c', 6, 2, { enter: 'pop-in', exit: 'fade-out', expressions: [{ channel: 'y', source: 'value' }] }),
    ])
    const { spec: out } = polishSpec(spec, style())
    const original = out.elements.filter((e) => !e.id.startsWith('polish-'))
    expect(original).toEqual(spec.elements)
    const added = out.elements.filter((e) => e.id.startsWith('polish-'))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((e) => e.id.startsWith('polish-ambient-'))).toBe(true)
  })

  it('adds nothing at all when ambient is "none" and every concern is already authored', () => {
    const spec = baseSpec([text('a', 0, 1, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style({ ambient: 'none' }))
    expect(out.elements).toEqual(spec.elements)
    expect(issues).toEqual([])
  })
})

describe('polishSpec: arrivals', () => {
  it('fills a riseIn on a text element with no enter/reveal/keys', () => {
    const spec = baseSpec([text('a', 0, 3)])
    const { spec: out, issues } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.keys?.some((k) => k.channel === 'y')).toBe(true)
    expect(issues.some((i) => i.code === 'polished' && i.message.includes('arrivals to 1'))).toBe(true)
  })

  it('fills a popIn on a shape/icon with no enter/reveal/keys', () => {
    const spec = baseSpec([shape('a', 0, 3)])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.keys?.some((k) => k.channel === 'scale')).toBe(true)
  })

  it('does not add an arrival when `enter` is set (exit still fills, since exit is a separate concern)', () => {
    const spec = baseSpec([text('a', 0, 3, { enter: 'fade-in' })])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.keys?.some((k) => k.channel === 'y')).toBeFalsy() // riseIn's signature channel
  })

  it('does not add an arrival when `reveal` is set', () => {
    const spec = baseSpec([text('a', 0, 3, { reveal: { preset: 'typewriter' } })])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.keys?.some((k) => k.channel === 'y')).toBeFalsy()
  })

  it('does not add an arrival when the element already keys an arrival channel', () => {
    const spec = baseSpec([shape('a', 0, 3, { keys: [{ channel: 'x', at: 0, value: 0.3 }] })])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    // no arrival-shaped scale key (popIn grows FROM ~0.35) was added; the sole x key is still exactly what was authored.
    // (exit is a separate, still-open concern here, so it is free to add its own shrink-to-0.96 scale key.)
    expect(a.keys!.filter((k) => k.channel === 'x')).toEqual([{ channel: 'x', at: 0, value: 0.3 }])
    expect(a.keys!.some((k) => k.channel === 'scale' && k.value <= 0.4)).toBe(false)
  })

  it('rescales the arrival onto the element\'s own scale/opacity', () => {
    const spec = baseSpec([shape('a', 0, 3, { scale: 2, opacity: 0.5 })])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    const scaleValues = a.keys!.filter((k) => k.channel === 'scale').map((k) => k.value)
    const opacityValues = a.keys!.filter((k) => k.channel === 'opacity').map((k) => k.value)
    expect(Math.max(...scaleValues)).toBeCloseTo(2)
    expect(Math.max(...opacityValues)).toBeCloseTo(0.5)
  })

  it('does not touch an element spanning the whole piece', () => {
    const spec = baseSpec([shape('bg', 0, 10)], { duration: 10 })
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'bg')!.keys).toBeUndefined()
  })
})

describe('polishSpec: exits', () => {
  it('fills an exit when the element only has an authored arrival', () => {
    const spec = baseSpec([shape('a', 0, 3, { enter: 'pop-in' })])
    const { spec: out, issues } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    const lateOpacity = a.keys!.filter((k) => k.channel === 'opacity' && k.at >= 1.5)
    expect(lateOpacity.some((k) => k.value === 0)).toBe(true)
    expect(issues.some((i) => i.message.includes('exits to'))).toBe(true)
  })

  it('does not add an exit when `exit` is set', () => {
    const spec = baseSpec([shape('a', 0, 3, { enter: 'pop-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.keys).toBeUndefined()
  })

  it('does not add an exit when a back-half key already exists', () => {
    const spec = baseSpec([shape('a', 0, 4, { keys: [{ channel: 'opacity', at: 3.5, value: 0 }] })])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.keys).toEqual([{ channel: 'opacity', at: 3.5, value: 0 }])
  })

  it('does add an exit when the only key is in the FRONT half (an arrival, not a custom exit)', () => {
    const spec = baseSpec([shape('a', 0, 4, { keys: [{ channel: 'opacity', at: 0.2, value: 1 }] })])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.keys!.some((k) => k.channel === 'opacity' && k.at >= 2 && k.value === 0)).toBe(true)
  })
})

describe('polishSpec: stagger', () => {
  it('spreads siblings tied at the same `at`, in reading order (top-to-bottom, left-to-right)', () => {
    const spec = baseSpec([
      shape('right', 1, 2, { x: 0.8, y: 0.5, enter: 'pop-in', exit: 'fade-out' }),
      shape('left', 1, 2, { x: 0.2, y: 0.5, enter: 'pop-in', exit: 'fade-out' }),
    ])
    const { spec: out, issues } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'left')!.at).toBe(1)
    expect(out.elements.find((e) => e.id === 'right')!.at).toBeCloseTo(1.07)
    expect(issues.some((i) => i.message.includes('staggered 1 sibling across 1 group'))).toBe(true)
  })

  it('leaves siblings with distinct `at` untouched', () => {
    const spec = baseSpec([shape('a', 0, 2, { enter: 'pop-in', exit: 'fade-out' }), shape('b', 1, 2, { enter: 'pop-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.at).toBe(0)
    expect(out.elements.find((e) => e.id === 'b')!.at).toBe(1)
  })

  it('staggers ties inside a group\'s own children too', () => {
    const spec = baseSpec([
      group('g', 0, 3, [
        shape('c1', 0, 2, { x: 0.3, enter: 'pop-in', exit: 'fade-out' }),
        shape('c2', 0, 2, { x: 0.7, enter: 'pop-in', exit: 'fade-out' }),
      ]),
    ])
    const { spec: out } = polishSpec(spec, style())
    const g = out.elements.find((e) => e.id === 'g')!
    expect(g.children!.find((c) => c.id === 'c1')!.at).toBe(0)
    expect(g.children!.find((c) => c.id === 'c2')!.at).toBeCloseTo(0.07)
  })
})

describe('polishSpec: idle life', () => {
  it('adds idle float to an element holding still for more than 1.2s', () => {
    const spec = baseSpec([shape('a', 0, 3, { enter: 'pop-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.expressions?.some((e) => e.channel === 'y')).toBe(true)
    expect(issues.some((i) => i.message.includes('idle float'))).toBe(true)
  })

  it('does not add idle float to a short-lived element', () => {
    const spec = baseSpec([shape('a', 0, 1, { enter: 'pop-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.expressions).toBeUndefined()
  })

  it('does not add idle float when the element already has x/y/scale motion', () => {
    const spec = baseSpec([
      shape('a', 0, 3, {
        keys: [
          { channel: 'x', at: 0, value: 0.3 },
          { channel: 'x', at: 1, value: 0.5 },
        ],
      }),
    ])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.expressions ?? []).toEqual([])
  })

  it('phases siblings apart by index so a row does not bob in lockstep', () => {
    const spec = baseSpec([
      shape('a', 0, 3, { enter: 'pop-in', exit: 'fade-out' }),
      shape('b', 4, 3, { enter: 'pop-in', exit: 'fade-out' }),
    ])
    const { spec: out } = polishSpec(spec, style())
    const a = out.elements.find((e) => e.id === 'a')!.expressions!.find((e) => e.channel === 'y')!
    const b = out.elements.find((e) => e.id === 'b')!.expressions!.find((e) => e.channel === 'y')!
    expect(a.source).not.toEqual(b.source)
  })
})

describe('polishSpec: camera', () => {
  it('adds a camera push to a top-level group with no scale keys', () => {
    const spec = baseSpec([group('g', 0, 4, [], { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style())
    const g = out.elements.find((e) => e.id === 'g')!
    expect(g.keys?.some((k) => k.channel === 'scale')).toBe(true)
    expect(issues.some((i) => i.message.includes('camera push on 1 beat'))).toBe(true)
  })

  it('skips a group that already keys scale', () => {
    const spec = baseSpec([
      group('g', 0, 4, [], {
        keys: [
          { channel: 'scale', at: 0, value: 1 },
          { channel: 'scale', at: 4, value: 1.1 },
        ],
      }),
    ])
    const { spec: out, issues } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'g')!.keys).toHaveLength(2)
    expect(issues.some((i) => i.message.includes('camera push'))).toBe(false)
  })

  it('never applies camera to a non-group top-level element', () => {
    const spec = baseSpec([shape('a', 0, 4, { enter: 'pop-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style())
    expect(out.elements.find((e) => e.id === 'a')!.keys).toBeUndefined()
  })

  it('style.camera=false disables camera entirely', () => {
    const spec = baseSpec([group('g', 0, 4, [], { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style({ camera: false }))
    expect(out.elements.find((e) => e.id === 'g')!.keys?.some((k) => k.channel === 'scale')).toBeFalsy()
  })
})

describe('polishSpec: hand-offs', () => {
  const adjacentPair = () =>
    baseSpec([
      text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' }),
      text('b', 2, 2, { enter: 'fade-in', exit: 'fade-out' }),
    ])

  it('extends the ending beat by the overlap and fades it for crossfade', () => {
    const spec = adjacentPair()
    const { spec: out, issues } = polishSpec(spec, style({ transition: 'crossfade', ambient: 'none' }))
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.duration).toBeCloseTo(2.25)
    expect(issues.some((i) => i.message.includes('crossfade hand-off at 1 boundary'))).toBe(true)
  })

  it('pluralizes the info message correctly across more than one boundary', () => {
    const spec = baseSpec([
      text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' }),
      text('b', 2, 2, { enter: 'fade-in', exit: 'fade-out' }),
      text('c', 4, 2, { enter: 'fade-in', exit: 'fade-out' }),
    ])
    const { issues } = polishSpec(spec, style({ transition: 'crossfade', ambient: 'none' }))
    expect(issues.some((i) => i.message === 'crossfade hand-off at 2 boundaries')).toBe(true)
  })

  it('inserts a full-frame wipe element for the wipe transition', () => {
    const spec = adjacentPair()
    const { spec: out } = polishSpec(spec, style({ transition: 'wipe', ambient: 'none' }))
    const wipe = out.elements.find((e) => e.id.startsWith('polish-wipe-'))
    expect(wipe).toBeDefined()
    expect(wipe!.w).toBe(FORMAT.width)
    expect(wipe!.h).toBe(FORMAT.height)
  })

  it('zoom scales the exiting beat up and the entering beat down from 1.1x', () => {
    const spec = baseSpec([shape('a', 0, 2, { enter: 'pop-in', exit: 'fade-out' }), text('b', 2, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style({ transition: 'zoom', ambient: 'none' }))
    const a = out.elements.find((e) => e.id === 'a')!
    const b = out.elements.find((e) => e.id === 'b')!
    expect(a.duration).toBeGreaterThan(2)
    expect(a.keys?.some((k) => k.channel === 'scale' && k.value > 1)).toBe(true)
    expect(b.keys?.find((k) => k.channel === 'scale' && k.at === 0)?.value).toBeCloseTo(1.1)
  })

  it('slide pushes both beats along x', () => {
    const spec = baseSpec([shape('a', 0, 2, { enter: 'pop-in', exit: 'fade-out' }), text('b', 2, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style({ transition: 'slide', ambient: 'none' }))
    const b = out.elements.find((e) => e.id === 'b')!
    expect(b.keys?.some((k) => k.channel === 'x')).toBe(true)
  })

  it('does not touch beats separated by a gap', () => {
    const spec = baseSpec([text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' }), text('b', 2.5, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style({ ambient: 'none' }))
    expect(out.elements.find((e) => e.id === 'a')!.duration).toBe(2)
    expect(issues.some((i) => i.code === 'polished' && i.message.includes('hand-off'))).toBe(false)
  })

  it('does not touch beats that already overlap', () => {
    const spec = baseSpec([text('a', 0, 3, { enter: 'fade-in', exit: 'fade-out' }), text('b', 2, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out } = polishSpec(spec, style({ ambient: 'none' }))
    expect(out.elements.find((e) => e.id === 'a')!.duration).toBe(3)
  })

  it('the `cut` transition disables hand-offs entirely', () => {
    const spec = adjacentPair()
    const { spec: out, issues } = polishSpec(spec, style({ transition: 'cut', ambient: 'none' }))
    expect(out.elements.find((e) => e.id === 'a')!.duration).toBe(2)
    expect(out.elements.some((e) => e.id.startsWith('polish-wipe-'))).toBe(false)
    expect(issues.some((i) => i.message.includes('hand-off'))).toBe(false)
  })

  it('leaves the piece duration alone when the extension stays within it', () => {
    const spec = adjacentPair() // a: 0-2, b: 2-4; piece duration authored as 10, far more than needed
    const { spec: out } = polishSpec(spec, style({ transition: 'crossfade', ambient: 'none' }))
    expect(out.duration).toBe(10)
  })

  it('extends the piece duration when the hand-off pushes the ending beat past it', () => {
    // b is deliberately shorter than the 0.25s overlap, so extending a's tail is what becomes the new end.
    const spec = baseSpec(
      [text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' }), text('b', 2, 0.15, { enter: 'fade-in', exit: 'fade-out' })],
      { duration: 2.15 },
    )
    const { spec: out } = polishSpec(spec, style({ transition: 'crossfade', ambient: 'none' }))
    const a = out.elements.find((e) => e.id === 'a')!
    expect(a.duration).toBeCloseTo(2.25)
    expect(out.duration).toBeCloseTo(2.25)
    expect(out.duration).toBeGreaterThan(2.15)
  })
})

describe('polishSpec: ambient layer', () => {
  it.each(['orbs', 'dots', 'grid', 'grain', 'gradient'] as const)('adds a %s layer spanning the piece', (kind) => {
    const spec = baseSpec([text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style({ ambient: kind, transition: 'cut' }))
    const added = out.elements.filter((e) => e.id.startsWith('polish-ambient-'))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((e) => e.duration === out.duration)).toBe(true)
    expect(issues.some((i) => i.message === `ambient ${kind} layer`)).toBe(true)
  })

  it('adds nothing for ambient "none"', () => {
    const spec = baseSpec([text('a', 0, 2, { enter: 'fade-in', exit: 'fade-out' })])
    const { spec: out, issues } = polishSpec(spec, style({ ambient: 'none', transition: 'cut' }))
    expect(out.elements.some((e) => e.id.startsWith('polish-ambient-'))).toBe(false)
    expect(issues.some((i) => i.message.includes('ambient'))).toBe(false)
  })
})

describe('polishSpec: idempotence, determinism and compiler safety', () => {
  it('is idempotent: polishing an already-polished spec changes nothing further', () => {
    const s = style()
    const once = polishSpec(richSpec(), s, { seed: 3 })
    const twice = polishSpec(once.spec, s, { seed: 3 })
    expect(twice.spec).toEqual(once.spec)
  })

  it('is deterministic: the same seed and style produce byte-identical output', () => {
    const s = style()
    const a = polishSpec(richSpec(), s, { seed: 3 })
    const b = polishSpec(richSpec(), s, { seed: 3 })
    expect(a.spec).toEqual(b.spec)
  })

  it('a different seed can change the ambient layout', () => {
    const s = style()
    const a = polishSpec(richSpec(), s, { seed: 3 })
    const b = polishSpec(richSpec(), s, { seed: 99 })
    expect(a.spec).not.toEqual(b.spec)
  })

  it('a polished spec compiles with no error issues', () => {
    const s = style()
    const { spec } = polishSpec(richSpec(), s, { seed: 3 })
    const { issues } = compileVideoSpec(spec, { seed: 3 })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})

describe('lintSpec', () => {
  it('sparse-beat: fires when fewer than 3 elements are visible for over 1s', () => {
    const spec = baseSpec([group('beat', 0, 3, [text('only', 0, 3, { size: 40 })])])
    expect(lintSpec(spec).some((i) => i.code === 'sparse-beat')).toBe(true)
  })

  it('sparse-beat: does not fire with 3+ elements visible, or for a deliberate word hit', () => {
    const spec = baseSpec(
      [group('beat', 0, 3, [text('a', 0, 3, { size: 40 }), shape('b', 0, 3), shape('c', 0, 3)]), text('hit', 4, 2, { size: 140 })],
      { duration: 8 },
    )
    expect(lintSpec(spec).some((i) => i.code === 'sparse-beat')).toBe(false)
  })

  it('hard-cut: fires on an empty frame between beats', () => {
    const spec = baseSpec([text('a', 0, 2), text('b', 4, 2)], { duration: 6 })
    expect(lintSpec(spec).some((i) => i.code === 'hard-cut')).toBe(true)
  })

  it('hard-cut: does not fire when content spans the whole piece', () => {
    const spec = baseSpec([text('a', 0, 3), text('b', 3, 3)], { duration: 6 })
    expect(lintSpec(spec).some((i) => i.code === 'hard-cut')).toBe(false)
  })

  it('static-hold: fires when nothing animates for a long stretch', () => {
    const spec = baseSpec([text('a', 0, 6)], { duration: 6 })
    expect(lintSpec(spec).some((i) => i.code === 'static-hold')).toBe(true)
  })

  it('static-hold: fires on a silent stretch BETWEEN two moving elements, not just at the end', () => {
    const spec = baseSpec([text('a', 0, 1, { enter: 'fade-in' }), text('b', 5, 1, { enter: 'fade-in' })], { duration: 6 })
    expect(lintSpec(spec).some((i) => i.code === 'static-hold')).toBe(true)
  })

  it('static-hold: does not fire when something animates throughout', () => {
    const spec = baseSpec([text('a', 0, 6, { enter: 'fade-in', exit: 'fade-out' })], { duration: 6 })
    expect(lintSpec(spec).some((i) => i.code === 'static-hold')).toBe(false)
  })

  it('linear-movement: fires on an explicit linear curve on a movement channel', () => {
    const spec = baseSpec([
      shape('a', 0, 2, {
        keys: [
          { channel: 'x', at: 0, value: 0.2 },
          { channel: 'x', at: 1, value: 0.5, curve: 'linear' },
        ],
      }),
    ])
    expect(lintSpec(spec).some((i) => i.code === 'linear-movement')).toBe(true)
  })

  it('linear-movement: does not fire with a named easing', () => {
    const spec = baseSpec([
      shape('a', 0, 2, {
        keys: [
          { channel: 'x', at: 0, value: 0.2 },
          { channel: 'x', at: 1, value: 0.5, curve: 'cubic-out' },
        ],
      }),
    ])
    expect(lintSpec(spec).some((i) => i.code === 'linear-movement')).toBe(false)
  })

  it('off-scale-type: fires when a text size is outside the hierarchy bands', () => {
    const spec = baseSpec([text('a', 0, 2, { size: 70 })])
    expect(lintSpec(spec).some((i) => i.code === 'off-scale-type')).toBe(true)
  })

  it('off-scale-type: does not fire inside a band', () => {
    const spec = baseSpec([text('a', 0, 2, { size: 110 })])
    expect(lintSpec(spec).some((i) => i.code === 'off-scale-type')).toBe(false)
  })

  it('accent-overuse: fires when over 35% of text is in accent colour', () => {
    const spec = baseSpec(
      [text('a', 0, 1, { color: '$accent' }), text('b', 1, 1, { color: '$accent' }), text('c', 2, 1, { color: '$ink' })],
      { design: { colors: [{ name: 'accent', value: '#22c55e' }] } },
    )
    expect(lintSpec(spec).some((i) => i.code === 'accent-overuse')).toBe(true)
  })

  it('accent-overuse: does not fire at or below the threshold', () => {
    const spec = baseSpec([text('a', 0, 1, { color: '$accent' }), text('b', 1, 1, { color: '$ink' }), text('c', 2, 1, { color: '$ink' })])
    expect(lintSpec(spec).some((i) => i.code === 'accent-overuse')).toBe(false)
  })

  it('unreadable-hold: fires when duration is shorter than reading time', () => {
    const spec = baseSpec([text('a', 0, 0.4, { text: 'a rather long sentence to read quickly' })])
    expect(lintSpec(spec).some((i) => i.code === 'unreadable-hold')).toBe(true)
  })

  it('unreadable-hold: does not fire with enough time', () => {
    const spec = baseSpec([text('a', 0, 5, { text: 'a rather long sentence to read quickly' })])
    expect(lintSpec(spec).some((i) => i.code === 'unreadable-hold')).toBe(false)
  })

  it('off-margin: fires when a text box crosses the side margin (but stays inside the frame)', () => {
    // right edge = 0.5 + 1000/2/1080 ≈ 0.963: past the 0.94 margin, short of the 1.0 frame edge —
    // this is what distinguishes the 0.06 margin rule from "falls off the stage entirely".
    const spec = baseSpec([text('a', 0, 2, { x: 0.5, maxWidth: 1000 })])
    expect(lintSpec(spec).some((i) => i.code === 'off-margin')).toBe(true)
  })

  it('off-margin: does not fire when the box stays inside the margins', () => {
    const spec = baseSpec([text('a', 0, 2, { x: 0.5, maxWidth: 300 })])
    expect(lintSpec(spec).some((i) => i.code === 'off-margin')).toBe(false)
  })
})
