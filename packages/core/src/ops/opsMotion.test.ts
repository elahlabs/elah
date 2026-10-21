import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import type { EditorOp } from './types'

// AGN-P18: setClipProps gains anchorX/anchorY (a directional wipe's origin)
// and `under` (relative placement, the existing layout.anchorTo).
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'video', name: 'Interview', src: 'a.mp4', startFrame: 0, durationFrames: 300 } as never)
  return { engine, video: a.id }
}

const props = (clip: string, extra: Record<string, unknown>): EditorOp => ({ op: 'setClipProps', clip, ...extra }) as unknown as EditorOp
const title = { op: 'addText', ref: 'title', text: 'Hello', at: 0, duration: 5 } as unknown as EditorOp
const bar = { op: 'addShape', ref: 'bar', kind: 'rect', at: 0, duration: 5 } as unknown as EditorOp

describe('sanitizeOps: setClipProps anchorX / anchorY / under', () => {
  it('clamps the anchor to 0..1', () => {
    const { engine, video } = fixture()
    const { ops, dropped } = sanitizeOps([props(video, { anchorX: 5, anchorY: -3 }), props(video, { anchorX: '0.25' })], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ anchorX: 1, anchorY: 0 })
    expect(ops[1]).toMatchObject({ anchorX: 0.25 })
  })

  it('an op that carries only `under` is not "nothing to change"', () => {
    const { engine, video } = fixture()
    const { ops, dropped } = sanitizeOps([title, props('$title', { under: video })], engine.getProject())
    expect(dropped).toEqual([])
    expect(ops[1]).toMatchObject({ op: 'setClipProps', clip: '$title', under: video })
  })

  it('refuses an `under` that does not resolve, with a reason, and never falls back to absolute placement', () => {
    const { engine, video } = fixture()
    const { ops, dropped } = sanitizeOps([props(video, { x: 0.3, under: 'nope' }), props(video, { under: '$ghost' })], engine.getProject())
    expect(ops).toEqual([])
    expect(dropped.map((d) => d.reason)).toEqual([expect.stringMatching(/no clip "nope"/), expect.stringMatching(/under.*refers to nothing created earlier/)])
  })

  it('refuses a clip under itself', () => {
    const { engine, video } = fixture()
    const { dropped } = sanitizeOps([props(video, { under: video })], engine.getProject())
    expect(dropped[0]!.reason).toMatch(/under itself/)
  })
})

describe('applyOps: setClipProps anchor and under', () => {
  it('anchorX 0 writes the transform anchor and keeps the other defaults', () => {
    const { engine } = fixture()
    const { ops } = sanitizeOps([bar, props('$bar', { anchorX: 0 })], engine.getProject())
    const res = applyOps(engine, ops, { description: 'wipe' })
    expect(res.skipped).toEqual([])
    const clip = Object.values(engine.getProject().clips).flat().find((c) => c.name !== 'Interview' && c.type === 'shape')!
    expect(clip.transform?.anchor).toEqual({ x: 0, y: 0.5 })
  })

  it('`under` writes layout.anchorTo (bottom, centred), survives a JSON round trip, and places the bar below the title', () => {
    const { engine } = fixture()
    const { ops, dropped } = sanitizeOps([title, bar, props('$bar', { under: '$title', anchorX: 0 })], engine.getProject())
    expect(dropped).toEqual([])
    const res = applyOps(engine, ops, { description: 'bar under title' })
    expect(res.skipped).toEqual([])
    const clips = Object.values(engine.getProject().clips).flat()
    const t = clips.find((c) => c.type === 'text')!
    const b = clips.find((c) => c.type === 'shape')!
    expect(b.layout?.anchorTo).toEqual({ clip: t.id, edge: 'bottom', align: 'center', gap: 12 })
    const restored = JSON.parse(JSON.stringify(engine.getProject())) as ReturnType<typeof engine.getProject>
    const rb = Object.values(restored.clips).flat().find((c) => c.type === 'shape')!
    expect(rb.layout?.anchorTo?.clip).toBe(t.id)
    expect(() => resolveTimeline(10, restored)).not.toThrow()
    expect(opDescriber(engine.getProject())(ops[2]!)).toMatch(/under/)
  })

  it('skips with a reason when the target cannot be anchored to (a video clip)', () => {
    const { engine, video } = fixture()
    const { ops } = sanitizeOps([bar, props('$bar', { under: video })], engine.getProject())
    const res = applyOps(engine, ops, { description: 'x' })
    expect(res.skipped[0]!.reason).toMatch(/nothing can sit under it/)
  })
})
