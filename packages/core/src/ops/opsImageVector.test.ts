import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import { EDITOR_OP_NAMES, type EditorOp } from './types'
import { svgToProject } from '../vector/svg/svgToProject'
import { importedVectorClip } from '../vector/importClip'
import type { SvgNode } from '../vector/svg/types'
import type { MediaAsset } from '../assets/types'

/** `addImage` and `insertVector` (AGN-P23). */

const lib = (list: Array<Partial<MediaAsset> & { id: string; kind: MediaAsset['kind']; name: string }>) =>
  new Map(list.map((a) => [a.id, { src: `blob:${a.id}`, durationSec: 0, ...a } as MediaAsset]))
const ASSETS = lib([
  { id: 'photo', kind: 'image', name: 'Skyline.jpg', src: 'https://images.pexels.com/x.jpg' },
  { id: 'gif', kind: 'image', name: 'Spin.gif', animated: true },
  { id: 'logo', kind: 'image', name: 'Logo.svg' },
  { id: 'clip', kind: 'video', name: 'Interview.mp4', durationSec: 30 },
])

const path = (d: string, extra: Record<string, string> = {}): SvgNode => ({ tag: 'path', attrs: { d, fill: '#ff0000', ...extra }, children: [] })
const SVG: SvgNode = { tag: 'svg', attrs: { viewBox: '0 0 100 100' }, children: [path('M10 10 L90 10 L50 90 Z')] }

function vectorClip(engine: TimelineEngine) {
  const p = engine.getProject()
  const r = svgToProject(SVG, { fps: p.fps, durationFrames: 5 * p.fps })
  return importedVectorClip(r.project, { name: 'Logo', startFrame: 0, parentStage: p.stage })
}
const setup = () => new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 }, initialTracks: [] })

describe('addImage', () => {
  it('is a registered op name', () => {
    expect(EDITOR_OP_NAMES).toEqual(expect.arrayContaining(['addImage', 'insertVector']))
  })

  it('places an image asset as an image clip, 5s by default, and refs it', () => {
    const engine = setup()
    const { ops, dropped } = sanitizeOps([{ op: 'addImage', asset: 'photo', at: 2, ref: 'bg' }], engine.getProject(), { assets: ASSETS })
    expect(dropped).toEqual([])
    const res = applyOps(engine, ops, { assets: ASSETS })
    expect(res.skipped).toEqual([])
    const clip = engine.findClip(res.refs.bg!)!.clip
    expect(clip).toMatchObject({ type: 'image', assetId: 'photo', src: 'https://images.pexels.com/x.jpg', startFrame: 60, durationFrames: 150 })
  })

  it('honours duration, and overlay keeps off the base video lane', () => {
    const engine = setup()
    const base = engine.addTrack('video').id
    engine.addClip({ trackId: base, type: 'video', name: 'Talk', src: 't.mp4', startFrame: 0, durationFrames: 300 } as never)
    const { ops } = sanitizeOps([{ op: 'addImage', asset: 'photo', at: 1, duration: 2, overlay: true, ref: 'o' }], engine.getProject(), { assets: ASSETS })
    const res = applyOps(engine, ops, { assets: ASSETS })
    const found = engine.findClip(res.refs.o!)!
    expect(found.clip.durationFrames).toBe(60)
    expect(found.clip.trackId).not.toBe(base)
  })

  it('drops an unknown asset, a video, an animated image and a non-positive duration', () => {
    const engine = setup()
    const raw = [
      { op: 'addImage', asset: 'nope' },
      { op: 'addImage', asset: 'clip' },
      { op: 'addImage', asset: 'gif' },
      { op: 'addImage', asset: 'photo', duration: 0 },
      { op: 'addImage', asset: 'photo', duration: -3 },
    ]
    const { ops, dropped } = sanitizeOps(raw, engine.getProject(), { assets: ASSETS })
    expect(ops).toEqual([])
    expect(dropped.map((d) => d.reason)).toEqual([
      expect.stringMatching(/no media/),
      expect.stringMatching(/a video, not an image/),
      expect.stringMatching(/animated image/),
      expect.stringMatching(/duration/),
      expect.stringMatching(/duration/),
    ])
  })

  it('applyOps skips a non-image asset even if sanitising was bypassed', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'addImage', asset: 'clip' } as EditorOp], { assets: ASSETS })
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/not an image/)
  })

  it('reads as a sentence', () => {
    const say = opDescriber({ clips: {} }, ASSETS)
    expect(say({ op: 'addImage', asset: 'photo', at: 2 })).toBe('Place image “Skyline.jpg” at 0:02 for 5s')
  })
})

