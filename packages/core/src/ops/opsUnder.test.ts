import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { applyOps } from './apply'
import type { ApplyContext } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'

/**
 * `under` on addGenerator / addImage: a background goes on a NEW video lane directly behind a named clip's lane.
 * A higher track `order` draws on top, so "behind" means an order just below the target's, with the target's lane
 * and every lane above it shifted up. Everything runs inside the plan's one batch.
 */

type Assets = NonNullable<ApplyContext['assets']>

const FPS = 30
const assets: Assets = new Map([
  ['talk', { id: 'talk', kind: 'video', name: 'Interview', src: 'blob:talk', durationSec: 20, hasAudio: true }],
  ['sky', { id: 'sky', kind: 'image', name: 'Sky', src: 'blob:sky', durationSec: 0 }],
  ['song', { id: 'song', kind: 'audio', name: 'Song', src: 'blob:song', durationSec: 30 }],
])

/** Base video, an overlay video above it, a locked "Mask" video lane on top (as the matte landing makes), and a title. */
function laid() {
  const engine = new TimelineEngine({ fps: FPS, initialTracks: [] })
  const placed = applyOps(
    engine,
    [
      { op: 'insertSourceRange', ref: 'base', asset: 'talk', start: 2, end: 8, at: 1 },
      { op: 'insertSourceRange', ref: 'over', asset: 'talk', start: 0, end: 3, at: 2, overlay: true },
      { op: 'addText', ref: 'title', text: 'Hello', at: 0, duration: 2 },
    ],
    { assets },
  )
  expect(placed.skipped).toEqual([])
  const mask = engine.addTrack('video', { name: 'Mask' })
  engine.updateTrack(mask.id, { locked: true })
  return { engine, base: placed.refs.base!, over: placed.refs.over!, title: placed.refs.title! }
}

/** Track names, bottom of the stack (lowest order, drawn first) to top. */
const stack = (engine: TimelineEngine) => [...engine.getProject().tracks].sort((a, b) => a.order - b.order).map((t) => t.name)
const clipOf = (engine: TimelineEngine, id: string) => engine.findClip(id)!.clip
const laneName = (engine: TimelineEngine, id: string) => engine.getProject().tracks.find((t) => t.id === clipOf(engine, id).trackId)!.name

describe('under: placement', () => {
  it("puts a generator on a new lane directly beneath the target's lane", () => {
    const { engine, base } = laid()
    const before = stack(engine)
    const targetLane = laneName(engine, base)
    const r = applyOps(engine, [{ op: 'addGenerator', ref: 'bg', kind: 'gradientBackground', under: base }], { assets })
    expect(r.skipped).toEqual([])
    const after = stack(engine)
    const bg = after.indexOf('Background')
    expect(after[bg + 1]).toBe(targetLane)
    expect(laneName(engine, r.refs.bg!)).toBe('Background')
    expect(after).toHaveLength(before.length + 1)
  })

  it('beneath an overlay it sits between the base lane and the overlay, not at the bottom', () => {
    const { engine, over } = laid()
    const r = applyOps(engine, [{ op: 'addImage', asset: 'sky', ref: 'bg', under: over }], { assets })
    expect(r.skipped).toEqual([])
    const names = stack(engine)
    const i = names.indexOf('Background')
    expect(names[i - 1]).toBe('Video 1')
    expect(names[i + 1]).toBe('Overlay')
  })

  it('keeps the relative order of every other lane (the locked Mask lane stays above its video)', () => {
    const { engine, base } = laid()
    const before = stack(engine)
    applyOps(engine, [{ op: 'addImage', asset: 'sky', under: base }], { assets })
    expect(stack(engine).filter((n) => n !== 'Background')).toEqual(before)
    const orders = engine
      .getProject()
      .tracks.map((t) => t.order)
      .sort((a, b) => a - b)
    expect(orders).toEqual(orders.map((_, i) => i))
    expect(engine.getProject().tracks.find((t) => t.name === 'Mask')!.locked).toBe(true)
  })

  it('draws behind the target when the scene is resolved', () => {
    const { engine, base } = laid()
    applyOps(engine, [{ op: 'addImage', asset: 'sky', under: base }], { assets })
    const scene = resolveTimeline(40, engine.getProject())
    const image = scene.images.find((i) => i.src === 'blob:sky')!
    const video = scene.videos.find((v) => v.id === base)!
    expect(image.zIndex).toBeLessThan(video.zIndex)
  })

  it('is one undo step: the lane, the clip and the old orders all come back', () => {
    const { engine, base } = laid()
    const snapshot = JSON.stringify(engine.getProject())
    const r = applyOps(engine, [{ op: 'addGenerator', kind: 'gradientBackground', under: base }, { op: 'addImage', asset: 'sky', under: base }], { assets })
    expect(r.skipped).toEqual([])
    expect(stack(engine).filter((n) => n === 'Background')).toHaveLength(2)
    expect(engine.undo()).toBe(true)
    expect(JSON.stringify(engine.getProject())).toBe(snapshot)
  })

  it('accepts a $ref to a clip made earlier in the same plan', () => {
    const { engine } = laid()
    const r = applyOps(
      engine,
      [
        { op: 'insertSourceRange', ref: 'cut', asset: 'talk', start: 0, end: 2, at: 10, overlay: true },
        { op: 'addGenerator', ref: 'bg', kind: 'gradientBackground', under: '$cut' },
      ],
      { assets },
    )
    expect(r.skipped).toEqual([])
    const cut = clipOf(engine, r.refs.cut!)
    const bg = clipOf(engine, r.refs.bg!)
    expect([bg.startFrame, bg.durationFrames]).toEqual([cut.startFrame, cut.durationFrames])
  })
})

