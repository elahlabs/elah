import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import { sanitizeOps } from './sanitize'
import { EDITOR_OP_NAMES } from './types'
import { emitScene } from '../vector/html/emit'
import { statScene } from '../vector/html/fixtures'

/** `insertScene` (MC-2a): the client-built op that places one converted scene as a nested compound. */

const setup = () => new TimelineEngine({ fps: 30, stage: { width: 1080, height: 1920 }, initialTracks: [] })
const sceneClip = () => emitScene(statScene(), { fps: 30 }).clip

describe('insertScene', () => {
  it('is NOT a model-facing op name, and the sanitiser refuses a forged one', () => {
    expect(EDITOR_OP_NAMES as readonly string[]).not.toContain('insertScene')
    const engine = setup()
    const { ops, dropped } = sanitizeOps([{ op: 'insertScene', at: 1, clip: sceneClip() }], engine.getProject())
    expect(ops).toEqual([])
    expect(dropped).toHaveLength(1)
  })

  it('places the compound on a Scenes lane at `at`, whole length, named from the clip', () => {
    const engine = setup()
    const clip = sceneClip()
    const res = applyOps(engine, [{ op: 'insertScene', at: 2, ref: 'scene', clip }])
    expect(res.skipped).toEqual([])
    expect(res.applied).toEqual([0])
    const found = engine.findClip(res.refs.scene!)!
    expect(found.clip.type).toBe('compound')
    expect(found.clip.name).toBe(clip.name)
    expect(found.clip.startFrame).toBe(60)
    expect(found.clip.durationFrames).toBe(clip.durationFrames)
    expect(engine.getProject().tracks.find((t) => t.id === found.clip.trackId)).toMatchObject({ kind: 'elements', name: 'Scenes' })
    expect(res.touched.added).toContain(found.clip.id)
  })

  it('starts at the playhead when `at` is absent', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertScene', ref: 's', clip: sceneClip() }], { playheadFrame: 45 })
    expect(engine.findClip(res.refs.s!)!.clip.startFrame).toBe(45)
  })

  it('skips a missing clip with a reason and places nothing', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertScene', at: 0 }])
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/never converted/)
    expect(Object.values(engine.getProject().clips).flat()).toHaveLength(0)
  })

  it('skips a clip that is not a compound', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertScene', clip: { ...sceneClip(), type: 'text' } }])
    expect(res.applied).toEqual([])
    expect(res.skipped[0]!.reason).toMatch(/not a compound/)
  })

  it('its ref is addressable by a following setKeyframes and nest in the same batch', () => {
    const engine = setup()
    const res = applyOps(engine, [
      { op: 'insertScene', ref: 'scene', at: 0, clip: sceneClip() },
      { op: 'setKeyframes', clip: '$scene', channel: 'opacity', keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }] },
      { op: 'nest', clips: ['$scene'], name: 'Wrapped' },
    ])
    expect(res.skipped).toEqual([])
    expect(res.applied).toEqual([0, 1, 2])
    const clips = Object.values(engine.getProject().clips).flat()
    expect(clips.some((c) => c.name === 'Wrapped' && c.type === 'compound')).toBe(true)
  })

  it('reads as "placed scene <name> (<n> parts)"', () => {
    const clip = sceneClip()
    const parts = Object.values(clip.compound!.project.clips).reduce((n, l) => n + l.length, 0)
    const say = opDescriber({ clips: {} })
    expect(say({ op: 'insertScene', clip })).toBe(`placed scene ${clip.name} (${parts} parts)`)
  })
})

describe('insertScene carries Clip.scene (CMP-EDIT-3)', () => {
  it('copies the source onto the added clip', () => {
    const engine = setup()
    const scene = { v: 1 as const, html: '<h1>x</h1>', css: '', name: 'stat', duration: 4 }
    const res = applyOps(engine, [{ op: 'insertScene', at: 0, ref: 's', clip: { ...sceneClip(), scene } }])
    expect(engine.findClip(res.refs.s!)!.clip.scene).toEqual(scene)
  })

  it('a clip with no scene gets no scene key', () => {
    const engine = setup()
    const res = applyOps(engine, [{ op: 'insertScene', at: 0, ref: 's', clip: sceneClip() }])
    expect('scene' in engine.findClip(res.refs.s!)!.clip).toBe(false)
  })
})