describe('insertVector', () => {
  it('sanitises: needs an SVG image asset, and never reads a planner-supplied clip', () => {
    const engine = setup()
    const forged = { type: 'shape', id: 'x', name: 'forged' }
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'insertVector', asset: 'logo', at: 1, ref: 'v', clip: forged },
        { op: 'insertVector', asset: 'photo' },
        { op: 'insertVector', asset: 'clip' },
        { op: 'insertVector', asset: 'ghost' },
      ],
      engine.getProject(),
      { assets: ASSETS },
    )
    expect(ops).toEqual([{ op: 'insertVector', asset: 'logo', at: 1, ref: 'v' }])
    expect(dropped.map((d) => d.index)).toEqual([1, 2, 3])
    expect(dropped[0]!.reason).toMatch(/not an SVG.*use addImage/)
  })

  it('accepts a hosted vector whose name has no .svg, and still drops a hosted PNG (SVG-1a)', () => {
    const engine = setup()
    const assets = lib([
      { id: 'hosted', kind: 'image', name: 'mark', src: '/api/gallery/asset?url=https%3A%2F%2Fcdn.example.com%2Fabc.svg', vector: { origin: 'upload', hostedUrl: 'https://cdn.example.com/abc.svg' } },
      { id: 'inline', kind: 'image', name: 'wordmark', vector: { origin: 'model', svg: '<svg/>' } },
      { id: 'png', kind: 'image', name: 'mark2', src: '/api/gallery/asset?url=https%3A%2F%2Fcdn.example.com%2Fabc.png' },
    ])
    const { ops, dropped } = sanitizeOps(
      [{ op: 'insertVector', asset: 'hosted' }, { op: 'insertVector', asset: 'inline' }, { op: 'insertVector', asset: 'png' }],
      engine.getProject(),
      { assets },
    )
    expect(ops).toEqual([{ op: 'insertVector', asset: 'hosted' }, { op: 'insertVector', asset: 'inline' }])
    expect(dropped.map((d) => d.index)).toEqual([2])
  })

  it('applyOps SKIPS an insertVector that was never resolved, and places no picture', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertVector', asset: 'logo' }], { assets: ASSETS })
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/never read from its SVG/)
    expect(Object.values(engine.getProject().clips).flat()).toEqual([])
  })

  it('places a resolved vector as shape clips on a Vector lane at `at`, with a ref the next op can animate', () => {
    const engine = setup()
    const clip = vectorClip(engine)
    const res = applyOps(
      engine,
      [
        { op: 'insertVector', asset: 'logo', at: 2, ref: 'logo', clip },
        { op: 'setKeyframes', clip: '$logo', channel: 'opacity', keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
      ],
      { assets: ASSETS },
    )
    expect(res.skipped).toEqual([])
    const found = engine.findClip(res.refs.logo!)!
    expect(found.clip.type).toBe('shape')
    expect(found.clip.startFrame).toBe(60)
    expect(found.clip.shapeKind).toBe('path')
    expect(engine.getProject().tracks.find((t) => t.id === found.clip.trackId)).toMatchObject({ kind: 'elements', name: 'Vector' })
    expect(found.clip.keyframes?.channels.opacity?.keys).toHaveLength(2)
  })

  it('a multi-shape vector lands as one compound clip', () => {
    const engine = setup()
    const p = engine.getProject()
    const two: SvgNode = { tag: 'svg', attrs: { viewBox: '0 0 100 100' }, children: [path('M0 0 L50 0 L25 50 Z'), path('M50 50 L100 50 L75 100 Z', { fill: '#00ff00' })] }
    const r = svgToProject(two, { fps: p.fps, durationFrames: 150 })
    const clip = importedVectorClip(r.project, { name: 'Pair', startFrame: 0, parentStage: p.stage })
    expect(clip.type).toBe('compound')
    const res = applyOps(engine, [{ op: 'insertVector', asset: 'logo', ref: 'pair', clip }], { assets: ASSETS })
    expect(res.skipped).toEqual([])
    expect(engine.findClip(res.refs.pair!)!.clip.type).toBe('compound')
  })

  it('reads as a sentence', () => {
    const say = opDescriber({ clips: {} }, ASSETS)
    expect(say({ op: 'insertVector', asset: 'logo', at: 2 })).toBe('Place “Logo.svg” as editable vector shapes at 0:02')
  })

  // MI-P9: `query` is an alternative to `asset`.
  it('accepts a query OR an asset, and rejects neither (MI-P9)', () => {
    const engine = setup()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'insertVector', query: '  a house  icon ', at: 2, ref: 'h' },
        { op: 'insertVector', asset: 'logo' },
        { op: 'insertVector', asset: null, query: 'clock' },
        { op: 'insertVector', ref: 'nothing' },
        { op: 'insertVector', asset: '', query: '   ' },
      ],
      engine.getProject(),
      { assets: ASSETS },
    )
    expect(ops).toEqual([
      { op: 'insertVector', query: 'a house icon', at: 2, ref: 'h' },
      { op: 'insertVector', asset: 'logo' },
      { op: 'insertVector', query: 'clock' },
    ])
    expect(dropped.map((d) => d.index)).toEqual([3, 4])
    expect(dropped[0]!.reason).toMatch(/needs an asset from the library or a query/)
  })

  it('a query is cut to 64 characters, and an asset wins over a query (MI-P9)', () => {
    const engine = setup()
    const { ops } = sanitizeOps(
      [{ op: 'insertVector', query: 'x'.repeat(200) }, { op: 'insertVector', asset: 'logo', query: 'house' }],
      engine.getProject(),
      { assets: ASSETS },
    )
    expect((ops[0] as { query: string }).query).toHaveLength(64)
    expect(ops[1]).toEqual({ op: 'insertVector', asset: 'logo' })
  })

  it('an unresolved query vector is skipped by applyOps and reads as an open-source icon (MI-P9)', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertVector', query: 'house' }], { assets: ASSETS })
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/never read from its SVG/)
    const say = opDescriber({ clips: {} }, ASSETS)
    expect(say({ op: 'insertVector', query: 'house', at: 2 })).toBe('Place an open-source icon for “house” as editable vector shapes at 0:02')
  })
})
