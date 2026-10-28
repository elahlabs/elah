/**
 * MOT-1: motion along a path. The resolver turns `Clip.motionPath` plus the keyed `motion.progress`
 * into a plain `Transform`; GPU preview, 2D export and the CSS overlay all read that Transform, so
 * what is asserted here (on a NON-square stage) is what each of them draws.
 */
import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from './resolveTimeline'
import { isExpressionChannel, isKeyframeChannelName, isTierBChannel } from './keyframes'
import { buildPathTable, motionPathIssue, samplePathPosition } from './motionPath'
import type { Clip, Keyframe, Project } from '../types'

const STAGE = { width: 1920, height: 1080 }

function key(frame: number, value: number): Keyframe {
  return { id: `k${frame}`, frame, value, easing: 'linear' }
}
const track = (...ks: Keyframe[]) => ({ source: { kind: 'keyframes' as const }, keys: ks })

function fixture(extra: Partial<Clip>) {
  const engine = new TimelineEngine({ fps: 30, stage: STAGE })
  const trackId = engine.addTrack('elements').id
  const shape = engine.addClip({ trackId, type: 'shape', name: 'S', startFrame: 0, durationFrames: 100, shape: { shapeKind: 'rect' } })
  engine.updateClip(shape.id, trackId, extra)
  return engine.getProject()
}
const at = (p: Project, frame: number) => resolveTimeline(frame, p).shapes[0]!.transform!

const LINE = 'M 100 200 L 900 200'
const table = (d: string) => buildPathTable(d)!
const ANCHOR = { x: 0.5, y: 0.5 }

describe('MOT-1: samplePathPosition', () => {
  it('a straight line: 0, 0.5 and 1 are start, midpoint and end; angle 0 along +x', () => {
    const t = table(LINE)
    expect(t.length).toBeCloseTo(800, 6)
    expect(samplePathPosition(t, 0)).toMatchObject({ x: 100, y: 200, angle: 0 })
    const mid = samplePathPosition(t, 0.5)
    expect(mid.x).toBeCloseTo(500, 6)
    expect(mid.y).toBeCloseTo(200, 6)
    expect(samplePathPosition(t, 1).x).toBeCloseTo(900, 6)
  })

  it('is arc-length parameterised: progress 0.5 on a lopsided cubic is half the length, not t = 0.5', () => {
    const t = table('M 0 0 C 0 0 0 0 1000 0') // control points bunched at the start
    expect(samplePathPosition(t, 0.5).x).toBeCloseTo(500, 0)
  })

  it('clamps the lookup to 0..1 and reads a non-finite progress as 0', () => {
    const t = table(LINE)
    expect(samplePathPosition(t, 1.4).x).toBeCloseTo(900, 6)
    expect(samplePathPosition(t, -0.4).x).toBeCloseTo(100, 6)
    expect(samplePathPosition(t, Number.NaN).x).toBeCloseTo(100, 6)
  })

  it('a circle: tangent angles follow the direction of travel, clockwise on screen', () => {
    // Start at the right (100, 0), sweep clockwise (y down) to the bottom (0, 100) and round.
    const t = table('M 100 0 A 100 100 0 1 1 -100 0 A 100 100 0 1 1 100 0')
    const quarter = samplePathPosition(t, 0.25)
    expect(quarter.x).toBeCloseTo(0, 1)
    expect(quarter.y).toBeCloseTo(100, 1)
    expect(Math.abs(quarter.angle)).toBeCloseTo(Math.PI, 2) // heading -x at the bottom
    expect(samplePathPosition(t, 0).angle).toBeCloseTo(Math.PI / 2, 2) // heading +y (down) at the start
  })

  it('a closed path includes the closing edge', () => {
    const t = table('M 0 0 L 100 0 L 100 100 Z')
    expect(t.length).toBeCloseTo(100 + 100 + Math.hypot(100, 100), 4)
    const end = samplePathPosition(t, 1)
    expect(end.x).toBeCloseTo(0, 6)
    expect(end.y).toBeCloseTo(0, 6)
  })

  it('two subpaths: only the first is followed, and the issue says so', () => {
    const d = 'M 0 0 L 100 0 M 500 500 L 900 500'
    const t = table(d)
    expect(t.length).toBeCloseTo(100, 6)
    expect(t.extraSubpaths).toBe(true)
    expect(samplePathPosition(t, 1).x).toBeCloseTo(100, 6)
    expect(motionPathIssue(d)).toMatch(/more than one subpath/)
  })

  it('unusable data is null with a readable issue; a lone move rests on its point', () => {
    expect(buildPathTable('not a path')).toBeNull()
    expect(motionPathIssue('')).toMatch(/not valid/)
    expect(samplePathPosition(table('M 40 50'), 0.7)).toEqual({ x: 40, y: 50, angle: 0 })
  })
})