describe('under: default timing', () => {
  it('spans the referenced clip when at and duration are omitted', () => {
    const { engine, base } = laid()
    const target = clipOf(engine, base)
    const r = applyOps(engine, [{ op: 'addGenerator', ref: 'g', kind: 'gradientBackground', under: base }, { op: 'addImage', ref: 'i', asset: 'sky', under: base }], { assets })
    for (const ref of ['g', 'i']) {
      const c = clipOf(engine, r.refs[ref]!)
      expect([c.startFrame, c.durationFrames]).toEqual([target.startFrame, target.durationFrames])
    }
  })

  it('an explicit at starts there and runs to the end of the clip; an explicit duration is kept', () => {
    const { engine, base } = laid()
    const target = clipOf(engine, base)
    const r = applyOps(
      engine,
      [
        { op: 'addImage', ref: 'a', asset: 'sky', under: base, at: 2 },
        { op: 'addGenerator', ref: 'b', kind: 'gradientBackground', under: base, duration: 1 },
      ],
      { assets },
    )
    expect(r.skipped).toEqual([])
    const a = clipOf(engine, r.refs.a!)
    expect([a.startFrame, a.durationFrames]).toEqual([60, target.startFrame + target.durationFrames - 60])
    const b = clipOf(engine, r.refs.b!)
    expect([b.startFrame, b.durationFrames]).toEqual([target.startFrame, 30])
  })
})

describe('under: sanitizeOps and describeOp', () => {
  it('requires at and duration on a generator only when there is no under', () => {
    const { engine, base } = laid()
    const r = sanitizeOps(
      [
        { op: 'addGenerator', kind: 'gradientBackground' },
        { op: 'addGenerator', kind: 'gradientBackground', under: base },
        { op: 'addGenerator', kind: 'gradientBackground', at: 0, duration: 2, under: null },
      ],
      engine.getProject(),
      { assets },
    )
    expect(r.ops).toEqual([
      { op: 'addGenerator', kind: 'gradientBackground', under: base },
      { op: 'addGenerator', kind: 'gradientBackground', at: 0, duration: 2 },
    ])
    expect(r.dropped.map((d) => d.index)).toEqual([0])
  })

  it('drops an unknown clip, an audio clip and a part path; keeps a $ref made earlier', () => {
    const { engine } = laid()
    const withAudio = applyOps(engine, [{ op: 'insertSourceRange', ref: 'a', asset: 'song', start: 0, end: 4, at: 0 }], { assets })
    const r = sanitizeOps(
      [
        { op: 'addImage', asset: 'sky', under: 'nope' },
        { op: 'addImage', asset: 'sky', under: withAudio.refs.a },
        { op: 'addImage', asset: 'sky', under: 'comp/child' },
        { op: 'insertSourceRange', ref: 'x', asset: 'talk', start: 0, end: 1 },
        { op: 'addImage', asset: 'sky', under: '$x' },
      ],
      engine.getProject(),
      { assets },
    )
    expect(r.dropped.map((d) => d.index)).toEqual([0, 1, 2])
    expect(r.dropped[1]!.reason).toMatch(/audio/)
    expect(r.ops.map((o) => o.op)).toEqual(['insertSourceRange', 'addImage'])
  })

  it('skips (and leaves no lane behind) when applied to audio', () => {
    const { engine } = laid()
    const audio = applyOps(engine, [{ op: 'insertSourceRange', ref: 'a', asset: 'song', start: 0, end: 4, at: 0 }], { assets }).refs.a!
    const before = JSON.stringify(engine.getProject().tracks)
    const r = applyOps(engine, [{ op: 'addImage', asset: 'sky', under: audio }], { assets })
    expect(r.skipped).toHaveLength(1)
    expect(JSON.stringify(engine.getProject().tracks)).toBe(before)
  })

  it('describeOp says "behind" the clip', () => {
    const { engine, base } = laid()
    const describe = opDescriber(engine.getProject(), assets)
    expect(describe({ op: 'addGenerator', kind: 'gradientBackground', under: base })).toMatch(/behind “Interview”/)
    expect(describe({ op: 'addImage', asset: 'sky', under: base })).toMatch(/Place image “Sky” behind “Interview” for its whole length/)
  })
})
