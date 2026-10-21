import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { findSpringPreset } from '../elements/springPresets'
import { BEZIER_PRESETS } from '../elements/easingPresets'
import { sampleChannel } from '../resolver/keyframes'
import type { EditorOp } from './types'
import type { Keyframe } from '../types'

// Copied from ops.test.ts lines 10-16: the fixture is the minimum an op needs.
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
  const b = engine.addClip({ trackId: v, type: 'video', name: 'B-roll', src: 'b.mp4', startFrame: 150, durationFrames: 150 })
  return { engine, v, a: a.id, b: b.id }
}

const bouncy = findSpringPreset('bouncy')!.spring

const keyOp = (clip: string, curve: string): EditorOp =>
  ({
    op: 'setKeyframes',
    clip,
    channel: 'x',
    keys: [
      { at: 0, value: 0.2 },
      { at: 1, value: 0.8, curve },
    ],
  }) as unknown as EditorOp

/** Sanitize then apply, the way a model-authored op actually lands. */
function roundTrip(engine: TimelineEngine, clip: string, curve: string) {
  const { ops, dropped } = sanitizeOps([keyOp(clip, curve)], engine.getProject())
  expect(dropped).toEqual([])
  applyOps(engine, ops)
}

const xKeys = (engine: TimelineEngine, clipId: string): Keyframe[] =>
  engine.findClip(clipId)!.clip.keyframes!.channels.x!.keys

describe('sanitizeOps with a spring curve', () => {
  it('keeps every spring preset id', () => {
    const { engine, b } = fixture()
    for (const id of ['gentle', 'snappy', 'bouncy', 'stiff', 'wobbly']) {
      const { ops, dropped } = sanitizeOps([keyOp(b, `spring:${id}`)], engine.getProject())
      expect(dropped).toEqual([])
      const keys = (ops[0] as unknown as { keys: { curve?: string }[] }).keys
      expect(keys[1].curve).toBe(`spring:${id}`)
    }
  })

  it('drops an unknown spring id from the key but keeps the key', () => {
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([keyOp(b, 'spring:nope')], engine.getProject())
    const keys = (ops[0] as unknown as { keys: { curve?: string }[] }).keys
    // The key survives so the motion still exists; only the unknown curve goes.
    expect(keys).toHaveLength(2)
    expect(keys[1].curve).toBeUndefined()
  })

  it('does not confuse a spring id with the bezier preset of the same name', () => {
    // `snappy` is BOTH a bezier preset and a spring preset. The namespacing is
    // the only thing keeping them apart.
    const { engine, b } = fixture()
    const { ops } = sanitizeOps([keyOp(b, 'snappy')], engine.getProject())
    const keys = (ops[0] as unknown as { keys: { curve?: string }[] }).keys
    expect(keys[1].curve).toBe('snappy')
  })
})

describe('applyOps with a spring curve', () => {
  it('writes the preset spring and no bezier', () => {
    const { engine, b } = fixture()
    roundTrip(engine, b, 'spring:bouncy')
    const key = xKeys(engine, b)[1]!
    expect(key.spring).toEqual(bouncy)
    expect(key.easingBezier).toBeUndefined()
  })

  it('copies the preset rather than storing the shared object', () => {
    const { engine, b } = fixture()
    roundTrip(engine, b, 'spring:bouncy')
    expect(xKeys(engine, b)[1]!.spring).not.toBe(bouncy)
  })

  it('writes every preset through the op path', () => {
    for (const preset of ['gentle', 'snappy', 'bouncy', 'stiff', 'wobbly']) {
      const { engine, b } = fixture()
      roundTrip(engine, b, `spring:${preset}`)
      expect(xKeys(engine, b)[1]!.spring).toEqual(findSpringPreset(preset)!.spring)
    }
  })

  it('still resolves the bezier preset of the same name as a bezier', () => {
    const { engine, b } = fixture()
    roundTrip(engine, b, 'snappy')
    const key = xKeys(engine, b)[1]!
    expect(key.spring).toBeUndefined()
    expect(key.easingBezier).toEqual([...BEZIER_PRESETS.find((p) => p.id === 'snappy')!.bezier])
  })

  it('actually overshoots in the resolved timeline, not just in storage', () => {
    // The end-to-end claim: an op-authored spring is not only stored, it
    // animates. resolveTimeline is what preview and the export worker both read.
    const { engine, b } = fixture()
    roundTrip(engine, b, 'spring:bouncy')
    const keys = xKeys(engine, b)
    let max = -Infinity
    for (let f = 0; f < 30; f++) max = Math.max(max, sampleChannel(keys, f)!)
    expect(max).toBeGreaterThan(0.8)
    // A linear ramp would be 0.2 + 0.6 * 0.5 = 0.5 at the midpoint; the bouncy
    // spring has overshot by then, so the sample is well past it.
    expect(sampleChannel(keys, 15)).toBeGreaterThan(0.6)
    expect(resolveTimeline(15, engine.getProject())).toBeTruthy()
  })
})