describe('MOT-1: channel names', () => {
  it('motion.progress is a key channel, a Tier B channel and not an expression channel', () => {
    expect(isKeyframeChannelName('motion.progress')).toBe(true)
    expect(isTierBChannel('motion.progress')).toBe(true)
    expect(isExpressionChannel('motion.progress')).toBe(false)
  })
})

describe('MOT-1: resolver output', () => {
  const keyed = (...ks: Keyframe[]): Partial<Clip> => ({
    motionPath: { d: LINE },
    keyframes: { channels: { 'motion.progress': track(...ks) } },
  })

  it('before, inside and after the keys: holds, follows, holds (stage px / stage size on a 16:9 stage)', () => {
    const p = fixture(keyed(key(20, 0), key(60, 1)))
    expect(at(p, 0).x).toBeCloseTo(100 / 1920, 9)
    expect(at(p, 0).y).toBeCloseTo(200 / 1080, 9)
    expect(at(p, 40).x).toBeCloseTo(500 / 1920, 9)
    expect(at(p, 40).y).toBeCloseTo(200 / 1080, 9)
    expect(at(p, 99).x).toBeCloseTo(900 / 1920, 9)
  })

  it('a path and no progress keys rests at the path start', () => {
    const p = fixture({ motionPath: { d: LINE } })
    expect(at(p, 50).x).toBeCloseTo(100 / 1920, 9)
    expect(at(p, 50).y).toBeCloseTo(200 / 1080, 9)
  })

  it('reversed keys run the path backwards', () => {
    const p = fixture(keyed(key(0, 1), key(50, 0)))
    expect(at(p, 0).x).toBeCloseTo(900 / 1920, 9)
    expect(at(p, 25).x).toBeCloseTo(500 / 1920, 9)
    expect(at(p, 50).x).toBeCloseTo(100 / 1920, 9)
  })

  it('overshoot is allowed on the channel and clamped at the lookup', () => {
    const p = fixture(keyed(key(0, 0), key(20, 1.3), key(40, 1)))
    expect(at(p, 20).x).toBeCloseTo(900 / 1920, 9)
  })

  it('the path REPLACES authored x/y, keyed or not', () => {
    const p = fixture({
      motionPath: { d: LINE },
      transform: { x: 0.9, y: 0.9, scale: 1, rotation: 0, anchor: ANCHOR },
      keyframes: { channels: { x: track(key(0, 0.9), key(50, 0.1)), 'motion.progress': track(key(0, 0), key(50, 1)) } },
    })
    expect(at(p, 0).x).toBeCloseTo(100 / 1920, 9)
    expect(at(p, 0).y).toBeCloseTo(200 / 1080, 9)
    expect(at(p, 50).x).toBeCloseTo(900 / 1920, 9)
  })

  it('orient adds the tangent; offsetRotation adds degrees; a rotation channel stacks on top', () => {
    // Heading +y (down): tangent angle pi/2.
    const p = fixture({
      motionPath: { d: 'M 300 100 L 300 900', orient: true, offsetRotation: 90 },
      keyframes: { channels: { 'motion.progress': track(key(0, 0), key(50, 1)), rotation: track(key(0, 0.5), key(50, 0.5)) } },
    })
    expect(at(p, 25).rotation).toBeCloseTo(0.5 + Math.PI / 2 + Math.PI / 2, 6)
    expect(at(p, 25).x).toBeCloseTo(300 / 1920, 9)
    expect(at(p, 25).y).toBeCloseTo(500 / 1080, 9)
  })

  it('without orient the rotation is untouched', () => {
    const p = fixture({ ...keyed(key(0, 0), key(50, 1)), motionPath: { d: 'M 300 100 L 300 900' } })
    expect(at(p, 25).rotation).toBe(0)
  })

  it('space clip offsets from the authored position', () => {
    const p = fixture({
      motionPath: { d: 'M 500 500 L 700 500', space: 'clip' },
      transform: { x: 0.25, y: 0.5, scale: 1, rotation: 0, anchor: ANCHOR },
      keyframes: { channels: { 'motion.progress': track(key(0, 0), key(50, 1)) } },
    })
    expect(at(p, 0).x).toBeCloseTo(0.25, 9)
    expect(at(p, 50).x).toBeCloseTo(0.25 + 200 / 1920, 9)
    expect(at(p, 50).y).toBeCloseTo(0.5, 9)
  })

  it('an invalid d leaves the clip exactly as authored', () => {
    const p = fixture({
      ...keyed(key(0, 0), key(50, 1)),
      motionPath: { d: 'nonsense' },
      transform: { x: 0.3, y: 0.4, scale: 1, rotation: 0, anchor: ANCHOR },
    })
    expect(at(p, 25).x).toBe(0.3)
    expect(at(p, 25).y).toBe(0.4)
  })

  it('a clip with no motionPath resolves as before', () => {
    const p = fixture({
      keyframes: { channels: { 'motion.progress': track(key(0, 0), key(50, 1)) } },
      transform: { x: 0.3, y: 0.4, scale: 1, rotation: 0, anchor: ANCHOR },
    })
    expect(at(p, 25).x).toBe(0.3)
  })
})
